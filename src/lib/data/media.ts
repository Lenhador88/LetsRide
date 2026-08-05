import { createClient } from '@/lib/supabase/server'
import { MEDIA_BUCKET } from '@/lib/media/constants'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

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
  supabase?: SupabaseServerClient
): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return urls

  const client = supabase ?? (await createClient())
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
 * Resolves `avatar_path` into `avatar_url` on a set of profiles, in one signing
 * request.
 *
 * **Why it writes into `avatar_url` rather than adding a field.** Nine
 * components render an avatar and every one of them already reads
 * `avatar_url`. Introducing a second field would mean touching all nine and
 * leaving each call site to remember which of the two wins. Instead the data
 * layer keeps one promise — *`avatar_url` is a URL you can put in `src`* — and
 * owns how it got there. `avatar_path` still ships to the client because it is
 * in PUBLIC_PROFILE_COLUMNS, but nothing has to look at it.
 *
 * The legacy column is the fallback, not the override: a signed path wins, and
 * a profile with no `avatar_path` keeps whatever `avatar_url` held. 014's header
 * explains why that column still exists — nothing has ever written it, but this
 * container could not prove it is NULL everywhere, so it is preserved until
 * someone can.
 *
 * **Mutates, deliberately.** Profiles arrive nested — `author` on a postcard,
 * `organizer` on a ride, `riders[].profile` on a crew — and rebuilding those
 * shapes immutably would mean a bespoke mapper per call site, which is exactly
 * the per-surface duplication this helper exists to avoid. The rows are freshly
 * built by the query one statement earlier and shared with nothing, so the
 * mutation is invisible.
 *
 * Signing is not authorization. 014's Storage SELECT policy decides whether an
 * avatar object is readable at all, and it inherits the profiles predicate — so
 * a blocked rider's avatar comes back unsigned and lands as null rather than
 * being served. Never read "got a URL" as "the viewer is allowed"; the profiles
 * policy already decided that upstream by returning the row.
 */
export async function resolveAvatarUrls(
  profiles: (({ avatar_path?: string | null; avatar_url?: string | null }) | null | undefined)[],
  supabase?: SupabaseServerClient
): Promise<void> {
  const present = profiles.filter(
    (profile): profile is { avatar_path?: string | null; avatar_url?: string | null } => !!profile
  )
  const paths = present.map((profile) => profile.avatar_path).filter((path): path is string => !!path)
  if (paths.length === 0) return

  const urls = await signImagePaths(paths, supabase)
  for (const profile of present) {
    if (profile.avatar_path) {
      profile.avatar_url = urls.get(profile.avatar_path) ?? profile.avatar_url ?? null
    }
  }
}
