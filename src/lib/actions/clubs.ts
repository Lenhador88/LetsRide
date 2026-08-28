import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'
import { MEDIA_BUCKET } from '@/lib/media/constants'
import {
  clubSchema,
  readClubLocation,
  type ClubLocationInput,
} from '@/lib/validation/clubs'
import type { ActionState } from '@/lib/actions/state'

/**
 * One nullable object in the schema, four columns in the table (`066`).
 *
 * **Always all four keys, including on the `null` branch**, which is what makes
 * "the rider cleared it" a real edit rather than a no-op: an update that simply
 * omitted them would leave the old location standing while the form said
 * otherwise. `clubs_location_coupling` refuses any other combination, so this
 * is the only shape either write can take.
 */
function locationColumns(location: ClubLocationInput) {
  return {
    location_name: location?.location_name ?? null,
    location_place_id: location?.location_place_id ?? null,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
  }
}

/**
 * Nothing but async functions may be exported from a `'use server'` module — a
 * plain const fails at *module evaluation* the moment a client component
 * imports it, taking the whole route down rather than the one value. That is
 * not hypothetical: it is how `/postcards/new` shipped dead. Shared constants
 * belong in `lib/actions/state.ts`.
 *
 * **This module no longer carries the directive**, so that rule no longer binds
 * it — writes run in the browser now. The split stays anyway, and the rule is
 * kept here rather than deleted because it is enforced for any module that gets
 * the directive back (`src/__tests__/use-server-exports.test.ts`).
 */

/**
 * What joining or leaving a club makes stale.
 *
 * `clubs.all()` is the prefix over both lists, the detail and its member roster
 * — but **it is not the whole blast radius, and the naive translation missed
 * that.** The third path these two actions used to revalidate was
 * `` `/clubs/${clubId}` ``, and that is a *route*: re-rendering it refetched the
 * club, its timeline feed AND its ride strip, because all three are read by the
 * page at that path. Only the first of those three lives under the `clubs`
 * prefix. The other two are `postcards.feed('club:<id>')` and
 * `rides.list('club:<id>')`, which sit under `postcards` and `rides`.
 *
 * The symptom, found by review rather than by a test: a rider who looked at a
 * public club's timeline before joining, then joined, then went back inside the
 * 30s stale window, saw the pre-join content — an empty timeline for a club they
 * were now in.
 *
 * This is the exact failure `keys.ts` predicts for a path-shaped claim that
 * covers more than its own domain, and it is why `filterSegment` exists: the
 * strings below have to match the ones five screens build, and now both come
 * from the same place.
 */
/**
 * Exported since `085`: `approveClubJoinRequest` writes a `club_members` row
 * through an RPC and makes exactly the same things stale as `joinClub` does.
 * Calling this rather than enumerating keys there is deliberate — an
 * enumeration looks narrower and misses `clubs.mine()`, which is the recorded
 * reason this helper exists at all.
 */
export function invalidateClubMembership(clubId: string) {
  invalidate(queryKeys.clubs.all())
  invalidate(queryKeys.postcards.feed(filterSegment.club(clubId)))
  invalidate(queryKeys.rides.list(filterSegment.club(clubId)))
  // PD-177, and the one entry here that is about VISIBILITY rather than
  // content. `036` §3's SELECT policy carries a resolvability `EXISTS` per
  // rendered resource, evaluated under the caller's own RLS — so membership
  // decides whether a notification is returned at all. A `ride_created_in_club`
  // row names a ride somebody else organised: leave the club and
  // `private.is_club_member` turns false, the club arm and (for any ride that
  // is not public) the ride arm both stop resolving, and the row leaves this
  // rider's list and their unread count without a single notification row being
  // written or deleted. Joining restores it. Nothing else in this file moves a
  // notification — see `keys.ts`.
  invalidate(queryKeys.notifications.all())
}

/**
 * Creates a club and makes its creator the owner.
 *
 * Replaces the v1 page, which inserted from the browser: it decided the owner
 * client-side, wrote `role: 'owner'` itself, and enforced no length rule at all,
 * because `001` declares `name` and `description` as bare `text`. Parsing here
 * is the only thing between a form and a megabyte of club name.
 *
 * **Two inserts and no transaction, which matters.** PostgREST has no
 * multi-statement transaction, so the membership row is a second round trip that
 * can fail on its own — leaving a club whose owner is not a member of it. That
 * club is missing from *Your clubs*, which reads membership; it is **not**
 * invisible, as this comment used to claim. `008`'s SELECT policy has an
 * `owner_id = auth.uid()` arm, and a public one shows on Explore to every rider
 * and is joinable. The old page had exactly this hole and did not check the
 * second result. This
 * one does, and rolls the club back by hand so a partial create cannot survive.
 * The real fix is a `security definer` function doing both in one statement, and
 * it is a migration; recorded rather than pretended away.
 *
 * **The rollback below stopped being a rollback when this module left the
 * server, and that is a real change rather than a restatement.** As a Server
 * Action, both inserts and the compensating delete ran inside one server request
 * that completed whether or not the tab survived. They run in the browser now,
 * so all three depend on it staying alive and cooperating — closing the tab
 * between the two inserts leaves a club with an owner and no membership row.
 * That state went from *reachable only on a Supabase error* to *reachable on
 * demand*.
 *
 * It is an integrity problem and not a confidentiality one: `019` means the
 * abandoner cannot forge a role on the way through, and `008`'s SELECT policy
 * has an `owner_id = auth.uid()` arm so the creator can still *see* the club —
 * it is `getYourClubs` reading membership that hides it, which makes this a UI
 * orphan rather than a database one. A public one shows on Explore to everyone
 * and is joinable.
 *
 * The fix is the same `security definer` function this comment has named since
 * it was written, doing both inserts in one statement. Nothing asserts "a club
 * has an owner-membership row" as a CHECK or trigger, and that is the actual
 * gap. Logged in docs/HANDOFF.md §Known issues.
 *
 * Images are already in Storage by the time this runs — the client uploads
 * first, so a failure here leaves an orphaned object rather than a club pointing
 * at nothing, which is the same direction `/postcards/new` fails in and the
 * survivable one. `npm run storage:sweep` is what collects them.
 */
export async function createClub(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = clubSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description'),
    is_public: formData.get('is_public') === 'on',
    avatar_path: (formData.get('avatar_path') as string) || null,
    cover_image_path: (formData.get('cover_image_path') as string) || null,
    location: readClubLocation(formData),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to create a club.' }

  // `location` is destructured OUT rather than spread: it is one object in the
  // schema and four columns in the table, so `{ ...parsed.data }` would post a
  // `location` key PostgREST answers with PGRST204 ("column not found").
  const { location, ...columns } = parsed.data

  const { data: club, error } = await supabase
    .from('clubs')
    .insert({ ...columns, ...locationColumns(location), owner_id: user.id })
    .select('id')
    .single()

  if (error || !club) return { error: 'That club could not be created.' }

  // `role` is stated here and nowhere else in this file: 001 defaults it to
  // 'member', and the creator is the one membership that is not.
  const { error: membershipError } = await supabase
    .from('club_members')
    .insert({ club_id: club.id, user_id: user.id, role: 'owner' })

  if (membershipError) {
    // The rollback can fail too, and discarding its error is how "could not be
    // created" becomes a lie: the club survives, invisible on Your clubs (which
    // reads membership) and visible on Explore to everyone. The rider retries
    // and owns two. Surfacing it is not a fix — the fix is one statement in a
    // security definer function — but it stops the message contradicting the
    // state.
    const { error: rollbackError } = await supabase.from('clubs').delete().eq('id', club.id)
    if (rollbackError) {
      return {
        error: 'That club was only partly created. Check your clubs before trying again.',
      }
    }
    return { error: 'That club could not be created.' }
  }

  // Both club lists at once: `clubs.all()` is the prefix over `yours`,
  // `explore` and `mine` (the picker on the create-ride and create-postcard
  // forms), which the two `revalidatePath` calls this replaces covered between
  // them — and the picker, which neither did, because no route drew it.
  invalidate(queryKeys.clubs.all())
  return { error: null, redirectTo: routes.club(club.id) }
}

/**
 * Advances this rider's read watermark for one club to now (015).
 *
 * Called when the club is *opened*, which is the only moment that means "you
 * have seen what was new here". The alternative — advancing it when the list
 * renders — would clear every badge on the screen the rider was using to decide
 * which club to open.
 *
 * `upsert` rather than insert-or-update, on the `(user_id, club_id)` unique
 * index. The index is `nulls not distinct`, which is what makes the app-wide
 * row (`club_id is null`) collide with itself correctly when the postcard
 * filter tiles start writing one; without it every visit would insert another
 * row and this would never find a conflict to update.
 *
 * A failure is deliberately silent. The watermark is an optimisation of
 * attention, not a fact the rider asked to record — a club that opens fine but
 * keeps its badge is a far better outcome than an error banner over a page that
 * otherwise worked.
 */
export async function markClubSeen(clubId: string): Promise<void> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  // `last_seen_at` is sent and then DISCARDED. 068 hangs a BEFORE INSERT OR
  // UPDATE trigger on `feed_reads` that overwrites it with the server's `now()`,
  // for 061 §3's reason rather than for tamper-resistance: the value is compared
  // against `postcards.created_at` and `rides.created_at`, which 044 and 045
  // make server-generated, and a comparison with one clock on each side is
  // wrong in a way nothing logs — a phone running ten minutes fast marks read
  // everything posted in the next ten minutes.
  //
  // It is still sent because the column must be in the request body: PostgREST
  // builds `on conflict … do update set` over the columns the body carries, so
  // dropping it leaves a SET list of the two key columns and the advance on
  // every visit after the first depends on PostgREST still emitting a DO UPDATE
  // at all. Nothing in this repo can gate that, and a watermark that silently
  // stops advancing looks exactly like a badge that will not clear.
  await supabase
    .from('feed_reads')
    .upsert(
      { user_id: user.id, club_id: clubId, last_seen_at: new Date().toISOString() },
      { onConflict: 'user_id,club_id' }
    )

  // `yours` only, matching `revalidatePath('/clubs')` exactly rather than
  // widening to the `clubs` prefix. Explore is the one club list with no
  // counter to move: `getExploreClubs` deliberately calls `toClubListItem`
  // without an unread argument, because the design puts `Join club` in the slot
  // the badge occupies and `015` refuses a watermark for a club you have not
  // joined. Invalidating it here would refetch a list nothing changed on.
  invalidate(queryKeys.clubs.yours())
}

/**
 * Advances the **app-wide** watermark — `feed_reads.club_id is null`, the row
 * 015 created the shape for and left without a writer.
 *
 * Fired when the postcard deck is exhausted, which is the whole reason a
 * watermark is honest here. A watermark can only say "everything older than T
 * is read", and the deck is newest-first — so a rider three cards into twelve
 * has read a *prefix* no timestamp represents. Marking only at the end means the
 * badge is never wrong in the direction that hides something unseen.
 *
 * `club_id: null` relies on 015's `unique nulls not distinct`. Under a plain
 * UNIQUE this upsert would find no conflict and insert a second app-wide row
 * every time the rider finished the deck.
 */
export async function markFeedSeen(): Promise<void> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  // Same as `markClubSeen`: the timestamp is sent and discarded, 068's trigger
  // imposes the server's, and the column stays in the body so PostgREST keeps
  // it in the `on conflict … do update set` list. The reasoning is written out
  // once, above — do not "tidy" this line away in isolation.
  await supabase
    .from('feed_reads')
    .upsert(
      { user_id: user.id, club_id: null, last_seen_at: new Date().toISOString() },
      { onConflict: 'user_id,club_id' }
    )

  // The filter bar only, not the feed. `revalidatePath('/postcards')` re-ran
  // the whole page because a path is the smallest thing it can name; the
  // watermark moves the "All new" tile's count and nothing else. Refetching the
  // deck here would be worse than wasteful — this fires the moment the deck is
  // exhausted, so it would replace the card list underneath the "start over"
  // state the rider is looking at.
  invalidate(queryKeys.postcards.filters())
}

/**
 * Joins a club — the `Join club` link on every `Clubs - Explore` row.
 *
 * This is the migration of the last v1 write in the app. `JoinClubButton` was
 * the final component calling `supabase.from()` in the browser and then
 * `router.refresh()`; per CLAUDE.md that pattern migrates on contact, and the
 * clubs epic is the contact.
 *
 * There is no authorization check here and that is correct rather than an
 * omission: 001's `club_members` INSERT policy is `auth.uid() = user_id`, and
 * the clubs SELECT policy is what decides whether a private club's id could
 * have been discovered at all. Re-deciding either in application code is how
 * the `is_public` subtraction bug got shipped twice.
 *
 * `role` is left to its default. Promotion to admin is a screen nobody has
 * designed, and passing 'member' explicitly would state a rule the database
 * already owns.
 */
export async function joinClub(clubId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to join a club.' }

  const { error } = await supabase
    .from('club_members')
    // Pressing Join twice is a no-op rather than an error. `ignoreDuplicates`
    // for the same reason likes and hides use it — but NOT for the reason this
    // comment used to give. It said there is no UPDATE grant on club_members;
    // there was a table-level one, and after 048 there is a column-level one.
    // What is actually missing is the UPDATE *policy* — the table has none at
    // all (036 §7.6 relies on that: nobody can promote an admin) — so RLS, not
    // a grant, is what would refuse the default on-conflict-update. The
    // conclusion was right and the mechanism named was not.
    .upsert({ club_id: clubId, user_id: user.id }, { onConflict: 'club_id,user_id', ignoreDuplicates: true })

  if (error) return { error: 'That club could not be joined.' }

  invalidateClubMembership(clubId)
  return { error: null }
}

/**
 * Leaves a club.
 *
 * The row goes, and 015's FK cascade takes the watermark with it — so rejoining
 * later reads as "everything since you rejoined" rather than resurfacing a
 * year of history. That is a consequence of `on delete cascade` rather than a
 * decision made here, and it is the behaviour you would have chosen.
 *
 * No guard against the owner leaving their own club, which would orphan it.
 * `clubs.owner_id` has no such guard either — the design draws no ownership
 * transfer, and inventing one in an action while the database permits it would
 * put the rule in the weakest of the two places. Registered rather than fixed.
 */
export async function leaveClub(clubId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { error } = await supabase
    .from('club_members')
    .delete()
    .eq('club_id', clubId)
    .eq('user_id', user.id)

  if (error) return { error: 'You could not be removed from that club.' }

  invalidateClubMembership(clubId)
  return { error: null }
}

/**
 * Saves an owner's edit to their own club — PD-101, `club-lifecycle`.
 *
 * Bound to a specific `clubId` at the call site, the same shape `updateRide`
 * uses and for the same reason: the form carries no field for it.
 *
 * **The `.update()` payload is an explicit field list, never a spread** — see
 * `updateRide`'s own comment on this. It used to be the only thing keeping
 * `created_at` and `owner_id` out of the statement; **`045` made it
 * structural** (PD-163, 2026-08-10), granting UPDATE over these five columns
 * and no others, so both are refused with `42501` whatever this function
 * sends. `clubs.created_at` mattered more than `rides.created_at` did:
 * `getClubsToExplore` sorts on it, so a writable column meant an owner could
 * float their club to the top of Explore for every rider, permanently.
 *
 * `createClub` above is a **spread**, so this guarantee has never covered it —
 * its safety comes from Zod stripping unknown keys.
 *
 * Reads the row **before** writing it to learn which image paths a
 * replacement orphaned, swept the same way `setProfileImage` sweeps a
 * replaced avatar.
 *
 * It no longer reads `is_public` to decide whether to invalidate
 * `rides.all()`. That conditional was correct for 022's trigger — which
 * fires only on a real public -> private flip — and wrong for the reason
 * that turned up in review: `RIDE_SELECT` embeds `club:clubs(id, name)`, so
 * *every* save can stale a ride card whether or not privacy moved. Both
 * reasons land on the same key, so the unconditional call subsumes the
 * conditional one.
 */
export async function updateClub(
  clubId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = clubSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description'),
    is_public: formData.get('is_public') === 'on',
    avatar_path: (formData.get('avatar_path') as string) || null,
    cover_image_path: (formData.get('cover_image_path') as string) || null,
    location: readClubLocation(formData),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to edit a club.' }

  const { data: previous } = await supabase
    .from('clubs')
    .select('avatar_path, cover_image_path')
    .eq('id', clubId)
    .maybeSingle()

  const { data: club, error } = await supabase
    .from('clubs')
    .update({
      name: parsed.data.name,
      description: parsed.data.description,
      is_public: parsed.data.is_public,
      avatar_path: parsed.data.avatar_path,
      cover_image_path: parsed.data.cover_image_path,
      ...locationColumns(parsed.data.location),
    })
    .eq('id', clubId)
    .select('id')
    .maybeSingle()

  if (error) return { error: 'That club could not be saved.' }
  if (!club) return { error: 'That club is not yours to edit.' }

  const stalePaths = [
    previous?.avatar_path && previous.avatar_path !== parsed.data.avatar_path
      ? previous.avatar_path
      : null,
    previous?.cover_image_path && previous.cover_image_path !== parsed.data.cover_image_path
      ? previous.cover_image_path
      : null,
  ].filter((path): path is string => !!path)

  if (stalePaths.length > 0) {
    // Best-effort, swallowed on purpose — same reasoning as deletePostcard's
    // ordering note: the row already saved, so a failed cleanup costs
    // storage rather than the rider's edit.
    await supabase.storage.from(MEDIA_BUCKET).remove(stalePaths)
  }

  invalidate(queryKeys.clubs.all())
  // A club's name and avatar are EMBEDDED in three other domains' reads, and
  // none of them sits under the ['clubs'] prefix: postcards.filters() signs
  // club:clubs(id, name, avatar_path), RIDE_SELECT embeds club:clubs(id, name),
  // and notifications carry CLUB_EMBED_COLUMNS. Renaming leaves the old name on
  // ride cards; replacing the avatar is worse than stale, because the Storage
  // object was just deleted above — the cached signed URL is non-null and dead,
  // so the tile renders a broken image rather than falling back to initials.
  invalidate(queryKeys.postcards.all())
  // `all()` and not `list()`, which PD-177's rule alone would give an embed
  // change: the privacy toggle below propagates to this club's rides (022), and
  // an owner holding no club_members row loses the arm that resolves them — so
  // rows can leave the count as well as go stale in the list.
  invalidate(queryKeys.notifications.all())
  // rides.all() is invalidated unconditionally for the embed above. The privacy
  // flip is a second, independent reason: propagate_club_privacy_to_rides (022)
  // rewrites ride rows this call never named, one-directionally, on an actual
  // public -> private flip. Both land on the same key, so the embed covers it.
  invalidate(queryKeys.rides.all())

  return { error: null, redirectTo: routes.club(clubId) }
}

/**
 * Deletes an owner's own club — PD-101, `club-lifecycle`, `design.md` §D1.
 *
 * Calls `delete_owned_club(p_club_id)` (`043`) rather than a bare
 * `.from('clubs').delete()`, because the client is structurally incapable of
 * doing this safely: the `rides` DELETE policy has no club-owner arm, so an
 * owner holds no grant to delete a ride another member organised in their
 * club, and `rides.club_id`'s `ON DELETE SET NULL` would otherwise strand
 * every private ride visible only to its organizer with its crew and chat
 * unreadable. See `043`'s own comment and `design.md` §D1 for the two
 * rejected alternatives.
 *
 * A refusal — not owner, or no such club — comes back as one `42501` by the
 * function's own design, so this cannot and must not try to tell the two
 * apart in its message.
 */
export async function deleteClub(clubId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { data: orphaned, error } = await supabase.rpc('delete_owned_club', {
    p_club_id: clubId,
  })

  if (error) return { error: 'That club could not be deleted.' }

  // The club's own avatar and cover, returned because they sit under the
  // OWNER's uid prefix — the caller's own Storage policy reaches them.
  // Cascade-deleted postcards' images belong to other riders and are
  // permanently orphaned by design; that is PD-94's scope, not this
  // action's, and no path for them is returned to delete.
  const paths = ((orphaned ?? []) as { object_path: string }[])
    .map((row) => row.object_path)
    .filter(Boolean)
  if (paths.length > 0) {
    await supabase.storage.from(MEDIA_BUCKET).remove(paths)
  }

  invalidate(queryKeys.clubs.all())
  // Not a route claim either of the two originals ever made: club_members and
  // feed_reads are cascades under the `clubs` prefix already, but the function
  // also deletes rides (rides.all()) and their cascade takes postcards.club_id
  // with it (postcards.all()) — two domains this action never directly touched
  // a row in.
  invalidate(queryKeys.rides.all())
  invalidate(queryKeys.postcards.all())
  // PD-177. `notifications` is NOT under the `clubs` prefix — the rows cascade
  // in the database, the cache key does not. Deleting a club takes every
  // `club_joined` addressed to this owner with it, plus every
  // `ride_created_in_club` and every `postcard_liked`/`postcard_commented`
  // riding on the rides and postcards that cascade behind it. Rows leave the
  // list AND the unread count, so this is `all()` rather than `list()`.
  invalidate(queryKeys.notifications.all())
  return { error: null }
}
