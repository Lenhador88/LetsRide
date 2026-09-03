// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import type { ClubJoin, ClubReplyWindow, ClubTimelineWindow } from '@/lib/data/club-timeline'
import type { ClubDetail, Postcard, RideListItem } from '@/types'

/**
 * The one component test PD-375 left out of the build — `design.md` §D2's
 * four tail states and §D6's anchor-hunt guard, both wired end to end rather
 * than only through the pure functions in `club-timeline.test.ts` and
 * `club-timeline-anchor.test.ts`.
 *
 * **jsdom, not `renderToStaticMarkup`.** Every other component test in this
 * repo (`ScrollSentinel.test.tsx` included) stays in `environment: 'node'`
 * because nothing it asserts needs an effect to run. This file is the
 * exception CLAUDE.md's test table names: the tail state a fetch failure
 * produces, and the anchor hunt's "scroll once, never again" latch, are both
 * facts about what happens AFTER mount, inside `useEffect` — a static render
 * never executes one, so there is nothing to gate on it. `IntersectionObserver`
 * is stubbed globally (jsdom carries none of its own) on `ScrollSentinel.tsx`'s
 * own note that a real one is never actually needed to *drive* the extension
 * in these tests — the hunt and the fetch failure both progress through
 * `useEffect`s that need no scroll gesture, only `vi.useFakeTimers()` advanced
 * past the `window.setTimeout(fn, 0)` every state change in this component is
 * deferred behind (`react-hooks/set-state-in-effect`'s own reason, restated in
 * `ClubTimeline.tsx`'s header).
 *
 * **`useQuery` and every `lib/data/` read are mocked** — CLAUDE.md's own
 * instruction for a screen-level test, and the reason this is not simply a
 * pure-function test wearing a component around it: what is being pinned is
 * the WIRING (which `lib/data/` shape reaches which prop, which state flips
 * which tail), not the merge or the hunt decision themselves, which already
 * have their own suites. `queryKeys` stays real and unmocked — the keys this
 * file seeds are the exact keys `ClubTimeline` builds, not a parallel guess at
 * them.
 *
 * **Every fixture supplies its sources' `horizon` directly rather than
 * satisfying the real bounds (60 joins, 30 rides, …).** `getClubJoins` and
 * `getClubFeedWindow` return a `ClubTimelineWindow` already, so the horizon is
 * data this test controls, not something `boundedHorizon` has to be tricked
 * into computing — the real accessors have their own tests for that
 * relationship (`club-timeline.test.ts`).
 */

let root: Root | null = null
let container: HTMLElement | null = null

const clubId = '11111111-1111-4111-8111-111111111111'
const club: Pick<ClubDetail, 'id' | 'created_at' | 'owner_id'> = {
  id: clubId,
  created_at: '2020-01-01T00:00:00Z',
  owner_id: 'owner-0',
}

function profile(id: string, username: string) {
  return { id, username, avatar_url: null, avatar_path: null, bike_model: null }
}

function join(userId: string, at: string, role: ClubJoin['role'] = 'member'): ClubJoin {
  return { user_id: userId, role, joined_at: at, profile: profile(userId, `rider-${userId}`) }
}

function ride(id: string, at: string): RideListItem {
  return {
    id,
    created_at: at,
    title: `Ride ${id}`,
    meeting_point: 'Somewhere',
    departure_at: at,
    timezone: null,
    club: null,
    latitude: null,
    longitude: null,
    organizer: null,
    riders: [],
    riders_count: 0,
    attendance: null,
    map_card_url: null,
    is_upcoming: true,
  } as RideListItem
}

type JoinWindow = { rows: ClubJoin[]; horizon: string | null; until: string | null; untilInclusive: boolean }
type BareWindow = { rows: never[]; horizon: string | null; until: string | null; untilInclusive: boolean }
type ReplyWindow = BareWindow & { activity: Record<string, unknown> }

const emptyPostcardWindow: BareWindow = { rows: [], horizon: null, until: null, untilInclusive: false }
const emptyReplyWindow: ReplyWindow = { rows: [], horizon: null, activity: {}, until: null, untilInclusive: true }

const {
  queryStore,
  useQueryImpl,
  seedQuery,
  onlineState,
  getClubJoinsMock,
  getClubThreadRepliesMock,
  getClubRideAnnouncementsMock,
  getClubFeedWindowMock,
  getClubThreadsMock,
  getClubThreadUnreadMock,
  getCurrentProfileMock,
  attachClubWaveStateMock,
  attachClubIntroductionsMock,
  waveJoinMock,
  unwaveJoinMock,
} = vi.hoisted(() => {
  const queryStore = new Map<string, unknown>()
  function useQueryImpl(key: readonly unknown[] | null) {
    if (key === null)
      return { data: undefined, error: null, isLoading: false, isRefetching: false, refetch: () => {} }
    return {
      data: queryStore.get(JSON.stringify(key)),
      error: null,
      isLoading: false,
      isRefetching: false,
      refetch: () => {},
    }
  }
  function seedQuery(key: readonly unknown[], value: unknown) {
    queryStore.set(JSON.stringify(key), value)
  }
  return {
    queryStore,
    useQueryImpl,
    seedQuery,
    onlineState: { value: true },
    getClubJoinsMock: vi.fn(
      async (): Promise<ClubTimelineWindow<ClubJoin>> => ({
        rows: [],
        horizon: null,
        until: null,
        untilInclusive: true,
      })
    ),
    getClubThreadRepliesMock: vi.fn(
      async (): Promise<ClubReplyWindow> => ({
        rows: [],
        horizon: null,
        activity: {},
        until: null,
        untilInclusive: true,
      })
    ),
    getClubRideAnnouncementsMock: vi.fn(async (): Promise<RideListItem[]> => []),
    getClubFeedWindowMock: vi.fn(
      async (): Promise<ClubTimelineWindow<Postcard>> => ({
        rows: [],
        horizon: null,
        until: null,
        untilInclusive: false,
      })
    ),
    getClubThreadsMock: vi.fn(async () => []),
    getClubThreadUnreadMock: vi.fn(async () => ({})),
    getCurrentProfileMock: vi.fn(async () => undefined),
    attachClubWaveStateMock: vi.fn(async () => ({})),
    attachClubIntroductionsMock: vi.fn(async () => ({})),
    waveJoinMock: vi.fn(async () => ({ error: null })),
    unwaveJoinMock: vi.fn(async () => ({ error: null })),
  }
})

vi.mock('@/components/ui/OfflineState', () => ({
  useOnlineStatus: () => onlineState.value,
}))

vi.mock('@/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query')>()
  return { ...actual, useQuery: (key: readonly unknown[] | null) => useQueryImpl(key) }
})

vi.mock('@/lib/data/postcards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/postcards')>()
  return { ...actual, getClubFeedWindow: getClubFeedWindowMock }
})

vi.mock('@/lib/data/rides', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/rides')>()
  return { ...actual, getClubRideAnnouncements: getClubRideAnnouncementsMock }
})

vi.mock('@/lib/data/club-threads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/club-threads')>()
  return {
    ...actual,
    getClubThreads: getClubThreadsMock,
    getClubThreadUnread: getClubThreadUnreadMock,
  }
})

vi.mock('@/lib/data/club-timeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/club-timeline')>()
  return {
    ...actual,
    getClubJoins: getClubJoinsMock,
    getClubThreadReplies: getClubThreadRepliesMock,
  }
})

vi.mock('@/lib/data/club-waves', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/club-waves')>()
  return { ...actual, attachClubWaveState: attachClubWaveStateMock }
})

vi.mock('@/lib/data/club-introductions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/club-introductions')>()
  return { ...actual, attachClubIntroductions: attachClubIntroductionsMock }
})

vi.mock('@/lib/data/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/profile')>()
  return { ...actual, getCurrentProfile: getCurrentProfileMock }
})

vi.mock('@/lib/actions/club-waves', () => ({
  waveJoin: waveJoinMock,
  unwaveJoin: unwaveJoinMock,
}))

const { ClubTimeline } = await import('@/components/clubs/ClubTimeline')

/** Seeds every one of the five sources' first window plus the two decorations
 *  a real mount always issues, so a test only has to override what it cares
 *  about — the shape every fixture below starts from. */
function seedBase({
  joins = { rows: [], horizon: null, until: null, untilInclusive: true },
  rides = [] as RideListItem[],
  replies = emptyReplyWindow,
}: {
  joins?: JoinWindow
  rides?: RideListItem[]
  replies?: ReplyWindow
} = {}) {
  seedQuery(queryKeys.postcards.clubWindow(clubId), emptyPostcardWindow)
  seedQuery(queryKeys.rides.clubAnnouncements(clubId), rides)
  seedQuery(queryKeys.clubs.joins(clubId), joins)
  seedQuery(queryKeys.clubs.threadReplies(clubId), replies)
  seedQuery(queryKeys.clubs.threads(clubId), [])
  seedQuery(queryKeys.clubs.threadsUnread(clubId), {})
}

function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<ClubTimeline club={club} isMember />)
  })
  return container
}

function rerender() {
  act(() => {
    root!.render(<ClubTimeline club={club} isMember />)
  })
}

async function flushTimers() {
  // `vi.runAllTimersAsync()` drains every scheduled `setTimeout`, but React's
  // own commit of the LAST state update a timer's callback kicks off can
  // still be sitting on a microtask queue `runAllTimersAsync` has already
  // stopped watching by the time it resolves — nothing scheduled a further
  // `setTimeout` to keep its loop going, so it returns believing there is
  // nothing left, while the `.then` chain from `fetchNextWindow`'s own
  // `await` is still one tick from committing. A second, separate `act()`
  // resolving two bare microtasks is what lets that commit land before this
  // returns. Verified by removing it locally: a subsequent assertion on the
  // DOM then reads the PRE-fetch render even though the mocked read had
  // already resolved and the component's own state had already updated.
  await act(async () => {
    await vi.runAllTimersAsync()
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  queryStore.clear()
  onlineState.value = true
  window.location.hash = ''
  vi.clearAllMocks()
  getClubJoinsMock.mockImplementation(async () => ({ rows: [], horizon: null, until: null, untilInclusive: true }))
  getClubThreadRepliesMock.mockImplementation(async () => ({
    rows: [],
    horizon: null,
    activity: {},
    until: null,
    untilInclusive: true,
  }))
  getClubRideAnnouncementsMock.mockImplementation(async () => [])
  // jsdom carries no IntersectionObserver at all — `ScrollSentinel.tsx`'s own
  // header. Nothing in this file needs to FIRE it (the hunt and the failure
  // path both progress through timers, never a scroll gesture), only for it
  // to exist so the sentinel's effect does not throw on mount.
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  Element.prototype.scrollIntoView = vi.fn()
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
})

describe('ClubTimeline — the four tail states (design.md §D2)', () => {
  it('extendable: draws the sentinel, no offline text, no foot, no floor entry', () => {
    // 25 short (unsaturated) joins is enough on its own to make the display
    // CAP the thing that cuts — no source needs to saturate for `complete` to
    // read false, and no fetch is ever issued (`pendingClubTimelineSources`
    // is empty when every horizon is null), so this needs no async at all.
    const rows = Array.from({ length: 25 }, (_, i) => join(`u${i}`, `2026-0${1 + (i % 9)}-0${1 + (i % 8)}T00:00:00Z`))
    seedBase({ joins: { rows, horizon: null, until: null, untilInclusive: true } })

    const html = mount().innerHTML

    // `ScrollSentinel`'s own class, not the bare `aria-hidden="true"` attribute
    // — the wave button's icon carries that too, so the plain string is not
    // unique to the sentinel.
    expect(html).toContain('h-px w-full')
    expect(html).not.toContain("You’re offline")
    expect(html).not.toContain('Older activity lives in')
    expect(html).not.toContain('created the club')
  })

  it('offline: says the stream is paused, keeps the sentinel mounted, draws no skeleton', () => {
    onlineState.value = false
    const rows = Array.from({ length: 25 }, (_, i) => join(`u${i}`, `2026-0${1 + (i % 9)}-0${1 + (i % 8)}T00:00:00Z`))
    seedBase({ joins: { rows, horizon: null, until: null, untilInclusive: true } })

    const html = mount().innerHTML

    expect(html).toContain("You’re offline")
    expect(html).toContain('h-px w-full')
    // The offline row draws no skeleton — `client-render-shell`'s rule that a
    // loading treatment must never sit on screen with nothing that can
    // resolve it.
    expect(html).not.toContain('animate-pulse')
  })

  it('complete: draws the club-created floor entry and nothing past it', () => {
    // Three short rows and nothing else — no source saturates, so the
    // horizon is null and the cap (20) cuts nothing either.
    const rows = [join('u0', '2026-01-03T00:00:00Z'), join('u1', '2026-01-02T00:00:00Z')]
    seedBase({ joins: { rows, horizon: null, until: null, untilInclusive: true } })

    const html = mount().innerHTML

    expect(html).toContain('The club was created.')
    expect(html).not.toContain('h-px w-full')
    expect(html).not.toContain('Older activity lives in')
    expect(html).not.toContain("You’re offline")
  })

  it('terminal but incomplete: a failed extension draws the foot and Try again, never a silent stall', async () => {
    // One join above a horizon, and a ride below it that the horizon
    // excludes — the minimal shape that keeps `complete` false without
    // needing every real source bound satisfied (`club-timeline.test.ts`
    // already owns that relationship).
    const horizon = '2026-01-04T00:00:00Z'
    seedBase({
      joins: { rows: [join('u-owner', '2026-01-05T00:00:00Z')], horizon, until: null, untilInclusive: true },
      rides: [ride('r-old', '2026-01-01T00:00:00Z')],
    })
    getClubJoinsMock.mockImplementation(async () => {
      throw new Error('network down')
    })

    mount()
    // The connectivity-resume effect fires on mount (`online` starts true)
    // and schedules the extension `fetchNextWindow` behind `setTimeout(fn,
    // 0)` — `react-hooks/set-state-in-effect`'s own reason, restated in
    // `ClubTimeline.tsx`'s header.
    await flushTimers()

    const html = container!.innerHTML
    expect(html).toContain('Could not load more.')
    expect(html).toContain('Try again')
    expect(html).toContain('Older activity lives in')
    // Verified both ways per CLAUDE.md §Working Principles: without
    // `resolveClubTimelineTailState`'s `failed || advance === 'capped'`
    // branch this reads `more-coming` forever — the sentinel stays and the
    // rider never sees why nothing is happening. Confirmed by temporarily
    // removing that clause locally: this assertion fails and the sentinel's
    // `h-px w-full` div appears instead.
    expect(html).not.toContain('h-px w-full')
  })
})

describe('ClubTimeline — the anchor hunt scrolls once and never again (design.md §D6)', () => {
  it('finds a row past the first window, scrolls once, and a later dependency change does not scroll it again', async () => {
    const joinHorizon = '2026-01-04T00:00:00Z'
    const replyHorizon = '2026-01-04T00:00:00Z'
    const ownerJoin = join('u-owner', '2026-01-05T00:00:00Z')
    const oldJoin = join('u-old', '2026-01-03T00:00:00Z')
    // Excluded from the very first render by the (persistent) reply horizon
    // below — what keeps the stream genuinely incomplete across the whole
    // test, rather than `complete` flipping true the instant the join source
    // alone finishes (a single-source fixture cannot exclude anything of its
    // own — `club-timeline.test.ts`'s own merge tests are what pin that).
    const oldRide = ride('r-old', '2026-01-01T00:00:00Z')

    seedBase({
      joins: { rows: [ownerJoin], horizon: joinHorizon, until: null, untilInclusive: true },
      rides: [oldRide],
      replies: { rows: [], horizon: replyHorizon, activity: {}, until: null, untilInclusive: true },
    })

    getClubJoinsMock.mockImplementationOnce(async () => ({
      rows: [oldJoin],
      horizon: null,
      until: joinHorizon,
      untilInclusive: true,
    }))
    // First call: still pending — keeps `complete` false so the hunt's OWN
    // fetch (not a manual scroll) is what the test can drive a second round
    // through. Second call: finished — the one unambiguous LATER change to
    // `advance`/`timeline.complete` this test forces, to prove the guard
    // rather than merely fail to disprove it (a re-render with nothing
    // actually different would pass by construction, not by the fix).
    getClubThreadRepliesMock
      .mockImplementationOnce(async () => ({
        rows: [],
        horizon: replyHorizon,
        activity: {},
        until: null,
        untilInclusive: true,
      }))
      .mockImplementationOnce(async () => ({
        rows: [],
        horizon: null,
        activity: {},
        until: replyHorizon,
        untilInclusive: true,
      }))

    // Offline for this half — `handleSentinelVisible`'s own online check has
    // no equivalent in the hunt's `fetch-window` branch, so this isolates the
    // hunt as the ONLY thing driving `fetchNextWindow`, rather than racing it
    // against the separate connectivity-resume effect (also scheduled on
    // mount, and NOT what this test is about).
    onlineState.value = false
    window.location.hash = '#join:u-old'

    mount()
    // Cascades: the hunt's 'continue' step schedules `fetchNextWindow`, which
    // resolves the join source, which makes `join:u-old` renderable, which
    // re-runs the hunt effect (deps changed) and finds it. Two rounds because
    // each round only drains the timers that exist AT THE START of the round —
    // `fetchNextWindow`'s async continuation schedules the next one (the
    // settle timeout) after this round's own timer queue has already gone
    // quiet once.
    await flushTimers()
    await flushTimers()

    const scrollSpy = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(container!.innerHTML).toContain('join:u-old')

    // Connectivity returning is what the real app uses to resume the stream
    // without a further gesture — here it is also the trigger for the one
    // more, definite `advance`/`complete` change the guard has to survive.
    onlineState.value = true
    rerender()
    await flushTimers()

    // The stream is now `complete` (the reply source's second window finally
    // came back short) — a state the hunt effect never saw while it was still
    // 'hunting', and exactly the shape of a "late refetch" `design.md` §D6
    // names. Verified both ways: reverting `scrolled`/`huntState` to the
    // single boolean the bug report describes makes this assertion fail —
    // NOT because it scrolls twice, but because the FIRST scroll never
    // happens at all (the flag is set on the very first `rowsReady`, before
    // the hunt's own fetch can run), which is `design.md` §D6's own point:
    // a single flag does not merely double-fire, it starves the hunt.
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })

  it('continues the hunt once a deferred read resolves on a LATER tick than the "fetching" commit', async () => {
    // The class of bug the OTHER test above cannot see: every mock there
    // resolves inside the same microtask turn `runAllTimersAsync` is already
    // draining, so the render that flips `fetching: true` and the render
    // that flips it back to `false` land inside one `flushTimers()` call
    // with nothing to tell apart. Here the join read is deferred behind a
    // promise THIS TEST releases by hand, strictly after the `fetching:
    // true` render has already committed and the hunt effect has already
    // run once against it — the exact ordering the bug lives on: the effect
    // bails at the `fetchingRef.current` guard on that run, and if `fetching`
    // is not itself a dependency, React records `huntWindowsSpent`
    // (already bumped) and `advance` (still `'fetch-window'`, nothing else
    // having changed) as this effect's new baseline — so the LATER render
    // where `fetching` flips back to `false` changes no listed dependency,
    // and the effect never re-runs to notice the row now exists.
    //
    // `replyHorizon` stays BELOW `joinHorizon` and is never satisfied in this
    // test (the replies mock is pinned to it for the whole test) — that is
    // what keeps `advance` reading `'fetch-window'` and `timeline.complete`
    // reading `false` identically on BOTH sides of the bug's commit
    // boundary, which is the exact condition the stale dependency array
    // needs to hide behind. `oldJoin` sits ABOVE `replyHorizon` so it
    // survives the merge's own horizon cut once the join source resolves —
    // below it, the row would be fetched but withheld from display by the
    // coherence horizon itself, for a reason that has nothing to do with
    // this bug (`club-timeline.test.ts` owns that relationship). `oldRide`
    // sits below `replyHorizon` so something is genuinely excluded from the
    // very first render, which is what keeps `complete` false at all —
    // without it a single join-row fixture reads `complete: true` on its own
    // and the hunt never enters `'continue'` in the first place.
    const replyHorizon = '2026-01-02T00:00:00Z'
    const joinHorizon = '2026-01-04T00:00:00Z'
    const ownerJoin = join('u-owner', '2026-01-05T00:00:00Z')
    const oldJoin = join('u-old', '2026-01-03T00:00:00Z')
    const oldRide = ride('r-old', '2026-01-01T00:00:00Z')

    seedBase({
      joins: { rows: [ownerJoin], horizon: joinHorizon, until: null, untilInclusive: true },
      rides: [oldRide],
      replies: { rows: [], horizon: replyHorizon, activity: {}, until: null, untilInclusive: true },
    })

    // Pinned to the SAME horizon for the whole test — see the note above.
    getClubThreadRepliesMock.mockImplementation(async () => ({
      rows: [],
      horizon: replyHorizon,
      activity: {},
      until: replyHorizon,
      untilInclusive: true,
    }))

    let releaseJoinFetch: (() => void) | null = null
    getClubJoinsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseJoinFetch = () =>
            resolve({ rows: [oldJoin], horizon: null, until: joinHorizon, untilInclusive: true })
        })
    )

    // Offline, matching the other test — isolates the hunt as the only thing
    // that can call `fetchNextWindow` here.
    onlineState.value = false
    window.location.hash = '#join:u-old'

    mount()

    // Drains the hunt's first 'continue' timer: `fetchNextWindow` starts,
    // flips `fetching` true synchronously, and then hangs on the deferred
    // join read. This is the render the bug's stale dependency array gets
    // stuck on.
    await flushTimers()
    expect(releaseJoinFetch).not.toBeNull()
    expect(container!.innerHTML).not.toContain('join:u-old')

    const scrollSpy = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>
    expect(scrollSpy).not.toHaveBeenCalled()

    // Released only now — strictly after the "fetching: true" render and the
    // hunt effect's one bailed-out run against it.
    releaseJoinFetch!()
    await flushTimers()
    await flushTimers()

    // The row is on screen either way — an ordinary re-render draws whatever
    // `useQuery`'s cache now holds regardless of whether the anchor-hunt
    // EFFECT itself ever re-ran. The scroll is the one signal that only
    // fires if the effect noticed.
    expect(container!.innerHTML).toContain('join:u-old')
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })
})
