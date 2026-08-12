import { describe, expect, it, vi } from 'vitest'
import { MEDIA_BUCKET } from '@/lib/media/constants'
import {
  SIGNED_URL_TTL_SECONDS,
  resolveAvatarUrls,
  resolveRideMapUrls,
  signImagePaths,
} from '@/lib/data/media'
import type { DataClient } from '@/lib/supabase/resolve'

/**
 * The first behavioural coverage `src/lib/data/` has had.
 *
 * `media.ts` is where it starts because every screen depends on it and none of
 * them fail loudly when it is wrong. A missed signing pass renders initials,
 * which is a state the design draws deliberately elsewhere — so the bug looks
 * like a design choice. Two of them shipped that way and were found by reading
 * the code: the ride filter collage, and the club avatar on four surfaces.
 *
 * The client is a stub rather than a mock of `@supabase/supabase-js`, because
 * what is worth pinning is the *contract these functions rely on* — one batched
 * `createSignedUrls` call, per-item errors, `path` nullable — not the library's
 * internals.
 */

type SignedItem = { path: string | null; signedUrl: string; error: string | null }

function stubClient(handler: (paths: string[]) => { data: SignedItem[] | null; error: unknown }) {
  const createSignedUrls = vi.fn(async (paths: string[]) => handler(paths))
  const from = vi.fn(() => ({ createSignedUrls }))
  return {
    client: { storage: { from } } as unknown as DataClient,
    createSignedUrls,
    from,
  }
}

/** The ordinary case: every path signs. */
function signsEverything() {
  return stubClient((paths) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${path}`, error: null })),
    error: null,
  }))
}

describe('signImagePaths', () => {
  it('signs in one batched request, against the media bucket, at the stated TTL', async () => {
    const { client, createSignedUrls, from } = signsEverything()

    const urls = await signImagePaths(['a/1.jpg', 'b/2.jpg', 'c/3.jpg'], client)

    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith(MEDIA_BUCKET)
    expect(createSignedUrls).toHaveBeenCalledWith(
      ['a/1.jpg', 'b/2.jpg', 'c/3.jpg'],
      SIGNED_URL_TTL_SECONDS
    )
    expect(urls.size).toBe(3)
  })

  it('de-duplicates and drops falsy paths before asking', async () => {
    const { client, createSignedUrls } = signsEverything()

    await signImagePaths(['a.jpg', 'a.jpg', '', 'b.jpg'], client)

    expect(createSignedUrls).toHaveBeenCalledWith(['a.jpg', 'b.jpg'], SIGNED_URL_TTL_SECONDS)
  })

  it('does not call out at all when there is nothing to sign', async () => {
    const { client, createSignedUrls } = signsEverything()

    expect((await signImagePaths([], client)).size).toBe(0)
    expect((await signImagePaths(['', ''], client)).size).toBe(0)
    expect(createSignedUrls).not.toHaveBeenCalled()
  })

  it('keeps the items that signed when one of them fails', async () => {
    // A private club's photo seen by someone 010's policy excludes comes back
    // exactly like this. One card losing its image must not cost the feed.
    const { client } = stubClient((paths) => ({
      data: paths.map((path, index) =>
        index === 1
          ? { path, signedUrl: '', error: 'Object not found' }
          : { path, signedUrl: `https://signed.test/${path}`, error: null }
      ),
      error: null,
    }))

    const urls = await signImagePaths(['ok.jpg', 'denied.jpg', 'fine.jpg'], client)

    expect([...urls.keys()]).toEqual(['ok.jpg', 'fine.jpg'])
  })

  it('returns empty rather than throwing when the whole request fails', async () => {
    // Deliberately unlike `unwrap`: a failed read is a broken screen, a failed
    // signing is a missing picture.
    const { client } = stubClient(() => ({ data: null, error: new Error('offline') }))

    expect((await signImagePaths(['a.jpg'], client)).size).toBe(0)
  })
})

describe('resolveAvatarUrls', () => {
  it('writes the signed URL over avatar_url, in place', async () => {
    const { client } = signsEverything()
    const rider = { id: 'r1', avatar_path: 'avatars/r1/a.jpg', avatar_url: null }

    await resolveAvatarUrls([rider], client)

    expect(rider.avatar_url).toBe('https://signed.test/avatars/r1/a.jpg')
  })

  it('signs riders and clubs in the same request', async () => {
    // The reason the parameter is structural. Four surfaces drew club initials
    // for weeks because `clubs.avatar_url` was a real column that was always
    // NULL — see CLUB_EMBED_COLUMNS.
    const { client, createSignedUrls } = signsEverything()
    const rider = { avatar_path: 'avatars/r1/a.jpg', avatar_url: null }
    const club = { avatar_path: 'club-avatars/o1/c.jpg', avatar_url: null }

    await resolveAvatarUrls([rider, club], client)

    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    expect(rider.avatar_url).toBe('https://signed.test/avatars/r1/a.jpg')
    expect(club.avatar_url).toBe('https://signed.test/club-avatars/o1/c.jpg')
  })

  it('nulls avatar_url when the path will not sign, rather than leaving a stale value', async () => {
    // This is the fallback `024` removed. While `avatar_url` was a column it was
    // the last resort; now it is only ever what this function wrote, so keeping
    // a previous value would mean serving a URL whose signature has expired.
    const { client } = stubClient((paths) => ({
      data: paths.map((path) => ({ path, signedUrl: '', error: 'Object not found' })),
      error: null,
    }))
    const rider = { avatar_path: 'avatars/r1/a.jpg', avatar_url: 'https://stale.test/old.jpg' }

    await resolveAvatarUrls([rider], client)

    expect(rider.avatar_url).toBeNull()
  })

  it('leaves a row with no path alone', async () => {
    const { client, createSignedUrls } = signsEverything()
    const rider = { avatar_path: null, avatar_url: null }

    await resolveAvatarUrls([rider], client)

    expect(rider.avatar_url).toBeNull()
    expect(createSignedUrls).not.toHaveBeenCalled()
  })

  it('tolerates the nulls that embeds produce', async () => {
    // `author`, `organizer` and `club` are all nullable embeds — a blocked
    // rider's postcard arrives with `author: null`.
    const { client } = signsEverything()
    const rider = { avatar_path: 'avatars/r1/a.jpg', avatar_url: null }

    await expect(resolveAvatarUrls([null, undefined, rider], client)).resolves.toBeUndefined()
    expect(rider.avatar_url).toBe('https://signed.test/avatars/r1/a.jpg')
  })

  it('signs a whole page of nested rows in one request', async () => {
    const { client, createSignedUrls } = signsEverything()
    const rows = Array.from({ length: 12 }, (_, index) => ({
      avatar_path: `avatars/r${index}/a.jpg`,
      avatar_url: null as string | null,
    }))

    await resolveAvatarUrls(rows, client)

    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    expect(rows.every((row) => row.avatar_url?.startsWith('https://signed.test/'))).toBe(true)
  })
})

/**
 * `051` added the two tile columns and nothing writes them yet, so the state
 * every one of these has to get right is the NULL one — it is what every ride
 * in both databases is in, and the only way this change can cost a rider
 * anything is by making that state render differently from how it renders
 * today. The card strip and the detail panel each fall back on a null URL, so a
 * resolver that quietly turned a NULL path into a request or a truthy value
 * would surface as a broken image on every ride in the app.
 */
describe('resolveRideMapUrls', () => {
  it('writes both tile URLs over their _url siblings, in place', async () => {
    const { client } = signsEverything()
    const ride = {
      map_card_path: 'ride-maps/o1/card.jpg',
      map_card_url: null as string | null,
      map_detail_path: 'ride-maps/o1/detail.jpg',
      map_detail_url: null as string | null,
    }

    await resolveRideMapUrls([ride], client)

    expect(ride.map_card_url).toBe('https://signed.test/ride-maps/o1/card.jpg')
    expect(ride.map_detail_url).toBe('https://signed.test/ride-maps/o1/detail.jpg')
  })

  it('signs both columns of a whole page in one request', async () => {
    // The list reads thirty rides. One call per column per row would be sixty
    // round trips on the critical path of the rides screen.
    const { client, createSignedUrls } = signsEverything()
    const rows = Array.from({ length: 30 }, (_, index) => ({
      map_card_path: `ride-maps/o1/card-${index}.jpg`,
      map_card_url: null as string | null,
    }))

    await resolveRideMapUrls(rows, client)

    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    expect(rows.every((row) => row.map_card_url?.startsWith('https://signed.test/'))).toBe(true)
  })

  it('leaves a ride with NULL paths alone and issues no request', async () => {
    // **The state of every ride today.** Nothing writes these columns until the
    // render function ships, so this is not an edge case — it is the whole
    // behaviour of this function in production right now, and it must cost the
    // rides list nothing.
    const { client, createSignedUrls } = signsEverything()
    const ride = {
      map_card_path: null,
      map_card_url: null as string | null,
      map_detail_path: null,
      map_detail_url: null as string | null,
    }

    await resolveRideMapUrls([ride], client)

    expect(ride.map_card_url).toBeNull()
    expect(ride.map_detail_url).toBeNull()
    expect(createSignedUrls).not.toHaveBeenCalled()
  })

  it('issues no request for a whole page of tile-less rides', async () => {
    const { client, createSignedUrls } = signsEverything()
    const rows = Array.from({ length: 30 }, () => ({
      map_card_path: null,
      map_card_url: null as string | null,
    }))

    await resolveRideMapUrls(rows, client)

    expect(createSignedUrls).not.toHaveBeenCalled()
  })

  it('signs the card tile of a ride whose detail tile is missing', async () => {
    // A valid stored state rather than a broken one: `051`'s coupling CHECK
    // requires a coordinate behind a path, never a second path beside one, so
    // one upload succeeding and the other failing leaves exactly this row.
    const { client, createSignedUrls } = signsEverything()
    const ride = {
      map_card_path: 'ride-maps/o1/card.jpg',
      map_card_url: null as string | null,
      map_detail_path: null,
      map_detail_url: null as string | null,
    }

    await resolveRideMapUrls([ride], client)

    expect(createSignedUrls).toHaveBeenCalledWith(
      ['ride-maps/o1/card.jpg'],
      SIGNED_URL_TTL_SECONDS
    )
    expect(ride.map_card_url).toBe('https://signed.test/ride-maps/o1/card.jpg')
    expect(ride.map_detail_url).toBeNull()
  })

  it('nulls the URL when the Storage policy refuses the path', async () => {
    // A tile whose ride this viewer may no longer see — an ex-member of a
    // private club — comes back exactly like this. It must land as null so the
    // screen draws the ordinary no-tile fallback rather than a broken image,
    // and so nothing distinguishes "refused" from "absent" on screen.
    const { client } = stubClient((paths) => ({
      data: paths.map((path) => ({ path, signedUrl: '', error: 'Object not found' })),
      error: null,
    }))
    const ride = {
      map_card_path: 'ride-maps/o1/card.jpg',
      map_card_url: 'https://stale.test/old.jpg' as string | null,
    }

    await resolveRideMapUrls([ride], client)

    expect(ride.map_card_url).toBeNull()
  })

  it('leaves every URL null when the whole signing request fails', async () => {
    // Offline, or Storage down. A missing map is not a broken screen.
    const { client } = stubClient(() => ({ data: null, error: new Error('offline') }))
    const ride = {
      map_card_path: 'ride-maps/o1/card.jpg',
      map_card_url: null as string | null,
    }

    await resolveRideMapUrls([ride], client)

    expect(ride.map_card_url).toBeNull()
  })

  it('signs tiles for many rides in the same request as each other', async () => {
    const { client, createSignedUrls } = signsEverything()
    const first = { map_card_path: 'ride-maps/o1/a.jpg', map_card_url: null as string | null }
    const second = { map_card_path: 'ride-maps/o2/b.jpg', map_card_url: null as string | null }

    await resolveRideMapUrls([first, second], client)

    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    expect(createSignedUrls).toHaveBeenCalledWith(
      ['ride-maps/o1/a.jpg', 'ride-maps/o2/b.jpg'],
      SIGNED_URL_TTL_SECONDS
    )
  })

  it('tolerates the nulls a maybeSingle read produces', async () => {
    const { client } = signsEverything()
    const ride = { map_card_path: 'ride-maps/o1/a.jpg', map_card_url: null as string | null }

    await expect(resolveRideMapUrls([null, undefined, ride], client)).resolves.toBeUndefined()
    expect(ride.map_card_url).toBe('https://signed.test/ride-maps/o1/a.jpg')
  })
})
