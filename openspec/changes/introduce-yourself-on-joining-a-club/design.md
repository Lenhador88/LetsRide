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
exists, and a rider who dismisses the prompt (§Q1's arm A) must not be asked again on the next
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

**Chosen:** a query parameter in `CREATE_CLUB_PARAM`'s exact shape — it carries an *origin kind*
from a closed set, never a URL, so there is no allowlist to maintain and no open redirect to close.
`routes.ts` already explains why `BACK_ORIGINS` is the wrong reuse: that list is derived from the
screens rendering `NotificationsHeaderControl` and has its own drift test.

**Absent means the thread list**, which is today's behaviour and is what a deep link, a
notification tap, a shared URL and a reload all produce. That is the safe default: it lands the
rider somewhere that certainly exists and that they can certainly read, because they just read the
thread. §Q4.

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
- **[The prompt is one more thing between a rider and the club they just joined]** → §Q1's arm A
  keeps `Not now` one tap away and the dismissal sticks for the session. Arm B does not, and that
  is the trade the owner is being asked to make.

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

**On PROD it goes after `092`–`096`, in filename order.** Those five are DEV-only as of
2026-09-01 and `097` depends on `092` for nothing in SQL but on the whole club batch for the screen
it changes.

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
applies, never against a number written here.** `092`–`096` move both of them on PROD *and go
first*, so a baseline taken from this document would be wrong on the project it is checked against:

| | PROD today | PROD after `092`–`096`, before `097` | after `097` |
|---|---|---|---|
| `enforce_participation_gate` triggers | 17 | 22 | **22** — unchanged, `097` adds no table |
| `authenticated_security_definer_function_executable` | 24 | 33 | **34** |

The middle column is measured off DEV, which already has `092`–`096`:

```sql
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and has_function_privilege('authenticated', p.oid, 'EXECUTE');   -- 33 on DEV, 2026-09-01
```

Then `get_advisors(security)` — exactly **one** new
`authenticated_security_definer_function_executable`, for `introduce_to_club`. Two would mean a
`private` helper was created in `public` by mistake.

## Open Questions

### Q1 — Is the introduction mandatory? **BLOCKING. Product owner's alone.**

> *"And maybe we make the field mandatory?"*

**It cannot mean "no membership without an introduction" while the write is a client write.** The
INSERT policy in §Context requires the membership to already exist, so there is always a window in
which a rider is a member and has not introduced themselves — and a closed tab, a dead tunnel or a
`23514` from the participation gate lands in it. So "mandatory" has to be chosen from:

**A) Required-to-post, dismissible. — RECOMMENDED.** The sheet's Post button is disabled until
there is non-whitespace text; a `Not now` closes it; the prompt returns on the next visit to that
club (§D7) and never during the same session.

> **Recommendation** 8/10
>
> gets the content in almost every case and traps nobody — a modal a rider cannot leave, in front of
> a club they have *already joined*, is a dead end reachable by a dropped connection
>
> **Complexity** 4/10
>
> the sheet, the state rule, a per-(rider, club) session dismissal
>
> **Urgency** 2/10
>
> nothing forces it; the club batch it builds on is already on DEV
>
> **Customer value** 7/10
>
> a rider joining a club of strangers arrives with something to say, and the club has something to
> reply to
>
> **This session** N
>
> the owner is answering it now; the spec is written so either arm can be picked

**B) Atomic — one RPC joins and introduces in one transaction.** `join_club_with_introduction(club,
body)` writes the `club_members` row and the thread together, so a rider is never a member without
an introduction *through that door*.

> **Recommendation** 3/10
>
> it makes a SEVENTH door and leaves the other six exactly as they are — a rider can still arrive
> with no introduction through onboarding, an invite, a link or an approval, so the invariant it
> buys is not the invariant it sounds like
>
> **Complexity** 7/10
>
> a second `security definer` RPC duplicating `club_members`' INSERT policy in a body (the policy
> cannot be reused — a definer bypasses it), plus a new failure mode where a rejected introduction
> silently rejects the join
>
> **Urgency** 1/10
>
> nothing forces it
>
> **Customer value** 3/10
>
> the rider gains a guarantee they cannot perceive; what they notice is that a bad connection now
> costs them the join as well as the introduction
>
> **This session** N
>
> owner's call, and it forks the migration

**C) Optional — the sheet has an equal Post and Skip.**

> **Recommendation** 4/10
>
> honest and cheap, and it will produce noticeably fewer introductions than A for no gain over it —
> A's `Not now` is already the escape hatch, it is just not offered as an equal
>
> **Complexity** 3/10
>
> A minus the disabled-button rule
>
> **Urgency** 1/10
>
> nothing forces it
>
> **Customer value** 4/10
>
> the rider is asked and can decline without reading a disabled button
>
> **This session** N
>
> same decision as A

### Q2 — Prompt on the action, or on the state? *Non-blocking. The agent's.*

**Recommended default: on the state**, per §D7. The alternative — fire it from `joinClub`'s success
path — is one line and covers one of six doors, and the door it misses most damagingly is
`complete_onboarding`, where a sheet would open inside a wizard `CLAUDE.md` decision #5 says has no
skip affordance. If the owner later wants the prompt at the *moment* of joining as well, the state
rule already permits it: the action can open the same sheet eagerly, and the state rule is what
catches everyone it misses.

### Q3 — Does the default club take introductions? *Non-blocking. Product owner's.*

**Recommended default: no.** `058`'s carve-out, for the same reason it exists there. Six of DEV's
22 memberships are on the default club and every future signup adds one.

**The counter-argument is real and is `club-timeline-engagement` §D2's**: *"the rider with the
emptiest app is the only one guaranteed to get no welcome."* It is weaker here, because the
alternative is not "no welcome" but "a modal during onboarding", and because a rider can still
reach every other club. If the owner prefers introductions there, the change is one clause in §D7's
rule and one assertion — the spec is written so it is a predicate, not a redesign.

### Q4 — Does "at that section" include the scroll position? *Non-blocking. **Product owner's**.*

**The mechanism is the agent's and is settled** — a bounded origin parameter, §D9. Absent → the
thread list, which is today's behaviour and what every deep link produces. **What is the owner's is
how much of their own phrase this change delivers**, and that is why this question is routed to them
rather than answered here.

They asked for the club detail *"at that section"*. The club detail is a timeline with a header and
no named anchors, so "that section" is a **scroll position**, and restoring one needs either an
anchor per row plus a fragment, or the browser's own scroll restoration re-enabled for this route —
neither of which is the parameter, and both of which are their own piece of work.

**Recommended default: ship the screen, defer the position, and say so.** A back button that lands
at the top of the right screen is a fix; one that lands at the top of the wrong screen is the bug
being reported, so the parameter alone is worth having on its own.

**But this is a partial delivery of a stated ask and SHALL be recorded as one.** The product owner's
standing instruction after PD-279 — *"the main feature is not being developed in the main story we
discussed about"* — is exactly about this shape: a story that ships the easy half and writes off the
phrase it was asked for. So the remainder is a follow-up issue **before** this one closes, never a
comment on a closed one, and `proposal.md` §Open decisions names it in the table the owner actually
reads.

Two ways to build the deferred half, when it is wanted:

- **An anchor per timeline row** plus a fragment on the return URL. Deterministic, survives a
  reload, and costs an id on every row.
- **Scroll restoration**, re-enabled for this route. Free when it works and silently wrong when the
  timeline re-fetches and re-lays-out between the two paints, which is the common case here.

### Q5 — Does the comment count keep the `+`? *Non-blocking. The agent's.*

**Recommended default: yes on the thread row, and it is not needed on the join row.** §D6's table
gives the reason: the two numbers come from different places and only one of them is windowed.
Losing the `+` in the redesign would be a silent regression — the number would look the same and
mean something weaker.

### Q6 — Should a comment on an introduction notify the newcomer? *Non-blocking. **Product owner's**, and in `proposal.md` §Open decisions' table.*

**Recommended default: not in this change, and say so out loud.** No notification type in this
schema fires on a `club_messages` insert — measured off `notifications_type_check`, which lists
fourteen types and none of them is a thread reply. So a rider who introduces themselves and gets
three replies is told nothing, and that is **not** a gap this change opens; it is how every thread
in the app already behaves.

It is nonetheless the most likely thing to disappoint, because an introduction is the one thread
whose author is *waiting* for an answer. It wants its own proposal: a reply fan-out is a recipient
set (everyone in the thread? the thread's author? the club?), a collapse rule, a retraction on
delete, and a fifteenth type — `event-fanout-integrity`'s ten requirements each apply. Named here
so it is a decision rather than an omission.
