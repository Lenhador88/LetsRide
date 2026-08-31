# Club Timeline — the club detail becomes one chronological stream

> Linear **PD-299** — *"A club is a container, not a place"*, proposal **#4 of five** (*"Activity
> feed on the Timeline"*). That issue is the epic; this file is the specification and the issue
> must not restate it (`CLAUDE.md` §The roadmap lives in Linear: *"A Linear issue that grows a
> specification is a bug."*). **PD-299 has no sub-issue for #4 yet** — `add-club-threads` was
> split into PD-307, and the epic's own comment of 2026-08-27 confirms #2–#5 stay on it. Opening
> the story is the main thread's; this agent does not write to Linear.

## ⚠ Read this first — three corrections, and what is second-hand

**1. There IS a v2 Figma frame for this, and the brief for this proposal said there was not.**
`Private club - Timeline` (`2043:10604`) is not merely the old sub-page's name — **it draws the
activity stream this change is asking for**, complete with event rows. Measured, offline:

```bash
npm run figma -- tree "Private club - Timeline"
```

It draws, top to bottom: `v2 / Component / Timeline / Upcoming Rides` (a horizontal
`Collection / Ride` scroller), then a vertical stream alternating full `Postcard` blocks with
`Events` groups, separated by a `Divider` — a 2×16 `Grey/10%` rule that is the timeline's spine.
An `Event` is a `Grey/10` row: a 28px `v2 / Component / Avatar`, one `Poppins/14/Regular`
sentence, and a `Time Since` in `Poppins/12/Regular`. The three sentences it draws are
**"Ron Wilson joined the club."**, **"Pedro Abreu created the club."** and **"Pedro Abreu and
Julia Windfield went on a ride!"**. Consecutive events group with an 8px internal divider; the
divider between an events group and a postcard is 16px.

**So composition is measured, not ours**, for everything except three things this change adds
that the frame predates: the identity block at the top, the action layer, and the thread event —
Threads did not exist when the frame was drawn. Those three go in
`docs/FIGMA-FIDELITY-TODO.md` §Club detail, along with the two places the product owner's
instruction departs from the frame (see §What this supersedes).

**2. PD-299's own table is wrong about what this costs, and so is
`docs/FIGMA-FIDELITY-TODO.md`.** Both say the activity feed *"needs a table nothing writes
today"* / *"would need an `events` table written by triggers, or a union of derived queries with
no shared ordering key"*. Measured: **all four event sources already exist, each with a
`timestamptz` the client may read, and there is a shared ordering key** — it is the timestamp.
This change adds **no migration**. See §What Changes.

**3. Everything below is measured against `letsride-dev` (`fpmrimzxadewsaiwpsel`) on
2026-08-31**, and each claim carries the command that re-derives it. The Linear half is
first-hand: `get_issue PD-299` and `list_comments PD-299` were both called, and the epic's one
comment is quoted where it bears. Nothing here is inferred from `CLAUDE.md`'s numbers.

## Why

The club detail is a stack of six sections — Club rides, Postcards, a join button, Threads,
Members, and the identity block — each with its own heading, its own `See all`, its own empty
state and its own create affordance. It was merged into one screen on 2026-08-18 to stop the
sub-page switcher hiding its own options; the merge worked and the screen is now long enough
that the product owner reads it as confusing. Six headings is six decisions about what to look
at.

**A timeline replaces the decision with an order.** What happened, most recent first. And it
closes the joins half of the one thing `docs/reference/product-scope.md`'s Clubs row still logs
as unbuilt: *"the Timeline's activity feed (no table behind joins/leaves)"*.

**It needs a proposal rather than a ticket for one reason above all the others.** Today each
section on the club detail decides for itself what a rider who cannot see its rows is told, and
two of the six already refuse to lie: `ClubThreadsSection` shows a non-member *"Join the club to
read and start threads"* and never an empty list, and `ClubPostcardCarousel` shows them
*"Postcards in this club are for its members."* **Merging four differently-audienced reads into
one stream deletes those six independent decisions and replaces them with one** — and the
default answer, "draw whatever came back", turns a busy club into three join rows for the rider
deciding whether to join it. That failure is silent, renders green, and is invisible to every
gate in this repo.

## What Changes

**No migration. Zero.** All four sources exist today with a readable timestamp and their own
SELECT policy:

| Event | Source | Ordering key | Readable by |
|---|---|---|---|
| A postcard was posted | `postcards` | `created_at` | `(author_id = auth.uid()) OR (NOT is_blocked(…) AND (club_id IS NULL OR is_club_member(club_id)) AND NOT hidden)` |
| A ride was created | `rides` | `created_at` | `(organizer_id = auth.uid()) OR (NOT is_blocked(…) AND ((is_public AND is_club_public(club_id)) OR is_club_member(club_id) OR has_live_ride_invite(id)))` |
| A thread was started | `club_threads` | `created_at` | `EXISTS(club) AND is_club_member(club_id) AND (author_id = auth.uid() OR NOT is_blocked(…))` |
| A rider joined | `club_members` | `joined_at` | `(is_club_member(club_id) OR club.is_public) AND (user_id = auth.uid() OR NOT is_blocked(…))` |
| The club was created | `clubs` | `created_at` | already on the screen — `getClub` returns `created_at` and `owner_id` |

```sql
select tablename, policyname, qual from pg_policies
 where schemaname='public' and cmd='SELECT'
   and tablename in ('postcards','rides','club_threads','club_members');
```

`club_members.joined_at` is **server-owned and cannot be forged**: `048` revoked it from the
INSERT and UPDATE grants, so `authenticated` holds `insert (club_id, role, user_id)` and nothing
else.

```sql
select privilege_type, string_agg(column_name, ', ' order by column_name)
  from information_schema.column_privileges
 where table_schema='public' and table_name='club_members' and grantee='authenticated'
 group by 1;   -- INSERT: club_id, role, user_id · SELECT: club_id, joined_at, role, user_id
```

### The screen

`/clubs/detail` is re-laid out into four bands, in this order:

1. **Identity** — the avatar/name header (unchanged), then the type line, the location line and
   the description `ExpandableText`, then the Members rail. All four move from the *bottom* of
   today's screen to directly under the header.
2. **Upcoming rides** — the existing `RideChip` strip, unchanged in composition, keeping
   `clubTimelineRides`' upcoming-first/past-reserve split.
3. **The action layer** — three tiles: **Plan a ride**, **Add a postcard**, **Threads**. Threads
   carries an aggregate unread mark. Member-only, in its entirety.
4. **The timeline** — the merged stream, ending in a terminal row that hands off to the four
   full lists.

### What dissolves

- **`ClubPostcardCarousel`** stops being a section. Its postcards become timeline entries drawn
  as `PostcardStamp` (not the frame's full `Postcard` block — see `design.md` §D4). Its `Add`
  tile and its section `(+)` become the action layer's **Add a postcard**.
- **`ClubThreadsSection`** stops being a section. Its threads become timeline entries carrying
  their own unread dot. Its `See all`, its `(+)` and — critically — its unread signal become the
  action layer's **Threads** tile.
- **Neither component is deleted in this change.** Both are re-pointed; `ClubThreadsSection`'s
  non-member rule is the thing being generalised, not removed.

### New code

- **Two new functions in `src/lib/data/clubs.ts`.** `getClubRecentJoins(clubId)` — the same
  table and the same policy as `getClubMembers`, ordered `joined_at DESC` with its own bound,
  because `getClubMembers` orders ASC and caps at `CLUB_ROSTER_LIMIT` 200 and therefore returns
  the 200 **earliest** members. And `getClubRecentRides(clubId)` — **the second one was not in
  this change's brief and is not optional**: `getRides({kind:'club'})` windows and orders on
  `departure_at`, so the set it returns is not the set ordered by `created_at`, and a ride
  created yesterday for next June sits in a different place in each. Both are indexed today;
  see `design.md` §D7 for the one that is not and its trigger.
- **`src/components/clubs/clubTimeline.ts` is renamed.** It holds `clubTimelineRides`,
  `CLUB_TIMELINE_RIDES` and `CLUB_TIMELINE_PAST_MIN`, all of which are about the **ride strip**
  and none of which are about this timeline. Two different things called `clubTimeline` on one
  screen is a collision that costs a session; it becomes `clubRideStrip.ts` /
  `clubRideStripRides` / `CLUB_RIDE_STRIP_*`, and the merge helper this change adds takes the
  freed name.
- **One new pure module**, `src/components/clubs/clubTimeline.ts` — `mergeClubTimeline`, which
  takes the four (five, with the club's own creation) lists and returns the ordered, horizon-
  truncated stream. Pure, for the reason `guard.ts`, `resolveComboboxKey` and
  `clubTimelineRides` are pure: **the coherence horizon is the whole correctness of this change
  and no other gate in this repo can see it.** `tsc`, ESLint, the RLS suite and `next build` all
  stay green through a timeline that silently drops half a club's history.
- **One new cache key**, `queryKeys.clubs.timeline(clubId)` for the joins read, and one for
  `recentRides`. Both children of `clubs.detail`, so `clubs.all()` reaches them.

## What this supersedes

The docstring on `src/app/(app)/clubs/detail/page.tsx` records the **club detail merge of
2026-08-18** — the change that deleted `ClubDetailPageMenu` and `/clubs/detail/about` and turned
four sub-pages into one screen. **This change is that merge's successor and does not undo it**:
the sub-page switcher stays deleted, `/clubs/detail/members` and `/clubs/detail/rides` stay as
`See all` destinations, and the 96px header stays. What it supersedes is the merge's *ordering*
decision — the merge put content first and identity last, and this change inverts that on the
product owner's instruction of this session.

**Two deviations from `Private club - Timeline` are the product owner's and are recorded here
rather than argued:**

- **The frame opens with the rides strip; this screen opens with identity.** Owner, this
  session, asked directly: *"members and the small club description should go all the way to the
  top?"* — confirmed yes.
- **The frame's only action is a `Create postcard` primary button in the navigation bar; this
  screen has a narrow action layer in the content.** The nav bar in that frame is also the
  five-tab one, which PD-100 retired.

Both go in `docs/FIGMA-FIDELITY-TODO.md` §Club detail.

## Non-Goals

- **No authored announcement.** "Announcement" is the product owner's word for the *automatic*
  event row and names nothing a rider composes. There is no announcements table, no admin
  composer, no pin. Stated as a non-goal rather than omitted, because "Announcements" in a
  changelog reads as a feature and the next session would build the table.
- **No "a rider left" event.** A leave DELETEs the `club_members` row; there is no row left to
  read and there never will be under this design. The consequence runs further than the missing
  entry and is specified rather than discovered — see `spec.md`'s requirement on derived
  history.
- **No "went on a ride" event**, though the frame draws one. It would be `ride_members.joined_at`
  against a ride's crew, which is a fan-out per ride rather than a fifth flat read, and the
  sentence the frame draws (*"Pedro Abreu and Julia Windfield went on a ride!"*) needs a
  collapse rule this change does not have. Logged, not built.
- **No "new since your last visit" divider.** The screen already mounts `MarkClubSeen`, which
  advances `feed_reads.last_seen_at` to `now()` on mount, so the boundary is consumed by the
  very screen that would draw it. Doing it properly is a read-before-write ordering against a
  component that fires in an effect, and `feed_reads.last_seen_at` has no accessor today — only
  the aggregated `club_unread_counts` RPC. See `design.md` §D6.
- **No infinite scroll and no pagination.** The timeline has one bound and ends in a handoff.
- **No migration, so no new RLS assertions.** `openspec/config.yaml`'s tasks rule pairs
  assertions with migrations; this change adds neither. It adds *client* assertions instead —
  see `tasks.md`.
- **No Realtime.** The timeline is a read on load, like every other list in this app that is not
  a chat.

## Impact

- **Affected specs** — a new capability `club-timeline`, plus deltas on `client-render-shell`,
  `client-cache-invalidation` and `database-enforced-integrity`.
- **Affected code** — `src/app/(app)/clubs/detail/page.tsx`, `src/components/clubs/*` (rename
  plus new `ClubTimeline`, `ClubEventRow`, `ClubActionLayer`), `src/lib/data/clubs.ts`,
  `src/lib/query/keys.ts`, `src/types/index.ts`, `docs/FIGMA-FIDELITY-TODO.md`,
  `docs/reference/product-scope.md`.
- **Affected database** — none.
