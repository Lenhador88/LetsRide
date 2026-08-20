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
 * ## Two containers, one TIFF
 *
 * JPEG and **HEIC/HEIF** — what an iPhone and an iPad shoot by default — store
 * the same EXIF structure in completely different wrappers: an APP1 marker
 * segment near the front of a JPEG, an ISOBMFF *item* in a HEIC whose bytes are
 * usually far into `mdat`. So there are two ways in, `findExifTiffHeader` and
 * `locateHeifExif`, and one walk out of both — `readCaptureFromTiff`.
 *
 * The HEIC path is the only asynchronous one, because locating the item and
 * reading it are two different slices of the file. See `readExifCapture`.
 *
 * **One HEIF layout is not read: `mdat` before `meta`, where `mdat` is larger
 * than the header slice.** `readBox` refuses a box claiming more than the
 * buffer holds, so the top-level walk stops before it reaches `meta` and the
 * file reports no metadata — the safe answer, and the same one the format's
 * usual layout would have given for a photo with nothing to read. Every
 * encoder this app expects writes `meta` first.
 *
 * ## What it does NOT read
 *
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

    // **HEIC is read in two slices and a JPEG in one, and that asymmetry is the
    // format's rather than a choice.** A JPEG carries its EXIF in a segment near
    // the front, so one header read finds it. HEIF carries a *directory* near
    // the front (`meta`) that points at a payload which is usually inside
    // `mdat`, tens of megabytes in — so the first slice locates it and the
    // second reads exactly the bytes it named. Reading far enough to catch
    // `mdat` speculatively would mean pulling most of the photo into memory to
    // find a few hundred bytes.
    const extent = locateHeifExif(head)
    if (extent) {
      const payload = await file.slice(extent.offset, extent.offset + extent.length).arrayBuffer()
      return parseHeifExifPayload(payload)
    }

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
    return readCaptureFromTiff(view, tiffAt)
  } catch {
    return NOTHING
  }
}

/**
 * The TIFF walk itself, from the byte order mark onward — **shared by both
 * container formats and unaware of either.**
 *
 * A JPEG reaches it through `findExifTiffHeader`'s marker walk and a HEIC
 * through `locateHeifExif`'s box tree, and past this point the two are the same
 * bytes in the same layout: EXIF inside HEIF is not a second dialect, it is the
 * identical TIFF structure relocated into an ISOBMFF item. Splitting here is
 * what keeps `readTakenAt`'s offset resolution, the coordinate clamp and the
 * 1995 floor from acquiring a per-format copy.
 */
function readCaptureFromTiff(view: DataView, tiffAt: number): ExifCapture {
  // `readByteOrder` reads four bytes and `readU32` four more. The JPEG path
  // proves this at its call site; the HEIF path cannot, because the extent
  // length comes from the file rather than from a segment this module walked.
  if (tiffAt < 0 || tiffAt + 8 > view.byteLength) return NOTHING

  const little = readByteOrder(view, tiffAt)
  if (little === null) return NOTHING

  const ifd0At = readU32(view, tiffAt + 4, little)
  const ifd0 = readIfd(view, tiffAt, tiffAt + ifd0At, little)
  if (!ifd0) return NOTHING

  return {
    ...readTakenAt(view, tiffAt, ifd0, little),
    ...readCoordinates(view, tiffAt, ifd0, little),
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

/* -------------------------------------------------------------------------- */
/* HEIC / HEIF — the container an iPhone and an iPad shoot by default          */
/* -------------------------------------------------------------------------- */

/**
 * Where a HEIC's EXIF payload lives, as an absolute byte range in the file.
 *
 * Absolute rather than relative to anything this module read, because that is
 * what `iloc` stores and what the second `Blob.slice` needs.
 */
export type HeifExifExtent = { offset: number; length: number }

/**
 * Brands that mean "this ISOBMFF file is a still image with the HEIF item
 * structure". Checked against the major brand **and** every compatible brand,
 * because encoders disagree about which one goes first — an iPhone writes
 * `heic` as major with `mif1` compatible, and some writers do the reverse.
 *
 * `avif`/`avis` are here for the same reason they cost nothing: AVIF is the
 * identical box structure with a different codec, so the EXIF item is found by
 * exactly this walk. Nothing in the app produces one today; a file that turns
 * up gets read rather than silently returning no metadata.
 */
const HEIF_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs',
  'mif1', 'msf1', 'miaf', 'avif', 'avis',
])

/** Ceilings on what a corrupt or hostile file can make this walk do. */
const MAX_BOXES = 64
const MAX_ITEMS = 1024
/** An EXIF block is bounded at 64 KiB in JPEG; HEIF has no such bound, so this
 *  is the second slice's ceiling rather than the format's. */
const MAX_EXIF_PAYLOAD_BYTES = 512 * 1024

type Box = { type: string; end: number; bodyAt: number }

function fourCC(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3)
  )
}

/**
 * One ISOBMFF box header: a 32-bit size, a four-character type, and two escape
 * hatches — `1` meaning a 64-bit size follows, `0` meaning "to the end".
 *
 * `limit` is the parent's end rather than the buffer's, so a child box claiming
 * more than its parent holds is refused here instead of walking out of it.
 */
function readBox(view: DataView, at: number, limit: number): Box | null {
  if (at + 8 > limit) return null
  const size = view.getUint32(at, false)
  const type = fourCC(view, at + 4)

  let bodyAt = at + 8
  let end: number
  if (size === 1) {
    if (at + 16 > limit) return null
    const large = view.getBigUint64(at + 8, false)
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null
    end = at + Number(large)
    bodyAt = at + 16
  } else if (size === 0) {
    end = limit
  } else if (size < 8) {
    return null
  } else {
    end = at + size
  }

  if (end <= at || end > limit) return null
  return { type, end, bodyAt }
}

/** `offset_size`, `length_size` and `base_offset_size` are 0, 4 or 8 per the
 *  spec; anything else is a malformed file rather than a size to guess at. */
function readSizedUint(view: DataView, at: number, size: number, limit: number): number | null {
  if (size === 0) return 0
  if (at + size > limit) return null
  if (size === 4) return view.getUint32(at, false)
  if (size === 8) {
    const large = view.getBigUint64(at, false)
    return large > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(large)
  }
  return null
}

/**
 * Finds the EXIF payload in a HEIC without reading the payload itself.
 *
 * **The two-step is the whole reason this function exists separately from the
 * parse.** HEIF stores metadata as *items*: `iinf` is a table of what items
 * exist and what each one is, `iloc` is a table of where each one's bytes are,
 * and both sit near the front of the file inside `meta` — while the bytes
 * themselves are usually in `mdat`, which on a 4 MB photo starts megabytes in.
 * So the caller reads a header slice, this names an exact byte range, and the
 * caller reads that range and nothing else.
 *
 * Returns `null` for a JPEG, for anything that is not a HEIF-branded ISOBMFF
 * file, and for every malformed or unsupported shape — which is what makes it
 * safe to try before the JPEG path rather than after.
 *
 * Exported for the unit suite: an ISOBMFF fixture is exact to build in `node`
 * where a browser `File` is not, the same reason `parseExifCapture` is split
 * out of `readExifCapture`.
 */
export function locateHeifExif(buffer: ArrayBuffer): HeifExifExtent | null {
  try {
    const view = new DataView(buffer)
    const limit = view.byteLength

    const ftyp = readBox(view, 0, limit)
    if (!ftyp || ftyp.type !== 'ftyp' || !isHeifBrand(view, ftyp)) return null

    let at = ftyp.end
    let meta: Box | null = null
    for (let guard = 0; guard < MAX_BOXES && at < limit; guard++) {
      const box = readBox(view, at, limit)
      if (!box) return null
      if (box.type === 'meta') {
        meta = box
        break
      }
      at = box.end
    }
    if (!meta) return null

    // `meta` is a FullBox: one version byte and three flag bytes before its
    // children start.
    let itemId: number | null = null
    let iloc: Box | null = null
    let child = meta.bodyAt + 4
    for (let guard = 0; guard < MAX_BOXES && child < meta.end; guard++) {
      const box = readBox(view, child, meta.end)
      if (!box) return null
      if (box.type === 'iinf') itemId = findExifItemId(view, box)
      else if (box.type === 'iloc') iloc = box
      child = box.end
    }
    if (itemId === null || !iloc) return null

    return readItemExtent(view, iloc, itemId)
  } catch {
    return null
  }
}

function isHeifBrand(view: DataView, ftyp: Box): boolean {
  if (ftyp.bodyAt + 4 > ftyp.end) return false
  if (HEIF_BRANDS.has(fourCC(view, ftyp.bodyAt))) return true
  // major_brand, then a 4-byte minor_version, then the compatible list.
  for (let at = ftyp.bodyAt + 8; at + 4 <= ftyp.end; at += 4) {
    if (HEIF_BRANDS.has(fourCC(view, at))) return true
  }
  return false
}

/**
 * The item id whose type is `Exif`, from the item-info table.
 *
 * **Only `infe` version 2 and above carry an item TYPE at all** — version 0 and
 * 1 identify an item by a MIME string in a variable-length name field instead.
 * Nothing that shoots HEIC writes those, and skipping them is the safe answer
 * rather than a gap worth parsing: a version this does not understand yields no
 * id, which yields no metadata.
 */
function findExifItemId(view: DataView, iinf: Box): number | null {
  // A FullBox is 8 bytes of header and 4 of version/flags; a `readBox` that
  // returned an 8-byte box has none of those. The wrapper would catch the throw
  // and return the right answer anyway — this is here so the module header's
  // claim that every read is bounds-checked stays literally true.
  if (iinf.bodyAt + 4 > iinf.end) return null
  const version = view.getUint8(iinf.bodyAt)
  let at = iinf.bodyAt + 4

  let count: number
  if (version === 0) {
    if (at + 2 > iinf.end) return null
    count = view.getUint16(at, false)
    at += 2
  } else {
    if (at + 4 > iinf.end) return null
    count = view.getUint32(at, false)
    at += 4
  }
  if (count > MAX_ITEMS) return null

  for (let i = 0; i < count && at < iinf.end; i++) {
    const infe = readBox(view, at, iinf.end)
    if (!infe) return null
    at = infe.end
    if (infe.type !== 'infe') continue

    const infeVersion = view.getUint8(infe.bodyAt)
    if (infeVersion < 2) continue

    let p = infe.bodyAt + 4
    let id: number
    if (infeVersion === 2) {
      if (p + 2 > infe.end) continue
      id = view.getUint16(p, false)
      p += 2
    } else {
      if (p + 4 > infe.end) continue
      id = view.getUint32(p, false)
      p += 4
    }
    p += 2 // item_protection_index
    if (p + 4 > infe.end) continue
    if (fourCC(view, p) === 'Exif') return id
  }
  return null
}

/**
 * The first extent of one item, from the item-location table.
 *
 * **Every item is walked even once the wanted one is found**, because the
 * per-item records are variable-length and the only way to reach record *n* is
 * to have measured every record before it. The early return is therefore inside
 * the extent loop rather than around it.
 *
 * Two shapes are refused rather than handled. **A construction method other
 * than 0** means the bytes are not at a file offset — method 1 puts them inside
 * an `idat` box and method 2 in another item — and no HEIC encoder stores EXIF
 * that way; returning null costs a rider nothing and guessing an offset would
 * read arbitrary bytes. **An extent beyond `MAX_EXIF_PAYLOAD_BYTES`** is
 * refused so a corrupt length cannot make the caller allocate the whole photo.
 */
function readItemExtent(view: DataView, iloc: Box, wantedId: number): HeifExifExtent | null {
  if (iloc.bodyAt + 4 > iloc.end) return null
  const version = view.getUint8(iloc.bodyAt)
  let at = iloc.bodyAt + 4
  if (at + 2 > iloc.end) return null

  const sizes = view.getUint8(at)
  const offsetSize = sizes >> 4
  const lengthSize = sizes & 0x0f
  const baseAndIndex = view.getUint8(at + 1)
  const baseOffsetSize = baseAndIndex >> 4
  // The low nibble is `index_size` only in versions 1 and 2; in version 0 it is
  // reserved, and reading it as a size would shift every extent that follows.
  const indexSize = version === 1 || version === 2 ? baseAndIndex & 0x0f : 0
  at += 2

  let count: number
  if (version < 2) {
    if (at + 2 > iloc.end) return null
    count = view.getUint16(at, false)
    at += 2
  } else {
    if (at + 4 > iloc.end) return null
    count = view.getUint32(at, false)
    at += 4
  }
  if (count > MAX_ITEMS) return null

  for (let i = 0; i < count; i++) {
    let id: number
    if (version < 2) {
      if (at + 2 > iloc.end) return null
      id = view.getUint16(at, false)
      at += 2
    } else {
      if (at + 4 > iloc.end) return null
      id = view.getUint32(at, false)
      at += 4
    }

    let constructionMethod = 0
    if (version === 1 || version === 2) {
      if (at + 2 > iloc.end) return null
      constructionMethod = view.getUint16(at, false) & 0x0f
      at += 2
    }
    at += 2 // data_reference_index

    const base = readSizedUint(view, at, baseOffsetSize, iloc.end)
    if (base === null) return null
    at += baseOffsetSize

    if (at + 2 > iloc.end) return null
    const extentCount = view.getUint16(at, false)
    at += 2

    // **The one loop whose cursor can fail to advance.** With `offset_size`,
    // `length_size` and `index_size` all zero the body below moves `at` by
    // nothing, so no bounds guard inside it can ever fire and it runs
    // `extent_count` — up to 65535 — times per item. Bounded rather than
    // unbounded (`MAX_ITEMS` caps the outer loop) and it allocates nothing, but
    // a 6 KB crafted file measured ~200 ms of blocked main thread on a desktop,
    // which is a second or two on a phone the moment a rider picks the file.
    // An extent with no offset and no length describes nothing, so refusing is
    // also the honest answer rather than only the cheap one. Found by review.
    if (offsetSize === 0 && lengthSize === 0) return null

    for (let e = 0; e < extentCount; e++) {
      at += indexSize
      const offset = readSizedUint(view, at, offsetSize, iloc.end)
      if (offset === null) return null
      at += offsetSize
      const length = readSizedUint(view, at, lengthSize, iloc.end)
      if (length === null) return null
      at += lengthSize

      if (id === wantedId && e === 0) {
        if (constructionMethod !== 0) return null
        if (length <= 0 || length > MAX_EXIF_PAYLOAD_BYTES) return null
        return { offset: base + offset, length }
      }
    }
  }
  return null
}

/**
 * The bytes `locateHeifExif` pointed at, as capture metadata.
 *
 * The payload is an `ExifDataBlock`: a 32-bit big-endian offset to the TIFF
 * header, then — at that offset — the identical structure a JPEG's APP1 segment
 * carries. In practice the offset is 6 and the six bytes it skips are the
 * `Exif\0\0` signature.
 *
 * **The fallback exists because that prefix is the one part encoders get
 * wrong.** Some write the payload with no length prefix at all, starting
 * straight at `Exif\0\0`. Trying the declared offset first and the signature
 * second is not guesswork: both candidates are confirmed by `readByteOrder`,
 * which refuses anything that is not `II`/`MM` followed by 42, so a wrong guess
 * yields no metadata rather than misread bytes.
 */
export function parseHeifExifPayload(buffer: ArrayBuffer): ExifCapture {
  try {
    const view = new DataView(buffer)
    if (view.byteLength < 4) return NOTHING

    // Tested on the VALUE rather than on identity with `NOTHING`: a valid TIFF
    // header carrying neither tag returns a fresh all-null object, and reading
    // that as "the declared offset was wrong" would send a legitimately bare
    // photo down the fallback for no reason.
    const declared = readCaptureFromTiff(view, 4 + view.getUint32(0, false))
    if (declared.takenAt !== null || declared.latitude !== null) return declared

    if (view.byteLength >= 6 && isExifSignature(view, 0)) {
      return readCaptureFromTiff(view, 6)
    }
    return declared
  } catch {
    return NOTHING
  }
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

  // **The minutes field needs its own bound, and a range check on the total does
  // not supply one.** `+05:99` sums to 399, which is comfortably inside the real
  // world's -720..840 — so without this line a corrupt minutes field is accepted,
  // the stored offset is one no place on Earth uses, and the resolved instant is
  // 39 minutes from the camera's. That is the same shape as the defect this
  // whole function exists to close: a well-formed string reaching a value
  // nothing real produces.
  if (Number(minutes) > 59) return null

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
