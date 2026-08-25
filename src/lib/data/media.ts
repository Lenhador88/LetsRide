import { resolveSupabase, type DataClient } from '@/lib/supabase/resolve'
import { MEDIA_BUCKET } from '@/lib/media/constants'

/**
 * How long a postcard image URL stays valid. One hour is comfortably longer
 * than a rider scrolls a feed in one sitting, and short enough that a URL
 * copied out of the DOM stops working quickly — the signature is the only
 * thing protecting a private club's photo once it leaves RLS's reach.
 *
 * It also bounds the staleness a cached render can cause: a page held open
 * past this shows broken images until it revalidates. If that ever bites, the
 * fix is to sign on the client per-card, not to lengthen this.
 */
export const SIGNED_URL_TTL_SECONDS = 60 * 60

/**
 * Signs many Storage paths in one request and returns path → URL.
 *
 * Batched deliberately: a 30-card feed signing one at a time is 30 round trips
 * on the critical path of the home screen. `createSignedUrls` takes the whole
 * list, and its per-item errors are reported per item rather than failing the
 * page — one unsigned image should cost that card its photo, not the feed.
 *
 * Signing is *not* an authorization check. It runs under the caller's session,
 * but 010's SELECT policy on storage.objects is what decides whether a path is
 * readable at all; a path the viewer may not see comes back with an error here
 * and lands as null. Never treat "got a URL" as "the viewer is allowed" — the
 * postcards SELECT policy already decided that upstream by returning the row.
 */
export async function signImagePaths(
  paths: string[],
  supabase?: DataClient
): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return urls

  const client = supabase ?? (await resolveSupabase())
  const { data, error } = await client.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS)

  if (error || !data) return urls

  for (const item of data) {
    // `path` is typed nullable and each entry carries its own error, so a
    // partial success is normal rather than exceptional.
    if (item.path && item.signedUrl && !item.error) urls.set(item.path, item.signedUrl)
  }

  return urls
}

/**
 * Resolves `avatar_path` into `avatar_url` on a set of rows, in one signing
 * request.
 *
 * **Riders or clubs.** The parameter is structural rather than `PublicProfile`
 * because `clubs` carries the identical pair, and after `024` the club chip on a
 * ride and the club tile on a filter bar need exactly this pass — see
 * `CLUB_EMBED_COLUMNS`. One helper, because two would drift.
 *
 * **Why it writes into `avatar_url` rather than adding a field.** Nine
 * components render an avatar and every one of them already reads
 * `avatar_url`. Introducing a second field would mean touching all nine and
 * leaving each call site to remember which of the two wins. Instead the data
 * layer keeps one promise — *`avatar_url` is a URL you can put in `src`* — and
 * owns how it got there. `avatar_path` still ships to the client because it is
 * in PUBLIC_PROFILE_COLUMNS, but nothing has to look at it.
 *
 * **There is no longer a legacy fallback, because there is no longer a legacy
 * column.** This used to end `?? profile.avatar_url ?? null`, preserving
 * whatever the `avatar_url` *column* held for a row with no `avatar_path` —
 * `014` kept it rather than dropping it unverified. `024` verified it (0
 * non-NULL rows on `profiles` and on `clubs`) and dropped it. The field is now
 * write-only from here, so a row with no path resolves to null, full stop.
 *
 * **Mutates, deliberately.** Rows arrive nested — `author` on a postcard,
 * `organizer` on a ride, `riders[].profile` on a crew, `club` on both — and
 * rebuilding those shapes immutably would mean a bespoke mapper per call site,
 * which is exactly the per-surface duplication this helper exists to avoid. The
 * rows are freshly built by the query one statement earlier and shared with
 * nothing, so the mutation is invisible.
 *
 * Signing is not authorization. 014's Storage SELECT policy decides whether an
 * avatar object is readable at all, and it inherits the profiles predicate — so
 * a blocked rider's avatar comes back unsigned and lands as null rather than
 * being served. Never read "got a URL" as "the viewer is allowed"; the profiles
 * policy already decided that upstream by returning the row.
 */
export async function resolveAvatarUrls(
  rows: (({ avatar_path?: string | null; avatar_url?: string | null }) | null | undefined)[],
  supabase?: DataClient
): Promise<void> {
  const present = rows.filter(
    (row): row is { avatar_path?: string | null; avatar_url?: string | null } => !!row
  )
  const paths = present.map((row) => row.avatar_path).filter((path): path is string => !!path)
  if (paths.length === 0) return

  const urls = await signImagePaths(paths, supabase)
  for (const row of present) {
    if (row.avatar_path) row.avatar_url = urls.get(row.avatar_path) ?? null
  }
}

type ClubImageRow = {
  avatar_path?: string | null
  avatar_url?: string | null
  cover_image_path?: string | null
  cover_image_url?: string | null
}

/**
 * Resolves a club's `avatar_path` **and** `cover_image_path` into signed URLs
 * in one request — the pair a filter tile needs for the banner-behind-avatar
 * treatment (PD-284, `ui/FilterTile.tsx`'s `FilterClubImage`).
 *
 * Not `resolveAvatarUrls`: that helper only ever reads `avatar_path`, by
 * design (its own header — one field, one promise). Mirrors
 * `lib/data/clubs.ts`'s private `signClubImages`, which signs the identical
 * pair for `ClubListItem`; this is the same idea exported for the two filter
 * queries (`getPostcardFilters`, `getRideFilters`), which embed a club through
 * `CLUB_FILTER_EMBED_COLUMNS` rather than reading a `ClubListItem`.
 *
 * A path that will not sign lands as null and the tile falls back accordingly
 * — signing is not the check, `016`'s Storage SELECT policy is.
 */
export async function resolveClubImageUrls(
  rows: (ClubImageRow | null | undefined)[],
  supabase?: DataClient
): Promise<void> {
  const present = rows.filter((row): row is ClubImageRow => !!row)
  const paths = present
    .flatMap((row) => [row.avatar_path, row.cover_image_path])
    .filter((path): path is string => !!path)
  if (paths.length === 0) return

  const urls = await signImagePaths(paths, supabase)
  for (const row of present) {
    if (row.avatar_path) row.avatar_url = urls.get(row.avatar_path) ?? null
    if (row.cover_image_path) row.cover_image_url = urls.get(row.cover_image_path) ?? null
  }
}

type RideMapRow = {
  map_card_path?: string | null
  map_card_url?: string | null
  map_detail_path?: string | null
  map_detail_url?: string | null
}

/**
 * Resolves a ride's `map_card_path` and `map_detail_path` into signed URLs, in
 * one signing request across every row.
 *
 * Deliberately the same shape as `resolveAvatarUrls` — mutate in place, write
 * into a `_url` sibling, one batched request — rather than a second idea about
 * how a Storage path becomes something a component can render. Read that
 * function's header for the reasoning; all of it applies here.
 *
 * **Per viewer, and never cached across riders.** `createSignedUrls` runs under
 * the caller's own session, so a URL minted here is only ever as good as the
 * signature it carries and only ever for the rider it was minted for. Nothing
 * persists one: it lives on the row this call returns, in the in-memory query
 * cache that `signOut` clears, and it expires at `SIGNED_URL_TTL_SECONDS`. Do
 * not move it into a shared cache, a build-time constant or a `public` URL —
 * `051`'s Storage policies are what decide who may read a tile, and a URL
 * handed to the wrong rider is outside their reach.
 *
 * **Both paths in one request rather than one call per column.** The detail
 * screen reads one ride and the list reads thirty; splitting the two columns
 * would double a round trip for nothing, and `signImagePaths` already
 * de-duplicates.
 *
 * **Costs nothing while every tile is NULL**, which is every ride today: with
 * no paths to sign this returns before it builds a client, so neither screen
 * pays a request for a column that has no writer yet.
 *
 * Signing is not authorization. `051`'s `storage.objects` SELECT policy joins
 * the object back to its ride under the caller's RLS and is what decides
 * readability; a tile this viewer may not see comes back unsigned and lands as
 * null. Never read "got a URL" as "the viewer is allowed" — the rides SELECT
 * policy already decided that upstream by returning the row.
 */
export async function resolveRideMapUrls(
  rows: (RideMapRow | null | undefined)[],
  supabase?: DataClient
): Promise<void> {
  const present = rows.filter((row): row is RideMapRow => !!row)
  const paths = present
    .flatMap((row) => [row.map_card_path, row.map_detail_path])
    .filter((path): path is string => !!path)
  if (paths.length === 0) return

  const urls = await signImagePaths(paths, supabase)
  for (const row of present) {
    if (row.map_card_path) row.map_card_url = urls.get(row.map_card_path) ?? null
    if (row.map_detail_path) row.map_detail_url = urls.get(row.map_detail_path) ?? null
  }
}
