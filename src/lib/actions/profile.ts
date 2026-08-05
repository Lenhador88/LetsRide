'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { profileEditSchema } from '@/lib/validation/profile'
import type { ActionState } from '@/lib/actions/state'

/**
 * Saves the editable part of a rider's own profile.
 *
 * Replaces the v1 `EditProfileForm`, which called `supabase.from('profiles')`
 * from a client component and then `router.refresh()`. That pattern is v1 twice
 * over: it puts a write in the browser where CLAUDE.md puts writes in actions,
 * and it validated nothing — a 10 MB bio was a valid submission.
 *
 * `.eq('id', user.id)` is **not** a re-filter of RLS. The profiles UPDATE policy
 * (`001`) already restricts the write to `auth.uid() = id`, so this cannot widen
 * anything; it is here because an `update()` with no filter is a full-table
 * statement that the policy then narrows, and writing it that way relies on the
 * policy for correctness rather than for authorization. The distinction matters
 * the day someone reads this line in isolation.
 *
 * `.select('id')` for the same reason `setUsername` uses it: PostgREST reports
 * no error when an update matches zero rows, so without it a missing profile
 * row reads as a successful save.
 */
export async function updateProfile(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = profileEditSchema.safeParse({
    location: formData.get('location'),
    bio: formData.get('bio'),
    bike_model: formData.get('bike_model'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to edit your profile.' }

  const { data: updated, error } = await supabase
    .from('profiles')
    .update(parsed.data)
    .eq('id', user.id)
    .select('id')
    .maybeSingle()

  if (error) return { error: 'Could not save your profile. Try again.' }
  if (!updated) return { error: 'Your profile could not be found. Sign in again.' }

  revalidatePath('/profile')
  return { error: null, sent: true }
}
