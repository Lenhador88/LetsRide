import { describe, expect, it } from 'vitest'
import { locateHeifExif, parseExifCapture, parseHeifExifPayload } from '../exif'

/**
 * The fixtures are **built**, not committed as binaries.
 *
 * A checked-in .jpg would make every one of these assertions depend on a file
 * nobody can read in a diff — and the cases that matter here are the malformed
 * ones (a blank date, a missing hemisphere ref, an XMP segment ahead of the Exif
 * one), which are exactly the fixtures nobody can produce with a camera. The
 * builder below writes real EXIF: a JPEG SOI, an APP1 carrying the `Exif\0\0`
 * signature, a TIFF header in either byte order, and IFD0 → Exif/GPS sub-IFDs
 * with correct inline-vs-offset value placement.
 */

/** What every "this photo tells us nothing" assertion below compares against. */
const NOTHING = {
  takenAt: null,
  takenAtOffsetMinutes: null,
  latitude: null,
  longitude: null,
}

type Rational = [numerator: number, denominator: number]

type ExifFixture = {
  dateTimeOriginal?: string
  offsetTimeOriginal?: string
  gps?: { latRef: string; lat: Rational[]; lonRef: string; lon: Rational[] }
  bigEndian?: boolean
  /** An extra APP1 ahead of the Exif one, as phones writing XMP produce. */
  xmpFirst?: boolean
}

const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825
const TAG_DATE_TIME_ORIGINAL = 0x9003
const TAG_OFFSET_TIME_ORIGINAL = 0x9011

function buildTiff(fixture: ExifFixture): Uint8Array {
  const little = !fixture.bigEndian
  const bytes = new Uint8Array(2048)
  const view = new DataView(bytes.buffer)

  const hasTime = fixture.dateTimeOriginal !== undefined
  const hasOffset = fixture.offsetTimeOriginal !== undefined
  const hasGps = fixture.gps !== undefined

  const exifEntryCount = (hasTime ? 1 : 0) + (hasOffset ? 1 : 0)
  const exifIfdSize = 2 + exifEntryCount * 12 + 4
  const gpsIfdSize = 2 + 4 * 12 + 4
  const ifd0EntryCount = (exifEntryCount > 0 ? 1 : 0) + (hasGps ? 1 : 0)
  const ifd0Size = 2 + ifd0EntryCount * 12 + 4

  const exifIfdAt = 8 + ifd0Size
  const gpsIfdAt = exifIfdAt + (exifEntryCount > 0 ? exifIfdSize : 0)
  let dataAt = gpsIfdAt + (hasGps ? gpsIfdSize : 0)

  // --- TIFF header -----------------------------------------------------------
  view.setUint16(0, little ? 0x4949 : 0x4d4d, false)
  view.setUint16(2, 0x002a, little)
  view.setUint32(4, 8, little)

  const writeEntry = (at: number, tag: number, type: number, count: number, inline: (valueAt: number) => void) => {
    view.setUint16(at, tag, little)
    view.setUint16(at + 2, type, little)
    view.setUint32(at + 4, count, little)
    inline(at + 8)
  }

  const writeAscii = (at: number, tag: number, text: string): number => {
    const withNul = `${text}\0`
    if (withNul.length <= 4) {
      writeEntry(at, tag, 2, withNul.length, (valueAt) => {
        for (let i = 0; i < withNul.length; i++) view.setUint8(valueAt + i, withNul.charCodeAt(i))
      })
      return 0
    }
    writeEntry(at, tag, 2, withNul.length, (valueAt) => view.setUint32(valueAt, dataAt, little))
    for (let i = 0; i < withNul.length; i++) view.setUint8(dataAt + i, withNul.charCodeAt(i))
    dataAt += withNul.length
    return withNul.length
  }

  const writeRationals = (at: number, tag: number, values: Rational[]) => {
    writeEntry(at, tag, 5, values.length, (valueAt) => view.setUint32(valueAt, dataAt, little))
    values.forEach(([numerator, denominator], i) => {
      view.setUint32(dataAt + i * 8, numerator, little)
      view.setUint32(dataAt + i * 8 + 4, denominator, little)
    })
    dataAt += values.length * 8
  }

  // --- IFD0: the two sub-IFD pointers ----------------------------------------
  view.setUint16(8, ifd0EntryCount, little)
  let entryAt = 10
  if (exifEntryCount > 0) {
    writeEntry(entryAt, TAG_EXIF_IFD, 4, 1, (valueAt) => view.setUint32(valueAt, exifIfdAt, little))
    entryAt += 12
  }
  if (hasGps) {
    writeEntry(entryAt, TAG_GPS_IFD, 4, 1, (valueAt) => view.setUint32(valueAt, gpsIfdAt, little))
    entryAt += 12
  }
  view.setUint32(entryAt, 0, little)

  // --- Exif sub-IFD ----------------------------------------------------------
  if (exifEntryCount > 0) {
    view.setUint16(exifIfdAt, exifEntryCount, little)
    let at = exifIfdAt + 2
    if (hasTime) {
      writeAscii(at, TAG_DATE_TIME_ORIGINAL, fixture.dateTimeOriginal!)
      at += 12
    }
    if (hasOffset) {
      writeAscii(at, TAG_OFFSET_TIME_ORIGINAL, fixture.offsetTimeOriginal!)
      at += 12
    }
    view.setUint32(at, 0, little)
  }

  // --- GPS sub-IFD -----------------------------------------------------------
  if (hasGps) {
    const { latRef, lat, lonRef, lon } = fixture.gps!
    view.setUint16(gpsIfdAt, 4, little)
    writeAscii(gpsIfdAt + 2, 0x0001, latRef)
    writeRationals(gpsIfdAt + 14, 0x0002, lat)
    writeAscii(gpsIfdAt + 26, 0x0003, lonRef)
    writeRationals(gpsIfdAt + 38, 0x0004, lon)
    view.setUint32(gpsIfdAt + 50, 0, little)
  }

  return bytes.slice(0, dataAt)
}

function buildJpeg(fixture: ExifFixture): ArrayBuffer {
  const tiff = buildTiff(fixture)
  const chunks: number[] = [0xff, 0xd8]

  if (fixture.xmpFirst) {
    const xmp = 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'
    const length = 2 + xmp.length
    chunks.push(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff)
    for (const char of xmp) chunks.push(char.charCodeAt(0))
  }

  const exifLength = 2 + 6 + tiff.length
  chunks.push(0xff, 0xe1, (exifLength >> 8) & 0xff, exifLength & 0xff)
  for (const char of 'Exif') chunks.push(char.charCodeAt(0))
  chunks.push(0, 0)
  for (const byte of tiff) chunks.push(byte)

  chunks.push(0xff, 0xda, 0x00, 0x02) // SOS — nothing to find beyond here

  return new Uint8Array(chunks).buffer
}

const AUGUST_NOON = '2026:08:10 12:15:30'

/**
 * **`vitest.config.ts` pins `TZ=UTC`, and under it a device-zone fallback and a
 * hardcoded `Date.UTC` are indistinguishable** — the same trap `wallClockToUtc`'s
 * own tests record, where a naive implementation passes because the only zone
 * the suite ever runs in has a zero offset.
 *
 * Node re-reads `process.env.TZ` between `Date` constructions, so these tests
 * set a real zone with a real DST rule and assert the *offset*, which is the
 * thing that would silently be zero.
 */
function inZone<T>(zone: string, run: () => T): T {
  const original = process.env.TZ
  process.env.TZ = zone
  try {
    return run()
  } finally {
    process.env.TZ = original
  }
}

/** Wall-clock parts for an instant a minute ago, in whatever zone is current. */
function aMinuteAgoLocal(): string {
  const when = new Date(Date.now() - 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${when.getFullYear()}:${pad(when.getMonth() + 1)}:${pad(when.getDate())} ` +
    `${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`
  )
}

describe('parseExifCapture — capture time', () => {
  it('resolves a zone-less DateTimeOriginal against the device zone, and reports the offset it used', () => {
    const result = inZone('Europe/Helsinki', () =>
      parseExifCapture(buildJpeg({ dateTimeOriginal: AUGUST_NOON }))
    )
    expect(result.takenAt).toBe('2026-08-10T09:15:30.000Z')
    expect(result.takenAtOffsetMinutes).toBe(180)
  })

  it('uses the offset in force on the capture DATE, not a constant — a January photo is not a July one', () => {
    const result = inZone('Europe/Helsinki', () =>
      parseExifCapture(buildJpeg({ dateTimeOriginal: '2026:01:10 12:15:30' }))
    )
    expect(result.takenAt).toBe('2026-01-10T10:15:30.000Z')
    expect(result.takenAtOffsetMinutes).toBe(120)
  })

  it('reports a zero offset in UTC rather than omitting it', () => {
    const result = inZone('UTC', () => parseExifCapture(buildJpeg({ dateTimeOriginal: AUGUST_NOON })))
    expect(result.takenAt).toBe('2026-08-10T12:15:30.000Z')
    expect(result.takenAtOffsetMinutes).toBe(0)
  })

  it('handles a zone behind UTC', () => {
    const result = inZone('America/New_York', () =>
      parseExifCapture(buildJpeg({ dateTimeOriginal: AUGUST_NOON }))
    )
    expect(result.takenAt).toBe('2026-08-10T16:15:30.000Z')
    expect(result.takenAtOffsetMinutes).toBe(-240)
  })

  it('prefers OffsetTimeOriginal over the device zone when the camera wrote one', () => {
    const result = inZone('Europe/Helsinki', () =>
      parseExifCapture(buildJpeg({ dateTimeOriginal: AUGUST_NOON, offsetTimeOriginal: '-05:00' }))
    )
    expect(result.takenAt).toBe('2026-08-10T17:15:30.000Z')
    expect(result.takenAtOffsetMinutes).toBe(-300)
  })

  it('falls back to the device zone when the offset tag is malformed', () => {
    const result = inZone('Europe/Helsinki', () =>
      parseExifCapture(buildJpeg({ dateTimeOriginal: AUGUST_NOON, offsetTimeOriginal: 'nonsense' }))
    )
    expect(result.takenAt).toBe('2026-08-10T09:15:30.000Z')
    expect(result.takenAtOffsetMinutes).toBe(180)
  })

  /**
   * The regression this whole shape exists for. Resolving a zone-less wall clock
   * against `APP_TIME_ZONE` puts a rider east of Amsterdam in the FUTURE — a
   * Helsinki photo taken a minute ago reads as 59 minutes from now — and the
   * clamp below then drops it. The result was a capture time silently NULL for a
   * whole region, at exactly the moment people post.
   */
  it('keeps a photo taken a minute ago in a zone ahead of Amsterdam', () => {
    const result = inZone('Europe/Helsinki', () =>
      parseExifCapture(buildJpeg({ dateTimeOriginal: aMinuteAgoLocal() }))
    )
    expect(result.takenAt).not.toBeNull()
    expect(result.takenAtOffsetMinutes).toBe(180)
  })

  it('reads a big-endian (MM) TIFF header the same way', () => {
    const result = inZone('UTC', () =>
      parseExifCapture(buildJpeg({ dateTimeOriginal: AUGUST_NOON, bigEndian: true }))
    )
    expect(result.takenAt).toBe('2026-08-10T12:15:30.000Z')
  })

  it('returns null for the blank placeholder cameras write for "unset"', () => {
    const result = parseExifCapture(buildJpeg({ dateTimeOriginal: '    :  :     :  :  ' }))
    expect(result.takenAt).toBeNull()
  })

  it('returns null when the tag is absent altogether', () => {
    const result = parseExifCapture(buildJpeg({ gps: AMSTERDAM }))
    expect(result.takenAt).toBeNull()
  })
})

describe('parseExifCapture — a corrupt OffsetTimeOriginal', () => {
  /**
   * The defect this block exists for, found in review. `OffsetTimeOriginal` is
   * two digits of hours, so `+99:59` is **well-formed** and reaches ±5999
   * minutes. It used to be sent as-is: `createPostcard`'s Zod bound (mirroring
   * `064`'s CHECK at ±1440) then refused the post with "Too big: expected number
   * to be <=1440" — against a form with no field that produced it and no field
   * that could fix it. Re-picking the same photo re-read the same bytes and
   * failed identically, so the photo could not be posted at all, and every
   * attempt orphaned a Storage object because the parse failure returns ahead of
   * `createPostcard`'s cleanup.
   *
   * A garbage offset now behaves exactly like an unparseable one — fall back to
   * the device. Asserting the FALLBACK rather than a null is the point: the wall
   * clock is still almost certainly right, so dropping the capture time would be
   * the wrong repair.
   */
  it.each(['+25:00', '+99:59', '-99:59', '-12:01', '+14:01', '+05:99', '+00:99'])(
    'falls back to the device zone for %s rather than sending a value the schema will refuse',
    (offset) => {
      const result = inZone('Europe/Helsinki', () =>
        parseExifCapture(buildJpeg({ dateTimeOriginal: AUGUST_NOON, offsetTimeOriginal: offset }))
      )
      expect(result.takenAt).toBe('2026-08-10T09:15:30.000Z')
      expect(result.takenAtOffsetMinutes).toBe(180)
    }
  )

  // The edges themselves, against the rejections one MINUTE outside them above.
  // An hour outside would leave the bound free to drift by 59 minutes with every
  // assertion in this file still green.
  it.each(['-12:00', '+14:00'])('still accepts %s — the real world reaches both ends', (offset) => {
    const result = parseExifCapture(
      buildJpeg({ dateTimeOriginal: AUGUST_NOON, offsetTimeOriginal: offset })
    )
    const expected = offset === '-12:00' ? -720 : 840
    expect(result.takenAtOffsetMinutes).toBe(expected)
  })

  it('never emits an offset the database CHECK would refuse, on any offset string', () => {
    // The property, rather than the examples above: whatever comes out is inside
    // `064`'s bound. This is the assertion that survives someone widening the
    // accepted range for a reason.
    //
    // **Run in a real zone, not the suite's `TZ=UTC`.** Every case that falls
    // back would otherwise assert `Math.abs(0) <= 1440` and carry no
    // information — a fallback that started returning a wrong non-zero value
    // would pass. Under Helsinki the fallback is 180, so every case is live.
    inZone('Europe/Helsinki', () => {
      for (const hours of ['00', '05', '12', '13', '14', '15', '23', '99']) {
        for (const minutes of ['00', '30', '59', '99']) {
          for (const sign of ['+', '-']) {
            const { takenAtOffsetMinutes } = parseExifCapture(
              buildJpeg({
                dateTimeOriginal: AUGUST_NOON,
                offsetTimeOriginal: `${sign}${hours}:${minutes}`,
              })
            )
            expect(takenAtOffsetMinutes).not.toBeNull()
            expect(Math.abs(takenAtOffsetMinutes!)).toBeLessThanOrEqual(1440)
            // Tighter than the CHECK, and it would catch a widened *total*
            // bound.
            //
            // **It does NOT catch a corrupt minutes field, and an earlier
            // version of this comment claimed it did.** Delete
            // `Number(minutes) > 59` from `exif.ts` and this loop still passes:
            // `+05:99` sums to 399, which is inside −720..840, so the unguarded
            // value satisfies every assertion here. Mutation-tested rather than
            // reasoned about.
            //
            // **What actually pins that fix is `'+05:99'` and `'+00:99'` in the
            // rejection list above** — the same mutation fails there and only
            // there. Do not prune them as "already covered by the property
            // test"; they are the only regression guard on the minutes bound.
            //
            // Nor is "every offset this parser emits is one a real place uses"
            // true: `+05:17` → 317 passes, and no current zone is off a
            // 15-minute multiple. That is benign — both the schema and the
            // CHECK accept it, so no rider is ever stranded by it — which is
            // why the bound stops at the range rather than testing for
            // realness.
            expect(takenAtOffsetMinutes!).toBeGreaterThanOrEqual(-720)
            expect(takenAtOffsetMinutes!).toBeLessThanOrEqual(840)
          }
        }
      }
    })
  })
})

describe('parseExifCapture — the clamp', () => {
  it('drops a capture time in the future rather than letting the CHECK refuse the post', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp =
      `${tomorrow.getFullYear()}:${pad(tomorrow.getMonth() + 1)}:${pad(tomorrow.getDate())} ` +
      `${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}:${pad(tomorrow.getSeconds())}`
    expect(parseExifCapture(buildJpeg({ dateTimeOriginal: stamp })).takenAt).toBeNull()
  })

  it.each([
    ['the epoch-0 placeholder', '1970:01:01 00:00:00'],
    ['the 1904 Mac epoch', '1904:01:01 00:00:00'],
    ['the day before the floor', '1994:12:31 23:59:59'],
  ])('drops %s — a 1900 floor would have admitted all three', (_label, stamp) => {
    expect(parseExifCapture(buildJpeg({ dateTimeOriginal: stamp })).takenAt).toBeNull()
  })

  it('keeps a date after the floor', () => {
    expect(parseExifCapture(buildJpeg({ dateTimeOriginal: '1996:06:01 12:00:00' })).takenAt).not.toBeNull()
  })

  it('drops the instant and its offset TOGETHER — the database CHECK refuses a half pair', () => {
    const dropped = parseExifCapture(buildJpeg({ dateTimeOriginal: '1970:01:01 00:00:00' }))
    expect(dropped.takenAt).toBeNull()
    expect(dropped.takenAtOffsetMinutes).toBeNull()
  })

  it('never reports an offset without an instant, on any fixture in this file', () => {
    const fixtures = [
      buildJpeg({}),
      buildJpeg({ gps: AMSTERDAM }),
      buildJpeg({ dateTimeOriginal: '    :  :     :  :  ' }),
      buildJpeg({ dateTimeOriginal: '1970:01:01 00:00:00' }),
      buildJpeg({ dateTimeOriginal: AUGUST_NOON }),
    ]
    for (const fixture of fixtures) {
      const { takenAt, takenAtOffsetMinutes } = parseExifCapture(fixture)
      expect(takenAt === null).toBe(takenAtOffsetMinutes === null)
    }
  })
})

/** 52°22'12"N, 4°53'42"E — central Amsterdam. */
const AMSTERDAM = {
  latRef: 'N',
  lat: [[52, 1], [22, 1], [1200, 100]] as Rational[],
  lonRef: 'E',
  lon: [[4, 1], [53, 1], [4200, 100]] as Rational[],
}

describe('parseExifCapture — coordinates', () => {
  it('converts degrees/minutes/seconds to a signed decimal pair', () => {
    const { latitude, longitude } = parseExifCapture(buildJpeg({ gps: AMSTERDAM }))
    expect(latitude).toBeCloseTo(52.37, 5)
    expect(longitude).toBeCloseTo(4.895, 5)
  })

  it('negates the southern and western hemispheres', () => {
    const { latitude, longitude } = parseExifCapture(
      buildJpeg({ gps: { ...AMSTERDAM, latRef: 'S', lonRef: 'W' } })
    )
    expect(latitude).toBeCloseTo(-52.37, 5)
    expect(longitude).toBeCloseTo(-4.895, 5)
  })

  it('refuses a coordinate whose hemisphere ref is missing or unrecognised — guessing puts the photo in the wrong hemisphere', () => {
    const { latitude, longitude } = parseExifCapture(
      buildJpeg({ gps: { ...AMSTERDAM, latRef: 'X' } })
    )
    expect(latitude).toBeNull()
    expect(longitude).toBeNull()
  })

  it('drops both halves when only one resolves — a latitude alone is not a location', () => {
    const { latitude, longitude } = parseExifCapture(
      buildJpeg({ gps: { ...AMSTERDAM, lon: [[4, 0], [53, 1], [4200, 100]] } })
    )
    expect(latitude).toBeNull()
    expect(longitude).toBeNull()
  })

  it('treats 0,0 as no fix rather than a photo taken in the Gulf of Guinea', () => {
    const { latitude, longitude } = parseExifCapture(
      buildJpeg({
        gps: { latRef: 'N', lat: [[0, 1], [0, 1], [0, 1]], lonRef: 'E', lon: [[0, 1], [0, 1], [0, 1]] },
      })
    )
    expect(latitude).toBeNull()
    expect(longitude).toBeNull()
  })

  it('refuses an out-of-range magnitude', () => {
    const { latitude } = parseExifCapture(
      buildJpeg({ gps: { ...AMSTERDAM, lat: [[95, 1], [0, 1], [0, 1]] } })
    )
    expect(latitude).toBeNull()
  })

  it('reads both together when the photo carries both', () => {
    const result = inZone('UTC', () =>
      parseExifCapture(buildJpeg({ dateTimeOriginal: AUGUST_NOON, gps: AMSTERDAM }))
    )
    expect(result.takenAt).toBe('2026-08-10T12:15:30.000Z')
    expect(result.latitude).toBeCloseTo(52.37, 5)
  })
})

describe('parseExifCapture — files it must not choke on', () => {
  it('finds the Exif APP1 behind an XMP APP1 rather than parsing the first one it sees', () => {
    const result = inZone('UTC', () =>
      parseExifCapture(buildJpeg({ dateTimeOriginal: AUGUST_NOON, xmpFirst: true }))
    )
    expect(result.takenAt).toBe('2026-08-10T12:15:30.000Z')
  })

  it('returns nothing for a JPEG with no Exif segment at all', () => {
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]).buffer
    expect(parseExifCapture(bare)).toEqual(NOTHING)
  })

  it('returns nothing for a file that is not a JPEG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer
    expect(parseExifCapture(png)).toEqual(NOTHING)
  })

  it('returns nothing for an empty buffer', () => {
    expect(parseExifCapture(new ArrayBuffer(0))).toEqual(NOTHING)
  })

  it('returns nothing for a truncated Exif segment instead of throwing', () => {
    const full = new Uint8Array(buildJpeg({ dateTimeOriginal: AUGUST_NOON, gps: AMSTERDAM }))
    const truncated = full.slice(0, 24).buffer
    expect(parseExifCapture(truncated)).toEqual(NOTHING)
  })

  it('survives a run of 0xFF padding at the very end of the buffer', () => {
    // The bounds check after the padding skip. Without it this reaches a
    // getUint16 with fewer than four bytes left; the outer try/catch would still
    // return NOTHING, so the assertion is that it does — and the check is what
    // makes that true by design rather than by rescue.
    const padded = new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xff, 0xff]).buffer
    expect(parseExifCapture(padded)).toEqual(NOTHING)
  })

  it('returns nothing when the TIFF magic is wrong', () => {
    const full = new Uint8Array(buildJpeg({ dateTimeOriginal: AUGUST_NOON }))
    // The magic sits two bytes into the TIFF header: SOI(2) + APP1 marker and
    // length(4) + "Exif\0\0"(6) + byte order(2).
    full[14] = 0x00
    full[15] = 0x00
    expect(parseExifCapture(full.buffer)).toEqual(NOTHING)
  })
})

/* -------------------------------------------------------------------------- */
/* HEIC / HEIF                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A minimal but **structurally real** HEIC: `ftyp`, a `meta` carrying `iinf`
 * and `iloc`, and an `mdat` holding the EXIF payload the `iloc` extent points
 * at. The same argument as the JPEG builder above — the cases that matter are
 * the malformed ones, and no camera produces those.
 *
 * The extent offset is COMPUTED from the box sizes rather than written by hand,
 * because an offset that happens to be right for one fixture and wrong for the
 * next is precisely the bug this whole path can have.
 */
function box(type: string, body: number[]): number[] {
  const size = 8 + body.length
  return [
    (size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...body,
  ]
}

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

type HeicOptions = {
  /** Omit the 4-byte `exif_tiff_header_offset`, as some encoders do. */
  noTiffHeaderOffset?: boolean
  /** `construction_method` 1 — the bytes are in an `idat`, not at a file offset. */
  idatConstruction?: boolean
  /** Declare an item type this parser is not looking for. */
  itemType?: string
  /** A brand outside the HEIF set. */
  majorBrand?: string
}

function buildHeic(fixture: ExifFixture, options: HeicOptions = {}): ArrayBuffer {
  const tiff = buildTiff(fixture)
  const payload = options.noTiffHeaderOffset
    ? [...ascii('Exif'), 0, 0, ...tiff]
    : [...u32(6), ...ascii('Exif'), 0, 0, ...tiff]

  // A non-HEIF major brand takes the compatible list with it: the parser accepts
  // a match anywhere in either, deliberately, so a fixture that overrode only
  // the major brand would still be a HEIF file and would prove nothing.
  const heif = options.majorBrand === undefined
  const ftyp = box('ftyp', [
    ...ascii(options.majorBrand ?? 'heic'),
    ...u32(0),
    ...ascii(heif ? 'mif1' : 'qt  '),
    ...ascii(heif ? 'heic' : 'isom'),
  ])

  // infe, FullBox version 2: item_ID (u16), protection index, item_type, name.
  const infe = box('infe', [
    2, 0, 0, 0,
    ...u16(1),
    ...u16(0),
    ...ascii(options.itemType ?? 'Exif'),
    0,
  ])
  const iinf = box('iinf', [0, 0, 0, 0, ...u16(1), ...infe])

  // iloc, FullBox version 1 so `construction_method` is present and testable.
  // offset_size 4, length_size 4, base_offset_size 0, index_size 0.
  const ilocSize = 8 + 4 + 1 + 1 + 2 + (2 + 2 + 2 + 2 + 4 + 4)
  const metaSize = 8 + 4 + iinf.length + ilocSize
  const payloadOffset = ftyp.length + metaSize + 8

  const iloc = box('iloc', [
    1, 0, 0, 0,
    0x44,
    0x00,
    ...u16(1),
    ...u16(1),
    ...u16(options.idatConstruction ? 1 : 0),
    ...u16(0),
    ...u16(1),
    ...u32(payloadOffset),
    ...u32(payload.length),
  ])
  expect(iloc.length).toBe(ilocSize)

  const meta = box('meta', [0, 0, 0, 0, ...iinf, ...iloc])
  expect(meta.length).toBe(metaSize)

  return new Uint8Array([...ftyp, ...meta, ...box('mdat', payload)]).buffer
}

/** What `readExifCapture` does across its two slices, without a `File`. */
function readHeic(buffer: ArrayBuffer): ReturnType<typeof parseExifCapture> {
  const extent = locateHeifExif(buffer)
  if (!extent) return NOTHING
  return parseHeifExifPayload(buffer.slice(extent.offset, extent.offset + extent.length))
}

describe('locateHeifExif', () => {
  it('points at the EXIF payload inside mdat, not at the box that describes it', () => {
    const heic = buildHeic({ dateTimeOriginal: AUGUST_NOON })
    const extent = locateHeifExif(heic)!
    expect(extent).not.toBeNull()

    // The four bytes at the extent are the ExifDataBlock's header offset, and
    // the six after them are the signature — proof it landed on the payload
    // rather than a plausible-looking offset elsewhere in the file.
    const view = new DataView(heic, extent.offset, extent.length)
    expect(view.getUint32(0, false)).toBe(6)
    expect(String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7))).toBe('Exif')
  })

  it('returns null for a JPEG, so it is safe to try before the JPEG path', () => {
    expect(locateHeifExif(buildJpeg({ dateTimeOriginal: AUGUST_NOON }))).toBeNull()
  })

  it('returns null for an ISOBMFF file that is not a HEIF still image', () => {
    // A .mov is the same box structure; it must not be walked for image items.
    expect(locateHeifExif(buildHeic({}, { majorBrand: 'qt  ' }))).toBeNull()
  })

  it('accepts a HEIF brand found only in the COMPATIBLE list, not just the major one', () => {
    // Encoders disagree about which brand goes first, so a match anywhere in
    // `ftyp` counts. This is the positive case for the negative above.
    const heic = buildHeic({ dateTimeOriginal: AUGUST_NOON })
    const bytes = new Uint8Array(heic)
    bytes.set([...'mp41'].map((c) => c.charCodeAt(0)), 8) // major_brand -> mp41
    expect(locateHeifExif(bytes.buffer)).not.toBeNull()
  })

  it('returns null when no item is of type Exif', () => {
    expect(locateHeifExif(buildHeic({}, { itemType: 'hvc1' }))).toBeNull()
  })

  it('refuses a construction method other than a file offset rather than guessing one', () => {
    expect(locateHeifExif(buildHeic({}, { idatConstruction: true }))).toBeNull()
  })

  it('returns null for an empty buffer and for truncated boxes instead of throwing', () => {
    expect(locateHeifExif(new ArrayBuffer(0))).toBeNull()
    const heic = buildHeic({ dateTimeOriginal: AUGUST_NOON })
    expect(locateHeifExif(heic.slice(0, 20))).toBeNull()
    expect(locateHeifExif(heic.slice(0, 60))).toBeNull()
  })
})

describe('readExifCapture — HEIC, the format an iPad shoots', () => {
  it('reads a capture time out of a HEIC exactly as it does out of a JPEG', () => {
    const heic = readHeic(buildHeic({ dateTimeOriginal: AUGUST_NOON, offsetTimeOriginal: '+02:00' }))
    const jpeg = parseExifCapture(buildJpeg({ dateTimeOriginal: AUGUST_NOON, offsetTimeOriginal: '+02:00' }))
    expect(heic).toEqual(jpeg)
    expect(heic.takenAt).toBe('2026-08-10T10:15:30.000Z')
    expect(heic.takenAtOffsetMinutes).toBe(120)
  })

  it('reads coordinates out of a HEIC — the half that brings Precise back', () => {
    const { latitude, longitude } = readHeic(buildHeic({ gps: AMSTERDAM }))
    expect(latitude).toBeCloseTo(52.37, 5)
    expect(longitude).toBeCloseTo(4.895, 5)
  })

  it('reads a big-endian TIFF inside a HEIC', () => {
    const { takenAt } = readHeic(buildHeic({ dateTimeOriginal: AUGUST_NOON, offsetTimeOriginal: '+02:00', bigEndian: true }))
    expect(takenAt).toBe('2026-08-10T10:15:30.000Z')
  })

  it('reads a payload written with no header offset, straight from the signature', () => {
    const { takenAt } = readHeic(
      buildHeic({ dateTimeOriginal: AUGUST_NOON, offsetTimeOriginal: '+02:00' }, { noTiffHeaderOffset: true })
    )
    expect(takenAt).toBe('2026-08-10T10:15:30.000Z')
  })
})

describe('parseHeifExifPayload — payloads it must not choke on', () => {
  it('returns nothing for a payload shorter than its own header', () => {
    expect(parseHeifExifPayload(new ArrayBuffer(0))).toEqual(NOTHING)
    expect(parseHeifExifPayload(new ArrayBuffer(3))).toEqual(NOTHING)
  })

  it('returns nothing for a header offset that points past the payload', () => {
    const payload = new Uint8Array([...u32(0xffffff), ...ascii('Exif'), 0, 0, 0x49, 0x49, 0x2a, 0x00])
    expect(parseHeifExifPayload(payload.buffer)).toEqual(NOTHING)
  })

  it('returns nothing when the TIFF magic behind a valid offset is wrong', () => {
    const payload = new Uint8Array([...u32(6), ...ascii('Exif'), 0, 0, 0x00, 0x00, 0x00, 0x00])
    expect(parseHeifExifPayload(payload.buffer)).toEqual(NOTHING)
  })
})
