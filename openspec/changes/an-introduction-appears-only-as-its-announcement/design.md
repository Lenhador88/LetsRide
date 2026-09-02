# Design — An Introduction Appears Only As Its Announcement

Everything here was measured against `letsride-dev` (`fpmrimzxadewsaiwpsel`) on **2026-09-02**, or
read out of the files named. Where something is inferred rather than measured it says so.

## D1 — The filter keys on the marker, not on the text

The two arms differ only after somebody leaves a club, which is why this needed writing down before
any code: on a club where nobody has left, both implementations return identical rows for ever.

**Arm A — `introduces_user_id is null` means "ordinary thread" (CHOSEN).**
**Arm B — `introduction is null` means "ordinary thread" (REJECTED).**

| | Arm A | Arm B |
|---|---|---|
| Current member's introduction | Announcement row only | Announcement row only |
| Ex-member's introduction | Listed as an ordinary thread, at its original position | Listed nowhere, for ever |
| Its comments | Reachable | Reachable only by URL |
| `094` moderation | Reachable by the ordinary route, which starts at the list | Reachable only by whoever holds the URL |
| The row's title | Literally `Introduction`, with `Started by ana` beneath | n/a |

**The decisive argument is `097`'s own.** That change spent a whole task on this exact confusion,
in the opposite direction — `tasks.md` §7.9: *"Gate the render on `introduction !== null` and
**never** on `introduces_user_id` — after a leave the marker is NULL and the text survives, so a
marker-gated render makes every ex-member's introduction and every comment under it vanish from a
thread that still exists."* Arm B is that same disappearance moved from the thread screen to every
list that could lead to it. A change filtering on `097`'s columns should not contradict `097`'s
reason for keeping them.

The second argument is moderation. `094` gives a club's owner and admins a takedown, entered from
the thread screen, which is entered from the Threads list. Under Arm B an ex-member's introduction
is unmoderatable in practice by anyone who does not already hold its URL — a real safety
consequence of a presentation decision, which is exactly the class of thing this proposal exists to
catch.

**What Arm A costs, and why each cost is acceptable:**

- *The title says `Introduction` and names nobody.* It is immutable — `club_threads` has no UPDATE
  grant and no UPDATE policy, which `097` chose deliberately so a living rider's username is never
  published into an immutable title. `ClubThreadRow` already renders
  `Started by {thread.author?.username ?? 'a rider'}` from `author_id`, which survives the leave.
  So the row reads `Introduction / Started by ana`, which is what it is.
- *A row appears in a list because somebody LEFT.* Until now the Threads list only grew when a
  thread was created. It grows at the thread's own `created_at`, so nothing jumps to the top and
  nothing notifies. The unread map already held that thread's state; §D3 keeps the two consistent
  by construction, so the row arrives with whatever unread state it always had.

**Inferred, not measured:** DEV holds **zero** ex-member introductions today
(`introduction is not null and introduces_user_id is null` → 0 of 3), so the ex-member arm cannot be
observed on DEV without making one. `tasks.md` §6 has the hand-exercise that creates one in a
rolled-back transaction.

## D2 — The filter goes in the query, and this is not a style choice

Three reads gain it. For each, applying it after the read breaks something with nothing red.

**`getClubThreads`.** The list page decides "is there more" with
`lastCount === CLUB_THREADS_PAGE_SIZE`. A post-read filter turns a full page of 20 holding 5
announcements into 15, which reads as the end of the list — every thread past that point becomes
unreachable, and the page-length-as-a-total defect this repo already paid for once comes back.

Worse and quieter: `ClubTimeline` computes that source's horizon with
`boundedHorizon(threads.data, CLUB_THREADS_PAGE_SIZE, …)`, and `boundedHorizon`'s own header
restricts it — *"Only for sources whose `rows` ARE the window. A read that filters or collapses must
compute its own."* A post-read filter silently violates the precondition of a function whose whole
job is to be right about that.

**`getClubThreadReplies`.** Its window is 200 club-wide messages, and `horizon` and `partial` are
measured on the window **before** the collapse. Keeping the filter in the query keeps that sentence
true word for word — the window is simply now 200 messages on listed threads.

Filtering afterwards would make the horizon mean *how far back we looked for rows we then threw
away*. A club with 150 introduction comments in its recent history would report a horizon an hour old
and cut every ride, postcard and join beneath it — for events the screen never draws. That is the
defect `collapseToNewestPerThread`'s header exists to pin, arriving through a filter instead of
through a collapse, and the same three gates would stay green on it.

**`getClubThreadUnread`.** §D3.

**Mechanism for the embed.** The reply read already carries
`thread:club_threads!inner(club_id, title)` and already filters `.eq('thread.club_id', clubId)` —
so filtering the embedded relation to scope the parent rows is the mechanism this query is built on,
not a new one. `introduces_user_id` joins the embed's select list so the filter names a column the
query is already reading. The grant is measured:

```sql
select privilege_type, column_name from information_schema.column_privileges
 where table_schema='public' and table_name='club_threads' and grantee='authenticated'
   and column_name in ('introduces_user_id','introduction');
-- SELECT, SELECT — and no INSERT, no UPDATE
```

## D3 — Narrowing the unread map

`club_thread_unread` is a database function returning `(thread_id, has_unread)` for **every** thread
in the club, and this change has no migration, so the RPC cannot be narrowed. Three ways to correct
it client-side:

| Option | Cost | Why not / why |
|---|---|---|
| (a) Intersect with `getClubThreads` page 1 | Free on the club detail | **Rejected.** Threads are listed by creation, so an old thread with a new comment sits past page 20 and its dot never lights. A false negative in a notification is worse than the false positive being fixed, and the menu item's own comment already refuses page-1 data as a fact |
| (b) Read every announcement id in the club | One read, bounded by the roster | **Rejected.** Bounded by members rather than by the answer |
| (c) Correct only the ids that could light something | One read, bounded by the unread set; **skipped entirely when nothing is unread** | **Chosen** |

(c) in full: the RPC answers; take the ids it marked `has_unread`; if there are none, return the map
as-is; otherwise read back which of those ids carry a marker and drop them.

**Failure rule.** If that read fails, the whole map resolves to `{}` — the function's existing rule
(*"A failure resolves to 'nothing is unread' rather than throwing … the marks decorate a list that
works without them"*). Returning unverified marks would reintroduce the very dot this decision
removes.

**Consequence, and it is the right one:** unread visibility and listing now move together by
construction. A thread is marked exactly while it is listed, so an ex-member's introduction returning
to the list brings its unread state with it, and a member's introduction leaves the list and the dot
at the same instant.

**What this gives up:** nothing on the club detail marks unread comments on a *current* member's
introduction. The exact comment count on the announcement row is the signal. `proposal.md` §Open
questions Q2 puts that to the product owner with a default of "leave it", because reversing it means
the map must keep announcements — the opposite of this decision — and is therefore a design change
rather than an implementation detail.

## D4 — The wave: what goes, what stays

**Goes (client, all of it).** `waveThread`, `unwaveThread`; `attachClubWaveState`'s `thread` branch
and `getThreadWaveState`; `queryKeys.clubs.threadWaves` and the claim-table row naming those two
writers; the `threadWaves` query and the `wave` prop in `ClubTimeline`; the `wave` prop, its render
and its import in `ClubTimelineThreadRow`.

**Stays.** `ClubWaveButton` and `resolveClubWaveState` — the join row is still their caller. The
whole database side: `club_thread_waves`, `092`'s policies, grants and participation gate, `098`'s
`notify_club_thread_waved` and `retract_club_thread_waved`, and every assertion over them.

**Why the table stays in this change.** Dropping it is destructive; it needs the RLS suite's `092.*`,
`098.*` and `100.*` assertions rewritten; it has the opposite deploy-ordering rule to a client change
(a destructive file goes after the bundle that stopped reading it is *confirmed serving*, not after
the merge); and it forces a decision about `notifications` rows already holding
`club_thread_waved` — that value is in the table's CHECK constraints, so removing it while rows carry
it makes the constraint unvalidatable. One destructive call, its own file, its own session.

**Measured state it will inherit:** 3 wave rows and 1 delivered `club_thread_waved` notification on
DEV. Those 3 rows become orphans the moment this merges — their authors may still delete them under
`092`'s DELETE policy and no affordance in the app reaches it.

**Not measured:** PROD's row counts. The same query against `zwprydcyryvudhurbnye` answers it, and
the successor should run it rather than carrying DEV's numbers.

## D5 — The two counts, and which one survives

An introduction has had two comment counts since `097`:

| Count | Where from | Property |
|---|---|---|
| **Exact** | `messages_count:club_messages(count)` aggregated by Postgres over that one thread, under row security | Per-viewer, no `+`, excludes a blocked author's comment for free |
| **Floor** | The club-wide 200-message window, collapsed per thread, flagged `partial` when the window filled | Per-viewer, carries `+` when it cannot know the total |

After the filter the floor count for an announcement is not merely undrawn — the announcement's
messages never enter the window, so no activity entry is computed for it at all. The exact count on
the announcement row is the only one that exists. **They must never both be drawn**, which is now
true by construction rather than by a render-time choice.

The `+` on an ordinary thread row stays, in both directions: a `partial` row still renders `12+`, and
a non-`partial` row still renders `12`. That behaviour has a test pinning both directions and this
change must not disturb it.

## D6 — Blocking needs no code here, again

`081`'s SELECT policies carry the symmetric block predicate on the thread's and the message's author,
and the counts are aggregated under row security — so a blocked rider's introduction, their comments,
and their contribution to any count are already absent per-viewer. Nothing in this change names a
block, a membership or a club's privacy, and the review pass should check that as a property of the
diff: **the only predicate added anywhere is `introduces_user_id is null`.**

## D7 — What can be wrong, and what would see it

| Defect | What sees it |
|---|---|
| A read loses the filter in a later refactor | A source-level test asserting all three reads carry the marker rule, in the shape of the existing embed-hint test — it reads comment-stripped source, which is what stops a doc-comment naming the column from passing for the filter |
| The `+` is dropped or added to the wrong rows | The existing both-ways thread-row test |
| The wave comes back on a thread row | A new both-ways assertion: an absence is invisible to a test that only checks what rendered, so the test must be verified by re-adding the control and watching it fail |
| The unread dot lights uncleanably | A unit test over the narrowing, including the empty-unread short-circuit and the failure-to-`{}` rule |
| The horizon starts lying | The existing club-timeline unit tests, plus the bound relationship they already assert |
| The filter quietly becomes an access-control rule | Review: the diff adds one predicate and no membership, block or privacy term |
