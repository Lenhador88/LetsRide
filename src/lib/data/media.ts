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
