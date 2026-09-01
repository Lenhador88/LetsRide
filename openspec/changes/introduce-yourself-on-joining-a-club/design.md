# Design — Introduce Yourself on Joining a Club

See `proposal.md` §Why for motivation and §The three traps for the shapes that were measured and
rejected. This file is the *how*: nine decisions, six open questions, and the migration plan.

Everything measured here was measured against `letsride-dev` (`fpmrimzxadewsaiwpsel`) on
2026-09-01, Postgres 17.6, with `execute_sql`. Probes that changed anything ran inside an explicit
transaction and were rolled back; §Verification carries the check that the tree is clean.

## Context

Four constraints shape every decision below, and three of them are database facts rather than
preferences.

**1. The membership must exist before the introduction can be written.** `club_threads`' INSERT
policy, read off `pg_policies`:

```
with_check: author_id = auth.uid()
            AND EXISTS (SELECT 1 FROM clubs c WHERE c.id = club_threads.club_id)
            AND private.is_club_member(club_id)
```

So the join commits first and the introduction is a second, separately-failable write. There is no
client-side transaction — PostgREST offers none and `CLAUDE.md` §Technology Decisions puts the
mutation path in the browser. This is the whole content of §Q1.

**2. A thread has a title and no body.** `club_threads` is `(id, club_id, author_id, title,
created_at)` and nothing else; `CreateThreadForm` says in its own header why it asks for a title and
no first message — *"a second field would be a second write with no transaction behind it… so a
failure between them leaves a thread whose first message never landed"*. An introduction is
precisely that second field, so it needs either a transaction (an RPC) or a column (§D3).

**3. A non-member of a PUBLIC club reads the roster and reads no thread.** Measured in
`proposal.md` §Why. The join announcement is therefore reachable by a rider for whom the
introduction does not exist, and everything the row displays about that introduction has to be
computed from rows *that viewer* can read.

**4. The join row is already full.** `Event` is 326×44 with avatar 28 + text 242 + time 16, and
`092` already added two controls to it by letting the sentence truncate. This change removes one
(⋯) and adds one (the count), so the pressure does not increase — but it does not decrease either,
and nothing here may assume spare width.

## Goals / Non-Goals

**Goals:**

- One place that decides whether a rider owes an introduction, reachable from all six join doors.
- An introduction whose visibility is **inherited** from `club_threads` and restates no predicate.
- A comment count that is a fact about *the viewer's* rows and can never be a fact about the club.
- A join row that survives every state an introduction can be in, including never written, written
  then deleted, written then moderated, and written by somebody the viewer has blocked.
- A schema shape that makes the two traps in `proposal.md` unreachable rather than merely unchosen.

**Non-Goals** (design-level; `proposal.md` §Non-Goals has the product ones):

- No change to `club_threads`' SELECT, INSERT or DELETE policy. The introduction is a thread and is
  audienced as one.
- No new `private` helper. Every predicate this change needs already exists.
- No second definition of "is this rider a member". `private.is_club_member(club_id)` reads
  `auth.uid()` internally, so it is correct inside a `security definer` body whose subject is the
  caller — unlike a fan-out, where `event-fanout-integrity` forbids a caller-relative helper
  because the subject is the *recipient*.

## Decisions

### D1 — The introduction is a marked thread, not a new table

**Chosen:** two nullable columns on `club_threads`.

A `club_introductions` table was weighed and loses on the audience question alone. Its rows would
be readable by exactly the club's members, blocked-filtered on the author — which is
`club_threads`' SELECT policy verbatim. `database-enforced-integrity` §*A child table whose
audience is NARROWER than its parent's SHALL enforce that by composition* and `add-club-threads`
§*A grandchild table SHALL restate its grandparent's audience* between them mean a second table
costs a second copy of the same three-conjunct predicate, and `009`'s stated reason applies: *"the
one that drifts is the one nobody reads."*

It also loses on what the product asks for. An introduction that is not a thread cannot be
commented on, and *"this can be waved or commented"* is the request. Making it a thread means the
comment path, the delete path, the moderation path, the report path (`094`) and the wave
(`092`'s `club_thread_waves`) all already exist and need no widening.

**What it costs:** every read of `club_threads` now returns two columns most callers ignore, and
`MEMBER_PROFILE_EMBED`-style discipline applies — see §D8.

### D2 — The marker lives on `club_threads`, not on `club_members`

Three options were weighed:

| Option | Verdict |
|---|---|
| **a** `club_members.introduction_thread_id` | **Declined.** Needs an UPDATE policy on the roster, and that policy hands out `admin` — measured, `proposal.md` §The three traps, Trap 2 |
| **b** `club_threads.introduces_user_id` | **Adopted** |
| **c** derived — "the earliest thread this rider authored in this club" | **Declined.** Not a decision the schema records, so it changes meaning whenever a rider's second thread is written first, and it is unindexable as a uniqueness rule |

Option (a) is not *impossible* — a `security definer` RPC bypasses RLS, so the column could be
written with no policy at all. It is declined because the safety then rests on nobody ever adding
the obvious policy, and the obvious policy is a two-line change that reads correct in review. The
column grant that makes it dangerous (`UPDATE (club_id, role, user_id)`) has been sitting inert
since `019` and nothing points at it.

Option (c) also loses on the rejoin case: a rider who leaves and rejoins would inherit their old
thread as their new introduction, which §D5 says must not happen.

### D3 — The text is a column on the thread, not its first message

**Chosen:** `club_threads.introduction text`, `CHECK (introduction ~ '\S' AND length(introduction)
<= 1000)`.

The alternative — thread plus a first `club_messages` row — is what a reader expects, because it is
how every other thread works. It loses on the **count**, which is the request's own headline
feature. With the introduction as a message:

- the number beside the icon is `messages − 1`, and
- `delete_own_club_message` (`081`) lets the author erase that opening message while the thread
  survives, so the `− 1` becomes wrong, and
- `club_messages`' SELECT policy carries a block arm on the *message's* author, so a viewer who has
  blocked the newcomer reads `messages − 0` while everyone else reads `messages − 1`,

and none of those three is visible in the number. With the introduction on the thread, every
`club_messages` row in it is a comment by construction and the count is
`messages_count:club_messages(count)` — the identical shape to the live
`comments_count:postcard_comments(count)` in `src/lib/data/postcards.ts`.

**The bounds match `club_messages.body` deliberately** — `~ '\S'` and `<= 1000`, the same CHECK
`081` gave a message. An introduction that could be longer than any reply to it would be a
different kind of object. `018` is the precedent for the pair (a bound in the database, a matching
Zod schema for the message).

**Immutability is inherited and is a feature.** `club_threads` has no UPDATE grant and no UPDATE
policy for anyone, so an introduction cannot be edited by its author, an admin, or the owner. That
is `add-club-threads` §*A thread title and a message body SHALL NOT be editable by anyone* applied
to a third column, not a new rule.

**A column nothing reads is a column nothing wrote.** `getClubThread` selects
`'id, club_id, author_id, title, created_at'` today, so the thread detail must be widened to
select `introduction` in the same change — otherwise a rider types an introduction, posts it, a
member taps the count and lands on a thread titled `Introduction` with no body and no messages.
The task is 6.5 and it is not optional; it is the reason the argument for SET NULL over CASCADE in
§D5 is about *words other riders can read* rather than about a stored string.

**The render is gated on `introduction`, never on `introduces_user_id`, and the two come apart
permanently.** The foreign key nulls the marker when the subject leaves; the text stays. A render
gated on the marker therefore drops every ex-member's introduction — and every comment written
under it — out of a thread that is still there and still readable. The author's name likewise comes
from `author_id`, which survives the leave, and not from the marker, which does not and which
points at a membership rather than at a profile (§D8).

### D4 — One `security definer` RPC writes it

**Chosen:** `public.introduce_to_club(target_club uuid, body text) returns uuid`.

A plain client INSERT is expressible — the WITH CHECK would gain
`(introduces_user_id IS NULL OR introduces_user_id = auth.uid())` and the two columns would join the
INSERT grant. It is declined for three reasons, the third being decisive:

1. **The title.** A client INSERT means the client chooses the title, so the constant that names
   nobody is a convention rather than a guarantee, and a rider can publish an arbitrary immutable
   80-character string into the club's thread list with an introduction's marker on it.
2. **The raise sites.** A client INSERT into a club the caller cannot see fails at the policy with
   `42501`; one into a club that does not exist fails at the foreign key with `23503`. Two
   distinguishable failures is an oracle. `083`, `085` and `091` all collapse this to one raise
   site and this follows them.
3. **§Q1 stays reachable.** If the owner chooses the mandatory arm, the join and the introduction
   have to become one transaction. With an RPC that is a body change; with a client INSERT it is a
   rewrite of the call site, the action, the prompt and the spec.

**The participation gate must be restated inside it, and this is not optional.** Every
`enforce_participation_gate` trigger carries `when (current_user = 'authenticated')`, and
`current_user` inside a `security definer` body is the function's owner — so the trigger on
`club_threads` cannot fire for this insert. `078` is the measured precedent (a trigger there
*could never fire*, which is why `078.9` asserts its absence) and `085` is the remedy
(`private.may_participate_for(candidate uuid)`, the subject-taking twin, exists for exactly this).
`097.4` asserts a rider with `terms_accepted_at` NULL is refused.

**It takes a CLUB and never a rider id.** `088`'s three RPCs take a club and a rider and no role
argument; `083`'s and `085`'s take an invite or a request id and never a rider id. Here the subject
is always the caller, so the argument list holds no identity at all.

### D5 — Leaving nulls the marker; the thread survives

The composite foreign key is `(club_id, introduces_user_id) → club_members (club_id, user_id)`,
available because `club_members`' primary key is `(club_id, user_id)` — the same key `092`'s
`club_join_waves` uses, and it is the third table to use it.

**`ON DELETE SET NULL (introduces_user_id)`, with the column list.** Without it the delete tries to
null `club_id` as well and the leave fails with `23502` — measured, `proposal.md` §The three traps,
Trap 1. Postgres 15+ supports the column list; DEV is 17.6.

**Why SET NULL rather than CASCADE.** `092` cascades a join wave with the membership, correctly:
the wave decorates the *event*, and when the event goes so should its reactions. An introduction is
not a decoration — it is words the rider wrote and words other riders wrote in reply. Cascading it
would mean **a rider leaving a club silently deletes everybody's welcome messages**, which is the
exact defect `club-timeline-engagement` §D2 refused when the joiner could delete a system thread.
`add-club-threads` §*Leaving a club SHALL remove the whole conversation from the leaver, and SHALL
remove nothing from anybody else* is the standing requirement and SET NULL is what satisfies it.

**What the ex-member's thread becomes:** an ordinary thread, authored by a rider who is no longer a
member, which the schema already permits and the club already contains — with its `introduction`
column still populated and its marker NULL.

**The CHECK pairing the two columns must therefore be ONE-DIRECTIONAL, and the obvious
biconditional refuses the leave.** This is Trap 1 in a second costume: a foreign key's `SET NULL`
is an UPDATE, so every CHECK on the row is re-evaluated, and a constraint saying *these two are
either both set or both null* is violated the instant one of them is nulled from underneath it.
Measured on DEV, both arms, rolled back:

```sql
check ((introduces_user_id is null) = (introduction is null))   -- accepted at DDL time
delete from club_members ...  -- 23514: violates check constraint  ← the rider cannot leave

check (introduces_user_id is null or introduction is not null)  -- the one that survives
delete from club_members ...  -- SUCCEEDS: club_id intact, marker NULL, text preserved
update club_threads set introduces_user_id = ..., introduction = null;   -- 23514, still refused
```

So the constraint is *"a thread that claims to be an introduction must have text"*, and *"a thread
with text whose subject has left"* is permitted rather than impossible. `097.7` asserts a leave by
a rider who **has** an introduction, which is the only version of that assertion that can see any
of this — a leave by a rider without one passes under every shape above.

### D6 — The count is per-viewer, computed under RLS, and never stored

This is `009`'s refusal of a `like_count` column, transferred for the third time (`092` was the
second). The consequences are already written down in `club_thread_waves`' table comment and they
transfer verbatim: **two members of one club may see different totals on the same thread and
neither is told why**, because a blocked author's messages are filtered by
`club_messages`' own SELECT policy.

**The three prohibitions transfer too**, and they matter more here than for a wave because a
comment count looks more like a fact:

- it **SHALL NOT** order, rank or sort any list,
- it **SHALL NOT** provide a cursor or a page boundary,
- it **SHALL NOT** feed a threshold, badge or label implying a shared judgement.

**The join row's count needs no `+` and the thread row's does.** They are computed differently and
that is the whole reason:

| Row | Source | Bounded? |
|---|---|---|
| Join row (introduction) | `messages_count:club_messages(count)` embedded on the one thread | No — the aggregate runs in Postgres over every row RLS returns |
| Thread row — **reply** entry | `ClubThreadActivity`, folded from `getClubThreadReplies`' club-wide `CLUB_TIMELINE_REPLIES = 200` message window | **Yes** — `partial` is what turns `12` into `12+` |
| Thread row — **creation** entry | the same window, with `partial` **forced false** by `withExactCount` | **No** — exact, and marking it is a defect |

Dropping the `+` when `2 replies` becomes an icon and a number would make the reply row assert a
total it cannot know — its own component header says so. §Q5.

**The third row of that table is the half that inverts if the rule is restated carelessly, and it
is already load-bearing code.** `mergeClubTimeline` clears the flag on every creation entry
(`club-timeline.ts:417`, and the reasoning at :330-338): the stream is cut at the newest of the
sources' horizons and the reply source's horizon is the oldest message it read, so a creation entry
that survives the cut was created *after* that instant and every one of its replies is inside the
window. **A full window is therefore necessary and not sufficient**, and a spec saying "mark it
when the window filled" instructs an implementer to re-add a `+` to a thread with exactly two
replies. A test asserting only that `12+` still renders as `12+` passes under both behaviours and
cannot catch it, which is why `tasks.md` 8.4 asserts the creation row too.

### D7 — The prompt is driven by state, not by the Join button

**The decision rule, evaluated on the club detail screen:**

```
owes an introduction  ⟺  the viewer has a club_members row for this club
                     AND its role is not 'owner'
                     AND the club is not the default club
                     AND no club_threads row has introduces_user_id = the viewer
```

Every clause is a fact the screen can read for itself, so the rule holds however the membership was
created — which is the only way to reach all six doors. Bolting the prompt to `joinClub` reaches
one of six, and the one it would reach *worst* is `complete_onboarding`, where the prompt would open
inside the wizard on a club the rider never chose to join.

**Owner excluded** because `054` makes a club's owner a member of it, so without the clause every
founder would be asked to introduce themselves to the club they had just created.

**Default club excluded** — §Q3. `058` already carves it out of `notify_club_joined` for the same
reason in the same words: *"Every rider joins the default club at onboarding, so a fan-out here
addresses one account with the entire signup stream."*

**Once per membership, not once per visit.** The rule is satisfied for ever once an introduction
exists, and a rider who dismisses the prompt (§Q1, decided) must not be asked again on the next
navigation. That needs a client-side per-(rider, club) dismissal, and it belongs in the session
store rather than the schema — a dismissal is not a fact about the club. `client-session-storage`
governs it and `signOut` clears it, which is the correct behaviour: signing out and back in is not
a state the app preserves opinions across.

### D8 — Reads name their columns and their foreign key

Two hazards, both of which this repo has already paid for once.

**The embed hint, and `MEMBER_PROFILE_EMBED` is the WRONG one here.** That constant is
`profile:profiles!user_id(...)`, which is correct off `club_members` — a table with a real
`user_id` foreign key — and wrong off `club_threads` twice over: `club_threads` has **no `user_id`
column at all**, and the relationship that does exist is on `author_id`.

**`club_threads`↔`profiles` is already ambiguous, before this change adds anything.** Measured on
DEV 2026-09-01 — one direct foreign key and two genuine junctions, a junction being two foreign
keys whose union is exactly the primary key:

```sql
-- direct
club_threads_author_id_fkey        club_threads(author_id) -> profiles
-- junctions: PK is exactly the two FK columns
club_thread_reads                  PRIMARY KEY (user_id, thread_id)
club_thread_waves                  PRIMARY KEY (thread_id, user_id)
-- NOT junctions, and this is the distinction CLAUDE.md insists on: both hold a key
-- to each side and both are PRIMARY KEY (id), so neither makes anything ambiguous
club_messages                      PRIMARY KEY (id)
club_thread_reports                PRIMARY KEY (id)
```

So **a thread → `profiles` embed SHALL hint `author_id`** —
`author:profiles!author_id(${PUBLIC_PROFILE_COLUMNS})`, which is exactly what
`getClubThreadReplies` already writes off `club_messages` (`src/lib/data/club-timeline.ts:692`).
`MEMBER_PROFILE_EMBED` stays the constant for `club_members` rows and is not reused here.

**The marker is not an embed path.** `(club_id, introduces_user_id)` is a composite key into
`club_members`, so there is no `introduces_user_id → profiles` relationship for PostgREST to
resolve and no hint that would make one — the rider's name comes from the thread's author, who is
the same rider by construction.

`092` made `club_members`↔`profiles` ambiguous and took four screens down with `PGRST201` /
HTTP 300 (PD-363) *this week*, and no gate in this repo can see it —
`src/lib/data/__tests__/embed-hints.test.ts` is the only thing that refuses an unhinted embed, and
`!inner` is a join modifier rather than a hint.

**The column list.** `097` adds two columns to a table whose SELECT is already column-scoped for
`authenticated`. The grant must name them or every read of `introduces_user_id` answers `42501`,
and the failure arrives as a whole screen rather than a missing field. `097.2` asserts the grant.

### D9 — The back target is a bounded parameter, not a referrer

The thread screen's back destination is `routes.clubThreads(clubId)` today, used twice — the
header's arrow and `useSwipeBack`. It is reachable from the thread list, from the timeline's thread
rows, from the timeline's reply rows, and now from a join row, so one fixed target is wrong for
three of four callers.

**Chosen:** a query parameter in `CREATE_CLUB_PARAM`'s exact shape, carrying **two** bounded
values — an *origin kind* from a closed set and the *row key* to return to. Never a URL, so there
is no allowlist to maintain and no open redirect to close: the only thing it can produce is
`routes.club(<well-formed id>)` with a fragment naming a row of that club. `routes.ts` already
explains why `BACK_ORIGINS` is the wrong reuse — that list is derived from the screens rendering
`NotificationsHeaderControl` and has its own drift test.

**Absent means the thread list**, which is today's behaviour and is what a deep link, a
notification tap, a shared URL and a reload all produce. That is the safe default: it lands the
rider somewhere that certainly exists and that they can certainly read, because they just read the
thread.

**The row key is the anchor, and every timeline row grows one.** Q4's answer put the scroll
position in scope, so the club screen needs somewhere to scroll *to*. Each row already has a stable
key — `mergeClubTimeline` gives every event one (`join:<uuid>`, `thread:<uuid>`, and so on) as a
total-order tiebreak — so the anchor id is that key rather than a new identity invented for the
purpose, and the two cannot drift apart.

**Three properties, each of which the obvious implementation gets wrong:**

- **Scroll after the data lands, once.** The screen is client-rendered and its rows arrive from
  five independently-resolving reads, so at first paint there is nothing for a native fragment to
  find. The scroll runs when the named row exists and does not re-run on later renders, or an
  incoming realtime row or a cache invalidation yanks the rider back mid-read.
- **An unresolvable anchor is a no-op, never an error.** The row may be deleted, may have fallen
  past the coherence horizon, or may be one the viewer can no longer read — all three are ordinary.
  The screen renders at the top and reports nothing.
- **The fragment is not a second source of truth.** It names a row; it does not decide what the
  screen fetches, and nothing about the timeline's reads or its horizon changes because it is
  present. §Q4.

## Risks / Trade-offs

- **[The join and the introduction are two writes, so "joined with no introduction" exists
  permanently]** → Specified as a first-class state rather than an error. The join row renders with
  no count and no thread door; the prompt reappears next time the rider opens the club. This is
  true under *both* arms of §Q1 and is the reason the mandatory arm cannot mean "no join without
  one".
- **[A rider deletes their introduction and the join row loses its door]** → `081`'s DELETE policy
  is unchanged and this is correct: they are their own words. The row reverts to exactly what it
  was before this change, plus the wave. Specified so it is not read as a bug.
- **[An admin moderates an introduction with `moderate_club_thread` (`094`)]** → Same outcome, and
  the newcomer is told nothing, because `094` decided that nobody in the club reads a report and no
  notification is written. That silence is inherited, not introduced, and is named in the spec so
  the next reader does not "fix" it.
- **[The count is per-viewer and looks like a fact]** → §D6's three prohibitions, asserted in the
  spec as testable statements. The strongest mitigation is that nothing sorts by it.
- **[`097` is additive but NOT inert]** → It hangs no trigger, but `introduce_to_club` writes into
  `club_threads` under a live participation gate and a live SELECT policy, and a raise inside it
  takes the rider's introduction down. `036`'s hand-exercise gate applies: exercise it by hand on
  DEV as `authenticated`, in a rolled-back transaction, before promoting.
- **[Every read of `club_threads` now carries two columns most callers ignore]** → `097` grants
  SELECT on them and nothing more; the reads that do not need them do not name them. This is the
  cost §D1 accepted.
- **[The prompt is one more thing between a rider and the club they just joined]** → §Q1's decided
  arm keeps `Not now` one tap away and the dismissal sticks for the session.
- **[The return anchor is a second thing that can be wrong about a screen already assembled from
  five reads]** → It is a no-op by construction when it cannot resolve, and it changes nothing
  about what the timeline fetches. Its failure mode is "the rider lands at the top", which is
  exactly today's behaviour.

## Migration Plan

**`097_club_introductions.sql`.** Additive; **not inert**.

1. `alter table public.club_threads add column introduces_user_id uuid`,
   `add column introduction text`.
2. The CHECK — one-directional, per §D5.
3. The composite foreign key, **with the column list**: `on delete set null (introduces_user_id)`.
4. The partial unique index: `unique (club_id, introduces_user_id) where introduces_user_id is not
   null`.
5. `grant select (introduces_user_id, introduction) on public.club_threads to authenticated`. **No
   INSERT grant and no UPDATE grant on either column, for any role.**
6. `create function public.introduce_to_club(...) security definer`, `search_path` pinned,
   `revoke ... from public` then `grant execute to authenticated` — the shape `085` and `091` use.
7. RLS assertions in `supabase/tests/rls_test.sql`.

**Order relative to the deploy.** Migration-first is safe and deploy-first is safe, in opposite
ways, so either is defensible and the tasks pick migration-first:

- An **older bundle** against a post-`097` database names none of it. The two columns are nullable
  with no default, the CHECK is satisfied by NULL, and no trigger is hung — so every existing write
  path behaves identically.
- A **newer bundle** against a pre-`097` database calls `introduce_to_club` and gets `PGRST202`;
  the prompt fails visibly and the join is unaffected. Degraded, not broken.

That is the opposite of `096`, whose column a shipped client *writes* — and the reason to state it
rather than inherit "additive, so order does not matter", which `CLAUDE.md` records as wrong in
both directions for the `092`–`096` group.

**There is no promotion gap left to sequence.** `092`–`096` reached PROD on 2026-09-01, so both
projects are at `096` and `097` applies to each the same way.

**Story 3's `098` is the counter-example and the two must not be merged.** A new notification type
is safe only *after* the bundle that knows it is confirmed serving (`089`'s rule), which is the
opposite side of the build from `097`. Two files whose safe sides disagree cannot be one file —
`069`/`070` is the worked example, and `proposal.md` §How this is built carries the split.

**Rollback.** `drop function public.introduce_to_club(uuid, text)`, then drop the index, the
constraints and the two columns. Destructive, so it goes **after** the reverting bundle is
confirmed serving — `070`'s rule, not `069`'s.

## Verification

```bash
# The probes in proposal.md §The three traps left nothing behind:
```
```sql
select column_name from information_schema.columns
 where table_schema='public' and table_name='club_threads' order by ordinal_position;
-- id, club_id, author_id, title, created_at        (2026-09-01, before 097)
select count(*) filter (where cmd='UPDATE'), count(*) from pg_policies
 where schemaname='public' and tablename='club_members';   -- 0, 3
```

After `097` applies, on each project:

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.club_threads'::regclass order by contype, conname;
-- the FK must read: ON DELETE SET NULL (introduces_user_id) — the column list is the assertion
select count(*) from pg_trigger
 where tgname='enforce_participation_gate' and not tgisinternal;   -- UNCHANGED by 097
```

**Both of the counts below are checked as DELTAS against a baseline read immediately before `097`
applies, never against a number written here.** The two projects are **level** as of 2026-09-01 —
`092`–`096` reached PROD — so both read the same pair today, measured on each:

| | both projects, before `097` | after `097` |
|---|---|---|
| `enforce_participation_gate` triggers | 22 | **22** — unchanged, `097` adds no table |
| `authenticated_security_definer_function_executable` | 33 | **34** |

```sql
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and has_function_privilege('authenticated', p.oid, 'EXECUTE');   -- 33 on both, 2026-09-01
```

**Level is a state rather than a property**, so read it rather than inheriting this table: it was
17/24 against 22/33 the day before this was written.

Then `get_advisors(security)` — exactly **one** new
`authenticated_security_definer_function_executable`, for `introduce_to_club`. Two would mean a
`private` helper was created in `public` by mistake.

## Open Questions

### Q1 — Is the introduction mandatory? **ANSWERED 2026-09-01 — arm A.**

> Product owner: *"q1 sounds good A, yes mandatory but dismissable."*

**Decided: required to post, dismissible.** The sheet's Post control is inert until there is
non-whitespace text; a `Not now` closes it; the prompt returns on the next visit to that club (§D7)
and never twice in one session. Nothing else in this change forks on it.

**"Mandatory" cannot mean "no membership without an introduction", and that is a database fact
rather than a reading of the answer.** `club_threads`' INSERT policy requires the membership to
already exist (§Context), so there is always a window in which a rider is a member and has not
introduced themselves, and a closed tab or a dropped connection lands in it. *Joined with no
introduction* is therefore a designed state under this arm and under every other.

**The refused arm is kept because "make it truly mandatory" is the obvious next ask, and this is
the answer to it.** Moving the `club_members` insert inside the introduction's own RPC —
`join_club_with_introduction(club, body)` — does make that one path atomic, and it buys less than
it appears to:

- It creates a **seventh** door and leaves the other six untouched. A rider still arrives with no
  introduction through onboarding's auto-join, an admin's approval, an invite, or a link, so the
  invariant is "one particular button is atomic" rather than "every member has an introduction".
- The membership INSERT policy cannot be reused inside a `security definer` body — a definer
  bypasses RLS — so its predicate would be copied into PL/pgSQL and would drift from the policy it
  duplicates.
- It introduces a failure mode nothing else in the app has: a rejected introduction silently
  rejects the join, so a rider who typed something the CHECK refuses is left outside a club they
  asked to be in.

A third option, an equal Post and Skip, was weighed and loses to A on the only axis that separates
them: A's `Not now` is already the escape hatch, and offering the two as equals produces fewer
introductions for no gain.

### Q2 — Prompt on the action, or on the state? *Non-blocking. The agent's.*

**Recommended default: on the state**, per §D7. The alternative — fire it from `joinClub`'s success
path — is one line and covers one of six doors, and the door it misses most damagingly is
`complete_onboarding`, where a sheet would open inside a wizard `CLAUDE.md` decision #5 says has no
skip affordance. If the owner later wants the prompt at the *moment* of joining as well, the state
rule already permits it: the action can open the same sheet eagerly, and the state rule is what
catches everyone it misses.

### Q3 — What does the default club do? **ANSWERED 2026-09-01 — arm (a), the prefilled starter.**

> Product owner: *"q3 does not take instructions, so a default message should be prefilled?"*, then
> *"Q3 is A yes."*

**Two things were decided.** The Welcome club is still **not prompted** — `058`'s carve-out stands
untouched, for the reason it exists there: every rider joins that club inside a wizard that has no
skip affordance. And in every club the prompt *does* fire for, the sheet's textarea arrives with an
**editable starter** to guide a rider who does not know what to write.

**The starter is a `placeholder`, not a `defaultValue`, and that is a decision rather than an
implementation detail.** Q1 and Q3 were each answered sensibly and they interact badly:

- Q1 landed on *Post is inert until there is non-whitespace text*.
- A textarea carrying a prefilled **value** is never empty. Post is therefore enabled the instant
  the sheet opens, and one tap posts the canned sentence unedited.

So a prefilled value silently repeals Q1's rule, and fills every club with the same sentence over
and over. A **placeholder** does the guiding work the owner asked for — the wording is visible in
the field, greyed, exactly where a value would be — while the field stays genuinely empty, so
Post stays inert until the rider types something of their own and Q1 keeps its meaning.

**A builder will be tempted to "fix" this back to a value, and must not.** The two rules only look
independent; `client-render-shell`'s prompt table and `club-introductions`' starter requirement both
state the placeholder explicitly for that reason.

**If the owner overrules this and wants a real prefilled value, Q1's rule goes with it.** Do not
ship both: a disabled-until-typed Post behind a pre-populated field is a rule that can never fire,
which is worse than either answer alone. In that case the spec drops the inert-Post rule, says
plainly that the sheet's Post is enabled on open, and the sheet's copy has to carry the "these are
your words, edit them" work that the disabled button was doing.

**The starter is copy and nothing else.** It carries no CHECK, no migration and no schema of any
kind, and **no predicate anywhere may compare against it** — not the prompt's state rule, not a
policy, not an assertion. A rider who posts it verbatim has posted an ordinary introduction and the
system must be unable to tell. Its text has to satisfy the bounds the introduction already
inherits — non-blank under `~ '\S'` and at most 1000 characters, matching
`club_messages_body_length` — which any sentence does, but it is stated so nobody writes a starter
that the database would refuse.

**Arm (b) is REFUSED, and its objection is kept because "just auto-post one in the Welcome club" is
the predictable next suggestion.** Arm (b) was: a canned introduction posted automatically into the
Welcome club on the auto-join, since that club is never prompted. Concretely why not:

- `club_threads.author_id` is `NOT NULL` with no default and cascades from `profiles`, so the row
  **must name the new rider as the author of a sentence they did not write**. This schema has no
  system actor and no nullable author; there is nowhere else to put the authorship.
- `081`'s DELETE policy then lets that rider delete it, and their account deletion cascades it —
  both correct for a thread they wrote, both odd for one the app wrote.
- It is **one thread per signup, for ever**, in the single club every rider is in. That is the
  scale `private.notify_club_joined`'s early return exists to avoid, arriving through another door.
- It is the exact shape `club-timeline-engagement` §D2 refused. This change was able to argue it
  was *not* reopening that refusal only because the rider types and posts; (b) removes that.

Making the words attributable to the app rather than to the rider is a schema question — a system
actor, or a nullable author — and it is not one this change answers.

### Q4 — Does "at that section" include the scroll position? **ANSWERED 2026-09-01 — yes, in scope.**

> Product owner: *"q4 yes defers to that scroll position on that discussion, announcement, etc."*

**This overrules the recommendation to defer it**, and correctly — it was their original phrase and
returning to the top of a long timeline is the bug they were reporting.

**Chosen: an anchor per timeline row plus a fragment on the return URL.** The alternative, browser
scroll restoration, is refused for the reason this document already gave against it: the club
timeline is assembled from five independently-resolving reads and re-lays-out between the paint
that restores a position and the paint that has the rows, so restoration lands somewhere arbitrary
and does it **silently**. A fragment naming a row is deterministic, survives a reload, and is
inspectable in the URL bar.

Three properties it must have, and each is a way the obvious implementation fails:

- **The scroll happens after the data lands, not on mount.** A client-rendered list has no rows at
  first paint, so the browser's native fragment handling finds nothing and does nothing. The screen
  scrolls to the anchor when the row it names exists, once, and not again on subsequent renders.
- **An anchor that no longer resolves is a no-op, never an error.** The row may have been deleted,
  may have fallen past the coherence horizon, or may be one the viewer can no longer read. The
  screen renders normally at the top; it does not retry, and it does not report anything.
- **The row key is bounded, like the origin.** It is a well-formed id of a kind the screen already
  draws, parsed the way `backFromCreateScreen` parses its club id, so the only thing the parameter
  can ever produce is a scroll to a row of this club — no URL, no allowlist, no open redirect.

§D9 carries the mechanism.

### Q5 — Does the comment count keep the `+`? *Non-blocking. The agent's.*

**Recommended default: yes on the thread row, and it is not needed on the join row.** §D6's table
gives the reason: the two numbers come from different places and only one of them is windowed.
Losing the `+` in the redesign would be a silent regression — the number would look the same and
mean something weaker.

### Q6 — Should a comment or a wave notify? **ANSWERED 2026-09-01 — yes, both. SPLIT OUT.**

> Product owner: *"q6 yes a comment or wave should notify."*

**Two fan-outs, not one, and both are absent today. Measured on DEV 2026-09-01:**

```sql
select tgrelid::regclass::text, tgname from pg_trigger where not tgisinternal
 and tgrelid::regclass::text in ('club_messages','club_thread_waves','club_join_waves');
-- club_messages      : enforce_participation_gate            <- and NOTHING else
-- club_thread_waves  : enforce_participation_gate            <- and NOTHING else
-- club_join_waves    : enforce_participation_gate, notify_club_waved, retract_club_waved
```

So a reply to **any** club thread notifies nobody, and a wave on a **thread** notifies nobody —
`092` refused the latter deliberately (its §Q2) and the owner has now overruled it. Only the *join*
wave notifies.

**Scope: every club thread, not introductions alone.** This is an interpretation rather than a
quotation — the owner asked in the context of introductions. Building it for introductions only
creates a two-tier rule with no visible reason: replying to a newcomer's introduction notifies,
replying to the thread beside it does not, and a rider cannot tell which kind of thread they are
in. `notifications` §*A future reply notification SHALL be designed as a fan-out, not bolted onto an
introduction* already required this before the answer arrived.

**It is split into its own change, `notify-a-club-thread`, migration `098`**, for three reasons in
descending order of force:

1. **Its migration's safe deploy order is the opposite of `097`'s.** A new notification type must
   apply **after** the bundle that knows it is confirmed serving, because `notificationCopy`
   (`src/components/notifications/copy.ts:44`) and `NotificationsListItem`'s `describe`
   (`:150`) are exhaustive switches and one unknown row takes a rider's whole notifications screen
   down — `089`'s rule. `097` is safe migration-first. Two files with opposite ordering rules must
   not be one file; that is the `069`/`070` lesson.
2. Its subject is every club thread, so filing it under this change's title would archive a
   `notifications` capability under a name that does not describe it.
3. It is materially bigger than the rest of this change put together — see the hazard below.

**The hazard that will bite whoever builds it cheaply, and it fails silently.** `notifications` has
no `thread_id` column, and its collapse key is

```
notifications_event_key  UNIQUE (user_id, type, actor_id, postcard_id, comment_id, ride_id,
                                 club_id) NULLS NOT DISTINCT
```

Reusing `club_id` alone — the obvious way to avoid a schema change — collapses **per (recipient,
type, actor, club)**. Ana replies in thread X and the author is notified; Ana replies in thread Y in
the same club and the fan-out's `on conflict do nothing` **swallows it**, for ever, with no error
anywhere. The notification also cannot deep-link to the conversation; tapping it lands on the club.
So `thread_id` is required, and adding it means **rebuilding the unique index**, which every
existing fan-out's collapse depends on. That rebuild is safe — existing rows hold NULL in the new
column and `NULLS NOT DISTINCT` leaves their collapse unchanged — but it must be one statement
block, and it is not a change to make inside a migration whose subject is something else.

**Two things story 3 must decide and this change does not:** the recipient set (the recommended
default is the thread's author plus everyone who has already posted in it, minus the actor, minus
blocked pairs — bounded by distinct posters, `055`'s shape), and whether deleting a message retracts
a reply notification, given the notification's subject is the thread rather than the message.

### Q7 — Does anybody learn that a new introduction exists? **ANSWERED 2026-09-01 — yes, and it is PD-368.**

Raised by Q6's answer rather than asked in the original round: the join notifies the club's **owner
and admins** only, so in a club of any size the introduction the owner wants replies on could be
seen by nobody, and Q6's reply fan-out would have nothing to fire on.

**Answered, and built elsewhere.** `private.notify_club_joined`'s recipient set widens from
owner-plus-admins to **every member**. That is **PD-368**, its own story, and deliberately not this
change: it adds no notification type and touches neither exhaustive client switch, so it is
order-neutral with respect to the build — which is a different shape from both `097` and story 3's
`098`, and a third reason not to fold it into either.

Nothing in this change restates who learns of a join. Where the artifacts need to refer to it at
all, they point at PD-368 rather than describing a recipient set that is about to change.
