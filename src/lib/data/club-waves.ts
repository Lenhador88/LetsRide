import { resolveSupabase } from '@/lib/supabase/resolve'
import { chunkIds } from '@/lib/data/club-timeline'

/**
 * The count and whether the viewer has waved — `postcard_likes`'
 * `likes_count`/`is_liked` pair wearing `092`'s name for the same reaction
 * (`design.md` §D1: "wave" is this app's word for a like, and the new tables
 * are the same mechanism under it).
 */
export type ClubWaveState = { count: number; waved: boolean }

type ClubWaveMap = Record<string, ClubWaveState>

/**
 * Wave state for a batch of a club's JOINS — the only waveable row on the club
 * timeline as of PD-372.
 *
 * **This read used to take a `kind`, and the second arm is gone rather than
 * merely unused.** `092` gave a thread's creation row a wave of its own; the
 * product owner retired it on 2026-09-02 (*"yes, only annoucements are
 * waveable please"*), so `getThreadWaveState`, `queryKeys.clubs.threadWaves`
 * and `waveThread`/`unwaveThread` went with the control. The one-armed
 * discriminated union went too — a `kind` that can only ever be `'join'`
 * reads as a choice where there is none. **`club_thread_waves` itself is
 * still live**, with its `092` policies and both `098` triggers, and nothing
 * in the app writes it any more: `an-introduction-appears-only-as-its-announcement/proposal.md`
 * §The table with no writer is the pointer for whoever makes that call.
 *
 * `ClubTimeline` calls this once, scoped to the ids `getClubJoins` is already
 * holding — never every wave a club has ever had.
 *
 * **Fails to `{}`, never throws.** The wave affordance is a decoration on an
 * entry that already renders without it — `club-render-shell`'s "a decoration
 * on a list SHALL NOT gate the list", `getClubThreadUnread`'s rule
 * transferred. `resolveClubWaveState` below is what a caller reads through:
 * the "still loading" case (the map itself is `undefined`, because the
 * `useQuery` key has not activated yet) and the "resolved, this id has
 * nothing recorded" case (the map is defined and the id is simply absent,
 * whether that is a genuine zero or a swallowed error) both read the same way
 * to a caller that only wants a state to render.
 *
 * ## Why this is a raw read rather than an embedded count — `design.md` §Q4
 *
 * `club_join_waves`' key into `club_members` is COMPOSITE
 * (`club_id, subject_user_id`), and whether PostgREST resolves an embeddable
 * relationship through a composite foreign key could not be MEASURED when
 * this was written: `092` had not applied to DEV, so the table this function
 * queries did not yet exist. This therefore takes §Q4's own stated default —
 * one raw read of `club_join_waves`, aggregated client-side, rather than an
 * embed. Per that section this is **not a lesser artifact**, and it happens
 * to cost one round trip rather than two: because the RLS-visible rows always
 * include the viewer's own (the block arm's own-row disjunct), one read
 * answers both the count and "is this mine".
 *
 * This is flagged as INFERRED rather than measured, per CLAUDE.md's Working
 * Principles — a later session with `092` applied can measure whether
 * PostgREST resolves the composite embed and switch to it if it does; this is
 * not a settled "it doesn't work".
 *
 * This restates no membership, block, club-visibility or role predicate —
 * `092`'s policy already scopes the table to what `club_members` resolves for
 * this caller under their own RLS, the way `getClubThreads` and
 * `getClubJoins` document for the tables they read. Naming a predicate here
 * would be the second copy `club-timeline-engagement`'s SELECT requirement
 * forbids.
 *
 * **Chunked at `CLUB_TIMELINE_SUBJECT_CHUNK`, since PD-375.** Paging grows
 * `subjectIds` by up to `CLUB_TIMELINE_JOINS` per fetched window, and a single
 * `.in()` serialises every id into the PostgREST query string — so an
 * unbounded list eventually crosses whatever URI limit sits in front of it.
 * That failure would be **silent**: this function already fails to `{}`
 * rather than throwing, on the standing rule that a decoration must not gate
 * the rows it decorates, which is exactly what would make a paging-depth URI
 * limit costs the wave controls with nothing red anywhere. Chunking removes
 * the unmeasured limit from the argument rather than resting on it — see
 * `CLUB_TIMELINE_SUBJECT_CHUNK`'s own header. **One chunk erroring fails the
 * whole map** rather than degrading partially, matching the single-request
 * rule this replaces: a caller reading a possibly-absent map already cannot
 * tell "some of this failed" from "none of it did", so a partial map would be
 * a distinction with no reader.
 */
export async function attachClubWaveState(
  clubId: string,
  subjectIds: string[]
): Promise<ClubWaveMap> {
  if (subjectIds.length === 0) return {}

  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const results = await Promise.all(
    chunkIds(subjectIds).map((ids) =>
      supabase
        .from('club_join_waves')
        .select('subject_user_id, user_id')
        .eq('club_id', clubId)
        .in('subject_user_id', ids)
    )
  )

  if (results.some((result) => result.error)) return {}

  const state: ClubWaveMap = {}
  for (const id of subjectIds) state[id] = { count: 0, waved: false }
  for (const result of results) {
    for (const row of (result.data ?? []) as JoinWaveRow[]) {
      const entry = state[row.subject_user_id]
      if (!entry) continue
      entry.count += 1
      if (user && row.user_id === user.id) entry.waved = true
    }
  }
  return state
}

type JoinWaveRow = { subject_user_id: string; user_id: string }

/**
 * The rendered state for one subject, folded so every caller reads a
 * possibly-absent map the same way rather than re-deriving `?? { count: 0,
 * waved: false }` at each call site.
 *
 * `undefined` in, `undefined` out: the read has not resolved AT ALL yet
 * (`client-render-shell`'s Loading row — the caller draws the control
 * disabled, not absent). A defined map with nothing recorded for `id` reads
 * as a genuine zero (Empty row) whether that is because nobody has waved it
 * or because the read failed and was swallowed to `{}` (Error row) — the two
 * are deliberately indistinguishable to a caller, because both render the
 * same way: an ordinary, interactive, unwaved control.
 */
export function resolveClubWaveState(
  map: ClubWaveMap | undefined,
  id: string
): ClubWaveState | undefined {
  return map ? (map[id] ?? { count: 0, waved: false }) : undefined
}
