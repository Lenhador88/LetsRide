'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createPostcardSchema } from '@/lib/validation/postcards'
import { MEDIA_BUCKET } from '@/lib/media/constants'
import type { ActionState } from '@/lib/actions/state'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * State lives in `lib/actions/state.ts`, not here, and that is load bearing
 * rather than tidiness: a `'use server'` module may only export async functions,
 * so the `emptyPostcardActionState` const this file used to export threw
 * `A "use server" file can only export async functions, found object` the moment
 * a client component imported it — taking the whole /postcards/new route down at
 * module evaluation. It was latent from the day it shipped because nothing
 * imported it yet.
 *
 * Nothing in the build catches this. Type check, lint, `next build` and the unit
 * suite were all green while the route was dead in production, which is why
 * `src/__tests__/use-server-exports.test.ts` now asserts the rule directly.
 *
 * Re-exported as a type here so callers can keep importing it from the module
 * whose actions they are using — a type re-export is erased at compile time and
 * is legal in a `'use server'` file, unlike a value.
 */
export type { ActionState as PostcardActionState } from '@/lib/actions/state'

// `/postcards` is the home feed, which now exists — a like has to move the
// count there, which is the whole reason this path was left to be filled in.
// `/postcards/[id]` has no route yet; revalidating a path with no matching
// route is a harmless no-op, and the name follows the `/rides/[id]` /
// `/clubs/[id]` convention already in the repo. The club Posts tab gets added
// here when that route lands.
async function revalidatePostcardRoutes(supabase: SupabaseServerClient, postcardId: string) {
  revalidatePath('/postcards')
  revalidatePath(`/postcards/${postcardId}`)

  const { data: postcard } = await supabase
    .from('postcards')
    .select('club_id')
    .eq('id', postcardId)
    .maybeSingle()
  if (postcard?.club_id) revalidatePath(`/clubs/${postcard.club_id}`)
}

/**
 * `on conflict do nothing` via `ignoreDuplicates`, not a plain upsert — 009 §5
 * grants no UPDATE on postcard_likes, so the default `on conflict do update`
 * resolution fails 42501. A duplicate like is a no-op by the composite PK, so
 * ignoring the conflict is correct, not just a workaround.
 */
export async function likePostcard(postcardId: string): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to like this.' }

  const { error } = await supabase
    .from('postcard_likes')
    .upsert(
      { postcard_id: postcardId, user_id: user.id },
      { onConflict: 'postcard_id,user_id', ignoreDuplicates: true }
    )

  if (error) return { error: 'Could not like that postcard. Try again.' }

  await revalidatePostcardRoutes(supabase, postcardId)
  return { error: null }
}

/**
 * No `.eq('user_id', ...)` — the delete policy already scopes this to the
 * caller's own like ("Riders can remove only their own like"). Restating it
 * here would be the re-filtering trap: a second copy of a rule RLS already
 * owns, free to drift from the policy silently.
 */
export async function unlikePostcard(postcardId: string): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { error } = await supabase.from('postcard_likes').delete().eq('postcard_id', postcardId)

  if (error) return { error: 'Could not unlike that postcard. Try again.' }

  await revalidatePostcardRoutes(supabase, postcardId)
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
 * Redirects to the feed on success, the same shape as onboarding's actions —
 * `/postcards` now exists, which is the condition this was waiting on. That
 * also makes success distinguishable from the initial state: both are
 * `{ error: null }`, so a caller watching the returned state alone could not
 * tell "not submitted yet" from "posted", and would need a sentinel field to
 * fake what a redirect expresses directly.
 */
export async function createPostcard(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to post.' }

  const parsed = createPostcardSchema.safeParse({
    imagePath: formData.get('imagePath'),
    caption: formData.get('caption'),
    clubId: formData.get('clubId'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { imagePath, caption, clubId } = parsed.data

  const { data: postcard, error } = await supabase
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
  // revalidatePostcardRoutes would otherwise do to find it.
  revalidatePath('/postcards')
  revalidatePath(`/postcards/${postcard.id}`)
  if (clubId) revalidatePath(`/clubs/${clubId}`)

  // Outside the try/catch shape above on purpose: redirect() signals by
  // throwing, so it must not sit anywhere an error branch could swallow it.
  redirect('/postcards')
}
