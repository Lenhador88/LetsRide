/**
 * Reads the two things a photo knows about itself that the app cannot recover
 * any other way: **when it was taken** and **where**.
 *
 * Both live in the JPEG's EXIF block, and `compress.ts` destroys that block as
 * a side effect of the canvas re-encode — canvas has no metadata channel, so
 * nothing survives `drawImage` + `toBlob`. This module therefore runs on the
 * **original `File`**, before compression, and that ordering is the whole
 * contract: after `compressImage` there is nothing left to read. `upload.ts`
 * is what holds the two in the right order.
 *
 * ## Why this is hand-rolled
 *
 * CLAUDE.md §Technology Decisions: dependencies are added deliberately, and the
 * question to ask first is whether a thirty-line helper does the job. `exif-js`
 * and friends parse the whole tag space — maker notes, thumbnails, IPTC, XMP —
 * and this app wants exactly four tags. What is below is the JPEG segment walk,
 * the TIFF header, and two IFDs; everything it does not understand it reports as
 * `null` rather than guessing.
 *
 * ## What it does NOT read
 *
 * - **HEIC/HEIF**, which is what an iPhone shoots by default. Its metadata is in
 *   an ISOBMFF box structure, not a JPEG APP1 segment, so this returns nulls for
 *   one. That is a real gap and it is deliberate: it fails to the safe answer —
 *   no time, no location, and a composer that says so — rather than to a wrong
 *   one. (A browser that cannot decode HEIC at all fails earlier, in
 *   `createImageBitmap`.)
 * - **PNG, WebP, GIF.** No EXIF in the shapes this app sees.
 * - Anything already stripped — an image that has been through another app's
 *   share sheet usually has no EXIF left, which is again the safe answer.
 *
 * ## Failure is always `null`, never a throw
 *
 * A malformed, truncated or hostile file must not stop a rider posting a photo.
 * Every read is bounds-checked and the whole parse is wrapped, so the worst a
 * broken file can do is produce the same result as a photo with no metadata.
 */

import { wallClockToUtc } from '@/lib/utils'

export type ExifCapture = {
  /** ISO 8601 instant, or null when the photo carries no usable capture time. */
  takenAt: string | null
  latitude: number | null
  longitude: number | null
}

const NOTHING: ExifCapture = { takenAt: null, latitude: null, longitude: null }

/**
 * How much of the file to look at. The Exif APP1 segment is at most 65533 bytes
 * and sits among the first few segments, so 256 KiB covers every real photo with
 * room for a JFIF thumbnail ahead of it — while bounding what a 25 MB input can
 * make us pull into memory. The scan also stops at the first SOS marker, so a
 * file with no Exif costs a few dozen bytes rather than the whole slice.
 */
const HEADER_BYTES = 256 * 1024

/** EXIF tag numbers. Four of them, plus the two IFD pointers that reach them. */
const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825
const TAG_DATE_TIME_ORIGINAL = 0x9003
const TAG_OFFSET_TIME_ORIGINAL = 0x9011
const TAG_GPS_LATITUDE_REF = 0x0001
const TAG_GPS_LATITUDE = 0x0002
const TAG_GPS_LONGITUDE_REF = 0x0003
const TAG_GPS_LONGITUDE = 0x0004

const TYPE_ASCII = 2
const TYPE_LONG = 4
const TYPE_RATIONAL = 5

/** Bytes per component, indexed by TIFF type. 0 marks a type we do not read. */
const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8]

type Entry = { type: number; count: number; entryAt: number }
type Ifd = Map<number, Entry>

/**
 * Reads capture metadata off a picked file.
 *
 * Only the first `HEADER_BYTES` are fetched — `Blob.slice` is a view, so this
 * does not read the whole photo off disk to find a header at the front of it.
 */
export async function readExifCapture(file: File | Blob): Promise<ExifCapture> {
  try {
    const head = await file.slice(0, HEADER_BYTES).arrayBuffer()
    return parseExifCapture(head)
  } catch {
    return NOTHING
  }
}

/**
 * The pure half, split out so it is testable without a `File` — the unit suite
 * runs in `node`, and building an ArrayBuffer fixture is exact where building a
 * browser File is not.
 */
export function parseExifCapture(buffer: ArrayBuffer): ExifCapture {
  try {
    const view = new DataView(buffer)
    const tiffAt = findExifTiffHeader(view)
    if (tiffAt === null) return NOTHING

    const little = readByteOrder(view, tiffAt)
    if (little === null) return NOTHING

    const ifd0At = readU32(view, tiffAt + 4, little)
    const ifd0 = readIfd(view, tiffAt, tiffAt + ifd0At, little)
    if (!ifd0) return NOTHING

    return {
      takenAt: readTakenAt(view, tiffAt, ifd0, little),
      ...readCoordinates(view, tiffAt, ifd0, little),
    }
  } catch {
    return NOTHING
  }
}

/**
 * Walks the JPEG's marker segments looking for the APP1 that starts with
 * `Exif\0\0`, and returns the offset of the TIFF header inside it.
 *
 * A JPEG can carry several APP1 segments — XMP is one, and on many phones it
 * comes *first* — so this checks the signature rather than taking the first APP1
 * it finds. That is the bug this shape exists to avoid: reading XMP's
 * `http://ns.adobe.com/xap/1.0/\0` as a TIFF header yields a plausible-looking
 * garbage offset rather than a clean miss.
 */
function findExifTiffHeader(view: DataView): number | null {
  if (view.byteLength < 4) return null
  if (view.getUint16(0, false) !== 0xffd8) return null // not a JPEG

  let at = 2
  while (at + 4 <= view.byteLength) {
    // Padding of 0xFF between segments is legal; skip it rather than failing.
    if (view.getUint8(at) !== 0xff) return null
    let marker = view.getUint8(at + 1)
    while (marker === 0xff && at + 2 < view.byteLength) {
      at += 1
      marker = view.getUint8(at + 1)
    }

    // SOS — image data starts here and there are no more headers to find.
    if (marker === 0xda || marker === 0xd9) return null
    // Standalone markers carry no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
      continue
    }

    const length = view.getUint16(at + 2, false)
    if (length < 2) return null
    const payloadAt = at + 4
    const payloadEnd = at + 2 + length
    if (payloadEnd > view.byteLength) return null

    if (marker === 0xe1 && payloadAt + 6 <= view.byteLength && isExifSignature(view, payloadAt)) {
      const tiffAt = payloadAt + 6
      return tiffAt + 8 <= view.byteLength ? tiffAt : null
    }

    at = payloadEnd
  }
  return null
}

function isExifSignature(view: DataView, at: number): boolean {
  return (
    view.getUint8(at) === 0x45 && // E
    view.getUint8(at + 1) === 0x78 && // x
    view.getUint8(at + 2) === 0x69 && // i
    view.getUint8(at + 3) === 0x66 && // f
    view.getUint8(at + 4) === 0x00 &&
    view.getUint8(at + 5) === 0x00
  )
}

/** `II` little-endian or `MM` big-endian, then the 42 that confirms both. */
function readByteOrder(view: DataView, tiffAt: number): boolean | null {
  const order = view.getUint16(tiffAt, false)
  const little = order === 0x4949
  if (!little && order !== 0x4d4d) return null
  if (view.getUint16(tiffAt + 2, little) !== 0x002a) return null
  return little
}

function readU16(view: DataView, at: number, little: boolean): number {
  return view.getUint16(at, little)
}

function readU32(view: DataView, at: number, little: boolean): number {
  return view.getUint32(at, little)
}

/**
 * One IFD: a count, then that many 12-byte entries. Entries are indexed by tag
 * rather than returned as a list — every caller here wants a specific tag, and a
 * duplicate tag (which malformed files do carry) resolves to the last one rather
 * than being iterated twice.
 */
function readIfd(view: DataView, tiffAt: number, at: number, little: boolean): Ifd | null {
  if (at < tiffAt || at + 2 > view.byteLength) return null
  const count = readU16(view, at, little)
  // A sane ceiling: a real IFD has a few dozen entries, and this bounds what a
  // corrupt count can make us walk.
  if (count > 512) return null
  if (at + 2 + count * 12 > view.byteLength) return null

  const ifd: Ifd = new Map()
  for (let i = 0; i < count; i++) {
    const entryAt = at + 2 + i * 12
    ifd.set(readU16(view, entryAt, little), {
      type: readU16(view, entryAt + 2, little),
      count: readU32(view, entryAt + 4, little),
      entryAt,
    })
  }
  return ifd
}

/**
 * Where an entry's data actually lives. Up to four bytes sit inline in the entry
 * itself; anything larger is an offset from the TIFF header. Getting this
 * backwards is the classic EXIF bug — a 4-character ASCII value read through the
 * offset path points at arbitrary bytes.
 */
function valueAt(view: DataView, tiffAt: number, entry: Entry, little: boolean): number | null {
  const size = TYPE_SIZES[entry.type] ?? 0
  if (size === 0) return null
  const total = size * entry.count
  if (total <= 4) return entry.entryAt + 8
  const at = tiffAt + readU32(view, entry.entryAt + 8, little)
  if (at < tiffAt || at + total > view.byteLength) return null
  return at
}

function readAscii(view: DataView, tiffAt: number, entry: Entry, little: boolean): string | null {
  if (entry.type !== TYPE_ASCII || entry.count === 0 || entry.count > 128) return null
  const at = valueAt(view, tiffAt, entry, little)
  if (at === null || at + entry.count > view.byteLength) return null

  let out = ''
  for (let i = 0; i < entry.count; i++) {
    const byte = view.getUint8(at + i)
    if (byte === 0) break
    out += String.fromCharCode(byte)
  }
  return out
}

function readRationals(
  view: DataView,
  tiffAt: number,
  entry: Entry,
  little: boolean,
  expected: number
): number[] | null {
  if (entry.type !== TYPE_RATIONAL || entry.count !== expected) return null
  const at = valueAt(view, tiffAt, entry, little)
  if (at === null) return null

  const out: number[] = []
  for (let i = 0; i < expected; i++) {
    const numerator = readU32(view, at + i * 8, little)
    const denominator = readU32(view, at + i * 8 + 4, little)
    if (denominator === 0) return null
    out.push(numerator / denominator)
  }
  return out
}

/** A sub-IFD pointer is a LONG holding an offset from the TIFF header. */
function readSubIfd(view: DataView, tiffAt: number, ifd: Ifd, tag: number, little: boolean): Ifd | null {
  const entry = ifd.get(tag)
  if (!entry || entry.type !== TYPE_LONG || entry.count !== 1) return null
  const at = valueAt(view, tiffAt, entry, little)
  if (at === null) return null
  return readIfd(view, tiffAt, tiffAt + readU32(view, at, little), little)
}

/** `YYYY:MM:DD HH:MM:SS`, and nothing else is accepted. */
const DATE_TIME_ORIGINAL_RE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
/** `+HH:MM` / `-HH:MM`, per EXIF 2.31's OffsetTimeOriginal. */
const OFFSET_TIME_RE = /^([+-])(\d{2}):(\d{2})$/

/**
 * `DateTimeOriginal` is a **zone-less wall-clock string** — the camera writes
 * what its own clock read and, before EXIF 2.31, recorded no offset at all. So
 * turning it into an instant needs a zone from somewhere, and there are only
 * three candidates:
 *
 * - **`OffsetTimeOriginal`, when the camera wrote one.** The honest answer, and
 *   the only one that is actually *true*. Used whenever it is present and
 *   well-formed.
 * - **`APP_TIME_ZONE`**, via `wallClockToUtc` — the app's standing convention
 *   for every zone-less time it stores (CLAUDE.md §Technology Decisions). It is
 *   wrong for a photo taken abroad, and it is chosen anyway because it is the
 *   one that **round-trips**: the Journal renders through formatters pinned to
 *   the same zone, so a camera that recorded 12:15 draws 12:15. The rider sees
 *   the time they remember.
 * - The **browser's** zone at upload, which is the tempting one and is wrong in
 *   a way the other two are not: it makes the stored instant depend on where the
 *   rider happened to be standing when they got signal, so the same photo
 *   uploaded twice from two places is two different times.
 *
 * A photo taken abroad is therefore recorded as if the camera's clock were
 * Amsterdam's. That is a known, bounded inaccuracy — the same interim CLAUDE.md
 * records for ride times, which the proposal notes ends the same way, with a
 * zone stored beside the value.
 */
function readTakenAt(view: DataView, tiffAt: number, ifd0: Ifd, little: boolean): string | null {
  const exifIfd = readSubIfd(view, tiffAt, ifd0, TAG_EXIF_IFD, little)
  if (!exifIfd) return null

  const entry = exifIfd.get(TAG_DATE_TIME_ORIGINAL)
  if (!entry) return null
  const raw = readAscii(view, tiffAt, entry, little)
  if (!raw) return null

  const match = DATE_TIME_ORIGINAL_RE.exec(raw.trim())
  // Cameras write `    :  :     :  :  ` for "unset" rather than omitting the
  // tag, so a shape check is the whole validation here.
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  const wallClock = `${year}-${month}-${day}T${hour}:${minute}:${second}`

  const offsetEntry = exifIfd.get(TAG_OFFSET_TIME_ORIGINAL)
  const offset = offsetEntry ? readAscii(view, tiffAt, offsetEntry, little) : null
  const iso = offset && OFFSET_TIME_RE.test(offset.trim())
    ? `${wallClock}${offset.trim()}`
    : null

  const instant = iso ? new Date(iso) : new Date(wallClockToUtc(wallClock))
  if (Number.isNaN(instant.getTime())) return null
  return instant.toISOString()
}

/**
 * The GPS IFD stores each coordinate as three rationals — degrees, minutes,
 * seconds — with the hemisphere in a separate `Ref` tag. A missing or unexpected
 * `Ref` is a miss rather than an assumed north/east: guessing there puts a photo
 * in the wrong hemisphere, which is worse than having no location at all.
 *
 * Both halves must resolve or neither is returned. A latitude with no longitude
 * is not a location, and the database CHECK refuses the pair anyway.
 */
function readCoordinates(
  view: DataView,
  tiffAt: number,
  ifd0: Ifd,
  little: boolean
): { latitude: number | null; longitude: number | null } {
  const none = { latitude: null, longitude: null }
  const gpsIfd = readSubIfd(view, tiffAt, ifd0, TAG_GPS_IFD, little)
  if (!gpsIfd) return none

  const latitude = readCoordinate(view, tiffAt, gpsIfd, little, TAG_GPS_LATITUDE, TAG_GPS_LATITUDE_REF, 'N', 'S', 90)
  const longitude = readCoordinate(view, tiffAt, gpsIfd, little, TAG_GPS_LONGITUDE, TAG_GPS_LONGITUDE_REF, 'E', 'W', 180)
  if (latitude === null || longitude === null) return none

  // 0,0 is Null Island — what a GPS chip writes when it has no fix, not a photo
  // taken in the Gulf of Guinea. Treated as no location.
  if (latitude === 0 && longitude === 0) return none

  return { latitude, longitude }
}

function readCoordinate(
  view: DataView,
  tiffAt: number,
  gpsIfd: Ifd,
  little: boolean,
  valueTag: number,
  refTag: number,
  positiveRef: string,
  negativeRef: string,
  limit: number
): number | null {
  const entry = gpsIfd.get(valueTag)
  const refEntry = gpsIfd.get(refTag)
  if (!entry || !refEntry) return null

  const parts = readRationals(view, tiffAt, entry, little, 3)
  if (!parts) return null
  const ref = readAscii(view, tiffAt, refEntry, little)?.trim().toUpperCase()
  if (ref !== positiveRef && ref !== negativeRef) return null

  const [degrees, minutes, seconds] = parts
  const magnitude = degrees + minutes / 60 + seconds / 3600
  if (!Number.isFinite(magnitude) || magnitude > limit) return null

  return ref === negativeRef ? -magnitude : magnitude
}
