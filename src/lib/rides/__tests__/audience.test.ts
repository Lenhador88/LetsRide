import { describe, expect, it } from 'vitest'
import {
  narrowsToNobody,
  RIDE_AUDIENCE_HINT,
  RIDE_AUDIENCE_REFUSAL,
  type RideAudienceShape,
} from '@/lib/rides/audience'

/**
 * The transition rule, table-driven over every stored shape × every submitted
 * shape (PD-338).
 *
 * **The two refused cells are the point, and so are the fourteen permitted
 * ones.** Asserting only the refusals would let a future "tightening" re-broaden
 * the guard back to the shape without a single test going red — which is exactly
 * how the rule got here: it refused the shape for so long that PD-320 made that
 * shape the composer's default output and nothing noticed. A build that wants to
 * refuse more has to delete an assertion, in the open.
 */

const CLUB = '11111111-2222-4333-8444-555555555555'

const SHAPES: { label: string; shape: RideAudienceShape }[] = [
  { label: 'public, in a club', shape: { club_id: CLUB, is_public: true } },
  { label: 'private, in a club', shape: { club_id: CLUB, is_public: false } },
  { label: 'public, no club', shape: { club_id: null, is_public: true } },
  { label: 'private, no club', shape: { club_id: null, is_public: false } },
]

/** The submitted shape with no standing audience — the only refusable target. */
const NOBODY = 'private, no club'

describe('narrowsToNobody', () => {
  for (const stored of SHAPES) {
    for (const submitted of SHAPES) {
      // Refused exactly when the ride HAD a standing audience and the edit
      // would leave it with none. Everything else — including the same shape
      // saved back onto itself — is a save.
      const refused = submitted.label === NOBODY && stored.label !== NOBODY

      it(`${refused ? 'refuses' : 'permits'} ${stored.label} → ${submitted.label}`, () => {
        expect(narrowsToNobody(stored.shape, submitted.shape)).toBe(refused)
      })
    }
  }

  it('permits every edit to a ride that ARRIVED clubless and private', () => {
    // PD-338's headline, stated once on its own so it survives a refactor of
    // the table above. This is the ride PD-320's composer default produces.
    const arrived: RideAudienceShape = { club_id: null, is_public: false }
    expect(narrowsToNobody(arrived, arrived)).toBe(false)
  })

  it('refuses detaching a private ride from its club', () => {
    expect(
      narrowsToNobody({ club_id: CLUB, is_public: false }, { club_id: null, is_public: false })
    ).toBe(true)
  })

  it('refuses un-publishing a ride that is in no club', () => {
    expect(
      narrowsToNobody({ club_id: null, is_public: true }, { club_id: null, is_public: false })
    ).toBe(true)
  })

  it('treats an empty-string club id as no club, which is what the <select> posts', () => {
    // `EditRideForm` holds `clubId` as `''` for "No club" and normalises on the
    // way in. If that normalisation is ever dropped, a falsy-but-not-null id
    // must still read as clubless rather than as an audience.
    expect(
      narrowsToNobody({ club_id: CLUB, is_public: false }, { club_id: '', is_public: false })
    ).toBe(true)
  })
})

describe('the copy', () => {
  it('does not claim the ride would be invisible to everyone', () => {
    // The retired premise, in the words both old copies used. `083` shipped
    // ride invites, so a rider can disprove this by opening their own ride.
    expect(RIDE_AUDIENCE_REFUSAL).not.toContain('nobody but you')
  })

  it('names the crew, the invite path and both remedies', () => {
    expect(RIDE_AUDIENCE_REFUSAL).toContain('crew')
    expect(RIDE_AUDIENCE_REFUSAL).toContain('riders you invite')
    expect(RIDE_AUDIENCE_REFUSAL).toContain('Pick a club')
    expect(RIDE_AUDIENCE_REFUSAL).toContain('make it public')
  })

  it('keeps the audience hint that both ride forms render', () => {
    expect(RIDE_AUDIENCE_HINT).toBe(
      'Anyone signed in can see and join a public ride. A private ride is visible to its club, and to riders you invite.'
    )
  })
})
