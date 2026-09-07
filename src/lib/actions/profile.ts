import { resolveSupabase } from '@/lib/supabase/resolve'
import { applyAnalyticsPreference } from '@/lib/analytics/client'
import { clearRiderLocation } from '@/lib/location/rider-location'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { unwrap } from '@/lib/data/unwrap'
import { AVATAR_IMAGE_PATH_RE, COVER_IMAGE_PATH_RE, MEDIA_BUCKET } from '@/lib/media/constants'
import { countryCodeSchema, locationSchema, profileEditSchema } from '@/lib/validation/profile'
import type { ActionState } from '@/lib/actions/state'

/**
 * Saves the editable part of a rider's own profile.
 *
 * Replaces the v1 `EditProfileForm`, which called `supabase.from('profiles')`
 * from a client component and then `router.refresh()`. That pattern is v1 twice
 * over: it puts a write in the browser where CLAUDE.md puts writes in actions,
 * and it validated nothing — a 10 MB bio was a valid submission.
 *
 * `.eq('id', user.id)` is **not** a re-filter of RLS. The profiles UPDATE policy
 * (`001`) already restricts the write to `auth.uid() = id`, so this cannot widen
 * anything; it is here because an `update()` with no filter is a full-table
 * statement that the policy then narrows, and writing it that way relies on the
 * policy for correctness rather than for authorization. The distinction matters
 * the day someone reads this line in isolation.
 *
 * `.select('id')` for the same reason `setUsername` uses it: PostgREST reports
 * no error when an update matches zero rows, so without it a missing profile
 * row reads as a successful save.
 */
export async function updateProfile(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  // **No `location`, since PD-425** — `setRiderTown` is that column's only
  // writer now. Reading it back off this `FormData` would parse `null` for a
  // form that no longer renders the field, and `optionalText`'s string gate runs
  // before its transform, so every save would be refused; making it tolerate the
  // absence instead would write NULL and erase the town `LocationSetting` holds.
  const parsed = profileEditSchema.safeParse({
    bio: formData.get('bio'),
    bike_model: formData.get('bike_model'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to edit your profile.' }

  const { data: updated, error } = await supabase
    .from('profiles')
    .update(parsed.data)
    .eq('id', user.id)
    .select('id')
    .maybeSingle()

  if (error) return { error: 'Could not save your profile. Try again.' }
  if (!updated) return { error: 'Your profile could not be found. Sign in again.' }

  invalidate(queryKeys.profile.all())
  return { error: null, sent: true }
}

/**
 * Writes the town a rider says they ride from, or clears it — PD-419.
 *
 * ## It is the column's ONLY writer, since PD-425
 *
 * `updateProfile` used to write `location` too, off the profile form's free-text
 * box — the second door this comment used to explain how to live beside. That
 * box is gone: it sat directly above PD-419's `LocationSetting` under the same
 * heading, "Where you ride from", accepting any string while the control below
 * it told the rider that string could not be placed. `profileEditSchema` no
 * longer carries a `location` member at all, so there is no longer a second
 * writer to stay consistent with.
 *
 * The shape stays a plain argument rather than a `FormData`, as
 * `updateAvatar`/`setAnalyticsOptOut` already do — writing one column through
 * the form's action would need the other two fields supplied and would overwrite
 * a bio the rider is halfway through editing.
 *
 * `001`'s profiles UPDATE policy restricts the write to `auth.uid() = id` and
 * `018`'s CHECK bounds the text; `locationSchema` is the client-side half of
 * that bound.
 *
 * ## Clearing is `null`, and it has to actually be possible
 *
 * PD-419's decision obliges withdrawal: *"the profile setting shows none
 * alongside device and you told us, and clearing back to none works."* So `null`
 * is a first-class argument rather than an error, and it writes SQL NULL rather
 * than the empty string — `localityOf` treats `018`'s permitted string of spaces
 * as no locality, but a stored `''` would still make `getMyLocationText` answer
 * truthy-empty and read as a town nobody typed.
 *
 * ## The memo is the part that is easy to miss
 *
 * `resolveRiderLocation()` caches its resolved chain for `GEOLOCATION_MAX_AGE_MS`
 * inside `rider-location.ts`, and that memo is module state rather than a cache
 * entry — so invalidating the query keys alone leaves every screen re-reading a
 * five-minute-old answer built from the OLD town. `clearRiderLocation()` is what
 * makes the next resolve go back to the chain. Both are needed and neither
 * substitutes for the other.
 */
export async function setRiderTown(town: string | null): Promise<ActionState> {
  // **`null` never reaches the schema, and that is not a shortcut.**
  // `locationSchema` is `optionalText(…)`, a **`ZodString`** pipeline —
  // `z.string().trim().max(100).transform(v => v || null)`. Its string type gate
  // runs BEFORE the transform, so `safeParse(null)` fails with the raw
  // `"Invalid input: expected string, received null"`, which the profile
  // setting's live region would then render at a rider who tapped `Remove`.
  // Measured, not reasoned: the empty string parses to `null` cleanly, and
  // `null` — the one value `LocationSetting.clear()` ever passes — is the only
  // input that cannot get through.
  //
  // Clearing is the obligation PD-419's decision names in as many words
  // ("clearing back to none must work"), so it is a branch here rather than a
  // schema change. **Still a branch now that this schema has one caller**: the
  // type gate is a property of the `ZodString` pipeline, not of who shares it,
  // so widening it to accept `null` would trade a two-token branch for a schema
  // that no longer says a town is a string.
  const parsed = town === null ? null : locationSchema.safeParse(town)
  if (parsed && !parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to set where you ride from.' }

  const { data: updated, error } = await supabase
    .from('profiles')
    // SQL NULL for both routes into "nothing stored" — an explicit clear, and a
    // string the schema reduced to nothing. A stored `''` would make
    // `getMyLocationText` answer truthy-empty and read as a town nobody typed.
    .update({ location: parsed?.success ? parsed.data : null })
    .eq('id', user.id)
    .select('id')
    .maybeSingle()

  if (error) return { error: 'Could not save where you ride from. Try again.' }
  if (!updated) return { error: 'Your profile could not be found. Sign in again.' }

  // The module memo first, then the cache entries — see the header. Ordering is
  // not load-bearing (both happen before this returns and no read is in flight),
  // but doing the memo first means a refetch triggered by the invalidation
  // cannot possibly resolve against the stale one.
  clearRiderLocation()
  invalidate(queryKeys.profile.all())
  invalidate(queryKeys.riderLocation())

  return { error: null, sent: true }
}

/**
 * Points the profile at a freshly uploaded avatar or cover, and removes the
 * object it replaces.
 *
 * The upload already happened in the browser (see `uploadAvatarImage`) — this
 * only writes the column, because which object is *current* is the app's record
 * and a client must not own it. 014's CHECK constraints mean a path outside the
 * rider's own folder is refused by the database with 23514 before any policy
 * runs, so the path arriving from the client is untrusted input that cannot do
 * damage even if this action's own check were removed.
 *
 * **Deleting the old object is best-effort and ordered last on purpose.** If it
 * fails the rider still has a working new avatar and the app has leaked one
 * object; if it ran first and the update then failed, the profile would point at
 * an object that no longer exists — a visibly broken avatar rather than a
 * billing line. #24's Storage sweeper exists for exactly the leaked-object case
 * and can collect these too.
 */
async function setProfileImage(
  column: 'avatar_path' | 'cover_image_path',
  path: string
): Promise<ActionState> {
  const shape = column === 'avatar_path' ? AVATAR_IMAGE_PATH_RE : COVER_IMAGE_PATH_RE
  if (!shape.test(path)) return { error: 'That image could not be saved.' }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to edit your profile.' }

  const previous = unwrap(
    await supabase.from('profiles').select(column).eq('id', user.id).maybeSingle(),
    'your profile',
  ) as Record<string, string | null> | null

  const { data: updated, error } = await supabase
    .from('profiles')
    .update({ [column]: path })
    .eq('id', user.id)
    .select('id')
    .maybeSingle()

  if (error) return { error: 'Could not save that image. Try again.' }
  if (!updated) return { error: 'Your profile could not be found. Sign in again.' }

  const old = previous?.[column]
  if (old && old !== path) {
    await supabase.storage.from(MEDIA_BUCKET).remove([old])
  }

  invalidate(queryKeys.profile.all())
  return { error: null, sent: true }
}

export async function updateAvatar(path: string): Promise<ActionState> {
  return setProfileImage('avatar_path', path)
}

export async function updateCover(path: string): Promise<ActionState> {
  return setProfileImage('cover_image_path', path)
}

/**
 * Adds or removes one country. Two actions rather than one `setCountries(list)`
 * because the table is a set of rows keyed `(user_id, country_code)`, and a
 * whole-list write would be a delete-all plus re-insert — which loses
 * `created_at` on every unchanged row and turns a one-row change into a
 * transaction the size of the rider's whole map.
 *
 * The insert tolerates a duplicate rather than erroring: two taps on the same
 * flag is a double-tap, not a conflict, and the primary key is what makes the
 * second one a no-op.
 *
 * **`ignoreDuplicates: true` is load-bearing, not a preference.** Without it
 * supabase-js sends `Prefer: resolution=merge-duplicates`, which PostgREST
 * compiles to `ON CONFLICT DO UPDATE` — and Postgres checks UPDATE privilege
 * when it *plans* that statement, not when a conflict actually occurs. 014
 * deliberately grants no UPDATE on this table (a country is added or removed,
 * never edited), so the merge form fails `42501` on **every** insert, including
 * the first. The feature could not store a single row.
 *
 * `ignoreDuplicates: true` sends `resolution=ignore-duplicates` →
 * `ON CONFLICT DO NOTHING`, which needs only the INSERT grant 014 gives.
 *
 * This shipped green because the RLS assertion covering it issued a plain
 * `insert`, not the statement the action sends. A test that exercises a
 * different statement than production is not covering production — the suite
 * now issues the same `on conflict` form.
 */
export async function addCountry(code: string): Promise<ActionState> {
  const parsed = countryCodeSchema.safeParse(code)
  if (!parsed.success) return { error: 'That is not a country we know.' }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to edit your profile.' }

  const { error } = await supabase
    .from('profile_countries')
    .upsert(
      { user_id: user.id, country_code: parsed.data },
      { onConflict: 'user_id,country_code', ignoreDuplicates: true }
    )

  if (error) return { error: 'Could not save that. Try again.' }

  invalidate(queryKeys.profile.all())
  return { error: null, sent: true }
}

export async function removeCountry(code: string): Promise<ActionState> {
  const parsed = countryCodeSchema.safeParse(code)
  if (!parsed.success) return { error: 'That is not a country we know.' }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to edit your profile.' }

  // No `.eq('user_id', user.id)` would be a bug rather than a shortcut: the
  // DELETE policy filters to your own rows, so omitting it silently deletes
  // nothing for someone else's code rather than erroring — but it also makes
  // the statement's intent depend entirely on the policy. Stated here too.
  const { error } = await supabase
    .from('profile_countries')
    .delete()
    .eq('user_id', user.id)
    .eq('country_code', parsed.data)

  if (error) return { error: 'Could not remove that. Try again.' }

  invalidate(queryKeys.profile.all())
  return { error: null, sent: true }
}

/**
 * Flip the analytics opt-out — PD-353.
 *
 * Writes the stamp through `set_analytics_opt_out`, then tells the SDK, in that
 * order: the durable record is what a second device reads, and a rider who
 * taps the toggle and closes the tab must not come back opted in. The SDK call
 * cannot fail the action — `applyAnalyticsPreference` swallows its own errors —
 * so a rider is never told their preference did not save because a third-party
 * script was blocked.
 *
 * **It is a preference, never an authorization gate.** RLS enforces
 * authorization and never validity, and this is the case where that cuts the
 * other way: PostHog is a client-side SDK, so no policy can make an opt-out
 * true. The column is a remembered answer that this app honours, and the spec
 * claims exactly that and nothing stronger.
 */
export async function setAnalyticsOptOut(optOut: boolean): Promise<ActionState> {
  const supabase = await resolveSupabase()
  // `p_opt_out` is load-bearing as a NAME: PostgREST maps a parameter name to
  // the JSON key, so renaming it in the migration is a wire-format change.
  //
  // The function returns the EFFECTIVE stamp — a timestamptz when opted out,
  // null when not — so the SDK is told what the database actually recorded
  // rather than what was asked for. One message for every failure, matching the
  // shape `096`'s siblings use: no session is `42501`, no profile row `P0002`,
  // and a database that has not had `096` applied yet answers `PGRST202`.
  // Branching on those would tell a rider which, and none of them is
  // actionable from a toggle.
  const { data, error } = await supabase.rpc('set_analytics_opt_out', { p_opt_out: optOut })
  if (error) return { error: 'Could not save that. Try again.' }

  applyAnalyticsPreference(data !== null)
  invalidate(queryKeys.profile.analyticsOptOut())
  return { error: null }
}
