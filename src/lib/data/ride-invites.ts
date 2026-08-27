import { resolveSupabase } from '@/lib/supabase/resolve'
import { PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import { resolveAvatarUrls } from '@/lib/data/media'
import { unwrapList } from '@/lib/data/unwrap'
import { rideIdSchema, riderSearchQuerySchema } from '@/lib/validation/rides'
import type { RideInvite, RideInviteListItem, RiderSearchResult } from '@/types'

/**
 * The reads behind ride invites — `083`, PD-329.
 *
 * ## Nothing here restates a visibility rule
 *
 * `083`'s SELECT policy on `ride_invites` is `(invitee_id = auth.uid() or
 * inviter_id = auth.uid())` dominated by the block check on both parties, so
 * none of these functions filters by rider. Restating it would be a second copy
 * of a rule RLS owns, free to drift, and weaker — the publishable key ships in
 * the bundle, so a client-side filter is a suggestion.
 */

/** One page of the picker. Deliberately unpaginated — see `searchRidersToInvite`. */
export const RIDER_SEARCH_LIMIT = 20

const INVITE_MINE_SELECT = `
  id, ride_id, status, created_at,
  inviter:profiles!inviter_id(${PUBLIC_PROFILE_COLUMNS}),
  ride:rides(id, title, departure_at, timezone)
`

const INVITE_RIDE_SELECT = `
  id, status, created_at,
  invitee:profiles!invitee_id(${PUBLIC_PROFILE_COLUMNS})
`

/**
 * The invites addressed to this rider that are still worth answering.
 *
 * **`pending` only, and rides they are not already crew on.** The second half
 * is expressed as a query over `ride_members` rather than as a check on
 * `status`, because those answer different questions: a rider who RSVPs without
 * ever answering the invitation is crew with a `pending` invite, which is a
 * legitimate state and not one to repair. Reading the crew is what makes the
 * list say "still worth answering" rather than "still unanswered".
 */
export async function getMyPendingInvites(): Promise<RideInvite[]> {
  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const invites = unwrapList(
    await supabase
      .from('ride_invites')
      .select(INVITE_MINE_SELECT)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    'your invites'
  ) as unknown as RideInvite[]

  if (invites.length === 0) return []

  const crewed = new Set(
    unwrapList(
      await supabase
        .from('ride_members')
        .select('ride_id')
        .eq('user_id', user.id)
        .in(
          'ride_id',
          invites.map((invite) => invite.ride_id)
        ),
      'your rides'
    ).map((row) => (row as { ride_id: string }).ride_id)
  )

  const open = invites.filter((invite) => !crewed.has(invite.ride_id))
  await resolveAvatarUrls(
    open.map((invite) => invite.inviter),
    supabase
  )
  return open
}

/**
 * One invite by id — what the notification row reads to decide whether it may
 * still offer Accept and Decline.
 *
 * **Read live rather than inferred from the notification's `type`.** A
 * notification records an event that happened; the invite may since have been
 * answered on another device, withdrawn by the organizer, or hidden by a block.
 * `null` is the decided answer for every one of those and they are deliberately
 * indistinguishable — telling them apart would make the row an oracle for
 * whether a block is in place.
 */
export async function getRideInvite(inviteId: string): Promise<RideInvite | null> {
  // Before `resolveSupabase()`, so a malformed id costs no round trip — a
  // non-uuid reaches PostgREST as `22P02`, which `unwrap` turns into the error
  // boundary instead of the not-found this deserves.
  if (!rideIdSchema.safeParse(inviteId).success) return null

  const supabase = await resolveSupabase()
  const rows = unwrapList(
    await supabase.from('ride_invites').select(INVITE_MINE_SELECT).eq('id', inviteId).limit(1),
    'that invite'
  ) as unknown as RideInvite[]

  const invite = rows[0] ?? null
  if (invite) await resolveAvatarUrls([invite.inviter], supabase)
  return invite
}

/**
 * The organizer's invite list for one ride.
 *
 * **`is_crew` comes from `ride_members`, never from `status`.** The invite says
 * what the rider answered; the crew says whether they are riding, and the two
 * legitimately disagree in both directions. Rendering "joined" off `status`
 * would show a rider as joined after they accepted and left, and as not joined
 * after they RSVPed without answering.
 */
export async function getRideInvites(rideId: string): Promise<RideInviteListItem[]> {
  if (!rideIdSchema.safeParse(rideId).success) return []

  const supabase = await resolveSupabase()
  const invites = unwrapList(
    await supabase
      .from('ride_invites')
      .select(INVITE_RIDE_SELECT)
      .eq('ride_id', rideId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    'this ride’s invites'
  ) as unknown as Omit<RideInviteListItem, 'is_crew'>[]

  if (invites.length === 0) return []

  const crew = new Set(
    unwrapList(
      await supabase.from('ride_members').select('user_id').eq('ride_id', rideId),
      'this ride’s crew'
    ).map((row) => (row as { user_id: string }).user_id)
  )

  await resolveAvatarUrls(
    invites.map((invite) => invite.invitee),
    supabase
  )

  return invites.map((invite) => ({
    ...invite,
    is_crew: !!invite.invitee && crew.has(invite.invitee.id),
  }))
}

/**
 * The rider picker — `083`, and the app's first people search.
 *
 * ## It adds no exposure, and the shape is what keeps that true
 *
 * `profiles` SELECT is `(auth.uid() = id) or (username is not null and not
 * private.is_blocked(auth.uid(), id))`, and `025` caps the readable columns at
 * an allowlist. So this returns exactly what a signed-in rider could already
 * read one id at a time. There is no RPC, no `security definer` search and no
 * new grant — a definer search would step past the block arm, and a "no results"
 * meaning "blocked" is a block oracle.
 *
 * But *readable by id* and *searchable by prefix* are different exposures, and
 * the bounds below are what make the second one acceptable:
 *
 * - **Prefix, never infix.** `%q%` over usernames is a substring index of the
 *   whole directory.
 * - **Two characters minimum.** One enumerates a thirty-sixth of the platform
 *   per keystroke.
 * - **Capped, unpaginated.** A picker that pages is a directory browser.
 *
 * **It is a sequential scan, and that is accepted rather than overlooked.**
 * Nothing in the schema serves a username prefix search — `003` replaced the
 * plain unique with `(lower(username))` under the default operator class, and
 * Postgres cannot use a b-tree for `ILIKE` at all — so each keystroke scans
 * `profiles` with a `security definer` block check per surviving row. Fine at
 * this size and bounded by the three rules above; `083`'s §The rider picker has
 * no index carries the two real fixes and why an index added here without
 * changing the query shape would be dead weight that reads as live.
 *
 * **Existing crew and existing invitees are filtered client-side**, over rows
 * the caller can already read. That is a convenience rather than a rule: a
 * rider hidden for that reason has already disclosed their membership to this
 * caller through the crew list.
 */
export async function searchRidersToInvite(
  rideId: string,
  query: string
): Promise<RiderSearchResult[]> {
  const parsed = riderSearchQuerySchema.safeParse(query)
  if (!parsed.success || !rideIdSchema.safeParse(rideId).success) return []

  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // `%` and `_` are wildcards in a LIKE pattern, so a rider typing either would
  // otherwise widen their own search rather than narrow it. Escaped rather than
  // stripped: `_` is legal in a username, and dropping it would return hits the
  // rider did not ask for.
  const prefix = parsed.data.replace(/([%_\\])/g, '\\$1')

  const hits = unwrapList(
    await supabase
      .from('profiles')
      .select(PUBLIC_PROFILE_COLUMNS)
      .ilike('username', `${prefix}%`)
      .order('username')
      .limit(RIDER_SEARCH_LIMIT),
    'riders'
  ) as unknown as RiderSearchResult[]

  const [crew, invited] = await Promise.all([
    supabase.from('ride_members').select('user_id').eq('ride_id', rideId),
    supabase.from('ride_invites').select('invitee_id').eq('ride_id', rideId),
  ])

  const taken = new Set<string>([
    ...unwrapList(crew, 'this ride’s crew').map((row) => (row as { user_id: string }).user_id),
    ...unwrapList(invited, 'this ride’s invites').map(
      (row) => (row as { invitee_id: string }).invitee_id
    ),
  ])
  if (user) taken.add(user.id)

  const offerable = hits.filter((rider) => !taken.has(rider.id))
  await resolveAvatarUrls(offerable, supabase)
  return offerable
}
