import { describe, expect, it } from 'vitest'
import { CLUB_AVATAR_LIMIT, toClubListItem, type ClubListRow } from '@/lib/data/clubs'
import type { PublicProfile } from '@/types'

const rider = (n: number): PublicProfile => ({
  id: `rider-${n}`,
  username: `rider${n}`,
  avatar_url: null,
  avatar_path: null,
  bike_model: null,
})

function row(overrides: Partial<ClubListRow> = {}): ClubListRow {
  return {
    id: 'club-1',
    name: 'Biker Mice from Mars',
    is_public: true,
    avatar_path: null,
    cover_image_path: null,
    members_count: [{ count: 0 }],
    riders: [],
    ...overrides,
  }
}

describe('toClubListItem', () => {
  it('caps the avatar row at the design’s five faces', () => {
    const riders = Array.from({ length: 12 }, (_, i) => ({
      user_id: `rider-${i}`,
      profile: rider(i),
    }))

    const item = toClubListItem(row({ riders, members_count: [{ count: 12 }] }))

    expect(item.riders).toHaveLength(CLUB_AVATAR_LIMIT)
    expect(item.members_count).toBe(12)
  })

  /**
   * The `+N` on the card is `members_count - riders.length`, so this is the
   * number that decides whether it reads `+7` or `+2`. Reading it off the
   * embed instead would cap the total at five and draw `+0` for every club —
   * the same class of defect as the profile count capped at FEED_PAGE_SIZE and
   * presented as a total.
   */
  it('takes the total from the aggregate, not from the capped embed', () => {
    const riders = Array.from({ length: 5 }, (_, i) => ({
      user_id: `rider-${i}`,
      profile: rider(i),
    }))

    const item = toClubListItem(row({ riders, members_count: [{ count: 4231 }] }))

    expect(item.members_count).toBe(4231)
    expect(item.members_count - item.riders.length).toBe(4226)
  })

  /**
   * A member whose profile the policies hide comes back as a membership row
   * with a null embed. It must not draw a faceless avatar, and it must still
   * count towards the club — which is exactly why the count is not
   * `riders.length`.
   */
  it('drops members whose profile is not readable but keeps them in the count', () => {
    const item = toClubListItem(
      row({
        riders: [
          { user_id: 'rider-0', profile: rider(0) },
          { user_id: 'rider-1', profile: null },
        ],
        members_count: [{ count: 2 }],
      })
    )

    expect(item.riders).toHaveLength(1)
    expect(item.members_count).toBe(2)
  })

  it('survives a club with no members and no aggregate row', () => {
    const item = toClubListItem(row({ riders: null, members_count: null }))

    expect(item.riders).toEqual([])
    expect(item.members_count).toBe(0)
  })

  it('carries privacy through, since the row draws Lock or Globe from it', () => {
    expect(toClubListItem(row({ is_public: false })).is_public).toBe(false)
    expect(toClubListItem(row({ is_public: true })).is_public).toBe(true)
  })

  /**
   * The signed URLs are written afterwards by `signClubImages`, in one request
   * for the whole page. Starting them as null rather than leaving them
   * undefined is what keeps "not signed yet" and "signing refused" the same
   * state at render — the card falls back to initials either way, and a private
   * club's cover legitimately refuses.
   */
  it('carries the image paths and leaves the signed URLs to the signer', () => {
    const item = toClubListItem(
      row({ avatar_path: 'club-avatars/a/b.jpg', cover_image_path: 'club-covers/a/c.jpg' })
    )

    expect(item.avatar_path).toBe('club-avatars/a/b.jpg')
    expect(item.cover_image_path).toBe('club-covers/a/c.jpg')
    expect(item.avatar_url).toBeNull()
    expect(item.cover_image_url).toBeNull()
  })

  /**
   * Explore passes no unread at all rather than zero. The card decides between
   * the counter and the `Join club` link on `joined`, but leaving this
   * undefined keeps "not applicable" distinct from "nothing new" — and 015
   * refuses a watermark for an unjoined club, so a number here would be one the
   * database could never produce.
   */
  it('leaves unread undefined when none is supplied', () => {
    expect(toClubListItem(row()).unread).toBeUndefined()
    expect(toClubListItem(row(), 0).unread).toBe(0)
    expect(toClubListItem(row(), 7).unread).toBe(7)
  })
})
