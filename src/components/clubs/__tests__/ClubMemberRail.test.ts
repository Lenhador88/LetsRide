import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { clubRailSummary } from '@/components/clubs/ClubMemberRail'
import { CLUB_AVATAR_LIMIT } from '@/lib/data/clubs'
import type { ClubRosterMember, PublicProfile } from '@/types'

/**
 * The rail's count and ordering are what this file exists for — the club
 * detail's counterpart of `RideCrewRail.test.ts`, and the same defect it
 * guards against: a count that disagrees with the roster one tap away.
 */

function member(
  id: string,
  role: ClubRosterMember['role'] = 'member'
): ClubRosterMember {
  const profile: PublicProfile = {
    id,
    username: id,
    avatar_url: null,
    avatar_path: null,
    bike_model: null,
  }
  return { user_id: id, role, joined_at: '2024-01-01T00:00:00Z', profile }
}

describe('clubRailSummary', () => {
  it('counts every member, admins and the owner included', () => {
    const roster = [member('mk'), member('pl', 'owner'), member('tv', 'admin')]

    expect(clubRailSummary(roster).label).toBe('3 members')
  })

  it('reads "member" in the singular for a club of one', () => {
    expect(clubRailSummary([member('pl', 'owner')]).label).toBe('1 member')
  })

  it('puts the owner first regardless of joined_at order', () => {
    // The owner is last in the source array — a transferred club, or simply
    // a fixture that does not assume `joined_at` order — and the rail must
    // not rely on the query to put them first.
    const roster = [member('mk'), member('tv'), member('pl', 'owner')]

    const { ordered } = clubRailSummary(roster)
    expect(ordered[0].user_id).toBe('pl')
    expect(ordered[0].role).toBe('owner')
    expect(ordered.map((m) => m.user_id).sort()).toEqual(['mk', 'pl', 'tv'].sort())
  })

  it('caps the avatar stack and reconciles the overflow bubble', () => {
    const roster = [
      member('owner', 'owner'),
      ...Array.from({ length: 10 }, (_, i) => member(`r${i}`)),
    ]

    const { shown, overflow, label } = clubRailSummary(roster)
    expect(label).toBe('11 members')
    expect(shown).toHaveLength(CLUB_AVATAR_LIMIT)
    expect(shown[0].user_id).toBe('owner')
    expect(overflow).toBe(11 - CLUB_AVATAR_LIMIT)
    expect(shown.length + overflow).toBe(11)
  })

  it('draws no overflow bubble when everyone fits', () => {
    const roster = [member('pl', 'owner'), member('mk')]

    expect(clubRailSummary(roster).overflow).toBe(0)
  })
})

/**
 * The cases above pin the arithmetic and the ordering. This one pins the
 * **source** — the distinction `RideCrewRail.test.ts` draws between a rail
 * that is right about a fabricated roster and one that is right about the
 * roster the page actually reads.
 */
describe('the rail reads the members page’s own source', () => {
  const source = readFileSync(new URL('../ClubMemberRail.tsx', import.meta.url), 'utf8')

  // Comments stripped first — see `RideCrewRail.test.ts` for why a bare scan
  // for the retired pattern would match this file's own docstring forbidding
  // it, which is CLAUDE.md's comment trap by name.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

  it('fetches through queryKeys.clubs.members and getClubMembers', () => {
    expect(code).toContain('queryKeys.clubs.members(clubId)')
    expect(code).toContain('getClubMembers(clubId)')
  })

  it('never reads members_count off the club row', () => {
    expect(code).not.toContain('members_count')
  })

  it('strips comments without stripping the code it must scan', () => {
    expect(code).toContain('ordered.length')
    expect(source).toContain('members_count') // the docstring forbidding it
  })

  it('would still catch a members_count rewrite', () => {
    const rewritten = code.replace('ordered.length', 'club.members_count')
    expect(rewritten).toContain('members_count')
    expect(rewritten).not.toBe(code)
  })
})
