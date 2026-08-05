import { describe, expect, it } from 'vitest'
import {
  AVATAR_IMAGE_PATH_RE,
  COVER_IMAGE_PATH_RE,
  POSTCARD_IMAGE_PATH_RE,
  buildAvatarPath,
  buildCoverPath,
  buildPostcardImagePath,
} from '@/lib/media/constants'

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

/**
 * The avatar and cover folders, added by 014. The value of these assertions is
 * not that a template string works — it is that the builder and the regex still
 * agree after `objectPathRe` and `buildObjectPath` were generalised to serve
 * three folders from one implementation. A shared helper turns three
 * independent shapes into one, which is worth exactly as much as the test that
 * pins it.
 *
 * They cannot check the SQL side. 014 states the same shape three more times —
 * two CHECK constraints and a Storage INSERT policy — and nothing verifies that
 * those agree with these. The RLS suite covers the constraints' behaviour;
 * keeping the literals in step is still a person's job.
 */
describe('buildAvatarPath / buildCoverPath', () => {
  const uid = '11111111-1111-1111-1111-111111111111'

  it('produce paths matching their own regexes — the shape 014 requires', () => {
    expect(AVATAR_IMAGE_PATH_RE.test(buildAvatarPath(uid))).toBe(true)
    expect(COVER_IMAGE_PATH_RE.test(buildCoverPath(uid))).toBe(true)
  })

  it('put the object inside the uploader’s own folder', () => {
    // 014's second CHECK binds the path to the row's own id, so a builder that
    // got this wrong would fail with 23514 at the database rather than here.
    expect(buildAvatarPath(uid).startsWith(`avatars/${uid}/`)).toBe(true)
    expect(buildCoverPath(uid).startsWith(`covers/${uid}/`)).toBe(true)
  })

  it('mint a fresh object id per call, so an upload never overwrites', () => {
    // 014 grants no UPDATE on storage.objects, exactly as 010 does not — there
    // is no upsert path, so a reused path would be a hard failure.
    expect(buildAvatarPath(uid)).not.toBe(buildAvatarPath(uid))
  })

  it('keep the three folders distinct, so one regex never accepts another’s path', () => {
    // The folders have separate Storage policies; a path accepted by the wrong
    // regex would be written to a column whose CHECK then refuses it.
    expect(AVATAR_IMAGE_PATH_RE.test(buildCoverPath(uid))).toBe(false)
    expect(COVER_IMAGE_PATH_RE.test(buildAvatarPath(uid))).toBe(false)
    expect(POSTCARD_IMAGE_PATH_RE.test(buildAvatarPath(uid))).toBe(false)
    expect(AVATAR_IMAGE_PATH_RE.test(buildPostcardImagePath(uid))).toBe(false)
  })
})
