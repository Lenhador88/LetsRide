/**
 * Signs in as a real rider and walks every screen, reporting anything that
 * failed to render.
 *
 * ## Why this exists
 *
 * `openspec/changes/migrate-to-client-rendered-shell/tasks.md` 7.2 says it
 * plainly: "Load the app against the real database and walk every screen in
 * each of its states — the class of defect that produced the /rides/new/crew
 * 500 was found this way and by nothing else." Every other gate in this repo —
 * `tsc`, ESLint, Vitest, `next build`, the RLS suite — stays green through a
 * screen that throws on load, because none of them ever renders one.
 *
 * It was a one-off shell script the first two times somebody needed it, which
 * is why it was never run the third time. Committing it makes the check
 * repeatable rather than remembered.
 *
 * **This is a smoke walk, not an end-to-end suite.** CLAUDE.md defers Playwright
 * "until a flow is stable enough to be worth maintaining", and that still holds.
 * Of every route it visits it asks one question — did this come back as a
 * screen, or as a redirect, an error boundary, or an empty body — and nothing
 * about what the screen then does.
 *
 * The named phases are the exception — refused sign-in and refused signup
 * before the walk, and refused ride create, refused club create, refused ride
 * or club edit, refused profile edit, client-side navigation, the route guard
 * and sign-out after it. They are named individually rather than covered by a
 * general claim: each exists because a specific defect is invisible to every
 * other gate in this repo, and each asserts exactly that one behaviour.
 * Adding a phase means adding a reason, not broadening a remit — PD-203 added
 * three (club create, profile edit, signup) because `retaining` (PD-199) was
 * wired on nine forms and only two were rendered by anything; the other two
 * of the nine (`/auth/forgot-password`, `CreatePostcardForm`) are recorded as
 * deliberately unexercised where `checkRefusedSignup` is defined below,
 * rather than covered here.
 *
 * ## Running it, and the one thing that will otherwise waste an hour
 *
 *   NODE_USE_ENV_PROXY=1 RELAY_UPSTREAM=https://<dev ref>.supabase.co \
 *     node scripts/supabase-relay.mjs &
 *   NEXT_PUBLIC_SUPABASE_URL=http://localhost:3001 NODE_USE_ENV_PROXY=1 npm run dev
 *   WALK_EMAIL=... WALK_PASSWORD=... npm run walk
 *
 *   # ...and to provision the rows the detail routes need, on an empty DEV:
 *   WALK_FIXTURES=1 RELAY_UPSTREAM=https://<dev ref>.supabase.co \
 *     WALK_EMAIL=... WALK_PASSWORD=... npm run walk
 *
 * **Point it at DEV.** This walk signs in, and with `WALK_FIXTURES=1` it posts
 * as a real rider — against `letsride` that means fixture rides in real riders'
 * feeds. docs/HANDOFF.md's recipe named PROD's ref until 2026-08-07, so this is
 * a mistake the documentation actively invited. `fixturesPermitted()` refuses
 * it, and it establishes the project from the **session the browser is holding**
 * rather than from `RELAY_UPSTREAM` — see `authenticatedProjectRef()` for why
 * the env-var version of that check was worth nothing.
 *
 * **The account needs no stored password.** DEV has `mailer_autoconfirm: true`,
 * so a signup returns a session with no confirmation step — mint one, stamp
 * onboarding, walk. docs/HANDOFF.md §The walk has the two commands.
 *
 * **The relay is not optional in this container, and the reason changed with the
 * render migration.** Chromium here cannot reach Supabase at all — measured
 * 2026-08-06: `curl -x $HTTPS_PROXY .../auth/v1/health` returns 401 (tunnel
 * open, host allowed), while the same fetch from a Chromium page launched with
 * `--proxy-server=$HTTPS_PROXY` hangs until aborted, with no response, no
 * `requestfailed`, and no entry in the agent proxy's own `recentRelayFailures`
 * — where a genuinely blocked host *does* appear. Bare,
 * `--ignore-certificate-errors`, `--disable-quic` and `--disable-http2` all hang
 * identically.
 *
 * This file used to say "`--proxy-server` below fixes it". **That was wrong**,
 * and it was survivable only because the browser had nothing important to fetch:
 * the dev server was the Supabase client, and the symptom was blank photos. Now
 * the browser *is* the client, so the same limitation takes sign-in and
 * therefore the entire walk. `scripts/supabase-relay.mjs` restores it; its
 * header carries the full measurement. The `--proxy-server` args below are kept
 * because they are harmless and because a different sandbox may need them.
 *
 * `NODE_USE_ENV_PROXY=1` is separately not optional: Node's fetch ignores
 * HTTPS_PROXY, so the relay itself cannot reach Supabase without it.
 *
 * Pass paths as arguments to walk a subset — that skips the refused-sign-in,
 * navigation, guard and sign-out phases, which need the full run.
 */
import { chromium } from 'playwright-core'

const EXECUTABLE =
  process.env.WALK_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const BASE = process.env.WALK_BASE ?? 'http://localhost:3000'
const EMAIL = process.env.WALK_EMAIL
const PASSWORD = process.env.WALK_PASSWORD

if (!EMAIL || !PASSWORD) {
  console.error(
    'Set WALK_EMAIL and WALK_PASSWORD. Test-account credentials are never committed —\n' +
      'see docs/HANDOFF.md §Test accounts for which accounts exist and where their\n' +
      'passwords live.'
  )
  process.exit(2)
}

/**
 * Every authenticated route. Detail routes are discovered at run time rather
 * than hardcoded, because an id that has been deleted turns a real failure into
 * a 404 nobody investigates.
 */
const STATIC_PATHS = [
  '/postcards',
  '/postcards/new',
  '/rides',
  '/rides/new',
  '/clubs',
  '/clubs/explore',
  '/clubs/new',
  '/profile',
]

const isFullWalk = process.argv.slice(2).length === 0
let paths = isFullWalk ? [...STATIC_PATHS] : process.argv.slice(2)
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: proxy
    ? [
        `--proxy-server=${proxy}`,
        '--proxy-bypass-list=localhost;127.0.0.1',
        '--ignore-certificate-errors',
      ]
    : [],
})

// The design is a 390px mobile frame; walking it at desktop width would exercise
// a layout the app does not have.
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()

const problems = []

/**
 * The one console error that is the harness's fault rather than the app's.
 *
 * `scripts/supabase-relay.mjs` forwards HTTP and drops the `upgrade` header, so
 * the ride chat's Realtime subscription cannot connect through it and Chromium
 * logs a failed WebSocket on every load of `/rides/detail/chat`. Left unfiltered
 * that makes the walk permanently red on a screen that renders perfectly — and
 * a gate that is always red is a gate nobody reads.
 *
 * **Deliberately narrow: the relay's own origin and the Realtime path.** A
 * WebSocket failure anywhere else, or to any other host, is still a failure. It
 * is also counted rather than silently dropped, because a suppressed error that
 * stops being reported is indistinguishable from one that stopped happening —
 * the run prints what it did not exercise.
 */
let realtimeSuppressed = 0
const RELAY_ORIGIN = `ws://localhost:${process.env.RELAY_PORT ?? 3001}/realtime/v1/websocket`
const isRelayWebSocketFailure = (text) =>
  text.startsWith(`WebSocket connection to '${RELAY_ORIGIN}`)

page.on('console', (m) => {
  if (m.type() !== 'error') return
  const text = m.text()
  if (isRelayWebSocketFailure(text)) {
    realtimeSuppressed += 1
    return
  }
  problems.push(`console: ${text.slice(0, 300)}`)
})
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 300)}`))
page.on('response', (r) => {
  if (r.status() >= 500) problems.push(`${r.status()} ${r.url().slice(0, 160)}`)
})

/** How many assertions `checkRefusedSignIn` makes, for the summary line. */
const REFUSED_SIGN_IN_CHECKS = 5

/**
 * A literal, so it cannot depend on `WALK_PASSWORD`'s length. The obvious
 * `${PASSWORD}-wrong` is wrong in the string and not in the check: GoTrue
 * hashes with bcrypt, which **truncates its input at 72 bytes**, so a long
 * enough walk password makes the extension hash identically and the sign-in
 * succeed — and this phase then leaves a signed-in browser for the real
 * sign-in below to fail on with a selector timeout rather than a message.
 */
const WRONG_PASSWORD = 'not-the-password-PD-196'

/**
 * A refused sign-in must leave the email in the field — PD-196.
 *
 * React resets a `<form action={fn}>` once the action resolves, so every
 * uncontrolled field in it reverts to its `defaultValue` on the failure path as
 * well as the success one. A rider who mistyped their password had to retype
 * their address too.
 *
 * **This is the only gate in the repo that can see it.** `tsc`, ESLint, Vitest
 * and `next build` all stay green through it, and the pure-function tests that
 * cover the guard have no DOM to reset.
 *
 * **The refusal assertion is what makes the email assertion mean anything.** A
 * submit that never happened leaves the email in place too, so a check that
 * only read the field back would pass on a form whose button had stopped
 * working. Each attempt therefore asserts its own refusal before its email.
 *
 * **Both attempts exist because they fail differently, and the second is the
 * one a rider is likelier to hit.** A password manager fills the field by
 * assigning the DOM value; a fill that lands before hydration, or dispatches no
 * `input` event, is invisible to React. Anything that keeps the address in
 * component state is therefore holding `''` while the box shows an address —
 * and React overwrites the box from its own state on the next render. Seeding
 * with `page.fill` cannot see that: it always dispatches the event, so the
 * typed case passes on a build where every autofilling rider loses their email.
 */
const WROTE_WITHOUT_EVENT = (el, v) => {
  el.value = v
}

/**
 * One refused attempt. `seed` decides how the address gets into the field,
 * which is the whole variable between the two cases.
 */
async function refusedAttempt(seed) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[name="email"]')
  await seed()
  await page.fill('input[name="password"]', WRONG_PASSWORD)
  await page.click('button[type="submit"]')

  // **Wait for alert *text*, not for an `[role="alert"]` node.** The page
  // carries a permanently-empty one, so presence is true before the submit even
  // starts and `page.textContent` can return that one instead of the refusal.
  // A fixed sleep is wrong here for a second reason: unlike every other wait in
  // this file it spans a round trip to eu-west-1 and GoTrue's deliberately slow
  // bcrypt compare, so it would redden a correct build on a slow network.
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('[role="alert"]')].some((n) => n.textContent.trim().length),
      null,
      { timeout: 20_000 }
    )
    .catch(() => {})

  return {
    refusal: (
      await page.$$eval('[role="alert"]', (ns) => ns.map((n) => n.textContent.trim()).filter(Boolean))
    ).join(' | '),
    landed: new URL(page.url()).pathname,
    email: await page.inputValue('input[name="email"]'),
  }
}

async function checkRefusedSignIn() {
  let bad = 0
  const report = (ok, label, detail) => {
    if (!ok) bad += 1
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (${detail})`}`)
  }

  console.log('\nrefused sign-in:')

  const typed = await refusedAttempt(() => page.fill('input[name="email"]', EMAIL))
  report(Boolean(typed.refusal), 'typed: the refusal is reported', 'no alert text on screen')
  report(typed.landed === '/auth/login', 'typed: the rider stays on /auth/login', `landed on ${typed.landed}`)
  report(typed.email === EMAIL, 'typed: the email survives it', 'the field was cleared — see PD-196')

  const filled = await refusedAttempt(() =>
    page.$eval('input[name="email"]', WROTE_WITHOUT_EVENT, EMAIL)
  )
  report(Boolean(filled.refusal), 'autofilled: the refusal is reported', 'no alert text on screen')
  report(
    filled.email === EMAIL,
    'autofilled: the email survives it',
    'the field was cleared — a fill React never saw cannot be held in component state'
  )

  return bad
}

/** How many assertions `checkRefusedSignup` makes, for the summary line. */
const REFUSED_SIGNUP_CHECKS = 3

/**
 * A literal for the same reason `WRONG_PASSWORD` is one — this has to satisfy
 * `newPasswordSchema`'s length rule regardless of `WALK_PASSWORD`, and its own
 * value never matters: the account already exists, so `signUp` refuses on the
 * duplicate email before it would ever compare a password to anything.
 */
const SIGNUP_PROBE_PASSWORD = 'walk-signup-probe-PD-203'

/**
 * `/auth/signup`, signed out, with the walk's own address — PD-203. It is
 * already registered (this same account signs in a few lines below), so the
 * refusal is `signUp`'s `alreadyRegistered` branch, and `retaining(signUp,
 * ['email', 'password'])` is what has to put both fields back once React
 * resets the form. The defect class is PD-196's: a misspelled or unread key in
 * `retaining`'s field list type-checks and renders exactly like a field the
 * reset was supposed to restore.
 *
 * **This proves only the DEV branch, and that is a property of the
 * environment, not of this phase.** `signUp` takes the `alreadyRegistered`
 * branch only when `supabase.auth.signUp` itself errors on the duplicate —
 * which is what happens with `mailer_autoconfirm: true` (DEV, decision #6,
 * and where this walk always runs, per docs/HANDOFF.md §The walk). With
 * confirmation ON (PROD) GoTrue's own duplicate-signup mitigation returns
 * **success** with an empty `identities` array instead, so `signUp` never
 * reaches this branch at all there — see the comment above the
 * `alreadyRegistered` check in `src/lib/actions/auth.ts`. A green run here is
 * DEV-only coverage; it says nothing about PROD's configuration of this path.
 */
async function checkRefusedSignup() {
  let bad = 0
  const report = (ok, label, detail) => {
    if (!ok) bad += 1
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (${detail})`}`)
  }

  console.log('\nrefused signup (already registered):')

  await page.goto(`${BASE}/auth/signup`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[name="email"]')
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="password"]', SIGNUP_PROBE_PASSWORD)
  // Controlled, and the submit stays disabled until it is ticked — Q9's own
  // note that a disabled button is not a trust boundary is about the server
  // side, but Playwright still has to get past the button being unclickable.
  await page.click('label:has(input[name="acceptedTerms"])')
  await page.click('button[type="submit"]')

  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('[role="alert"]')].some((n) => n.textContent.trim().length),
      null,
      { timeout: 20_000 }
    )
    .catch(() => {})

  const refusal = (
    await page.$$eval('[role="alert"]', (ns) => ns.map((n) => n.textContent.trim()).filter(Boolean))
  ).join(' | ')
  report(Boolean(refusal), 'the refusal is reported', 'no alert text on screen')
  report(
    (await page.inputValue('input[name="email"]')) === EMAIL,
    'the email survives it',
    'the field was cleared'
  )
  report(
    (await page.inputValue('input[name="password"]')) === SIGNUP_PROBE_PASSWORD,
    'the password survives it',
    'the field was cleared'
  )

  return bad
}

/**
 * Two forms `retaining` is wired on that this walk still does not exercise —
 * recorded so the next session does not re-derive the same dead end (PD-203).
 *
 * - **`/auth/forgot-password`.** `requestPasswordReset` never returns an error
 *   by design (Q13/Q16 — the screen must not reveal which addresses have
 *   accounts), and its one Zod refusal (`resetRequestSchema`, a malformed
 *   address) is unreachable through the DOM: the field is `type="email"` with
 *   `required` and the form carries no `noValidate`, so the browser's own
 *   constraint validation blocks a bad address before any submit reaches the
 *   action. Effectively unreachable, not merely untested.
 * - **`CreatePostcardForm`.** Its submit stays `disabled` until an upload
 *   finishes, so exercising a refusal here would mean a real Storage write on
 *   every walk — and Storage from this container's Chromium hangs with no
 *   `onload`/`onerror` (docs/HANDOFF.md §The walk).
 */

// Full walks only, matching the guard cases below: a subset invocation is
// someone debugging one screen, and this one costs a whole extra sign-in.
const refusedSignInFailures = isFullWalk ? await checkRefusedSignIn() : 0
const refusedSignupFailures = isFullWalk ? await checkRefusedSignup() : 0

await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', EMAIL)
await page.fill('input[name="password"]', PASSWORD)
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 30_000 }).catch(() => {}),
  page.click('button[type="submit"]'),
])
await page.waitForTimeout(1500)

const landed = new URL(page.url()).pathname
console.log(`sign-in landed on ${landed}`)
if (landed.startsWith('/auth/login')) {
  console.error('  sign-in failed — every route below will be a redirect, not a result')
}

/**
 * The detail routes, discovered from the lists rather than hardcoded — an id
 * that has been deleted turns a real failure into a 404 nobody investigates.
 *
 * This block is new, and its absence was a real gap: the header of this file
 * has claimed since it was written that "detail routes are discovered at run
 * time", and nothing implemented it. So the four most complex screens in the
 * app — the ride plan, the crew, the club timeline and the postcard thread —
 * were the four that had never been loaded. They are also the four the render
 * migration changed most, because each has a `notFound()` that now fires from a
 * client component on a decided `null` rather than from a server component on an
 * awaited one.
 *
 * A list with no rows yields no path and the route is skipped rather than
 * guessed at, and it says so — a silent skip here reads as a pass.
 */
async function discoverDetailPaths({ quiet = false } = {}) {
  const say = (m) => !quiet && console.log(m)

  /**
   * **The id is a query parameter, not a path segment** (PD-142) — so this reads
   * `?id=` off the first matching link rather than matching the whole pathname.
   * The old version matched `^/rides/[0-9a-f-]{36}$`, which after the route move
   * matches nothing at all: every detail link is `/rides/detail`, and a
   * discovery that silently finds nothing prints a skip notice that reads
   * exactly like a database with no rides in it.
   */
  const firstDetailId = async (listPath, detailPath) => {
    await page.goto(`${BASE}${listPath}`, { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(800)
    return page.evaluate(
      (p) =>
        [...document.querySelectorAll('a[href]')]
          .map((a) => new URL(a.href, location.origin))
          .filter((u) => u.pathname === p)
          .map((u) => u.searchParams.get('id'))
          .find((id) => id && /^[0-9a-f-]{36}$/.test(id)) ?? null,
      detailPath
    )
  }

  const ride = await firstDetailId('/rides', '/rides/detail')
  if (!ride) say('  (no rides to open — /rides/detail and its crew unwalked)')

  const club = await firstDetailId('/clubs', '/clubs/detail')
  if (!club) say('  (no clubs to open — /clubs/detail and its sub-pages unwalked)')

  const postcard = await firstDetailId('/postcards', '/postcards/detail')
  if (!postcard) say('  (no postcard thread link — /postcards/detail unwalked)')

  const detail = (path, id) => `${path}?id=${id}`

  const paths = [
    // `edit` (PD-101) renders even for a rider who is not the organizer/owner
    // — it draws the "not yours" message rather than 404ing — but the walk's
    // fixtures are created through the UI by this same signed-in account, so
    // in the common case it is the real form that gets exercised.
    ...(ride
      ? ['/rides/detail', '/rides/detail/crew', '/rides/detail/chat', '/rides/detail/edit'].map(
          (p) => detail(p, ride)
        )
      : []),
    ...(club
      ? [
          '/clubs/detail',
          '/clubs/detail/rides',
          '/clubs/detail/members',
          '/clubs/detail/about',
          '/clubs/detail/edit',
        ].map((p) => detail(p, club))
      : []),
    ...(postcard ? [detail('/postcards/detail', postcard)] : []),
  ]
  return { ride, club, postcard, paths }
}

/**
 * ## Fixtures — because a skip reads exactly like a pass
 *
 * `9/9 screens rendered clean` against an empty database is not a green run, it
 * is four unopened screens and a number that looks like success. That is not
 * hypothetical: PD-125 shipped a ride sub-page switcher **nobody had ever
 * seen**, past a green walk, because DEV held no rides and the ride detail was
 * therefore skipped every time.
 *
 * So the walk provisions what it needs — but only what is *missing*, which is
 * what keeps it idempotent. A DEV that already has a ride gets nothing new, so
 * repeated runs cannot silt the database up, and no cleanup pass is needed
 * (there is nothing to distinguish "mine" from "the owner's" afterwards, which
 * is exactly the kind of deletion nobody should be writing).
 *
 * **It creates them through the UI rather than through SQL, and that is the
 * point rather than a shortcut.** Submitting `/rides/new` and `/clubs/new`
 * exercises the two create forms end to end — their validation, their actions,
 * their redirects — which nothing else in this repo does at all. An insert
 * would produce the same row and prove none of it.
 *
 * **Postcards are deliberately not provisioned.** The composer requires an
 * image, and Storage from this container's Chromium hangs without ever firing
 * `onload` or `onerror` (docs/HANDOFF.md). A fixture that cannot be created is
 * better skipped loudly than half-built.
 */
/**
 * The projects this walk may write to. **An allowlist, so an unrecognised
 * project fails closed** — a denylist of PROD's ref would wave through a
 * second production project the day one exists.
 */
const WRITABLE_REFS = new Set(['fpmrimzxadewsaiwpsel']) // Letsride-dev

/**
 * Which Supabase project the browser **actually** authenticated against, read
 * from the `iss` claim of the session it is holding.
 *
 * **The first version of this guard read `RELAY_UPSTREAM` from the walk's own
 * environment, and review was right that it was theatre.** That variable
 * configures a *sibling process*; nothing tied it to what the app under test
 * was pointed at. With PROD in `.env.local` and a plain `npm run dev`, the
 * documented `WALK_FIXTURES=1 RELAY_UPSTREAM=https://$DEV...` command passed
 * the guard and would have created public fixture rides in real riders' feeds.
 *
 * `iss` cannot be laundered the same way: GoTrue mints it from its own
 * configuration, so it names the real project even when every byte reached the
 * browser through `http://localhost:3001`. It is the only value here that
 * describes the database the writes will actually land in.
 */
async function authenticatedProjectRef() {
  const token = await page
    .evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith('sb-')) continue
        const raw = localStorage.getItem(key)
        if (!raw) continue
        try {
          const parsed = JSON.parse(raw)
          if (parsed?.access_token) return parsed.access_token
        } catch {
          // Not the session entry — PKCE verifier keys are bare strings.
        }
      }
      return null
    })
    .catch(() => null)

  if (!token) return null
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    // `https://<ref>.supabase.co/auth/v1`
    return new URL(claims.iss).hostname.split('.')[0]
  } catch {
    return null
  }
}

/**
 * Writes are off by default, and turning them on is not enough on its own — the
 * project has to be one this walk is allowed to write to, established from the
 * session rather than from anything the runner typed.
 */
function fixturesPermitted(ref) {
  if (process.env.WALK_FIXTURES !== '1') return { ok: false, quiet: true }
  if (!ref) {
    return {
      ok: false,
      why: 'could not read which project the browser signed in to — refusing to write rather than guessing',
    }
  }
  if (!WRITABLE_REFS.has(ref)) {
    return {
      ok: false,
      why: `refusing to create fixtures against "${ref}" — only ${[...WRITABLE_REFS].join(', ')} is writable`,
    }
  }
  return { ok: true }
}

async function provision({ ride, club }) {
  if (!ride) {
    // A year out, not ten days. `getRides` filters `.gte('departure_at', now)`,
    // so a short-dated fixture ages off /rides and the next run creates another
    // that nothing lists and nothing cleans up — idempotence with an expiry
    // date is not idempotence.
    const departure = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 16)
    await page.goto(`${BASE}/rides/new`, { waitUntil: 'networkidle' })
    await page.fill('input[name="title"]', 'Walk fixture ride')
    await page.fill('input[name="meeting_point"]', 'Dam Square, Amsterdam')
    await page.fill('input[name="departure_at"]', departure)
    await Promise.all([
      page.waitForURL((u) => !u.pathname.endsWith('/new'), { timeout: 30_000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ])
    await page.waitForTimeout(1200)
  }

  if (!club) {
    await page.goto(`${BASE}/clubs/new`, { waitUntil: 'networkidle' })
    await page.fill('input[name="name"]', 'Walk fixture club')
    await Promise.all([
      page.waitForURL((u) => !u.pathname.endsWith('/new'), { timeout: 30_000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ])
    await page.waitForTimeout(1200)
  }
}

let fixtureFailures = 0

if (isFullWalk) {
  let detail = await discoverDetailPaths()

  if (!detail.ride || !detail.club) {
    const permit = fixturesPermitted(await authenticatedProjectRef())
    if (permit.ok) {
      const wanted = { ride: !detail.ride, club: !detail.club }
      await provision(detail)

      /**
       * **Report what landed, never what was attempted.** The first version
       * printed `+ created a ride` unconditionally, straight after the click,
       * and re-read the lists with the skip notices silenced. A create refused
       * by validation or RLS therefore produced
       * `(no rides to open)` → `+ created a ride` → `9/9 screens rendered
       * clean` → exit 0 — the precise skip-reads-as-pass failure this whole
       * change exists to close, reintroduced inside the fix for it.
       *
       * So the re-read is loud, the report comes from it, and a fixture that
       * was asked for and did not arrive fails the run. Silence about a
       * missing fixture is the bug.
       */
      detail = await discoverDetailPaths()
      for (const kind of ['ride', 'club']) {
        if (!wanted[kind]) continue
        if (detail[kind]) {
          console.log(`  + created a ${kind} through /${kind}s/new`)
        } else {
          console.log(`  ! FIXTURE FAILED — asked for a ${kind} and none appeared`)
          fixtureFailures += 1
        }
      }
    } else if (permit.why) {
      console.log(`  (fixtures not created — ${permit.why})`)
    }
  }

  paths = [...paths, ...detail.paths]
}

let failures = 0

for (const path of paths) {
  problems.length = 0
  let status = '?'
  try {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45_000 })
    status = String(res?.status() ?? '?')
  } catch (e) {
    status = 'NAV FAIL'
    problems.push(String(e).slice(0, 200))
  }
  await page.waitForTimeout(400)

  const url = new URL(page.url())
  const finalPath = url.pathname + url.search
  const text = await page.evaluate(() => document.body.innerText.trim()).catch(() => '')

  // The three ways a screen fails without failing loudly. A 200 means Next
  // served *something*, which includes the error boundary.
  const flags = []
  if (finalPath !== path) flags.push(`redirected -> ${finalPath}`)
  if (/something went wrong|application error|unhandled runtime/i.test(text)) {
    flags.push('ERROR BOUNDARY')
  }
  if (text.length < 20) flags.push(`near-empty body (${text.length} chars)`)

  if (flags.length || problems.length) failures += 1

  console.log(
    `${path.padEnd(20)} ${status.padEnd(8)} ${flags.join(', ') || 'rendered'}` +
      (problems.length ? `\n    ! ${problems.slice(0, 4).join('\n    ! ')}` : '')
  )
}

/**
 * Tapping a bottom tab is a *client-side* navigation, and nothing above walks
 * one — every route in the loop is a `goto`, which is a cold boot. That gap is
 * exactly where PD-111 lived: each tap re-read `my_onboarding_state()` from
 * `eu-west-1` behind the full-screen splash, and because the splash *replaced*
 * `children` rather than covering them, `(app)/layout.tsx` unmounted with it.
 * The bottom bar vanished and reappeared on every tap, which read as a reload.
 *
 * Three measurements, because the fix is only correct if all three hold:
 *
 *   1. **No `my_onboarding_state()` round trip per tap.** One per session, at
 *      boot. This is the fix itself — the stamps are immutable for a session's
 *      lifetime, so re-reading them bought nothing.
 *   2. **The Navbar node survives.** Identity, not presence: a remounted bar is
 *      a *different* node that looks identical, so this tags the original and
 *      checks the tag is still on the node that is there at the end.
 *   3. **The splash never paints.** Watched with a `MutationObserver` rather
 *      than a poll, because one frame of green is the whole complaint and a poll
 *      would miss it.
 *
 * The splash is matched on `bg-accent` + `inset-0` as well as its label, and
 * that is not belt-and-braces: `Skeleton.tsx`'s profile region is
 * `aria-label="Loading"` too — exactly, not by prefix; its three siblings are
 * `Loading postcards`, `Loading list` and `Loading form`, which a label match
 * would not catch. So the collision is one component, and one is enough: an
 * earlier pass of this check matched on the label alone and reported that
 * screen's ordinary `useQuery` skeleton as a guard splash, on `/profile`.
 *
 * Verified both ways before being committed, per CLAUDE.md's rule about a filter
 * that has quietly stopped matching: against the fix it reads 0/survived/0, and
 * against the code before it, 5 calls, 5 splash paints and a Navbar that did not
 * survive a single tap.
 */
const TAB_TAPS = ['/rides', '/clubs', '/profile', '/postcards', '/rides']

async function checkTabNavigation() {
  console.log('\nclient-side navigation (PD-111):')
  let bad = 0
  const report = (ok, label, detail) => {
    if (!ok) bad += 1
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (${detail})`}`)
  }

  let stampReads = 0
  const countStampReads = (r) => {
    if (r.url().includes('my_onboarding_state')) stampReads += 1
  }

  await page.goto(`${BASE}/postcards`, { waitUntil: 'networkidle' })
  await page.waitForSelector('nav', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(600)

  // The dev overlay's portal covers the viewport and swallows every click.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })

  await page.evaluate(() => {
    const nav = document.querySelector('nav')
    if (nav) nav.dataset.walkTag = 'original'
    window.__splashPaints = 0
    new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.addedNodes)
          if (
            n.nodeType === 1 &&
            n.getAttribute?.('aria-label') === 'Loading' &&
            n.className?.includes?.('bg-accent') &&
            n.className.includes('inset-0')
          )
            window.__splashPaints += 1
    }).observe(document.body, { childList: true, subtree: true })
  })

  // **Every failure here has to be counted, not swallowed.** The three
  // measurements below are all *absence* checks — no re-read, no remount, no
  // splash — and absence is exactly what a tap that never happened produces. A
  // `.catch(() => {})` on the click would turn a broken selector into a clean
  // pass, which is the one way this phase could report the bug fixed while it
  // was live. So the landing path is asserted per tap and counted.
  page.on('request', countStampReads)
  let navigated = 0
  for (const href of TAB_TAPS) {
    try {
      await page.click(`nav a[href="${href}"]`, { timeout: 10_000 })
      await page.waitForURL(`**${href}`, { timeout: 15_000 })
      if (new URL(page.url()).pathname === href) navigated += 1
    } catch (e) {
      console.log(`    ! tap ${href} did not navigate: ${String(e).split('\n')[0].slice(0, 120)}`)
    }
    await page.waitForTimeout(400)
  }
  page.off('request', countStampReads)

  const navSurvived = await page.evaluate(
    () => document.querySelector('nav')?.dataset.walkTag === 'original'
  )
  const splashPaints = await page.evaluate(() => window.__splashPaints)

  // First, because the other three mean nothing without it.
  report(
    navigated === TAB_TAPS.length,
    `all ${TAB_TAPS.length} taps navigated`,
    `only ${navigated} did — the checks below are vacuous`
  )
  report(stampReads === 0, `no stamp re-read across ${TAB_TAPS.length} taps`, `${stampReads} calls`)
  report(navSurvived, 'the shell stayed mounted', 'Navbar remounted')
  report(splashPaints === 0, 'the splash never painted', `${splashPaints} paints`)

  return bad
}

/** How many assertions `checkTabNavigation` makes, for the summary line. */
const TAB_NAV_CHECKS = 4

/**
 * Where the route guard actually sends a rider — run only on a full walk, since
 * a subset invocation is usually someone debugging one screen.
 *
 * This exists because the guard stopped being a server concern. `proxy.ts`
 * decided these redirects on the server, where a wrong answer showed up as an
 * HTTP 307 in the dev log; the client guard decides them after hydration, where
 * a wrong answer is a screen that looks fine and is the wrong screen. The pure
 * decision has 36 unit tests (`src/lib/auth/__tests__/guard.test.ts`) — what
 * those cannot cover is whether the *live* session read agrees with them, which
 * is exactly what this checks.
 *
 * The signed-out half runs in a throwaway context so it cannot see the session
 * the walk above established.
 */
const GUARD_CASES_SIGNED_IN = [
  ['/', '/postcards'],
  ['/auth/login', '/postcards'],
  ['/auth/signup', '/postcards'],
  ['/onboarding/username', '/postcards'],
  ['/onboarding/terms', '/postcards'],
  // Q1, and it broke recovery once: a recovery link establishes an ordinary
  // session before landing here, so a signed-in rider must NOT be bounced.
  ['/auth/reset-password', '/auth/reset-password'],
]

/** How many assertions `checkSignOut` makes, for the summary line. */
const SIGN_OUT_CHECKS = 4

const GUARD_CASES_SIGNED_OUT = [
  ['/', '/auth/login'],
  ['/postcards', '/auth/login'],
  ['/profile', '/auth/login'],
  ['/legal/terms', '/legal/terms'],
  ['/auth/reset-password', '/auth/reset-password'],
]

async function checkGuard(target, cases, label) {
  console.log(`\nroute guard, ${label}:`)
  let bad = 0
  for (const [from, expected] of cases) {
    await target.goto(`${BASE}${from}`, { waitUntil: 'networkidle' }).catch(() => {})
    // The guard decides in an effect, so the first paint is the splash. Settle
    // before reading, or every case reports the path it started on.
    await target.waitForTimeout(1200)
    const landed = new URL(target.url()).pathname
    const ok = landed === expected
    if (!ok) bad += 1
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${from.padEnd(22)} -> ${landed}${ok ? '' : `  (expected ${expected})`}`)
  }
  return bad
}

/**
 * Sign-out leaves nothing behind — tasks 4.5 and 4.6, the shared-device case.
 *
 * Unit tests cover `clearSessionStore` against a fake `window`; what they cannot
 * cover is whether the *real* client, the *real* GoTrue revocation and the query
 * cache all agree. This asks the only question that matters afterwards: is there
 * anything on this device the next rider could use or see.
 *
 * The cookie check is not ceremony. The session lived in a cookie until group 6,
 * and `@supabase/ssr` set it `httpOnly=false` — so a leftover one would be both
 * present and readable, and would still be *sent*, which is the one storage this
 * app no longer knows how to clear.
 */
async function checkSignOut() {
  console.log('\nsign-out leaves nothing behind:')
  let bad = 0
  const report = (ok, label, detail) => {
    if (!ok) bad += 1
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (${detail})`}`)
  }

  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.click('button[aria-label="Account options"]').catch(() => {})
  await page.waitForTimeout(300)
  await page.click('text=Sign out').catch(() => {})
  await page.waitForTimeout(2500)

  report(
    new URL(page.url()).pathname === '/auth/login',
    'lands on /auth/login',
    `landed on ${new URL(page.url()).pathname}`
  )

  const leftover = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('sb-'))
  )
  report(leftover.length === 0, 'no sb-* keys in localStorage', leftover.join(', '))

  const cookies = (await page.context().cookies()).map((c) => c.name).filter((n) => n.startsWith('sb-'))
  report(cookies.length === 0, 'no sb-* cookie', cookies.join(', '))

  // The real question behind 4.6: can the next rider reach a screen at all.
  await page.goto(`${BASE}/postcards`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  report(
    new URL(page.url()).pathname === '/auth/login',
    '/postcards is unreachable afterwards',
    `landed on ${new URL(page.url()).pathname}`
  )

  return bad
}

/**
 * A refused create must give the rider back what they filled in — the same
 * defect as the refused sign-in above, on the screen with the most to lose.
 *
 * **It is here rather than in Vitest because the control types differ in the
 * DOM, not in the data.** `src/lib/actions/__tests__/retain.test.ts` covers what
 * `retaining` records, which is a pure function over `FormData` and needs no
 * browser. What it cannot cover is whether React's post-action `form.reset()`
 * honours a *changed* `defaultValue` for each kind of control — `<input>`,
 * `<textarea>`, `<select>` and a checkbox take four different paths through
 * `updateInput`/`updateTextarea`/`updateOptions`, and a build where three of
 * them work is indistinguishable from a correct one until a rider meets the
 * fourth.
 *
 * **The submit cannot create a ride, at either layer.** `max_riders = 0` fails
 * `rideSchema`'s `.positive()` before any network call, and `018` bounds the
 * column at 1–999 in the database — so even a regression that dropped the
 * client parse could not turn this phase into a writer. That is why it runs on
 * every full walk rather than behind `WALK_FIXTURES`.
 *
 * The club `<select>` only exists when the rider belongs to a club, so its
 * assertion is counted only when it runs — `ran` rather than a fixed constant.
 * A silent skip would read as a pass on exactly the control type that is
 * hardest to get right.
 */
async function checkFormRetention() {
  let bad = 0
  let ran = 0
  const report = (ok, label, detail) => {
    ran += 1
    if (!ok) bad += 1
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (${detail})`}`)
  }

  console.log('\nrefused create keeps what was typed:')

  const filled = {
    title: 'Retention probe',
    description: 'Two lines\nof description',
    meeting_point: 'Kanaalweg 1',
    departure_at: '2027-03-14T09:15',
    route_description: 'Along the dyke, back over the bridge',
  }

  // **Every selector is scoped to the form.** A bare `[name="description"]`
  // matches `<meta name="description">` in the document head first, and
  // Playwright fills the first match — 30 seconds of waiting for a meta tag to
  // become editable, then an uncaught timeout that takes the whole walk with it.
  const field = (name) => `form [name="${name}"]`

  await page.goto(`${BASE}/rides/new`, { waitUntil: 'networkidle' })
  await page.waitForSelector(field('title'), { timeout: 20_000 })
  for (const [name, value] of Object.entries(filled)) {
    await page.fill(field(name), value)
  }
  // The refusal, and the reason nothing can be written — see above.
  await page.fill(field('max_riders'), '0')
  // Ticked by default, so unticking is what proves the restore reads the
  // submission rather than reinstating the literal default.
  //
  // **Clicked by its label, which is how a rider clears it too.** `<Checkbox>`
  // draws an `sr-only` input beneath a styled span, so Playwright refuses an
  // ordinary click as intercepted and a forced one lands on the span and
  // toggles nothing ("Clicking the checkbox did not change its state"). The
  // label is the control's real hit area — `htmlFor` does the toggling.
  await page.click('form label:has(input[name="is_public"])')
  // A precondition, not an assertion about the app: if the box did not clear,
  // everything below would be measuring the wrong submission.
  if (await page.isChecked(field('is_public'))) {
    throw new Error('could not clear the "public" checkbox — the harness, not the app')
  }

  const clubOption = await page
    .$eval(`${field('club_id')} option:nth-child(2)`, (o) => o.value)
    .catch(() => null)
  if (clubOption) await page.selectOption(field('club_id'), clubOption)

  await page.click('button[type="submit"]')
  // **Scoped to the form**, like `field()` above and for the same reason: there
  // are a dozen `role="status"` regions in `src/`, including the route guard's
  // splash and every skeleton. None carries text today, so a document-wide
  // query passes for the right reason — and would pass vacuously the day one
  // does, on the single assertion that proves the submit was refused at all.
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('form [role="status"]')].some(
          (n) => n.textContent.trim().length > 0
        ),
      null,
      { timeout: 20_000 }
    )
    .catch(() => {})

  const refusal = (
    await page.$$eval('form [role="status"]', (ns) =>
      ns.map((n) => n.textContent.trim()).filter(Boolean)
    )
  ).join(' | ')
  report(Boolean(refusal), 'the refusal is reported', 'no status text on screen')

  for (const [name, value] of Object.entries(filled)) {
    const actual = await page.inputValue(field(name)).catch(() => null)
    report(actual === value, `${name} survives it`, `read ${JSON.stringify(actual)}`)
  }

  const max = await page.inputValue(field('max_riders')).catch(() => null)
  report(max === '0', 'max_riders survives it', `read ${JSON.stringify(max)}`)

  const stillPublic = await page.isChecked(field('is_public')).catch(() => null)
  report(stillPublic === false, 'the cleared "public" box stays cleared', 'it was re-ticked')

  if (clubOption) {
    const club = await page.inputValue(field('club_id')).catch(() => null)
    report(club === clubOption, 'the chosen club survives it', `read ${JSON.stringify(club)}`)
  } else {
    console.log('  (no club — the club <select> is not rendered, so it was not exercised)')
  }

  return { bad, ran }
}

/**
 * `CreateClubForm` — PD-199 wired `retaining` on nine forms and this walk
 * asserted it on two (the phase above, and `checkEditRetention` below); this
 * is one of the seven that had nothing rendering it. PD-203.
 *
 * **One submit covers three different control types, which is why this form
 * rather than another of the seven.** `name` is a *controlled* input — it
 * needs no `retaining` entry at all, because component state already
 * survives the reset (`CreateClubForm`'s own comment says so) — so asserting
 * it here proves that claim rather than assuming it. `description` is an
 * uncontrolled textarea and `is_public` an uncontrolled checkbox, both named
 * in `retaining(createClub, ['description', 'is_public'])`. No other form in
 * this repo exercises a controlled text field, an uncontrolled textarea and
 * an uncontrolled checkbox in the same refusal.
 *
 * **The submit cannot create a club, at either layer that matters here.**
 * The form carries `noValidate`, so a whitespace-only `name` reaches
 * `createClub`'s action, and `clubSchema`'s `.trim().min(1)` refuses it
 * before any query runs. Unlike `rides.max_riders`, `clubs.name` has no
 * database CHECK behind it (`clubSchema`'s own header notes the gap), so this
 * client-side refusal is the *only* thing stopping the write — which is
 * exactly why losing it silently would matter.
 */
async function checkCreateClubRetention() {
  let bad = 0
  let ran = 0
  const report = (ok, label, detail) => {
    ran += 1
    if (!ok) bad += 1
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (${detail})`}`)
  }

  console.log('\nrefused club create keeps what was typed:')
  const field = (name) => `form [name="${name}"]`

  await page.goto(`${BASE}/clubs/new`, { waitUntil: 'networkidle' })
  await page.waitForSelector(field('name'), { timeout: 20_000 })

  const description = 'Two lines\nof description'
  await page.fill(field('name'), '   ')
  await page.fill(field('description'), description)
  // Public by default (`clubSchema`'s own note, and `001`'s column default) —
  // unticking is what proves the restore reads the submission rather than
  // reinstating the literal default, same reasoning as the ride phase.
  //
  // **Clicked by its label**, like the ride phase's checkbox: `<Checkbox>`
  // draws an `sr-only` input under a styled span, so a direct click is either
  // intercepted or lands on the span and toggles nothing.
  await page.click('form label:has(input[name="is_public"])')
  if (await page.isChecked(field('is_public'))) {
    throw new Error('could not clear the "public" checkbox — the harness, not the app')
  }

  await page.click('button[type="submit"]')
  // Scoped to the form, like the ride phase — see its comment on why a
  // document-wide `role="status"` query would pass for the wrong reason.
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('form [role="status"]')].some(
          (n) => n.textContent.trim().length > 0
        ),
      null,
      { timeout: 20_000 }
    )
    .catch(() => {})

  const refusal = (
    await page.$$eval('form [role="status"]', (ns) =>
      ns.map((n) => n.textContent.trim()).filter(Boolean)
    )
  ).join(' | ')
  report(Boolean(refusal), 'the refusal is reported', 'no status text on screen')

  const nameAfter = await page.inputValue(field('name')).catch(() => null)
  report(nameAfter === '   ', 'name (controlled) survives it', `read ${JSON.stringify(nameAfter)}`)

  const descriptionAfter = await page.inputValue(field('description')).catch(() => null)
  report(
    descriptionAfter === description,
    'description survives it',
    `read ${JSON.stringify(descriptionAfter)}`
  )

  const stillPublic = await page.isChecked(field('is_public')).catch(() => null)
  report(stillPublic === false, 'the cleared "public" box stays cleared', 'it was re-ticked')

  return { bad, ran }
}

/**
 * The edit forms, which fail the same way and cost more when they do.
 *
 * **The create form's fields are uncontrolled and these are controlled, which
 * is why this is a second phase rather than another path through the first.**
 * Controlled state survives the reset; the DOM does not, and React re-applies a
 * host element only when its props *change* — which they do not across a
 * refusal. So the box and the select silently disagree with the state behind
 * them.
 *
 * **That disagreement is data loss here, not a papercut.** `updateRide` and
 * `updateClub` build `club_id` and `is_public` from `FormData`, so the retry
 * the rider makes after fixing whatever was refused sends what the *reset* left
 * behind: a ride detached from its club, and a club made public again. Both
 * succeed, and neither says anything.
 *
 * Refused by `max_riders = 0` exactly as the create phase is, and unable to
 * write for the same two reasons.
 */
async function checkEditRetention(candidates) {
  let bad = 0
  let ran = 0
  const report = (ok, label, detail) => {
    ran += 1
    if (!ok) bad += 1
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (${detail})`}`)
  }

  console.log('\nrefused edit keeps the choices behind it:')
  const field = (name) => `form [name="${name}"]`
  // **`role="status"` only, never `role="alert"`.** Both edit forms draw a live
  // `role="alert"` the moment the public box is unticked — the ride's
  // "would strand" warning, the club's blast-radius note — so accepting either
  // made this phase report a refusal that had not happened, and every
  // assertion below then passed against a form nothing had submitted. The
  // action's own error is the `role="status"` one.

  // **The first candidate whose form actually renders.** `/rides/detail/edit`
  // and `/clubs/detail/edit` both answer 200 for a rider who does not own the
  // row — they draw a "not yours" message rather than 404ing (PD-101) — and the
  // walk discovers ids from lists that include other riders' rows. So a missing
  // `is_public` here means "not this rider's", not "the control is gone", and
  // waiting 20s for it to appear is how this phase first read as a harness
  // failure on a perfectly good build.
  let chosen = null
  for (const candidate of candidates) {
    await page.goto(`${BASE}${candidate.path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    if ((await page.isChecked(field('is_public')).catch(() => null)) !== null) {
      chosen = candidate
      break
    }
  }
  if (!chosen) {
    console.log('  (no ride or club this rider owns — not exercised)')
    return { bad, ran }
  }
  console.log(`  (on ${chosen.label})`)

  const clubBefore = await page.inputValue(field('club_id')).catch(() => null)
  const publicBefore = await page.isChecked(field('is_public'))

  // Flip the checkbox, so what is asserted is the rider's change rather than
  // whatever the ride already was.
  await page.click('form label:has(input[name="is_public"])')
  const publicWanted = !publicBefore

  // **The refusal is whitespace, and the reason is worth keeping.** The create
  // form carries `noValidate`, so `max_riders = 0` reaches its action; neither
  // edit form does, so the browser's own constraint validation blocks an
  // out-of-range number, no action runs, no reset happens — and every
  // assertion below then passes without exercising anything. The refusal
  // assertion is what caught that.
  //
  // A whitespace-only required field satisfies HTML `required` (it checks for a
  // non-empty string) and is refused by `.trim().min(1)` in both `rideSchema`
  // and `clubSchema`, before either action issues a query. Nothing can be
  // written at any layer.
  await page.fill(field(chosen.refuse), '   ')
  await page.click('button[type="submit"]')
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('form [role="status"]')].some(
          (n) => n.textContent.trim().length > 0
        ),
      null,
      { timeout: 20_000 }
    )
    .catch(() => {})

  const refusal = (
    await page.$$eval('form [role="status"]', (ns) =>
      ns.map((n) => n.textContent.trim()).filter(Boolean)
    )
  ).join(' | ')
  report(Boolean(refusal), 'the refusal is reported', 'no status text on screen')

  if (clubBefore !== null) {
    const clubAfter = await page.inputValue(field('club_id')).catch(() => null)
    report(
      clubAfter === clubBefore,
      'the club is still selected',
      `was ${JSON.stringify(clubBefore)}, read ${JSON.stringify(clubAfter)} — the next save would send this`
    )
  } else {
    console.log('  (this form has no club <select>, so it was not exercised)')
  }

  const publicAfter = await page.isChecked(field('is_public')).catch(() => null)
  report(
    publicAfter === publicWanted,
    'the flipped "public" box keeps the rider’s answer',
    `wanted ${publicWanted}, read ${publicAfter} — the next save would send this`
  )

  return { bad, ran }
}

/**
 * `EditProfileForm` — the ninth form `retaining` was wired on, and the only
 * one of the nine where `defaultValue` falls back to a *stored* value rather
 * than an empty string: `state.retained.location ?? profile.location ?? ''`.
 * Every create form starts blank, and the ride/club edit forms above are
 * controlled rather than `retaining`-backed, so this is the one place that
 * `??` chain runs at all. PD-203.
 *
 * **The first assertion is the `??` chain's read of the stored value, before
 * anything is submitted** — `state.retained.location` is `{}` on first
 * render, so a non-empty field on load can only have come from `profile`.
 * The walk account is fully onboarded, and `023`'s completion trigger refuses
 * the onboarding stamp while `location` is NULL, so a non-empty value here is
 * guaranteed rather than assumed for this account.
 *
 * **The error region is `role="alert"` (`FormError`), not `role="status"`
 * like the ride/club forms above** — this form draws no live alert while
 * typing, unlike the ones with a public/private checkbox, so there is no
 * false-positive trap to guard against and alert text is safe to wait on
 * directly.
 *
 * Refused the same way as the create phase: `noValidate` lets a
 * whitespace-only `location` reach `updateProfile`, and `profileEditSchema`'s
 * `.trim().min(1)` refuses it before any query runs.
 */
async function checkEditProfileRetention() {
  let bad = 0
  let ran = 0
  const report = (ok, label, detail) => {
    ran += 1
    if (!ok) bad += 1
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (${detail})`}`)
  }

  console.log('\nrefused profile edit keeps what was typed:')
  const field = (name) => `form [name="${name}"]`

  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
  await page.waitForSelector(field('location'), { timeout: 20_000 })

  const initialLocation = await page.inputValue(field('location')).catch(() => null)
  report(
    Boolean(initialLocation && initialLocation.trim().length > 0),
    'location loads from the stored profile (the `??` fallback)',
    `read ${JSON.stringify(initialLocation)}`
  )

  const bikeModel = `Walk probe bike ${Date.now()}`
  await page.fill(field('location'), '   ')
  await page.fill(field('bike_model'), bikeModel)

  await page.click('button[type="submit"]')
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('form [role="alert"]')].some(
          (n) => n.textContent.trim().length > 0
        ),
      null,
      { timeout: 20_000 }
    )
    .catch(() => {})

  const refusal = (
    await page.$$eval('form [role="alert"]', (ns) =>
      ns.map((n) => n.textContent.trim()).filter(Boolean)
    )
  ).join(' | ')
  report(Boolean(refusal), 'the refusal is reported', 'no alert text on screen')

  const locationAfter = await page.inputValue(field('location')).catch(() => null)
  report(locationAfter === '   ', 'location survives it', `read ${JSON.stringify(locationAfter)}`)

  const bikeAfter = await page.inputValue(field('bike_model')).catch(() => null)
  report(bikeAfter === bikeModel, 'bike_model survives it', `read ${JSON.stringify(bikeAfter)}`)

  return { bad, ran }
}

let guardFailures = 0
let retentionRan = 0
if (isFullWalk) {
  // A phase that throws must fail, not abort — an uncaught Playwright timeout
  // here takes the guard and sign-out phases down with it and reports nothing
  // at all, which reads as a harness problem rather than as this phase's
  // verdict.
  const retention = await checkFormRetention().catch((e) => {
    console.log(`  FAIL the phase threw  (${String(e).split('\n')[0]})`)
    return { bad: 1, ran: 1 }
  })
  guardFailures += retention.bad
  retentionRan = retention.ran

  const clubRetention = await checkCreateClubRetention().catch((e) => {
    console.log(`  FAIL the phase threw  (${String(e).split('\n')[0]})`)
    return { bad: 1, ran: 1 }
  })
  guardFailures += clubRetention.bad
  retentionRan += clubRetention.ran

  // Discovered, like the screens above — with no ride to edit there is no form,
  // and the phase says so rather than passing on an empty page.
  const discovered = await discoverDetailPaths({ quiet: true })
  const editCandidates = [
    ...(discovered.ride
      ? [
          {
            path: `/rides/detail/edit?id=${discovered.ride}`,
            label: 'the ride edit form',
            refuse: 'title',
          },
        ]
      : []),
    ...(discovered.club
      ? [
          {
            path: `/clubs/detail/edit?id=${discovered.club}`,
            label: 'the club edit form',
            refuse: 'name',
          },
        ]
      : []),
  ]
  const edit = await checkEditRetention(editCandidates).catch((e) => {
    console.log(`  FAIL the phase threw  (${String(e).split('\n')[0]})`)
    return { bad: 1, ran: 1 }
  })
  guardFailures += edit.bad
  retentionRan += edit.ran

  const profileRetention = await checkEditProfileRetention().catch((e) => {
    console.log(`  FAIL the phase threw  (${String(e).split('\n')[0]})`)
    return { bad: 1, ran: 1 }
  })
  guardFailures += profileRetention.bad
  retentionRan += profileRetention.ran

  // Before the guard cases, which end on /auth/reset-password, and well before
  // `checkSignOut` takes the session away.
  guardFailures += await checkTabNavigation()

  guardFailures += await checkGuard(page, GUARD_CASES_SIGNED_IN, 'signed in')

  guardFailures += await checkSignOut()

  const anonContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const anonPage = await anonContext.newPage()
  guardFailures += await checkGuard(anonPage, GUARD_CASES_SIGNED_OUT, 'signed out')
  await anonContext.close()
}

await browser.close()

console.log(`\n${paths.length - failures}/${paths.length} screens rendered clean`)
if (realtimeSuppressed) {
  // Named rather than swallowed: this run proved the chat renders and sends,
  // and proved nothing about live delivery. See isRelayWebSocketFailure.
  console.log(
    `  (Realtime NOT exercised — ${realtimeSuppressed} relay WebSocket failure(s) suppressed; ` +
      'the relay does not proxy the upgrade)'
  )
}
if (isFullWalk) {
  const total =
    GUARD_CASES_SIGNED_IN.length +
    GUARD_CASES_SIGNED_OUT.length +
    SIGN_OUT_CHECKS +
    TAB_NAV_CHECKS +
    REFUSED_SIGN_IN_CHECKS +
    REFUSED_SIGNUP_CHECKS +
    // Counted from what ran, not from a constant: the club `<select>` exists
    // only for a rider in a club, and the ride/club edit phase runs only for
    // a rider who owns one. See checkFormRetention and checkEditRetention.
    retentionRan
  const bad = guardFailures + refusedSignInFailures + refusedSignupFailures
  console.log(`${total - bad}/${total} guard, navigation and sign-out checks correct`)
}
process.exit(
  failures || guardFailures || refusedSignInFailures || refusedSignupFailures || fixtureFailures ? 1 : 0
)
