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
 * `cover_image_path` is deliberately ABSENT for a different reason: no list
 * renders a cover. **TWO screens do** — `/profile` through
 * `OWN_PROFILE_COLUMNS` and `/profile/detail` through
 * `VIEWED_PROFILE_COLUMNS` — and each reads it through its own projection.
 * Adding it here would ship the column to every member list, ride crew and
 * postcard byline instead, none of which draws one.
 *
 * (This said "only the profile screen renders a cover, and that screen reads
 * its own row with `select('*')`". Both halves are now false: `021` ended the
 * `select('*')` — see `OWN_PROFILE_COLUMNS` — and `view-rider-profile` added
 * the second screen. The rule the sentence was protecting is unchanged, which
 * is why it is restated rather than deleted.)
 *
 * Your own row is **no longer exempt** — see `OWN_PROFILE_COLUMNS` below.
 *
 * Deliberately free of imports so client components can use it too — anything
 * reaching into `lib/supabase/server` would drag `next/headers` into the bundle.
 */
export const PUBLIC_PROFILE_COLUMNS = 'id, username, avatar_path, bike_model'

/**
 * The columns of your **own** profile row that the client may read.
 *
 * This used to be `select('*')`, and the comment above used to say your own row
 * was exempt from the projection rule. `021` ends that: it revokes table-level
 * SELECT on `profiles` from `authenticated` and re-grants an explicit column
 * allowlist, because a column-level revoke against a table-level grant is a
 * documented no-op.
 *
 * **`062` is the second table to take this shape, and the pair is what makes it
 * a rule rather than a one-off.** It revokes table-level SELECT on `postcards`
 * and re-grants seven columns, leaving `ride_id` out — see `POSTCARD_SELECT` in
 * `lib/data/postcards.ts`. Both were reached for the same reason: a bare
 * `revoke select (col)` against a table-level grant changes nothing at all, so
 * closing one column costs the whole table's grant and a re-grant beside it.
 *
 * `select('*')` requires SELECT on *every* column, so after
 * `021` it returns `42501` and `unwrap` throws — the profile screen lands on the
 * error boundary. This constant is that allowlist, spelled from the client side.
 *
 * **It must stay in step with `021`'s `grant select (...)` list.** That is the
 * standing cost of the allowlist shape and it is permanent: a migration adding a
 * column to `profiles` must add it in both places, or the column silently does
 * not exist for the app. `columns.test.ts` pins the pair.
 *
 * `terms_accepted_at` and `onboarding_completed_at` are absent because they are
 * no longer grantable to the client at all. The two legitimate own-row readers
 * — the route guard and the wizard's resume step — go through
 * `my_onboarding_state()`, which supplies the row-awareness a grant cannot
 * express (design D6).
 *
 * `cover_image_path` IS here, unlike in `PUBLIC_PROFILE_COLUMNS`: the profile
 * screen is the one screen that draws a cover, and this is the query it draws it
 * from.
 */
export const OWN_PROFILE_COLUMNS =
  'id, username, bio, bike_model, created_at, location, avatar_path, cover_image_path'

/**
 * The columns of *another* rider's profile that `/profile/detail` — and only
 * that screen — may read.
 *
 * A **projection** decision, not a permission one: every column below is
 * already granted to `authenticated` by `025` (`columns.test.ts` pins this as
 * a subset check against that grant list), so nothing here changes what the
 * database allows. It states what one screen actually draws, the same reason
 * `PUBLIC_PROFILE_COLUMNS` stays at four columns for every OTHER reach into a
 * rider's identity — a club roster, a ride crew, a postcard byline, a filter
 * tile. None of those draws a bio or a cover; widening the shared constant
 * would ship both to every list that renders a name (`openspec/changes/
 * view-rider-profile/design.md` §D5).
 *
 * `bike_model` is deliberately absent even though `025` grants it: the header
 * this screen draws has no Motorcycles section — the Garage epic is unbuilt —
 * so there is nothing here to read it for.
 *
 * `terms_accepted_at`, `onboarding_completed_at` and `terms_version` are
 * absent for the other reason `PUBLIC_PROFILE_COLUMNS`'s header gives: they
 * carry no grant to `authenticated` at all, so naming one turns the whole
 * read into a bare `42501`.
 */
export const VIEWED_PROFILE_COLUMNS =
  'id, username, avatar_path, cover_image_path, bio, location, created_at'

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
