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

import { clubIdSchema, clubTimelineAnchorSchema } from '@/lib/validation/clubs'
import { rideIdSchema } from '@/lib/validation/rides'

/** The query parameter every detail route reads its id from. */
export const DETAIL_ID_PARAM = 'id'

/**
 * The invite link's landing route — `091`, PD-330. **The one public path in
 * this file**, and the only route in the app that is reachable with no session.
 *
 * It is spelled here rather than in `src/lib/auth/guard.ts` so there is one
 * string: that file adds it to `PUBLIC_PATHS` *and* to
 * `needsOnboardingState()`, and a literal typed into either of them separately
 * is a public route that silently stops being public, or one whose onboarding
 * detour silently stops happening.
 */
export const RIDE_JOIN_PATH = '/rides/join'

/**
 * The club invite link's landing route — `093`, PD-360, `RIDE_JOIN_PATH`'s
 * exact reasoning one domain over, including the two-guard-edit rule below.
 * The second public path in this file.
 */
export const CLUB_JOIN_PATH = '/clubs/join'

/**
 * Which token the landing route is answering for.
 *
 * **A query parameter rather than a path segment, and the reason is the NATIVE
 * build rather than the web one.** `output: 'export'` lives in
 * `next.config.ts`'s `capacitorConfig` only — the file ends
 * `isCapacitorBuild ? capacitorConfig : webConfig` — so a link opened from
 * WhatsApp reaches the web build, which runs a server and would serve a dynamic
 * segment happily. The binding constraint is that **the route tree is shared
 * between both builds**: a `/rides/join/[token]` segment would need
 * `generateStaticParams` under `CAPACITOR_BUILD=1` and break
 * `npm run build:native`, a build nobody runs on a feature branch.
 *
 * The reasoning above this in the file — one prerendered document per route
 * rather than one per id — applies unchanged, and this parameter is the one
 * place it is a *credential* rather than an id.
 */
export const INVITE_TOKEN_PARAM = 'token'

function detail(path: string, id: string): string {
  return `${path}?${DETAIL_ID_PARAM}=${encodeURIComponent(id)}`
}

/**
 * Which row on the club timeline a thread — its creation entry, a reply, or a
 * join's introduction — was opened from, so `Back` can return to it instead of
 * to the thread list. `097`'s follow-up, PD-366 (`design.md` §D9).
 *
 * **`CREATE_CLUB_PARAM`'s exact shape**: never a URL, only a bounded value —
 * here, `mergeClubTimeline`'s own row key (`join:<uuid>`, `thread:<uuid>`, …),
 * parsed by `clubTimelineAnchorSchema` before it is ever used. The only thing
 * `clubThreadReturnTo` can produce from it is `routes.club(clubId)` with a
 * fragment naming a row of THAT club — there is no allowlist to maintain and
 * no open redirect to close. Do **not** add a `BACK_ORIGINS` entry for this;
 * that list is derived from the screens rendering `NotificationsHeaderControl`
 * and has its own drift test, and this carries an id rather than a path.
 */
export const RETURN_ANCHOR_PARAM = 'row'

function withReturnAnchor(href: string, anchor: string): string {
  return `${href}&${RETURN_ANCHOR_PARAM}=${encodeURIComponent(anchor)}`
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
  /** The organizer's rider picker and invite list — `083`, PD-329. */
  rideInvite: '/rides/detail/invite',
  club: '/clubs/detail',
  clubRides: '/clubs/detail/rides',
  clubMembers: '/clubs/detail/members',
  /** The roster an owner or admin acts on — `088`, PD-326. Takes a CLUB id.
   * Separate from `clubMembers`, which is the read-only roster every member
   * sees: one screen serving both would have to hide half of itself from most
   * of its readers, and `viewer_role` is a display hint rather than the
   * authority (`ClubDetail`'s own docstring). The RPCs decide either way. */
  clubManage: '/clubs/detail/manage',
  clubEdit: '/clubs/detail/edit',
  /** The admin's rider picker and link section — `093`, PD-360,
   * `rideInvite`'s shape one domain over. */
  clubInvite: '/clubs/detail/invite',
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
  rideInvite: (id: string) => detail(detailPaths.rideInvite, id),
  club: (id: string) => detail(detailPaths.club, id),
  clubRides: (id: string) => detail(detailPaths.clubRides, id),
  clubMembers: (id: string) => detail(detailPaths.clubMembers, id),
  clubManage: (id: string) => detail(detailPaths.clubManage, id),
  clubEdit: (id: string) => detail(detailPaths.clubEdit, id),
  clubInvite: (id: string) => detail(detailPaths.clubInvite, id),
  clubThreads: (clubId: string) => detail(detailPaths.clubThreads, clubId),
  /** Takes the THREAD's id, not the club's — see `detailPaths`. */
  clubThread: (threadId: string) => detail(detailPaths.clubThread, threadId),
  /**
   * `prefillTitle` and `SAY_WELCOME_TITLE_PARAM` are gone — `097`, PD-365
   * deleted "Say welcome" (`092`, PD-356), which was this parameter's only
   * producer. `CreateThreadForm`'s `initialTitle` prop went with it, for the
   * same reason: a prefill nothing writes any more is dead code rather than
   * a feature waiting for a second caller.
   */
  newClubThread: (clubId: string) => detail(detailPaths.newClubThread, clubId),
  /** Another rider — `view-rider-profile`. Own-id is redirected to `/profile`
   * rather than resolving here; see that route's own redirect. */
  profile: (id: string) => detail(detailPaths.profile, id),

  /**
   * A ride invite link (`091`, PD-330) — the one URL this app produces that is
   * meant to be pasted into somebody else's chat.
   *
   * `shareAppLink` puts `canonicalOrigin()` in front of it, which is what makes
   * it a link to something rather than to `https://localhost` inside the shell.
   */
  joinRide: (token: string) =>
    `${RIDE_JOIN_PATH}?${new URLSearchParams({ [INVITE_TOKEN_PARAM]: token })}`,

  /**
   * A club invite link (`093`, PD-360) — `joinRide`'s shape one domain over,
   * the second URL this app produces meant to be pasted into somebody else's
   * chat. Decision 1: a **public** club has no such link at all, because the
   * plain `routes.club(id)` URL already carries every grant a token could —
   * this exists only for a private club, where it is the whole point.
   */
  joinClub: (token: string) =>
    `${CLUB_JOIN_PATH}?${new URLSearchParams({ [INVITE_TOKEN_PARAM]: token })}`,

  /** `Plan a ride` from a club — see `CREATE_CLUB_PARAM`. */
  newRideInClub: (clubId: string) => inClub(createPaths.ride, clubId),
  /** `Add a postcard` from a club — see `CREATE_CLUB_PARAM`. */
  newPostcardInClub: (clubId: string) => inClub(createPaths.postcard, clubId),
  /** `Add` from a ride's Journal — see `CREATE_RIDE_PARAM`. PD-256. */
  newPostcardInRide: (rideId: string) => inRide(createPaths.postcard, rideId),
} as const

/**
 * The same thread, opened from a specific row on the club's own timeline —
 * `097`'s follow-up, PD-366. `anchor` is `mergeClubTimeline`'s own row key for
 * that row, carried verbatim rather than a second identity, so
 * `clubThreadReturnTo` can only ever resolve it to a row the stream actually
 * produced. Used by the join row's introduction door and by
 * `ClubTimelineThreadRow` for both a thread's creation entry and its
 * replies — never by the plain Threads list, which has no row to return to.
 *
 * **Deliberately NOT a member of `routes`, unlike every other builder above.**
 * `bootRestoreTarget`'s own suite enumerates `Object.values(routes)` and calls
 * each with one argument to check none of them is accidentally public; a
 * second required argument here would break that generic sweep rather than
 * teach it something. `backFromCreateScreen` sits outside `routes` for the
 * identical reason.
 */
export function clubThreadFromTimeline(threadId: string, anchor: string): string {
  return withReturnAnchor(detail(detailPaths.clubThread, threadId), anchor)
}

/**
 * The same ride, opened from a specific row on a club's own timeline — PD-378.
 * `clubThreadFromTimeline`'s shape one domain over, and deliberately the same
 * parameter (`RETURN_ANCHOR_PARAM`) rather than a second one: the thing being
 * carried is identical — `mergeClubTimeline`'s own key for the row that was
 * tapped — and one name means `clubTimelineAnchorSchema` bounds both.
 *
 * **Only the club timeline builds this link.** Every other ride card in the app
 * (`/rides`, `/rides/explore`, a club's Rides sub-page) has no timeline row to
 * return to and keeps the plain `routes.ride`, which is why `RideCard` takes the
 * anchor as an *optional* prop rather than this becoming the default shape.
 *
 * Outside `routes` for `clubThreadFromTimeline`'s own reason — `bootRestoreTarget`'s
 * suite calls every member of `routes` with one argument.
 */
export function rideFromClubTimeline(rideId: string, anchor: string): string {
  return withReturnAnchor(detail(detailPaths.ride, rideId), anchor)
}

/**
 * Where a ride plan's `Back` goes — PD-378. The header arrow and `useSwipeBack`
 * both read it, so they cannot disagree; that is the defect PD-341 closed on the
 * thread screen and the reason `clubThreadReturnTo` is one value read twice.
 *
 * **The club is the ride's own `club_id`, never a URL parameter**, and that is
 * the load-bearing choice here. A club id in the link would be a second copy of
 * a fact the row already owns, and one that can disagree with it — a ride moved
 * between clubs, or a hand-edited URL, would send the rider back to a timeline
 * the ride is not on. Reading it off the ride makes the wrong answer
 * unrepresentable, and it is still parsed here rather than trusted, for
 * `backFromCreateScreen`'s reason: the only string this can ever build is
 * `routes.club(<uuid>)` with a fragment, so there is no path to allowlist and no
 * open redirect to close.
 *
 * **The cost, stated because it is visible:** `club_id` arrives with the ride,
 * so for the moment before that read lands this answers `fallback` — the rider
 * who taps Back inside that window gets today's destination rather than the
 * club. That is strictly better than today (which answers `fallback` always) and
 * it is why the ride is not *awaited* here; the alternative was a `club` query
 * parameter, which buys an immediately-correct arrow at the price of the
 * disagreement above.
 *
 * **Absent or unparseable anchor answers `fallback`** — a notification tap, a
 * pasted URL and a reload all produce exactly that, and all land the rider
 * somewhere that certainly exists. It never asks whether the anchored row still
 * exists: that is the club timeline's own no-op
 * (`resolveClubTimelineScrollTarget`), evaluated once the rows are on the page.
 */
export function rideReturnTo(
  clubId: string | null | undefined,
  rawAnchor: string | null | undefined,
  fallback: string
): string {
  if (!rawAnchor || !clubTimelineAnchorSchema.safeParse(rawAnchor).success) return fallback
  if (!clubId || !clubIdSchema.safeParse(clubId).success) return fallback
  return `${routes.club(clubId)}#${rawAnchor}`
}

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

/**
 * Where a club thread's `Back` goes — the header arrow and `useSwipeBack` both
 * read this, so they cannot disagree (the defect PD-341 already closed on
 * this exact screen once). `097`'s follow-up, PD-366 (`design.md` §D9).
 *
 * **Absent or unparseable both answer `routes.clubThreads`** — today's
 * behaviour, and what a notification tap, a shared URL and a reload all
 * produce: it lands the rider somewhere that certainly exists and that they
 * can certainly read, because they just read the thread.
 *
 * Parsed with `clubTimelineAnchorSchema` rather than a regex of this file's
 * own — `backFromCreateScreen`'s own reasoning: one definition, bounded to the
 * six kinds `mergeClubTimeline` can ever produce, so the only thing this can
 * ever build is `routes.club(clubId)` with a fragment. **It never asks
 * whether the anchored row still exists** — that is the club timeline's own
 * no-op (`resolveClubTimelineScrollTarget`), not this function's; a deleted,
 * horizon-cut or no-longer-readable row all reach this function identically
 * and all produce the same fragment, because none of that is knowable here.
 */
export function clubThreadReturnTo(clubId: string, rawAnchor: string | null): string {
  const anchor = rawAnchor && clubTimelineAnchorSchema.safeParse(rawAnchor).success ? rawAnchor : null
  return anchor ? `${routes.club(clubId)}#${anchor}` : routes.clubThreads(clubId)
}
