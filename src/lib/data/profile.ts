import { resolveSupabase } from '@/lib/supabase/resolve'
import { unwrap, unwrapList } from '@/lib/data/unwrap'
import { resolveAvatarUrls, signImagePaths } from '@/lib/data/media'
import { OWN_PROFILE_COLUMNS } from '@/lib/data/columns'
import type { Profile } from '@/types'

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const profile = unwrap(
    await supabase.from('profiles').select(OWN_PROFILE_COLUMNS).eq('id', user.id).maybeSingle(),
    'your profile',
  ) as Profile | null

  // Your own avatar goes through the same signing as everyone else's. It is
  // tempting to skip it — you can always read your own row — but readability of
  // the ROW is not readability of the Storage OBJECT, and 014's policy is what
  // decides the second. Skipping it here would make your own avatar the one that
  // silently fails to render.
  if (profile) {
    // The cover is signed here rather than by the screen, and that is a
    // freshness decision rather than tidiness. `/profile` is a client component
    // now, so it cannot sign in its body; a `useQuery` for the signed URL would
    // need a key, and every key `keys.ts` could offer that does not contain the
    // path re-signs the OLD path when `updateCover` invalidates — the profile
    // row and the cover URL refetch concurrently, so the URL is built from a
    // `cover_image_path` that is about to be replaced, pointing at the object
    // `setProfileImage` just deleted. Signed here, the path and its URL arrive
    // in the same result and cannot disagree.
    //
    // Two passes rather than one batch, matching `attachLikeState`: avatars and
    // covers are different Storage folders with different policies, so a
    // readable avatar does not imply a readable cover.
    await resolveAvatarUrls([profile], supabase)

    profile.cover_image_url = profile.cover_image_path
      ? // A path that cannot be signed lands as null and draws the empty state,
        // rather than taking the screen to its error boundary — the same trade
        // `signImagePaths` already makes per item for a feed.
        ((await signImagePaths([profile.cover_image_path], supabase)).get(
          profile.cover_image_path
        ) ?? null)
      : null
  }
  return profile
}

/**
 * Stored usernames are always lowercase — 003's CHECK constraint enforces the
 * charset — so an exact match against the normalised input is equivalent to the
 * case-insensitive uniqueness the unique index provides.
 *
 * This is advisory only. Two riders can pass the check on the same name in the
 * same instant; the unique index is what actually decides, and the action that
 * writes must handle the conflict.
 */
export async function isUsernameTaken(username: string): Promise<boolean> {
  const supabase = await resolveSupabase()
  const data = unwrap(
    await supabase.from('profiles').select('id').eq('username', username).maybeSingle(),
    'that username',
  )
  return data !== null
}

/**
 * The countries a rider has marked, oldest first.
 *
 * No block filtering here and there must not be: 014's SELECT policy inherits
 * the profiles predicate through an `exists`, so a blocked rider's countries are
 * already absent from what this reads. Re-filtering in application code would be
 * a second copy of a rule 009 owns — the same mistake `getRideCrew`'s header
 * warns about, and the one the `is_public` subtraction bug came from.
 *
 * Unbounded on purpose, unlike the crew roster: the primary key caps a rider at
 * one row per country, so the ceiling is `COUNTRY_TOTAL` — around 250 two-letter
 * strings — and is a property of the schema rather than a hope about behaviour.
 */
export async function getProfileCountries(userId: string): Promise<string[]> {
  const supabase = await resolveSupabase()

  const rows = unwrapList(
    await supabase
      .from('profile_countries')
      .select('country_code')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
    'your countries',
  )

  return rows.map((row) => row.country_code as string)
}
