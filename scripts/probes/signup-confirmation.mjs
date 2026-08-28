/**
 * The confirmation-ON arm of `signUp`, driven through the app — PD-252.
 *
 * ## What this covers that nothing else does
 *
 * `signUp` has two arms and only one of them has ever executed. With email
 * confirmation **off** Supabase returns a live session, `accept_terms()` runs
 * and the rider is redirected into onboarding — that is the arm DEV takes and
 * the only one `npm run walk` can reach. With confirmation **on** it returns a
 * user and **no session**, so `src/lib/actions/auth.ts` returns `{ sent: true }`
 * and `src/app/auth/signup/page.tsx` swaps the form for "Check your email".
 *
 * That second arm is the one that was *added to fix a production outage*
 * (`CLAUDE.md` decision #6: `signUp` assumed a live session, and one PROD
 * account is still stuck from it) — and until this probe ran, the only evidence
 * it worked was that it type-checked.
 *
 * **DEV structurally cannot reach it.** `mailer_autoconfirm` is `true` there, so
 * every signup comes back with a session. The arm needs a confirmation-on
 * project, and PROD is the only one this repo has.
 *
 * ## Why this is a hand-run probe and not a walk phase
 *
 * Every run of this emails a real address on a real production auth server, and
 * `scripts/walk.mjs`'s `WRITABLE_REFS` allowlist deliberately holds DEV only.
 * Widening it onto a confirmation-on ref is a decision with a blast radius
 * (`refWritable`'s own header spells it out), so it stays a separate call. This
 * script is the cheap half: it settles whether the arm works, today, without
 * changing what any automated gate is permitted to write to.
 *
 * ## Two gates, both fail closed
 *
 * - **The project must report `mailer_autoconfirm: false`.** This is the inverse
 *   of `refWritable`: pointed at a confirmation-*off* project the branch is
 *   unreachable, the run goes green, and it has proved nothing. A probe whose
 *   green run is meaningless is worse than no probe.
 * - **The address must be a plus-address.** A confirmation-on server emails the
 *   real owner of whatever is typed — including on a duplicate, which is the
 *   mitigation GoTrue applies instead of erroring. `+` is the cheap proof that
 *   the operator owns the mailbox they are about to mail.
 *
 * ## Running it
 *
 *   NODE_USE_ENV_PROXY=1 RELAY_UPSTREAM=https://<prod ref>.supabase.co \
 *     node scripts/supabase-relay.mjs &
 *   NEXT_PUBLIC_SUPABASE_URL=http://localhost:3001 \
 *     NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable> NODE_USE_ENV_PROXY=1 npm run dev &
 *
 *   PROBE_SUPABASE_URL=http://localhost:3001 PROBE_SUPABASE_ANON_KEY=<publishable> \
 *     node scripts/probes/signup-confirmation.mjs signup you+pd252-1@gmail.com
 *   # read the mail, then — same browser storage, because the flow is PKCE:
 *   PROBE_SUPABASE_URL=... PROBE_SUPABASE_ANON_KEY=... \
 *     node scripts/probes/signup-confirmation.mjs confirm '<the link in the mail>'
 *
 * **The two phases share `storageState`, and that is not a convenience.** The
 * client is `flowType: 'pkce'`, so `signUp` leaves a `code_verifier` in the
 * browser's storage and `/auth/callback` needs it back. A confirmation link
 * opened in a *different* browser than the one that signed up has no verifier
 * and cannot complete — a real product property, not an artifact of this script.
 *
 * ## What it cannot cover from this container
 *
 * `app.letsride.social:443` is refused by the agent proxy (403 to CONNECT), so
 * the deployed production bundle cannot be driven from here. The app under test
 * is therefore the local dev server talking to the production auth server
 * through `scripts/supabase-relay.mjs`. One consequence is visible and is
 * printed rather than hidden: `canonicalOrigin()` resolves to
 * `http://localhost:3000`, which is **not** on PROD's redirect allowlist
 * (`docs/ENVIRONMENTS.md` §The redirect allowlist — it was removed on
 * 2026-08-11), so GoTrue discards the `redirect_to` and substitutes the Site
 * URL. `confirm` reports where the link actually points before rewriting its
 * origin onto the app under test.
 */
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const EXECUTABLE =
  process.env.PROBE_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const BASE = process.env.PROBE_BASE ?? 'http://localhost:3000'
const STATE = process.env.PROBE_STATE ?? '.probe/pd252-storage.json'
const PASSWORD = process.env.PROBE_PASSWORD ?? 'Pd252-confirmation-arm-Aa1'

const [phase, argument] = process.argv.slice(2)
if (phase !== 'signup' && phase !== 'confirm') {
  console.error('usage: signup-confirmation.mjs signup <address> | confirm <link>')
  process.exit(2)
}

const supabaseUrl = process.env.PROBE_SUPABASE_URL
const anonKey = process.env.PROBE_SUPABASE_ANON_KEY
if (!supabaseUrl || !anonKey) {
  console.error('Set PROBE_SUPABASE_URL and PROBE_SUPABASE_ANON_KEY to the server the app under test is talking to.')
  process.exit(2)
}

// Gate 1. Read it off the server rather than trusting decision #6 — that is the
// whole lesson the arm below exists to record.
const settings = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: anonKey } })
  .then((r) => r.json())
  .catch((e) => ({ error: String(e) }))
if (settings.mailer_autoconfirm !== false) {
  console.error(
    `refusing: ${supabaseUrl} reports mailer_autoconfirm=${JSON.stringify(settings.mailer_autoconfirm)}.\n` +
      'This probe is only meaningful where email confirmation is ON — anywhere else the\n' +
      'branch it exists to exercise is unreachable and a green run proves nothing.'
  )
  process.exit(1)
}
console.log(`confirmation is ON at ${supabaseUrl} — the arm is reachable`)

let bad = 0
let ran = 0
const report = (ok, label, detail) => {
  ran += 1
  if (!ok) bad += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (${detail})`}`)
}

const browser = await chromium.launch({ executablePath: EXECUTABLE })

if (phase === 'signup') {
  const address = argument
  // Gate 2.
  if (!address || !address.includes('+')) {
    console.error(
      'refusing: pass a plus-address you own (you+pd252-1@example.com).\n' +
        'A confirmation-on server emails whoever owns the address typed here, including\n' +
        'on a duplicate — GoTrue answers those with success and a mail, not an error.'
    )
    await browser.close()
    process.exit(1)
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()

  console.log(`\nconfirmation-on signup (${address}):`)
  await page.goto(`${BASE}/auth/signup`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[name="email"]')
  await page.fill('input[name="email"]', address)
  await page.fill('input[name="password"]', PASSWORD)
  await page.click('label:has(input[name="acceptedTerms"])')
  await page.click('button[type="submit"]')

  await page
    .waitForFunction(
      () => /Check your email/i.test(document.body.textContent ?? ''),
      null,
      { timeout: 30_000 }
    )
    .catch(() => {})

  const body = (await page.textContent('body')) ?? ''
  const alerts = (
    await page.$$eval('[role="alert"]', (ns) => ns.map((n) => n.textContent.trim()).filter(Boolean))
  ).join(' | ')

  // The five assertions of the arm. The first two are the arm itself; the rest
  // separate it from the failures it is easily mistaken for — an error alert, a
  // redirect into onboarding (the confirmation-OFF arm), and a form still on
  // screen (the action returned nothing at all).
  report(/Check your email/i.test(body), 'the "Check your email" screen renders', 'heading absent')
  report(
    /link to confirm your address/i.test(body),
    'it tells the rider to open the link',
    'the confirmation copy is not on screen'
  )
  report(!alerts, 'nothing is reported as an error', `alert text on screen: ${alerts}`)
  report(
    (await page.$('input[name="email"]')) === null,
    'the signup form is replaced, not merely annotated',
    'the form is still on screen'
  )
  report(
    new URL(page.url()).pathname === '/auth/signup',
    'it happens in place, with no navigation',
    `landed on ${page.url()} — that is the confirmation-OFF arm`
  )

  mkdirSync(STATE.replace(/\/[^/]+$/, ''), { recursive: true })
  await context.storageState({ path: STATE })
  console.log(`\nbrowser storage saved to ${STATE} (holds the PKCE code_verifier)`)
  console.log(`now open the mail sent to ${address} and run:`)
  console.log(`  node scripts/probes/signup-confirmation.mjs confirm '<link>'`)
  await context.close()
}

if (phase === 'confirm') {
  const link = argument
  if (!link) {
    console.error('usage: signup-confirmation.mjs confirm <the link in the confirmation mail>')
    await browser.close()
    process.exit(2)
  }
  if (!existsSync(STATE)) {
    console.error(`no ${STATE} — run the signup phase first; the PKCE verifier lives in it.`)
    await browser.close()
    process.exit(1)
  }

  console.log('\nconfirmation link:')
  // Resolved with Node rather than in the browser: this hop is the auth server,
  // and it is the one host Chromium in this container cannot reach.
  const verify = await fetch(link, { redirect: 'manual' })
  const location = verify.headers.get('location')
  console.log(`  GoTrue answered ${verify.status} -> ${location}`)
  report(verify.status >= 300 && verify.status < 400 && Boolean(location), 'the link is accepted', `status ${verify.status}`)
  if (!location) {
    await browser.close()
    process.exit(1)
  }

  const landing = new URL(location)
  const errorInFragment = /error(_code|_description)?=/.test(landing.hash)
  report(!errorInFragment, 'it carries no error', `fragment: ${landing.hash}`)
  const code = landing.searchParams.get('code')
  report(Boolean(code), 'it carries a PKCE code for /auth/callback to exchange', `no ?code= on ${landing.origin}${landing.pathname}`)
  if (!code) {
    await browser.close()
    process.exit(1)
  }

  // **Where the link points is the redirect allowlist's answer, not this arm's,
  // and the two must not be conflated.** `signUp` asks GoTrue for
  // `<origin>/auth/callback?next=/postcards`. On production that origin is
  // `https://app.letsride.social`, which is allowlisted, so the rider gets that
  // URL. Run from this container the origin is `http://localhost:3000`, which
  // PROD's allowlist deliberately does not carry — so GoTrue *discards the whole
  // redirect_to, path and all* and substitutes the Site URL. That substitution
  // is the documented behaviour (`docs/ENVIRONMENTS.md` §The redirect
  // allowlist), it is measured and printed here, and it is not what this probe
  // is testing.
  //
  // So the callback URL is reconstructed to the shape production's GoTrue
  // emits, and the reconstruction is stated rather than hidden: the code is
  // GoTrue's own and unmodified, only the address it was delivered to is
  // restored.
  const expected = `${BASE}/auth/callback?next=/postcards`
  const substituted = `${landing.origin}${landing.pathname}` !== `${BASE}/auth/callback`
  report(
    !substituted || landing.origin !== BASE,
    'the link points where the app asked, or somewhere this run can explain',
    `unexpected landing ${landing.origin}${landing.pathname}`
  )
  if (substituted) {
    console.log(
      `  redirect_to was substituted: the app asked for ${expected}\n` +
        `  and GoTrue answered ${landing.origin}${landing.pathname} — this origin is not on the\n` +
        '  project\'s allowlist, so the whole redirect_to was discarded. Reconstructing the\n' +
        '  callback URL production would have produced; the code below is GoTrue\'s, unmodified.'
    )
  }
  const rewritten = `${expected}&code=${encodeURIComponent(code)}`
  console.log(`  driving the app under test with ${rewritten}`)

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: JSON.parse(readFileSync(STATE, 'utf8')),
  })
  const page = await context.newPage()
  await page.goto(rewritten, { waitUntil: 'domcontentloaded' })
  await page
    .waitForFunction(() => !/\/auth\/callback/.test(location.pathname), null, { timeout: 30_000 })
    .catch(() => {})
  await page.waitForTimeout(2_000)

  const landed = new URL(page.url()).pathname
  report(landed !== '/auth/callback', 'the exchange completes', 'still on "Signing you in"')
  report(
    landed !== '/auth/login',
    'the rider is signed in',
    'bounced to /auth/login — the exchange was refused'
  )
  report(
    landed === '/onboarding/terms',
    'and is sent into onboarding at the consent step',
    `landed on ${landed}; a confirmed rider with no terms stamp belongs on /onboarding/terms`
  )
  writeFileSync(STATE, JSON.stringify(await context.storageState(), null, 2))
  await context.close()
}

await browser.close()
console.log(`\n${ran - bad}/${ran} ok`)
process.exit(bad ? 1 : 0)
