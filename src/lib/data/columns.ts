/**
 * The columns of *another* rider's profile that may be sent to the browser.
 *
 * RLS is row-level, not column-level: a policy that lets you see a rider's row
 * lets you see every column in it. `select('*')` on a joined profile therefore
 * ships that rider's `terms_accepted_at` and `onboarding_completed_at` — their
 * consent and account lifecycle — to anyone who can see them in a member list.
 * These four are what the UI actually renders. `avatar_path` is here because
 * `resolveAvatarUrls` in lib/data/media.ts signs it into `avatar_url` — it is a
 * Storage object path, not a secret, and 014's Storage SELECT policy is what
 * decides whether the object behind it is readable.
 *
 * **`avatar_url` is deliberately absent, and is no longer a column at all.**
 * `024` dropped it from `profiles` and `clubs`. Nothing had ever written it —
 * `014` kept it as a fallback rather than dropping it unverified, and the
 * verification came back 0 non-NULL rows on both tables. It survives as a *field
 * on the objects this layer returns*, holding the signed URL `resolveAvatarUrls`
 * writes, which is the one meaning it now has.
 *
 * `cover_image_path` is deliberately ABSENT for a different reason: only the
 * profile screen renders a cover, and that screen reads its own row with
 * `select('*')`. Adding it here would ship a column to every member list and
 * postcard byline that none of them draws.
 *
 * Your own row is exempt: `select('*')` with `eq('id', user.id)` is fine.
 *
 * Deliberately free of imports so client components can use it too — anything
 * reaching into `lib/supabase/server` would drag `next/headers` into the bundle.
 */
export const PUBLIC_PROFILE_COLUMNS = 'id, username, avatar_path, bike_model'

/**
 * The club columns an embed needs to draw a club's **image**.
 *
 * Same rule as `PUBLIC_PROFILE_COLUMNS`, and it exists because `024` turned a
 * silent wrong answer into a loud one. Five query sites embedded `clubs(id,
 * name, avatar_url)`, and `clubs.avatar_url` was NULL on every row and always
 * had been, so any of them that drew an image drew initials instead — while
 * `/clubs/new` had been uploading to `avatar_path` since `016`, which the Clubs
 * screens sign and no other screen did.
 *
 * **Three of those five draw an image; two draw text.** Use this constant only
 * for the three — the ride-detail chip, the ride filter tiles and the postcard
 * filter tiles. `RideCard` and `PostcardCard` render the club as a text chip, so
 * `getRides` and the postcard deck embed `id, name` and neither selects nor
 * signs an image nothing renders. Getting that wrong costs a signing round trip
 * per page and ships a signed URL in the payload for no reader.
 *
 * It was latent rather than live: as of 2026-08-05 no club and no rider has any
 * `avatar_path` either, so nothing has yet rendered differently. The defect is
 * that the code read a column that could never hold a value.
 *
 * Selecting the path is only half of it: the caller must then sign it, which is
 * why every use of this constant is followed by a `resolveAvatarUrls` pass over
 * the embedded clubs.
 */
export const CLUB_EMBED_COLUMNS = 'id, name, avatar_path'
