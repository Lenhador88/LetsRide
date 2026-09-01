import { resolveSupabase } from '@/lib/supabase/resolve'
import { unwrap, unwrapList } from '@/lib/data/unwrap'
import { resolveAvatarUrls, signImagePaths } from '@/lib/data/media'
import { OWN_PROFILE_COLUMNS, VIEWED_PROFILE_COLUMNS } from '@/lib/data/columns'
import { profileIdSchema } from '@/lib/validation/profile'
import { rideDayStartUtc } from '@/lib/utils'
import type { AccountDeletionImpact, Profile, ViewedProfile } from '@/types'

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const profile = unwrap(
    await supabase.from('profiles').select(OWN_PROFILE_COLUMNS).eq('id', user.id).maybeSingle(),
    'your profile',
  ) as Profile | null

  // Your own avatar goes through the same signing as everyone else's. It is
  // tempting to skip it — you can always read your own row — but readability of
  // the ROW is not readability of the Storage OBJECT, and 014's policy is what
  // decides the second. Skipping it here would make your own avatar the one that
  // silently fails to render.
  if (profile) {
    // The cover is signed here rather than by the screen, and that is a
    // freshness decision rather than tidiness. `/profile` is a client component
    // now, so it cannot sign in its body; a `useQuery` for the signed URL would
    // need a key, and every key `keys.ts` could offer that does not contain the
    // path re-signs the OLD path when `updateCover` invalidates — the profile
    // row and the cover URL refetch concurrently, so the URL is built from a
    // `cover_image_path` that is about to be replaced, pointing at the object
    // `setProfileImage` just deleted. Signed here, the path and its URL arrive
    // in the same result and cannot disagree.
    //
    // Two passes rather than one batch, matching `attachLikeState`: avatars and
    // covers are different Storage folders with different policies, so a
    // readable avatar does not imply a readable cover.
    await resolveAvatarUrls([profile], supabase)

    profile.cover_image_url = profile.cover_image_path
      ? // A path that cannot be signed lands as null and draws the empty state,
        // rather than taking the screen to its error boundary — the same trade
        // `signImagePaths` already makes per item for a feed.
        ((await signImagePaths([profile.cover_image_path], supabase)).get(
          profile.cover_image_path
        ) ?? null)
      : null
  }
  return profile
}

/**
 * Another rider's profile — `/profile/detail?id=<uuid>`, and the one screen
 * `VIEWED_PROFILE_COLUMNS` exists for.
 *
 * `null` collapses every audience case `rider-profile-viewing` names: a
 * malformed id, no such row, a NULL-username row the `profiles` policy
 * withholds, and a block in either direction (`private.is_blocked` is
 * symmetric — `openspec/changes/view-rider-profile/design.md` §D1). The
 * screen renders one not-found for all of them, deliberately — telling them
 * apart would make the route an oracle for whether a given id exists or
 * whether a block is in place.
 *
 * `maybeSingle`, not `single`: a zero-row result is the ordinary "not visible
 * to you" case here, not a failure to surface as the error boundary.
 */
export async function getProfile(userId: string): Promise<ViewedProfile | null> {
  // Before `resolveSupabase()`, so a malformed id costs no round trip — same
  // guard as `getRide`/`getClub`. A non-uuid id reaches `.eq('id', …)` as
  // `22P02`, which PostgREST turns into a 400 and `unwrap` throws, landing the
  // rider on the error boundary instead of the not-found this deserves.
  if (!profileIdSchema.safeParse(userId).success) return null

  const supabase = await resolveSupabase()

  const profile = unwrap(
    await supabase
      .from('profiles')
      .select(VIEWED_PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle(),
    'that profile',
  ) as ViewedProfile | null

  if (!profile) return null

  // Same two-pass signing `getCurrentProfile` uses, for the same reason: the
  // avatar and the cover are different Storage folders with different SELECT
  // policies, so a readable profile row does not imply either object is.
  await resolveAvatarUrls([profile], supabase)

  profile.cover_image_url = profile.cover_image_path
    ? ((await signImagePaths([profile.cover_image_path], supabase)).get(
        profile.cover_image_path
      ) ?? null)
    : null

  return profile
}

/**
 * The free-text onboarding `location` alone — for `resolveRiderLocation`'s
 * profile fallback (`src/lib/location/`), which needs nothing else
 * `getCurrentProfile` reads: no avatar signing pass, no cover URL, for a
 * caller that only wants a city name to geocode.
 */
export async function getMyLocationText(): Promise<string | null> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const row = unwrap(
    await supabase.from('profiles').select('location').eq('id', user.id).maybeSingle(),
    'your onboarding location',
  ) as { location: string | null } | null

  return row?.location ?? null
}

/**
 * Case-insensitive, because since `056` a stored username keeps the case the
 * rider typed while `profiles_username_lower_key` still folds. This used to be
 * `.eq('username', …)`, which was correct only while every stored value was
 * lowercase — with `Pedro` in the table it reports `pedro` free and the rider is
 * refused `23505` on submit, PD-146's shape by a new road.
 *
 * **`.ilike()` is not the repair**, which is why this is an RPC and not a
 * one-word edit: LIKE reads `_` as a single-character wildcard and the charset
 * allows underscores, so `my_name` would match a stored `myXname` and report a
 * free name taken. PostgREST exposes no ESCAPE clause, so nothing at this call
 * site can fix that. `056`'s `username_exists` does the fold in the database,
 * against the `lower(username)` index `003` built for exactly this query.
 *
 * It is `security invoker`, so this still reads through the block-aware
 * `profiles` SELECT policy exactly as the filter it replaced did — **including
 * the one direction in which it is permanently wrong**: to a rider blocked by a
 * name's holder it reports free, every time. `usernameVerdict` reconciles that
 * on screen; making this function see past the block would leak the blocked
 * rider's name, which is the thing the policy exists to stop.
 *
 * Advisory only, unchanged. Two riders can pass the check on the same name in
 * the same instant; the unique index is what actually decides, and the action
 * that writes must handle the conflict.
 */
export async function isUsernameTaken(username: string): Promise<boolean> {
  const supabase = await resolveSupabase()
  const exists = unwrap(
    await supabase.rpc('username_exists', { p_username: username }),
    'that username',
  )
  return exists === true
}

/**
 * How many of the departing rider's own upcoming, organised rides feed the
 * confirmation's counts. Bounded for the same reason `CLUB_MEMBERSHIP_LIMIT`
 * bounds `getMyClubs` (`lib/data/clubs.ts`) — organising rides is something a
 * rider does by hand, so hundreds of upcoming ones is implausible — and for
 * a second reason that one does not have: every id here is serialised into
 * the `ride_members` query's `.in()` list below, so an unbounded read is
 * also an unbounded request URL (reviewer finding #4, 2026-08-16). Past the
 * cap, `ridesToCancel` and `ridersAffected` become a floor rather than a
 * total — the same honest degradation `ClubDeletionImpact`'s own counts
 * already accept.
 */
export const ACCOUNT_DELETION_RIDES_LIMIT = 200

/**
 * How many `ride_members` rows across those rides feed `ridersAffected`
 * (reviewer finding #3 of the third delta pass, 2026-08-16). The
 * `count: 'exact', head: true` form this replaced put no rows on the wire at
 * any volume; reading actual rows to dedupe by person needs a bound the old
 * form did not, because — per `RIDE_CREW_LIMIT`'s own comment in
 * `lib/data/rides.ts` — `ride_members` is unbounded by construction. `063`
 * capped a crew at `rides.max_riders` for six days and `077` (PD-293) dropped
 * both, so nothing in the database bounds one at all. Both other
 * `ride_members` reads in that file are bounded (`RIDE_FILTER_SCAN_LIMIT` and
 * `RIDE_CREW_LIMIT`); this is the one in `lib/data/` that was not, until now. Set well
 * above `ACCOUNT_DELETION_RIDES_LIMIT` × a realistic crew size rather than
 * derived from it, because the two bound different things (rides vs. total
 * crew rows) and a product of the two would be a cap nobody chose on
 * purpose. Past it, `ridersAffected` is a floor, same as `ridesToCancel`.
 *
 * **What this does NOT cover, measured rather than assumed not to matter:**
 * PostgREST's own `db-max-rows` config, if set on either project, would
 * truncate a read silently below even this limit. `pg_settings` and
 * `current_setting('pgrst.db_max_rows', true)` were checked against DEV
 * (`fpmrimzxadewsaiwpsel`) 2026-08-16 and neither exposes it — Supabase does
 * not appear to surface this PostgREST-level config as a queryable Postgres
 * setting on a managed project, and this session had no way to make an
 * authenticated REST call to test it empirically (no key-retrieval tool, no
 * `.env.local`). Left as an inference, same as the reviewer's own read of it —
 * not because it was not checked, but because the check came back
 * inconclusive rather than negative.
 */
export const ACCOUNT_DELETION_RIDERS_LIMIT = 1000

/**
 * The account-deletion confirmation's blast-radius counts — see
 * `AccountDeletionImpact`. Read under the caller's own session, never
 * through the privileged Edge Function, per `deletion-privileged-execution`'s
 * "the function does no reading a rider could have done themselves".
 *
 * Two round trips when there is nothing to cancel, three when there is:
 * `clubs` and `rides` have no relationship PostgREST can embed in a single
 * query without also fetching every row's roster, so they run in parallel;
 * `ride_members` is read separately, after, because it has to exclude the
 * departing rider's own row (see `ridersAffected` below) and PostgREST's
 * embedded-count form has no clean way to filter one `user_id` out of an
 * aggregate it computes server-side.
 */
export async function getAccountDeletionImpact(): Promise<AccountDeletionImpact> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { clubsChangingHands: 0, ridesToCancel: 0, ridersAffected: 0 }

  const [clubRows, rideRows] = await Promise.all([
    unwrapList(
      await supabase
        .from('clubs')
        .select('id, members_count:club_members(count)')
        .eq('owner_id', user.id),
      'clubs you own',
    ) as unknown as { id: string; members_count: { count: number }[] | null }[],
    unwrapList(
      await supabase
        .from('rides')
        .select('id')
        .eq('organizer_id', user.id)
        // The same boundary `/rides` cuts its two sections at, not the clock.
        // Against `now` this count disagreed with the list for the rest of the
        // day: a ride the app still calls upcoming, and still draws a `Going`
        // pill on, went missing from the sheet warning the rider what deleting
        // their account destroys. The cascade takes it either way.
        .gte('departure_at', rideDayStartUtc())
        .limit(ACCOUNT_DELETION_RIDES_LIMIT),
      'your upcoming rides',
    ) as unknown as { id: string }[],
  ])

  // "At least one other member" — a club where this rider is the only row
  // is the one D2 deletes rather than transfers, so it does not belong in a
  // count captioned "will change hands".
  const clubsChangingHands = clubRows.filter(
    (row) => (row.members_count?.[0]?.count ?? 0) > 1
  ).length

  // Excludes the organizer's own `ride_members` row (reviewer finding #4 of
  // the first pass, 2026-08-16) — an organizer typically holds one, so
  // summing the plain embedded count included the departing rider in their
  // own "riders affected" figure. `AccountDeletionImpact.ridersAffected` is
  // documented as "who finds a ride gone", and the departing rider is not
  // that.
  //
  // **Distinct riders, not rows — reviewer finding #3 of the second pass,
  // 2026-08-16.** A rider crewing two of the departing organizer's upcoming
  // rides used to count twice: `count: 'exact', head: true` counts MATCHING
  // ROWS, and PostgREST has no `count(distinct …)` this query builder can
  // ask for. Reading the actual `user_id` values and sizing a `Set` is the
  // only way to ask "how many people", rather than "how many crew slots".
  const ridersAffected = rideRows.length
    ? new Set(
        (
          unwrapList(
            await supabase
              .from('ride_members')
              .select('user_id')
              .in('ride_id', rideRows.map((row) => row.id))
              .neq('user_id', user.id)
              .limit(ACCOUNT_DELETION_RIDERS_LIMIT),
            'riders on your upcoming rides',
          ) as unknown as { user_id: string }[]
        ).map((row) => row.user_id)
      ).size
    : 0

  return {
    clubsChangingHands,
    ridesToCancel: rideRows.length,
    ridersAffected,
  }
}

/**
 * The countries a rider has marked, oldest first.
 *
 * No block filtering here and there must not be: 014's SELECT policy inherits
 * the profiles predicate through an `exists`, so a blocked rider's countries are
 * already absent from what this reads. Re-filtering in application code would be
 * a second copy of a rule 009 owns — the same mistake `getRideCrew`'s header
 * warns about, and the one the `is_public` subtraction bug came from.
 *
 * Unbounded on purpose, unlike the crew roster: the primary key caps a rider at
 * one row per country, so the ceiling is `COUNTRY_TOTAL` — around 250 two-letter
 * strings — and is a property of the schema rather than a hope about behaviour.
 */
export async function getProfileCountries(userId: string): Promise<string[]> {
  const supabase = await resolveSupabase()

  const rows = unwrapList(
    await supabase
      .from('profile_countries')
      .select('country_code')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
    'your countries',
  )

  return rows.map((row) => row.country_code as string)
}

/**
 * Whether this rider has opted out of analytics — PD-353.
 *
 * **Its own accessor rather than a field on `my_onboarding_state()`**, and the
 * four reasons are in `openspec/changes/add-analytics-consent/design.md`. The
 * worst of them first: `guard-cache.ts` holds that call's answer for the whole
 * page load *because both onboarding stamps are immutable for a session's
 * lifetime*, and this one is a toggle a rider can flip twice in a minute. It
 * also has PD-304's read-refills-after-invalidate race in its machinery, no
 * routing decision reads it, and folding an analytics preference into the
 * consent accessor is PD-353's forbidden pattern one layer down — the opt-out
 * is a SEPARATE stamp from the T&C consent, and bundling it in is specifically
 * what does not count.
 *
 * `096` grants the column to nobody: it is in none of `025`'s three lists, so
 * this `security definer` accessor is the only way any client reads it, and no
 * other rider can reach it through a member list, a byline or a PostgREST
 * filter. `030`'s `terms_version` is the same shape.
 *
 * **It throws on a failed read rather than answering `false`**, which is the
 * `unwrap` convention here and matters more than usual for this one. Two
 * callers want opposite things from a failure: the settings sheet needs to draw
 * an error state, which it cannot do if the failure arrives as a value; and the
 * boot path needs capture to stay OFF, which it gets by catching and applying
 * nothing. Answering `false` would serve neither — it would show a
 * confidently-wrong toggle AND turn a network blip into consent.
 */
export async function getAnalyticsOptOut(): Promise<boolean> {
  const supabase = await resolveSupabase()
  // **A TIMESTAMP or null, never a boolean.** `096` returns the stamp itself so
  // the answer carries *when* as well as *whether*, which is the idiom
  // `terms_accepted_at` and `onboarding_completed_at` already use. Comparing
  // this to `true` type-checks against `unwrap`'s generic and reads every rider
  // as opted IN — which is the failure direction, and it is invisible without
  // a real database because there is nothing to disagree with.
  const stamp = unwrap(await supabase.rpc('my_analytics_opt_out'), 'your privacy settings')
  return stamp !== null
}
