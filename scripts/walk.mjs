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
 * "until a flow is stable enough to be worth maintaining", and that still holds:
 * there are no assertions about behaviour here, only about whether a screen
 * rendered at all. It asks one question per route — did this come back as a
 * screen, or as a redirect, an error boundary, or an empty body.
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
 * Pass paths as arguments to walk a subset — that skips the guard and sign-out
 * phases, which need the full run.
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
 * logs a failed WebSocket on every load of `/rides/[id]/chat`. Left unfiltered
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

  const firstHref = async (listPath, pattern) => {
    await page.goto(`${BASE}${listPath}`, { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(800)
    return page.evaluate(
      (p) =>
        [...document.querySelectorAll('a[href]')]
          .map((a) => new URL(a.href, location.origin).pathname)
          .find((href) => new RegExp(p).test(href)) ?? null,
      pattern
    )
  }

  const ride = await firstHref('/rides', '^/rides/[0-9a-f-]{36}$')
  if (!ride) say('  (no rides to open — /rides/[id] and its crew unwalked)')

  const club = await firstHref('/clubs', '^/clubs/[0-9a-f-]{36}$')
  if (!club) say('  (no clubs to open — /clubs/[id] and its sub-pages unwalked)')

  const postcard = await firstHref('/postcards', '^/postcards/[0-9a-f-]{36}$')
  if (!postcard) say('  (no postcard thread link — /postcards/[id] unwalked)')

  const paths = [
    // `edit` (PD-101) renders even for a rider who is not the organizer/owner
    // — it draws the "not yours" message rather than 404ing — but the walk's
    // fixtures are created through the UI by this same signed-in account, so
    // in the common case it is the real form that gets exercised.
    ...(ride ? [ride, `${ride}/crew`, `${ride}/chat`, `${ride}/edit`] : []),
    ...(club
      ? [club, `${club}/rides`, `${club}/members`, `${club}/about`, `${club}/edit`]
      : []),
    ...(postcard ? [postcard] : []),
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

let guardFailures = 0
if (isFullWalk) {
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
    TAB_NAV_CHECKS
  console.log(`${total - guardFailures}/${total} guard, navigation and sign-out checks correct`)
}
process.exit(failures || guardFailures || fixtureFailures ? 1 : 0)
