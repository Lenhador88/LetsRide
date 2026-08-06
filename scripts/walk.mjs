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
 * ## Running it
 *
 *   NODE_USE_ENV_PROXY=1 npm run dev          # in one shell
 *   WALK_EMAIL=... WALK_PASSWORD=... npm run walk
 *
 * `NODE_USE_ENV_PROXY=1` is not optional in a proxied container: Node's fetch
 * ignores HTTPS_PROXY, so every server-side Supabase call fails with a proxy
 * page while curl succeeds — and the app surfaces that as "That email and
 * password do not match an account", which reads like a credentials problem and
 * is not one.
 *
 * Chromium here has no proxy of its own either, so Supabase signed-URL <img>
 * fetches never complete and every photo renders blank. That is not an
 * application bug. `--proxy-server` below fixes it, with localhost bypassed so
 * the dev server stays directly reachable.
 *
 * Pass paths as arguments to walk a subset.
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
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 300)}`)
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
async function discoverDetailPaths() {
  const found = []

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
  if (ride) found.push(ride, `${ride}/crew`)
  else console.log('  (no rides to open — /rides/[id] and its crew unwalked)')

  const club = await firstHref('/clubs', '^/clubs/[0-9a-f-]{36}$')
  if (club) found.push(club, `${club}/rides`, `${club}/members`, `${club}/about`)
  else console.log('  (no clubs to open — /clubs/[id] and its sub-pages unwalked)')

  const postcard = await firstHref('/postcards', '^/postcards/[0-9a-f-]{36}$')
  if (postcard) found.push(postcard)
  else console.log('  (no postcard thread link — /postcards/[id] unwalked)')

  return found
}

if (isFullWalk) {
  const detail = await discoverDetailPaths()
  paths = [...paths, ...detail]
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

let guardFailures = 0
if (isFullWalk) {
  guardFailures += await checkGuard(page, GUARD_CASES_SIGNED_IN, 'signed in')

  const anonContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const anonPage = await anonContext.newPage()
  guardFailures += await checkGuard(anonPage, GUARD_CASES_SIGNED_OUT, 'signed out')
  await anonContext.close()
}

await browser.close()

console.log(`\n${paths.length - failures}/${paths.length} screens rendered clean`)
if (isFullWalk) {
  const total = GUARD_CASES_SIGNED_IN.length + GUARD_CASES_SIGNED_OUT.length
  console.log(`${total - guardFailures}/${total} route-guard redirects correct`)
}
process.exit(failures || guardFailures ? 1 : 0)
