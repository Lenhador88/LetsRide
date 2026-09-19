import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The service-role key bypasses every RLS policy in the schema. `CLAUDE.md`
 * §What Not To Do puts it plainly — "don't introduce a service-role key into
 * the app" — and decision #8 explains what it would cost: every visibility rule
 * currently living in the policy set, reimplemented in application code where an
 * unstated rule fails silently instead of loudly.
 *
 * `supabase/functions/delete-account/` needs one, and that is allowed precisely
 * because **the function is not the app**. This test is what keeps that
 * distinction real rather than a sentence in a comment: the key may exist in the
 * function's own secret store, and nowhere this repo can reach.
 *
 * ---------------------------------------------------------------------------
 * PD-303 widened it from one secret format to three
 * ---------------------------------------------------------------------------
 * `push-notify` holds the largest secret set in the repository — the APNs auth
 * key (`.p8`, a PEM private key block) and the FCM service-account JSON, on top
 * of the service-role key it shares with `delete-account`. Design D11 rules on
 * that explicitly: rule 1, *the key lives only in the function's secret store*,
 * **applies and widens**, and this file gains a detector per format.
 *
 * The `.p8` is the one worth being nervous about. It is a short file that looks
 * like configuration, it arrives from App Store Connect as a download rather
 * than as a dashboard string, and the natural thing to do with a downloaded file
 * is to put it next to the code that uses it. It also cannot be rotated without
 * re-signing every push for the team.
 *
 * It is a source scan, not a secret scanner. It cannot prove a key is absent
 * from git history or from someone's shell; it catches the ordinary case, which
 * is a key pasted into a file while debugging and committed by accident. That is
 * the case that has actually happened to other projects, and it is the one no
 * reviewer catches twice.
 *
 * ---------------------------------------------------------------------------
 * Comment lines are stripped first, and that is not a convenience
 * ---------------------------------------------------------------------------
 * `CLAUDE.md` calls this repo's most-repeated measurement error by name: a
 * file's description of what it must not contain looks exactly like the thing it
 * must not contain, so any grep for a forbidden pattern counts its own warnings.
 * It has produced a wrong number four times here. The rule it draws is followed
 * below — exclude comment lines, and **verify the filter both ways**: that it
 * reads zero now, and that it still catches a real instance. The second half is
 * the last test in this file, and without it a detector that matches nothing at
 * all would pass silently for ever.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

/** This file legitimately contains every pattern it hunts for. */
const SELF = path.resolve(here, 'no-service-role-key.test.ts')

// `ios` joined this list on 2026-08-25, when the native project was first
// committed. It is the strongest case on the list rather than the weakest: a
// bundle is a file on thousands of devices and cannot be revoked, and
// `cap sync` WRITES into that tree without asking — it emits
// `App/App/capacitor.config.json`, which carries the whole config and is
// gitignored today by the template alone. Nothing else re-checks that.
const SCANNED_DIRS = ['src', 'scripts', 'ios']
const SCANNED_FILES = ['.env.local.example', 'vercel.json', 'next.config.ts']
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage'])

/**
 * The web bundle `cap sync` copies into the native project.
 *
 * Skipped for two reasons, and the second is the one that bites. It is
 * **derived** from `src/`, which this file already walks, so scanning it again
 * checks the same source twice. And it exists only on a machine that has run
 * `cap sync` — it is gitignored, so CI never sees it — which made the suite's
 * total jump by 418 locally and stay put on the runner. A test count that
 * depends on whether someone has built the app is one `docs:check` cannot pin,
 * and `docs/HANDOFF.md`'s Unit tests row already carries the smaller version of
 * this trap for a leftover scratch script.
 *
 * The tracked files under `ios/` are the point of scanning it at all — a
 * hand-added `.plist` or `.xcconfig` carrying a key — and those are all outside
 * this directory.
 */
const SKIP_PATHS = [path.resolve(repoRoot, 'ios', 'App', 'App', 'public')]

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  if (SKIP_PATHS.some((skip) => dir === skip || dir.startsWith(skip + path.sep))) return out
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/**
 * Strip whole-line comments in every syntax this repo commits: `//`, `#`, `--`,
 * and `*` continuation lines inside a block comment. Deliberately conservative —
 * it only strips lines that are ENTIRELY a comment, so `const k = '...' // note`
 * is still scanned. Hiding a key behind a trailing comment should not work.
 */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (t === '') return false
      // A PEM armour line begins `-----`, which the SQL rule below reads as a
      // comment — so a `.p8` pasted into a scanned file on its own lines was
      // stripped before the detector ever saw it. Found by the both-ways check
      // at the bottom of this file, which is the whole reason that check
      // exists: the detector read zero and the file was not clean.
      //
      // Narrow on purpose. `--` really does start a comment in SQL and in a
      // `.xcconfig`, and widening this to "any line of dashes" would hand back
      // the comment trap it is carved out of.
      if (/^-----(BEGIN|END) /.test(t)) return true
      return !(
        t.startsWith('//') ||
        t.startsWith('#') ||
        t.startsWith('--') ||
        t.startsWith('*') ||
        t.startsWith('/*') ||
        t.startsWith('{/*')
      )
    })
    .join('\n')
}

/** A JWT: three base64url segments, payload starting `eyJ`. */
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g

/**
 * A PEM private key block, in every label OpenSSL and App Store Connect emit.
 *
 * The APNs `.p8` is `BEGIN PRIVATE KEY` (PKCS#8, unlabelled algorithm), which
 * is the least distinctive of the set — matching only `EC PRIVATE KEY` or
 * `RSA PRIVATE KEY` would miss the exact file this detector was added for.
 * The label group is optional for that reason.
 */
const PEM_PRIVATE_KEY = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/

/**
 * A Google service-account JSON, matched on the two fields that only ever
 * appear together in a real credential file.
 *
 * `"type": "service_account"` alone would fire on documentation describing the
 * file; `private_key` alone is a common-enough field name. Requiring both,
 * after comment lines are stripped, is what makes this specific to a credential
 * that was actually pasted in. Whitespace is allowed around the colon because
 * a key pasted from the console is pretty-printed and a key pasted from an
 * environment variable is not.
 */
const GOOGLE_SERVICE_ACCOUNT_TYPE = /"type"\s*:\s*"service_account"/
const GOOGLE_SERVICE_ACCOUNT_KEY = /"private_key"\s*:/

/**
 * PD-457's format: a mail provider's API key.
 *
 * `send-moderation-digest` is the app's first mail sender and it holds a
 * provider key on the same terms as every other secret here — the function's
 * own store, and nowhere this repository can reach. The key is the least
 * dangerous of the four formats in this file by blast radius (it can send mail
 * as us; it cannot read the database) and the **most** likely to be pasted
 * somewhere while debugging, because it arrives as a short dashboard string
 * rather than as a downloaded file.
 *
 * **Three formats, because the provider is an assumption rather than a
 * decision.** `design.md` D7 recommends Resend and names Brevo as the pick if
 * EU residency must hold from the first mail, and both are one `fetch` behind
 * `mail.ts`. SendGrid is here because it is the most-guessed alternative, not
 * because anything proposes it. Each prefix is distinctive enough to need no
 * second condition.
 *
 * **Postmark is deliberately absent and that is a real gap**: its server token
 * is a bare UUID, which is indistinguishable from the several hundred uuids in
 * this repository's tests and fixtures. A pattern matching it would fire on
 * every one of them, and a detector that has to be suppressed everywhere is a
 * detector nobody keeps. If Postmark is ever chosen, the honest move is to
 * match its variable *name* rather than its value.
 */
const MAIL_PROVIDER_KEYS: Array<[RegExp, string]> = [
  [/\bre_[A-Za-z0-9]{20,}\b/, 'a Resend API key literal'],
  [/\bxkeysib-[A-Za-z0-9]{20,}/, 'a Brevo API key literal'],
  [/\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'a SendGrid API key literal'],
]

/**
 * Every way a service-role credential shows up, checked against real code
 * rather than imagined:
 *
 *   - `sb_secret_…`      — the current Supabase secret-key format
 *   - a JWT whose payload decodes to `"role":"service_role"` — the legacy format,
 *     and the one that looks harmless because it looks like the publishable key
 *   - `service_role` as a bare identifier in live code
 *   - a `NEXT_PUBLIC_*` variable whose name mentions the secret, which would ship
 *     it in the bundle even if the value were injected at build time
 */
function findViolations(source: string): string[] {
  const found: string[] = []
  const code = stripCommentLines(source)

  if (/sb_secret_[A-Za-z0-9_-]+/.test(code)) found.push('an sb_secret_ key literal')

  for (const jwt of code.match(JWT) ?? []) {
    const payload = jwt.split('.')[1]
    let decoded = ''
    try {
      decoded = Buffer.from(payload, 'base64url').toString('utf8')
    } catch {
      continue
    }
    if (decoded.includes('service_role')) found.push('a JWT whose payload claims service_role')
  }

  if (/\bservice_role\b/.test(code)) found.push('the identifier service_role')
  if (/NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(code)) found.push('a NEXT_PUBLIC_ service-role variable')

  // PD-303's two formats. See D11 rule 1.
  if (PEM_PRIVATE_KEY.test(code)) found.push('a PEM private key block')
  if (GOOGLE_SERVICE_ACCOUNT_TYPE.test(code) && GOOGLE_SERVICE_ACCOUNT_KEY.test(code)) {
    found.push('a Google service-account credential')
  }

  // PD-457's format. See MAIL_PROVIDER_KEYS.
  for (const [pattern, label] of MAIL_PROVIDER_KEYS) {
    if (pattern.test(code)) found.push(label)
  }

  return found
}

describe('the service-role key never reaches the app', () => {
  const targets = [
    ...SCANNED_DIRS.flatMap((d) => walk(path.join(repoRoot, d))),
    ...SCANNED_FILES.map((f) => path.join(repoRoot, f)),
  ].filter((f) => existsSync(f) && f !== SELF)

  it('scans a non-trivial number of files, so a broken walk fails loudly', () => {
    // Without this, a bad path makes every assertion below pass over an empty
    // list — the failure mode where a guard reports success having checked
    // nothing at all.
    expect(targets.length).toBeGreaterThan(50)
  })

  it.each(targets.map((f) => [path.relative(repoRoot, f), f]))(
    '%s holds no service-role credential',
    (_label, file) => {
      let source: string
      try {
        source = readFileSync(file, 'utf8')
      } catch {
        return // binary or unreadable; nothing to scan
      }
      expect(findViolations(source)).toEqual([])
    },
  )

  it('the Edge Function is the one place allowed to name the key, and it does not inline one', () => {
    const fn = path.join(repoRoot, 'supabase/functions/delete-account/index.ts')
    expect(existsSync(fn)).toBe(true)
    const source = readFileSync(fn, 'utf8')

    // It reads the key from the environment...
    expect(source).toMatch(/Deno\.env\.get\('SERVICE_ROLE_KEY'\)/)
    // ...and never carries one.
    const code = stripCommentLines(source)
    expect(/sb_secret_[A-Za-z0-9_-]+/.test(code)).toBe(false)
    expect((code.match(JWT) ?? []).length).toBe(0)
  })

  /**
   * PD-303. `push-notify` holds three secrets rather than one, and none of them
   * may be in the file. The env-var assertions are the half that would survive
   * a careless edit; the literal assertions are the half that matters.
   */
  it('the push sender reads all three secrets from the environment and inlines none', () => {
    const fn = path.join(repoRoot, 'supabase/functions/push-notify/index.ts')
    expect(existsSync(fn)).toBe(true)
    const source = readFileSync(fn, 'utf8')

    expect(source).toMatch(/Deno\.env\.get\('SERVICE_ROLE_KEY'\)/)
    expect(source).toMatch(/Deno\.env\.get\('APNS_KEY'\)/)
    expect(source).toMatch(/Deno\.env\.get\('FCM_SERVICE_ACCOUNT'\)/)

    const code = stripCommentLines(source)
    expect(findViolations(code).filter((v) => v !== 'the identifier service_role')).toEqual([])
    expect((code.match(JWT) ?? []).length).toBe(0)
  })

  /**
   * Design D11's fifth rule, which `delete-account` did not need: the whole
   * database reach of a service-role function is a list of RPC names. A
   * `.from()` here makes the key a general-purpose bypass of every policy in
   * the schema, which is the layer this project's bugs come from.
   */
  it('the push sender issues no .from(), so the service-role key reaches no table directly', () => {
    const source = readFileSync(
      path.join(repoRoot, 'supabase/functions/push-notify/index.ts'),
      'utf8',
    )
    const code = stripCommentLines(source)
    expect(code).not.toMatch(/\.from\(/)

    // And the filter reads the other way: the pattern does match when it is
    // there, so a zero above is a clean file rather than a broken regex.
    expect(/\.from\(/.test("db.from('push_devices')")).toBe(true)
  })

  /**
   * PD-457. The digest sender holds four secrets — the service-role key plus a
   * provider key, a recipient and a sender — across two files, because the
   * provider doorway (`mail.ts`) deliberately holds the three mail ones and
   * `index.ts` holds none of them.
   *
   * **The `.from()` rule binds harder here than it did for `push-notify`.** Four
   * of this function's five sources have `service_role`'s grants revoked
   * (`076` §3b), so a `.from()` would answer `42501` rather than leaking — and
   * the reading that matters is not *grant it back for the digest* but *the
   * reach is a list of RPC names*. A future change wanting a table wants an RPC.
   */
  it('the digest sender reads its four secrets from the environment and inlines none', () => {
    const dir = path.join(repoRoot, 'supabase/functions/send-moderation-digest')
    const entry = readFileSync(path.join(dir, 'index.ts'), 'utf8')
    const doorway = readFileSync(path.join(dir, 'mail.ts'), 'utf8')

    expect(entry).toMatch(/Deno\.env\.get\('SERVICE_ROLE_KEY'\)/)
    expect(doorway).toMatch(/Deno\.env\.get\('MAIL_PROVIDER_API_KEY'\)/)
    expect(doorway).toMatch(/Deno\.env\.get\('DIGEST_RECIPIENT'\)/)
    expect(doorway).toMatch(/Deno\.env\.get\('DIGEST_SENDER'\)/)

    // The provider key lives in `mail.ts` alone. `index.ts` never sees it, which
    // is what makes swapping provider a one-file diff (D7).
    expect(stripCommentLines(entry)).not.toMatch(/MAIL_PROVIDER_API_KEY/)

    for (const source of [entry, doorway]) {
      const code = stripCommentLines(source)
      expect(findViolations(code).filter((v) => v !== 'the identifier service_role')).toEqual([])
      expect((code.match(JWT) ?? []).length).toBe(0)
    }
  })

  it('the digest sender issues no .from(), in either of its files', () => {
    const dir = path.join(repoRoot, 'supabase/functions/send-moderation-digest')
    for (const file of ['index.ts', 'mail.ts', 'shape.ts']) {
      const code = stripCommentLines(readFileSync(path.join(dir, file), 'utf8'))
      expect(code, file).not.toMatch(/\.from\(/)
    }

    // Both ways. `CLAUDE.md`'s `:[0-9]+:` comment filter is for `grep -rn` over
    // a tree; `grep -n` on a single file prints no path, so the natural command
    // silently reports the unfiltered number. This assertion is the anchor that
    // does not depend on getting that right.
    expect(/\.from\(/.test("db.from('postcard_reports')")).toBe(true)
  })

  it('the digest sender takes no request body, so there is no recipient to redirect', () => {
    const code = stripCommentLines(
      readFileSync(
        path.join(repoRoot, 'supabase/functions/send-moderation-digest/index.ts'),
        'utf8',
      ),
    )
    // N3. No body, no query string, no recipient parameter — the address is read
    // inside `mail.ts` and never passed in, so a caller who somehow got past the
    // service-role check still cannot say where a digest goes.
    expect(code).not.toMatch(/req\.json\(/)
    expect(code).not.toMatch(/req\.text\(/)
    expect(code).not.toMatch(/new URL\(req\.url\)/)
    expect(code).not.toMatch(/searchParams/)
  })

  it('the push sender takes no id from the request, because it takes no request body at all', () => {
    // D11 rule 2: `delete-account`'s "takes no user id" is replaced by
    // something stronger here — no rider calls this function, so there is no
    // body, no query string and no id of any kind. The subject set comes from
    // `claim_push_batch`.
    const source = readFileSync(
      path.join(repoRoot, 'supabase/functions/push-notify/index.ts'),
      'utf8',
    )
    const code = stripCommentLines(source)
    expect(code).not.toMatch(/req\.json\(\)/)
    expect(code).not.toMatch(/req\.text\(\)/)
    expect(code).not.toMatch(/searchParams/)
  })

  it('takes no user id from the request, which is what makes it safe to expose', () => {
    // Design D1: a service-role endpoint that accepts an id is
    // account-deletion-as-a-service for whoever finds the URL.
    //
    // **PD-102 (2026-08-16) made the strict "no body read at all" version of
    // this control false, on purpose** — `req.json()` now reads the D6
    // re-authentication proof, so the assertion moved from "the body is never
    // read" to the actual invariant D1 states: the body never supplies an
    // IDENTIFIER. `uid` is pinned to `subject.id`, which comes from the
    // verified JWT four lines above and nowhere else, and the body is read
    // only into a `password` field that is never used to select an account.
    const source = readFileSync(
      path.join(repoRoot, 'supabase/functions/delete-account/index.ts'),
      'utf8',
    )
    const code = stripCommentLines(source)

    expect(code).not.toMatch(/req\.text\(\)/)
    expect(code).not.toMatch(/searchParams/)

    // No id-shaped field is ever read off the parsed body — the one thing
    // read out of it is `password`.
    expect(code).not.toMatch(/body\.(id|uid|sub|subject|user_id|userId|email)\b/)

    // `uid` is assigned exactly once, from the verified subject, and never
    // reassigned from anything the request supplied.
    const uidAssignments = code.match(/\buid\s*=/g) ?? []
    expect(uidAssignments).toHaveLength(1)
    expect(code).toMatch(/const uid = subject\.id/)
  })

  /**
   * The other half of the filter check. A detector that has quietly stopped
   * matching anything passes every assertion above, for ever, and looks exactly
   * like a clean repo. These are the real formats, not approximations.
   */
  it('the detector catches a real key in each of its formats', () => {
    expect(findViolations("const k = 'sb_secret_AbCdEf0123456789'")).toContain(
      'an sb_secret_ key literal',
    )

    // A genuine legacy service-role JWT shape: {"role":"service_role","iss":"supabase"}
    const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')
    const payload = Buffer.from(
      '{"iss":"supabase","role":"service_role","exp":2000000000}',
    ).toString('base64url')
    const jwt = `${header}.${payload}.c2lnbmF0dXJlc2lnbmF0dXJl`
    expect(findViolations(`const k = '${jwt}'`)).toContain(
      'a JWT whose payload claims service_role',
    )

    expect(findViolations('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=x')).toContain(
      'a NEXT_PUBLIC_ service-role variable',
    )

    // PD-303, format 2: the APNs `.p8`, exactly as App Store Connect emits it.
    // PKCS#8, so the BEGIN line carries no algorithm label — the case a
    // detector written from memory misses.
    const p8 = [
      '-----BEGIN PRIVATE KEY-----',
      'MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgRFVNTVlLRVlGT1JU',
      'RVNUSU5HT05MWU5PVFJFQUw=',
      '-----END PRIVATE KEY-----',
    ].join('\n')
    expect(findViolations(`const key = \`${p8}\``)).toContain('a PEM private key block')

    // The labelled variants too, so a swap to a different algorithm does not
    // walk past the guard.
    expect(findViolations('-----BEGIN EC PRIVATE KEY-----')).toContain('a PEM private key block')
    expect(findViolations('-----BEGIN RSA PRIVATE KEY-----')).toContain('a PEM private key block')

    // PD-303, format 3: an FCM service-account credential.
    const serviceAccount = JSON.stringify({
      type: 'service_account',
      project_id: 'letsride-dummy',
      private_key_id: '0123456789abcdef',
      private_key: '-----BEGIN PRIVATE KEY-----\\nDUMMY\\n-----END PRIVATE KEY-----\\n',
      client_email: 'dummy@letsride-dummy.iam.gserviceaccount.com',
    })
    expect(findViolations(`const fcm = ${serviceAccount}`)).toContain(
      'a Google service-account credential',
    )

    // Both fields are required together, so prose describing the file is not a
    // finding — otherwise this very repo's design docs would trip it and
    // somebody would weaken the detector to shut it up.
    expect(findViolations('the file has "type": "service_account" at the top')).toEqual([])

    // PD-457, format 4: a mail provider API key, in each of the three shapes
    // `MAIL_PROVIDER_KEYS` claims to match.
    expect(findViolations("const k = 're_AbCdEf0123456789GhIjKl'")).toContain(
      'a Resend API key literal',
    )
    expect(findViolations("const k = 'xkeysib-0123456789abcdef0123-AbCdEfGhIj'")).toContain(
      'a Brevo API key literal',
    )
    expect(
      findViolations("const k = 'SG.AbCdEf0123456789GhIjKl.MnOpQr0123456789StUvWx'"),
    ).toContain('a SendGrid API key literal')

    /**
     * And the Resend pattern does **not** fire on an ordinary identifier, which
     * is the false positive that would get it deleted. `re_` is three
     * characters; what makes the pattern specific is the twenty-plus mixed
     * alphanumerics after it with no underscore, which no readable name has.
     */
    expect(findViolations('const re_render = 1')).toEqual([])
    expect(findViolations('const re_exported_component_from_the_design_system = 1')).toEqual([])

    // And the comment strip works: the same key in a comment is not a finding.
    expect(findViolations("// never put an sb_secret_AbCdEf0123456789 here")).toEqual([])
    expect(findViolations('// -----BEGIN PRIVATE KEY----- goes in the secret store')).toEqual([])
    expect(findViolations("// the provider key looks like re_AbCdEf0123456789GhIjKl")).toEqual([])
    expect(findViolations('const ok = "publishable"')).toEqual([])
  })
})
