import { describe, expect, it } from 'vitest'
import { POSTCARD_IMAGE_PATH_RE, buildPostcardImagePath } from '@/lib/media/constants'

describe('buildPostcardImagePath', () => {
  it('produces a path matching POSTCARD_IMAGE_PATH_RE — the same shape migration 010 requires', () => {
    const path = buildPostcardImagePath('11111111-1111-1111-1111-111111111111')
    expect(POSTCARD_IMAGE_PATH_RE.test(path)).toBe(true)
  })

  it('nests the object under the given uploader id', () => {
    const path = buildPostcardImagePath('11111111-1111-1111-1111-111111111111')
    expect(path.startsWith('postcards/11111111-1111-1111-1111-111111111111/')).toBe(true)
  })

  it('always ends in .jpg — compress.ts never outputs anything else', () => {
    const path = buildPostcardImagePath('11111111-1111-1111-1111-111111111111')
    expect(path.endsWith('.jpg')).toBe(true)
  })

  it('generates a fresh object id on every call, so two uploads never collide', () => {
    const uid = '11111111-1111-1111-1111-111111111111'
    expect(buildPostcardImagePath(uid)).not.toBe(buildPostcardImagePath(uid))
  })

  it('accepts an explicit object id (used by tests that need a stable path)', () => {
    const path = buildPostcardImagePath(
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222'
    )
    expect(path).toBe(
      'postcards/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.jpg'
    )
  })
})

describe('POSTCARD_IMAGE_PATH_RE', () => {
  it('rejects a path with no folder segments', () => {
    expect(POSTCARD_IMAGE_PATH_RE.test('dawn.jpg')).toBe(false)
  })

  it('rejects a non-uuid uploader folder', () => {
    expect(POSTCARD_IMAGE_PATH_RE.test('postcards/not-a-uuid/22222222-2222-2222-2222-222222222222.jpg')).toBe(
      false
    )
  })

  it('rejects a non-jpg extension', () => {
    expect(
      POSTCARD_IMAGE_PATH_RE.test(
        'postcards/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.png'
      )
    ).toBe(false)
  })

  it('rejects a leading slash (the shape 009\'s check constraint also forbids)', () => {
    expect(
      POSTCARD_IMAGE_PATH_RE.test(
        '/postcards/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.jpg'
      )
    ).toBe(false)
  })

  it('rejects an extra path segment', () => {
    expect(
      POSTCARD_IMAGE_PATH_RE.test(
        'postcards/11111111-1111-1111-1111-111111111111/extra/22222222-2222-2222-2222-222222222222.jpg'
      )
    ).toBe(false)
  })
})
