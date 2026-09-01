import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { clubIdSchema, clubIntroductionSchema } from '@/lib/validation/clubs'
import type { ActionState } from '@/lib/actions/state'

/**
 * Posts a rider's own introduction to one club — `public.introduce_to_club`
 * (`097`, PD-365). A plain two-argument function rather than a
 * `(prevState, formData)` pair: `IntroductionPrompt` calls it directly from a
 * submit handler, `ClubMembershipButton`'s shape, because the sheet needs to
 * react to success (close itself) rather than navigate anywhere.
 *
 * **No membership check, no owner check, no default-club check and no
 * duplicate check here.** All four are the RPC's, restated inside a
 * `security definer` body against the caller alone — `097`'s whole point is
 * that a client copy of any of them would be a second rule free to drift and
 * weaker than the one behind it, since the publishable key ships in the
 * bundle. `owesIntroduction` in `lib/data/club-introductions.ts` decides
 * whether the SHEET is even offered; it is a UX affordance and never the
 * enforcement.
 *
 * **ONE message, because the RPC has one raise site.** A nonexistent club, an
 * invisible one, one the caller is not a member of, one they own, the
 * default club and a second introduction all raise the identical error —
 * `097`'s whole reason for collapsing them, so this function does not try to
 * tell them apart and put the oracle back.
 */
export async function introduceToClub(clubId: string, body: string): Promise<ActionState> {
  if (!clubIdSchema.safeParse(clubId).success) return { error: 'That club could not be found.' }

  const parsed = clubIntroductionSchema.safeParse(body)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Write something first.' }

  const supabase = await resolveSupabase()
  const { error } = await supabase.rpc('introduce_to_club', {
    target_club: clubId,
    body: parsed.data,
  })

  if (error) {
    // One message for a nonexistent club, one the caller cannot see, one
    // they are not a member of, one they own, the default club and a second
    // introduction — see this function's header. Naming any one of them
    // would be the oracle `097` was written to refuse.
    return { error: 'That introduction could not be posted.' }
  }

  // `threads(clubId)` reaches `threadsUnread` and `threadReplies` by prefix
  // (`keys.ts`'s header table) — the new thread is what makes the Threads
  // list and the timeline's own thread-creation entry show it, lead line
  // included (`ClubThreadRow`/`ClubTimeline` already derive that line from
  // `author_id`, so no further call names it here). The other two are the
  // decoration this feature adds: the join row's new door and count, and
  // whether this rider is still owed the prompt.
  invalidate(queryKeys.clubs.threads(clubId))
  invalidate(queryKeys.clubs.joinIntroductions(clubId))
  invalidate(queryKeys.clubs.myIntroduction(clubId))

  return { error: null, sent: true }
}
