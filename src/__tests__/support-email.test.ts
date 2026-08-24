import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { SUPPORT_EMAIL } from '@/lib/support'

/**
 * One published address, in one file.
 *
 * App Store Review Guideline 1.2 and Google Play's User Data policy both want a
 * route to a human, and the failure mode is not a missing address — it is two
 * pages publishing two of them, one of which nobody reads. `/legal/privacy`
 * (PD-297) and `/legal/account-deletion` are those two pages today.
 *
 * The detector is a source scan for an email literal, so it is a tripwire for
 * the ordinary case rather than a proof — an address assembled from fragments
 * defeats it. `catches a real address` below is the half that matters: a guard
 * that has quietly stopped matching passes for ever and looks exactly like a
 * clean repo, which is why `no-service-role-key.test.ts` checks itself the same
 * way.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))

/**
 * The scan covers what a rider can be shown — routes and components — and not
 * `src/lib/`, where `support.ts` itself lives and where the validation suite's
 * `rider@example.com` fixtures are addresses nobody is invited to write to.
 * Publishing happens in the render.
 */
const RENDERED = [path.join(SRC, 'app'), path.join(SRC, 'components')]

/**
 * Deliberately loose on the local part and anchored on a dot-separated domain,
 * so it catches `hello@letsride.app` and `support@example.co.uk` alike. It is
 * applied to source text, so a `mailto:` prefix is matched by the address
 * inside it rather than by the scheme.
 */
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : walk(full)
    if (entry === '__tests__') return []
    return /\.tsx?$/.test(full) ? [full] : []
  })
}

/**
 * Comment lines are excluded for the reason `CLAUDE.md` calls the comment trap:
 * a file explaining which address it stopped hardcoding contains that address,
 * and a scan that counts its own obituaries reports a violation that is really
 * a fix. Only the code lines can publish anything.
 */
function addressesInCode(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return !(
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('{/*')
      )
    })
    .flatMap((line) => line.match(EMAIL) ?? [])
}

describe('the published support address', () => {
  it('is written down in exactly one file', () => {
    const offenders = RENDERED.flatMap(walk)
      .flatMap((file) =>
        addressesInCode(readFileSync(file, 'utf8')).map(
          (address) => `${path.relative(SRC, file)}: ${address}`
        )
      )

    expect(offenders).toEqual([])
  })

  it('catches a real address, so a silently-broken detector cannot pass', () => {
    expect(addressesInCode('<a href="mailto:hello@letsride.app">write to us</a>')).toEqual([
      'hello@letsride.app',
    ])
    expect(addressesInCode(' * OWNER: hello@letsride.app is a guess.')).toEqual([])
  })

  it('is reachable, so the pages have something to render', () => {
    expect(SUPPORT_EMAIL).toMatch(EMAIL)
  })
})
