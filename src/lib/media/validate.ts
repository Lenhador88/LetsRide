/**
 * A fast, cheap pre-check on the picked file, before spending time decoding
 * it — not the security boundary. `file.type` is a client-declared string and
 * cannot be trusted the way migration 010's storage.objects policy checks
 * `metadata->>'mimetype'`, which Storage's own multipart parser recorded and
 * a client cannot lie about. This exists to fail fast and readably ("choose a
 * photo") rather than to let a 20 MB video hang in createImageBitmap for a
 * few seconds before failing anyway.
 */

/** Raw input ceiling, well above what any phone camera photo needs and well
 * below what would make decoding a single image visibly hang the tab. */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024

export type ImageFileValidation = { ok: true } | { ok: false; error: string }

export function validateImageFile(file: File): ImageFileValidation {
  // Some mobile browsers leave `type` blank for camera-captured files rather
  // than misreporting it, so blank is allowed through to createImageBitmap
  // rather than rejected — the decode itself is the real check.
  if (file.type !== '' && !file.type.startsWith('image/')) {
    return { ok: false, error: 'Choose a photo — that file is not an image.' }
  }
  if (file.size === 0) {
    return { ok: false, error: 'That file is empty.' }
  }
  if (file.size > MAX_INPUT_BYTES) {
    return { ok: false, error: 'That photo is too large. Try a smaller one.' }
  }
  return { ok: true }
}
