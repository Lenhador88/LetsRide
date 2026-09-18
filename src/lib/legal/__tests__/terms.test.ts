import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { OPERATOR, TERMS_LAST_UPDATED, TERMS_VERSION } from '@/lib/legal/terms'

/**
 * The terms page makes two claims that live somewhere else, and both are the
 * kind that fail silently.
 *
 * 1. **The version a rider reads must be the version the database stamps.**
 *    `private.current_terms_version()` (`030`) writes `profiles.terms_version`
 *    at the moment of acceptance, server-side, precisely so the value is
 *    evidence. If the page says `1.0` while the function still returns
 *    `0-placeholder`, every consent row records agreement to a text nobody can
 *    identify — and nothing anywhere goes red, because the two halves never
 *    meet at runtime.
 * 2. **The operator has to be a real person before the version advances.** A
 *    text that cannot say who the counterparty is cannot be binding, so
 *    releasing one under a real version number is the drift that matters.
 *
 * Both are asserted against the migration chain rather than against a constant
 * copied into this file — a test that quotes the value it is checking proves
 * only that somebody typed it twice.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const MIGRATIONS = path.join(ROOT, 'supabase/migrations')

/**
 * The value the LAST migration to define `current_terms_version()` returns.
 *
 * Walked newest-first rather than reading `030` by name, because replacing the
 * string is explicitly a *new* migration (`030`'s own header says so, and
 * `CLAUDE.md` forbids editing an applied file). Reading `030` would pin this
 * test to a value the database stopped using.
 */
function currentTermsVersionInSql(): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse()

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8')
    // The body, not a comment mentioning the function: anchored on the `select`
    // that returns it. `CLAUDE.md`'s comment trap is live here — `030` names
    // the string in prose twice, and a looser match reads its own docstring.
    const body = sql.match(
      /create or replace function private\.current_terms_version\(\)[\s\S]*?\$\$\s*select\s+'([^']+)'/
    )
    if (body) return body[1]
  }

  throw new Error(
    'No migration defines private.current_terms_version(). It was added by 030 and the ' +
      'terms page reads its value — if the function has genuinely been dropped, this test ' +
      'is the thing that needs rewriting, not deleting.'
  )
}

describe('the terms version the page shows', () => {
  it('is the version the database actually stamps', () => {
    expect(TERMS_VERSION).toBe(currentTermsVersionInSql())
  })
})

describe('the operator disclosure', () => {
  const stillPlaceholder = OPERATOR.name.includes('[') || OPERATOR.address.includes('[')

  it('moves to a real name and address and the version together, never one alone', () => {
    // Dutch law (art. 3:15d BW) wants the person behind the service named and
    // reachable, so a bracketed placeholder is not a cosmetic gap — it is the
    // reason the text is not yet binding. The two directions:
    //
    //   placeholder operator + placeholder version  → fine, today's state
    //   real operator        + real version         → fine, the release
    //   real operator        + placeholder version  → consents stamped unreadably
    //   placeholder operator + real version         → a "binding" text naming nobody
    //
    // Asserted as an equivalence rather than as two separate cases, so neither
    // half can be edited on its own and left green.
    expect(stillPlaceholder).toBe(TERMS_VERSION === '0-placeholder')
  })

  it('is rendered by the page rather than restated in it', () => {
    // The page must read these constants. A hardcoded name in the JSX would
    // satisfy every assertion above while publishing a second, unversioned copy
    // of the disclosure — which is exactly the failure `support-email.test.ts`
    // exists to catch for the contact address.
    const page = readFileSync(path.join(ROOT, 'src/app/legal/terms/page.tsx'), 'utf8')

    expect(page).toContain('OPERATOR')
    expect(page).toContain('TERMS_VERSION')
    expect(page).toContain('SUPPORT_EMAIL')
  })
})

describe('the date beside the version', () => {
  it('is a date a rider can read, not an ISO stamp', () => {
    // It sits next to the version in the page header and is for a human. An
    // ISO date here would be the one place in the app that shows one — every
    // other date goes through a named `format*` helper in `lib/utils.ts`.
    expect(TERMS_LAST_UPDATED).not.toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(TERMS_LAST_UPDATED.length).toBeGreaterThan(0)
  })
})
