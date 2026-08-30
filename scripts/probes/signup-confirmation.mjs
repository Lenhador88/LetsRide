/**
 * The confirmation-ON arm of `signUp`, driven through the app — PD-252.
 *
 * ## What this covers that nothing else does
 *
 * `signUp` has two arms and only one of them had ever executed. With email
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
 * **DEV structurally cannot reach it**, measured 2026-08-27 rather than read off
 * decision #6, which is the whole lesson this arm exists to record:
 *
 *   curl -s "https://<ref>.supabase.co/auth/v1/settings" -H "apikey: <publishable>" \
 *     | python3 -c 'import json,sys; print(json.load(sys.stdin)["mailer_autoconfirm"])'
 *   # DEV fpmrimzxadewsaiwpsel -> True   (autoconfirm: a signup always returns a session)
 *   # PROD zwprydcyryvudhurbnye -> False (confirmation required: the arm is reachable)
 *
 * ## Why this is a hand-run probe and not a walk phase
 *
 * Every run emails a real address on a real production auth server, and
 * `scripts/walk.mjs`'s `WRITABLE_REFS` allowlist deliberately holds DEV only.
 * Widening it onto a confirmation-on ref is a decision with a blast radius
 * (`refWritable`'s own header spells it out), so it stays a separate call —
 * PD-334. This script is the cheap half: it settles whether the arm works,
 * today, without changing what any automated gate may write to.
 *
 * ## Five gates, all fail closed
 *
 * A green run that proves nothing is worse than no probe, and a run against the
 * wrong project or the wrong mailbox is worse than either.
 *
 * - **`PROBE_SUPABASE_URL` must be a direct `https://<ref>.supabase.co`.** Not a
 *   relay. The relay is for the *browser*; this script talks to the project
 *   itself, so the ref is in the URL, is printed before anything is written, and
 *   is what the confirmation link is checked against below. Pointed at
 *   `http://localhost:3001` the script would gate on a property of whatever that
 *   relay happened to forward to and name no project at all.
 * - **That project must report `mailer_autoconfirm: false`.** Pointed at a
 *   confirmation-*off* project the branch is unreachable, the run goes green,
 *   and it has proved nothing.
 * - **The address must be `PROBE_OWNED_MAILBOX` plus-tagged.** A `+` alone is a
 *   shape guard and **not** proof of ownership: `stranger+x@gmail.com` passes it,
 *   and so does a typo — which on a confirmation-on server mails a real
 *   confirmation link to somebody else and leaves a PROD row behind that the
 *   operator never finds, because they are watching the wrong inbox. **Both
 *   halves are pinned**, because a typo'd domain (`you+x@gmial.com`) mails a
 *   stranger exactly as a typo'd local part does; so `PROBE_OWNED_MAILBOX` is a
 *   whole address and the tag is the only free part.
 * - **`PROBE_PASSWORD` must be set.** There is deliberately no default: a
 *   default would be a committed password for accounts on a production auth
 *   server.
 * - **`confirm`'s link must be on the gated project's host.** It refuses before
 *   it resolves the link, so the token is not spent on the way to finding out.
 *   **It catches a link from a DIFFERENT PROJECT and nothing else** — an older
 *   link from the *same* project has an identical host and passes, which is the
 *   ordinary case and the one §The confirm phase can go red is about. Stated
 *   narrowly on purpose: this gate cannot be the reason you stop checking.
 *
 * **Gates refuse; assertions measure.** All eleven assertions are evidence about
 * `signUp` and the callback, and none of them is input validation — that is what
 * the five gates are for, and it is why the count means what it says.
 *
 * ## Running it
 *
 *   NODE_USE_ENV_PROXY=1 RELAY_UPSTREAM=https://<prod ref>.supabase.co \
 *     node scripts/supabase-relay.mjs &
 *   NEXT_PUBLIC_SUPABASE_URL=http://localhost:3001 \
 *     NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable> NODE_USE_ENV_PROXY=1 npm run dev &
 *
 *   export PROBE_SUPABASE_URL=https://<prod ref>.supabase.co
 *   export PROBE_SUPABASE_ANON_KEY=<publishable>
 *   export PROBE_OWNED_MAILBOX=you@gmail.com PROBE_PASSWORD=<anything>
 *
 *   node scripts/probes/signup-confirmation.mjs signup you+pd252-1@gmail.com
 *   # read the mail, then — same browser storage, because the flow is PKCE:
 *   node scripts/probes/signup-confirmation.mjs confirm '<the link in the mail>'
 *
 * **Nothing ties `PROBE_SUPABASE_URL` to the `NEXT_PUBLIC_SUPABASE_URL` the dev
 * server was started with**, and that is a gate which does not gate rather than a
 * silent hazard: a mismatch fails loudly, because the signup phase then drives an
 * app talking to a different project and its assertions go red.
 *
 * **Delete the account afterwards.** Both phases print the SQL. There is no
 * teardown phase because the operator, not this script, holds the credential that
 * can remove an `auth.users` row.
 *
 * **The two phases share `storageState`, and that is not a convenience.** The
 * client is `flowType: 'pkce'`, so `signUp` leaves a `code_verifier` in the
 * browser's storage and `/auth/callback` needs it back. A confirmation link
 * opened in a *different* browser than the one that signed up has no verifier and
 * cannot complete — a real product property, not an artifact of this script, and
 * the direct evidence for PD-233's still-inert `/auth/confirm` route. The file
 * holds a live session once `confirm` has run, so `confirm` deletes it and
 * `.gitignore` carries `.probe/`.
 *
 * ## The confirm phase can go red without the arm being broken — read this first
 *
 * **What is known, from five runs against PROD on 2026-08-28.** Four `confirm`
 * phases ran within about a minute to two and a half minutes of the mail and
 * were green. **One, about five minutes after the mail, was `4/6`** — "the
 * exchange completes" ok, then "the rider is signed in" and "sent into
 * onboarding" both FAIL, rider on `/auth/login`. GoTrue's `verify` was clean on
 * that run and handed back a `code`; the step that failed was
 * `exchangeCodeForSession`, inside the app.
 *
 * **What is NOT known: whether a delayed click fails reproducibly.** The
 * experiment — sign up, wait, confirm — could not be completed here, because
 * PROD's mail stopped being delivered part way through (see below). So do not
 * read the green runs as showing a delayed click is safe, and do not read the
 * red one as showing it is broken. **PD-337 holds that question and the
 * experiment.**
 *
 * **A tempting explanation that does NOT work, recorded so it is not re-derived.**
 * On both runs whose timestamps were read, something followed the single-use link
 * about twenty seconds after delivery, before the mailbox was opened
 * (`last_sign_in_at` at `confirmation_sent_at` + 23s on one, `email_confirmed_at`
 * at + 18.5s on the other). That is real, and it is **not** the difference between
 * the green runs and the red one, because it happened on the green runs too — a
 * cause present in both explains neither. The one variable that differed is
 * elapsed time.
 *
 * It does say *where* the follower lives: on the run whose mail was never
 * delivered, `confirmation_sent_at` was stamped and `email_confirmed_at` stayed
 * NULL for nine minutes. **No mail, no follow** — so whatever follows the link is
 * downstream of delivery rather than inside GoTrue.
 *
 * **So: a red confirm phase is not to be waved through.** Read the
 * `the exchange was refused — <status> <body>` detail the assertion prints — that
 * is GoTrue's own answer, captured off the wire, and the only place the reason
 * survives, because `callbackFailureDestination` returns a constant and GoTrue's
 * `error_code` arrives in a fragment `router.replace` discards. Then say which
 * you have. The signup phase is unaffected; it touches no link.
 *
 * ## The signup phase goes green whether or not the mail is ever delivered
 *
 * Measured the same day: a signup whose `confirmation_sent_at` was stamped at
 * 09:27:03 produced **no mail at all**, nine minutes later and counting, against
 * four that had been delivered in the preceding two hours. The likely cause is a
 * send limit on Supabase's built-in SMTP and it is **not established** — what is
 * established is that GoTrue recorded a send and nothing arrived.
 *
 * Nothing in the app or in this probe can see that: `signUp` returns the same
 * `{ sent: true }`, the same screen renders, and the phase reports `5/5`. **So
 * "5/5" means the arm ran, never that a rider got mail.** PD-108 (custom SMTP)
 * is where that belongs.
 *
 * ## What it cannot cover from this container
 *
 * `app.letsride.social:443` is refused by the agent proxy — `403` to `CONNECT`,
 * in `recentRelayFailures`, measured 2026-08-27 — so the deployed production
 * bundle cannot be driven from a session at all. The app under test is therefore
 * the local dev server, and **the deployed bundle remains unexercised against the
 * production auth server.**
 *
 * One consequence is visible and is printed rather than hidden:
 * `canonicalOrigin()` resolves to `http://localhost:3000`, which is **not** on
 * PROD's redirect allowlist (`docs/ENVIRONMENTS.md` §The redirect allowlist — it
 * was removed on 2026-08-11), so GoTrue discards the `redirect_to` and
 * substitutes the Site URL. `confirm` reports where the link actually points, and
 * then drives the app with the callback URL an allowlisted origin **would** have
 * produced. That reconstruction is an inference from the allowlist, not an
 * observation: what was observed is the substituted URL. The `code` itself is
 * GoTrue's own and unmodified — only the address it was delivered to is restored.
 */
import { chromium } from 'playwright-core'
import { readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const EXECUTABLE =
  process.env.PROBE_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const BASE = process.env.PROBE_BASE ?? 'http://localhost:3000'
const STATE = process.env.PROBE_STATE ?? '.probe/pd252-storage.json'

const [phase, argument] = process.argv.slice(2)
if (phase !== 'signup' && phase !== 'confirm') {
  console.error('usage: signup-confirmation.mjs signup <address> | confirm <link>')
  process.exit(2)
}

const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const refuse = (why) => {
  console.error(`refusing: ${why}`)
  process.exit(1)
}

const supabaseUrl = process.env.PROBE_SUPABASE_URL
const anonKey = process.env.PROBE_SUPABASE_ANON_KEY
const ownedMailbox = process.env.PROBE_OWNED_MAILBOX
const password = process.env.PROBE_PASSWORD
// Gate 4, and the only one that exits **2** rather than 1: the others refuse a
// value, this one reports that the invocation was never usable. Anything
// scripting this should treat 2 as "fix the command" and 1 as "it said no".
if (!supabaseUrl || !anonKey || !ownedMailbox || !password) {
  console.error(
    'Set PROBE_SUPABASE_URL, PROBE_SUPABASE_ANON_KEY, PROBE_OWNED_MAILBOX and PROBE_PASSWORD.\n' +
      'See the header — each one is a gate, and each fails closed.'
  )
  process.exit(2)
}

// Gate 1. The project has to be named, not merely reached: pointed at the relay
// this would gate on a property of whatever that relay forwards to.
const projectRef = /^https:\/\/([a-z]{20})\.supabase\.co$/.exec(supabaseUrl.replace(/\/$/, ''))?.[1]
if (!projectRef) {
  refuse(
    `PROBE_SUPABASE_URL must be a project URL — https://<ref>.supabase.co — and is ${supabaseUrl}.\n` +
      'This script talks to the project directly; the relay is for the browser only, and a\n' +
      'relay URL names no project, so nothing here could say what it was about to write to.'
  )
}

// Gate 2. Read off the server rather than trusting decision #6 — that is the
// whole lesson the arm below exists to record.
const settings = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: anonKey } })
  .then((r) => r.json())
  .catch((e) => ({ error: String(e) }))
if (settings.mailer_autoconfirm !== false) {
  refuse(
    `${projectRef} reports mailer_autoconfirm=${JSON.stringify(settings.mailer_autoconfirm)}.\n` +
      'This probe is only meaningful where email confirmation is ON — anywhere else the\n' +
      'branch it exists to exercise is unreachable and a green run proves nothing.'
  )
}
console.log(`project ${projectRef} — confirmation is ON, so the arm is reachable`)
console.log(`the app under test is ${BASE}`)

const cleanup = (address) =>
  console.log(
    `\nDELETE THE ACCOUNT when you are done — this is a production auth server:\n` +
      `  delete from auth.users where email = '${address}';   -- on ${projectRef}\n` +
      '  (then trash the mail; PD-91 and PD-252 both finished at 0 residue)'
  )

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
  // Gate 3. Both halves of the owned address, not just the local part: a typo'd
  // domain mails a stranger exactly as a typo'd local part does.
  const [ownedLocal, ownedDomain] = ownedMailbox.split('@')
  const permitted =
    ownedDomain && address && new RegExp(`^${escapeRe(ownedLocal)}\\+[^@]+@${escapeRe(ownedDomain)}$`).test(address)
  if (!permitted) {
    await browser.close()
    refuse(
      `the address must be ${ownedLocal}+something@${ownedDomain ?? '<domain>'}, and is ${address ?? '(none)'}.\n` +
        (ownedDomain
          ? ''
          : 'PROBE_OWNED_MAILBOX must be a whole address (you@example.com), not a local part.\n') +
        'A confirmation-on server emails whoever owns whatever is typed — including on a\n' +
        'duplicate, which GoTrue answers with success and a mail rather than an error. A bare\n' +
        '"+", or a local part alone, would let one typo mail a stranger from production.'
    )
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()

  console.log(`\nconfirmation-on signup (${address}):`)
  await page.goto(`${BASE}/auth/signup`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[name="email"]')
  await page.fill('input[name="email"]', address)
  await page.fill('input[name="password"]', password)
  // Controlled, and the submit stays disabled until it is ticked.
  await page.click('label:has(input[name="acceptedTerms"])')
  await page.click('button[type="submit"]')

  await page
    .waitForFunction(() => /Check your email/i.test(document.body.textContent ?? ''), null, {
      timeout: 30_000,
    })
    .catch(() => {})

  const body = (await page.textContent('body')) ?? ''
  const alerts = (
    await page.$$eval('[role="alert"]', (ns) => ns.map((n) => n.textContent.trim()).filter(Boolean))
  ).join(' | ')

  // The first two assertions are the arm itself; the rest separate it from the
  // failures it is easily mistaken for — an error alert, a redirect into
  // onboarding (which is the confirmation-OFF arm), and a form still on screen
  // (the action returned nothing at all).
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

  mkdirSync(path.dirname(STATE), { recursive: true })
  await context.storageState({ path: STATE })
  console.log(`\nbrowser storage saved to ${STATE} (holds the PKCE code_verifier)`)
  console.log(`now open the mail sent to ${address} and run:`)
  console.log(`  node scripts/probes/signup-confirmation.mjs confirm '<link>'`)
  cleanup(address)
  await context.close()
}

if (phase === 'confirm') {
  const link = argument
  if (!link) {
    await browser.close()
    console.error('usage: signup-confirmation.mjs confirm <the link in the confirmation mail>')
    process.exit(2)
  }
  if (!existsSync(STATE)) {
    await browser.close()
    refuse(`no ${STATE} — run the signup phase first; the PKCE verifier lives in it.`)
  }

  // Gate 5 (see the header), and it is a gate rather than an assertion because it has to run
  // BEFORE the request below: a `report()` here would already have handed the
  // pasted host a token, and would then let the run continue and drive the app
  // with a code from a foreign origin. Every other gate in this file refuses,
  // and so does this one.
  if (new URL(link).host !== `${projectRef}.supabase.co`) {
    await browser.close()
    refuse(
      `the link is on ${new URL(link).host}, not ${projectRef}.supabase.co.\n` +
        'That is a different project from the one this run gated on. (An older link from the\n' +
        'SAME project has the same host and is not caught here — only the run itself can be.)'
    )
  }

  console.log('\nconfirmation link:')
  // Resolved with Node rather than in the browser: this hop is the auth server,
  // and Supabase is the one host Chromium in this container cannot reach.
  const verify = await fetch(link, { redirect: 'manual' })
  const location = verify.headers.get('location')
  console.log(`  GoTrue answered ${verify.status} -> ${location}`)
  report(
    verify.status >= 300 && verify.status < 400 && Boolean(location),
    'the link is accepted',
    `status ${verify.status}`
  )
  if (!location) {
    await browser.close()
    process.exit(1)
  }

  const landing = new URL(location)
  // The query as well as the fragment: GoTrue puts a refused `type=signup` in
  // the fragment, but a PKCE failure can come back on either, and the absence of
  // a `code` below is what actually catches both.
  const errorSomewhere = /error(_code|_description)?=/.test(landing.hash + landing.search)
  report(!errorSomewhere, 'it reports no error', `on the link: ${landing.hash}${landing.search}`)
  const code = landing.searchParams.get('code')
  report(
    Boolean(code),
    'it carries a PKCE code for /auth/callback to exchange',
    `no ?code= on ${landing.origin}${landing.pathname}`
  )
  if (!code) {
    await browser.close()
    process.exit(1)
  }

  // **Where the link points is the redirect allowlist's answer, not this arm's,
  // and the two must not be conflated — so it is printed and deliberately NOT
  // asserted.** `signUp` asks GoTrue for `<origin>/auth/callback?next=/postcards`.
  // On production that origin is `https://app.letsride.social`, which is
  // allowlisted, so the rider gets that URL. Run from this container the origin
  // is `http://localhost:3000`, which PROD's allowlist deliberately does not
  // carry — so GoTrue discards the whole `redirect_to`, path and all, and
  // substitutes the Site URL.
  //
  // An assertion here would have to name the expected Site URL, which is a fact
  // about the project's dashboard that this script cannot read; a check written
  // against `BASE` alone passes for every foreign origin and is worse than none.
  // What IS asserted is the link's own host, above — that is checkable and is
  // the property that says this mail came from the project just gated on.
  const expected = `${BASE}/auth/callback?next=/postcards`
  if (`${landing.origin}${landing.pathname}` !== `${BASE}/auth/callback`) {
    console.log(
      `  redirect_to was substituted: the app asked for ${expected}\n` +
        `  and GoTrue answered ${landing.origin}${landing.pathname} — this origin is not on the\n` +
        "  project's allowlist, so the whole redirect_to was discarded. Reconstructing the\n" +
        '  callback URL an allowlisted origin WOULD have produced — an inference from the\n' +
        "  allowlist, not an observation. The code below is GoTrue's, unmodified."
    )
  }
  const rewritten = `${expected}&code=${encodeURIComponent(code)}`
  console.log(`  driving the app under test with ${rewritten}`)

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: JSON.parse(readFileSync(STATE, 'utf8')),
  })
  const page = await context.newPage()
  // **The one place the reason for a refused exchange survives, and it is read by
  // INTERCEPTING rather than by listening.**
  //
  // A `page.on('response')` listener cannot do this reliably, measured rather
  // than assumed: Playwright does not await an async handler, and by the time
  // `res.text()` returns, the app's own `router.replace` has navigated and
  // Chromium has discarded the body — the status survives, the body comes back
  // `<body unreadable>`, and the body is the half that carries `error_code` and
  // `msg`. Intercepting has the body in hand before the page ever sees the
  // response. Three for three in a harness that reproduces the navigation.
  //
  // First answer wins: after the bounce to `/auth/login` a refresh attempt can
  // produce a second `/auth/v1/token` 4xx, which is a different question and must
  // not overwrite this one.
  //
  // Only error bodies are kept. GoTrue's 4xx for `grant_type=pkce` is
  // `{code, error_code, msg}` — the `code` and `code_verifier` travel in the
  // request and are never echoed back — so no token can reach stdout this way.
  let exchangeFailure = null
  await page.route('**/auth/v1/token*', async (route) => {
    const res = await route.fetch().catch(() => null)
    if (!res) return route.abort()
    const body = await res.text().catch(() => '<body unreadable>')
    if (res.status() >= 400 && !exchangeFailure) {
      exchangeFailure = `${res.status()} ${body}`.slice(0, 300)
    }
    await route.fulfill({ response: res, body })
  })

  await page.goto(rewritten, { waitUntil: 'domcontentloaded' })
  // Waits for the guard to settle rather than sleeping a fixed interval: the
  // exchange and then `my_onboarding_state()` are two round trips to eu-west-1,
  // and a fixed wait fails as "the exchange did not complete" when it was merely
  // slow. `/postcards` is in the list because it is where `next` sends the rider
  // before the guard moves them on.
  await page
    .waitForFunction(
      () => !/^\/(auth\/callback|postcards)?$/.test(location.pathname),
      null,
      { timeout: 30_000 }
    )
    .catch(() => {})

  const landed = new URL(page.url()).pathname
  report(landed !== '/auth/callback', 'the exchange completes', 'still on "Signing you in"')
  report(
    landed !== '/auth/login',
    'the rider is signed in',
    // GoTrue's own answer to the exchange, captured off the wire above.
    //
    // **The landing URL is useless here and saying otherwise was wrong.**
    // `callbackFailureDestination` returns one of two constants and
    // discriminates on `next`, never on the cause — with `next=/postcards`
    // hardcoded above it is always `/auth/login?error=invalid_confirmation`.
    // `/auth/callback`'s own header records that GoTrue puts `error_code` in the
    // **fragment**, which `router.replace` then discards. So the only place the
    // reason survives is the token response itself, captured above.
    `the exchange was refused — ${exchangeFailure ?? 'no /token response was seen at all'}`
  )
  report(
    landed === '/onboarding/terms',
    'and is sent into onboarding at the consent step',
    `landed on ${landed}; a confirmed rider with no terms stamp belongs on /onboarding/terms`
  )
  await context.close()
  // Not because it holds a session — it does not, and on this arm never could:
  // the exchange's tokens were in the context just closed. It holds the PKCE
  // verifier `signUp` wrote, which has now been spent, and a spendable verifier
  // for a production account is not a thing to leave on disk.
  rmSync(STATE, { force: true })
  console.log(`\n${STATE} deleted (it held the spent PKCE verifier)`)
  console.log('remember the account itself:')
  cleanup('<the address you signed up with>')
}

await browser.close()
console.log(`\n${ran - bad}/${ran} ok`)
process.exit(bad ? 1 : 0)
