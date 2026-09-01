import { resolveSupabase } from '@/lib/supabase/resolve'

/**
 * The count and whether the viewer has waved — `postcard_likes`'
 * `likes_count`/`is_liked` pair wearing `092`'s name for the same reaction
 * (`design.md` §D1: "wave" is this app's word for a like, and the new tables
 * are the same mechanism under it).
 */
export type ClubWaveState = { count: number; waved: boolean }

type ClubWaveMap = Record<string, ClubWaveState>

/**
 * Wave state for a batch of subjects of ONE kind — a club's threads, or a
 * club's joins — never both together, because the two are cached and
 * invalidated under two separate keys (`queryKeys.clubs.threadWaves` /
 * `.joinWaves`, `client-cache-invalidation`'s "no key holds a decorated
 * entry"). `ClubTimeline` calls this once per kind, scoped to the ids its own
 * sources are already holding (`getClubThreads`/`getClubJoins`) — never every
 * wave a club has ever had.
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
 * ## The embed question — `design.md` §Q4
 *
 * `club_thread_waves.thread_id → club_threads(id)` is a single-column foreign
 * key, structurally identical to the already-proven
 * `likes_count:postcard_likes(count)` embed on `postcards`
 * (`src/lib/data/postcards.ts`) — so the THREAD branch below embeds the count
 * onto `club_threads` rather than pulling every wave row down to count by
 * hand.
 *
 * `club_join_waves`' key into `club_members` is COMPOSITE
 * (`club_id, subject_user_id`), and whether PostgREST resolves an embeddable
 * relationship through a composite foreign key could not be MEASURED here:
 * `092` had not applied to DEV at the time this file was written —
 * `list_tables`/`execute_sql` against `fpmrimzxadewsaiwpsel` on 2026-08-31
 * show no `club_join_waves` relation yet, and `tasks.md` §7's own ordering
 * rule (`089`'s, restated for `092`) applies the migration only AFTER the
 * bundle that reads it is confirmed serving — so the table this function
 * would query against cannot exist yet at the time any session writes this
 * file. The JOIN branch therefore takes §Q4's own stated default: one raw
 * read of `club_join_waves`, aggregated client-side, rather than an embed.
 * Per that section this is **not a lesser artifact** — only a second round
 * trip the thread branch does not pay — and it happens to cost LESS than the
 * thread branch here: because the RLS-visible rows always include the
 * viewer's own (the block arm's own-row disjunct), one read answers both the
 * count and "is this mine", where the thread branch below needs a second
 * query for the second half.
 *
 * This is flagged as INFERRED rather than measured, per CLAUDE.md's Working
 * Principles — a later session with `092` applied can measure whether
 * PostgREST resolves the composite embed and switch the join branch to it if
 * it does; this is not a settled "it doesn't work".
 */
export async function attachClubWaveState(
  subject:
    | { kind: 'thread'; threadIds: string[] }
    | { kind: 'join'; clubId: string; subjectIds: string[] }
): Promise<ClubWaveMap> {
  return subject.kind === 'thread'
    ? getThreadWaveState(subject.threadIds)
    : getJoinWaveState(subject.clubId, subject.subjectIds)
}

type ThreadWaveCountRow = { id: string; waves_count: { count: number }[] | null }

/**
 * Neither this nor `getJoinWaveState` restates a membership, block,
 * club-visibility or role predicate — the `092` policies already scope both
 * tables to what the parent (`club_threads`/`club_members`) resolves for this
 * caller under their own RLS, the way `getClubThreads` and `getClubJoins`
 * document for the tables they read. Naming a predicate here would be the
 * second copy `club-timeline-engagement`'s SELECT requirement forbids.
 */
async function getThreadWaveState(threadIds: string[]): Promise<ClubWaveMap> {
  if (threadIds.length === 0) return {}

  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [counts, own] = await Promise.all([
    supabase
      .from('club_threads')
      .select('id, waves_count:club_thread_waves(count)')
      .in('id', threadIds),
    user
      ? supabase
          .from('club_thread_waves')
          .select('thread_id')
          .eq('user_id', user.id)
          .in('thread_id', threadIds)
      : Promise.resolve({ data: [] as { thread_id: string }[], error: null }),
  ])

  if (counts.error || own.error) return {}

  const waved = new Set((own.data ?? []).map((row) => row.thread_id))

  const state: ClubWaveMap = {}
  for (const id of threadIds) state[id] = { count: 0, waved: false }
  for (const row of (counts.data ?? []) as unknown as ThreadWaveCountRow[]) {
    state[row.id] = { count: row.waves_count?.[0]?.count ?? 0, waved: waved.has(row.id) }
  }
  return state
}

type JoinWaveRow = { subject_user_id: string; user_id: string }

async function getJoinWaveState(clubId: string, subjectIds: string[]): Promise<ClubWaveMap> {
  if (subjectIds.length === 0) return {}

  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('club_join_waves')
    .select('subject_user_id, user_id')
    .eq('club_id', clubId)
    .in('subject_user_id', subjectIds)

  if (error) return {}

  const state: ClubWaveMap = {}
  for (const id of subjectIds) state[id] = { count: 0, waved: false }
  for (const row of (data ?? []) as JoinWaveRow[]) {
    const entry = state[row.subject_user_id]
    if (!entry) continue
    entry.count += 1
    if (user && row.user_id === user.id) entry.waved = true
  }
  return state
}

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
