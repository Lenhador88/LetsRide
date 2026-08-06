import { describe, expect, it } from 'vitest'
import { normalise } from '../check-migration-drift.mjs'

/**
 * `normalise` is two lines, and it is the whole drift check.
 *
 * The failure that matters is the lenient one: if it ever over-strips, unrelated
 * migrations collapse onto the same key, every comparison matches, and the
 * output reads exactly like a database with no drift. A check that has quietly
 * stopped discriminating passes for ever and looks like good news — the same
 * reasoning `no-service-role-key.test.ts` gives for proving its own detector
 * still fires.
 *
 * So this pins both directions: the pairs that MUST match, and the pairs that
 * must NOT.
 */
describe('normalise', () => {
  it('matches a file against the bare name the database usually records', () => {
    // The common case — 29 of PROD's 32 rows look like this.
    expect(normalise('014_profile_media_and_countries.sql')).toBe(
      normalise('profile_media_and_countries')
    )
    expect(normalise('001_initial_schema.sql')).toBe(normalise('initial_schema'))
  })

  it('matches a file against the three rows that recorded the prefix too', () => {
    // Measured against the live project 2026-08-06: whoever applied these
    // passed the filename where every other apply passed the descriptive half.
    // Without this, a correct database reports three phantom drifts.
    expect(normalise('003_onboarding.sql')).toBe(normalise('003_onboarding'))
    expect(normalise('009_postcards_and_blocks.sql')).toBe(normalise('009_postcards_and_blocks'))
    expect(normalise('010_postcard_storage.sql')).toBe(normalise('010_postcard_storage'))
  })

  it('collapses the prefixed and bare spellings onto one key', () => {
    // The two recordings of the same migration have to land together, or the
    // union row set shows it as both applied and missing.
    expect(normalise('009_postcards_and_blocks')).toBe(normalise('postcards_and_blocks'))
  })

  it('does NOT collapse distinct migrations onto the same key', () => {
    // The lenient failure. If these ever compare equal the check is decorative.
    expect(normalise('021_onboarding_state_accessors.sql')).not.toBe(
      normalise('025_profile_column_privileges.sql')
    )
    expect(normalise('003_onboarding.sql')).not.toBe(
      normalise('021_onboarding_state_accessors.sql')
    )
    expect(normalise('029_account_deletion_cascade_support.sql')).not.toBe(
      normalise('030_terms_version.sql')
    )
  })

  it('strips only the leading prefix, never digits inside the name', () => {
    expect(normalise('017_rides_club_audience.sql')).toBe('rides_club_audience')
    expect(normalise('012_protect_terms_accepted_at.sql')).toBe('protect_terms_accepted_at')
    expect(normalise('001_schema_v2_notes.sql')).toBe('schema_v2_notes')
  })

  it('is idempotent, since it is applied to both sides of every comparison', () => {
    const once = normalise('024_drop_legacy_avatar_url.sql')
    expect(normalise(once)).toBe(once)
  })

  it('leaves a name with no prefix and no extension alone', () => {
    expect(normalise('feed_reads')).toBe('feed_reads')
  })
})
