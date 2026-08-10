import { resolveSupabase, type DataClient } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { createPostcardSchema } from '@/lib/validation/postcards'
import { MEDIA_BUCKET } from '@/lib/media/constants'
import type { ActionState } from '@/lib/actions/state'

/**
 * State lives in `lib/actions/state.ts`, not here, and that is load bearing
 * rather than tidiness: while this was a `'use server'` module it could only
 * export async functions, so the `emptyPostcardActionState` const this file
 * used to export threw `A "use server" file can only export async functions,
 * found object` the moment a client component imported it — taking the whole
 * /postcards/new route down at module evaluation. It was latent from the day it
 * shipped because nothing imported it yet.
 *
 * The directive is gone now (see `state.ts`), so the rule no longer binds — but
 * the split stays, because re-merging it is free to redo and the constant is
 * genuinely shared.
 *
 * Nothing in the build catches that class of mistake. Type check, lint,
 * `next build` and the unit suite were all green while the route was dead in
 * production, which is why `src/__tests__/use-server-exports.test.ts` asserts
 * the rule directly for any module that still carries the directive.
 */
export type { ActionState as PostcardActionState } from '@/lib/actions/state'

/**
 * The client-cache replacement for this file's `revalidatePath('/postcards')`
 * plus `` revalidatePath(`/postcards/${id}`) `` pair.
 *
 * `postcards.all()` rather than the feed and the detail key separately, and the
 * reason is `keys.ts`'s own: a prefix invalidation reaches every filter set as
 * well, and a like moves a count the filter bar draws. Naming the two keys
 * precisely would under-invalidate by exactly the amount that is hard to see —
 * the tile counts, on a screen the rider is looking at.
 *
 * The club lookup survives the move unchanged. A postcard posted into a club
 * appears on that club's Timeline, and this action is only ever handed the
 * postcard's id.
 */
async function invalidatePostcard(supabase: DataClient, postcardId: string) {
  invalidate(queryKeys.postcards.all())

  const { data: postcard } = await supabase
    .from('postcards')
    .select('club_id')
    .eq('id', postcardId)
    .maybeSingle()
  if (postcard?.club_id) invalidate(queryKeys.clubs.detail(postcard.club_id))
}

/**
 * `on conflict do nothing` via `ignoreDuplicates`, not a plain upsert — 009 §5
 * grants no UPDATE on postcard_likes, so the default `on conflict do update`
 * resolution fails 42501. A duplicate like is a no-op by the composite PK, so
 * ignoring the conflict is correct, not just a workaround.
 */
export async function likePostcard(postcardId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to like this.' }

  const { error } = await supabase
    .from('postcard_likes')
    .upsert(
      { postcard_id: postcardId, user_id: user.id },
      { onConflict: 'postcard_id,user_id', ignoreDuplicates: true }
    )

  if (error) return { error: 'Could not like that postcard. Try again.' }

  await invalidatePostcard(supabase, postcardId)
  return { error: null }
}

/**
 * No `.eq('user_id', ...)` — the delete policy already scopes this to the
 * caller's own like ("Riders can remove only their own like"). Restating it
 * here would be the re-filtering trap: a second copy of a rule RLS already
 * owns, free to drift from the policy silently.
 */
export async function unlikePostcard(postcardId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { error } = await supabase.from('postcard_likes').delete().eq('postcard_id', postcardId)

  if (error) return { error: 'Could not unlike that postcard. Try again.' }

  await invalidatePostcard(supabase, postcardId)
  return { error: null }
}

/**
 * Validates and inserts the row. It does NOT upload anything — by the time
 * this runs, the image is already sitting in Storage at `imagePath`, put
 * there client-side by src/lib/media/upload.ts (compressed and EXIF-stripped
 * before it ever left the device). That split exists so upload progress can
 * be shown against a real XHR (see uploadObject's own comment) and so a
 * rider does not lose the photo they already compressed if this insert is
 * what fails.
 *
 * Signature matches the FormData + useActionState shape every other
 * multi-field write in this app uses (see setUsername/setLocation) — the
 * form a future create-postcard screen renders would carry `imagePath` in a
 * hidden input, set once uploadPostcardImage resolves, alongside a caption
 * textarea and a club selector.
 *
 * Navigates to the feed on success, the same shape as onboarding's actions.
 * That is also what keeps success distinguishable from the initial state: both
 * are `{ error: null }`, so a caller watching the returned state alone could
 * not tell "not submitted yet" from "posted". `redirect()` used to express that
 * by throwing; `redirectTo` expresses it as a value the form's
 * `useActionRedirect` acts on (task 5.8).
 */
export async function createPostcard(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to post.' }

  const parsed = createPostcardSchema.safeParse({
    imagePath: formData.get('imagePath'),
    caption: formData.get('caption'),
    clubId: formData.get('clubId'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { imagePath, caption, clubId } = parsed.data

  // `.select('id').single()` with the row discarded: the id was only ever used
  // to build `` revalidatePath(`/postcards/${id}`) ``, which a cache key does
  // not need. `single()` stays because it is what turns a zero-row insert into
  // an error rather than a silent success.
  const { error } = await supabase
    .from('postcards')
    .insert({ author_id: user.id, image_path: imagePath, caption, club_id: clubId })
    .select('id')
    .single()

  if (error) {
    // The row never landed — RLS refused it (posting into a club the rider
    // isn't a member of) or a constraint did — so the object this action was
    // handed is now unreferenced. Migration 010's SELECT policy requires a
    // referencing postcards row, so nothing will ever make it visible, and
    // nothing will ever clean it up on its own: Storage and Postgres are
    // separate systems with no cross-system cascade. Best-effort delete
    // under the uploader's own session — 010's DELETE policy scopes this to
    // their own postcards/<uid>/ folder, so it can only ever remove what this
    // request just uploaded. Swallowed on purpose: a failed cleanup here
    // should cost storage, not the rider's ability to see the real error and
    // retry with the photo they still have.
    await supabase.storage.from(MEDIA_BUCKET).remove([imagePath])
    return { error: 'Could not post that. Try again.' }
  }

  // clubId is already in hand from the parsed form, so this skips the lookup
  // invalidatePostcard would otherwise do to find it.
  invalidate(queryKeys.postcards.all())
  if (clubId) invalidate(queryKeys.clubs.detail(clubId))

  return { error: null, redirectTo: '/postcards' }
}

/**
 * Deletes a postcard and the Storage object behind it.
 *
 * **Row first, object second, and the order is not arbitrary.** Postgres and
 * Storage are separate systems with no cross-system cascade, so one of the two
 * failure modes has to be chosen deliberately:
 *
 * - Object first: a failed row delete leaves a postcard whose image 404s, which
 *   is visible to every viewer and unrecoverable.
 * - Row first: a failed object delete leaves an unreferenced object, which is
 *   invisible to everyone (010's Storage SELECT policy requires a referencing
 *   postcards row) and costs only storage.
 *
 * The second is strictly less bad, so it is the one taken.
 *
 * There is no `.eq('author_id', ...)`: 009's DELETE policy is already
 * `author_id = auth.uid()`, and restating it here would be a second copy of a
 * rule RLS owns. `.select()` is what makes a refusal detectable — PostgREST
 * reports no error when a delete matches nothing, so without it a rider
 * deleting someone else's postcard would be told it worked.
 */
export async function deletePostcard(postcardId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  // Read the path before the row goes: afterwards there is nothing left to
  // tell us which object to remove.
  const { data: existing } = await supabase
    .from('postcards')
    .select('image_path, club_id')
    .eq('id', postcardId)
    .maybeSingle()

  const { data: deleted, error } = await supabase
    .from('postcards')
    .delete()
    .eq('id', postcardId)
    .select('id')
    .maybeSingle()

  if (error) return { error: 'Could not delete that postcard. Try again.' }
  if (!deleted) return { error: 'That postcard is not yours to delete.' }

  if (existing?.image_path) {
    // Best effort, swallowed on purpose — see the ordering note above. A failed
    // cleanup costs storage, and the rider's postcard is already gone.
    await supabase.storage.from(MEDIA_BUCKET).remove([existing.image_path])
  }

  invalidate(queryKeys.postcards.all())
  if (existing?.club_id) invalidate(queryKeys.clubs.detail(existing.club_id))
  // PD-177. Both `notifications.postcard_id` and `notifications.comment_id`
  // cascade (`036` §1), and every notification carrying either is addressed to
  // this postcard's author — so deleting it empties this rider's own list of
  // every like and every comment it ever earned them, count included.
  invalidate(queryKeys.notifications.all())
  return { error: null }
}
