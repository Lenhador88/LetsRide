import { describe, expect, it } from 'vitest'
import { parseExifCapture } from '../exif'

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

/** Amsterdam is UTC+2 in August, so 12:15 wall-clock is 10:15Z. */
const AUGUST_NOON = '2026:08:10 12:15:30'

describe('parseExifCapture — capture time', () => {
  it('reads DateTimeOriginal as APP_TIME_ZONE wall-clock when the camera wrote no offset', () => {
    const result = parseExifCapture(buildJpeg({ dateTimeOriginal: AUGUST_NOON }))
    expect(result.takenAt).toBe('2026-08-10T10:15:30.000Z')
  })

  it('prefers OffsetTimeOriginal over the app zone when the camera wrote one', () => {
    const result = parseExifCapture(
      buildJpeg({ dateTimeOriginal: AUGUST_NOON, offsetTimeOriginal: '-05:00' })
    )
    expect(result.takenAt).toBe('2026-08-10T17:15:30.000Z')
  })

  it('ignores a malformed offset rather than failing the whole read', () => {
    const result = parseExifCapture(
      buildJpeg({ dateTimeOriginal: AUGUST_NOON, offsetTimeOriginal: 'nonsense' })
    )
    expect(result.takenAt).toBe('2026-08-10T10:15:30.000Z')
  })

  it('resolves a winter capture against the winter offset, not a fixed one', () => {
    const result = parseExifCapture(buildJpeg({ dateTimeOriginal: '2026:01:10 12:15:30' }))
    expect(result.takenAt).toBe('2026-01-10T11:15:30.000Z')
  })

  it('reads a big-endian (MM) TIFF header the same way', () => {
    const result = parseExifCapture(buildJpeg({ dateTimeOriginal: AUGUST_NOON, bigEndian: true }))
    expect(result.takenAt).toBe('2026-08-10T10:15:30.000Z')
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
    const result = parseExifCapture(buildJpeg({ dateTimeOriginal: AUGUST_NOON, gps: AMSTERDAM }))
    expect(result.takenAt).toBe('2026-08-10T10:15:30.000Z')
    expect(result.latitude).toBeCloseTo(52.37, 5)
  })
})

describe('parseExifCapture — files it must not choke on', () => {
  it('finds the Exif APP1 behind an XMP APP1 rather than parsing the first one it sees', () => {
    const result = parseExifCapture(buildJpeg({ dateTimeOriginal: AUGUST_NOON, xmpFirst: true }))
    expect(result.takenAt).toBe('2026-08-10T10:15:30.000Z')
  })

  it('returns nothing for a JPEG with no Exif segment at all', () => {
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]).buffer
    expect(parseExifCapture(bare)).toEqual({ takenAt: null, latitude: null, longitude: null })
  })

  it('returns nothing for a file that is not a JPEG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer
    expect(parseExifCapture(png)).toEqual({ takenAt: null, latitude: null, longitude: null })
  })

  it('returns nothing for an empty buffer', () => {
    expect(parseExifCapture(new ArrayBuffer(0))).toEqual({
      takenAt: null,
      latitude: null,
      longitude: null,
    })
  })

  it('returns nothing for a truncated Exif segment instead of throwing', () => {
    const full = new Uint8Array(buildJpeg({ dateTimeOriginal: AUGUST_NOON, gps: AMSTERDAM }))
    const truncated = full.slice(0, 24).buffer
    expect(parseExifCapture(truncated)).toEqual({ takenAt: null, latitude: null, longitude: null })
  })

  it('returns nothing when the TIFF magic is wrong', () => {
    const full = new Uint8Array(buildJpeg({ dateTimeOriginal: AUGUST_NOON }))
    // The magic sits two bytes into the TIFF header: SOI(2) + APP1 marker and
    // length(4) + "Exif\0\0"(6) + byte order(2).
    full[14] = 0x00
    full[15] = 0x00
    expect(parseExifCapture(full.buffer)).toEqual({
      takenAt: null,
      latitude: null,
      longitude: null,
    })
  })
})
