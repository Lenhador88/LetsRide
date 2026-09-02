import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getClubThreadUnread } from '@/lib/data/club-threads'

/**
 * `getClubThreadUnread`'s narrowing — PD-372.
 *
 * The RPC `club_thread_unread` answers for **every** thread in the club,
 * announcements included, and no migration here can change that. The map has
 * to answer only for threads the Threads list can show, or `ClubOptionsMenu`'s
 * aggregate dot — the last one in the app — lights for an unread comment on a
 * club introduction, points at the Threads list, and cannot be cleared by
 * visiting it.
 *
 * Three of the four cases below assert something that is **absent or not
 * done**: a mark that must be dropped, a round trip that must not be made, and
 * a map that must go empty rather than return marks it could not verify. None
 * of those is visible to a test that only checks what came back populated,
 * which is why the ordinary case is asserted beside each of them.
 *
 * `postcards.test.ts`' mocked-resolver shape: the builder records what a real
 * `postgrest-js` chain would receive and resolves like one.
 */
const CLUB_ID = '11111111-1111-4111-8111-111111111111'

const rpc = vi.fn()
const from = vi.fn()

vi.mock('@/lib/supabase/resolve', () => ({
  resolveSupabase: async () => ({ rpc, from }),
}))

/** The corrective read: `.select('id').in('id', …).not(<marker>, 'is', null)`,
 *  resolving on the last link the way `await`ing a builder does. */
function markerBuilder(rows: { id: string }[] | null, error: unknown = null) {
  const inCalls: unknown[][] = []
  const notCalls: unknown[][] = []
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.in = vi.fn((...args: unknown[]) => {
    inCalls.push(args)
    return builder
  })
  builder.not = vi.fn((...args: unknown[]) => {
    notCalls.push(args)
    return Promise.resolve({ data: rows, error })
  })
  return { builder, inCalls, notCalls }
}

describe('getClubThreadUnread — the map answers only for threads the Threads list can show', () => {
  beforeEach(() => {
    rpc.mockReset()
    from.mockReset()
  })

  it('drops an announcement’s mark and keeps an ordinary thread’s', async () => {
    rpc.mockResolvedValue({
      data: [
        { thread_id: 'ordinary', has_unread: true },
        { thread_id: 'announcement', has_unread: true },
      ],
      error: null,
    })
    const { builder, inCalls, notCalls } = markerBuilder([{ id: 'announcement' }])
    from.mockReturnValue(builder)

    const map = await getClubThreadUnread(CLUB_ID)

    expect(map).toEqual({ ordinary: true })
    expect(map.announcement).toBeUndefined()
    // Bounded by the unread set, not by the roster — the whole point of the
    // shape. Only ids the RPC actually marked are read back.
    expect(inCalls).toEqual([['id', ['ordinary', 'announcement']]])
    expect(notCalls).toEqual([['introduces_user_id', 'is', null]])
  })

  it('issues NO second read when nothing is unread', async () => {
    rpc.mockResolvedValue({
      data: [
        { thread_id: 'ordinary', has_unread: false },
        { thread_id: 'announcement', has_unread: false },
      ],
      error: null,
    })

    const map = await getClubThreadUnread(CLUB_ID)

    // The absence is the assertion: nothing can light, so there is nothing to
    // correct and no round trip to spend. An announcement with nothing unread
    // therefore keeps its `false` entry, which no consumer can act on.
    expect(from).not.toHaveBeenCalled()
    expect(map).toEqual({ ordinary: false, announcement: false })
  })

  it('resolves the WHOLE map to {} when the corrective read fails', async () => {
    rpc.mockResolvedValue({
      data: [{ thread_id: 'ordinary', has_unread: true }],
      error: null,
    })
    const { builder } = markerBuilder(null, { message: 'boom' })
    from.mockReturnValue(builder)

    // Never the un-narrowed map: a failed correction must not return marks it
    // could not verify. The marks decorate a list that renders without them.
    expect(await getClubThreadUnread(CLUB_ID)).toEqual({})
  })

  it('resolves to {} when the RPC itself fails, and for a malformed club id', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await getClubThreadUnread(CLUB_ID)).toEqual({})

    rpc.mockReset()
    expect(await getClubThreadUnread('not-a-uuid')).toEqual({})
    expect(rpc).not.toHaveBeenCalled()
  })
})
