/**
 * The columns of *another* rider's profile that may be sent to the browser.
 *
 * RLS is row-level, not column-level: a policy that lets you see a rider's row
 * lets you see every column in it. `select('*')` on a joined profile therefore
 * ships that rider's `terms_accepted_at` and `onboarding_completed_at` — their
 * consent and account lifecycle — to anyone who can see them in a member list.
 * These five are what the UI actually renders. `avatar_path` is here because
 * `resolveAvatarUrls` in lib/data/media.ts signs it into `avatar_url` — it is a
 * Storage object path, not a secret, and 014's Storage SELECT policy is what
 * decides whether the object behind it is readable.
 *
 * `cover_image_path` is deliberately ABSENT: only the profile screen renders a
 * cover, and that screen reads its own row with `select('*')`. Adding it here
 * would ship a column to every member list and postcard byline that none of
 * them draws.
 *
 * Your own row is exempt: `select('*')` with `eq('id', user.id)` is fine.
 *
 * Deliberately free of imports so client components can use it too — anything
 * reaching into `lib/supabase/server` would drag `next/headers` into the bundle.
 */
export const PUBLIC_PROFILE_COLUMNS = 'id, username, avatar_url, avatar_path, bike_model'
