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

export type ExifCapture = {
  /** ISO 8601 instant, or null when the photo carries no usable capture time. */
  takenAt: string | null
  /**
   * The UTC offset the instant above was resolved with, in minutes east of UTC
   * (Amsterdam in summer is `120`). It is what makes the camera's own wall-clock
   * reading recoverable from the instant, exactly, by any renderer.
   *
   * Always present when `takenAt` is, and always absent when it is not — the
   * database CHECK refuses a half pair, and a bare instant would leave every
   * reader guessing which zone to draw it in.
   */
  takenAtOffsetMinutes: number | null
  latitude: number | null
  longitude: number | null
}

const NOTHING: ExifCapture = {
  takenAt: null,
  takenAtOffsetMinutes: null,
  latitude: null,
  longitude: null,
}

/**
 * The floor a capture time has to clear. `DateTimeOriginal` arrived with EXIF
 * 1.0 in **October 1995**, so a value predating the tag's own specification is
 * garbage by construction — which is the test that actually catches the two
 * values that turn up in practice, epoch-0 (`1970-01-01`) and the 1904 Mac
 * epoch. A 1900 floor admits both.
 */
const EARLIEST_CAPTURE_MS = Date.UTC(1995, 0, 1)

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
      ...readTakenAt(view, tiffAt, ifd0, little),
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
    // Re-check after the skip. The loop guard above was taken before `at` moved,
    // so a run of padding at the very end of the buffer would otherwise reach
    // the `getUint16` below with fewer than four bytes left and throw. The outer
    // try/catch would turn that into the right answer anyway — this is here so
    // the header's claim that every read is bounds-checked stays literally true,
    // and so removing the wrapper cannot turn a clean miss into a thrown upload.
    if (at + 4 > view.byteLength) return null

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

type CaptureTime = { takenAt: string | null; takenAtOffsetMinutes: number | null }

const NO_CAPTURE_TIME: CaptureTime = { takenAt: null, takenAtOffsetMinutes: null }

/**
 * `DateTimeOriginal` is a **zone-less wall-clock string** — the camera writes
 * what its own clock read and, before EXIF 2.31, recorded no offset at all. So
 * turning it into an instant needs an offset from somewhere, and **whichever one
 * is used is stored beside the instant** rather than discarded. That is what
 * makes the camera's own reading recoverable: `takenAt` answers *when*, the
 * offset answers *what the clock on the wall said*, and no renderer has to guess.
 *
 * Two sources, in order:
 *
 * - **`OffsetTimeOriginal`, when the camera wrote one.** The honest answer and
 *   the only one that is actually *true*.
 * - **The device's own offset at that wall-clock date.** The photo was almost
 *   always taken by the phone now uploading it, so its zone is where the rider
 *   was; and because the device's clock and its offset are self-consistent with
 *   `now()`, an honestly-dated photo cannot come out ahead of the present.
 *
 * **`APP_TIME_ZONE` was the third candidate and it is wrong here, which is worth
 * writing down because it is the app's convention everywhere else.** That
 * convention exists so an unpinned *formatter* does not render one zone during
 * the prerender pass and another on hydration — a display problem. This is an
 * event handler on a picked file producing an absolute instant, with no render
 * and no second reader. Resolving a Helsinki rider's 12:00 EEST photo as
 * Amsterdam wall-clock yields 10:00 UTC: **an hour in the future**, which
 * `taken_at <= now()` refuses. Every zone east of Amsterdam, in proportion to
 * its offset, for exactly the window in which riders post.
 *
 * The date is resolved through the local-parts `Date` constructor rather than by
 * adding a fixed offset, so a photo taken in July gets July's offset and one
 * taken in January gets January's. Adding a constant is the version that is
 * wrong twice a year.
 */
function readTakenAt(view: DataView, tiffAt: number, ifd0: Ifd, little: boolean): CaptureTime {
  const exifIfd = readSubIfd(view, tiffAt, ifd0, TAG_EXIF_IFD, little)
  if (!exifIfd) return NO_CAPTURE_TIME

  const entry = exifIfd.get(TAG_DATE_TIME_ORIGINAL)
  if (!entry) return NO_CAPTURE_TIME
  const raw = readAscii(view, tiffAt, entry, little)
  if (!raw) return NO_CAPTURE_TIME

  const match = DATE_TIME_ORIGINAL_RE.exec(raw.trim())
  // Cameras write `    :  :     :  :  ` for "unset" rather than omitting the
  // tag, so a shape check is the whole validation here.
  if (!match) return NO_CAPTURE_TIME
  const [, year, month, day, hour, minute, second] = match

  const offsetEntry = exifIfd.get(TAG_OFFSET_TIME_ORIGINAL)
  const declared = offsetEntry ? readAscii(view, tiffAt, offsetEntry, little)?.trim() : null
  const declaredOffset = declared ? parseOffsetMinutes(declared) : null

  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  }

  const { instant, offsetMinutes } =
    declaredOffset === null ? resolveWithDeviceOffset(parts) : resolveWithOffset(parts, declaredOffset)

  if (Number.isNaN(instant)) return NO_CAPTURE_TIME

  // **The clamp, and it is total.** The database bounds this column because the
  // client supplies it and cannot be trusted to — but a CHECK that refuses the
  // insert costs the rider the photo they just composed, and a garbage EXIF tag
  // is not their fault. So an out-of-range value is dropped here and the
  // postcard posts without a capture time, which is a state the composer and the
  // Journal both already handle. The CHECK stays as the guarantee; this keeps it
  // from ever being the thing a rider meets.
  if (instant > Date.now() || instant < EARLIEST_CAPTURE_MS) return NO_CAPTURE_TIME

  // Dropped together, always — the coupling CHECK refuses a half pair, and an
  // instant with no offset is one nobody can draw a wall clock from.
  return { takenAt: new Date(instant).toISOString(), takenAtOffsetMinutes: offsetMinutes }
}

type WallClockParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/**
 * The widest offset any real zone has ever used: UTC-12:00 to UTC+14:00.
 *
 * `OffsetTimeOriginal` is two digits of hours, so the *syntax* reaches ±5999
 * minutes — a camera with a corrupt clock setting can write `+99:59` and be
 * perfectly well-formed.
 */
const MIN_REAL_OFFSET_MINUTES = -12 * 60
const MAX_REAL_OFFSET_MINUTES = 14 * 60

/**
 * `+HH:MM` / `-HH:MM` to minutes east of UTC, or `null` for anything that is
 * not an offset a place on Earth has.
 *
 * **An out-of-range value is treated exactly like an unparseable one — it falls
 * back to the device offset rather than being sent.** That equivalence is the
 * fix rather than a nicety: without it `'nonsense'` fell back and `'+99:59'` did
 * not, so the second sailed through to `createPostcard`, was refused by the
 * ±1440 Zod bound mirroring `064`'s CHECK, and the rider met *"Too big: expected
 * number to be <=1440"* against a form with no field to correct. Re-picking the
 * same photo re-read the same bytes and failed identically — the photo could not
 * be posted at all, and each attempt orphaned a Storage object, because the
 * parse failure returns ahead of `createPostcard`'s cleanup.
 *
 * The wall clock is still almost certainly right when the offset is garbage, so
 * dropping the capture time entirely would be the wrong repair; the device's own
 * offset is the same fallback this function's absence already triggers.
 */
function parseOffsetMinutes(text: string): number | null {
  const match = OFFSET_TIME_RE.exec(text)
  if (!match) return null
  const [, sign, hours, minutes] = match
  const total = Number(hours) * 60 + Number(minutes)
  const signed = sign === '-' ? -total : total
  if (signed < MIN_REAL_OFFSET_MINUTES || signed > MAX_REAL_OFFSET_MINUTES) return null
  return signed
}

function resolveWithOffset(parts: WallClockParts, offsetMinutes: number) {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return { instant: asUtc - offsetMinutes * 60_000, offsetMinutes }
}

/**
 * The device's own offset **at that date**, taken from a `Date` built out of
 * local parts — which is what makes it DST-correct without a zone database.
 *
 * `getTimezoneOffset()` reports minutes *behind* UTC, so it is negated to give
 * the "east of UTC" convention the column stores.
 */
function resolveWithDeviceOffset(parts: WallClockParts) {
  const local = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  const instant = local.getTime()
  return {
    instant,
    // `0 - x` rather than `-x`, so UTC yields `+0` and not `-0`. Cosmetic on the
    // wire (JSON renders both as `0`) and not in a test or a comparison.
    offsetMinutes: Number.isNaN(instant) ? 0 : 0 - local.getTimezoneOffset(),
  }
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
