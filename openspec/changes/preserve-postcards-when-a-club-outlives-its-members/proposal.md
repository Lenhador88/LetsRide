# Preserve postcards when a club outlives its members

> **PD-98.** The issue body is from 2026-08-07 and its stated default is **rejected**. The
> correction is in the issue's own comments, which is where this repo records a superseded
> decision — read them before this file. Both were read on 2026-09-05.
>
> **The product owner decided this on 2026-09-05 at 17:26Z**, one minute after moving the issue out
> of `Needs decision` into `Queued (AI)`. This proposal is the design for **one decided option**,
> not a decision document. Nothing below is an assumption standing in for an owner answer.
>
> **What the body says and what is now true.** The body proposes handing the club to *"the author
> of the oldest surviving postcard"*. The owner rejected it in as many words: *"that gives somebody
> a club they never joined, with its members, its rides and its name."* §Rejected alternatives
> records it, and the second rejected option, so neither is re-derived.

## Why

**A rider deleting their account can destroy postcards belonging to riders who left years ago, and
the reasoning that says they cannot is false.**

`private.transfer_owned_clubs(departing uuid)` — `029`, superseded by `032`, body read from
`pg_proc` on DEV 2026-09-05 rather than from the migration file — hands each club owned by the
departing rider to the longest-tenured remaining `admin`, else `member`. When no other member
remains it takes the other arm:

```sql
delete from public.rides where club_id = club.id and is_public = false;
delete from public.clubs where id = club.id;
```

`postcards.club_id → clubs` is **`ON DELETE CASCADE`** (`confdeltype = 'c'`, read from
`pg_constraint`). So that second statement destroys every postcard in the club, including postcards
whose authors are alive, have never asked for anything to be deleted, and are not party to this
erasure at all.

**The premise that made that safe is not true.** `029` §2 reasoned that a club with no members left
holds postcards *"entirely their own by construction"*. Nothing deletes a postcard when its author
leaves a club: the triggers on `club_members` are `enforce_participation_gate`, `notify_club_joined`
and `protect_club_owner_membership`, and on `postcards` they are `enforce_participation_gate` and
`postcards_set_updated_at` — read from `pg_trigger`, and none of them touches the other table. A
rider leaves; their postcards stay. So the arm that fires precisely when *"the club is entirely
theirs"* is the arm most likely to be wrong about it.

The defect, in one line: **club C is owned by A; riders B and D posted into C and later left; A
deletes their account; B's and D's postcards are destroyed.**

**This is latent, not live, and that changes the task list rather than the design.** Measured on
DEV 2026-09-05 with RLS bypassed: 15 clubs, 11 postcards, 5 of them in a club, **0 postcards
authored by a non-member of their club**, **0 memberless clubs**. So no rider has lost anything
yet, **there is nothing to backfill**, and the migration needs no data-repair step — only the
forward guarantee. `009`'s cascade is not a bug that has fired; it is a loaded one.

## What Changes

**A club whose last member leaves while third-party postcards survive stays, with no owner.** The
owner's words, and the whole of the change:

> *"The postcards keep the club context they were posted to, nobody inherits anything, and the
> deletion cascade stops destroying content belonging to people who had already left."*

- **`clubs.owner_id` becomes nullable.** It is `NOT NULL` today (`pg_attribute.attnotnull = true`),
  so an ownerless club is unrepresentable and this is a **genuinely new lifecycle state**. The owner
  asked this be checked before building — §The check the owner asked for has the answer and the one
  place the state *is* already anticipated.
- **`private.transfer_owned_clubs`' no-successor arm splits in two.** With no third-party postcard
  to protect, it still deletes the club — `009`'s original reasoning is untouched and correct there.
  With one or more, it nulls `owner_id` and leaves the club standing.
- **An ownerless club is a tombstone.** Nobody owns it, nobody can edit, delete, join, be invited
  to, or request to join it; it appears on no Explore list and in no search; it holds no members.
  Its postcards survive with `club_id` **intact**, and their audience moves **strictly narrower** —
  from "the club's members" to "their authors alone". No rider gains sight of anything.
- **The `clubs` SELECT policy's `is_public` arm is narrowed to `is_public AND owner_id IS NOT NULL`.**
  This is the load-bearing line. Without it a public club that goes ownerless keeps appearing on
  Explore with a working Join button, and one tap un-hides every preserved postcard to a rider who
  was never there — §D3.
- **Both image paths are nulled and surrendered** in the new arm, exactly as the existing transfer
  arm already does, because the CHECK that pins them to the owner's folder **stops biting** the
  moment `owner_id` is NULL — §D5.
- **An ownerless club with no postcards left is reaped**, so the tombstone is not permanent — §D6.

**One migration, `107`.** Re-derive the number before writing it: `ls supabase/migrations/ | tail`
(last on disk is `106`) against `list_migrations` on both refs.

### What does NOT change

- **`public.delete_owned_club` (`043`) is untouched.** A club deliberately deleted by its owner
  still cascades. §D7 argues it rather than assuming it — the two paths differ by whether there is a
  human standing there to be asked.
- **The rides half stays as `032` wrote it in the delete arm**, and the new arm deletes no ride at
  all. §D8.
- **No new `public` function**, so the security-advisor count is unchanged at **39 DEV / 37 PROD**.
- **No TypeScript type changes.** A consequence of §D3, not an accident: no client ever reads a club
  row with a NULL `owner_id`, so `owner_id: string` stays honest.

## Capabilities

### New Capabilities

- **`club-ownerless-lifecycle`** — what an ownerless club is, what it shows, who may act on it,
  how it is created, and how it ends.

### Modified Capabilities

- **`database-enforced-integrity`** — gains one requirement: a nullable column that policies,
  CHECKs and helpers already interpolate SHALL have its three-valued behaviour decided per site,
  because the three sites fail in three different directions. §D2.

Read against the standing specs in `openspec/specs/`, all eight of which were read for this change.
`client-cache-invalidation` is **not** modified: the change writes no new client read, and the one
cache consequence is covered by an existing claim.

## Impact

- `supabase/migrations/107_a_club_may_outlive_its_last_member.sql`
- `supabase/tests/rls_test.sql` — every requirement below is a role-and-resource statement, and each
  maps onto an assertion. A policy change with no new assertion is not finished.
- `docs/reference/schema.md` — the `clubs` row's *"a club outlives its owner"* line is now true in a
  second, stronger sense and says so.
- **No `src/` file changes.** Stated as a measured expectation, not a hope: the audience narrowing
  is entirely in RLS, and §D3 keeps `owner_id` NULL off the wire.

## The check the owner asked for

> *"Check before building, because it may already be true: `CLAUDE.md` §Supabase Rules records that
> a club outlives its owner, so an ownerless club may be a state the schema already supports rather
> than a new one."*

**It is not, and the answer is a clean no.** `public.clubs.owner_id` is `NOT NULL` on DEV. What
`CLAUDE.md` and `docs/reference/schema.md` describe is ownership **transfer** — `029`/`032` hand the
club to a successor so it survives its founder — which is a different thing from having no owner.

**Two places already anticipate the state anyway, and both are evidence the design is right rather
than evidence the work is done:**

- `private.protect_club_owner_membership` opens with `if v_owner is null then return old; end if;`,
  commented *"Rule 3. Defence in depth"*.
- `private.join_club_from_invite` opens its guards with `if v_owner is null or v_is_default then
  return false; end if;` — `085` wrote it. **So the invite *write* path is already closed against an
  ownerless club before this change touches anything.**

Neither makes the state representable. `054`'s *"ownerless owner"* — a club whose `owner_id` points
at a rider holding no roster row — is a third, different thing again, and this change does not
disturb it.

## Rejected alternatives

Recorded so nobody re-derives them. **The choice is not open**; this table is a decision record.

| Option | Preserves third-party content | Audience never widens | Nobody inherits | Keeps club context | Total | Verdict |
|---|---|---|---|---|---|---|
| **Ownerless club** (this change) | 10 | 10 | 10 | 8 | **38** | **Decided, owner, 2026-09-05** |
| Detach postcards, delete the club | 10 | 3 | 10 | 0 | 23 | Rejected — owner |
| Transfer to the oldest postcard's author | 10 | 2 | 0 | 10 | 22 | Rejected — owner |
| Status quo (documented cascade) | 0 | 10 | 10 | 0 | 20 | Rejected — it is the defect |

**Detach — rejected by the owner, and independently dangerous.** The owner's reason was loss: *"it
loses the 'posted to this club' context, which is part of what the postcard means."* There is a
second reason they did not have to reach, and it is worth recording because it is the stronger one.
The live `postcards` SELECT policy is:

```sql
(author_id = auth.uid())
OR ( NOT private.is_blocked(auth.uid(), author_id)
     AND (club_id IS NULL OR private.is_club_member(club_id))
     AND NOT EXISTS (SELECT 1 FROM postcard_hides h
                      WHERE h.postcard_id = postcards.id AND h.user_id = auth.uid()) )
```

**`club_id IS NULL` means "visible to every signed-in rider".** So setting `club_id = null` to save
a private club's photos would publish them to the entire app. It is a data-exposure bug wearing the
costume of a content-preservation fix, and it holds for a **public** club too — a public club's
postcards are members-only via `is_club_member`, so detaching widens in both cases. It could be
rescued with a new author-only column and a policy change, but that is a second mechanism buying
back an audience the chosen option never gives away. The audience direction is the whole argument:
**this change only ever moves it narrower.**

**Transfer — rejected by the owner.** Beyond *"a club they never joined"*, the successor may be
someone who **deliberately left**, and the club carries its name, its remaining rides and its
roster. Scored 2 on audience because the recipient gains sight of every postcard in the club.

**Status quo — it is the defect.** Costs: third-party postcards destroyed with no notice to their
authors and no route to recover them, their Storage bytes permanently orphaned (`PD-94`), and the
loss attributed to nobody, because the rider who triggered it was exercising an unrelated right.

## Blocking and non-blocking questions

**Blocking: none.** The owner decided the option and both branches of their conditional are
resolved below.

**Non-blocking, each with a recommended default so the build proceeds** — §Open Questions in
`design.md` carries the reasoning:

1. **Q1 — Do the preserved postcards still show their club's name?** *Default: no, in this change.*
   The data keeps the context; the screen does not yet. This is the one place the design does not
   fully reach the owner's stated rationale and it is called out rather than glossed — §D4.
2. **Q2 — Should an ownerless club be adoptable?** *Default: no, and out of scope.* §D9.
3. **Q3 — Do the club's private rides still die in the new arm?** *Default: no, they survive.* §D8.
4. **Q4 — Is the reaping trigger worth its risk?** *Default: yes, built with the hand-exercise
   gate.* §D6.

Q1 and Q2 are the **product owner's** alone. Q3 and Q4 are technical and a reviewer can settle them.
