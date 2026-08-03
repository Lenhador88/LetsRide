'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export type PostcardActionState = { error: string | null }

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
