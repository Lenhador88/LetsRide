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

/**
 * A rider's typed query as a **prefix-anchored** LIKE pattern, with every
 * wildcard escaped.
 *
 * Exported and pure so it has a test in a container with no database in it —
 * the split `resolveComboboxKey` and `resolveDestination` make, for the same
 * reason: the part that can be wrong is one string transformation, and the
 * function it lives in cannot be unit-tested without PostgREST.
 *
 * **Four characters, and `*` is the one that looks safe.** `%`, `_` and `\`
 * are LIKE's own; **`*` is PostgREST's documented alias for `%`** in its
 * `like`/`ilike` operators, substituted server-side, and postgrest-js passes
 * the pattern through untouched. So without it a rider types `*a` and gets
 * `%a%` — an infix search over the whole directory — or `**` and gets the
 * first page of every username on the platform, or `a*` and gets the
 * one-character prefix the two-character minimum exists to refuse. **Two of
 * the three bounds `searchRidersToInvite` names as the reason its exposure is
 * acceptable, defeated by one keystroke**, with nothing red anywhere because
 * none of it crosses an RLS line.
 *
 * Escaped rather than stripped: `_` is legal in a username, and dropping it
 * would return hits the rider did not ask for.
 */
export function riderSearchPattern(query: string): string {
  return `${query.replace(/([%_*\\])/g, '\\$1')}%`
}

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
      // **A scoping predicate, not a restated policy, and the distinction is
      // the whole reason this line is here.** `083`'s SELECT policy is
      // `(invitee_id = auth.uid() or inviter_id = auth.uid())` — it covers BOTH
      // sides deliberately, so without this the caller's own OUTGOING invites
      // come back too, with `inviter` set to themselves. Nothing renders them
      // wrong today (the only reader matches on `ride_id` and an organizer
      // cannot be invited to their own ride), but the next reader inherits the
      // bug with none of that protection: a "Your invites" screen, or PD-330's
      // link half, would list the organizer's own sent invites as things to
      // Accept.
      .eq('invitee_id', user.id)
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

  const hits = unwrapList(
    await supabase
      .from('profiles')
      .select(PUBLIC_PROFILE_COLUMNS)
      // `riderSearchPattern` owns the anchor and the escaping, including the
      // one that is not LIKE's — see its docstring.
      .ilike('username', riderSearchPattern(parsed.data))
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
