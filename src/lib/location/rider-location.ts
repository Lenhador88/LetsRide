import { getLocalityCentroid } from '@/lib/data/places'
import { getMyLocationText } from '@/lib/data/profile'

/**
 * Best-available coordinates for biasing the place typeahead — the `near` on a
 * `search` request, which `buildAutocompleteUrl` turns into the vendor's
 * `bias=proximity:`.
 *
 * **The bias REORDERS, it does not filter** (`search-places/shape.ts` §D8), so
 * nothing findable without one stops being findable with it — which is what
 * makes a best-effort chain the right shape here rather than a hard
 * requirement. An earlier version of this block justified the bias by a
 * latency figure quoted from `search_places()`, the self-hosted Postgres
 * search `070` retired; there is no query plan to speed up any more, and the
 * numbers were synthetic besides (PD-200).
 *
 * ## Why this is not a domain type in `src/types/index.ts`
 *
 * Nothing here is a row Supabase returns — it is synthesised client-side from
 * either the device or a geocoded profile field, and neither shape is a
 * contract a query owns. `lib/auth/guard-cache.ts`'s `GuardState`/
 * `GuardSnapshot` are the precedent: also client-only, also local to the
 * module that produces them.
 *
 * ## The fallback chain, and why it is a list rather than an if/else ladder
 *
 * Two sources today, in priority order. **Two more are coming with PD-114
 * step 3** — the ride being edited's own meeting point, and the rider's
 * last-used one. **Neither is blocked on schema any more**: this said `rides`
 * had no lat/lng column "verified", and `051` added `latitude`, `longitude`
 * and `geocode_confidence`, filled by `resolve-ride-location`, which is ACTIVE
 * on both projects (measured 2026-08-19). **Expect NULL on any ride created
 * before that deploy** — a source reading a coordinate off a ride has to treat
 * a null as "no signal" rather than as an error, exactly as the profile source
 * treats a city that does not resolve.
 *
 * **A PICKED ride is the one case guaranteed NOT to be null, and the opposite is
 * the easy thing to write** — `PD-267` gates the *tiles* for a picked ride, not
 * its coordinate, so "no map yet" reads as "no coordinate yet" and inverts which
 * rides this source can use. `rides_location_coupling`'s picked arm settles it,
 * and it is a CHECK rather than a convention:
 *
 * ```
 * (start_place_id IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
 *  AND geocode_confidence IS NULL AND …)
 * ```
 *
 * So a picked ride carries an exact rider-chosen coordinate the moment it is
 * saved, and those are the BEST rides for this source rather than the ones to
 * skip. Adding either is meant to be a new entry
 * appended to `SOURCES` below, not a rewrite of `resolveRiderLocation` or the
 * functions around it — say so here rather than leaving the next reader to
 * infer it.
 *
 * ## Never prompts
 *
 * The silent device source only ever succeeds if the Permissions API already
 * reports `granted`. A `prompt`, `denied`, or "cannot tell" state all fall
 * through to the next source instead of asking — firing the OS permission
 * dialog because a rider opened a search sheet is exactly the "permission
 * dialog fired by typing" failure this app's rider-ux brief calls out as how
 * riders decline permanently. The one place that *may* prompt is
 * `requestDeviceLocation`, and only because it only ever runs from an
 * explicit tap.
 *
 * ## Cached, with a TTL — not "for the page load" any more
 *
 * Same shape as `guard-cache.ts`, simplified: nothing here needs to be read
 * synchronously during render (no `useSyncExternalStore`, no listeners), so a
 * single memoised promise is enough — re-resolving per keystroke of a search
 * sheet would mean re-asking Permissions and re-reading the profile on every
 * character typed.
 *
 * **"For the page load" was the wrong framing for a Capacitor WebView, which
 * can live for hours rather than minutes.** A rider who opens the app in
 * Utrecht and rides 200 km to Maastricht would otherwise keep an Utrecht bias
 * for the WebView's entire life — and per `PlaceSearchResult`'s documented
 * proximity edge, once five Utrecht rows fill the local pass, a Maastricht
 * place is *unreachable*, not merely ranked lower. `GEOLOCATION_MAX_AGE_MS`
 * is the TTL as well as the device fix's own `maximumAge` — the same number
 * for the same reason: a position (or a resolved bias built from one) is not
 * worth trusting past it.
 *
 * **A failed attempt is a third thing, and it is not cached at all.** See
 * `resolveAndCache`'s own comment — the short version is `guard-cache.ts`'s
 * own rule, "a failed read must never harden into a verdict."
 *
 * ## Sign-out
 *
 * `clearRiderLocation()` is this module's half of `signOut`'s sweep
 * (`src/lib/actions/auth.ts`), alongside `clearQueryCache`/`clearGuardCache`.
 * `signOut` navigates with `router.replace`, not a reload, so nothing else in
 * this module resets between one rider signing out and the next signing in on
 * the same device.
 *
 * ## The read-in-an-effect rule applies here too
 *
 * A `'use client'` component is still server-rendered by Next on first load
 * (see `src/lib/supabase/resolve.ts`'s header for why that is permanent, not
 * a migration artefact) — and in that pass there is no `document`, no
 * `navigator.geolocation`, and no session for the profile fallback's read to
 * find. `resolveSupabase()` already throws if the profile fallback reaches
 * it during that pass; this module throws its own, earlier, clearer error so
 * the failure names this file rather than a Supabase call two layers down.
 */
export type RiderLocationSource = 'device' | 'profile'

export type RiderLocation = {
  lat: number
  lon: number
  source: RiderLocationSource
}

/**
 * A hanging GPS *acquisition* must never delay a search. `getCurrentPosition`'s
 * own `timeout` option is the primary guard for that; `getPositionOnce`
 * below can add a second, JS-level timer as well for a WebView shim known not
 * to honour it and never call either callback at all — belt and braces, not
 * paranoia, given a rider is standing at a petrol station with the engine
 * running.
 *
 * **That belt must never be armed before permission is decided.** Per the
 * Geolocation API's own algorithm, the native `timeout` is measured from
 * "acquire a position" — i.e. from *after* the rider has answered the OS
 * prompt — but a JS `setTimeout` started at call time counts the prompt
 * itself. Reproduced: tap "use my location", read the dialog, tap Allow at
 * 6s — an unconditionally-armed backstop had already fired at 4.5s, so the
 * real fix arrived into a no-op and the rider was told "no location" on
 * exactly the grant that matters, the first one. See `getPositionOnce`'s
 * `arm` parameter.
 */
const GEOLOCATION_TIMEOUT_MS = 4_000

/**
 * A rider's city does not move meaningfully in five minutes, and this is a
 * search bias rather than a live fix — accepting a slightly stale position
 * costs nothing here and saves the device a fresh GPS acquisition (battery),
 * unlike a ride actually being tracked, which is a `watchPosition` concern
 * that belongs to the native shell rather than to this one-shot read.
 *
 * Doubles as the page-load memo's TTL — see the module header's "cached, with
 * a TTL" section for why five minutes is also the right bound for how long a
 * *resolved* bias stays trustworthy, not only for the device's own
 * `maximumAge`.
 */
const GEOLOCATION_MAX_AGE_MS = 5 * 60_000

function hasGeolocation(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.geolocation
}

/**
 * Checks the Permissions API without ever prompting. `'unsupported'` covers
 * both "this platform has no Permissions API" and "it rejected a descriptor
 * it does not recognise" (some WebViews do this for `'geolocation'`) — both
 * are read the same as `'prompt'` by every caller: never assume consent from
 * an API's absence.
 */
async function permissionState(): Promise<PermissionState | 'unsupported'> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unsupported'
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    return status.state
  } catch {
    return 'unsupported'
  }
}

/**
 * `arm` decides whether the JS-level backstop timer starts counting from
 * THIS call. It must only be `true` when the caller already knows, before
 * calling, that no OS permission dialog can appear for this request — see
 * `GEOLOCATION_TIMEOUT_MS`'s own comment for the defect an unconditional
 * `true` caused.
 *
 * The silent path (`resolveFromDeviceSilently`) always passes `true`: it has
 * already confirmed `granted` before calling, so no dialog is possible.
 * `requestDeviceLocation` passes `true` only when its own pre-check already
 * reads `granted`, and `false` otherwise — accepting, deliberately, that a
 * WebView shim which both ignores the native `timeout` *and* never calls
 * either callback would then hang with no local recovery on that path. That
 * is a narrower, rarer failure than the one this parameter exists to fix,
 * which happened on the very first grant every rider makes.
 */
function getPositionOnce(arm: boolean): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (value: GeolocationPosition | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const timer = arm ? setTimeout(() => settle(null), GEOLOCATION_TIMEOUT_MS + 500) : undefined

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (timer) clearTimeout(timer)
        settle(position)
      },
      () => {
        if (timer) clearTimeout(timer)
        settle(null) // denied, unavailable, or timed out — all degrade the same way
      },
      { timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: GEOLOCATION_MAX_AGE_MS }
    )
  })
}

/**
 * The precision, in decimal places, a device GPS fix is rounded to before it
 * becomes a `RiderLocation` — applied once, in `toRiderLocation` below, which
 * is the single point both `resolveFromDeviceSilently` and
 * `requestDeviceLocation` already funnel a raw `GeolocationPosition` through.
 * A future third caller of a device fix inherits the rounding for free by
 * routing through here rather than by remembering to call a helper itself.
 *
 * **Defence in depth, not de-identification.** A device fix is read live and
 * repeatedly (the silent path on every load where permission is already
 * granted, the explicit tap on demand), so a sequence of ~1 km-rounded fixes
 * still traces where a rider lives and rides. This constant blurs the single
 * value that reaches `search_places()` as a proximity bias; it is not the
 * privacy answer, and persisting an approximate rider location anywhere
 * needs its own decision, not an inference from this one.
 *
 * Two decimal places of LATITUDE is ~1.11 km everywhere — a degree of
 * latitude is ~111 km regardless of where on Earth it is measured. The same
 * two decimal places of LONGITUDE is not a uniform kilometre: a degree of
 * longitude shrinks with `cos(latitude)`, so at Amsterdam's ~52°N it is
 * closer to ~0.68 km, narrowing further toward the poles and only matching
 * latitude's ~1.11 km at the equator. "Roughly a kilometre" is the honest
 * claim this constant supports — never "exactly 1 km on both axes."
 *
 * Well inside `search_places()`'s own ~0.25° × 0.40° proximity box (`037`,
 * `039`): the largest shift rounding can introduce is half of 10^-2°, i.e.
 * 0.005°, which is at most 2% of the box's narrower (latitude) half-width. It
 * cannot move a candidate place from inside the box to outside it except
 * right at the box's own edge.
 */
const LOCATION_PRECISION_DP = 2

/**
 * Rounds to the nearest `LOCATION_PRECISION_DP` decimal places — never
 * truncates. `Math.trunc` always moves a value's magnitude toward zero,
 * which would bias every southern-hemisphere latitude toward the equator
 * and every western-hemisphere longitude toward the prime meridian: a
 * systematic shift in one direction, not a blur centred on the true fix.
 * `Math.round` has no such bias for either sign — see this file's own test
 * for both a negative-latitude and a negative-longitude case.
 */
function roundToLocationPrecision(value: number): number {
  const factor = 10 ** LOCATION_PRECISION_DP
  return Math.round(value * factor) / factor
}

function toRiderLocation(position: GeolocationPosition): RiderLocation {
  return {
    lat: roundToLocationPrecision(position.coords.latitude),
    lon: roundToLocationPrecision(position.coords.longitude),
    source: 'device',
  }
}

/** Source 1 — silent, never prompts. See the module header. */
async function resolveFromDeviceSilently(): Promise<RiderLocation | null> {
  if (!hasGeolocation()) return null
  if ((await permissionState()) !== 'granted') return null

  const position = await getPositionOnce(true) // already known granted — no dialog possible
  return position ? toRiderLocation(position) : null
}

/**
 * Source 2 — the rider's onboarding city, geocoded. Two reads:
 * `profiles.location` (free text), then `locality_centroid()` (`040`) to turn
 * it into coordinates. Either one coming back EMPTY degrades to the next
 * source rather than throwing — a rider with no onboarding location, or a
 * locality the geocoder does not recognise, is an ordinary case here, not a
 * fault.
 *
 * **A genuine READ FAILURE is a different thing, and it is not swallowed
 * here.** `getMyLocationText()` uses `unwrap`, which throws on any PostgREST
 * error (`lib/data/unwrap.ts`'s own honesty argument), and that throw
 * propagates out of this function and out of `resolveChain` — it is not
 * caught here. It never reaches a caller of `resolveRiderLocation`, though:
 * `resolveAndCache`'s own comment is where that is actually handled, by not
 * memoising a failed attempt rather than by pretending this function cannot
 * fail.
 */
async function resolveFromProfile(): Promise<RiderLocation | null> {
  const location = await getMyLocationText()
  if (!location) return null

  const centroid = await getLocalityCentroid(location)
  if (!centroid) return null

  return { lat: centroid.lat, lon: centroid.lon, source: 'profile' }
}

/**
 * The fallback chain, in priority order — see the module header for what
 * arrives here next and why appending is the whole change.
 */
const SOURCES: Array<() => Promise<RiderLocation | null>> = [
  resolveFromDeviceSilently,
  resolveFromProfile,
]

async function resolveChain(): Promise<RiderLocation | null> {
  for (const source of SOURCES) {
    const result = await source()
    if (result) return result
  }
  return null
}

function assertBrowser(fn: string): void {
  if (typeof document === 'undefined') {
    throw new Error(
      `${fn} ran during a server render. There is no device and no session to ` +
        'read there — call it from an effect or an event handler. See ' +
        'src/lib/location/rider-location.ts.'
    )
  }
}

let cachedLocation: Promise<RiderLocation | null> | undefined
let cachedAt = 0

/**
 * Starts a fresh chain resolution and memoises it — but only for as long as
 * it stays a *success*, never a failure.
 *
 * `resolveChain()` can reject (`resolveFromProfile` propagating a genuine
 * read error, see its own comment). Caching that rejected promise is the
 * defect this function exists to avoid: `guard-cache.ts` states the rule
 * this mirrors — "a failed read must never harden into a verdict" — and
 * without it, one mobile network blip would lose the search bias for the
 * rest of the WebView's life rather than for one call. So a rejection is
 * caught here, turned into `null` for *this* caller only, and the memo is
 * cleared so the very next call retries the whole chain from scratch.
 *
 * The identity check before clearing matters: `requestDeviceLocation` may
 * already have overwritten `cachedLocation` with a fresher, successful
 * answer while this attempt was still in flight, and that must win rather
 * than being erased by a late failure behind it.
 */
function resolveAndCache(): Promise<RiderLocation | null> {
  cachedAt = Date.now()
  const promise: Promise<RiderLocation | null> = resolveChain().catch(() => {
    if (cachedLocation === promise) cachedLocation = undefined
    return null
  })
  cachedLocation = promise
  return promise
}

/**
 * The resolver every caller should reach for. Resolves once and reuses that
 * answer until it goes stale — see the module header's "cached, with a TTL"
 * section — rather than re-asking Permissions and re-reading the profile on
 * every keystroke of a search sheet.
 */
export function resolveRiderLocation(): Promise<RiderLocation | null> {
  assertBrowser('resolveRiderLocation')

  const stale = cachedLocation !== undefined && Date.now() - cachedAt >= GEOLOCATION_MAX_AGE_MS
  if (cachedLocation === undefined || stale) return resolveAndCache()
  return cachedLocation
}

/**
 * The explicit "use my location" affordance — the *only* place in this
 * module that may trigger the OS permission prompt, because it only ever
 * runs from a tap. Bypasses the chain and asks the device directly.
 *
 * On success it also overwrites the page-load cache (and its timestamp), so
 * a `resolveRiderLocation()` call later in the same session sees the fresher
 * device fix instead of repeating the profile fallback. On denial, timeout,
 * or a device with no geolocation it returns `null` and leaves the cache
 * exactly as it was — a rejected explicit request should not erase whatever
 * `resolveRiderLocation()` had already resolved.
 */
export async function requestDeviceLocation(): Promise<RiderLocation | null> {
  assertBrowser('requestDeviceLocation')
  if (!hasGeolocation()) return null

  // Only arm the JS backstop when a pre-check already reads `granted` — see
  // `getPositionOnce`'s header for the defect this avoids. A `prompt`,
  // `denied` (re-requesting after a previous decline), or `unsupported` read
  // all mean the wait could be a human reading the OS dialog rather than a
  // hung GPS fix, so the backstop is skipped for those and the native
  // `timeout` — which starts only after the decision — is the only guard.
  const arm = (await permissionState()) === 'granted'

  const position = await getPositionOnce(arm)
  if (!position) return null

  const location = toRiderLocation(position)
  cachedLocation = Promise.resolve(location)
  cachedAt = Date.now()
  return location
}

/**
 * Sign-out's own sweep, matching `clearQueryCache`/`clearGuardCache`
 * (`src/lib/actions/auth.ts`). A `RiderLocation` carries no user id and no
 * ownership check of its own — nothing here would notice a different rider —
 * so without this, rider A's coordinates survive `signOut`'s client-side
 * `router.replace` (there is no page reload) straight into rider B's session
 * on the same device.
 *
 * Guarded the same way `clearGuardCache` is: a no-op with no `document`, so
 * "nothing writes this module's state during a server render" holds by
 * construction rather than by every caller happening to be client-only
 * today.
 */
export function clearRiderLocation(): void {
  if (typeof document === 'undefined') return
  cachedLocation = undefined
  cachedAt = 0
}

/** Test seam, matching `resetGuardCacheForTests`. Nothing in the app calls it. */
export function resetRiderLocationCacheForTests(): void {
  cachedLocation = undefined
  cachedAt = 0
}
