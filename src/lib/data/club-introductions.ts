import { resolveSupabase } from '@/lib/supabase/resolve'
import { chunkIds } from '@/lib/data/club-timeline'
import { clubIdSchema } from '@/lib/validation/clubs'

/**
 * A rider's introduction, as the join row needs it — the thread it opens and
 * the count beside it (`097`, PD-365).
 *
 * **No introduction TEXT here.** The join row draws only a door and a
 * number; the words themselves belong to the thread detail alone
 * (`getClubThread`, widened for exactly this in the same change) — reading
 * them onto every join row would ship a paragraph per newcomer to a screen
 * that never shows it.
 *
 * **`commentCount` carries no `partial` flag, unlike `ClubThreadActivity`.**
 * `design.md` §D6's table is explicit about why the two counts are computed
 * differently: this one is `messages_count:club_messages(count)` aggregated by
 * Postgres over every row RLS returns for the ONE thread named here, never a
 * floor over a club-wide message window — so it is exact by construction and
 * carries no `+`.
 */
export type ClubIntroductionState = { threadId: string; commentCount: number }

type IntroductionRow = {
  id: string
  introduces_user_id: string | null
  messages_count: { count: number }[] | null
}

/**
 * A batch of a club's introductions, scoped to the join subjects the timeline
 * is already holding — `attachClubWaveState`'s shape exactly, including its
 * fail-to-`{}` rule (a decoration on a row that already renders without it,
 * `client-render-shell`'s Loading/Error rows) and its resolved-versus-not-yet
 * distinction, which `resolveClubIntroductionState` below is what a caller
 * reads through.
 *
 * **Never every introduction a club has ever had.** `ClubTimeline` calls this
 * once, scoped to `getClubJoins`' own bounded window
 * (`CLUB_TIMELINE_JOINS`) — the same scoping `attachClubWaveState`'s join
 * branch already applies, for the identical reason: this can never become an
 * unbounded read of the club's whole roster.
 *
 * **No `profiles` embed here at all**, so `embed-hints.test.ts` has nothing to
 * check in this file — the join row already has the subject's name from
 * `getClubJoins`, and an introduction's own author is always its subject by
 * construction.
 *
 * **Chunked at `CLUB_TIMELINE_SUBJECT_CHUNK`, since PD-375** —
 * `attachClubWaveState`'s own reasoning verbatim: paging grows `subjectIds`
 * with every fetched join window, a single `.in()` would eventually cross an
 * unmeasured URI limit, and that failure is silent by design (a decoration
 * must not gate its rows) — which is precisely how the introduction door goes
 * quiet at depth, the hole PD-374 was cancelled on the strength of PD-375
 * closing. One erroring chunk fails the whole map, matching the single-request
 * rule this replaces.
 */
export async function attachClubIntroductions(
  clubId: string,
  subjectIds: string[]
): Promise<Record<string, ClubIntroductionState>> {
  if (subjectIds.length === 0) return {}

  const supabase = await resolveSupabase()

  const results = await Promise.all(
    chunkIds(subjectIds).map((ids) =>
      supabase
        .from('club_threads')
        .select('id, introduces_user_id, messages_count:club_messages(count)')
        .eq('club_id', clubId)
        .in('introduces_user_id', ids)
    )
  )

  if (results.some((result) => result.error || !result.data)) return {}

  const state: Record<string, ClubIntroductionState> = {}
  for (const result of results) {
    for (const row of result.data as unknown as IntroductionRow[]) {
      // `introduces_user_id` is NULL on every ordinary thread; the `in()`
      // filter above already excludes those, but the column stays nullable in
      // the type because PostgREST does not narrow it, so this is a type
      // guard rather than a real filter.
      if (!row.introduces_user_id) continue
      state[row.introduces_user_id] = {
        threadId: row.id,
        commentCount: row.messages_count?.[0]?.count ?? 0,
      }
    }
  }
  return state
}

/**
 * The rendered state for one subject — `resolveClubWaveState`'s fold, so every
 * caller reads a possibly-absent map the same way.
 *
 * `undefined` covers two cases a caller must treat identically: the read has
 * not resolved at all yet, and it resolved with nothing recorded for this
 * rider (no introduction, or one the viewer's own block state hides). Both
 * mean "draw no door" — there is no disabled state to draw for a link that
 * either exists or does not, unlike `ClubWaveButton`'s toggle.
 */
export function resolveClubIntroductionState(
  map: Record<string, ClubIntroductionState> | undefined,
  userId: string
): ClubIntroductionState | undefined {
  return map ? map[userId] : undefined
}

/**
 * Whether the SIGNED-IN rider has already introduced themselves in this club —
 * the one conjunct of `design.md` §D7's rule that no other read on the club
 * detail screen already answers.
 *
 * **Scoped to the caller alone, never batched with other subjects.** The
 * batched `attachClubIntroductions` read above is bounded by
 * `CLUB_TIMELINE_JOINS` (60), so a rider who joined long enough ago to have
 * fallen out of that window would never appear in it — and "does this rider
 * owe one" has to hold for every member for as long as they are one, not only
 * the sixty most recent. This is therefore its own round trip, scoped to one
 * club and one rider, and it is the one this feature's "does this rider owe
 * an introduction" state actually depends on.
 *
 * **Fails to `false` rather than throwing.** A failed read here must cost the
 * prompt and never the screen — showing it to a rider who already has an
 * introduction is a wrong prompt, not a broken one, and the RPC's own
 * uniqueness constraint refuses a second write regardless of what this read
 * answered.
 */
export async function hasIntroducedClub(clubId: string): Promise<boolean> {
  if (!clubIdSchema.safeParse(clubId).success) return false

  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false

  const { data, error } = await supabase
    .from('club_threads')
    .select('id')
    .eq('club_id', clubId)
    .eq('introduces_user_id', user.id)
    .maybeSingle()

  if (error) return false
  return !!data
}

/**
 * `design.md` §D7's rule, restated as a pure function so it is one thing to
 * read rather than four booleans assembled differently at every call site:
 *
 *     owes an introduction  <=>  the viewer has a club_members row for this club
 *                            AND its role is not 'owner'
 *                            AND the club is not the default club
 *                            AND no club_threads row has introduces_user_id = the viewer
 *
 * Evaluated from state the screen already reads for itself — `viewerRole` and
 * `isDefaultClub` come off `getClub`, `hasIntroduced` off the read above — so
 * it holds however the membership came to exist, which is the whole point:
 * it is not attached to `joinClub`'s success path and so is not blind to the
 * other five doors.
 */
export function owesIntroduction(
  club: { viewerRole: 'owner' | 'admin' | 'member' | null; isDefaultClub: boolean },
  hasIntroduced: boolean
): boolean {
  return (
    club.viewerRole !== null &&
    club.viewerRole !== 'owner' &&
    !club.isDefaultClub &&
    !hasIntroduced
  )
}
