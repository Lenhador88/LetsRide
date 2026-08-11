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
  clubAbout: '/clubs/detail/about',
  clubEdit: '/clubs/detail/edit',
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
  clubAbout: (id: string) => detail(detailPaths.clubAbout, id),
  clubEdit: (id: string) => detail(detailPaths.clubEdit, id),
} as const
