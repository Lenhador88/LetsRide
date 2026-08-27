/**
 * Every URL in the app that names a resource id.
 *
 * ## Why the id is a query parameter and not a path segment
 *
 * The app ships as a static bundle inside a native shell (PD-142), and a static
 * export can only serve documents it prerendered. A path segment forces one
 * document per id: `output: 'export'` refuses a dynamic segment without
 * `generateStaticParams`, and none of these ids exist on the build machine —
 * they are per-rider, RLS-scoped rows, and baking a real one into an `.ipa`
 * would disclose that the row existed on build day to anyone who unzips it.
 *
 * A query string is not part of the path, so **one prerendered document serves
 * every ride**, and no navigation can hard-navigate out of the app's own
 * document looking for a payload that was never emitted. Product owner's
 * decision, 2026-08-10 — `openspec/changes/add-static-export-bundle/design.md`
 * §D3 carries the full pricing of the alternative, which was two different
 * native routing implementations, one of them impossible on Android under
 * Capacitor's defaults.
 *
 * ## Read these through the builders, never by hand
 *
 * A hand-written `` `/rides/detail?id=${id}` `` is a string that looks right and
 * skips `encodeURIComponent`, and there are eighteen link sites. Same rule as
 * `lib/query/keys.ts`: one definition, and a grep for the shape finds every
 * caller.
 *
 * ## The old shape still resolves, on the web only
 *
 * `/postcards/<uuid>` links are already sitting in people's messages, so
 * `next.config.ts` keeps them alive as a redirect. That redirect exists in the
 * **web** config only — a static export has no server to run one — which is
 * also why nothing here may generate the old shape.
 *
 * ## The pages that read these
 *
 * Each of the ten reads `useSearchParams().get(DETAIL_ID_PARAM) ?? ''`, inside a
 * `<Suspense>` boundary Next requires for a prerendered route. An absent or
 * malformed id parses as "no such row" and reaches `notFound()` through the id
 * schema the read already carries — `rideIdSchema`, `clubIdSchema`,
 * `postcardIdSchema` — rather than through a special empty-string case.
 *
 * **The boundaries are not what makes the export build, and that is worth
 * knowing before someone removes them.** Measured 2026-08-10 by dropping one and
 * building: the export still succeeds, because `RouteGuard` renders the splash
 * *instead of* children until it has decided, so no page body — and therefore no
 * `useSearchParams()` — executes during the prerender pass at all. They are here
 * because that is a property of a different file, and the day `RouteGuard`
 * changes, the absent boundary is a `next build` failure on ten routes at once.
 */

import { clubIdSchema } from '@/lib/validation/clubs'
import { rideIdSchema } from '@/lib/validation/rides'

/** The query parameter every detail route reads its id from. */
export const DETAIL_ID_PARAM = 'id'

function detail(path: string, id: string): string {
  return `${path}?${DETAIL_ID_PARAM}=${encodeURIComponent(id)}`
}

/**
 * The pathnames, without the id. Exported because two places need to compare
 * against a route rather than build a link to one — `PostcardMenu` asks whether
 * it is drawn on the thread it would 404, and `next.config.ts` redirects the old
 * shape onto these.
 */
export const detailPaths = {
  postcard: '/postcards/detail',
  ride: '/rides/detail',
  rideCrew: '/rides/detail/crew',
  rideChat: '/rides/detail/chat',
  rideEdit: '/rides/detail/edit',
  club: '/clubs/detail',
  clubRides: '/clubs/detail/rides',
  clubMembers: '/clubs/detail/members',
  clubEdit: '/clubs/detail/edit',
  /** A club's threads — `081`, PD-307. The segment says which
   * entity the `id` names, matching `/rides/detail/chat?id=`: `threads`
   * takes a CLUB id, `thread` takes a THREAD id. */
  clubThreads: '/clubs/detail/threads',
  clubThread: '/clubs/detail/thread',
  newClubThread: '/clubs/detail/threads/new',
  profile: '/profile/detail',
} as const

export const routes = {
  postcard: (id: string) => detail(detailPaths.postcard, id),
  ride: (id: string) => detail(detailPaths.ride, id),
  rideCrew: (id: string) => detail(detailPaths.rideCrew, id),
  rideChat: (id: string) => detail(detailPaths.rideChat, id),
  rideEdit: (id: string) => detail(detailPaths.rideEdit, id),
  club: (id: string) => detail(detailPaths.club, id),
  clubRides: (id: string) => detail(detailPaths.clubRides, id),
  clubMembers: (id: string) => detail(detailPaths.clubMembers, id),
  clubEdit: (id: string) => detail(detailPaths.clubEdit, id),
  clubThreads: (clubId: string) => detail(detailPaths.clubThreads, clubId),
  /** Takes the THREAD's id, not the club's — see `detailPaths`. */
  clubThread: (threadId: string) => detail(detailPaths.clubThread, threadId),
  newClubThread: (clubId: string) => detail(detailPaths.newClubThread, clubId),
  /** Another rider — `view-rider-profile`. Own-id is redirected to `/profile`
   * rather than resolving here; see that route's own redirect. */
  profile: (id: string) => detail(detailPaths.profile, id),

  /** `Plan a ride` from a club — see `CREATE_CLUB_PARAM`. */
  newRideInClub: (clubId: string) => inClub(createPaths.ride, clubId),
  /** `Add a postcard` from a club — see `CREATE_CLUB_PARAM`. */
  newPostcardInClub: (clubId: string) => inClub(createPaths.postcard, clubId),
  /** `Add` from a ride's Journal — see `CREATE_RIDE_PARAM`. PD-256. */
  newPostcardInRide: (rideId: string) => inRide(createPaths.postcard, rideId),
} as const

/**
 * Which club a create screen was opened from (PD-283).
 *
 * It does two jobs and is deliberately one parameter for both: it seeds the
 * composer's club `<select>`, and it is what `backFromCreateScreen` turns into
 * the header's back destination. A rider who taps `Plan a ride` inside a club
 * means that club and expects to end up back in it, and neither half of that
 * was knowable from `/rides/new` before.
 *
 * **This is NOT `back-navigation.ts`'s mechanism, and the difference is the
 * point.** That module carries a rider-supplied *path* and so needs
 * `BACK_ORIGINS` to bound where it can send anyone. This carries an **id**, and
 * the only route it can ever produce is `routes.club(...)` of a well-formed
 * uuid — so there is no path to allowlist and no open redirect to close. Adding
 * a club detail URL to `BACK_ORIGINS` would have been the obvious reuse and is
 * the wrong one: that list is derived from the screens rendering
 * `NotificationsHeaderControl`, and its own test fails when it drifts.
 */
export const CREATE_CLUB_PARAM = 'club'

/**
 * Which ride a create screen was opened from — the same job as
 * `CREATE_CLUB_PARAM`, one param later (PD-256). Only the postcard composer
 * reads it: `RideJournal`'s `Add` tile — drawn by it or by `RideJournalEmpty`,
 * whichever the ride's postcards currently render — is the one place a
 * create screen is reached from a ride rather than a club, and it seeds the
 * composer's Ride `<select>` and the club that ride belongs to
 * (`seedRideId`), plus the header's back destination through
 * `backFromCreateScreen` below.
 */
export const CREATE_RIDE_PARAM = 'ride'

const createPaths = {
  ride: '/rides/new',
  postcard: '/postcards/new',
} as const

function inClub(path: string, clubId: string): string {
  return `${path}?${new URLSearchParams({ [CREATE_CLUB_PARAM]: clubId })}`
}

function inRide(path: string, rideId: string): string {
  return `${path}?${new URLSearchParams({ [CREATE_RIDE_PARAM]: rideId })}`
}

/**
 * The pure half: whatever the URL carried in, an app pathname out, always.
 *
 * A malformed or absent id falls back to the tab root the screen belongs to,
 * because the alternative is a back button that lands on a 404 — worse than the
 * blunt answer it replaces. The parse is `clubIdSchema`/`rideIdSchema` rather
 * than a regex of this file's own, so there is one definition of each kind of
 * id and it is the one `getClub`/`getRide` already refuse on.
 *
 * It never asks whether the club or ride EXISTS or is VISIBLE, and it does not
 * need to: a rider sent to one they cannot read gets that route's ordinary
 * `notFound()`, which is the same answer they would get by typing the URL.
 *
 * **`ride` wins when both are present.** Only the postcard composer can ever
 * carry both — a ride's own club is a prefill (`seedRideId`), never a second
 * "opened from", so a rider who tagged a photo from a ride's Journal goes back
 * to that ride rather than to the club it happens to belong to.
 */
export function backFromCreateScreen(
  ids: { club?: string | null | undefined; ride?: string | null | undefined },
  fallback: string
): string {
  if (ids.ride && rideIdSchema.safeParse(ids.ride).success) return routes.ride(ids.ride)
  if (ids.club && clubIdSchema.safeParse(ids.club).success) return routes.club(ids.club)
  return fallback
}
