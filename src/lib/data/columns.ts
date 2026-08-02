/**
 * The columns of *another* rider's profile that may be sent to the browser.
 *
 * RLS is row-level, not column-level: a policy that lets you see a rider's row
 * lets you see every column in it. `select('*')` on a joined profile therefore
 * ships that rider's `terms_accepted_at` and `onboarding_completed_at` — their
 * consent and account lifecycle — to anyone who can see them in a member list.
 * These four are what the UI actually renders.
 *
 * Your own row is exempt: `select('*')` with `eq('id', user.id)` is fine.
 *
 * Deliberately free of imports so client components can use it too — anything
 * reaching into `lib/supabase/server` would drag `next/headers` into the bundle.
 */
export const PUBLIC_PROFILE_COLUMNS = 'id, username, avatar_url, bike_model'
