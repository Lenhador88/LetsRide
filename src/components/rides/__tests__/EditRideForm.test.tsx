import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RIDE_AUDIENCE_HINT, RIDE_AUDIENCE_REFUSAL } from '@/lib/rides/audience'
import type { RideForEdit } from '@/types'

// Same single mock, and for the same reason, as `CreateRideForm.test.tsx`:
// `useActionRedirect` calls `useRouter`, which throws outside a Next tree, so
// without this the component cannot be rendered at all. Nothing here asserts
// navigation. Hoisted above the import beneath it by Vitest.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}))

const { EditRideForm } = await import('@/components/rides/EditRideForm')
const { CreateRideForm } = await import('@/components/rides/CreateRideForm')

/**
 * PD-338's headline, as markup: **a ride that arrived clubless and private is
 * editable**, and the transition into that shape is still refused.
 *
 * This is the assertion that fails if the guard is ever re-broadened back to the
 * *shape*. That is worth pinning rather than trusting, because re-broadening it
 * is invisible in every other gate: `tsc`, ESLint and the RLS suite all stay
 * green while the ordinary ride a rider creates outside a club becomes one they
 * can only edit by publishing it to everyone.
 *
 * `renderToStaticMarkup` under `environment: 'node'`, per this repo's rule —
 * these are decisions (which control renders, whether Save is reachable), not
 * layout, and no effect or event is needed to read either.
 */

const CLUB = '11111111-2222-4333-8444-555555555555'

const ride = (over: Partial<RideForEdit> = {}): RideForEdit => ({
  id: '77777777-6666-4555-8444-333333333333',
  title: 'Sunday run',
  route_description: null,
  meeting_point: 'Dam Square, Amsterdam',
  departure_at: '2027-05-01T09:00:00+00:00',
  timezone: 'Europe/Amsterdam',
  is_public: false,
  club_id: null,
  start_place_id: null,
  latitude: null,
  longitude: null,
  club: null,
  organizer_id: '22222222-3333-4444-8555-666666666666',
  is_organizer: true,
  ...over,
})

const clubs = [{ id: CLUB, name: 'Dyke Runners' }]

const html = (props: Parameters<typeof EditRideForm>[0]) =>
  renderToStaticMarkup(<EditRideForm {...props} />)

/**
 * Whether the Save button carries the `disabled` ATTRIBUTE.
 *
 * **Read as an attribute, never as a substring of the tag.** `Button`'s class
 * list carries Tailwind's `disabled:cursor-not-allowed`, `disabled:bg-disabled`
 * and `disabled:text-disabled-foreground` on every render, so a bare
 * `toContain('disabled')` is true whatever the prop says — a check that passes
 * for the wrong reason and would go on passing after the guard was removed.
 * React serialises the boolean prop as `disabled=""`.
 */
const saveIsDisabled = (out: string) => {
  const match = out.match(/<button[^>]*type="submit"[^>]*>/)
  expect(match, 'the form renders a submit button').not.toBeNull()
  return / disabled=""/.test(match![0])
}

describe('a ride that ARRIVED clubless and private — PD-320’s default output', () => {
  it('renders an enabled Save, so it can be edited without publishing it', () => {
    const out = html({ ride: ride({ club_id: null, is_public: false }), clubs })
    expect(saveIsDisabled(out)).toBe(false)
  })

  it('accuses the rider of nothing — no refusal is shown', () => {
    const out = html({ ride: ride({ club_id: null, is_public: false }), clubs })
    expect(out).not.toContain(RIDE_AUDIENCE_REFUSAL)
    expect(out).not.toContain('role="alert"')
  })

  it('holds for a rider who belongs to NO clubs, who has no other lever', () => {
    // The sharpest form of the bug: with an empty club list the only control
    // that could have cleared the old guard was "Make this ride public".
    const out = html({ ride: ride({ club_id: null, is_public: false }), clubs: [] })
    expect(saveIsDisabled(out)).toBe(false)
    expect(out).not.toContain(RIDE_AUDIENCE_REFUSAL)
  })

  it('holds when the club list failed to load entirely', () => {
    // `clubs === null` draws the disabled stated-value control, so if Save were
    // also disabled there would be no reachable control on the whole form.
    const out = html({ ride: ride({ club_id: null, is_public: false }), clubs: null })
    expect(saveIsDisabled(out)).toBe(false)
  })
})

describe('nothing is refused on first paint, whatever the ride’s shape', () => {
  // Worth stating explicitly, because it is why the refused half of this rule
  // is pinned in `EditRideForm.dom.test.tsx` and not here: the form seeds its
  // state FROM the ride, so on mount the submitted pair always equals the
  // stored pair and `narrowsToNobody` is false by construction. A static render
  // can therefore never reach the disabled state — it takes a rider event.
  for (const [label, shape] of [
    ['private, in a club', { club_id: CLUB, is_public: false }],
    ['public, no club', { club_id: null, is_public: true }],
    ['public, in a club', { club_id: CLUB, is_public: true }],
  ] as const) {
    it(`opens ${label} with Save enabled and no alert`, () => {
      const out = html({
        ride: ride({ ...shape, club: shape.club_id ? { id: CLUB, name: 'Dyke Runners' } : null }),
        clubs,
      })
      expect(saveIsDisabled(out)).toBe(false)
      expect(out).not.toContain(RIDE_AUDIENCE_REFUSAL)
    })
  }
})

describe('the audience hint is one sentence, not two copies', () => {
  it('is rendered identically by both ride forms', () => {
    // PD-320's review asked for this assertion and deferred it to PD-338. The
    // shared constant makes drift unwritable; this catches a build that inlines
    // one of them again.
    const edit = html({ ride: ride(), clubs })
    const create = renderToStaticMarkup(<CreateRideForm clubs={clubs} initialClubId={null} />)
    expect(edit).toContain(RIDE_AUDIENCE_HINT)
    expect(create).toContain(RIDE_AUDIENCE_HINT)
  })
})
