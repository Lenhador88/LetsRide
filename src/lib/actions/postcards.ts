'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createPostcardSchema } from '@/lib/validation/postcards'
import { MEDIA_BUCKET } from '@/lib/media/constants'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export type PostcardActionState = { error: string | null }

export const emptyPostcardActionState: PostcardActionState = { error: null }

// The postcard's own detail route doesn't exist yet — no UI has landed for
// Postcards — but `/postcards/[id]` follows the `/rides/[id]` / `/clubs/[id]`
// naming already in the repo, and revalidating a path with no matching route
// is a harmless no-op. The home feed's URL isn't invented here for the same
// reason: Postcards-as-home is signed off (docs/HANDOFF.md) but not built, and
// guessing it would be the exact "lower-fidelity artifact" the CLAUDE.md
// working principles warn against. The `feature` agent should add that path
// (and the club Posts-tab route once it exists) when those routes land.
async function revalidatePostcardRoutes(supabase: SupabaseServerClient, postcardId: string) {
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
export async function likePostcard(postcardId: string): Promise<PostcardActionState> {
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
export async function unlikePostcard(postcardId: string): Promise<PostcardActionState> {
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
 * No redirect on success, unlike onboarding's actions: there is no feed
 * route to send a rider back to yet (Postcards-as-home is signed off but not
 * built — see docs/HANDOFF.md and the comment on revalidatePostcardRoutes
 * above). Inventing one here would be exactly the guessed artifact
 * CLAUDE.md's working principles warn against; the screen that calls this
 * decides where to go once that route exists.
 */
export async function createPostcard(
  _prev: PostcardActionState,
  formData: FormData
): Promise<PostcardActionState> {
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

  await revalidatePostcardRoutes(supabase, postcard.id)
  return { error: null }
}
