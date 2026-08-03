import { describe, expect, it } from 'vitest'
import { MAX_INPUT_BYTES, validateImageFile } from '@/lib/media/validate'

function fileOfSize(bytes: number, type = 'image/jpeg'): File {
  return new File([new Uint8Array(bytes)], 'photo.jpg', { type })
}

describe('validateImageFile', () => {
  it('accepts an ordinary jpeg', () => {
    expect(validateImageFile(fileOfSize(1024)).ok).toBe(true)
  })

  it('accepts a png or webp too — compress.ts re-encodes to jpeg regardless of input', () => {
    expect(validateImageFile(fileOfSize(1024, 'image/png')).ok).toBe(true)
    expect(validateImageFile(fileOfSize(1024, 'image/webp')).ok).toBe(true)
  })

  it('accepts a blank type — some mobile browsers leave it blank for camera captures', () => {
    expect(validateImageFile(fileOfSize(1024, '')).ok).toBe(true)
  })

  it('rejects a non-image type', () => {
    const result = validateImageFile(fileOfSize(1024, 'application/pdf'))
    expect(result.ok).toBe(false)
  })

  it('rejects an empty file', () => {
    const result = validateImageFile(fileOfSize(0))
    expect(result.ok).toBe(false)
  })

  it('accepts a file right at the size ceiling', () => {
    expect(validateImageFile(fileOfSize(MAX_INPUT_BYTES)).ok).toBe(true)
  })

  it('rejects a file over the size ceiling', () => {
    const result = validateImageFile(fileOfSize(MAX_INPUT_BYTES + 1))
    expect(result.ok).toBe(false)
  })
})
