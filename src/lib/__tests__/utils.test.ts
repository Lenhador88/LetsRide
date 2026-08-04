import { describe, expect, it } from 'vitest'
import { formatPostcardDate, formatRelativeTime, getInitials } from '@/lib/utils'

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-03T12:00:00Z')
  const ago = (seconds: number) =>
    formatRelativeTime(new Date(now.getTime() - seconds * 1000).toISOString(), now)

  it('reads "just now" under a minute, rather than "0 seconds ago"', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(1)).toBe('just now')
    expect(ago(59)).toBe('just now')
  })

  it('switches to minutes at the boundary', () => {
    expect(ago(60)).toBe('1 minute ago')
    expect(ago(59 * 60)).toBe('59 minutes ago')
  })

  it('picks the largest unit that fits', () => {
    expect(ago(60 * 60)).toBe('1 hour ago')
    expect(ago(5 * 60 * 60)).toBe('5 hours ago')
    expect(ago(24 * 60 * 60)).toBe('yesterday')
    expect(ago(3 * 24 * 60 * 60)).toBe('3 days ago')
    expect(ago(7 * 24 * 60 * 60)).toBe('last week')
    expect(ago(30 * 24 * 60 * 60)).toBe('last month')
    expect(ago(365 * 24 * 60 * 60)).toBe('last year')
  })

  it('handles a future timestamp without producing a negative unit', () => {
    const future = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(future, now)).toBe('in 2 hours')
  })

  it('defaults `now` to the current time', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('just now')
  })
})

describe('getInitials', () => {
  it('returns "R" for null', () => {
    expect(getInitials(null)).toBe('R')
  })

  it('returns "R" for undefined', () => {
    expect(getInitials(undefined)).toBe('R')
  })

  it('returns "R" for an empty string', () => {
    expect(getInitials('')).toBe('R')
  })

  it('returns up to two uppercase initials for a normal username', () => {
    expect(getInitials('ripper')).toBe('R')
  })

  it('uppercases a single-word name to one initial', () => {
    expect(getInitials('gravel')).toBe('G')
  })

  it('takes the first letter of the first two words for a multi-word name', () => {
    expect(getInitials('road warrior')).toBe('RW')
  })

  it('never returns more than two characters, even with three or more words', () => {
    expect(getInitials('road warrior supreme')).toBe('RW')
  })
})

describe('formatPostcardDate', () => {
  it('is day-first, as the design stamps it — "19 Nov 2024", not "Nov 19, 2024"', () => {
    expect(formatPostcardDate('2024-11-19T10:00:00Z')).toBe('19 Nov 2024')
  })

  it('carries no weekday, unlike formatDate', () => {
    // The design's stamp sits in the corner of a photo and has room for three parts.
    expect(formatPostcardDate('2025-01-01T10:00:00Z')).toBe('1 Jan 2025')
  })
})
