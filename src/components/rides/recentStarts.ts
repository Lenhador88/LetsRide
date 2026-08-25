import { getRecentRideStarts } from '@/lib/data/rides'
import { queryKeys } from '@/lib/query/keys'

/**
 * What `PlaceSearchField` needs to offer a ride's start field the rider's own
 * last picks — PD-274.
 *
 * **Here rather than inline in each form, for two reasons.** The two ride forms
 * must offer the same three rows read through the same key, and an object
 * literal written inline would be a new identity on every render — the field
 * takes this as a dependency, so a fresh one each pass is a re-read waiting for
 * the first guard that stops holding.
 *
 * **It lives beside the forms rather than in `lib/data/`** because only the
 * loader is data: the key and the heading are this screen's wiring, and the
 * primitive stays ignorant of what it is a field for. A club field passes
 * nothing — a club's location is a town, a rider creates roughly one club, and
 * "recent club locations" has no content.
 */
export const RECENT_STARTS = {
  load: getRecentRideStarts,
  cacheKey: queryKeys.rides.recentStarts(),
  heading: 'Recent starts',
}
