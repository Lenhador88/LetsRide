import { describe, expect, it } from 'vitest'
import { DataReadError, unwrap, unwrapList } from '@/lib/data/unwrap'

describe('unwrapList', () => {
  it('returns the rows when the query succeeded', () => {
    expect(unwrapList({ data: [{ id: '1' }], error: null }, 'the feed')).toEqual([{ id: '1' }])
  })

  it('treats a genuinely empty result as empty, not as a failure', () => {
    expect(unwrapList({ data: [], error: null }, 'the feed')).toEqual([])
    expect(unwrapList({ data: null, error: null }, 'the feed')).toEqual([])
  })

  /**
   * The whole point. Before this, a failed query returned `[]` and the feed
   * rendered "No postcards yet" — the same screen a rider with no postcards
   * sees, with nothing in the logs to tell the two apart.
   */
  it('throws rather than returning an empty list when the query failed', () => {
    expect(() =>
      unwrapList({ data: null, error: { message: 'relation does not exist', code: '42P01' } }, 'the feed'),
    ).toThrow(DataReadError)
  })

  it('throws even when the driver also handed back rows', () => {
    expect(() =>
      unwrapList({ data: [{ id: '1' }], error: { message: 'partial failure' } }, 'the feed'),
    ).toThrow(DataReadError)
  })
})

describe('unwrap', () => {
  it('passes a row through', () => {
    expect(unwrap({ data: { id: '1' }, error: null }, 'your profile')).toEqual({ id: '1' })
  })

  it('keeps "not found" distinct from "could not ask"', () => {
    // No row and no error is a real answer — the caller decides what it means.
    expect(unwrap({ data: null, error: null }, 'that postcard')).toBeNull()
    expect(() => unwrap({ data: null, error: { message: 'boom' } }, 'that postcard')).toThrow(
      DataReadError,
    )
  })
})

describe('DataReadError', () => {
  it('names the read and carries the PostgREST code, for the log', () => {
    try {
      unwrapList({ data: null, error: { message: 'could not find a relationship', code: 'PGRST200' } }, 'the postcard feed')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(DataReadError)
      const readError = error as DataReadError
      expect(readError.message).toContain('the postcard feed')
      expect(readError.message).toContain('could not find a relationship')
      expect(readError.message).toContain('PGRST200')
      expect(readError.code).toBe('PGRST200')
    }
  })

  it('omits the parenthesised code when there is not one', () => {
    try {
      unwrap({ data: null, error: { message: 'timeout' } }, 'your clubs')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as Error).message).toBe('Could not read your clubs: timeout')
    }
  })
})
