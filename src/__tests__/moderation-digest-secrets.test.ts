import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { SUPPORT_EMAIL } from '@/lib/support'

/**
 * `send-moderation-digest` names no email address, and that is what keeps two
 * addresses with different audiences from becoming one.
 *
 * ---------------------------------------------------------------------------
 * THE TWO ADDRESSES
 * ---------------------------------------------------------------------------
 * **`SUPPORT_EMAIL` is published.** It is in the App Store listing, on
 * `/legal/support`, on `/legal/terms` and `/legal/privacy` — a route a rider and
 * a store reviewer are invited to use (PD-300).
 *
 * **`DIGEST_RECIPIENT` is the product owner's private mailbox.** It receives
 * reports and rider feedback: who reported what, and free text a rider typed.
 *
 * PD-457 states the consequence of conflating them plainly — it would *"put a
 * private inbox in the App Store listing"*. The reverse is just as bad: routing
 * the moderation digest to the published address sends rider-authored content to
 * whatever forwarding chain the support alias happens to sit behind.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A TEST AND NOT A COMMENT
 * ---------------------------------------------------------------------------
 * **"Unconflatable by construction" would be an overstatement, so this file does
 * not make it.** A Deno file *can* resolve `../../src/lib/support.ts`; what
 * actually stops it is the deploy-artifact boundary — only this directory is
 * uploaded — plus this test. So the honest claim is *conflatable only by a
 * change CI catches*, which is weaker and still worth having.
 *
 * And the realistic failure is not a code change at all: the digest goes to
 * whatever address the owner puts in `DIGEST_RECIPIENT`, and no test can reach a
 * secret store. That one is answered in `docs/ENVIRONMENTS.md` beside the
 * secret, where somebody setting it will be looking. What this file covers is
 * the part that *is* in the repo: somebody re-typing the published address's
 * value into the function, or leaving a plausible-looking default in the doorway
 * so a deploy with no secrets appears to work.
 *
 * It also pins the stronger property that makes N46 true: the recipient has
 * **no default at all**, so an absent secret is a refusal to send rather than a
 * send to a placeholder. A digest that quietly mailed a placeholder inbox is the
 * worst available outcome — the reports leave the database and reach nobody.
 *
 * **Verified both ways**, per `CLAUDE.md`'s comment trap: the last case in each
 * group proves the detector still matches a real instance, because a pattern
 * that has quietly stopped matching passes for ever.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const fnDir = path.resolve(repoRoot, 'supabase/functions/send-moderation-digest')

/**
 * An email address.
 *
 * The local part requires at least one character and the domain requires a dot
 * and a two-letter-plus TLD, which is what keeps `jsr:@supabase/supabase-js@2`
 * out of the results — there is nothing before its `@`, and nothing that looks
 * like a TLD after it. The last case in the group below is what proves that
 * exclusion is a property of the pattern rather than a happy accident.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
    .join('\n')
}

const files = readdirSync(fnDir).filter((name) => name.endsWith('.ts'))

describe('the digest function names no address', () => {
  it('has the files this test thinks it has, so a rename fails loudly', () => {
    // A walk that silently found nothing would satisfy every assertion below.
    expect(files.sort()).toEqual(['index.ts', 'mail.ts', 'shape.ts'])
  })

  it.each(files)('%s contains no email-address literal', (name) => {
    const code = stripCommentLines(readFileSync(path.join(fnDir, name), 'utf8'))
    expect(code.match(EMAIL) ?? []).toEqual([])
  })

  it('does not name the published support address, by value or by symbol', () => {
    for (const name of files) {
      const code = stripCommentLines(readFileSync(path.join(fnDir, name), 'utf8'))
      expect(code, name).not.toContain(SUPPORT_EMAIL)
      expect(code, name).not.toContain('SUPPORT_EMAIL')
      // The domain on its own too: `reports@letsride.social` would pass both
      // checks above and still route rider content into the published chain.
      expect(code, name).not.toContain(SUPPORT_EMAIL.split('@')[1])
    }
  })

  it('reads the recipient from a secret with no fallback address', () => {
    const doorway = readFileSync(path.join(fnDir, 'mail.ts'), 'utf8')
    // `?? ''` and nothing else. An `?? 'someone@example.com'` would be the
    // failure this whole file exists to prevent, and it is the natural thing to
    // write while making a deploy "work".
    expect(doorway).toMatch(/Deno\.env\.get\('DIGEST_RECIPIENT'\)\s*\?\?\s*''/)
    expect(doorway).toMatch(/Deno\.env\.get\('DIGEST_SENDER'\)\s*\?\?\s*''/)
  })

  it('refuses to send when a secret is missing, rather than defaulting', () => {
    const doorway = stripCommentLines(readFileSync(path.join(fnDir, 'mail.ts'), 'utf8'))
    // The guard exists and runs before the provider call.
    expect(doorway).toMatch(/missingMailSecrets\(\)\.length\s*>\s*0/)
    expect(doorway.indexOf('missingMailSecrets().length')).toBeLessThan(doorway.indexOf('fetch('))
  })

  it('refuses before it claims, so an unset secret never spends an attempt', () => {
    const entry = stripCommentLines(readFileSync(path.join(fnDir, 'index.ts'), 'utf8'))

    // The CALL SITE, not the bare symbol. `missingMailSecrets` is also in the
    // import line at the top of the file, which sits above the claim — so a
    // pattern matching the name alone passes on a file whose guard was deleted,
    // which is the one direction that matters here.
    const guard = entry.search(/const missing = missingMailSecrets\(\)/)
    const claim = entry.indexOf("rpc('claim_moderation_digest'")

    // Both anchors must be real. `indexOf` answers -1 for a string that is gone,
    // and -1 is less than every position — so an ordering assertion on its own
    // passes loudest exactly when the guard has been deleted.
    expect(guard, 'the pre-claim guard').toBeGreaterThan(-1)
    expect(claim, 'the claim').toBeGreaterThan(-1)

    // The other order is the defect this pins: `sendDigestMail` refuses from
    // inside the send, by which point a batch is claimed and its `attempts`
    // incremented, and `NOT_CONFIGURED` classifies as `failed`. A function
    // deployed ahead of its secrets would walk real reports to the attempt cap.
    expect(guard).toBeLessThan(claim)

    // Both ways, per the file header: the import line alone must NOT satisfy the
    // guard pattern, or deleting the block leaves this test green for ever.
    const importOnly = "import { missingMailSecrets, sendDigestMail } from './mail.ts'"
    expect(importOnly).toContain('missingMailSecrets')
    expect(importOnly).not.toMatch(/const missing = missingMailSecrets\(\)/)
  })

  it('the recipient is never a parameter, so no call site can name an address', () => {
    // N3/N46. `sendDigestMail` takes the rendered mail and nothing else.
    const doorway = readFileSync(path.join(fnDir, 'mail.ts'), 'utf8')
    expect(doorway).toMatch(/export async function sendDigestMail\(mail: DigestMail\)/)

    const entry = stripCommentLines(readFileSync(path.join(fnDir, 'index.ts'), 'utf8'))
    expect(entry).toMatch(/sendDigestMail\(renderDigest\(entries\)\)/)
  })

  /**
   * Both ways. Without this the group above passes on a pattern that matches
   * nothing, on a directory that is empty, or on a `stripCommentLines` that ate
   * the whole file.
   */
  it('the detectors still catch a real instance', () => {
    expect('a real address is reports@letsride.social here'.match(EMAIL)).toEqual([
      'reports@letsride.social',
    ])
    expect(SUPPORT_EMAIL).toMatch(EMAIL)

    // The jsr specifier is not an address — the exclusion this pattern relies on.
    expect("import x from 'jsr:@supabase/supabase-js@2'".match(EMAIL)).toEqual(null)

    // And the comment strip leaves code behind.
    expect(stripCommentLines('// hi@example.com\nconst a = 1')).toBe('const a = 1')
  })
})
