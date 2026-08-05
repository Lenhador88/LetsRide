/**
 * Uploads straight from the browser to Supabase Storage — decision #8's
 * "no service-role backend": there is no server hop, and migration 010's
 * storage.objects policies are the only thing that decides whether an upload
 * succeeds. Browser-only, same as compress.ts.
 */

import { createClient } from '@/lib/supabase/client'
import {
  MEDIA_BUCKET,
  buildAvatarPath,
  buildClubAvatarPath,
  buildClubCoverPath,
  buildCoverPath,
  buildPostcardImagePath,
} from './constants'
import { compressImage } from './compress'
import { validateImageFile } from './validate'

export type UploadProgress = { loaded: number; total: number }

export type UploadObjectOptions = {
  onProgress?: (progress: UploadProgress) => void
  signal?: AbortSignal
}

/**
 * Uploads one already-prepared blob to an exact object path. Goes around
 * @supabase/storage-js's own `upload()` and hits the same REST endpoint by
 * hand (same URL shape and multipart body as StorageFileApi.uploadOrUpdate)
 * for one reason: storage-js wraps `fetch`, which exposes no upload-progress
 * events, and XMLHttpRequest does. This is the only place in the app that
 * talks to Storage below the supabase-js client, and it exists entirely to
 * make "show real progress during upload" possible for whichever page calls
 * it.
 *
 * `x-upsert` stays 'false' — migration 010 grants no UPDATE on
 * storage.objects, so an upsert-style overwrite would fail 42501 regardless.
 * A 409 (Duplicate) response is treated as success rather than an error: the
 * only way this exact path can already exist is a previous attempt that
 * actually completed server-side before its response reached the client, so
 * a caller retrying after a dropped connection — the "recoverable failure"
 * the brief asks for — can safely resend the SAME path and blob without risk
 * of data loss or a spurious failure.
 */
export async function uploadObject(
  path: string,
  blob: Blob,
  options: UploadObjectOptions = {}
): Promise<void> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in to upload.')

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${MEDIA_BUCKET}/${path}`
  const body = new FormData()
  body.append('cacheControl', '3600')
  body.append('', blob)

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url, true)
    xhr.setRequestHeader('apikey', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`)
    xhr.setRequestHeader('x-upsert', 'false')

    options.signal?.addEventListener('abort', () => xhr.abort())

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress?.({ loaded: event.loaded, total: event.total })
      }
    }
    xhr.onabort = () => reject(new DOMException('Upload cancelled.', 'AbortError'))
    xhr.onerror = () => reject(new Error('Network error during upload. Check your connection and try again.'))
    xhr.onload = () => {
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 409) {
        resolve()
      } else {
        reject(new Error(`Upload failed (${xhr.status}).`))
      }
    }
    xhr.send(body)
  })
}

/**
 * The postcard-specific wrapper: validate, compress (which strips EXIF as a
 * side effect — see compress.ts), pick a path under this rider's own folder,
 * and upload.
 *
 * Compression and upload are two separate awaits on purpose, and the
 * returned path is deterministic (built once, before the upload starts) so a
 * caller can hold onto it. A rider who loses signal mid-upload does not lose
 * the photo they just composed: the compressed `blob` this function produced
 * and the `path` it picked are both stable, so a retry re-sends the SAME
 * bytes to the SAME path (safe per uploadObject's 409 handling above)
 * instead of re-compressing or re-prompting for the file. Building that
 * retry affordance into a screen is future UI work; this function is what
 * makes it possible without redoing work the rider already did.
 */
export async function uploadPostcardImage(
  file: File,
  options: UploadObjectOptions = {}
): Promise<{ path: string }> {
  const validation = validateImageFile(file)
  if (!validation.ok) throw new Error(validation.error)

  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in to upload.')

  const { blob } = await compressImage(file)
  const path = buildPostcardImagePath(session.user.id)

  await uploadObject(path, blob, options)
  return { path }
}

/**
 * Avatar and cover uploads. Same three steps as `uploadPostcardImage` —
 * validate, compress (which strips EXIF as a side effect, see compress.ts),
 * upload to a path inside this rider's own folder — with one difference that is
 * the whole reason they are separate functions: **the compression targets.**
 *
 * A postcard is the subject of its screen and keeps the default max edge. An
 * avatar renders at 128px at its largest (the profile hero) and 24px at its
 * smallest, so 512 covers every use at 2x and anything larger is bytes a rider
 * on mobile data pays for and never sees. A cover is drawn 390x200, so 1080
 * covers it at better than 2x.
 *
 * Neither writes the path to `profiles` — that is `updateAvatar` /
 * `updateCover`, a Server Action, because the column is the app's record of
 * which object is current and a client must not own it. The two-step shape is
 * also what makes the failure mode survivable: an upload that succeeds and a
 * row update that fails leaves an orphaned object, never a profile pointing at
 * an object that is not there.
 */
async function uploadOwnImage(
  file: File,
  buildPath: (userId: string) => string,
  maxEdge: number,
  options: UploadObjectOptions
): Promise<{ path: string }> {
  const validation = validateImageFile(file)
  if (!validation.ok) throw new Error(validation.error)

  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in to upload.')

  const { blob } = await compressImage(file, { maxEdge })
  const path = buildPath(session.user.id)

  await uploadObject(path, blob, options)
  return { path }
}

export function uploadAvatarImage(file: File, options: UploadObjectOptions = {}) {
  return uploadOwnImage(file, buildAvatarPath, 512, options)
}

export function uploadCoverImage(file: File, options: UploadObjectOptions = {}) {
  return uploadOwnImage(file, buildCoverPath, 1080, options)
}

/**
 * The club surfaces (016). Same `uploadOwnImage` shape, because the path is
 * still keyed on the uploader — a club id cannot appear in it, since the object
 * has to land before the club row exists.
 *
 * 512 and 1080 match the profile sizes rather than the drawn boxes: the club
 * avatar is 72 on `List / Club` and 28 in the detail header, and the cover is 80
 * wide on the card. Compressing to those would be right until the first screen
 * draws either one larger, and re-uploading everyone's images is not a thing
 * this app can do. Matching the profile sizes costs a few kilobytes and removes
 * that failure entirely.
 */
export function uploadClubAvatarImage(file: File, options: UploadObjectOptions = {}) {
  return uploadOwnImage(file, buildClubAvatarPath, 512, options)
}

export function uploadClubCoverImage(file: File, options: UploadObjectOptions = {}) {
  return uploadOwnImage(file, buildClubCoverPath, 1080, options)
}
