# An Introduction Appears Only As Its Announcement — and the wave goes with it

> Linear **PD-372** — *"An announcement's comments appear as new threads on the club detail — and
> the wave belongs to announcements alone"*, status **Development (AI)**, priority High, labels
> `App` `UX/UI` `Bug` `slot-1`.
>
> **`get_issue` and `list_comments` were both called, on 2026-09-02.** The body is first-hand.
> There is exactly **one** comment and it is the dispatcher's territory claim
> (`slot: 1`, `migration: N`, `primitive: N`) — **nothing overtakes the body**, so unlike the
> usual case there is no correction to reconcile.
>
> It supersedes two decisions of **PD-365**
> (`openspec/changes/introduce-yourself-on-joining-a-club/`, migration `097`) and one of **PD-356**
> (`openspec/changes/club-timeline-engagement/`, migration `092`). Both are merged and applied.
> **DEV is at `100`, measured** — `list_migrations` against `fpmrimzxadewsaiwpsel`, 2026-09-02, with
> the three hand-applied rows that make its row count read high and every file present. **PROD was
> level at `100` on 2026-09-01 per `CLAUDE.md` and was NOT re-measured here**, because this change
> applies no migration and nothing in it depends on the answer.

> **Everything below is measured against `letsride-dev` (`fpmrimzxadewsaiwpsel`) on 2026-09-02**,
> and each claim carries the query that re-derives it. **No migration.** `097` already grants
> `authenticated` SELECT on both new columns, which is the whole reason this is client-side work:
>
> ```sql
> select grantee, column_name, privilege_type
>   from information_schema.column_privileges
>  where table_schema = 'public' and table_name = 'club_threads'
>    and grantee in ('authenticated','anon');
> -- authenticated: SELECT on author_id, club_id, created_at, id, introduces_user_id,
> --                introduction, title
> -- authenticated: INSERT on author_id, club_id, id, title   ← the marker is NOT in it
> -- authenticated: no UPDATE on anything · anon: nothing at all
> ```

## ⚠ Read this first

**1. This SUPERSEDES three standing decisions. It is not a fix for an oversight, and each was
argued for at the time.** Naming them, because a reviewer who finds them will otherwise read this
change as a regression:

| Superseded | Where | What it said |
|---|---|---|
| The double appearance | `introduce-yourself-on-joining-a-club/specs/club-timeline/spec.md` | *"it SHALL appear once as each. That double appearance is designed and SHALL NOT be suppressed on either side."* |
| The identical titles | `introduce-yourself-on-joining-a-club/specs/club-introductions/spec.md`, the requirement *"Introductions SHALL be distinguishable from one another wherever threads are listed"*, and that change's `proposal.md`: *"the cost is that a club's Threads list can show several identically-titled rows"* | The cost was accepted and paid for with a byline in the row's lead line |
| The thread wave | `club-timeline-engagement/specs/club-timeline-engagement/spec.md`, the requirements *"A rider SHALL NOT be able to welcome themselves, and a rider MAY endorse their own thread"* and *"The wave affordance SHALL define every state"* | A wave on a thread's creation row, deliberately, with `postcard_likes`' self-like permitted |

The first two are superseded by the product owner's report off the live build; the third by a
direct answer, 2026-09-02: *"yes, only annoucements are waveable please."* **`tasks.md` §7.11 of
that change is superseded in part** — the byline it requires stays, because it is what tells two
*ex-member* introductions apart in the one list they can still appear in (§The rule).

**2. The filter this change adds is a PRESENTATION filter, not an access-control rule, and the
distinction is the one `openspec/config.yaml` exists to protect.** Nothing here narrows what a
rider may read. `081` decides who reaches a club's threads and messages; every row this change
drops was already returned by those policies to that viewer, and the same rows stay reachable —
through the announcement row's own door, through a deep link, through `098`'s notification, and
through the thread's own URL. **A reviewer SHALL be able to say of every filter added here: RLS
already answered, and this only chose where to draw the answer.**

**3. That said, the marker stops being decoration and starts deciding where a thread is drawn** —
so its unwritability moves from *tidy* to *load-bearing*. `097` already carries it and the grant
above is the proof: `introduces_user_id` is not in `club_threads`' INSERT grant, `club_threads`
has no UPDATE grant and no UPDATE policy for anyone, and `introduce_to_club` reads the subject
from `auth.uid()`. So a rider cannot mark their own thread to keep it out of the Threads list, and
cannot mark anybody else's to push it out either. **No new work; a new reason the existing work
matters**, and `specs/club-threads/spec.md` states it as a requirement so the next session that
considers a grant there knows what it would break.

**4. `club_thread_waves` is left with a live table, live policies, live triggers and NO WRITER IN
THE APP.** That is deliberate and it is the trap this change is most likely to leave for somebody.
§The table with no writer says what a later session owes.

**5. Measured shape of the defect on DEV, 2026-09-02** — the issue's own query, re-run:

```sql
select (select count(*) from public.club_threads)                                as threads_total,
       (select count(*) from public.club_threads where introduction is not null) as introductions,
       (select count(*) from public.club_threads
         where introduction is not null and introduces_user_id is null)          as ex_member_intros,
       (select count(*) from public.club_thread_waves)                           as thread_waves,
       (select count(*) from public.club_messages m
          join public.club_threads t on t.id = m.thread_id
         where t.introduction is not null)                                       as comments_on_intros,
       (select count(*) from public.notifications where type = 'club_thread_waved') as waved_notifs;
-- threads_total 8 · introductions 3 · ex_member_intros 0 · thread_waves 3
-- comments_on_intros 2 · waved_notifs 1
```

**Three of eight threads leave the Threads list.** Three thread waves become unreachable and one
already-delivered `club_thread_waved` notification stays in its recipient's list — §The table with
no writer covers both.

## Why

An introduction **is** a `club_threads` row (`097`), and that shape is not in question. What is
wrong is that nothing downstream knows the thread is an announcement, so the club detail draws one
conversation three ways:

- the **join row** — *"ana joined the club."* with its door and comment count. Correct, and the
  deliverable's one true home for an introduction.
- a **thread creation row** titled `Introduction`, *"Started by ana"* — `getClubThreads` carries
  no marker filter and feeds both the timeline and the Threads list.
- a **reply row every time somebody comments** — `getClubThreadReplies` has no filter either, so
  each comment writes a fresh `reply:<message id>` entry at the top of the stream. This is the
  reported symptom, and it is why replying *"always creates a new thread"*.

The third is the one that compounds: it is not a duplicate drawn once, it is a duplicate drawn per
comment, on the newest-first stream, above everything else the club did.

## The rule — decision 1, and the arm this change takes

> **An introduction is an announcement while its subject is a member. The moment the marker goes,
> the thread is an ordinary thread and is listed as one.**

Concretely: every browse surface filters on **`introduces_user_id is null`**. Both arms were
written out before choosing, because the difference only shows up after somebody leaves a club.

| | Keyed on the **marker** (chosen) | Keyed on **`introduction is null`** |
|---|---|---|
| A current member's introduction | Off the Threads list, off the timeline's thread and reply rows. Drawn once, on the join row | Same |
| An **ex-member's** introduction | Returns to the Threads list as an ordinary thread, at its original `created_at` position, titled `Introduction` with `Started by ana` beneath it | Stays out of every list for ever |
| Reachable by | Anyone `081` admits, from the Threads list, a deep link or a notification | **Nobody browsing.** The join row went with the membership; a `098` deep link still opens it |
| Moderation (`094`) | Reachable, because the takedown is entered from the thread screen, which is entered from the list | Reachable only by whoever holds the URL |

**The marker arm wins on `097`'s own reasoning, not on taste.** That change wrote down, twice, that
a leave destroys nothing —
`introduce-yourself-on-joining-a-club/specs/club-introductions/spec.md` carries
*"Leaving a club SHALL detach the introduction and SHALL destroy nothing"*, and that change's
`tasks.md` §7.9 reads *"gate the render on
`introduction !== null` and **never** on `introduces_user_id` … a marker-gated render makes every
ex-member's introduction and every comment under it vanish from a thread that still exists."*
A filter keyed on `introduction` is that same defect one level up: it keeps the words and the
comments alive and takes away every way of arriving at them. **A change that filters on `097`'s
column should not contradict `097`'s reason for having it.**

Two costs of the chosen arm, stated rather than discovered:

- **The row's title is literally `Introduction`.** It is honest — that is what the thread is — and
  `097`'s distinguishability requirement already put the author's name in the row's lead line
  (`ClubThreadRow` renders `Started by {thread.author?.username ?? 'a rider'}`), derived from
  `author_id`, which survives the leave that nulls the marker. That requirement therefore **stays**
  and is narrowed rather than dropped: it now governs the ex-member case alone, which is the only
  case in which two identically-titled rows can still meet.
- **A thread appears in a list because somebody LEFT.** The Threads list has until now only ever
  grown when a thread was created. It grows at its `created_at` position rather than at the top, so
  nothing jumps, nothing notifies, and no unread state changes — the unread map keys by thread id
  and always held this thread's state; §The unread dot is what keeps that consistent. Designed,
  and written into the spec so the next reader does not file it as a bug.

## What changes

Three reads gain the same filter and nothing else moves.

### `getClubThreads` — the Threads list and the timeline's thread entries

`.is('introduces_user_id', null)`, **in SQL**, alongside the existing `.eq('club_id', …)`.

**Not after the read, and this is not a style preference.** Post-read filtering breaks two things
silently:

- **`hasMore` on `/clubs/detail/threads`.** The page reads `lastCount === CLUB_THREADS_PAGE_SIZE`.
  A page of 20 holding 5 announcements would return 15, read as "nothing more", and the rest of
  the club's threads become unreachable — a page-length-as-a-total defect, which is the exact trap
  `ClubThreadsRow` was made to drop a count over.
- **The timeline's threads horizon.** `ClubTimeline` computes it as
  `boundedHorizon(threads.data, CLUB_THREADS_PAGE_SIZE, …)`, and `boundedHorizon`'s own header says
  it is *"Only for sources whose `rows` ARE the window. A read that filters or collapses must
  compute its own."* A post-read filter makes that call a lie with nothing red.

Filtering in SQL keeps the rows the window, so the cursor, the page and the horizon are all
untouched in meaning.

### `getClubThreadReplies` — the reply entries and `ClubThreadActivity`

`.is('thread.introduces_user_id', null)` on the **embedded** relation, beside the existing
`.eq('thread.club_id', clubId)`. The embed is already `!inner`, so filtering the embedded table
filters the parent rows — the mechanism is not new to this query, it is the same one that scopes
the window to one club. The column carries `authenticated` SELECT (§Read this first), so the
filter needs no grant and no migration; the embed's select list gains `introduces_user_id` so the
filter is resolvable from a column the query is already reading.

**The horizon rule survives verbatim, and what it means gets better.**
`getClubThreadReplies` measures `horizon` and `partial` on the window **before** the collapse, and
that is unchanged — the window is simply now 200 messages *on listed threads*. Two consequences:

- The horizon still answers *"how far back did this source look"*, and the source is now exactly
  what the stream draws from. Announcement comments are no longer events, so they must not shorten
  the stream.
- **Filtering after the read would let them.** 200 rows of which 150 are introduction comments
  would report a horizon an hour old and cut every ride, postcard and join beneath it — for events
  the screen never draws. That is `collapseToNewestPerThread`'s own documented defect
  (*"sixty messages in ONE argument … cutting every ride, postcard and join older than an hour off
  a timeline with room for them"*) reappearing through a filter instead of through a collapse.

`collapseToNewestPerThread` is **not** changed. It never sees an announcement row, so the pure
function whose whole reason for existing is that it can be wrong invisibly keeps its current
contract and its current tests.

### `getClubThreadUnread` — decision 2, the aggregate dot

The RPC `club_thread_unread` answers for **every** thread in the club, announcements included, and
this change cannot alter it: it is a database function and there is no migration here. So the
correction is in the read.

**The rule: the map SHALL answer only for threads the Threads list can show.** Its three consumers:

| Consumer | Effect |
|---|---|
| `ClubThreadRow` on `/clubs/detail/threads` | None — it indexes by id and the ids it holds are already filtered |
| `ClubTimeline`'s thread and reply rows | None — same, and after the filter no announcement produces a row to look up |
| **`ClubOptionsMenu`'s `Threads` item** — `Object.values(unread.data ?? {}).some(Boolean)` | **The one that changes.** Its expression is untouched; its input narrows |

That last one is the failure this decision exists to avoid: a dot that lights for an unread comment
on an introduction, points at the Threads list, and **cannot be cleared by visiting it**, because
the thread it names is not on it. `ClubThreadsRow` is deleted, so this menu item is the only
aggregate dot left in the app.

**How, without a migration and without under-reporting.** Two rejected shapes and the one taken:

- **Rejected — intersect with `getClubThreads`' page 1.** It under-reports: threads are listed by
  creation, so an old thread with a new comment sits past page 20 and its dot would never light.
  A false negative in a notification is worse than the false positive being fixed, and the menu
  item's own comment already refuses page-1 data as a fact about the club.
- **Rejected — read every announcement id in the club.** Bounded by the roster, which is the wrong
  bound: it grows with members rather than with the answer.
- **Taken — correct only what could light.** After the RPC answers, take the ids it marked
  `has_unread`, and read back which of those carry a marker (`.in('id', unreadIds)` +
  `introduces_user_id is not null`). Drop those. **Bounded by the unread set**, and skipped
  entirely when nothing is unread — the `subjectIds.length === 0` early return this codebase
  already uses twice.

**Failure rule, unchanged from the function's existing one:** if the corrective read fails, the
whole map resolves to `{}`. A failed unread call costs the marks and nothing else; it must never
cost a row, and it must never return marks it could not verify.

### The wave — decision 3

**Off every thread row on the timeline**, not only the introduction's. The waveable rows on the
club timeline become the join/announcement rows alone. The double count `097` reintroduced —
a **join** wave keyed on the rider beside a **thread** wave keyed on the thread, for one thing —
goes with it, which is what `092`'s own spec refused for a thread: *"two wave targets for one
thread would count one thing twice."*

**In this change (the client path, all of it):**

| Retired | File |
|---|---|
| `waveThread`, `unwaveThread` | `src/lib/actions/club-waves.ts` |
| `attachClubWaveState`'s `thread` branch, `getThreadWaveState` | `src/lib/data/club-waves.ts` |
| `queryKeys.clubs.threadWaves`, and the `waveThread`/`unwaveThread` row of `notifications.list`'s claim table | `src/lib/query/keys.ts` |
| The `threadWaves` `useQuery` and the `wave` prop on both thread branches | `src/components/clubs/ClubTimeline.tsx` |
| The `wave` prop, its `ClubWaveButton` render and its import | `src/components/clubs/ClubTimelineThreadRow.tsx` |

`ClubWaveButton` and `resolveClubWaveState` **stay** — the join row is still their caller.

**NOT in this change, and named so nobody assumes otherwise:** the `club_thread_waves` table,
`092`'s policies, grants and participation gate on it, `098`'s `notify_club_thread_waved` and
`retract_club_thread_waved`, and every RLS assertion over any of them. No migration means no
assertion changes (`openspec/config.yaml`'s pairing rule is satisfied vacuously and deliberately).

## The table with no writer — the trap this change leaves

After this merges, **`club_thread_waves` has no writer and no reader in the app.** The table is
live, its policies are live, its participation gate is live, and both `098` triggers still fire for
anything that writes it — which is now only the table owner, `psql` and the RLS suite. Three
consequences a later session must not rediscover:

- **The three existing rows on DEV are orphaned.** Their authors may still delete them under
  `092`'s DELETE policy; no affordance in the app reaches it. A rider who waved a thread can no
  longer withdraw that wave.
- **The one delivered `club_thread_waved` notification stays**, with its copy, its deep link and
  its retraction trigger. `NotificationType` still carries the value and both client switches are
  exhaustive over it, so **nothing in `src/components/notifications/` may be deleted here.**
- **Dropping the table is a destructive migration and it is a separate call.** Whoever makes it
  owes, in one file: both `098` triggers, the table, `092`'s policies and grants, the RLS
  assertions labelled `092.*`, `098.*` and `100.*` that name it, and a decision about the
  `club_thread_waved` rows already in `notifications` — the type is in that table's CHECK
  constraints, so removing the value while rows hold it makes the constraint unvalidatable. The
  ordering is `090`'s (a removed object no bundle can observe has no unsafe side) **only after**
  this change is serving.

**No Linear issue exists for it yet.** Filing one is the main thread's, not this proposal's; this
document is the pointer it should quote.

## Who must NOT see or do this — the negative cases, by name

**Nothing here narrows what any role may read**, and that is itself the claim to check: every case
below is answered by a policy that already exists, and this change adds no term to any of them.

| Role | Reach into an introduction, its comments and its counts | Changed by this? |
|---|---|---|
| **Owner** | Reads the thread and every comment; may moderate. Reaches it from the announcement row while the subject is a member, and from the Threads list once they are not | No |
| **Admin** | Identical to the owner for this purpose — `club_members.role` has carried `admin` since `001` | No |
| **Member** | Reads and comments; deletes only their own comment; deletes their own introduction | No |
| **The subject** | As a member, plus deleting their own introduction's thread | No |
| **Non-member of a PUBLIC club** | Reads the club and its roster. **Zero** threads, **zero** messages, from `081` — before this change and after it. The filter has nothing to filter for them, and SHALL NOT be described as what protects them | No |
| **Non-member of a PRIVATE club** | Reads nothing, the club included | No |
| **Blocked rider** (either direction — the block is symmetric though the row is directional) | Their thread, their comments and their contribution to any count are absent per-viewer, from the policies' own block arms. **This change restates none of it**, which is the point: a second copy would be free to drift | No |
| **Signed-out visitor** | Reaches the shell and no data. `anon` holds zero grants on `club_threads` and `club_messages` — measured, alongside the column grants above | No |

**And the cases that are not roles**, each of which the issue asked for by name:

- **An ex-member's introduction.** Returns to the Threads list as an ordinary thread, at its own
  `created_at`, titled `Introduction` with `Started by ana` beneath it. §The rule.
- **A club whose only threads are introductions.** The Threads list draws its ordinary empty state
  **with the create affordance**; the timeline's foot omits its Threads link, since it gates on the
  list holding something, and still names at least one destination because Members is ungated. The
  club options menu keeps its Threads entrance, deliberately: an entrance to an empty list that
  offers the create is not the unreachable-screen defect.
- **The horizon and `complete`.** Filtering in the query keeps every source's rows its window, so
  both keep their current meanings. A stream that is shorter because a club's threads are mostly
  introductions is still `complete` if nothing was cut. §What changes, and `design.md` §D2.
- **The two comment counts.** The announcement row's exact count survives; the windowed floor count
  is not merely undrawn but **not computed**, because the announcement's messages never enter the
  window. They can no longer both be drawn, by construction. `design.md` §D5.
- **A blocked author's comment on an introduction.** Already hidden and already uncounted, per the
  row above. Nothing here touches it.
- **A rider hiding their own thread from the Threads list.** Refused, because the marker is not in
  `club_threads`' INSERT grant and the table has no UPDATE grant or policy for anyone. Previously a
  tidiness rule, now the thing that stops a rider choosing whether their thread is listed — §Read
  this first, item 3.
- **A `club_thread_waves` row nobody can reach.** Three exist on DEV. Their authors keep the DELETE
  policy and lose the affordance. §The table with no writer.

## Capabilities

### Modified Capabilities

- `club-introductions`: where an introduction is listed, and the rule that decides it. The
  announcement row is its only browse surface while its subject is a member; the ex-member arm and
  its byline are stated as the one case in which an introduction is listed as an ordinary thread.
- `club-threads`: the Threads list is defined by what it excludes, and the marker's unwritability
  becomes a stated property of that list rather than a tidiness rule.
- `club-timeline`: the *"double appearance is designed and SHALL NOT be suppressed"* requirement is
  replaced with its opposite, and the horizon's meaning under a filtered window is written down.
- `club-timeline-engagement`: the thread wave affordance is removed from the client; the wave
  requirements that describe the **table** stay exactly as they are, and the spec says which is
  which.
- `client-render-shell`: the empty Threads list, the timeline foot, and what a row draws when the
  only threads a club holds are announcements.
- `client-cache-invalidation`: `clubs.threadWaves` retires, and the rule for a key whose last
  writer is deleted.
- `notifications`: a delivered notification whose gesture the app can no longer make SHALL keep
  working, and an exhaustive switch SHALL NOT be narrowed because a writer went.

### New Capabilities

None. Every rule here lands on a capability that already exists.

## Non-Goals

- **No migration.** Everything this change needs is already granted (§Read this first). If an
  implementer concludes one is required, that is a signal to stop and re-read this section rather
  than to write `101`.
- **No change to the thread screen.** An introduction's detail route, its comments, its
  `useClubThreadStream` subscription, its moderation and its report path are untouched. Only where
  a thread is *listed* changes.
- **No change to postcard waves.** `PostcardCard`'s `LikeButton` is `postcard_likes` under the
  app's own word for the gesture, a different object with a different table, and it stays.
- **No unread mark on the announcement row.** §Open questions, Q2 — the count is the signal today
  and this change does not add a second one.
- **No dropping of `club_thread_waves`**, its policies or its triggers. §The table with no writer.
- **No notification for a comment on an introduction beyond what `098` already writes.** `098`
  treats an introduction as an ordinary thread, deliberately, and that stays true.
- **No new empty state, no new copy, no new component.** Every screen this touches keeps the states
  it already has; what changes is which rows reach them.
- **No Realtime.** The filtered reads refetch on the same cache keys they already use.

## Open questions — each with a recommended default, so nothing blocks

**Q1 (non-blocking, product owner).** An ex-member's introduction returns to the Threads list
titled `Introduction`. Is that the right words, or should an ex-member's introduction read
differently there? **Default: leave it.** The title is immutable by construction (`club_threads`
has no UPDATE grant), so any other answer is a render-time substitution, and `097`'s byline already
says whose it is. Build on the default; a copy change is a one-line follow-up.

**Q2 (non-blocking, product owner).** Should the announcement row carry an **unread** mark when its
introduction has unread comments? Today it carries none, and after this change nothing else marks
it either — the map that would answer it is the same one §The unread dot narrows. **Default: no.**
The exact comment count on that row is the signal, and the join row has no spare width — `097`'s
own geometry census measured `Event 326×44` with the avatar, the sentence, the time, the door, the
count and the wave already in it. If the answer is yes, it is cheap and additive: the introduction
state already carries the thread id, so the mark is a lookup away — but it needs the map to keep
announcements, which is the opposite of §The unread dot, so it is a **design decision and not an
implementation detail**.

**Q3 (non-blocking, main thread).** Who files the successor that drops `club_thread_waves`, its
policies and `098`'s two triggers? **Default: the main thread files it during this session's
wrap-up**, quoting §The table with no writer. It must not be built here — it is destructive, it
needs the RLS suite's `092`/`098`/`100` assertions rewritten, and it is safe only once this change
is serving.

**Q4 (non-blocking, implementer).** Where does the marker rule live so the three reads cannot
drift? **Default: one named, documented export in `src/lib/data/club-threads.ts`** that the other
reads apply, plus the source-level test in `tasks.md` §4. The two call sites spell different column
paths (`introduces_user_id` on the base table, `thread.introduces_user_id` through the embed), so
one shared *string* cannot serve both; one shared *name and reason* can.

**There is no blocking question.** Every decision the issue raised is settled in this document.

## Impact

- **Six client files**, no migration, no new component, no new dependency.
- **A club's Threads list gets shorter** by one row per member who has introduced themselves —
  three of eight threads on DEV today.
- **The club timeline stops growing by one row per comment on an introduction**, which is the
  reported bug.
- **Three wave rows and one delivered notification are left behind** deliberately, with a pointer.
- **`npm run walk`** exercises the club detail and the Threads list; `WALK_FIXTURES=1` is what puts
  a membership and a thread there.
