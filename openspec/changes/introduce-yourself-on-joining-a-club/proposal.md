# Introduce Yourself on Joining a Club — the announcement becomes a door

> Linear **PD-365** — *"A rider introduces themselves when they join a club, and the announcement
> becomes that thread's door"*, status **Needs decision**, product owner feedback 2026-09-01.
> `get_issue` and `list_comments` were both called on it: the body is first-hand and **there are
> zero comments**, so nothing has overtaken it.
>
> It extends **PD-356** (`openspec/changes/club-timeline-engagement/`, migration `092`) and
> **PD-355** (`openspec/changes/add-club-timeline/`), both merged and both DEV-only.

## ⚠ Read this first

**1. One decision has to be settled before this is built, and it is the owner's alone.** *"And
maybe we make the field mandatory?"* — see §Q1 and `design.md` §Q1. Both arms are specified so the
spec is pickable either way without a rewrite, but the **schema** and the **screen** differ between
them and the tasks below fork at exactly two places.

**2. The request says five write paths create a membership. There are SIX doors and THREE database
insert sites, measured.** The two the request folds into one are separate public RPCs:

```sql
select n.nspname||'.'||p.proname, p.prosecdef from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public','private')
   and p.prosrc ilike '%insert into public.club_members%';
-- private.join_club_from_invite   t   ← reached by BOTH accept_club_invite (093)
-- private.join_club_from_request  t                 and claim_club_invite_link (093)
-- public.complete_onboarding      t   ← 058/075, every rider, during the wizard
```

plus two client sites — `joinClub` and `createClub` in `src/lib/actions/clubs.ts`. So the doors are
**Join club**, **Create club**, **onboarding's auto-join**, **an admin approving a request**,
**accepting a club invite**, and **claiming an invite link**. All three database sites are
`security definer`, which is why §What Changes puts the participation gate *inside* the new RPC
rather than trusting a trigger — `current_user` in a definer body is the owner, and every gate
trigger carries `when (current_user = 'authenticated')`.

**3. This is NOT `club-timeline-engagement` §D2's declined shape, and the difference is who
authored the thread.** That change refused *"a join auto-creates a `club_threads` row"* for five
reasons, three structural: the thread would name a living rider in an immutable title, the joiner
could delete words other riders wrote, and `058`'s default club would mint one thread per signup.
**Every one of those is a property of the thread being automatic.** Here the rider types the text
and presses Post, so:

| §D2's objection | Why it does not transfer |
|---|---|
| A system thread must name a living rider as `author_id` | The joiner **is** the author, because they wrote it |
| The joiner can delete a thread others welcomed them in | They can delete **their own introduction**, which is what `081` gives every author and what account deletion does anyway |
| A username is published into an immutable title that outlives the membership | The title is a **constant naming nobody** (§The shape); the rider's name is rendered from a live `profiles` read |
| One thread per signup on the default club | The default club is **exempt** — §Q3, `058`'s own carve-out |
| Carving out the default club is self-defeating | It was, for an automatic welcome. For a rider-authored one the alternative is ambushing them mid-wizard |

**4. Everything below is measured against `letsride-dev` (`fpmrimzxadewsaiwpsel`) on 2026-09-01**,
Postgres **17.6**, and each claim carries the command that re-derives it. Two claims were proved by
running the wrong shape in a rolled-back transaction and reading the failure; both are in §The two
traps, and both are shapes a careful author reaches for first.

## Why

A rider joins a club of strangers and the club's answer is a 44px grey row saying their name and
`joined the club.`, with a wave on it. `092` made that row reactable; it is still not a
*conversation*. Nobody in the club learns who arrived, what they ride, or why they came, and the
newcomer has nothing to point at.

The product owner, 2026-09-01:

> When a user joins a club, it should prompt for the user to insert a introduction text. Maybe we
> can have a popup prompt that says this?

> when the user presses 'join club', there should be a popup, welcome to club.... this and that!
> You can create rides, start threads, etc. Then an input for 'Introduction to be posted' something
> like that? And maybe we make the field mandatory? So then this announcement still shows 'user x
> joined etc.' or whatever it is right now. And this can be waved or commented.

**It needs a proposal rather than a ticket because the sentence "the announcement shows the number
of comments" is a visibility decision wearing a number's clothes.** A count is an assertion about
rows, and the rows here are `club_messages` — which a **non-member of a PUBLIC club cannot read
while reading that same club's roster perfectly well**. Measured, as `authenticated`, in a
rolled-back transaction:

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<a rider who is not a member>","role":"authenticated"}';
select (select count(*) from public.club_members  m where m.club_id = '<a PUBLIC club>'),
       (select count(*) from public.club_threads  t where t.club_id = '<the same club>'),
       (select count(*) from public.club_messages m where m.thread_id = '<its thread>');
-- non-member : 2 roster rows, 0 threads, 0 messages
-- member     : 2 roster rows, 1 thread,  2 messages
```

So the join row is reachable by a rider for whom the introduction does not exist. A count read
**under RLS** answers `0` for them, correctly and for free. A count **stored on a column** answers
`2`, and tells them a conversation they may not read is happening in a club they have not joined.
The two implementations are one line apart and only one of them is a disclosure.

## The shape

**An introduction is a `club_threads` row the rider authored, marked as belonging to their
membership, holding its text in a column of its own.** Written by one `security definer` RPC, so
the whole introduction is one statement rather than a thread-write followed by a message-write with
no transaction between them.

```
club_threads
  + introduces_user_id  uuid  NULL     -- the membership this thread introduces
  + introduction        text  NULL     -- the words, CHECK ~ '\S' and length <= 1000

  FOREIGN KEY (club_id, introduces_user_id)
    REFERENCES club_members (club_id, user_id)
    ON DELETE SET NULL (introduces_user_id)          -- ← the column list is not optional
  UNIQUE (club_id, introduces_user_id)               -- partial, WHERE introduces_user_id IS NOT NULL
  CHECK (introduces_user_id IS NULL OR introduction IS NOT NULL)   -- ← one-directional, see Trap 3
  CHECK (introduction IS NULL OR (introduction ~ '\S' AND length(introduction) <= 1000))
```

**The title is a constant that names nobody** (`Introduction`), because `club_threads` has no
UPDATE grant and no UPDATE policy — a title is immutable for the life of the thread, and
`club-timeline-engagement` §D2 refused a shape precisely for publishing a rider's username into
one. **The cost is that a club's Threads list can show several identically-titled rows**, so the
secondary line on those rows carries the author's name — derived from `author_id`, which survives
the leave that nulls the marker. The screen renders the newcomer's name from a live `profiles` read **hinted on
`author_id`** — the marker is a composite key into `club_members` and has no relationship to
`profiles` at all, so it is the thread's author that names the rider. Nothing is snapshotted and
nothing outlives the membership. `design.md` §D8 carries the measurement, and the hint is not
optional: `club_threads`↔`profiles` is **already ambiguous** and an unhinted embed answers
`PGRST201` / HTTP 300.

**The text is a column rather than a first `club_messages` row, and that is what makes the count
honest.** With the introduction in the thread, *every* `club_messages` row in it is a comment, so
the number beside the icon is the already-proven embed with no arithmetic on top:

```ts
// src/lib/data/postcards.ts, live since 011 — the identical shape one domain over
comments_count:postcard_comments(count)
```

Put the introduction in `club_messages` instead and the count is `messages − 1`, which is wrong the
moment the opening message is deleted by its author (`delete_own_club_message`) or hidden from the
viewer by a block — and wrong invisibly, because a count cannot say which. `design.md` §D3.

## What Changes

**One migration, `097`** — two columns, one composite foreign key, one partial unique index, two
CHECKs, one column-scoped SELECT grant, one `security definer` RPC, and the RLS assertions
`openspec/config.yaml` requires beside them. **No new table**, so the participation-gate count does
not move; **one new PUBLIC function**, so the security-advisor count moves by exactly one.

```sql
-- 097 adds no table, so this number does not move — whatever it is when 097 applies.
select count(*) from pg_trigger
 where tgname = 'enforce_participation_gate' and not tgisinternal;
-- 22 on DEV, 2026-09-01. PROD reads 17 TODAY and 22 by the time 097 reaches it, because the
-- five-table gap IS 092-095 and those go first. Read it, do not carry it: the baseline for
-- this check is taken AFTER the promotion group lands, not from this sentence. Task 0.4.
```

### The database

- **`introduce_to_club(target_club uuid, body text) returns uuid`** — `security definer`, takes a
  **CLUB and never a rider id** (`085`'s and `088`'s idiom), subject read from `auth.uid()` alone.
  It **restates the participation gate** through `private.may_participate_for(auth.uid())`, which
  is mandatory rather than belt-and-braces: `023`'s trigger on `club_threads` carries
  `when (current_user = 'authenticated')` and `current_user` inside a definer body is the owner, so
  the trigger cannot fire for this write. This is `078`'s measured lesson and `085`'s remedy.
- **ONE raise site**, so a caller learns nothing about a club they cannot see — `083`, `085` and
  `091` all ship this and it is the reason none of their RPCs is an oracle.
- **No new client grant on the write path.** `club_threads`' INSERT grant stays
  `(author_id, club_id, id, title)`; the two new columns are **SELECT-only** for `authenticated`,
  so the RPC is the only thing that can write an introduction and a client cannot mark somebody
  else's thread as their introduction.

### The screen

- **A prompt after joining** — a sheet on `ContextMenu`'s scrim, with the welcome sentence and a
  `Textarea`. **There is no v2 frame for it**: `npm run figma -- ls` finds `v2 / Component /
  Context Menu` and no popup, modal or dialog frame at all, so the composition is ours and is
  logged in `docs/FIGMA-FIDELITY-TODO.md`.
- **It is driven by STATE, not by the Join button** — a membership with no introduction — which is
  the only rule that reaches all six doors. §Q2 carries the alternative and why it loses.
- **The join row loses its ⋯ and gains a comment count.** `092`'s `Say welcome` goes with it; the
  count is the door to the same conversation that menu item used to compose. The wave **stays** —
  the owner's words, *"this can be waved or commented"*.
- **Thread rows swap `2 replies` for the icon and the number** — and **the `+` survives on exactly
  the rows that carry it today**. `ClubTimelineThreadRow`'s count is a floor when the club-wide
  message window filled, and its own header says so: *"without it the row asserts a total it cannot
  know"*. A bare number is that assertion. **A full window is necessary and not sufficient**:
  `mergeClubTimeline` already clears the flag on every thread-**creation** row, because a creation
  row inside the horizon has all its replies inside the window, and carrying it there renders `2+`
  on a thread with exactly two. Re-deriving the rule from the window alone re-adds a `+` that is
  known wrong. §Q5, and `design.md` §D6.
- **Backing out of a thread returns to the club detail** when that is where the rider came from,
  carried as a bounded parameter in `CREATE_CLUB_PARAM`'s shape rather than a referrer. §Q4.

### The row has no spare width, measured

```bash
npm run figma -- tree "Private club - Timeline"
#   FRAME · Event 326×44
#     INSTANCE · v2 / Component / Avatar 28×28
#     FRAME · Text 242×28   "Ron Wilson joined the club."
#     FRAME · Time Since 16×28
```

28 + 242 + 16 fills 326 with nothing to spare, and no frame draws a wave, a count or an overflow
here — `ClubTimelineEventRow`'s header already records this and adds the controls anyway, letting
the sentence truncate. This change is close to width-neutral (an overflow trigger out, a count in)
and the sentence keeps truncating. Stated so it is not rediscovered as a defect.

## The three traps

All three are shapes a careful author reaches for first, all three were run on DEV in a rolled-back
transaction, and all three are recorded here because a reader would otherwise re-derive the wrong
version from the same evidence. **Two of them fail only at a rider's leave**, long after the
migration is green.

**Trap 1 — the composite `on delete set null` is accepted at DDL time and refuses the leave.**
`club_threads.club_id` is `NOT NULL`, and a bare `on delete set null` nulls **every** referencing
column, so deleting the membership tries to null `club_id` too:

```
ALTER TABLE ... ON DELETE SET NULL             -- accepted, no warning
DELETE FROM club_members ...                   -- 23502: null value in column "club_id"
                                               --        of relation "club_threads"
ALTER TABLE ... ON DELETE SET NULL (introduces_user_id)   -- Postgres 15+; DEV is 17.6
DELETE FROM club_members ...                   -- succeeds; thread survives, marker NULLed
```

A rider who introduced themselves could **never leave the club**, and nothing in the migration
would look wrong. The column list is the fix; `097.6` is the assertion, and it has to delete a
membership that *has* an introduction or it proves nothing.

**Trap 2 — putting the marker on `club_members` costs an UPDATE policy, and that policy hands out
`admin`.** `authenticated` already holds `UPDATE (club_id, role, user_id)` on `club_members` and
the table has **zero UPDATE policies**, which is what makes the grant inert:

```sql
select count(*) filter (where cmd='UPDATE'), count(*) from pg_policies
 where schemaname='public' and tablename='club_members';   -- 0 of 3
```

Add the obvious own-row policy so a rider can write their own `introduction_thread_id`, and the
existing `role` grant comes with it. Measured, rolled back:

```sql
create policy probe on public.club_members for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- as an ordinary member, on their own row:
update public.club_members set role = 'admin' where user_id = auth.uid();
-- role_after_self_update = admin
```

That defeats `019`, `088` and the standing requirement
`database-enforced-integrity` §*Club membership role SHALL NOT be self-assignable*. **The marker
goes on `club_threads` for this reason**, and `097.9` asserts `club_members` still has zero UPDATE
policies so a later change cannot add one quietly. `design.md` §D2 carries the third option.

**Trap 3 — the CHECK pairing the two new columns must be one-directional.** A foreign key's
`SET NULL` is an UPDATE, so every CHECK on the row is re-evaluated with the marker already nulled.
The biconditional — *both set or both null*, which is the obvious way to forbid a half-state — is
therefore violated by the fix for Trap 1, and refuses the same leave with `23514` instead of
`23502`:

```sql
check ((introduces_user_id is null) = (introduction is null))   -- accepted at DDL time
delete from club_members ...   -- 23514: violates check constraint   ← the rider cannot leave
check (introduces_user_id is null or introduction is not null)  -- survives, and still refuses
delete from club_members ...   -- succeeds; a marker with no text is still 23514
```

`097.7` is the assertion, and it only works if the leaving rider **has** an introduction —
`design.md` §D5.

## Capabilities

### New Capabilities

- `club-introductions`: what an introduction is, who may write one, who may read one, what the
  count beside a join row means, what happens to it when the rider leaves, is blocked, deletes it,
  or has it moderated, and which of the six join doors prompts for one.

### Modified Capabilities

- `club-timeline`: the join row stops being a link to a profile and becomes a row with three
  targets (avatar → profile, row/count → thread, wave → the wave). The stream gains no source.
- `club-timeline-engagement`: `092`'s *"The words half of 'say welcome' SHALL be rider-initiated
  and SHALL create no schema"* is superseded — the words are now the newcomer's, the affordance is
  removed, and the schema it declined is added under a different author.
- `club-threads`: a thread may now carry a marker and a body, both immutable; the delete and
  moderate paths reach an introduction unchanged, and what the join row shows afterwards is stated.
- `database-enforced-integrity`: the column-scoped `SET NULL` rule, the prohibition on an UPDATE
  policy over `club_members`, and the introduction's text bounds as a CHECK rather than a Zod rule.
- `client-cache-invalidation`: two keys under `clubs.detail(clubId)`, and the rule that posting an
  introduction moves the join row, the thread list and the timeline together.
- `client-render-shell`: the prompt's five states, and the count's — including the one where the
  viewer may not read the thread the number would describe.
- `notifications`: the silence is stated rather than left to be discovered — a comment on an
  introduction notifies **nobody**, because this schema has no `club_thread_replied` type at all.

## Non-Goals

- **No atomic "no join without an introduction".** Available only by moving the `club_members`
  insert inside the same RPC, which would make a **seventh** door and leave the other six behind.
  §Q1's arm B specifies it if the owner wants it; the recommendation declines it.
- **No notification when somebody comments on an introduction.** This app has **fourteen**
  notification types and not one of them fires on a `club_messages` insert — a reply to any thread
  notifies nobody today, and fixing that is a change about threads, not about introductions.
  Named rather than half-built; §Q6.
- **No editing an introduction.** `club_threads` has no UPDATE grant and no UPDATE policy for
  anyone, and this change adds neither. A rider who wants a different introduction deletes the
  thread and writes another — the same answer a thread title already gets.
- **No introduction on the default club**, per §Q3 — and no backfill prompt for the **22**
  memberships that already exist on DEV, six of them on the default club.
- **No introduction for a club's OWNER.** `054` makes the owner a member, so the state rule would
  otherwise prompt every founder to introduce themselves to the club they just founded.
- **No Realtime.** The count is read on load like every other count in this app.
- **No rate limit.** `036` §8 already records that nothing in this app rate-limits anything; the
  partial unique index means a rider has at most one introduction per club, which is a tighter
  bound than `postcard_likes` carries.

## Open decisions

**Six, and one is blocking. Three of the six are the product owner's** — they are marked, because
an owner-only decision mixed into a list of build tasks is the one that never gets asked. Each has a
recommended default so the build can start on it and be corrected, per the standing
*ambiguity → assume and proceed* instruction in `CLAUDE.md`. The full argument on each side is in
`design.md`.

| # | Question | Who answers | Blocking | Recommended default |
|---|---|---|---|---|
| **Q1** | Is the introduction mandatory? | **Product owner** | **Yes** | Required-to-post, dismissible — Post disabled until there is text, plus `Not now` |
| **Q2** | Prompt on the Join action, or on the state? | Agent | No | On the **state**: a membership with no introduction. Reaches all six doors |
| **Q3** | Does the default club take introductions? | **Product owner** | No | **No.** `058`'s carve-out, for the same reason |
| **Q4** | Does "back to the club detail **at that section**" mean the scroll position too? | **Product owner** | No | The screen first, the scroll position deferred — see below |
| **Q5** | Does the comment count keep its `+`? | Agent | No | **Yes**, on the thread row's reply entries. Its creation entries are exact and must not gain one (§D6) |
| **Q6** | Should a comment on an introduction notify the newcomer? | **Product owner** | No | **Not in this change.** No notification type in this app fires on a club message at all |

**Q4 deliberately keeps a phrase of the owner's own request open rather than settling it.** They
asked for the club detail *"at that section"*; this change ships the **screen** and defers the
**scroll position**, because the club detail is a timeline with no named anchors and restoring a
position is its own piece of work. That is a partial delivery of a stated ask, so it is named here
and it does not close with this change — the remainder is a follow-up issue, not a comment on a
closed one. If the owner reads the plain return as the bug they reported, the scroll position moves
into scope and `design.md` §Q4 has the two ways to build it.

## Impact

- **Affected specs** — a new capability `club-introductions`, plus deltas on `club-timeline`,
  `club-timeline-engagement`, `club-threads`, `database-enforced-integrity`,
  `client-cache-invalidation`, `client-render-shell` and `notifications`.
- **Affected code** — `src/lib/data/club-introductions.ts` (new),
  `src/lib/actions/club-introductions.ts` (new),
  `src/components/clubs/IntroductionPrompt.tsx` (new),
  `src/lib/data/club-threads.ts` (**`getClubThread` must select `introduction`** — today it selects
  `'id, club_id, author_id, title, created_at'`, so without this the text is written and read by
  nothing),
  `src/components/clubs/ClubTimelineEventRow.tsx` (the ⋯ goes, the count arrives),
  `src/components/clubs/ClubTimelineThreadRow.tsx` (`replyLabel` becomes an icon and a number),
  `src/components/clubs/ClubTimeline.tsx`, `src/components/clubs/JoinClubButton.tsx`,
  `src/app/(app)/clubs/detail/page.tsx`, `src/app/(app)/clubs/detail/thread/page.tsx`,
  `src/lib/routes.ts`, `src/lib/query/keys.ts`, `src/lib/validation/clubs.ts`,
  `src/types/index.ts`, `docs/reference/schema.md`, `docs/reference/product-scope.md`,
  `docs/FIGMA-FIDELITY-TODO.md`.
- **Affected database** — `097`: two columns on `club_threads`, one composite foreign key with a
  **column-scoped** `ON DELETE SET NULL`, one partial unique index, two CHECK constraints, one
  column-scoped SELECT grant, one `security definer` RPC. **No new table**, so the
  participation-gate count is **unchanged**, and **exactly one** new security advisor —
  `authenticated_security_definer_function_executable` — because `introduce_to_club` is the one
  PUBLIC function this migration adds.

  **Both deltas are stated as deltas, and their baselines are read at apply time rather than from
  this file**, because `092`–`096` move both of them on PROD *before* `097` gets there. Today's
  numbers are PROD 17 gate triggers and 24 advisors of that class; after the promotion group and
  before `097` they are **22 and 33** — measured on DEV, which already has `092`–`096`:

  ```sql
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');   -- 33 on DEV, 2026-09-01
  ```

  So `097` verifies against 22 → 22 and 33 → 34 on both projects. Task 0.4 re-measures rather
  than trusting either pair.
- **Promotion** — `092`–`096` are DEV-only as of 2026-09-01, so `097` lands on a DEV that has them
  and a PROD that has none. It is **additive and NOT inert** (`036`'s hand-exercise gate applies:
  the RPC writes into a live table under a live gate), and it must go to PROD **after** `092`–`096`
  in filename order and **before** the bundle that calls `introduce_to_club` serves — a client
  calling an absent RPC gets `PGRST202` and the prompt is dead, which is the safe side, while the
  reverse order is also safe. `tasks.md` §9 carries it. Verify rather than trust:
  `list_migrations` against both refs against `ls supabase/migrations/`.
