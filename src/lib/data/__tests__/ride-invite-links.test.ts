import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `getRideInviteLinkPublicPreview` — `115`, PD-430, the app's one anonymous
 * read. Task 6.1.
 *
 * **No `auth.getUser` mock is offered at all**, deliberately: 4.2 requires this
 * function to never call it, and a mock returning `undefined` would let a
 * stray call through silently. If the function under test ever calls
 * `supabase.auth.getUser`, this suite fails with a `TypeError` reading
 * `auth.getUser is not a function` rather than reporting a false pass — the
 * absence is the assertion.
 */

const rpc = vi.fn()

vi.mock('@/lib/supabase/resolve', () => ({
  resolveSupabase: async () => ({ rpc }),
}))

const { getRideInviteLinkPublicPreview } = await import('@/lib/data/ride-invite-links')

const TOKEN = 'a'.repeat(32)

function result(data: unknown, error: { message: string; code?: string } | null = null) {
  return { data, error }
}

describe('getRideInviteLinkPublicPreview', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('refuses a malformed token before the round trip', async () => {
    await expect(getRideInviteLinkPublicPreview('not-a-token')).resolves.toBeNull()
    await expect(getRideInviteLinkPublicPreview('')).resolves.toBeNull()
    // Uppercase is not the same token as the column stores — `rideInviteTokenSchema`'s
    // own reasoning, restated here because it is what keeps this call cheap.
    await expect(getRideInviteLinkPublicPreview(TOKEN.toUpperCase())).resolves.toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns null on zero rows — the link is decided dead', async () => {
    rpc.mockResolvedValueOnce(result([]))
    await expect(getRideInviteLinkPublicPreview(TOKEN)).resolves.toBeNull()
    expect(rpc).toHaveBeenCalledWith('ride_invite_link_public_preview', { t: TOKEN })
  })

  it('maps the six columns onto the thin type and nothing else', async () => {
    rpc.mockResolvedValueOnce(
      result([
        {
          ride_id: 'ride-1',
          title: 'Sunday run',
          departure_at: '2027-05-01T09:00:00.000Z',
          timezone: 'Europe/Amsterdam',
          meeting_point: 'Dam Square, Amsterdam',
          organizer_username: 'pedro',
        },
      ])
    )

    const preview = await getRideInviteLinkPublicPreview(TOKEN)

    expect(preview).toEqual({
      ride_id: 'ride-1',
      title: 'Sunday run',
      departure_at: '2027-05-01T09:00:00.000Z',
      timezone: 'Europe/Amsterdam',
      meeting_point: 'Dam Square, Amsterdam',
      organizer_username: 'pedro',
    })
  })

  it('a thrown read stays thrown, so the screen can tell a dead link from a tunnel', async () => {
    rpc.mockResolvedValueOnce(result(null, { message: 'network error', code: 'ECONN' }))
    await expect(getRideInviteLinkPublicPreview(TOKEN)).rejects.toThrow(/that invite link/)
  })

  it('issues no second read — no is_crew probe, no avatar signing', async () => {
    rpc.mockResolvedValueOnce(
      result([
        {
          ride_id: 'ride-1',
          title: 'Sunday run',
          departure_at: '2027-05-01T09:00:00.000Z',
          timezone: null,
          meeting_point: 'Dam Square, Amsterdam',
          organizer_username: 'pedro',
        },
      ])
    )

    await getRideInviteLinkPublicPreview(TOKEN)

    // The mocked client offers only `rpc` — `resolveSupabase` above returns no
    // `.from` and no `.auth`. A second read of any kind (`ride_members`,
    // `resolveAvatarUrls`'s `.from('profiles')` / `.storage`) would throw
    // rather than silently succeed, and it did not: exactly one RPC call.
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
