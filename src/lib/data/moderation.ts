import { resolveSupabase } from '@/lib/supabase/resolve'
import { signImagePaths } from '@/lib/data/media'
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
 * `auth.uid()` and each restating the conjunct it deliberately drops. See
 * `openspec/changes/undo-a-block-or-a-hide/design.md` D1–D3.
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
 * The postcards this rider has hidden, newest hide first, keyset-paged on
 * `hidden_at` — `011`'s `postcard_hides (user_id, created_at desc)` index
 * serves the cursor exactly.
 *
 * **A row whose `restorable` is false carries no preview at all**, and the
 * client must not try to reconstruct one. The three reasons a hide stops being
 * restorable are collapsed inside the function on purpose (design D4): one of
 * them is "the author has since blocked you", and surfacing it would turn this
 * screen into a block detector. Every preview column arrives NULL together, so
 * there is nothing here to tell the cases apart with.
 *
 * Only a restorable row carries an `image_path`, so only a restorable row is
 * signed — and signing is authorized as the rider, through the ordinary Storage
 * path, exactly as the feed does. Nothing here widens a Storage policy; a
 * postcard the rider may no longer see stays unreadable, which is why the
 * unrestorable row shows a placeholder rather than a photo.
 */
export async function getHiddenPostcards(before?: string): Promise<HiddenPostcard[]> {
  const supabase = await resolveSupabase()

  const rows = unwrapList<HiddenPostcard>(
    await supabase.rpc('my_hidden_postcards', {
      before_at: before ?? null,
      page_size: HIDDEN_POSTCARDS_PAGE_SIZE,
    }),
    'the postcards you have hidden'
  )

  const paths = rows
    .map((row) => row.image_path)
    .filter((path): path is string => !!path)

  if (paths.length > 0) {
    const urls = await signImagePaths(paths, supabase)
    for (const row of rows) {
      row.image_url = row.image_path ? (urls.get(row.image_path) ?? null) : null
    }
  }

  return rows
}
