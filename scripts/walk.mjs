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
 * screen, or as a redirect, an error boundary, a failed read left in place, or
 * an empty body — and nothing about what the screen then does.
 *
 * The named phases are the exception — refused sign-in before the real sign-in,
 * refused signup right after it (it needs the session it establishes — see
 * `runRefusedSignup`), and refused ride create, refused club create, refused
 * ride or club edit, refused profile edit, client-side navigation, the route
 * guard and sign-out after that. They are named individually rather than
 * covered by a general claim: each exists because a specific defect is
 * invisible to every other gate in this repo, and each asserts exactly that
 * one behaviour. Adding a phase means adding a reason, not broadening a remit
 * — PD-203 added three (club create, profile edit, signup) because
 * `retaining` (PD-199) was wired on nine forms and only two were rendered by
 * anything; the other two of the nine (`/auth/forgot-password`,
 * `CreatePostcardForm`) are recorded as deliberately unexercised where
 * `checkRefusedSignup` is defined below, rather than covered here.
 *
 * ## Running it, and the one thing that will otherwise waste an hour
 *
 *   NODE_USE_ENV_PROXY=1 RELAY_UPSTREAM=https://<dev ref>.supabase.co \
 *     node scripts/supabase-relay.mjs &
 *   NEXT_PUBLIC_SUPABASE_URL=http://localhost:3001 NODE_USE_ENV_PROXY=1 npm run dev
 *   npm run walk                                    # mints its own account, walks, tears down
 *   WALK_EMAIL=... WALK_PASSWORD=... npm run walk   # a KNOWN account instead — see below
 *
 *   # ...and to provision the rows the detail routes need, on an empty DEV:
 *   WALK_FIXTURES=1 RELAY_UPSTREAM=https://<dev ref>.supabase.co npm run walk
 *
 * **Point it at DEV.** This walk signs in, and with `WALK_FIXTURES=1` it posts
 * as a real rider — against `letsride` that means fixture rides in real riders'
 * feeds. docs/HANDOFF.md's recipe named PROD's ref until 2026-08-07, so this is
 * a mistake the documentation actively invited. `fixturesPermitted()` refuses
 * the ride/club/postcard writes, establishing the project from the **session
 * the browser is holding** rather than from `RELAY_UPSTREAM` — see
 * `authenticatedProjectRef()` for why the env-var version of that check was
 * worth nothing.
 *
 * **Minting an account is gated separately, and earlier, because it is a
 * write with no session to check yet.** `fixturesPermitted()` cannot be what
 * refuses it — a fixture write happens with a session already established,
 * and `signUp` does not. `preflightMintRef()` reads the real request the
 * browser makes before anything is submitted, and `refWritable(await
 * authenticatedProjectRef(), …)` reads it again once a session exists — see
 * both functions' own headers for why one check is not enough on its own.
 *
 * **The account needs no stored password, and PD-268 is what makes that true
 * of the CODE rather than only of this paragraph.** DEV has
 * `mailer_autoconfirm: true`, so a signup returns a session with no
 * confirmation step. Absent `WALK_EMAIL`/`WALK_PASSWORD` this file mints one
 * itself — through `/auth/signup` and `/onboarding/username`, the app's own
 * forms, exactly as `provision()` below drives `/rides/new` and `/clubs/new` —
 * walks with it, and attempts to delete it afterwards as a **non-fatal**
 * teardown (`attemptDeleteAccount`): an Edge Function outage on `delete-account`
 * must not turn an unrelated render check red, and this is the only exercise
 * that flow gets outside a rider's own hand. `WALK_EMAIL`/`WALK_PASSWORD` are
 * for a KNOWN account instead — the `WALK_FIXTURES` recipe below depends on
 * reusing the same one run over run, and reproducing a rider-specific bug
 * needs a real account rather than a fresh one — and a supplied account is
 * NEVER deleted, on any code path: `MINTED` is false the instant `WALK_EMAIL`
 * is set, and only `MINTED` gates the teardown.
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

// PD-268: a lone one is almost certainly a typo (a mistyped env var name),
// never an instruction to mint — so it is refused rather than silently
// treated as "mint a fresh account and ignore the other value".
if (Boolean(process.env.WALK_EMAIL) !== Boolean(process.env.WALK_PASSWORD)) {
  console.error(
    'Set both WALK_EMAIL and WALK_PASSWORD for a known account, or neither to mint a\n' +
      'fresh one — see docs/reference/running-locally.md §The walk.'
  )
  process.exit(2)
}

/** True only when this run is minting its own account — see the header. */
const MINTED = !process.env.WALK_EMAIL

/**
 * Unique per run and inside the username charset (`^[A-Za-z0-9_]{3,25}$`,
 * `USERNAME_MIN_LENGTH`/`USERNAME_MAX_LENGTH`) without needing to check either
 * bound — `Date.now().toString(36)` is 8 characters for a decade either side
 * of today and the 4-character suffix makes two runs in the same millisecond
 * distinguishable.
 */
const MINT_SUFFIX = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// `@letsride.dev` — `supabase/seeds/development.sql` refuses to run while any
// account outside that domain exists, so a walk account on any other domain
// quietly blocks the seed (docs/reference/running-locally.md §The walk).
let EMAIL = process.env.WALK_EMAIL ?? `walk-${MINT_SUFFIX}@letsride.dev`
// Well past `NEW_PASSWORD_MIN_LENGTH` (8) and never read back — nothing
// stores this once the run using it ends, which is the whole point of
// minting rather than asking for a password to remember.
let PASSWORD = process.env.WALK_PASSWORD ?? `Walk-mint-${MINT_SUFFIX}-Aa1`
const MINT_USERNAME = `walk_${MINT_SUFFIX}`.slice(0, 25)
// Real, not a placeholder — `checkEditProfileRetention`'s first assertion
// (the `??` fallback to the *stored* profile value) needs a genuine saved
// location to load, and this is the value the walk's own docs already use
// for the long-lived account.
const MINT_LOCATION = 'Amsterdam'

/**
 * Every authenticated route. Detail routes are discovered at run time rather
 * than hardcoded, because an id that has been deleted turns a real failure into
 * a 404 nobody investigates.
 */
const STATIC_PATHS = [
  '/postcards',
  '/postcards/new',
  '/rides',
  '/rides/explore',
  '/rides/new',
  '/clubs',
  '/clubs/explore',
  '/clubs/new',
  '/profile',
  // Added 2026-09-01, with a reason rather than to broaden the sweep: this
  // screen renders an EXHAUSTIVE SWITCH over `notifications.type` in two places
  // (`copy.ts` and `NotificationsListItem`'s `describe`), and it was the only
  // route in the app the walk could not see. `098` took that switch from
  // fourteen arms to sixteen; a missing arm degrades to
  // `did something on LetsRide.` — deliberately, per PD-335 — which is exactly
  // the kind of silent wrongness no other gate here catches, `tsc` being happy
  // with a `default` branch and the component tests rendering a fixture rather
  // than a real row. It renders for a rider with no notifications too, so it
  // costs nothing on an empty account.
  '/notifications',
]

/**
 * The projects this walk may write to. **An allowlist, so an unrecognised
 * project fails closed** — a denylist of PROD's ref would wave through a
 * second production project the day one exists.
 *
 * Declared this early because `runRefusedSignup` (below) needs it before the
 * fixtures section that used to be its only reader — see that function for
 * why.
 */
const WRITABLE_REFS = new Set(['fpmrimzxadewsaiwpsel']) // Letsride-dev

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

/**
 * The Supabase host the running app is actually configured to hit —
 * `*.supabase.co` only, read off a real request the BROWSER issues, never
 * from anything this walk process's own environment claims. That distinction
 * is not decoration: `authenticatedProjectRef()` exists because an earlier
 * version of the project-ref gate read `RELAY_UPSTREAM` from this process's
 * own env and review correctly called it theatre — that variable configures
 * a *sibling* process and proves nothing about what the browser was built
 * against. A request the page itself sent is not theatre.
 *
 * Stays `null` when every observed request goes through
 * `scripts/supabase-relay.mjs` (`localhost`, per the sanctioned way to run in
 * this container) — the relay hides the real project from the browser's own
 * configuration by design, so there is nothing to read here in that case, and
 * `preflightMintRef` below deliberately does not treat that as a refusal. It
 * is treated as one exactly where it needs to be: going DIRECT with no relay
 * override, which is the misconfiguration PD-268's review found — a `.env.local`
 * pointed at PROD, or `npm run dev` with no `RELAY_UPSTREAM`, sends its first
 * request straight to `https://<ref>.supabase.co` and this is what catches it
 * before `mintWalkAccount` ever submits a form.
 */
let observedSupabaseRef = null
page.on('request', (r) => {
  if (observedSupabaseRef !== null) return
  try {
    const match = new URL(r.url()).hostname.match(/^([a-z0-9]+)\.supabase\.co$/)
    if (match) observedSupabaseRef = match[1]
  } catch {
    // Not a URL worth caring about.
  }
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
 * and where this walk always runs, per docs/reference/running-locally.md §The walk). With
 * confirmation ON (PROD) GoTrue's own duplicate-signup mitigation returns
 * **success** with an empty `identities` array instead, so `signUp` never
 * reaches this branch at all there — see the comment above the
 * `alreadyRegistered` check in `src/lib/actions/auth.ts`. A green run here is
 * DEV-only coverage; it says nothing about PROD's configuration of this path.
 *
 * **Runs against `targetPage`, not the module-level `page`** — see
 * `runRefusedSignup` for why it is a throwaway signed-out context rather than
 * the browser this file drives everywhere else.
 */
async function checkRefusedSignup(targetPage) {
  let bad = 0
  let ran = 0
  const report = (ok, label, detail) => {
    ran += 1
    if (!ok) bad += 1
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (${detail})`}`)
  }

  console.log('\nrefused signup (already registered):')

  await targetPage.goto(`${BASE}/auth/signup`, { waitUntil: 'domcontentloaded' })
  await targetPage.waitForSelector('input[name="email"]')
  await targetPage.fill('input[name="email"]', EMAIL)
  await targetPage.fill('input[name="password"]', SIGNUP_PROBE_PASSWORD)
  // Controlled, and the submit stays disabled until it is ticked — Q9's own
  // note that a disabled button is not a trust boundary is about the server
  // side, but Playwright still has to get past the button being unclickable.
  await targetPage.click('label:has(input[name="acceptedTerms"])')
  await targetPage.click('button[type="submit"]')

  await targetPage
    .waitForFunction(
      () =>
        [...document.querySelectorAll('[role="alert"]')].some((n) => n.textContent.trim().length),
      null,
      { timeout: 20_000 }
    )
    .catch(() => {})

  const refusal = (
    await targetPage.$$eval('[role="alert"]', (ns) =>
      ns.map((n) => n.textContent.trim()).filter(Boolean)
    )
  ).join(' | ')
  report(Boolean(refusal), 'the refusal is reported', 'no alert text on screen')
  report(
    (await targetPage.inputValue('input[name="email"]')) === EMAIL,
    'the email survives it',
    'the field was cleared'
  )
  report(
    (await targetPage.inputValue('input[name="password"]')) === SIGNUP_PROBE_PASSWORD,
    'the password survives it',
    'the field was cleared'
  )
  // PD-214. The two fields above are uncontrolled and restore through
  // `retaining`; this box is controlled, so it restores through
  // `useRestoreChecked` — a different mechanism, and it was the one control on
  // this form with neither.
  //
  // `$eval` rather than `isChecked()` is a plain preference, not a workaround:
  // both resolve here, and `sr-only` is not the reason to avoid either — the
  // `checkEditRetention` note near `state: 'attached'` below measured that
  // `isChecked` resolves on this exact `peer sr-only` input, and three green
  // assertions in that phase read one today.
  report(
    await targetPage.$eval('input[name="acceptedTerms"]', (n) => n.checked),
    'the consent box survives it',
    // Not "with nothing on screen saying why": `signUpSchema` reports issues in
    // key order and email/password are valid by this point, so the retry's
    // `FormError` reads "Accept the terms to continue." The cost is a cleared
    // consent and an extra round trip, not an invisible blocker.
    'the box reverted to unticked, so the rider must re-tick a box they never cleared'
  )

  return { bad, ran }
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
 *   `onload`/`onerror` (docs/reference/running-locally.md §The walk).
 */

/**
 * Gates `checkRefusedSignup` behind the same project-ref allowlist
 * `fixturesPermitted()` gates fixture writes behind — review finding on
 * PD-203's first pass.
 *
 * **Unlike `checkFormRetention`'s ride** (a whitespace-only `meeting_point`,
 * refused by both `rideSchema`'s `.trim().min(1)` and `018`'s CHECK, so it
 * cannot write at either layer and needs no gate), nothing makes `signUp`'s refusal
 * unconditional. "The walk's own address is already registered" is a fact
 * about the environment this session measured, not a schema or database
 * guarantee — so pointed at a project where that address is *not*
 * registered, this phase would create a real account; pointed at a project
 * with confirmation ON (PROD), it would hit GoTrue's duplicate-signup
 * mitigation, which **emails the real address owner**.
 *
 * `authenticatedProjectRef()` needs a live session to read `iss` from, which
 * is why this cannot run where `checkRefusedSignup` used to — beside
 * `checkRefusedSignIn`, before the walk has signed in to anything. It runs
 * here instead, right after the real sign-in below establishes one, and in a
 * **throwaway signed-out context** rather than on the now-authenticated
 * `page` — `/auth/signup` redirects a signed-in rider to `/postcards`
 * (`GUARD_CASES_SIGNED_IN`), so the phase would never reach the form on
 * `page` itself, and the phase is supposed to be probing an anonymous
 * rider's browser in the first place.
 *
 * **Calls `refWritable` rather than re-testing `ref` inline** — the
 * allowlist check itself has to live in exactly one place (`fixturesPermitted`
 * below is the other caller), or a session tightening the rule later (a
 * confirmation-ON project must never be writable, say) does it there and
 * this write silently keeps the old, looser one.
 */
async function runRefusedSignup() {
  const permit = refWritable(await authenticatedProjectRef(), 'sign up')
  if (!permit.ok) {
    console.log(`\n(refused-signup phase skipped — ${permit.why})`)
    return { bad: 0, ran: 0 }
  }

  const signupContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const signupPage = await signupContext.newPage()
  try {
    return await checkRefusedSignup(signupPage)
  } finally {
    await signupContext.close()
  }
}

/**
 * Deletes the currently signed-in account through the app's own UI — PD-268.
 * Never through the Edge Function directly: the point, same as `provision()`
 * below, is to exercise the flow a rider actually has (`ProfileMenu` ->
 * `DeleteAccountSheet`), not merely to remove the row. Returns rather than
 * throws, because both callers treat a failure as informational — an outage
 * on `delete-account` must never fail the walk itself (see the header).
 */
async function attemptDeleteAccount(password) {
  try {
    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
    await page.click('button[aria-label="Account options"]', { timeout: 10_000 })
    await page.waitForTimeout(300)
    await page.click('[aria-label="Account options"] button:has-text("Delete account")', {
      timeout: 10_000,
    })
    await page.waitForSelector('[aria-label="Delete account"] input[name="password"]', {
      timeout: 10_000,
    })
    await page.fill('[aria-label="Delete account"] input[name="password"]', password)
    await page.click('[aria-label="Delete account"] button[type="submit"]')
    await page.waitForURL((u) => u.pathname === '/auth/login', { timeout: 20_000 })
    return { ok: true }
  } catch (e) {
    return { ok: false, why: String(e).split('\n')[0] }
  }
}

/**
 * `attemptDeleteAccount`, but from wherever the run currently is — signing
 * back in first if the current context does not hold a session at all.
 *
 * Two callers need exactly this: the ordinary end-of-run teardown (`page` may
 * already be signed out — a full walk's `checkSignOut` clears it, a subset
 * invocation may still be signed in) and `mintWalkAccount`'s own top-level
 * `catch` (an exception can land with the session in any state). Kept as one
 * function rather than two copies of the sign-back-in dance, which is exactly
 * the kind of drift CLAUDE.md calls out repeatedly elsewhere in this repo.
 */
async function deleteMintedAccountBestEffort() {
  if (!(await authenticatedProjectRef())) {
    await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.fill('input[name="email"]', EMAIL).catch(() => {})
    await page.fill('input[name="password"]', PASSWORD).catch(() => {})
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 30_000 }).catch(() => {}),
      page.click('button[type="submit"]').catch(() => {}),
    ])
    await page.waitForTimeout(1000)
  }
  return attemptDeleteAccount(PASSWORD)
}

/**
 * The project-ref gate `mintWalkAccount` runs BEFORE it submits anything —
 * review finding on PD-268's first pass: the previous version only checked
 * `refWritable` *after* `signUp` had already created a real row, and with
 * `mailer_autoconfirm: false` (PROD's own configuration) `signUp` returns no
 * session at all, so the post-session check never even runs. A `.env.local`
 * pointed at PROD, or `npm run dev` with no relay override, minted a real,
 * unconfirmed `auth.users` row on `letsride` with no check and no cleanup.
 *
 * Calls `refWritable` — the one place the allowlist itself lives — exactly
 * as `fixturesPermitted` and the post-session check further down do; a
 * fourth inline `ref !== 'fpmrimzxadewsaiwpsel'` here would be a second copy
 * of the rule for the next session to find drifted.
 *
 * `{ ok: true, quiet: true }` when `observedSupabaseRef` is still `null` —
 * every request so far went through the relay, which hides the real project
 * from the browser's own configuration by design (see that variable's own
 * comment). This is not a hole: it is exactly why the post-session
 * `authenticatedProjectRef()` check stays in place below, reading the true
 * project off a signed JWT the relay cannot rewrite.
 */
function preflightMintRef() {
  if (observedSupabaseRef === null) return { ok: true, quiet: true }
  return refWritable(observedSupabaseRef, 'mint an account')
}

/**
 * Mints a fresh, fully-onboarded DEV rider through the app's own forms —
 * PD-268. **Through `/auth/signup` and `/onboarding/username`, never GoTrue
 * directly** — PD-91 is the precedent for getting this wrong: a fixture
 * script that called `/auth/v1/signup` never ran `signUp` at all, so it
 * proved nothing about the form PD-196 and PD-203 exist to guard. This is a
 * walk, not a seed script.
 *
 * **Gated before the first write, not only after it.** `preflightMintRef()`
 * runs before anything is submitted — see its own header for why the
 * post-session check alone was not enough: with `mailer_autoconfirm: false`
 * (PROD's configuration), `signUp` returns no session at all, so a check that
 * only ran afterward never ran. `refWritable(await authenticatedProjectRef(),
 * …)` still runs once a session exists, as a second, independent read of the
 * same fact from a different source — the two are expected to agree, and a
 * disagreement between them is itself worth failing loudly on rather than
 * picking one silently.
 */
async function mintWalkAccount() {
  console.log(`\nminting a DEV account (no WALK_EMAIL set): ${EMAIL}`)

  const preflight = preflightMintRef()
  if (!preflight.ok) {
    console.error(`\nMinting refused before creating anything — ${preflight.why}.`)
    console.error('No account was created; nothing to clean up.')
    await browser.close()
    process.exit(1)
  }

  await page.goto(`${BASE}/auth/signup`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[name="email"]')
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="password"]', PASSWORD)
  await page.click('label:has(input[name="acceptedTerms"])')
  await Promise.all([
    page.waitForURL((u) => u.pathname !== '/auth/signup', { timeout: 20_000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(1000)

  if (await page.$('text=Check your email')) {
    // **This is what a direct connection to PROD looks like, not DEV being
    // briefly slow.** `mailer_autoconfirm: false` — PROD's own configuration
    // — is the only way `signUp` returns no session, and the pre-flight
    // above is what should have caught that before this ever ran; landing
    // here means it could not (every request so far went through the relay,
    // per its own comment, so the real project stayed hidden from it). A row
    // now exists in `auth.users` for `${EMAIL}` with no session ever
    // established, so there is nothing this script can sign in as to delete
    // it — say so plainly rather than let a silent orphan sit on whichever
    // project this was.
    console.error(
      `\nMinting failed: signUp returned no session for ${EMAIL} — this is what ` +
        'confirmation being ON looks like, which is PROD\'s configuration, not DEV\'s ' +
        '(decision #6). If this ran against DEV, mailer_autoconfirm has changed; ' +
        'more likely this ran with no relay override, or `.env.local`/`NEXT_PUBLIC_SUPABASE_URL` ' +
        'points at PROD directly.\n' +
        `An unconfirmed auth.users row for ${EMAIL} now exists on whichever project this ` +
        'was and was NOT removed — there is no session to delete it with. Remove it by ' +
        'hand, and pass WALK_EMAIL/WALK_PASSWORD for an existing, already-confirmed ' +
        'account instead of minting until the target is confirmed to be DEV.'
    )
    await browser.close()
    process.exit(1)
  }

  if (new URL(page.url()).pathname !== '/onboarding/username') {
    // A session exists here (past `signUp`) but onboarding is not complete,
    // so the guard refuses `/profile` and `attemptDeleteAccount` has nowhere
    // to go — deletion is genuinely unreachable, not merely skipped. Say so
    // rather than exit quietly: this leaves a real, signed-up-but-unfinished
    // `${EMAIL}` behind on whichever project this ran against.
    console.error(
      `\nMinting failed: expected /onboarding/username, landed on ${page.url()}.\n` +
        `${EMAIL} was created and left behind — onboarding did not finish, so /profile ` +
        'is unreachable and this script has no way to delete it. Remove it by hand.'
    )
    await browser.close()
    process.exit(1)
  }

  // The one write a signed-in-but-not-yet-onboarded rider can make, gated the
  // same way `provision()`'s fixture writes are and through the same
  // function, so a rule change binds both. This is the second, independent
  // read of the project — `preflightMintRef()` above is the first — and the
  // two are expected to agree; if they do not, something is wrong with the
  // gate itself and is worth knowing about before trusting either again.
  const permit = refWritable(await authenticatedProjectRef(), 'mint an account')
  if (!permit.ok) {
    console.error(`\nMinting refused after the fact — ${permit.why}.`)
    console.error('Finishing onboarding, deleting the account just created, then aborting.')
    await page.fill('input[name="username"]', MINT_USERNAME)
    await page.click('button[type="submit"]')
    await page.waitForTimeout(1500)
    const cleanup = await attemptDeleteAccount(PASSWORD)
    if (cleanup.ok) {
      console.error(`${EMAIL} deleted.`)
    } else {
      console.error(`Could not clean up the wrongly-minted account — ${cleanup.why}`)
    }
    await browser.close()
    process.exit(1)
  }

  await page.fill('input[name="username"]', MINT_USERNAME)
  await Promise.all([
    page
      .waitForURL((u) => u.pathname !== '/onboarding/username', { timeout: 20_000 })
      .catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(1000)

  if (new URL(page.url()).pathname !== '/postcards') {
    // `setUsername` commits `username` and `onboarding_completed_at` in the
    // same call (see its own header), so a submit that reached this point is
    // fully onboarded regardless of where the browser actually landed —
    // `/profile` is reachable and `attemptDeleteAccount` is exactly what
    // `permit.ok === false` above already does for the wrong-project case.
    console.error(`\nMinting failed: expected /postcards after onboarding, landed on ${page.url()}.`)
    console.error(`${EMAIL} is fully onboarded; deleting it before aborting.`)
    const cleanup = await attemptDeleteAccount(PASSWORD)
    if (cleanup.ok) {
      console.error(`${EMAIL} deleted.`)
    } else {
      console.error(`Could not clean up ${EMAIL} — ${cleanup.why}. Remove it by hand.`)
    }
    await browser.close()
    process.exit(1)
  }

  console.log(`  minted ${EMAIL} — username ${MINT_USERNAME}, onboarding complete`)

  // **Follow-up to the mint itself, not a second feature.** PD-286 dropped
  // `location` from onboarding on purpose — it is a profile field now, not a
  // gate — so a freshly-minted rider legitimately has none, and
  // `checkEditProfileRetention`'s first assertion ("location loads from the
  // stored profile") has nothing to load. Leaving that failing is not a
  // shrug: CLAUDE.md is explicit that a shrunken `N/N` is a skip rather than
  // a pass, and an assertion that is known to fail on every minted run is
  // the same defect wearing a green light — the next session learns it is
  // "expected" and stops reading the other seventeen. So the mint sets one
  // for real, through `/profile`'s own edit form — the one screen the walk
  // otherwise only ever RENDERS and never writes to — which keeps this a
  // walk rather than a seed script, the same reasoning as signup and
  // onboarding above.
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
  await page.waitForSelector('input[name="location"]', { timeout: 20_000 })
  await page.fill('input[name="location"]', MINT_LOCATION)
  await Promise.all([
    page
      .waitForFunction(
        () => document.querySelector('form [role="status"]')?.textContent?.trim() === 'Saved',
        null,
        { timeout: 20_000 }
      )
      .catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(500)

  const savedLocation = await page.inputValue('input[name="location"]').catch(() => null)
  if (savedLocation !== MINT_LOCATION) {
    // Fully onboarded — reachable exactly like the /postcards case above.
    console.error(
      `\nMinting failed: could not set the minted rider's location through /profile — ` +
        `read back ${JSON.stringify(savedLocation)}.`
    )
    console.error(`${EMAIL} is fully onboarded; deleting it before aborting.`)
    const cleanup = await attemptDeleteAccount(PASSWORD)
    if (cleanup.ok) {
      console.error(`${EMAIL} deleted.`)
    } else {
      console.error(`Could not clean up ${EMAIL} — ${cleanup.why}. Remove it by hand.`)
    }
    await browser.close()
    process.exit(1)
  }
  console.log(`  set location to "${MINT_LOCATION}" through /profile`)
}
// Full walks only, matching the guard cases below: a subset invocation is
// someone debugging one screen, and this one costs a whole extra sign-in.
const refusedSignInFailures = isFullWalk ? await checkRefusedSignIn() : 0

if (MINTED) {
  // **Wrapped, not called bare.** `mintWalkAccount` calls `process.exit`
  // itself on every failure it recognises, but a Playwright timeout it does
  // NOT recognise — a selector that genuinely never appears, a navigation
  // that hangs — throws instead, and an unwrapped `await` here let that
  // propagate straight past the teardown near the end of this file, leaving
  // whatever had already been created on DEV with nothing attempting to
  // remove it. Every run mints a fresh suffix, so nothing else was ever
  // going to reclaim that row.
  try {
    await mintWalkAccount()
  } catch (e) {
    console.error(`\nMinting threw before completing — ${String(e).split('\n')[0]}`)
    console.error('Attempting to delete whatever was created before aborting.')
    const cleanup = await deleteMintedAccountBestEffort().catch((e2) => ({
      ok: false,
      why: `cleanup itself threw — ${String(e2).split('\n')[0]}`,
    }))
    if (cleanup.ok) {
      console.error(`${EMAIL} deleted.`)
    } else {
      console.error(`Could not clean up ${EMAIL} — ${cleanup.why}. Remove it by hand on DEV.`)
    }
    await browser.close()
    process.exit(1)
  }
} else {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="password"]', PASSWORD)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 30_000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(1500)
}

const landed = new URL(page.url()).pathname
console.log(`sign-in landed on ${landed}`)
if (landed.startsWith('/auth/login')) {
  console.error('  sign-in failed — every route below will be a redirect, not a result')
}

// A phase that throws must fail, not abort — see the note beside the other
// three `.catch()`s below. This one additionally has an environment path
// that legitimately throws rather than reports (PROD's confirmation-ON
// signup response replaces the form entirely, so the field reads inside
// `checkRefusedSignup` reject on timeout instead of returning ""), and
// `runRefusedSignup`'s ref gate is what should keep that path from ever
// being reached — this `.catch()` is the defense behind that gate, not a
// substitute for it.
let refusedSignupFailures = 0
let refusedSignupRan = 0
if (isFullWalk) {
  const signup = await runRefusedSignup().catch((e) => {
    console.log(`  FAIL the phase threw  (${String(e).split('\n')[0]})`)
    return { bad: 1, ran: 1 }
  })
  refusedSignupFailures = signup.bad
  refusedSignupRan = signup.ran
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
async function discoverDetailPaths({ quiet = false, preferRide = null, preferClub = null } = {}) {
  const say = (m) => !quiet && console.log(m)

  /**
   * **The id is a query parameter, not a path segment** (PD-142) — so this reads
   * `?id=` off the first matching link rather than matching the whole pathname.
   * The old version matched `^/rides/[0-9a-f-]{36}$`, which after the route move
   * matches nothing at all: every detail link is `/rides/detail`, and a
   * discovery that silently finds nothing prints a skip notice that reads
   * exactly like a database with no rides in it.
   */
  const firstDetailId = async (listPath, detailPath, exclude = null) => {
    await page.goto(`${BASE}${listPath}`, { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(800)
    return page.evaluate(
      ([p, skip]) =>
        [...document.querySelectorAll('a[href]')]
          .map((a) => new URL(a.href, location.origin))
          .filter((u) => u.pathname === p)
          .map((u) => u.searchParams.get('id'))
          .find((id) => id && /^[0-9a-f-]{36}$/.test(id) && id !== skip) ?? null,
      [detailPath, exclude]
    )
  }

  // **`preferRide`/`preferClub` win over the scan below, when set** (PD-306).
  // This scan answers "is there a ride to open, at all" — the first one in
  // DOM order, owned by nobody in particular — which is a different question
  // from "does the signed-in rider own one", the one `discoverOwned` answers.
  // The two were conflated here once: `provision()` used to be gated on THIS
  // scan finding nothing, so the moment DEV held a real rider's public ride,
  // this found it, the fixture never got created, and the walk rider ended up
  // owning nothing to edit. Falling back to the scan when nothing is owned
  // keeps every other detail route walked exactly as before this changed —
  // only which id wins when both exist is different.
  const ride = preferRide ?? (await firstDetailId('/rides', '/rides/detail'))
  if (!ride) say('  (no rides to open — /rides/detail and its crew unwalked)')

  const club = preferClub ?? (await firstDetailId('/clubs', '/clubs/detail'))
  if (!club) say('  (no clubs to open — /clubs/detail and its sub-pages unwalked)')

  // The thread route needs a THREAD id, which only the club's own
  // Threads list carries — so the list is the "list page" here, reached with
  // the club id it was just given. A club with no threads yields nothing and the
  // route is skipped rather than guessed at, and it says so: a silent skip here
  // reads as a pass.
  const thread = club
    ? await firstDetailId(
        `/clubs/detail/threads?id=${club}`,
        '/clubs/detail/thread'
      )
    : null
  if (club && !thread) say('  (no threads in that club — /clubs/detail/thread unwalked)')

  const postcard = await firstDetailId('/postcards', '/postcards/detail')
  if (!postcard) say('  (no postcard thread link — /postcards/detail unwalked)')

  // The byline link `view-rider-profile` adds to `PostcardCard` — same page,
  // same discovery shape, with ONE extra condition: it must be somebody else's
  // byline.
  //
  // `/profile/detail` redirects a self-view to `/profile`, and this walk counts
  // any redirect as a failure, so taking whichever byline sorts first turns the
  // run red on a correct app. That is not a hypothetical to guard against out of
  // caution: on DEV today every postcard is authored by the walking account, so
  // the unfiltered version fails deterministically the first time anyone runs it.
  //
  // Excluding self makes the step measure the thing worth measuring — the
  // STRANGER render, which is the whole screen. When no other author has posted,
  // there is no stranger to walk to and the step says so and is skipped, rather
  // than quietly passing on a redirect.
  const me = await signedInRiderId()
  const profile = await firstDetailId('/postcards', '/profile/detail', me)
  if (!profile) {
    say(
      me
        ? '  (no postcard by another rider — /profile/detail unwalked; seed one to cover it)'
        : '  (could not read the signed-in rider id — /profile/detail unwalked)'
    )
  }

  const detail = (path, id) => `${path}?id=${id}`

  const paths = [
    // `edit` (PD-101) renders even for a rider who is not the organizer/owner
    // — it draws the "not yours" message rather than 404ing — but the walk's
    // fixtures are created through the UI by this same signed-in account, so
    // in the common case it is the real form that gets exercised.
    ...(ride
      ? [
          '/rides/detail',
          '/rides/detail/crew',
          '/rides/detail/chat',
          '/rides/detail/edit',
          // `083`, PD-329. Unlike `edit`, this one 404s for a rider who is not
          // the organizer — so it is walked on the same assumption `edit`
          // relies on: the walk's fixtures are created through the UI by this
          // same signed-in account, which makes them its organizer. A red mark
          // here on a ride somebody else organised is the walk finding a
          // fixture it did not create, not a broken screen.
          '/rides/detail/invite',
        ].map((p) => detail(p, ride))
      : []),
    ...(club
      ? [
          '/clubs/detail',
          '/clubs/detail/rides',
          '/clubs/detail/members',
          // `/clubs/detail/about` is NOT here: the club-detail merge deleted
          // that route outright (its page's own docstring says so) and nothing
          // links to it. The walk kept visiting it and reporting a 404, which
          // reads as a broken screen rather than a stale line in this list —
          // one permanent red mark in the only gate that renders anything.
          '/clubs/detail/edit',
          // Both take the CLUB's id; the thread route below takes the
          // thread's, which is why it is not in this map.
          '/clubs/detail/threads',
          '/clubs/detail/threads/new',
        ].map((p) => detail(p, club))
      : []),
    ...(thread ? [detail('/clubs/detail/thread', thread)] : []),
    ...(postcard ? [detail('/postcards/detail', postcard)] : []),
    ...(profile ? [detail('/profile/detail', profile)] : []),
  ]
  return { ride, club, thread, postcard, profile, paths }
}

/**
 * How many "mine" candidates `discoverOwned` probes per kind before giving up
 * — PD-306. Each probe is a full page load plus up to a 20s wait (see
 * `probeOwnsEditable`), so an unbounded scan of every ride a rider has
 * organized or joined could cost minutes on a rider with a long history.
 *
 * **The fixture ride sorts LAST, not first, and the bound is chosen knowing
 * that.** `/rides?filter=mine` orders by `departure_at` ascending
 * (`src/lib/data/rides.ts`), and `provision()` dates its fixture a year out on
 * purpose — so among upcoming rides it is the furthest from the end this bound
 * keeps. An earlier version of this comment claimed the opposite and was the
 * kind of measured-sounding wrong that survives review.
 *
 * **What that costs, stated rather than left to be discovered:** a rider who
 * owns a fixture buried past this bound — or one probe that times out over the
 * relay — reads as owning nothing, and with `WALK_FIXTURES=1` a second
 * "Walk fixture ride" is created on shared DEV, which there is deliberately no
 * cleanup pass for. The default minted account cannot hit it (it owns nothing
 * and organizes nothing, so `mine` is empty and the first run provisions), so
 * this is bounded to a reused `WALK_EMAIL` account with a long ride history.
 * Raise this rather than adding a cleanup pass if it ever bites: deleting rows
 * on a shared database is what PD-306 explicitly rejected.
 */
const MAX_OWNERSHIP_PROBES = 3

/**
 * Does the signed-in rider own the ride/club at `id` — i.e. does
 * `/{kind}s/detail/edit?id=<id>` render the owner-only `is_public` control.
 * PD-101: both edit routes answer 200 for a non-owner too, drawing a "not
 * yours" message rather than 404ing, so the response status proves nothing —
 * the control's presence is the only signal available from outside.
 *
 * Factored out of `checkEditRetention`, which used to run this probe inline
 * against whichever candidate `discoverDetailPaths` had already found.
 * `discoverOwned` below is its other caller, and the reason there is now two:
 * discovery answers "is there a row to open", never "does this rider own it".
 *
 * **`state: 'attached'`, not the default `'visible'`.** `Checkbox`'s real
 * input is `className="peer sr-only"` — visually hidden, not absent — and
 * requiring visibility would make this agree with an `attached` check only by
 * accident, on the current CSS: a future move to `hidden`/zero-size would
 * make an OWNED form read as "not yours" everywhere this is called.
 *
 * **`waitForSelector`, `.catch()`ed rather than left to reject.** An uncaught
 * rejection on a genuine "not yours" candidate would take the whole calling
 * phase down with it. A fixed sleep short enough to be cheap can read the
 * field before an owned form's data — fetched through the relay, one round
 * trip slower than a direct connection — has actually arrived, misreading an
 * owned candidate as "not yours" and skipping it.
 */
async function probeOwnsEditable(kind, id) {
  await page.goto(`${BASE}/${kind}s/detail/edit?id=${id}`, { waitUntil: 'networkidle' }).catch(() => {})
  return page
    .waitForSelector('form [name="is_public"]', { state: 'attached', timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
}

/**
 * What the signed-in rider actually owns, probed rather than merely
 * discovered — PD-306. `discoverDetailPaths` finds *a* ride and *a* club to
 * open; this finds one this rider can edit, which is a narrower question and
 * the one `provision()` needs answered before deciding whether to create
 * anything.
 *
 * Candidates come from the cheapest correct surface for each kind:
 * `/rides?filter=mine` (organizer ∪ `ride_members` — `readRides`'s `mine`
 * arm, per `src/lib/data/rides.ts` — so a joined-but-not-organized candidate
 * still has to be probed, it is not assumed owned) and `/clubs` (the rider's
 * own club list — `getYourClubs`, joined ∪ owned the same way). Each list is
 * scanned for `?id=` links in DOM order and probed with `probeOwnsEditable`,
 * up to `MAX_OWNERSHIP_PROBES`; the first that renders `is_public` wins.
 */
async function discoverOwned() {
  const candidateIds = async (listPath, detailPath) => {
    await page.goto(`${BASE}${listPath}`, { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(800)
    return page.evaluate(
      ([p]) => [
        ...new Set(
          [...document.querySelectorAll('a[href]')]
            .map((a) => new URL(a.href, location.origin))
            .filter((u) => u.pathname === p)
            .map((u) => u.searchParams.get('id'))
            .filter((id) => id && /^[0-9a-f-]{36}$/.test(id))
        ),
      ],
      [detailPath]
    )
  }

  const findOwned = async (kind, ids) => {
    for (const id of ids.slice(0, MAX_OWNERSHIP_PROBES)) {
      if (await probeOwnsEditable(kind, id)) return id
    }
    return null
  }

  // Sequential, not `Promise.all` — both calls drive the one shared `page`,
  // and two concurrent `page.goto`s on it would race each other's navigation.
  const rideIds = await candidateIds('/rides?filter=mine', '/rides/detail')
  const clubIds = await candidateIds('/clubs', '/clubs/detail')

  return {
    ride: await findOwned('ride', rideIds),
    club: await findOwned('club', clubIds),
  }
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
 * what keeps it idempotent. **"Missing" is ownership, never mere existence**
 * (PD-306) — `discoverOwned` above is what decides it, so a rider who already
 * owns a ride and a club gets nothing new even on a DEV full of other riders'
 * public rows, and repeated runs cannot silt the database up. There is still
 * no cleanup pass: an owned fixture is never deleted, on a shared database
 * that is not this harness's to clean.
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
async function accessTokenClaims() {
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
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  } catch {
    return null
  }
}

async function authenticatedProjectRef() {
  const claims = await accessTokenClaims()
  if (!claims?.iss) return null
  try {
    // `https://<ref>.supabase.co/auth/v1`
    return new URL(claims.iss).hostname.split('.')[0]
  } catch {
    return null
  }
}

/**
 * The signed-in rider's own id, off the same token `authenticatedProjectRef`
 * reads — `sub` is the one claim GoTrue guarantees is the user.
 *
 * It exists so the `/profile/detail` step can target somebody ELSE. That screen
 * redirects a self-view to `/profile`, and the walk counts ANY redirect as a
 * failure (`flags.push('redirected -> …')` → `failures += 1`), so discovering a
 * byline without excluding your own turns the run red on a correct app. Not
 * hypothetical: every postcard on DEV is authored by the walking account.
 */
async function signedInRiderId() {
  const claims = await accessTokenClaims()
  return typeof claims?.sub === 'string' ? claims.sub : null
}

/**
 * The one place the project-ref allowlist is checked — every write this walk
 * can make (`fixturesPermitted` below, and `runRefusedSignup` above) calls
 * this rather than testing `ref` itself, so a rule change (tightening it to
 * refuse a confirmation-ON project outright, say) happens once and binds
 * every write rather than whichever ones a session remembered to touch.
 *
 * `context` names what the caller was about to do, for the skip message
 * only — the allowlist logic itself never varies by caller.
 */
function refWritable(ref, context) {
  if (!ref) {
    return {
      ok: false,
      why: 'could not read which project the browser signed in to — refusing to write rather than guessing',
    }
  }
  if (!WRITABLE_REFS.has(ref)) {
    return {
      ok: false,
      why: `refusing to ${context} against "${ref}" — only ${[...WRITABLE_REFS].join(', ')} is writable`,
    }
  }
  return { ok: true }
}

/**
 * Writes are off by default, and turning them on is not enough on its own — the
 * project has to be one this walk is allowed to write to, established from the
 * session rather than from anything the runner typed.
 */
function fixturesPermitted(ref) {
  if (process.env.WALK_FIXTURES !== '1') return { ok: false, quiet: true }
  return refWritable(ref, 'create fixtures')
}

/**
 * Creates whatever `wanted` asks for through the app's own forms, and returns
 * the id of each row actually created — read straight off `page.url()` after
 * the redirect, rather than re-discovered through a list (PD-306). Both
 * actions redirect to `routes.ride(id)`/`routes.club(id)` on success, and a
 * row reached that way is owned by construction: no probe needed, unlike
 * every other id this file has to establish ownership of.
 *
 * **The club is created BEFORE the ride, and the ride is attached to it.**
 * That ordering is PD-311 and it is load-bearing rather than tidy. A clubless
 * ride is one `EditRideForm` refuses to save whenever the public box ends up
 * unticked — `narrowsToNobody` disables Save on that transition — so
 * `checkEditRetention` clicks a disabled button and times out 30 s later,
 * *before* any of its own assertions run. A FAIL meaning "this phase did not
 * run" is indistinguishable from one meaning "this phase found something".
 *
 * `existing.club` is the other half: `wanted` only asks for what is missing,
 * so a rider who already owns a club gets no new one and the ride must be
 * attached to the club they have. Passing it in is what keeps the fixture
 * ride clubbed on a second run.
 */
async function provision(wanted, existing = {}) {
  const created = { ride: null, club: null }

  if (wanted.club) {
    await page.goto(`${BASE}/clubs/new`, { waitUntil: 'networkidle' })
    await page.fill('input[name="name"]', 'Walk fixture club')
    await Promise.all([
      page.waitForURL((u) => !u.pathname.endsWith('/new'), { timeout: 30_000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ])
    await page.waitForTimeout(1200)
    created.club = new URL(page.url()).searchParams.get('id')
  }

  if (wanted.ride) {
    // A year out, not ten days, and the reason changed shape rather than going
    // away. `getRides` used to drop a departed ride entirely, so a short-dated
    // fixture aged off /rides and the next run created another that nothing
    // listed and nothing cleaned up. It now files it under Past rides
    // instead, which fixes the leak and introduces a quieter one:
    // `discoverDetailPaths` takes the first `?id=` link in DOM order, and on a
    // DEV where every ride has departed that is a *past* ride — so the walk
    // would check the detail screen's past variants (no Directions, "Rode")
    // believing it had an upcoming ride, and provision nothing. Dating the
    // fixture a year out keeps it at the top of the upcoming section, which is
    // what the phases after this one assume.
    const departure = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 16)
    await page.goto(`${BASE}/rides/new`, { waitUntil: 'networkidle' })
    await page.fill('input[name="title"]', 'Walk fixture ride')
    await page.fill('input[name="meeting_point"]', 'Dam Square, Amsterdam')
    await page.fill('input[name="departure_at"]', departure)

    // Attach it to a club — see the header. `CreateRideForm` draws the picker
    // only when the rider is not already inside a club context, and it lists
    // `getMyClubs`, so a club created seconds ago is there on this fresh load.
    // Selected by VALUE rather than by index: `option:nth-child(2)` would pick
    // whatever the list happens to order first, and "No club" is child 1 only
    // until someone reorders it.
    const clubForRide = created.club ?? existing.club ?? null
    if (clubForRide) {
      // Bounded, because the picker is genuinely absent when the composer is
      // seeded with a club (`CreateRideForm` draws a hidden input instead) and
      // the default 30 s wait would be paid for a fixture, not a finding.
      const attached = await page
        .selectOption('select[name="club_id"]', clubForRide, { timeout: 5_000 })
        .then((values) => values.length > 0)
        .catch(() => false)
      if (!attached) {
        console.log(`  ! the fixture ride could not be attached to a club — ${clubForRide}`)
      }
    }

    await Promise.all([
      page.waitForURL((u) => !u.pathname.endsWith('/new'), { timeout: 30_000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ])
    await page.waitForTimeout(1200)
    created.ride = new URL(page.url()).searchParams.get('id')
  }

  return created
}

let fixtureFailures = 0

/**
 * What the signed-in rider owns, and — when neither a ride nor a club is
 * owned by the time the block below finishes — why not. Declared here rather
 * than inside the `isFullWalk` block below because `checkEditRetention`'s
 * call site, much further down, needs both: the ids to build its candidates
 * from, and the reason for its skip message when there is nothing to build.
 */
let owned = { ride: null, club: null }
let ownershipUnavailableReason = null
// True only for the one case CLAUDE.md's "a shrunken N/N is a skip, not a
// pass" is about: fixtures were permitted, asked for, and still did not
// yield anything owned. Every other reason nothing is owned (fixtures off,
// or the project is not writable) is a legitimate skip.
let ownershipGapIsFailure = false

if (isFullWalk) {
  owned = await discoverOwned()

  if (!owned.ride || !owned.club) {
    const permit = fixturesPermitted(await authenticatedProjectRef())
    if (permit.ok) {
      const wanted = { ride: !owned.ride, club: !owned.club }
      // `owned.club` is passed so a rider who already has a club still gets a
      // CLUBBED fixture ride — PD-311, see `provision`'s header.
      const created = await provision(wanted, { club: owned.club })

      /**
       * **Report what landed, never what was attempted.** The first version
       * printed `+ created a ride` unconditionally, straight after the click.
       * A create refused by validation or RLS therefore produced
       * `+ created a ride` → `9/9 screens rendered clean` → exit 0 — the
       * precise skip-reads-as-pass failure this whole change exists to
       * close, reintroduced inside the fix for it. So the report comes from
       * what `provision()` actually read off the redirect, and a fixture
       * that was asked for and did not arrive fails the run.
       */
      for (const kind of ['ride', 'club']) {
        if (!wanted[kind]) continue
        if (created[kind]) {
          owned[kind] = created[kind]
          console.log(`  + created a ${kind} through /${kind}s/new`)
        } else {
          console.log(`  ! FIXTURE FAILED — asked for a ${kind} and none appeared`)
          fixtureFailures += 1
        }
      }
      if (!owned.ride && !owned.club) {
        ownershipUnavailableReason = 'a fixture was asked for and refused — see FIXTURE FAILED above'
        ownershipGapIsFailure = true
      }
    } else {
      ownershipUnavailableReason = permit.why ?? 'WALK_FIXTURES is not set, so nothing was provisioned'
      if (permit.why) console.log(`  (fixtures not created — ${permit.why})`)
    }
  }

  const detail = await discoverDetailPaths({ preferRide: owned.ride, preferClub: owned.club })
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

  /**
   * The in-place read failure, which is the app's COMMONEST one and was
   * invisible here until PostgREST answered 300 on both club lists for a day.
   *
   * `useQuery` renders `ui/ErrorState` in place of one result rather than
   * throwing to the route boundary, so the screen comes back 200, on its own
   * URL, with a full body and none of the boundary's words in it — a healthy
   * `rendered` line for a screen that loaded nothing. The claim in this file's
   * header ("did this come back as a screen, or an error boundary") was already
   * meant to cover it; only the detection was missing.
   *
   * Keyed on the DOM rather than on the copy, because `ErrorState`'s message is
   * a default its callers may replace. `role="alert"` alone is far too broad —
   * every inline form error carries one — so the discriminator is the pair:
   * that role WITH a retry affordance inside it, which is `ErrorState` and
   * nothing else in `src/`. `BoundaryError` needs no entry: it says "Something
   * went wrong", which the line below already catches.
   */
  const failedRead = await page
    .evaluate(() =>
      [...document.querySelectorAll('[role="alert"]')].some((el) =>
        /try again/i.test(el.textContent ?? '')
      )
    )
    .catch(() => false)

  // The four ways a screen fails without failing loudly. A 200 means Next
  // served *something*, which includes the error boundary.
  const flags = []
  if (finalPath !== path) flags.push(`redirected -> ${finalPath}`)
  if (/something went wrong|application error|unhandled runtime/i.test(text)) {
    flags.push('ERROR BOUNDARY')
  }
  if (failedRead) flags.push('FAILED READ (ErrorState)')
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
  // PD-286 (`075`) deleted this route. For a fully onboarded rider it is just
  // another path under `/onboarding`, so `resolveDestination`'s existing
  // `isOnboarding` branch sends it to /postcards with no code of its own —
  // but that branch is what the guard's new catch-all for an *incomplete*
  // rider also leans on (unknown /onboarding/* -> the resume step, rather
  // than a 404 with the guard insisting they belong there). `guard.test.ts`
  // covers the decision as a pure function; this line is the one gate that
  // renders anything, so it is what would have caught a deleted route
  // 404ing while the guard still claims it — PD-125's shape exactly, a
  // screen nobody can reach with every other gate green.
  ['/onboarding/location', '/postcards'],
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
 * **The submit cannot create a ride, at either layer.** A whitespace-only
 * `meeting_point` fails `rideSchema`'s `.trim().min(1)` before any network
 * call, and `018`'s `rides_meeting_point_length` (`length(btrim(...)) >= 1`)
 * refuses the same whitespace at the database — so even a regression that
 * dropped the client parse could not turn this phase into a writer. That is
 * why it runs on every full walk rather than behind `WALK_FIXTURES`.
 *
 * **The refusal used to be `max_riders = 0` and that field no longer exists**
 * — `077` (PD-293) dropped the column and `063`'s join gate with it. The
 * replacement is deliberately the same two-layer shape the club phase below
 * already uses, and it costs this phase exactly one assertion: the separate
 * `max_riders survives it` check is gone, while `meeting_point` keeps its
 * place in the retention loop and now carries the refusal as well. A
 * whitespace value exercises `retaining` through identical code — what it
 * would fail on is a build that trims or drops it, which is the defect the
 * assertion is for.
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
    // **This one is the refusal**, not just a field to retain — see the
    // header. HTML `required` is satisfied by a non-empty string, and the form
    // carries `noValidate` besides, so it reaches the action and is refused
    // there and at the database.
    meeting_point: '   ',
    departure_at: '2027-03-14T09:15',
    route_description: 'Along the dyke, back over the bridge',
  }

  // **Every selector is scoped to the form**, and the rule outlived the field
  // that taught it. A bare `[name="description"]` matches `<meta
  // name="description">` in the document head first, and Playwright fills the
  // first match — 30 seconds of waiting for a meta tag to become editable, then
  // an uncaught timeout that takes the whole walk with it. This form has no
  // `description` since PD-320; `checkClubFormRetention` below still fills one,
  // and any future field colliding with a `<meta name>` would land the same
  // way, so the scoping stays on both.
  const field = (name) => `form [name="${name}"]`

  await page.goto(`${BASE}/rides/new`, { waitUntil: 'networkidle' })
  await page.waitForSelector(field('title'), { timeout: 20_000 })
  for (const [name, value] of Object.entries(filled)) {
    await page.fill(field(name), value)
  }
  // **Unticked by default since PD-320, so TICKING it is what proves the
  // restore reads the submission rather than reinstating the literal default.**
  // The probe inverted with the default rather than being dropped: the whole
  // point is that `wasChecked` must disagree with the default, and against a
  // box that now ships clear, clearing it agrees with the default and would
  // pass on a build that had lost `retaining` entirely.
  //
  // **Clicked by its label, which is how a rider ticks it too.** `<Checkbox>`
  // draws an `sr-only` input beneath a styled span, so Playwright refuses an
  // ordinary click as intercepted and a forced one lands on the span and
  // toggles nothing ("Clicking the checkbox did not change its state"). The
  // label is the control's real hit area — `htmlFor` does the toggling.
  //
  // A precondition, not an assertion about the app: a build that shipped the
  // box ticked would leave this phase measuring the wrong submission, so it
  // is checked before the click rather than inferred after it.
  if (await page.isChecked(field('is_public'))) {
    throw new Error('the "public" checkbox arrived ticked — PD-320 defaults it off')
  }
  await page.click('form label:has(input[name="is_public"])')
  if (!(await page.isChecked(field('is_public')))) {
    throw new Error('could not tick the "public" checkbox — the harness, not the app')
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

  const stillPublic = await page.isChecked(field('is_public')).catch(() => null)
  report(stillPublic === true, 'the ticked "public" box stays ticked', 'it was cleared')

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
 * **The submit cannot create a club, at either layer — same shape as the ride
 * phase above.** The form carries `noValidate`, so a whitespace-only `name`
 * reaches `createClub`'s action, and `clubSchema`'s `.trim().min(1)` refuses
 * it before any query runs; `018`'s `clubs_name_length` CHECK
 * (`length(btrim(name)) >= 1`) refuses the same whitespace at the database,
 * exactly as `018` bounds `rides.meeting_point`. (`clubSchema`'s own header
 * comment still says `clubs.name` carries no CHECK — that predates `018` and
 * is stale; tracked separately, not by this phase.)
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
 * Refused by a whitespace-only required field exactly as the create phase is,
 * and unable to write for the same two reasons.
 *
 * `candidates` arrive already believed-owned — the caller ran the same
 * ownership probe this function used to run inline (`discoverOwned`, via
 * `probeOwnsEditable`) before ever getting here, so the loop below is a
 * confirmation rather than a search in the common case. `unavailable`
 * carries why nothing is owned, for when the loop finds nothing: `{ failed,
 * reason }`, where `failed` is true only when fixtures were permitted and
 * asked for and still did not produce anything — see PD-306 at the caller.
 */
async function checkEditRetention(candidates, unavailable) {
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

  // **The first candidate whose form both renders and can be submitted after
  // the flip — ownership confirmed via `probeOwnsEditable`, the same probe
  // `discoverOwned` already ran on each of these before this function was
  // ever called.** `/rides/detail/edit`
  // and `/clubs/detail/edit` both answer 200 for a rider who does not own the
  // row — they draw a "not yours" message rather than 404ing (PD-101) — so a
  // re-check here rather than trusting the earlier answer outright is
  // deliberate: it is the same bounded, `.catch()`ed wait either way (see
  // that function's own header for why an uncaught reject or a fixed sleep
  // both misread this), and it is what leaves `page` sitting on the chosen
  // form afterwards, ready for the reads and the submit below.
  //
  // **Owning the row is not enough — the flip below has to leave Save
  // clickable, and on the ride form it does not always (PD-311).**
  // `EditRideForm` disables Save on the transition `narrowsToNobody` names, so
  // unticking "public" on a ride that belongs to no club disables the very
  // button this phase clicks next, and `page.click` then waits out its full
  // timeout and throws — with none of this phase's assertions having run.
  // Which ride trips it flipped with PD-320 (the composer's `is_public`
  // default went off), so before that it was the private ride and now it is
  // the public one; either way it depends on what the account happens to own,
  // which is why it read as flakiness rather than as a defect.
  //
  // **PD-338 narrowed that guard and deliberately did not close this**: a ride
  // that ARRIVED clubless and private now saves, but un-publishing a clubless
  // *public* one is still the refused transition, so the trap is narrower
  // rather than gone.
  //
  // **Read the button rather than re-deriving the rule.** A second copy of the
  // predicate here would go stale silently — it has already been rewritten
  // once. `isEnabled` asks the app what it will accept, so this survives the
  // guard being narrowed again, widened or dropped.
  //
  // The club form has no such guard, so it is the natural fallback — the loop
  // already had the club as a second candidate and simply never reached it,
  // because it broke on the first candidate that *rendered*.
  let chosen = null
  let clubBefore = null
  let publicWanted = null
  const unusable = []
  for (const candidate of candidates) {
    if (!(await probeOwnsEditable(candidate.kind, candidate.id))) continue

    const club = await page.inputValue(field('club_id')).catch(() => null)
    const publicBefore = await page.isChecked(field('is_public'))

    // Flip the checkbox, so what is asserted is the rider's change rather than
    // whatever the row already was.
    await page.click('form label:has(input[name="is_public"])')

    if (!(await page.isEnabled('form button[type="submit"]').catch(() => false))) {
      await page.click('form label:has(input[name="is_public"])').catch(() => {})
      unusable.push(
        `${candidate.label}: Save is disabled once "public" is ${publicBefore ? 'unticked' : 'ticked'}`
      )
      continue
    }

    chosen = candidate
    clubBefore = club
    publicWanted = !publicBefore
    break
  }
  if (!chosen) {
    if (unusable.length > 0) {
      // **Not a skip.** The rider owns an editable row and the phase still
      // could not run, which is the PD-311 failure named rather than timed
      // out. CLAUDE.md: a shrunken N/N is a skip, not a pass — so this moves
      // `ran` and `bad` instead of dropping out of the total.
      report(false, 'an editable row this phase can submit was available', unusable.join('; '))
    } else if (unavailable?.failed) {
      // Fixtures were permitted and asked for, and still nothing came out of
      // it — a `! FIXTURE FAILED` line already printed at the caller, and
      // CLAUDE.md is explicit that a shrunken N/N is a skip, not a pass. So
      // this counts as a failed assertion (`ran` and `bad` both move) rather
      // than dropping silently out of the phase's own total, on top of the
      // exit code the FIXTURE FAILED line already sets.
      report(false, 'a ride or club to edit was available', unavailable.reason)
    } else {
      console.log(
        `  (no ride or club this rider owns — not exercised` +
          `${unavailable?.reason ? `: ${unavailable.reason}` : ''})`
      )
    }
    return { bad, ran }
  }
  console.log(`  (on ${chosen.label})`)
  for (const skipped of unusable) console.log(`  (skipped ${skipped})`)

  // **The refusal is whitespace, and the reason is worth keeping.** Neither
  // edit form carries `noValidate`, so anything the browser's own constraint
  // validation can catch never reaches the action: no action runs, no reset
  // happens, and every assertion below then passes without exercising
  // anything. The refusal assertion is what catches that.
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
 * PD-286 (`075`) dropped `location` from the onboarding gate, so this is no
 * longer a rule `023`'s trigger enforces for every rider — it is a fact about
 * the walk account specifically, which carries a location from before that
 * change. 7.4d in that proposal's tasks is what keeps the walk account
 * carrying one; if this assertion ever starts failing, that is the first
 * place to look rather than a regression in the retention logic below.
 *
 * **The error region is `role="alert"` (`FormError`), not `role="status"`
 * like the ride/club forms above** — this form draws no live alert while
 * typing, unlike the ones with a public/private checkbox, so there is no
 * false-positive trap to guard against and alert text is safe to wait on
 * directly.
 *
 * Refused the same way as the create phase, but not on whitespace any more:
 * `location` is optional since PD-286, so a whitespace-only value trims to
 * `''` and `updateProfile` accepts it — filling it that way would both fail
 * to trigger a refusal and clear the account's stored location, poisoning
 * the first assertion on every later run. The trigger is a 101-character
 * location instead: `profileEditSchema`'s `optionalText` still carries
 * `max(100)`, so `noValidate` still lets it reach `updateProfile` and Zod
 * still refuses it before any query runs — same field, same refusal
 * mechanism, no data loss.
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
  const tooLongLocation = 'A'.repeat(101)
  // `page.fill()` CANNOT deliver this, and finding that out cost a red run:
  // every field on this form carries `maxLength`, and fill() honours it — so
  // the 101 characters arrived as 100, the action accepted them, and the phase
  // failed while ALSO writing a 100-character location over the walk account's
  // stored one. Since PD-286 made all three fields optional, there is no value
  // this form's own DOM will let a typist submit that the action refuses.
  //
  // So the refusal is driven the way a patched client would drive it: the
  // native value setter past `maxLength`, plus the `input` event React listens
  // for. That is not a contrivance — it is the case the action's parse exists
  // for, since `maxLength` is an editing constraint and not a guarantee, and
  // `018`'s `profiles_location_length` is what actually holds the line.
  await page.$eval(
    field('location'),
    (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      ).set
      setter.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    tooLongLocation
  )
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
  report(
    locationAfter === tooLongLocation,
    'location survives it',
    `read ${JSON.stringify(locationAfter)}`
  )

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

  // Built from `owned` — computed once, well above, by `discoverOwned` and
  // (if fixtures were needed and permitted) `provision()` — never from a
  // fresh `discoverDetailPaths()` here. That used to be a second discovery
  // asking "is there a ride to open", the same question PD-306 is about;
  // this phase needs "does this rider own one", which `owned` already is.
  const editCandidates = [
    ...(owned.ride ? [{ kind: 'ride', id: owned.ride, label: 'the ride edit form', refuse: 'title' }] : []),
    ...(owned.club ? [{ kind: 'club', id: owned.club, label: 'the club edit form', refuse: 'name' }] : []),
  ]
  const edit = await checkEditRetention(editCandidates, {
    failed: ownershipGapIsFailure,
    reason: ownershipUnavailableReason,
  }).catch((e) => {
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

/**
 * Non-fatal teardown of the minted account — PD-268's real decision. Making
 * the walk depend on `delete-account` succeeding would mean an unrelated Edge
 * Function outage turns an otherwise-green render check red, which is exactly
 * the "second thing that can fail the walk for an unrelated reason" the story
 * warns against — so a failed deletion is logged and never counted towards
 * `process.exit`'s status below.
 *
 * **Gated on `MINTED` alone, never on anything read back from the account or
 * the environment.** An explicitly-supplied `WALK_EMAIL` account must never
 * be deleted, under any code path — `MINTED` is false the instant
 * `WALK_EMAIL` is set (see its definition near the top of this file), so
 * there is exactly one condition standing between a rider's real fixture
 * account and this call.
 *
 * Signs back in first when it has to, via `deleteMintedAccountBestEffort` —
 * on a full walk `checkSignOut` above already cleared the session, and on a
 * subset invocation (`isFullWalk` is false) `page` may still be holding the
 * one `mintWalkAccount` established. Shared with `mintWalkAccount`'s own
 * `catch` rather than a second copy of the same sign-back-in dance.
 */
if (MINTED) {
  console.log('\nteardown (minted account):')
  const teardown = await deleteMintedAccountBestEffort()
  if (teardown.ok) {
    console.log(`  ok   ${EMAIL} deleted`)
  } else {
    console.log(
      `  WARN could not delete ${EMAIL} — ${teardown.why}\n` +
        '       Non-fatal — see the header on why a delete-account outage must not fail\n' +
        '       this run. Remove the row by hand on DEV if it matters.'
    )
  }
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
    // Counted from what ran, not from a constant: the club `<select>` exists
    // only for a rider in a club, the ride/club edit phase runs only for a
    // rider who owns one, and `runRefusedSignup` skips entirely off the
    // project-ref gate. See checkFormRetention, checkEditRetention and
    // runRefusedSignup.
    retentionRan +
    refusedSignupRan
  const bad = guardFailures + refusedSignInFailures + refusedSignupFailures
  console.log(`${total - bad}/${total} guard, navigation and sign-out checks correct`)
}
process.exit(
  failures || guardFailures || refusedSignInFailures || refusedSignupFailures || fixtureFailures ? 1 : 0
)
