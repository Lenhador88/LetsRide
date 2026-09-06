import { resolveSupabase, type DataClient } from '@/lib/supabase/resolve'
import { CLUB_FILTER_EMBED_COLUMNS, PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import type { ClubTimelineWindow } from '@/lib/data/club-timeline'
import type { TimelineSource } from '@/lib/timeline/window'
import { resolveAvatarUrls, resolveClubImageUrls, signImagePaths } from '@/lib/data/media'
import { unwrap, unwrapList } from '@/lib/data/unwrap'
import { clubIdSchema } from '@/lib/validation/clubs'
import { rideIdSchema } from '@/lib/validation/rides'
import type {
  ClubFilterEmbed,
  FeedPage,
  Postcard,
  PostcardFilterOption,
  PostcardFilters,
  PublicProfile,
} from '@/types'


/** Which slice of the feed the home screen is showing. */
export type FeedFilter = { kind: 'rider' | 'club'; id: string }

type FilterRow = {
  image_path: string
  author: PublicProfile | null
  club: ClubFilterEmbed | null
}

// The raw shape PostgREST returns before the like state is folded in:
// `likes_count` arrives as the one-row aggregate array Supabase's `(count)`
// embed always produces, and `is_liked` does not exist yet.
type PostcardRow = Omit<Postcard, 'likes_count' | 'comments_count' | 'is_liked' | 'is_own'> & {
  likes_count: { count: number }[] | null
  comments_count: { count: number }[] | null
}

/**
 * Provisional. The design decides whether the feed pages or infinite-scrolls
 * and how many cards a screen shows, and the Figma file is currently
 * unreadable — see docs/FIGMA-FIDELITY-TODO.md. What is NOT provisional is
 * that the query is bounded at all: unbounded, the home screen selects every
 * postcard the viewer can see, on every render, forever.
 */
export const FEED_PAGE_SIZE = 30

// Explicit, not `*` — and after `062` that is a requirement rather than a
// preference: `authenticated` holds no table-level SELECT on `postcards` at
// all, only a seven-column grant, so a `*` here is `42501` for every rider.
//
// **`ride_id` is absent because the client cannot read it.** `041` shipped the
// column with SELECT left table-level, which made the raw uuid readable off
// every row the SELECT policy allows — comparable across postcards by a viewer
// who can resolve neither the ride nor its crew. PD-165 took it out of this
// list, and that was payload hygiene rather than a boundary: the app ships the
// publishable key and talks to PostgREST directly, so
// `GET /rest/v1/postcards?select=id,ride_id` returned it regardless of what
// this list said. `062` is what closed it, in the shape `columns.ts`'s header
// describes and `021`/`025` established — revoke the table-level grant,
// re-grant the columns that stay.
//
// **The Journal reads the tag through `public.ride_journal_postcard_ids`**, not
// off the column. That accessor exists because Postgres checks SELECT on a
// column to FILTER on it as well as to return it, so `.eq('ride_id', rideId)`
// wanted the identical grant the exposure did — PD-166 is the record of that
// fork and of the owner choosing the accessor. It returns ids; the rows are
// then read through this select list, under the caller's own RLS.
//
// **`064`'s five capture columns are granted and deliberately NOT here** —
// `taken_at`, `taken_at_offset_minutes`, `taken_latitude`, `taken_longitude`,
// `taken_location_precision`. Nothing draws a location or a capture time yet
// (the Journal is PD-257), and a field in this list is a field in every feed
// payload on every screen. The grant exists ahead of its reader for two reasons
// that are decisions rather than habit: a rider must be able to read back what
// they published, and `order by taken_at` needs the column privilege — Postgres
// checks a column reference in an ORDER BY exactly as in a target list, which is
// the same thing `062` measured for a predicate.
//
// Adding them here is PD-257's to do, and it is a one-line change that needs no
// migration. What it must NOT become is a reason to widen the grant further.
//
// Add a field only when something below actually reads it, **and only when
// the newest `grant select (...) on public.postcards` names it** — `062` for the
// seven original columns, `064` for the five above. A column silently missing from a hand-written
// list like this one is not caught by tsc, ESLint or the build — the
// `as unknown as PostcardRow[]` casts a few lines down remove the compile-time
// check that would otherwise catch it. `columns.test.ts` pins both halves: this
// file's select literals never name `ride_id`, and this list never names a
// column `062` does not grant.
// **`taken_place_name` and `taken_country_code` do not exist on PROD yet, and
// reading either there would take the whole feed down rather than degrade.**
// `072`/`073`/`074` are DEV-only, and PostgREST answers an unknown column with
// an error that `unwrapList` throws — so every screen built on this select
// shows a permanent "try again" panel.
// **Five of them, not three**: `getFeed` backs `/postcards` AND `/profile` and
// `/profile/detail`, where the gate is `combineQueries`, so a whole nav tab
// becomes an error panel rather than losing a strip. Promoting
// this file to `main` REQUIRES `072`, `073` and `074` applied to PROD first,
// which is `docs/ENVIRONMENTS.md` §Migrations step 5 doing its ordinary job.
// Verify rather than assume, per PD-279:
//
//   information_schema.column_privileges, grantee 'authenticated',
//   table 'postcards' — both columns must be on PROD's SELECT list.
//
// None of the other four capture columns are selected: the caption draws a
// name, and a coordinate this app does not render is a coordinate it should not
// ship to the browser. `taken_country_code` (`074`) follows `taken_place_name`
// here for the same reason it follows it in the grant list — `PostcardCard`
// draws the flag immediately before the town, never on its own.
const POSTCARD_SELECT = `
  id, author_id, club_id, image_path, caption, created_at, updated_at,
  taken_place_name, taken_country_code,
  author:profiles!author_id(${PUBLIC_PROFILE_COLUMNS}),
  club:clubs(id, name),
  likes_count:postcard_likes(count),
  comments_count:postcard_comments(count)
`

/**
 * Folds two per-viewer things into a page of postcards: the like count (an
 * aggregate over whatever `postcard_likes` rows RLS lets this viewer see, so a
 * blocked rider's like never counts for the rider who blocked them — see 009
 * §4) and `is_liked` (did *this* viewer like it). The count is read straight
 * off the embed; `is_liked` needs its own query because the embed answers "who
 * liked this that I can see", not "did I".
 *
 * That second query filters on `user_id`, which looks like the re-filtering
 * trap the brief warns against — it isn't. The postcard_likes SELECT policy
 * scopes *visibility* (your own rows, plus anyone else's you're not blocked
 * by); it does not scope to "mine only". Asking "which of these are mine" is
 * business logic the policy has no opinion on.
 */
async function attachLikeState(
  supabase: DataClient,
  rows: PostcardRow[],
  viewerId: string | undefined
): Promise<Postcard[]> {
  const likedIds = new Set<string>()

  if (viewerId && rows.length > 0) {
    const ownLikes = unwrapList(
      await supabase
        .from('postcard_likes')
        .select('postcard_id')
        .eq('user_id', viewerId)
        .in('postcard_id', rows.map((row) => row.id)),
      'your likes',
    )
    ownLikes.forEach((like) => likedIds.add(like.postcard_id))
  }

  // Signed on the way out rather than at the call site: the `media` bucket is
  // private, so a postcard without `image_url` renders nothing at all. Doing it
  // here means a future screen cannot forget, and one batched request covers
  // the whole page.
  const imageUrls = await signImagePaths(rows.map((row) => row.image_path), supabase)

  // The byline avatar, signed alongside the photos. A separate pass rather than
  // one merged batch because the two are different Storage folders with
  // different SELECT policies — a postcard you may see does not imply its
  // author's avatar is readable (they may have blocked you since), and 014's
  // policy is what decides.
  await resolveAvatarUrls(rows.map((row) => row.author), supabase)

  return rows.map((row) => ({
    ...row,
    // Both counts arrive as the one-row aggregate array Supabase's `(count)`
    // embed always produces, and both are counted under RLS — so a blocked
    // rider's like or comment never counts for the rider who blocked them.
    likes_count: row.likes_count?.[0]?.count ?? 0,
    comments_count: row.comments_count?.[0]?.count ?? 0,
    is_liked: likedIds.has(row.id),
    // Which overflow menu the card shows. Computed here rather than passed down
    // as a viewer id, because the deck is a client component two levels below
    // the only place the session is known — and because it is the same shape as
    // `is_liked`: a per-viewer answer the card renders rather than derives.
    //
    // It decides presentation only. `deletePostcard` is authorized by 009's
    // DELETE policy, so a forged `is_own` changes which rows are drawn and not
    // which rows can be destroyed.
    is_own: !!viewerId && row.author_id === viewerId,
    image_url: imageUrls.get(row.image_path) ?? null,
  }))
}

/**
 * The app-wide feed, newest first. Deliberately has no `club_id` filter on the
 * unfiltered path: the postcards SELECT policy already unions "club_id is null"
 * (the app-wide feed) with "club_id the viewer belongs to" (their clubs' posts)
 * with "authored by the viewer" (even a club they've since left), so restating
 * any of that here would be the exact drift trap 009 warns about — a second
 * copy of a predicate that can silently disagree with the policy it duplicates.
 *
 * **The `club` filter DELEGATES to `getClubFeed` since `086` (PD-328), and the
 * delegation is load-bearing rather than tidy.** Both reads share one cache
 * key — `postcards.feed(filterSegment.club(id))` — so widening only one of them
 * would put two different lists under one entry and make the club's strip and
 * its own `See all` disagree by however many ride postcards exist, with the
 * winner decided by which the rider opened first. `tsc`, ESLint, Vitest, the
 * RLS suite and `next build` are all blind to that.
 */
export async function getFeed(
  { before, limit = FEED_PAGE_SIZE }: FeedPage = {},
  filter?: FeedFilter
): Promise<Postcard[]> {
  if (filter?.kind === 'club') return getClubFeed(filter.id, { before, limit })

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  let query = supabase
    .from('postcards')
    .select(POSTCARD_SELECT)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (before) query = query.lt('created_at', before)

  // Narrowing *within* what the policy already allows. This does not restate
  // the audience rule — a rider filter still cannot surface a club postcard the
  // viewer is not a member of, because the policy runs first either way.
  if (filter?.kind === 'rider') query = query.eq('author_id', filter.id)

  const rows = unwrapList(await query, 'the postcard feed')
  return attachLikeState(supabase, rows as unknown as PostcardRow[], user?.id)
}

/**
 * The riders and clubs behind the current feed window, for the filter bar.
 *
 * Derived from the same bounded window the feed itself reads rather than from
 * separate `profiles` / `clubs` queries. Two reasons: the filter bar must never
 * offer a filter that yields an empty deck, and going through `postcards` means
 * one policy decides what appears here and what appears in the deck. Asking
 * `clubs` directly would be a second visibility predicate to keep in step.
 */
/**
 * Postcards this rider has not seen, against their app-wide watermark and
 * excluding their own — `public.count_unseen_postcards()` (079).
 *
 * This replaces `rows.length` — the number of postcards on page one of the
 * feed, presented as a total. That was the same defect review caught on
 * `/profile`, and here it was structural: the tile said 30 forever once there
 * were thirty postcards, whatever the rider had already looked at.
 *
 * **No watermark means everything is unseen**, which is right rather than a
 * fallback: a rider who has never finished the deck genuinely has not seen it.
 * The club counter defaults to `joined_at` instead, because joining a five-year
 * old club should not badge it with five years of history; there is no
 * equivalent moment for the app-wide feed.
 *
 * `count_unseen_postcards()` is `security invoker`, so it runs under the
 * caller's own RLS — blocks, hides and club membership are excluded by the
 * same policies the deck obeys, matching `club_unread_counts()` (068), and it
 * excludes the reader's own postcards for the same reason that one does. The
 * two used to disagree — composing a postcard into a club left the club
 * badge-free while this tile still read `+1` for the thing just written —
 * because this was a client-side query nothing in `supabase/tests/` could
 * reach; `079` moved it beside its sibling, under the same gate, so the two
 * cannot drift apart again.
 */
async function countUnseenPostcards(supabase: DataClient): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0

  const { data, error } = await supabase.rpc('count_unseen_postcards')
  if (error || data === null) return 0
  return data
}

export async function getPostcardFilters(limit = FEED_PAGE_SIZE): Promise<PostcardFilters> {
  const supabase = await resolveSupabase()

  const rows = unwrapList(
    await supabase
      .from('postcards')
      .select(
        `image_path, author:profiles!author_id(${PUBLIC_PROFILE_COLUMNS}), club:clubs(${CLUB_FILTER_EMBED_COLUMNS})`
      )
      .order('created_at', { ascending: false })
      .limit(limit),
    'your postcard filters',
  ) as unknown as FilterRow[]

  // The filter bar draws a rider's face on their tile, so it needs the same
  // signing pass the deck gets. Missed on the first pass, which would have left
  // every tile showing initials the moment avatars started being uploaded.
  //
  // Club tiles were missed for longer and for a different reason: they read
  // `clubs.avatar_url`, which parsed, typed and rendered — and was NULL on every
  // row, so the tile showed initials and looked settled. `024` dropped the
  // column; this pass is what actually draws the club's avatar.
  //
  // Two signing passes, run concurrently: a rider embeds only `avatar_path`,
  // a club also carries `cover_image_path` for PD-284's banner-behind-avatar
  // tile, and `resolveAvatarUrls` deliberately never touches that second
  // column (see its own header) — `resolveClubImageUrls` is the pass that does.
  await Promise.all([
    resolveAvatarUrls(rows.map((row) => row.author), supabase),
    resolveClubImageUrls(rows.map((row) => row.club), supabase),
  ])

  const riders = new Map<string, PostcardFilterOption>()
  const clubs = new Map<string, PostcardFilterOption>()

  for (const row of rows) {
    if (row.author) {
      const existing = riders.get(row.author.id)
      if (existing) existing.count += 1
      else
        riders.set(row.author.id, {
          kind: 'rider',
          id: row.author.id,
          name: row.author.username ?? 'Rider',
          imageUrl: row.author.avatar_url,
          coverUrl: null,
          count: 1,
        })
    }
    // A null club is the app-wide feed, not an unnamed club — it has no tile.
    if (row.club) {
      const existing = clubs.get(row.club.id)
      if (existing) existing.count += 1
      else
        clubs.set(row.club.id, {
          kind: 'club',
          id: row.club.id,
          name: row.club.name,
          imageUrl: row.club.avatar_url,
          coverUrl: row.club.cover_image_url,
          count: 1,
        })
    }
  }

  const collagePaths = rows.slice(0, 4).map((row) => row.image_path)
  const signed = await signImagePaths(collagePaths, supabase)

  return {
    total: await countUnseenPostcards(supabase),
    collage: collagePaths.map((path) => signed.get(path)).filter((url): url is string => !!url),
    riders: [...riders.values()],
    clubs: [...clubs.values()],
  }
}

/**
 * A club's postcards — those posted TO it and those taken on its own RIDES
 * (`086`, PD-328). Two steps, on `getRideJournal`'s shape and for the same
 * reason.
 *
 * ## Why the ride half cannot be a widened `.eq()`
 *
 * `club_id` IS the audience, so a postcard taken on the club's ride but posted
 * app-wide carries `club_id null` and the old filter could never see it. And it
 * cannot be found by `ride_id` either: `062` revoked `select (ride_id)` from
 * `authenticated` PRECISELY so the raw uuid could not be used to group
 * postcards, and Postgres checks a column privilege to FILTER on a column as
 * well as to return it. So the correlation is
 * `public.club_stamp_postcard_ids` — `security definer`, ids only — and these
 * rows are then re-read under the caller's own RLS, exactly as the Journal
 * does. **No second filter by club, membership or block is applied here**: the
 * accessor and this read have already applied the audience rule and a third
 * copy is a third place for it to drift.
 *
 * ## The cap is on the IDS, not only on the query
 *
 * `getRideJournal`'s note applies unchanged: `.in('id', ids)` serialises every
 * id into the PostgREST query string, so an unbounded first step eventually
 * meets a URL-length wall rather than degrading.
 *
 * ## Both order keys, not one
 *
 * `044` made `created_at` server-owned at transaction time, so postcards
 * written in one transaction tie on it exactly — and `.in(…)` carries no
 * ordering guarantee of its own, so this `.order()` pair is what actually
 * orders the result, matching the accessor's own `created_at desc, id desc`.
 *
 * `[]`, never `null`: a club with nothing on its strip and a club whose strip
 * the viewer cannot resolve look identical from here, and `getClub` has already
 * turned "no such club" into `null` for the page to act on.
 */
/**
 * `club_stamp_postcard_ids`' OWN hard clamp — `086` line 135:
 * `limit greatest(least(coalesce(page_size, 30), 100), 0)`. The accessor
 * will never return more than this many ids no matter what `page_size` it is
 * asked for, so `getClubFeedWindow`'s escalation ladder (below) must clamp
 * its own requests to it and compare saturation against the CLAMPED value —
 * asking for more than this and comparing against the raw ask is what let a
 * page the accessor answers in full read as "short" on the last rung.
 */
export const CLUB_FEED_ACCESSOR_MAX_PAGE_SIZE = 100

/**
 * How many times `getClubFeedWindow` may re-ask `club_stamp_postcard_ids`
 * for a bigger page when a saturated page's every id gets filtered by this
 * rider's own RLS, before it stops climbing (either this many rounds, or
 * `CLUB_FEED_ACCESSOR_MAX_PAGE_SIZE`, whichever the ladder reaches first).
 * At `FEED_PAGE_SIZE = 30` the ladder is 30 → 60 → 100 — it reaches the
 * accessor's own ceiling on the last rung rather than overshooting it.
 */
export const CLUB_FEED_HORIZON_ESCALATIONS = 2

/**
 * The club timeline's own read — `getClubFeed`'s exact shape, widened to a
 * `ClubTimelineWindow<Postcard>` (`design.md` §D3, PD-375). `getClubFeed`
 * below is now a thin wrapper over this, so the two cannot drift.
 *
 * **The horizon comes from the ACCESSOR's id count against `page_size`, not
 * from the second read's rows.** `club_stamp_postcard_ids` returns up to
 * `page_size` ids under its own audience rule; the second, ordinary
 * `postcards` read then re-reads those ROWS under the CALLER's own RLS, and
 * may legitimately return fewer — a blocked author, a hide, a policy this
 * rider's own state changes. Measuring the horizon on that second read would
 * make a window that saturated the accessor but lost every row to RLS read
 * as SHORT — no horizon, `complete` true, the club's founding drawn beneath
 * postcards nobody fetched. Two other sources follow the identical rule —
 * `getClubJoins` measures before its username filter, `getClubThreadReplies`
 * before its collapse.
 *
 * **When a saturated page has zero survivors, this ESCALATES rather than
 * guessing a horizon.** The accessor returns `(id, from_ride)` with no
 * `created_at` (`086`), so there is nothing to build a horizon from until a
 * row actually survives — the escalation re-asks the SAME accessor call
 * with a bigger `page_size` (`before` unchanged; it looks further INTO the
 * same window, never past it), clamped to
 * `CLUB_FEED_ACCESSOR_MAX_PAGE_SIZE` and compared against that clamped
 * value. It stops the moment EITHER a bigger page turns up a survivor (the
 * horizon is that batch's own oldest surviving row's `created_at` — at least
 * as new as the true boundary, never older, so this errs toward cutting a
 * little MORE than the true boundary rather than toward asserting a
 * completeness that is not there), or the accessor itself answers short of
 * the (clamped) page size — genuine completion, horizon `null`.
 *
 * **Only once `CLUB_FEED_HORIZON_ESCALATIONS` rounds or the accessor's own
 * ceiling are BOTH exhausted with zero survivors throughout** — a full
 * 100-row page entirely filtered, the genuinely adversarial "the whole
 * recent window is one blocked author" case — does this fall back to
 * `before ?? now()`: `before` on a deeper page (an honest "no progress",
 * since `absorbClubTimelineWindow` folds a window whose horizon equals its
 * own `until` into an empty covered interval) or `new Date().toISOString()`
 * on the first page (no `before` to fall back to; more aggressive than the
 * true boundary, but the alternative is the false-complete signal this
 * function exists to close).
 */
export async function getClubFeedWindow(
  clubId: string,
  { before, limit = FEED_PAGE_SIZE }: FeedPage = {}
): Promise<ClubTimelineWindow<Postcard>> {
  // Before `resolveSupabase()`, the guard `getRideJournal` carries for its ride
  // id and for the same reason: a non-uuid reaches the RPC as `22P02`,
  // PostgREST turns it into a 400 and `unwrapList` throws, which puts a rider
  // on the error boundary where a not-found belongs (PD-142).
  if (!clubIdSchema.safeParse(clubId).success)
    return { rows: [], horizon: null, until: before ?? null, untilInclusive: false }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  // `untilInclusive: false` on every return below: the accessor compares
  // `created_at < before` (`086` line 130), never `<=` — `design.md` §D3's
  // stated exception to "every deeper window is inclusive". The residue: two
  // postcards in one club sharing a `created_at` to the microsecond and
  // straddling a page boundary lose the one below the cut. `044` writes the
  // column at transaction time, which makes it merely very unlikely rather
  // than impossible; the remedy is a keyset `before_id` argument on the
  // accessor, which is a migration this change does not take.
  for (let escalation = 0; ; escalation++) {
    // Clamped BEFORE the call, and saturation is compared against this
    // clamped value rather than the raw escalated one — the accessor cannot
    // answer more than `CLUB_FEED_ACCESSOR_MAX_PAGE_SIZE` regardless of what
    // it is asked for, so asking for more and comparing against the ask is
    // what made a page it answered IN FULL read as short.
    const pageSize = Math.min(limit * 2 ** escalation, CLUB_FEED_ACCESSOR_MAX_PAGE_SIZE)
    const atAccessorCeiling = pageSize >= CLUB_FEED_ACCESSOR_MAX_PAGE_SIZE

    const correlated = unwrap(
      await supabase.rpc('club_stamp_postcard_ids', {
        club: clubId,
        before: before ?? null,
        page_size: pageSize,
      }),
      "this club's postcards",
    ) as { id: string; from_ride: boolean }[] | null

    if (!correlated || correlated.length === 0)
      return { rows: [], horizon: null, until: before ?? null, untilInclusive: false }

    const window = correlated.slice(0, pageSize)
    const saturated = window.length >= pageSize
    const fromRide = new Map(window.map((row) => [row.id, row.from_ride]))

    const rows = unwrapList(
      await supabase
        .from('postcards')
        .select(POSTCARD_SELECT)
        .in('id', window.map((row) => row.id))
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(pageSize),
      "this club's postcards",
    )

    const postcards = await attachLikeState(supabase, rows as unknown as PostcardRow[], user?.id)
    // Carried from the accessor rather than recomputed: `club_id` is readable
    // here, but `ride_id` is not, so the client has no way to tell an
    // app-wide postcard that reached this strip through a ride from one that
    // did not.
    const withFlag = postcards.map((postcard) => ({
      ...postcard,
      from_ride: fromRide.get(postcard.id) ?? false,
    }))

    // Genuine completion: the accessor itself came back short of THIS
    // round's (clamped) page size — there is nothing further to find by
    // asking again, however few of these rows survived.
    if (!saturated)
      return {
        rows: withFlag,
        horizon: null,
        until: before ?? null,
        untilInclusive: false,
      }

    // A survivor exists — the ordinary case, and the round we stop at is
    // whichever one found it, so `rows` and `horizon` always agree.
    if (withFlag.length > 0)
      return {
        rows: withFlag,
        horizon: withFlag[withFlag.length - 1].created_at,
        until: before ?? null,
        untilInclusive: false,
      }

    // Saturated AND zero survivors: escalate further only while there is
    // still room to grow — both budget (`CLUB_FEED_HORIZON_ESCALATIONS`)
    // and headroom (`!atAccessorCeiling`). Asking again at the same clamped
    // `pageSize` would return the identical page.
    if (!atAccessorCeiling && escalation < CLUB_FEED_HORIZON_ESCALATIONS) continue

    // Either budget is spent or the accessor's own ceiling is reached, with
    // zero survivors throughout — the genuinely adversarial case named in
    // this function's own header.
    return {
      rows: withFlag,
      horizon: before ?? new Date().toISOString(),
      until: before ?? null,
      untilInclusive: false,
    }
  }
}

export async function getClubFeed(
  clubId: string,
  page: FeedPage = {}
): Promise<Postcard[]> {
  return (await getClubFeedWindow(clubId, page)).rows
}

export async function getPostcard(id: string): Promise<Postcard | null> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  // maybeSingle, not single: `single()` treats "no row" as an error, which
  // would now throw for a postcard the viewer simply may not see. Not found and
  // could-not-ask stay distinct.
  const data = unwrap(
    await supabase.from('postcards').select(POSTCARD_SELECT).eq('id', id).maybeSingle(),
    'that postcard',
  )

  if (!data) return null

  const [postcard] = await attachLikeState(supabase, [data as unknown as PostcardRow], user?.id)
  return postcard
}

/**
 * A ride's Journal — the postcards tagged to it, newest first (`041`,
 * PD-256). Two steps, because `062` moved the filter off the column:
 * `public.ride_journal_postcard_ids` (`security definer`, ids only) says which
 * postcards belong to this ride, and this then reads those rows through the
 * ordinary `POSTCARD_SELECT` path, under the caller's own RLS — so the
 * `postcards` SELECT policy still decides every row that renders, exactly as
 * it does for the feed. **No second filter by club, membership or block is
 * applied here**: both the accessor and this read have already applied the
 * audience rule, and a third copy is a third place for it to drift.
 *
 * **Both keys in the second query's order, not one.** `044` made `created_at`
 * server-owned at transaction time, so a rider posting several tagged
 * postcards in one transaction ties on it exactly — `id desc` is what keeps
 * that page deterministic, matching the accessor's own `created_at desc, id
 * desc`. `.in(…)` does not preserve the order the accessor returned its ids
 * in, so this is the only thing that actually orders the result.
 *
 * An empty source, never `null` — a ride with nothing tagged to it and a ride
 * whose Journal the viewer cannot resolve look identical from here, matching
 * `getClubFeed`'s convention: there is no "no such ride" case for this
 * function to report, because `getRide` already turned that into `null` for
 * the page to act on.
 *
 * **Bounded at `FEED_PAGE_SIZE`, and the cap is applied to the IDS rather than
 * only to the second query.** `getClubFeed` is bounded the same way and the
 * first draft of this function described itself as matching it while carrying
 * no `.limit()` at all. Two things go wrong unbounded, and the second is the
 * one a limit on the query alone would not fix: every render of the ride plan
 * selects every postcard ever tagged to that ride, and `.in('id', ids)`
 * serialises each id into the PostgREST query string — so a long-running ride
 * eventually meets a URL-length wall rather than degrading.
 *
 * ## The horizon, and why it is counted from the IDS rather than from the rows
 *
 * It returns a `TimelineSource` since PD-393, because the ride timeline merges
 * it against the join stream and a bounded read that does not say how far back
 * it looked produces a confidently wrong tail — `mergeRideTimeline` has the
 * argument. This is the "a read that post-processes owes its own horizon" case
 * `TimelineSource.horizon` names, and here the post-processing is the id slice:
 * `boundedHorizon` over the ROWS would report a horizon on a ride with exactly
 * `FEED_PAGE_SIZE` postcards and nothing behind them, cutting the join stream
 * at that instant for no reason. The accessor answers every id the caller may
 * see, so `ids.length` is the exact answer to "is there more behind this", and
 * the horizon is the oldest row we actually drew.
 */
export async function getRideJournal(rideId: string): Promise<TimelineSource<Postcard>> {
  if (!rideIdSchema.safeParse(rideId).success) return { rows: [], horizon: null }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const ids = unwrap(
    await supabase.rpc('ride_journal_postcard_ids', { ride: rideId }),
    "this ride's journal",
  )
  if (!ids || ids.length === 0) return { rows: [], horizon: null }

  const rows = unwrapList(
    await supabase
      .from('postcards')
      .select(POSTCARD_SELECT)
      // The accessor answers `created_at desc, id desc`, so the slice is the
      // newest window rather than an arbitrary one — and the `.order` below is
      // still what orders the result, because `.in()` carries no ordering
      // guarantee of its own.
      .in('id', ids.slice(0, FEED_PAGE_SIZE))
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(FEED_PAGE_SIZE),
    "this ride's journal",
  )
  const postcards = await attachLikeState(supabase, rows as unknown as PostcardRow[], user?.id)

  return {
    rows: postcards,
    // See the horizon paragraph above: the ids are the exact answer to "is
    // there more behind this", and a row the second read dropped is one the
    // accessor said we could see, so the oldest we DREW is how far back this
    // source's picture reaches.
    horizon:
      ids.length > FEED_PAGE_SIZE && postcards.length > 0
        ? postcards[postcards.length - 1].created_at
        : null,
  }
}
