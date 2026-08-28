import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// **The one mock, and it stands in for a provider rather than for behaviour.**
// `useActionRedirect` calls `useRouter`, which throws `invariant expected app
// router to be mounted` outside a Next tree — so without this the file cannot
// render the component at all. Nothing below asserts navigation, and `push`
// could not be reached anyway: it only ever fires from an effect, and
// `renderToStaticMarkup` runs none. Hoisted by Vitest above the import beneath
// it, which is why the component is imported after this call rather than with
// the others.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}))

const { CreateRideForm } = await import('@/components/rides/CreateRideForm')

/**
 * The three questions PD-320 took off the composer, asserted as markup.
 *
 * Each of them is a *decision* rather than a layout, which is the bar the other
 * four component tests in this repo are held to: which control renders, what it
 * posts, and which way a default points. Vitest runs `environment: 'node'`, so
 * `renderToStaticMarkup` gives the markup the browser would have used and no
 * layout at all — the limit `PostcardAction.test.tsx` records.
 *
 * **Effects do not run under `renderToStaticMarkup`, and that costs this file
 * nothing.** The only effect on first paint seeds `departure_at` with tomorrow's
 * date onto the DOM node; none of the three assertions below is about it.
 *
 * **Why the club half is asserted here and not only in `create-from-club.test.ts`.**
 * That file owns `seedClubId`, the pure rule — *is this id one of the rider's
 * own clubs*. What it cannot see is the thing PD-320 actually changed: that a
 * resolved id makes the `<select>` disappear and a hidden input take over
 * posting `club_id`. A build that resolved the id correctly and still drew the
 * picker would pass every assertion in that file.
 */
const CLUB = '11111111-2222-4333-8444-555555555555'
const OTHER = '99999999-8888-4777-8666-555555555555'

const clubs = [
  { id: CLUB, name: 'Dyke Runners' },
  { id: OTHER, name: 'Coastal MC' },
]

const html = (props: Parameters<typeof CreateRideForm>[0]) =>
  renderToStaticMarkup(<CreateRideForm {...props} />)

describe('the club question, when the composer was opened inside a club', () => {
  it('does not render the picker at all', () => {
    const out = html({ clubs, initialClubId: CLUB })
    expect(out).not.toContain('<select')
    // The picker's own empty option is the tell that survives a renamed class.
    expect(out).not.toContain('No club')
  })

  it('states the club by name, so the rider can see which one they are in', () => {
    expect(html({ clubs, initialClubId: CLUB })).toContain('Dyke Runners')
  })

  it('still posts the club, through a hidden input rather than the select', () => {
    const out = html({ clubs, initialClubId: CLUB })
    expect(out).toContain(`type="hidden" name="club_id" value="${CLUB}"`)
  })

  it('offers no way to reach the OTHER club — the question is gone, not defaulted', () => {
    expect(html({ clubs, initialClubId: CLUB })).not.toContain('Coastal MC')
  })
})

describe('the club question, when it is still a question', () => {
  it('renders the picker when no club was carried in', () => {
    const out = html({ clubs, initialClubId: null })
    expect(out).toContain('<select')
    expect(out).toContain('No club')
    expect(out).toContain('Dyke Runners')
  })

  it('falls back to the ordinary form when the carried id resolves to nothing', () => {
    // The story's own rule: `seedClubId`'s refusal of an unmatched id still
    // decides. A build that trusted the parameter would hide the picker and
    // post a club this rider is not in.
    const out = html({ clubs, initialClubId: '00000000-0000-4000-8000-000000000000' })
    expect(out).toContain('<select')
    expect(out).toContain('No club')
  })

  it('renders no club control at all for a rider who is in no clubs', () => {
    const out = html({ clubs: [], initialClubId: CLUB })
    expect(out).not.toContain('<select')
    expect(out).not.toContain('name="club_id"')
  })
})

describe('the description question', () => {
  it('is gone from the form entirely', () => {
    // Both spellings, because `route_description` is still here and a bare
    // substring match on "description" would pass on a form that kept both.
    for (const props of [
      { clubs, initialClubId: CLUB },
      { clubs, initialClubId: null },
    ]) {
      const out = html(props)
      expect(out).not.toContain('name="description"')
      expect(out).toContain('name="route_description"')
    }
  })
})

describe('the public question', () => {
  it('defaults to unchecked', () => {
    // Asserted on the absence of `checked` within the input itself rather than
    // on the whole document, so an unrelated checked control elsewhere on the
    // form could never make this pass or fail.
    const out = html({ clubs, initialClubId: null })
    const input = out.match(/<input[^>]*name="is_public"[^>]*>/)?.[0]
    expect(input).toBeDefined()
    expect(input).not.toContain('checked')
  })

  it('defaults to unchecked inside a club too — the flip is global', () => {
    const input = html({ clubs, initialClubId: CLUB }).match(
      /<input[^>]*name="is_public"[^>]*>/
    )?.[0]
    expect(input).toBeDefined()
    expect(input).not.toContain('checked')
  })
})
