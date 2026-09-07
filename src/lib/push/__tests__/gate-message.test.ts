import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../../../..')

/**
 * The `/onboarding/i` discriminator in `registerCurrentDevice` is coupled to a
 * RAISE string inside `078_push_devices.sql`, and **nothing else pins that
 * coupling** — PD-431, delta review finding #3.
 *
 * ## Why the coupling exists at all
 *
 * `register_push_device` can fail with SQLSTATE `23514` in four ways, and only
 * one of them is an ordinary rider state:
 *
 * | Source | Ordinary? |
 * |---|---|
 * | the participation gate's `raise … using errcode = 'check_violation'` | **yes** — a rider mid-onboarding |
 * | `push_devices_installation_id_shape` | no |
 * | `push_devices_platform_check` | no |
 * | `push_devices_token_shape` | no |
 *
 * The client has to swallow the first and rethrow the other three, or an
 * oversized provider token is discarded in silence and the device reads as
 * fully set up while it will never receive anything.
 *
 * **The code is the only thing that can tell them apart.** For a plpgsql
 * `raise exception`, PostgREST returns the RAISE string as `message` with
 * `details` and `hint` null and the constraint name nowhere — so `details`
 * cannot discriminate, and matching the message is the only option rather than
 * a preference.
 *
 * ## What this test does about it
 *
 * **`078` cannot be edited** — migrations are immutable once written
 * (`CLAUDE.md` §Supabase Rules) — so the note that would ordinarily sit beside
 * the RAISE lives here instead, as an assertion rather than a comment. It
 * reads the migration off disk and checks the two ends still agree.
 *
 * A future migration that rewords or moves that RAISE turns an ordinary
 * mid-onboarding rider into a thrown error. **This test is what makes that a
 * red suite rather than a silent behaviour change**, and the fix when it goes
 * red is to update `registration.ts`'s pattern to match the new wording — not
 * to relax this assertion.
 */

const MIGRATION = path.join('supabase', 'migrations', '078_push_devices.sql')
const CLIENT = path.join('src', 'lib', 'push', 'registration.ts')

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

/** The discriminator, kept in one place so both assertions below use the same one. */
const DISCRIMINATOR = /onboarding/i

describe("the gate's message and the client's discriminator agree", () => {
  it('078 still raises a check_violation whose message the client would match', () => {
    const sql = read(MIGRATION)

    const raise = sql.match(
      /raise exception\s*\n?\s*'([^']+)'\s*\n?\s*using errcode = 'check_violation'/i,
    )

    expect(raise, 'the participation-gate RAISE is no longer in 078 in a recognisable form').not.toBe(
      null,
    )
    expect(DISCRIMINATOR.test(raise![1])).toBe(true)
  })

  it('and registration.ts still discriminates on it rather than on the bare code', () => {
    // Comment-stripped: this file's own prose says `23514` repeatedly, and so
    // does the module's. The comment trap, which this repo names in `CLAUDE.md`.
    const code = read(CLIENT)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    expect(code).toContain('/onboarding/i')
    // Both ways: a bare code check must not come back. The pattern below is the
    // exact shape the delta review found and rejected.
    expect(code).not.toMatch(/error\.code\s*!==\s*'23514'/)
  })

  it('and the three CHECK violations it must NOT swallow cannot match it', () => {
    // Postgres emits `violates check constraint "<name>"` for these, so none of
    // them can contain the word the gate's own message does. Asserted rather
    // than reasoned about, because the whole split rests on it.
    for (const constraint of [
      'push_devices_installation_id_shape',
      'push_devices_platform_check',
      'push_devices_token_shape',
    ]) {
      const message = `new row for relation "push_devices" violates check constraint "${constraint}"`
      expect(DISCRIMINATOR.test(message)).toBe(false)
      // And the constraint really is in the migration, so this is not three
      // assertions about names nothing uses.
      expect(read(MIGRATION)).toContain(constraint)
    }
  })
})
