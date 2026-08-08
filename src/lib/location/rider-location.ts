import { getLocalityCentroid } from '@/lib/data/places'
import { getMyLocationText } from '@/lib/data/profile'

/**
 * Best-available coordinates for biasing `search_places()` — the highest
 * -leverage performance fix that file has, per its own doc block (17-152 ms
 * with a bias, 171-2,957 ms without).
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
 * last-used one — and both are blocked on schema (`rides` has no lat/lng
 * column yet, verified). Adding either is meant to be a new entry appended to
 * `SOURCES` below, not a rewrite of `resolveRiderLocation` or the functions
 * around it — say so here rather than leaving the next reader to infer it.
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
 * ## Cached for the page load
 *
 * Same shape as `guard-cache.ts`, simplified: nothing here needs to be read
 * synchronously during render (no `useSyncExternalStore`, no listeners), so a
 * single memoised promise is enough — re-resolving per keystroke of a search
 * sheet would mean re-asking Permissions and re-reading the profile on every
 * character typed.
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
 * A hanging GPS fix must never delay a search. `getCurrentPosition`'s own
 * `timeout` option is the primary guard; `getPositionOnce` below adds a
 * second, JS-level timer as well, because some WebView geolocation shims are
 * known not to honour it and never call either callback at all — belt and
 * braces, not paranoia, given a rider is standing at a petrol station with
 * the engine running.
 */
const GEOLOCATION_TIMEOUT_MS = 4_000

/**
 * A rider's city does not move meaningfully in five minutes, and this is a
 * search bias rather than a live fix — accepting a slightly stale position
 * costs nothing here and saves the device a fresh GPS acquisition (battery),
 * unlike a ride actually being tracked, which is a `watchPosition` concern
 * that belongs to the native shell rather than to this one-shot read.
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

function getPositionOnce(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (value: GeolocationPosition | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    // The belt to `timeout` below's braces — see the constant's own comment.
    const timer = setTimeout(() => settle(null), GEOLOCATION_TIMEOUT_MS + 500)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer)
        settle(position)
      },
      () => {
        clearTimeout(timer)
        settle(null) // denied, unavailable, or timed out — all degrade the same way
      },
      { timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: GEOLOCATION_MAX_AGE_MS }
    )
  })
}

function toRiderLocation(position: GeolocationPosition): RiderLocation {
  return { lat: position.coords.latitude, lon: position.coords.longitude, source: 'device' }
}

/** Source 1 — silent, never prompts. See the module header. */
async function resolveFromDeviceSilently(): Promise<RiderLocation | null> {
  if (!hasGeolocation()) return null
  if ((await permissionState()) !== 'granted') return null

  const position = await getPositionOnce()
  return position ? toRiderLocation(position) : null
}

/**
 * Source 2 — the rider's onboarding city, geocoded. Two reads:
 * `profiles.location` (free text), then `locality_centroid()` (`040`) to turn
 * it into coordinates. Either coming back empty degrades to the next source
 * rather than throwing — a rider with no onboarding location, or a locality
 * the geocoder does not recognise, is an ordinary case here, not a fault.
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

/**
 * The resolver every caller should reach for. Resolves once per page load and
 * reuses that answer for every later call — see the module header's "cached
 * for the page load" section.
 */
export function resolveRiderLocation(): Promise<RiderLocation | null> {
  assertBrowser('resolveRiderLocation')
  cachedLocation ??= resolveChain()
  return cachedLocation
}

/**
 * The explicit "use my location" affordance — the *only* place in this
 * module that may trigger the OS permission prompt, because it only ever
 * runs from a tap. Bypasses the chain and asks the device directly.
 *
 * On success it also overwrites the page-load cache, so a
 * `resolveRiderLocation()` call later in the same session sees the fresher
 * device fix instead of repeating the profile fallback. On denial, timeout,
 * or a device with no geolocation it returns `null` and leaves the cache
 * exactly as it was — a rejected explicit request should not erase whatever
 * `resolveRiderLocation()` had already resolved.
 */
export async function requestDeviceLocation(): Promise<RiderLocation | null> {
  assertBrowser('requestDeviceLocation')
  if (!hasGeolocation()) return null

  const position = await getPositionOnce()
  if (!position) return null

  const location = toRiderLocation(position)
  cachedLocation = Promise.resolve(location)
  return location
}

/** Test seam, matching `resetGuardCacheForTests`. Nothing in the app calls it. */
export function resetRiderLocationCacheForTests(): void {
  cachedLocation = undefined
}
