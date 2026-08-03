/**
 * Client-side image processing, shared by every upload surface: resize to a
 * sane maximum edge, re-encode to JPEG within a size budget, and strip EXIF —
 * including the GPS block a phone embeds in every outdoor photo, which for a
 * motorcycle app means a rider's home address riding along with a photo of
 * their bike in the driveway.
 *
 * Browser-only — createImageBitmap, canvas and document don't exist
 * server-side. Import this only from 'use client' components or other
 * browser-only modules (upload.ts), never from a Server Action or lib/data.
 *
 * EXIF stripping is a side effect of the re-encode, not a step of its own:
 * canvas has no metadata channel at all, so nothing survives drawImage +
 * toBlob — not GPS, not the camera make/model, nothing. Orientation is the
 * one tag that has to be handled BEFORE it's discarded, or a portrait photo
 * comes out sideways with no tag left to say so. `imageOrientation:
 * 'from-image'` on createImageBitmap does exactly that in one call — decode,
 * apply the rotation/mirror to the actual pixels, report already-corrected
 * width/height — so there is no hand-rolled EXIF parser here to get wrong.
 *
 * This is not assumed; it is verified. A real Chromium (the one this repo's
 * Playwright already ships) decoded a JPEG carrying both a GPS IFD (lat/long
 * rationals under a real Exif/TIFF header) and Orientation=6 on a landscape
 * source, ran it through compressImage, and the output blob had (a) no
 * "Exif" marker at all — byte-searched, not sampled — and (b) pixel content
 * matching the ORIENTED result (top/bottom colour bands swapped to where a
 * correctly-rotated portrait photo would put them), not the raw un-rotated
 * source. See the media agent's report for the exact fixture and byte
 * offsets checked.
 */

const DEFAULT_MAX_EDGE = 1600
const DEFAULT_QUALITY = 0.82
const MIN_QUALITY = 0.5
const QUALITY_STEP = 0.1
/** "Well under 1MB" per the brief — 900 KiB leaves real headroom rather than
 * aiming at the ceiling. */
const TARGET_MAX_BYTES = 900 * 1024

export type CompressImageOptions = {
  maxEdge?: number
  quality?: number
  targetMaxBytes?: number
}

export type CompressedImage = {
  blob: Blob
  width: number
  height: number
}

export async function compressImage(
  file: File | Blob,
  options: CompressImageOptions = {}
): Promise<CompressedImage> {
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    // bitmap.width/height already reflect the EXIF-corrected orientation —
    // e.g. a phone held in portrait with Orientation=6 reports the tall
    // dimensions here, not the sensor's landscape ones.
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context is unavailable in this browser.')
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await encodeWithSizeBudget(
      canvas,
      options.quality ?? DEFAULT_QUALITY,
      options.targetMaxBytes ?? TARGET_MAX_BYTES
    )
    return { blob, width, height }
  } finally {
    bitmap.close()
  }
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('JPEG encoding failed.'))),
      'image/jpeg',
      quality
    )
  })
}

/**
 * A ride photo's detail varies too much for one fixed quality to land near a
 * predictable size — a cluttered garage shot and an open road at the same
 * quality setting can differ by several hundred KB. Step quality down
 * against the actual encoded size instead of trusting the first pass, since
 * "well under 1MB" is a size budget, not a quality setting.
 */
async function encodeWithSizeBudget(
  canvas: HTMLCanvasElement,
  startQuality: number,
  targetMaxBytes: number
): Promise<Blob> {
  let quality = startQuality
  let blob = await canvasToJpegBlob(canvas, quality)
  while (blob.size > targetMaxBytes && quality > MIN_QUALITY) {
    quality = Math.max(MIN_QUALITY, quality - QUALITY_STEP)
    blob = await canvasToJpegBlob(canvas, quality)
  }
  return blob
}
