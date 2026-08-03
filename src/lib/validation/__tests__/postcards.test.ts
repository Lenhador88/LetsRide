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
      expect(result.data).toEqual({ imagePath: VALID_PATH, caption: null, clubId: null })
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
