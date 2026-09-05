import { resolveSupabase } from '@/lib/supabase/resolve'
import { unwrapList } from '@/lib/data/unwrap'
import type { BlockedRider, HiddenPostcard } from '@/types'

/**
 * The two reads behind PD-298's undo lists, and the reason both are RPCs rather
 * than ordinary selects.
 *
 * **Neither list can be read from its own table.** That is the finding that
 * reshaped this story, and it is why `unblockRider` and `unhidePostcard` sat
 * with no caller from the day they were written — not because the design drew
 * no screen, but because neither screen could be populated:
 *
 * - `blocks` SELECT is `auth.uid() = blocker_id`, so a rider *can* read their
 *   own block rows — but `009`'s `profiles` SELECT policy applies
 *   `private.is_blocked`, which is **symmetric**, so the blocked rider's
 *   profile row is not readable by the rider who blocked them. Measured on DEV
 *   as `authenticated`: own `blocks` rows 1, the blocked rider's `profiles` row
 *   **0**. A join would return a list of UUIDs.
 * - `postcard_hides` SELECT is `user_id = auth.uid()`, so the hide rows read
 *   fine — but `011` §3 put the hide conjunct *inside* the `postcards` SELECT
 *   policy, so the postcard behind a hide is unreadable to the very rider who
 *   hid it. An embed would return nulls.
 *
 * `105` supplies one `security definer` accessor per list, each scoped to
 * `auth.uid()` and each restating the conjunct it deliberately drops; `106`
 * narrows the hides one to two columns after a pre-merge review found its
 * preview was a block detector. See
 * `openspec/changes/undo-a-block-or-a-hide/design.md` D1–D4.
 */

/**
 * Every rider this rider has blocked, newest first.
 *
 * Returns rows the `profiles` policy would refuse, which is the whole point —
 * so do not "improve" this by joining `profiles` here to fill in an avatar or a
 * bike. The accessor returns the three columns that can be honestly rendered
 * and withholds the ones that provably cannot be signed (`BlockedRider`).
 *
 * **Symmetry cuts one way only.** `private.is_blocked` matches either
 * direction, so a rider is equally invisible to someone who blocked *them* —
 * but those rows are not on this list, because the accessor filters
 * `blocker_id = auth.uid()`. A rider only ever sees, and can only ever lift,
 * the blocks they placed themselves.
 */
export async function getBlockedRiders(): Promise<BlockedRider[]> {
  const supabase = await resolveSupabase()
  return unwrapList<BlockedRider>(await supabase.rpc('my_blocked_riders'), 'the riders you have blocked')
}

/** One page of the hidden list. The accessor caps this at 50 whatever is asked. */
export const HIDDEN_POSTCARDS_PAGE_SIZE = 20

/**
 * The keyset cursor, and it is a **pair** rather than a timestamp.
 *
 * `106` orders by `(created_at desc, postcard_id desc)` and cursors on both,
 * because a cursor on the timestamp alone silently drops a row whenever two
 * hides share a `created_at` and straddle a page boundary. That is unreachable
 * while each hide is its own transaction and reachable the moment anything
 * writes two in one statement — a bulk "hide everything from this rider", say.
 *
 * **Passing `hiddenAt` without `postcardId` degrades to exactly that lossy
 * behaviour rather than erroring**, which is why they travel as one object here
 * instead of two optional arguments a caller can half-fill. `106.4` asserts it
 * in both directions.
 */
export type HiddenPostcardsCursor = { hiddenAt: string; postcardId: string }

/**
 * The postcards this rider has hidden, newest hide first, keyset-paged on
 * `(hidden_at, postcard_id)`. `011`'s `postcard_hides (user_id, created_at desc)`
 * index serves the range scan; the tiebreaker column is **not** in it, so the
 * equal-timestamp arm is a filter on top rather than a pure index walk. Free at
 * any cardinality a rider's own hide list reaches, and stated so that whoever
 * finds this list slow knows where to look first.
 *
 * **Each row is a postcard id and a date, and that is the entire shape on
 * purpose.** `105` also returned a `restorable` flag and a preview; a pre-merge
 * review showed the pair is a **block detector**, because for a postcard with no
 * club `restorable` reduces to `not is_blocked(me, author)` and
 * `getBlockedRiders` above tells the rider their own outbound blocks. `106`
 * removed the differentiation rather than the wording, since no predicate fixes
 * it: for a non-club postcard the only reason to withhold is a block, so
 * withholding is the signal and not withholding leaks the photo.
 *
 * **There is deliberately nothing to sign here, and there never was.** The
 * Storage policy resolves an `EXISTS` against `postcards` as the caller, and the
 * hide conjunct lives inside that policy — so every row on this list, by
 * definition still hidden, fails it. `105`'s client signed a batch of paths that
 * could never come back, on every page load. Do not add it back.
 */
export async function getHiddenPostcards(
  cursor?: HiddenPostcardsCursor
): Promise<HiddenPostcard[]> {
  const supabase = await resolveSupabase()

  return unwrapList<HiddenPostcard>(
    await supabase.rpc('my_hidden_postcards', {
      before_at: cursor?.hiddenAt ?? null,
      before_id: cursor?.postcardId ?? null,
      page_size: HIDDEN_POSTCARDS_PAGE_SIZE,
    }),
    'the postcards you have hidden'
  )
}
