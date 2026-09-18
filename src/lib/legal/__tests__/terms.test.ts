import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  OPERATOR,
  PRE_RELEASE_TERMS_VERSION,
  TERMS_LAST_UPDATED,
  TERMS_VERSION,
} from '@/lib/legal/terms'

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
 * The value the LAST migration to touch `current_terms_version()` returns.
 *
 * Walked newest-first rather than reading `030` by name, because replacing the
 * string is explicitly a *new* migration (`030`'s own header says so, and
 * `CLAUDE.md` forbids editing an applied file). Reading `030` would pin this
 * test to a value the database stopped using.
 *
 * **Two steps, not one, and that split is the whole point.** The first cut did
 * both at once — it scanned every file for one exact body shape and *fell
 * through* to the next file when it did not match. So a redefinition written in
 * any other shape was indistinguishable from a file that never mentions the
 * function, and the walk quietly landed back on `030`: measured, 5 of 7
 * plausible forms (uppercase DDL, `drop` + `create` with no `or replace`, a
 * named dollar tag, a `plpgsql` `return` body, quoted identifiers) returned
 * `0-placeholder` while the database said something else — with the operator
 * still unnamed, both tests in this file stayed green through it.
 *
 * Now: find the newest file that *touches* the function, then insist on reading
 * a value out of THAT file. Unparseable throws, naming it. Erring loud is the
 * point — a future file that only grants or revokes would trip this, and being
 * told to look is the correct outcome for a value consent records depend on.
 */
function currentTermsVersionInSql(): string {
  // `CLAUDE.md`'s comment trap, and it is live here: `030` names this function
  // in prose three times, twice before it ever defines it. A directive is only
  // a directive outside a comment, so whole-line `--` comments go first.
  const stripSqlComments = (sql: string) =>
    sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')

  const TOUCHES =
    /(?:create|drop)\s+(?:or\s+replace\s+)?function\s+(?:if\s+exists\s+)?private\.current_terms_version\s*\(/i

  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse()

  for (const file of files) {
    const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS, file), 'utf8'))
    if (!TOUCHES.test(sql)) continue

    // Deliberately loose about the shape and strict about the file: any dollar
    // tag, `select` or a plpgsql `return`, either case.
    const body = sql.match(
      /function\s+private\.current_terms_version\s*\(\s*\)[\s\S]*?\$[A-Za-z_]*\$\s*(?:begin\s+)?(?:select|return)\s+'([^']+)'/i
    )
    if (body) return body[1]

    throw new Error(
      `${file} is the newest migration touching private.current_terms_version() and this ` +
        'test cannot read a version out of it. Do not loosen the match until you know which ' +
        'value the database returns: TERMS_VERSION in src/lib/legal/terms.ts is what riders ' +
        'are shown, and profiles.terms_version is what their consent records.'
    )
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
  it('moves to a real name and address and the version together, never one alone', () => {
    // Dutch law (art. 3:15d BW) wants the person behind the service named and
    // reachable, so an unnamed operator is not a cosmetic gap — it is the
    // reason the text is not yet binding. The two directions:
    //
    //   no operator + pre-release version  → the state before 118
    //   an operator + a real version        → the state after it
    //   an operator + pre-release version   → consents stamped unreadably
    //   no operator + a real version        → a "binding" text naming nobody
    //
    // Asserted as an equivalence rather than as two separate cases, so neither
    // half can be edited on its own and left green — including the edit that
    // sets the operator back to `null`, which is a live possibility while the
    // published address is under review.
    expect(OPERATOR === null).toBe(TERMS_VERSION === PRE_RELEASE_TERMS_VERSION)
  })

  it('has no placeholder string to leak, which is why the constant is nullable', () => {
    // The interlock above is about the RELEASE. This is about today: an unnamed
    // operator used to be `'[full legal name — PD-459]'`, and a value renders —
    // the live page published that bracket to every rider. `null` cannot.
    // `src/app/legal/terms/__tests__/page.test.tsx` asserts the other end, on
    // the markup.
    if (OPERATOR !== null) {
      expect(OPERATOR.name).not.toMatch(/[[\]]/)
      expect(OPERATOR.address).not.toMatch(/[[\]]/)
    }
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

    // And it has to handle the null arm rather than assert past it: `OPERATOR!`
    // or a `?? ''` would type-check, render an empty name, and satisfy every
    // other assertion in this file.
    expect(page).toContain('{OPERATOR ? (')
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
