import { resolveSupabase } from '@/lib/supabase/resolve'
import { joinClub } from '@/lib/actions/clubs'
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
  // (`keys.ts`'s header table).
  //
  // **It no longer reaches a surface that can SHOW this thread, and the claim
  // that it did was wrong in both halves.** The Threads list is deleted
  // (PD-426), and an introduction never reaches the timeline's thread-creation
  // entry either: it carries `introduces_user_id`, which `getClubThreads`
  // filters at `.is(ANNOUNCEMENT_MARKER, null)` and the reply source filters on
  // its embedded thread. What actually renders an introduction is
  // `attachClubIntroductions` on the JOIN row, invalidated as
  // `joinIntroductions` below. This claim is kept because over-invalidating is
  // safe and cheap, not because a reader should trust the old reasoning
  // (`ClubTimeline` derives the lead line from
  // `author_id`, so no further call names it here). The other two are the
  // decoration this feature adds: the join row's new door and count, and
  // whether this rider is still owed the prompt.
  invalidate(queryKeys.clubs.threads(clubId))
  invalidate(queryKeys.clubs.joinIntroductions(clubId))
  invalidate(queryKeys.clubs.myIntroduction(clubId))

  return { error: null, sent: true }
}

/**
 * What `joinAndIntroduceToClub` did — four outcomes, and two of them are the
 * reason this is not an `ActionState`.
 *
 * `introduction-failed` is a **success and a failure at once**: the membership
 * is there and the words are not. Collapsing it into `{ error }` would make the
 * sheet tell a rider nothing happened on the one path where something did.
 *
 * `joined-without-introduction` is PD-418's: an empty body is no longer a
 * refusal but a decision — *join me, I have nothing to say yet* — and it is a
 * distinct outcome rather than a flavour of `joined-and-introduced` because the
 * caller must not report a thread that was never written. Both leave a
 * membership, which is what the sheet's dismissal iff reads.
 */
export type JoinAndIntroduceResult =
  | { outcome: 'joined-and-introduced' }
  | { outcome: 'joined-without-introduction' }
  | { outcome: 'join-failed'; error: string }
  | { outcome: 'introduction-failed'; error: string }

/**
 * `Join club`, in the sheet's pre-join mode — joins the club, then introduces
 * the rider to it if they left any text (PD-392, PD-418).
 *
 * **The join no longer depends on the introduction, and that inversion is
 * PD-418's whole content.** Under PD-392 an empty body refused the join
 * outright, which made writing an introduction the price of membership. It is
 * now the other way round: the membership is what the rider asked for and the
 * introduction is what they may also send.
 *
 * ## The order is forced, and it is not a preference
 *
 * `introduce_to_club` (`097`) refuses a caller who is not a member — one of the
 * six conditions collapsed into `introduceToClub`'s single message above. So
 * there is no arm in which the introduction goes first, and this function
 * cannot be reordered without the RPC changing underneath it.
 *
 * ## Two separately failable writes, and NO compensating delete
 *
 * There is no transaction across them and none is available: PostgREST has no
 * multi-statement request, which is why `createClub` already lives with two
 * inserts and none either. **A failed introduction therefore leaves a member
 * who owes one, and that state is left standing on purpose** — it is `097`'s
 * own first-class *"a rider who joins and writes no introduction"*, reached by
 * one more route, and the club detail's state-driven sheet asks again on the
 * next visit.
 *
 * Undoing the join instead would write a `club_joined` notification to the club
 * and remove the member underneath it, so every admin sees an arrival that is
 * no longer there — the exact wake PD-392 refuses in *"Defer the join; do not
 * undo it"*. It would also add a failure point of its own, and `095`'s
 * `protect_club_owner_membership` refuses some deletes outright, so the
 * compensation would not even be total. `design.md` §D1 carries the full
 * argument.
 *
 * ## Not an RPC, deliberately
 *
 * A combined `join_and_introduce` function would be a **seventh**
 * membership-writing door and would leave the other six exactly as they are —
 * `proposal.md` §Non-Goals. This composes the two existing writers instead, so
 * each keeps its own cache claims and its own enforcement, and this function
 * owns nothing but the ordering.
 *
 * ## "The join succeeded" means the upsert did not error
 *
 * It does **not** mean a row was created: `joinClub` upserts with
 * `ignoreDuplicates`, so a rider who is already a member gets a clean success
 * and no write. That is why the caller must not open this path for a rider who
 * already owes nothing — `JoinClubButton` and `ClubMembershipButton` both check
 * before the sheet opens (`design.md` §D4) — and why the copy on the
 * `introduction-failed` path speaks about the rider's **state** ("You've joined
 * the club") rather than about this call having created it.
 */
export async function joinAndIntroduceToClub(
  clubId: string,
  body: string,
  /**
   * Fired the moment the membership write returns without an error, before the
   * introduction is attempted.
   *
   * **Named for what it asserts.** A clean return means a `club_members` row
   * *exists* — an RLS violation would have raised — but not that this statement
   * *created* one, because `joinClub` upserts with `ignoreDuplicates`. Existence
   * is what every caller needs and the stronger claim would contradict this
   * function's own header.
   *
   * **The caller cannot observe that moment any other way, and two rules depend
   * on it.** The sheet's second control must stop saying `Cancel` as soon
   * as the join lands — it is a lie from that instant — and its dismissal lock
   * covers the membership write and *no longer*, because once a membership
   * exists `097`'s "always dismissible, pending or not" applies again. Without
   * this the caller sees one pending window spanning both writes, so both rules
   * silently become "until the introduction resolves" instead.
   *
   * **Required, not optional, and that is this change's own lesson applied to
   * itself.** A second caller omitting it would get exactly the defect this
   * parameter was added to fix — `Cancel` on screen over a committed join
   * and the lock held past the membership write — with **no type error**. That
   * is the same argument `ClubMembershipButton`'s opener carries, one file over
   * and one review earlier. A caller with nothing to do here passes a no-op and
   * says so.
   */
  onMembershipExists: () => void
): Promise<JoinAndIntroduceResult> {
  // **An empty body is a decision, not an error — PD-418.** The rider cleared
  // the prefilled starter and pressed `Join club`, which means join me and I
  // will introduce myself later. `club_threads_introduction_length` refuses
  // whitespace-only text, so the introduction must never be ATTEMPTED here
  // rather than attempted and caught: a caught refusal would surface as
  // `introduction-failed`, telling a rider something went wrong on the one path
  // where everything went exactly as they asked.
  //
  // Checked on the RAW body against the same `\S` rule the database uses (which
  // `.trim()` agrees with, per `clubIntroductionSchema`'s own comment) rather
  // than on the parsed value, because parsing an empty body fails and there
  // would be nothing left to branch on.
  const wantsIntroduction = body.trim().length > 0

  // Parsed BEFORE the join, so a body the database would refuse never costs a
  // membership the rider did not ask for on its own. `introduceToClub` parses
  // it again — that is the enforcement and this is the ordering guard; the two
  // are not redundant, because only this one runs before the first write.
  //
  // **Still reached for a too-long body**, which is the case this guard now
  // exists for: emptiness is handled above, so anything failing here is text
  // the rider wrote and the database would reject, and refusing before the join
  // is what stops them paying a membership for it.
  const parsed = wantsIntroduction ? clubIntroductionSchema.safeParse(body) : null
  if (parsed && !parsed.success) {
    return {
      outcome: 'join-failed',
      error: parsed.error.issues[0]?.message ?? 'Write something first.',
    }
  }

  const joined = await joinClub(clubId)
  if (joined.error) return { outcome: 'join-failed', error: joined.error }

  onMembershipExists()

  if (!parsed) return { outcome: 'joined-without-introduction' }

  const introduced = await introduceToClub(clubId, parsed.data)
  if (introduced.error) return { outcome: 'introduction-failed', error: introduced.error }

  return { outcome: 'joined-and-introduced' }
}
