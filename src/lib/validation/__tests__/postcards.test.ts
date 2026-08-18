import { describe, expect, it } from 'vitest'
import {
  POSTCARD_CAPTION_MAX_LENGTH,
  createPostcardSchema,
  postcardCaptionSchema,
  postcardClubIdSchema,
  postcardImagePathSchema,
} from '@/lib/validation/postcards'

const VALID_PATH = 'postcards/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.jpg'
const VALID_CLUB_ID = crypto.randomUUID()

describe('postcardImagePathSchema', () => {
  it('accepts the exact shape migration 010 requires', () => {
    expect(postcardImagePathSchema.safeParse(VALID_PATH).success).toBe(true)
  })

  it('rejects a URL — matches postcards_image_path_is_a_storage_path (009)', () => {
    expect(postcardImagePathSchema.safeParse('https://example.com/a.jpg').success).toBe(false)
  })

  it('rejects a human-readable path without a real uuid folder', () => {
    expect(postcardImagePathSchema.safeParse('postcards/000a/dawn.jpg').success).toBe(false)
  })

  it('rejects a non-jpg extension', () => {
    expect(
      postcardImagePathSchema.safeParse(
        'postcards/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.png'
      ).success
    ).toBe(false)
  })
})

describe('postcardCaptionSchema', () => {
  it('trims surrounding whitespace', () => {
    const result = postcardCaptionSchema.safeParse('  Sunrise on the N222  ')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('Sunrise on the N222')
  })

  it('turns null into null (no caption)', () => {
    const result = postcardCaptionSchema.safeParse(null)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBeNull()
  })

  it('turns an empty string into null rather than keeping ""', () => {
    const result = postcardCaptionSchema.safeParse('')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBeNull()
  })

  it(`rejects more than ${POSTCARD_CAPTION_MAX_LENGTH} characters, mirroring postcards_caption_length (009)`, () => {
    expect(postcardCaptionSchema.safeParse('x'.repeat(POSTCARD_CAPTION_MAX_LENGTH + 1)).success).toBe(false)
  })

  it(`accepts exactly ${POSTCARD_CAPTION_MAX_LENGTH} characters`, () => {
    expect(postcardCaptionSchema.safeParse('x'.repeat(POSTCARD_CAPTION_MAX_LENGTH)).success).toBe(true)
  })
})

describe('postcardClubIdSchema', () => {
  it('turns an empty string ("post to the app-wide feed") into null', () => {
    const result = postcardClubIdSchema.safeParse('')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBeNull()
  })

  it('turns null into null', () => {
    const result = postcardClubIdSchema.safeParse(null)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBeNull()
  })

  it('accepts a real uuid', () => {
    const result = postcardClubIdSchema.safeParse(VALID_CLUB_ID)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe(VALID_CLUB_ID)
  })

  it('rejects a non-uuid, non-empty value — shape only, membership is 009\'s job', () => {
    expect(postcardClubIdSchema.safeParse('some-club-slug').success).toBe(false)
  })
})

describe('createPostcardSchema', () => {
  it('accepts a well-formed submission with no caption and no club (app-wide feed)', () => {
    const result = createPostcardSchema.safeParse({ imagePath: VALID_PATH, caption: null, clubId: '' })
    expect(result.success).toBe(true)
    if (result.success) {
      // Exact rather than a subset, and it stays exact: this is the assertion
      // that makes a field silently added to the schema — and therefore to the
      // INSERT in createPostcard — a deliberate edit to a test. `064`'s five
      // capture fields all default to null, which is the shape a photo with no
      // EXIF produces and the one most postcards will have.
      expect(result.data).toEqual({
        imagePath: VALID_PATH,
        caption: null,
        clubId: null,
        takenAt: null,
        takenAtOffsetMinutes: null,
        takenLatitude: null,
        takenLongitude: null,
        takenLocationPrecision: null,
      })
    }
  })

  it('accepts a caption and a club id together', () => {
    const result = createPostcardSchema.safeParse({
      imagePath: VALID_PATH,
      caption: 'Club ride!',
      clubId: VALID_CLUB_ID,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a malformed imagePath even when caption/clubId are fine', () => {
    const result = createPostcardSchema.safeParse({
      imagePath: 'not/a/valid/path.jpg',
      caption: null,
      clubId: '',
    })
    expect(result.success).toBe(false)
  })
})


/**
 * The capture fields (PD-255, `064`).
 *
 * These mirror CHECK constraints rather than replacing them — the app is
 * client-rendered, so this schema runs in the rider's own browser and a patched
 * client never executes it. What is asserted here is that an HONEST client fails
 * readably, and that the shapes the composer actually produces are accepted.
 * `supabase/tests/rls_test.sql` §064 is where the same rules are asserted
 * against something a rider cannot skip.
 */
describe('createPostcardSchema — capture time and place', () => {
  const base = { imagePath: VALID_PATH, caption: null, clubId: '' }
  const anHourAgo = new Date(Date.now() - 3600_000).toISOString()

  it('accepts a postcard with no capture metadata at all — the common case', () => {
    const result = createPostcardSchema.safeParse(base)
    expect(result.success).toBe(true)
  })

  it('treats an empty hidden input as absent rather than as a value', () => {
    const result = createPostcardSchema.safeParse({
      ...base,
      takenAt: '',
      takenAtOffsetMinutes: '',
      takenLatitude: '',
      takenLongitude: '',
      takenLocationPrecision: '',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.takenAt).toBeNull()
  })

  it('accepts a capture time with its offset', () => {
    const result = createPostcardSchema.safeParse({
      ...base,
      takenAt: anHourAgo,
      takenAtOffsetMinutes: '120',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.takenAtOffsetMinutes).toBe(120)
  })

  it('rejects a capture time in the future — it is the ride Journal sort key', () => {
    const result = createPostcardSchema.safeParse({
      ...base,
      takenAt: new Date(Date.now() + 86_400_000).toISOString(),
      takenAtOffsetMinutes: '0',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a capture time before DateTimeOriginal existed', () => {
    const result = createPostcardSchema.safeParse({
      ...base,
      takenAt: '1970-01-01T00:00:00.000Z',
      takenAtOffsetMinutes: '0',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a capture time with no offset — its wall clock would be unrecoverable', () => {
    const result = createPostcardSchema.safeParse({ ...base, takenAt: anHourAgo })
    expect(result.success).toBe(false)
  })

  it('rejects an offset with no capture time', () => {
    const result = createPostcardSchema.safeParse({ ...base, takenAtOffsetMinutes: '120' })
    expect(result.success).toBe(false)
  })

  it('accepts a rounded region location', () => {
    const result = createPostcardSchema.safeParse({
      ...base,
      takenLatitude: '52.37',
      takenLongitude: '4.9',
      takenLocationPrecision: 'region',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.takenLatitude).toBe(52.37)
  })

  it('rejects a precise coordinate wearing a region marker', () => {
    const result = createPostcardSchema.safeParse({
      ...base,
      takenLatitude: '52.370216',
      takenLongitude: '4.895168',
      takenLocationPrecision: 'region',
    })
    expect(result.success).toBe(false)
  })

  it('accepts the same coordinate as precise — the marker is what says which rule applies', () => {
    const result = createPostcardSchema.safeParse({
      ...base,
      takenLatitude: '52.370216',
      takenLongitude: '4.895168',
      takenLocationPrecision: 'precise',
    })
    expect(result.success).toBe(true)
  })

  it.each([
    ['a latitude with no longitude', { takenLatitude: '52.37', takenLocationPrecision: 'precise' }],
    ['a coordinate with no marker', { takenLatitude: '52.37', takenLongitude: '4.9' }],
    ['a marker with no coordinate', { takenLocationPrecision: 'precise' }],
  ])('rejects %s', (_label, fields) => {
    expect(createPostcardSchema.safeParse({ ...base, ...fields }).success).toBe(false)
  })

  it.each([
    ['latitude', { takenLatitude: '95', takenLongitude: '4.9', takenLocationPrecision: 'precise' }],
    ['longitude', { takenLatitude: '52.37', takenLongitude: '195', takenLocationPrecision: 'precise' }],
  ])('rejects an out-of-range %s', (_label, fields) => {
    expect(createPostcardSchema.safeParse({ ...base, ...fields }).success).toBe(false)
  })

  it('rejects a precision marker the composer cannot produce', () => {
    const result = createPostcardSchema.safeParse({
      ...base,
      takenLatitude: '52.37',
      takenLongitude: '4.9',
      takenLocationPrecision: 'approximate',
    })
    expect(result.success).toBe(false)
  })
})
