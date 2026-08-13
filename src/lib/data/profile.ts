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
 * The free-text onboarding `location` alone — for `resolveRiderLocation`'s
 * profile fallback (`src/lib/location/`), which needs nothing else
 * `getCurrentProfile` reads: no avatar signing pass, no cover URL, for a
 * caller that only wants a city name to geocode.
 */
export async function getMyLocationText(): Promise<string | null> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const row = unwrap(
    await supabase.from('profiles').select('location').eq('id', user.id).maybeSingle(),
    'your onboarding location',
  ) as { location: string | null } | null

  return row?.location ?? null
}

/**
 * Case-insensitive, because since `056` a stored username keeps the case the
 * rider typed while `profiles_username_lower_key` still folds. This used to be
 * `.eq('username', …)`, which was correct only while every stored value was
 * lowercase — with `Pedro` in the table it reports `pedro` free and the rider is
 * refused `23505` on submit, PD-146's shape by a new road.
 *
 * **`.ilike()` is not the repair**, which is why this is an RPC and not a
 * one-word edit: LIKE reads `_` as a single-character wildcard and the charset
 * allows underscores, so `my_name` would match a stored `myXname` and report a
 * free name taken. PostgREST exposes no ESCAPE clause, so nothing at this call
 * site can fix that. `056`'s `username_exists` does the fold in the database,
 * against the `lower(username)` index `003` built for exactly this query.
 *
 * It is `security invoker`, so this still reads through the block-aware
 * `profiles` SELECT policy exactly as the filter it replaced did — **including
 * the one direction in which it is permanently wrong**: to a rider blocked by a
 * name's holder it reports free, every time. `usernameVerdict` reconciles that
 * on screen; making this function see past the block would leak the blocked
 * rider's name, which is the thing the policy exists to stop.
 *
 * Advisory only, unchanged. Two riders can pass the check on the same name in
 * the same instant; the unique index is what actually decides, and the action
 * that writes must handle the conflict.
 */
export async function isUsernameTaken(username: string): Promise<boolean> {
  const supabase = await resolveSupabase()
  const exists = unwrap(
    await supabase.rpc('username_exists', { p_username: username }),
    'that username',
  )
  return exists === true
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
