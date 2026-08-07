import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import type { ActionState } from '@/lib/actions/state'

/**
 * Marks every one of this rider's unread notifications read — the only write
 * the client can make on `036`'s table, because `authenticated` holds a
 * column-level UPDATE grant on `read_at` alone and no INSERT or DELETE grant
 * at all.
 *
 * **No id, no `.eq('user_id', …)`.** The UPDATE policy (`036` §4) is the same
 * predicate as SELECT's — recipient, block and every resolvability conjunct,
 * in both `using` and `with check` — so this statement already touches
 * exactly the rows this rider can see and no others. A rider blocked out of a
 * row, or evicted from one by leaving a private club, is untouched: the row
 * survives and returns unread if the eviction is later reversed, which is the
 * intended behaviour rather than a gap (`design.md` §D5).
 *
 * Called once per visit to `/notifications` by `MarkNotificationsRead`, not
 * from a form — there is no per-row dismiss and no "mark all read" button in
 * the design at all, so opening the screen is the only affordance there is to
 * hang this from, the same shape `markClubSeen`/`markFeedSeen` already use for
 * their own watermarks.
 */
export async function markNotificationsRead(): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to read your notifications.' }

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)

  if (error) {
    return { error: 'Could not mark your notifications read. Try again in a moment.' }
  }

  // The **count only**, not the `notifications` prefix. `invalidate` matches by
  // prefix, and the one screen that calls this has `notifications.list()`
  // mounted with a live fetcher — so invalidating `all()` refetched page one
  // immediately, on every open, including when zero rows were unread. Two
  // round trips to `eu-west-1` for a screen whose list this write does not
  // change: nothing renders a per-row read state, because the design draws
  // none.
  //
  // The count and the list still cannot disagree, and that was never what the
  // shared prefix bought — they agree because both read the same RLS
  // predicate, so a row the list cannot return is a row the count cannot
  // count. Widening the invalidation to keep them honest would be paying a
  // fetch for an invariant the database already holds.
  invalidate(queryKeys.notifications.unread())
  return { error: null }
}
