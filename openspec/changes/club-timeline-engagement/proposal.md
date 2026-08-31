# Club Timeline Engagement — a rider can wave at an arrival and at a conversation

> **Q1 answered, 2026-08-31.** The share objection below stood and the product owner resolved it:
> a thread's share row shares the **club**, labelled `Share club`. No thread URL is handed out and
> no capability link is built. The objection is kept rather than deleted because the reasoning is
> what makes the chosen option defensible — and because this change now adds a **second caller** of
> `shareAppLink(routes.club(...))`, which still carries PD-299 #2's own defect on a PRIVATE club.
> See `design.md` §Q1.

> Linear **PD-299** — *"A club is a container, not a place"*. This extends **PD-355**
> (`openspec/changes/add-club-timeline/`), which merged today as **#350**, **#351** and **#352**.
> The story is **PD-356**.

## ⚠ Read this first

**1. One objection, and it is about the `share` icon rather than the wave.** The product owner's
second ask is *"maybe threads have the same wave, comment and share icons below?"* Two thirds of
that is good and is specified below. **The share third produces a wrong result and this change
refuses to build it.** `shareAppLink(routes.clubThread(id))` hands a URL to a screen `081`'s
SELECT policy refuses to every non-member, so the recipient lands on *content unavailable* — which
is **the exact live defect PD-299 was opened against**, in its own words: *"`ClubOptionsMenu` calls
`shareAppLink(routes.club(clubId))` unconditionally, and RLS refuses that route to a non-member — so
the rider you shared it with gets 'content unavailable'. Sharing a private club is broken today for
exactly the people you would share it with."* Adding a share row to a members-only thread re-creates
that defect in a new place while the epic that names it is still open. See §Q1 for the two ways out
and the recommended default.

**2. "Wave" is this app's word for a like, and that is measured rather than assumed.**
`LikeButton` renders `WaveIcon` — *"the motorcycle wave rather than a heart (PD-228) — the one
gesture every rider already knows"* — so `postcard_likes` **is** the wave table under an older
name. The owner's *"we may want to give a wave to those announcements"* therefore asks for the
reaction the app already has, on a surface that does not have it, and the strongest shape available
is the one already proved.

```bash
grep -rn "WaveIcon" src/components/postcards/LikeButton.tsx   # the glyph on postcard_likes
npm run figma -- icons | grep -i wave                          # Wave  4127:6925
```

**3. Everything below is measured against `letsride-dev` (`fpmrimzxadewsaiwpsel`) on 2026-08-31**,
and each claim carries the command that re-derives it. The Linear half is first-hand: `get_issue`
and `list_comments` were called on **PD-299** and on **PD-355**, and PD-355's one comment — which
records that `getClubThreadReplies` exists and that sources now *declare* their horizon rather than
the merge deriving it — is load-bearing for §What Changes and is quoted where it bears.

**4. Two of the owner's four asks are NOT in this change**, by instruction: the ride event drawing
a full `RideCard`, and the thread event showing a thread icon with participants and a message
count. Both are presentation with no schema and are being built in the same session. Named here so
a reader of this file does not conclude they were forgotten.

**5. One clause of the owner's ask is already shipped, and saying so is cheaper than building it
twice.** *"maybe instead of the thread icon it should be the person who joined avatar's?"* is
conditional on a join becoming a thread — and a join entry **already draws the joiner's face**.
`ClubTimelineEventRow`'s `join` branch returns
`avatar: { name: rider.username, avatarUrl: rider.avatar_url }`, and it is the only branch that
returns one; `thread`, `reply`, `ride` and `club-created` all return `null`, matching the frame,
which draws its ride event with no avatar. So the sub-ask is satisfied by the screen as merged this
morning, and declining the auto-thread (§D2) costs nothing against it.

```bash
grep -n "avatar:" src/components/clubs/ClubTimelineEventRow.tsx   # one non-null, in `case 'join'`
```

## Why

`add-club-timeline` made the club detail a stream of things that happened. **Every entry on it is
inert.** A rider arrives in a club and the club's answer is a 44px grey row that scrolls past; a
thread goes quiet and there is no way to say *good topic* short of typing into it. The postcard is
the one entry that is not inert, and it is not inert because `009` gave it a wave.

The product owner, 2026-08-31:

> an announcement, "person X joined the club", should also be some kind of discussion? People
> should then be able to say welcome, etc. And maybe instead of the thread icon it should be the
> person who joined avatar's? Also we may want to give a wave to those announcements?

> So maybe threads have the same wave, comment and share icons below?

Both are questions, and the underlying intent reads as **timeline entries should be engageable
rather than inert**. This change takes that intent and declines two of the four mechanisms it
could be built from, for reasons that are about visibility rules rather than taste.

**It needs a proposal rather than a ticket because a wave is an authored act by an identified
rider, and every one of its rules is a negative one.** Who may see a wave, whose wave counts in
whose total, what happens to a wave when its subject leaves the club, and whether waving notifies
anybody are four separate policies, and `009`'s answer to the first two is *correct and
counter-intuitive* in a way no screen makes visible.

## The four shapes, and the recommendation

**Recommended: shape 4's mechanism, applied to BOTH subjects, with joins staying derived.** Two
narrow `postcard_likes`-shaped tables — `club_thread_waves` and `club_join_waves` — and **no
auto-created thread on a join**. Words about a newcomer are served by a rider-initiated,
pre-filled thread compose that costs no schema at all (§D3).

| Shape | Verdict |
|---|---|
| **1** — a join auto-creates a `club_threads` row | **Declined.** Five separate defects, three of them structural. See §D2 |
| **2** — a generic reaction table over `(kind, subject_id)` | **Declined.** A polymorphic subject carries no foreign key, so nothing cascades, and one policy would have to restate three audiences — the drift this repo's design.md forbids. See §D5 |
| **3** — a wave only, no words | Half the answer; adopted as the *automatic* half |
| **4** — mirror `postcard_likes` | **Adopted, and generalised to the join subject** |

**Why shape 1 loses, in one paragraph.** `club_threads.author_id` is `NOT NULL` with no default
and a foreign key to `profiles ON DELETE CASCADE`, so a system-created thread must name a living
rider — and every candidate is wrong. Name the **joiner** and `081`'s DELETE policy lets them
delete the thread other riders welcomed them in, taking every message with it by cascade, and
their account deletion does the same. Name the **owner** and the app has published a rider's
username into an immutable title (`club_threads` has no UPDATE grant and no UPDATE policy) that
outlives their membership, that they cannot remove, and that keeps naming them after they leave.
And `058`'s Welcome club takes one join per signup, so the shape mints one thread per rider for
ever — which is why `private.notify_club_joined` already returns early for that club, measured
verbatim below. **Carving it out the same way is what makes the shape self-defeating**: the rider
with the emptiest app is the only one guaranteed to get no welcome.

```sql
select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='private' and p.proname='notify_club_joined';
-- if exists (select 1 from public.clubs c where c.id = new.club_id and c.is_default)
--   then return null; end if;      -- 058, measured on DEV 2026-08-31
```

## What Changes

**One migration, `092`.** Two tables, four policies each, two participation-gate triggers, one
fan-out, one retraction, one new notification type, and the RLS assertions `openspec/config.yaml`
requires beside them.

### The two tables

```
club_thread_waves (thread_id, user_id, created_at)          PK (thread_id, user_id)
club_join_waves   (club_id, subject_user_id, user_id, created_at)
                                                            PK (club_id, subject_user_id, user_id)
                  FOREIGN KEY (club_id, subject_user_id)
                    REFERENCES club_members (club_id, user_id) ON DELETE CASCADE
```

**The composite foreign key is the single most important line in this change**, and it is
available only because `club_members`' primary key is `(club_id, user_id)` — measured:

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.club_members'::regclass and contype = 'p';
-- club_members_pkey  PRIMARY KEY (club_id, user_id)
```

It makes a join wave cascade with **the membership row it decorates** rather than with the rider.
`add-club-timeline`'s spec already requires that *"a rider who leaves erases their own join
entry"* and that *"a rejoin is indistinguishable from a first join"*; without this key a wave
would outlive the event it sits on, become unreachable, and **reappear on the rejoin** — a rider
welcomed in March being silently re-welcomed in September by someone who did nothing. See §D4.

### Not one table

A single `club_waves` with two nullable subject columns and a `CHECK` on the shape is
`notifications`' own idiom and was weighed. It loses to the asymmetry above: the join subject
needs a **two-column** foreign key and the thread subject a **one-column** one, so one table
cannot carry both without denormalising `club_id` onto thread waves — a copy of
`club_threads.club_id`, which is the shape `database-enforced-integrity`'s *"A derived row SHALL
NOT hold a copy of a visibility decision"* exists to refuse. See §D5.

### Visibility is inherited, never restated

Each SELECT policy is `postcard_likes`' two conjuncts with the noun swapped:

| Table | Parent EXISTS (evaluated under the caller's own RLS) | Block arm |
|---|---|---|
| `club_thread_waves` | `exists (select 1 from public.club_threads t where t.id = thread_id)` | `user_id = auth.uid() or not private.is_blocked(auth.uid(), user_id)` |
| `club_join_waves` | `exists (select 1 from public.club_members m where m.club_id = … and m.user_id = subject_user_id)` | identical |

**Neither policy names membership, club visibility or a block on the subject**, because both
parents already do — measured, one policy at a time:

```sql
select tablename, policyname, qual from pg_policies
 where schemaname='public' and cmd='SELECT' and tablename in ('club_threads','club_members');
-- club_threads : EXISTS(clubs) AND private.is_club_member(club_id)
--                AND (author_id = auth.uid() OR NOT private.is_blocked(auth.uid(), author_id))
-- club_members : (private.is_club_member(club_id) OR EXISTS(clubs c … c.is_public))
--                AND (user_id = auth.uid() OR NOT private.is_blocked(auth.uid(), user_id))
```

That is `009`'s stated reason, transferred rather than re-derived: *"the EXISTS subquery is
evaluated under the querying rider's own RLS, so like visibility tracks postcard visibility exactly
rather than restating it… Restating it would be two predicates that have to be kept in step, and
the one that drifts is the one nobody reads."*

### The counts

**Per-viewer, computed under RLS, and never denormalised** — `009` refused a `like_count` column
for exactly this reason and the refusal transfers verbatim. The consequence is not obvious and is
specified rather than left to be discovered: **two members of one club see different totals on the
same thread and neither is told why**, and a rider blocked by everyone in the club still sees `1`
— their own, through the own-row arm. That is the correct trade against the alternative, which
discloses that a hidden rider exists and acted. §D6 states what it forbids.

### The fan-out

**A join wave notifies the rider who joined, and nothing else in this change notifies anybody.**
`notifications` gains a twelfth type, `club_waved`, whose subject shape is identical to
`club_joined`'s — `club_id` set, everything else NULL — so `notifications_event_key` collapses it
per `(recipient, waver, club)` with no new column and no new index. A thread wave notifies nobody;
§Q2 carries the default and the reason.

**This migration is additive in SCHEMA and its ordering constraint is in the CLIENT**, which is
`089`'s rule and not a new one: `notificationCopy` and `NotificationsListItem`'s `describe` are
exhaustive switches, so one `club_waved` row landing while an older bundle is serving takes that
rider's notifications screen down. It applies **after** the bundle that knows the type is confirmed
serving, on both projects.

### No new timeline source, and therefore no new horizon

The brief asks what horizon a new source declares. **The answer is that there is no new source.**
A wave decorates an entry that is already on the stream; it contributes no event, no ordering key
and no `ClubTimelineSource`, so `mergeClubTimeline` and `boundedHorizon` are untouched. Two reads
are added and both are **scoped to the ids already on screen**, `attachLikeState`'s shape. The
condition under which that stops being true is stated in the spec, because the obvious next feature
— *"Ana waved at Bruno"* as its own row — **would** be a source and **would** owe a horizon.

### New code

- **`src/lib/data/club-waves.ts`** — `attachClubWaveState`, one batched read per subject kind,
  folding `waves_count` and `is_waved` onto entries the timeline already holds.
- **`src/lib/actions/club-waves.ts`** — `waveThread` / `unwaveThread`, `waveJoin` / `unwaveJoin`.
  Four plain async functions, `invalidate` on the keys their rows appear under.
- **`ClubWaveButton`** — `LikeButton`'s two-state optimistic toggle, extracted rather than copied,
  keeping its `aria-pressed` rule and its constant accessible name.
- **Two cache keys**, both children of `clubs.detail(clubId)`.
- **A pre-filled thread compose from a join row** (§D3) — a route parameter on `CreateThreadForm`,
  no schema at all.

## What this supersedes

**Nothing in `add-club-timeline` is contradicted, and two of its requirements are extended
rather than replaced.** Its *"Timeline event rows SHALL be automatic only, and no authored
announcement SHALL exist"* stands: a wave is a reaction to a derived row, not a composed one, and
this change still adds no announcements table and no admin composer. Its *"The timeline SHALL be
derived from live rows"* stands and gains a fourth consequence — a wave dies with the row it
decorates.

**One requirement is genuinely modified.** `add-club-timeline` states that the timeline holds no
rows of its own. After this change it holds no *event* rows of its own and does hold reaction
rows, and the `club-timeline` delta says so in as many words rather than leaving the sentence to
be read as still literally true.

## Non-Goals

- **No auto-created thread on a join.** Declined on the merits, not deferred — §D2.
- **No share affordance on a thread.** §Q1, and the objection at the top of this file.
- **No wave on a ride announcement, a postcard entry or the club's founding.** A ride already has
  an RSVP, which is a stronger signal than a wave and would sit beside it saying something weaker;
  a postcard entry is a `PostcardCard`, which **already carries the wave** through `LikeButton`;
  and the founding row is about a club rather than a person and has nobody to address.
- **No comment count, participant list or thread icon on the thread event.** Being built in the
  same session without schema; not this change's.
- **No wave on a `reply` event.** The reply entry is a pointer at a conversation, and the
  conversation's own thread entry carries the wave. Two wave targets for one thread would produce
  two counts of the same thing.
- **No rate limit, and this is named rather than silent.** `036` §8 already records that *"nothing
  in this app rate-limits anything"*; the unique key means a wave cannot stack, so the exposure is
  a wave/unwave loop re-lighting one notification, which is exactly the bound `postcard_likes` has
  carried since `036`. Not widened here, not fixed here.
- **No Realtime.** A wave count is read on load like every other count in this app.
- **No moderation verb for a wave.** §D7.

## Impact

- **Affected specs** — a new capability `club-timeline-engagement`, plus deltas on `club-timeline`,
  `database-enforced-integrity`, `event-fanout-integrity`, `notifications`,
  `client-cache-invalidation` and `client-render-shell`.
- **Affected code** — `src/lib/data/club-waves.ts` (new), `src/lib/data/club-timeline.ts`,
  `src/lib/data/club-threads.ts`, `src/lib/actions/club-waves.ts` (new),
  `src/components/clubs/ClubTimeline.tsx`, `ClubTimelineEventRow.tsx`, `CreateThreadForm.tsx`,
  `src/components/ui/` (the extracted wave toggle), `src/lib/query/keys.ts`, `src/types/index.ts`,
  `docs/reference/schema.md`, `docs/reference/product-scope.md`.
- **Affected database** — `092`: two tables, eight policies, two participation-gate triggers
  (taking the count from **17** to **19**), one fan-out trigger, one retraction trigger, one
  widened `notifications` type CHECK and one widened `notifications_subject_shape`.

```sql
-- 17 today; 19 after 092. Count it rather than read it — a table added without one
-- looks exactly like this sentence being right.
select count(*) from pg_trigger
 where tgname = 'enforce_participation_gate' and not tgisinternal;
```
