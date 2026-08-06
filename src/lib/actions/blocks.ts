import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { EVERYTHING } from '@/lib/query/keys'
import { riderIdSchema } from '@/lib/validation/blocks'
import type { ActionState } from '@/lib/actions/state'

/**
 * Blocking changes what is visible *everywhere at once* — decision #2: the
 * blocked rider disappears from feeds, club rosters, ride crews, search and
 * chat simultaneously, because one predicate is applied across every policy.
 *
 * So the invalidation has to be just as broad. Clearing `postcards` alone would
 * leave a blocked rider still showing in a cached club roster, which is exactly
 * the half-applied block the architecture exists to prevent. The whole
 * authenticated tree is the honest blast radius; a block is rare enough that
 * the cost is irrelevant.
 *
 * `EVERYTHING` is the empty prefix, which matches every key — the direct
 * translation of `revalidatePath('/', 'layout')`, and the case `keys.ts`
 * documents it for. Task 5.10 is what makes it load-bearing rather than
 * conservative: the blocked rider's content must leave **every cached view the
 * blocker holds**, not only the next fetch, and no single prefix can express
 * that because they appear under `postcards`, `rides`, `clubs` *and* `profile`.
 *
 * `invalidate` rather than `clearQueryCache`, and the difference matters here.
 * Clearing would blank every screen the blocker is currently looking at down to
 * a skeleton; invalidating refetches the mounted ones in place, so the block
 * takes effect as content disappearing rather than as the app restarting. Only
 * sign-out wants the destructive one.
 */
function invalidateEverything() {
  invalidate(EVERYTHING)
}

/**
 * The row is directional — who pressed the button — but the effect is
 * symmetric. Neither party sees the other afterwards.
 *
 * `ignoreDuplicates` rather than a plain upsert, the same reason `likePostcard`
 * uses it: 009 grants no UPDATE on `blocks`, so the default
 * `on conflict do update` resolution fails 42501. Blocking someone twice is a
 * no-op by the composite primary key, so ignoring the conflict is correct
 * rather than a workaround — and it means a double-tap reports success instead
 * of a spurious error.
 */
export async function blockRider(blockedId: string): Promise<ActionState> {
  const parsed = riderIdSchema.safeParse(blockedId)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  // Caught here rather than left to the CHECK constraint only because the
  // constraint's message is a Postgres error string, and this one is reachable
  // by a UI bug rather than by malice.
  if (parsed.data === user.id) return { error: 'You cannot block yourself.' }

  const { error } = await supabase
    .from('blocks')
    .upsert(
      { blocker_id: user.id, blocked_id: parsed.data },
      { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true }
    )

  if (error) return { error: 'Could not block that rider. Try again.' }

  invalidateEverything()
  return { error: null }
}

/**
 * No `.eq('blocker_id', ...)` — the DELETE policy already scopes this to the
 * caller's own block ("Riders can unblock only their own block"). Restating it
 * would be the re-filtering trap: a second copy of a rule RLS already owns,
 * free to drift from the policy silently.
 *
 * Unblocking restores visibility rather than restoring data, because blocking
 * never deleted anything — 009 chose invisibility over cascading deletes
 * precisely so this is reversible.
 */
export async function unblockRider(blockedId: string): Promise<ActionState> {
  const parsed = riderIdSchema.safeParse(blockedId)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { error } = await supabase.from('blocks').delete().eq('blocked_id', parsed.data)

  if (error) return { error: 'Could not unblock that rider. Try again.' }

  invalidateEverything()
  return { error: null }
}
