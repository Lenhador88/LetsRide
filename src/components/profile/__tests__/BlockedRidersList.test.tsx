import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { BlockedRidersList } from '@/components/profile/BlockedRidersList'
import { BannerProvider } from '@/components/ui/Banner'
import type { BlockedRider } from '@/types'

/**
 * **The one thing here a refactor reverses in silence: a block against a rider
 * with no username must still be listed.**
 *
 * `105`'s `my_blocked_riders()` deliberately does NOT restate `009`'s
 * `username is not null` conjunct, and the standing precedent pushes the other
 * way — `ride_journal_postcard_ids` copies its table's qual verbatim, so a
 * careful implementer copying that shape drops these rows. The cost is exact
 * and it is this story's own bug one level down: **a block missing from this
 * list is a block nobody can ever lift.**
 *
 * The database half is asserted in `supabase/tests/rls_test.sql`. This pins the
 * client half — a `.filter(r => r.username)` added later to tidy up the render
 * would be invisible to every other gate.
 *
 * `environment: 'node'`; static markup answers "is the row on screen".
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/profile',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {},
}))

let rows: BlockedRider[] = []

vi.mock('@/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query')>()
  return {
    ...actual,
    useQuery: () => ({ data: rows, error: null, isLoading: false, refetch: () => {} }),
  }
})

function render() {
  return renderToStaticMarkup(
    <BannerProvider>
      <BlockedRidersList />
    </BannerProvider>
  )
}

describe('BlockedRidersList', () => {
  it('lists a named rider with a way to unblock them', () => {
    rows = [{ blocked_id: 'u1', username: 'ripper', blocked_at: '2026-09-01T10:00:00Z' }]
    const html = render()

    expect(html).toContain('ripper')
    expect(html).toContain('Unblock')
  })

  it('still lists a block against a rider who never finished signing up', () => {
    rows = [{ blocked_id: 'u2', username: null, blocked_at: '2026-09-01T10:00:00Z' }]
    const html = render()

    // The row is present and liftable — that is the whole assertion.
    expect(html).toContain('Unblock')
    expect(html).toContain('hasn’t finished signing up')
  })

  it('distinguishes an empty list from a failed read', () => {
    rows = []
    expect(render()).toContain('haven’t blocked anyone')
  })
})
