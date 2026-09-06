# Refuse a removed rider a live invite link

> Linear **PD-361**, filed out of `openspec/changes/invite-riders-to-a-club/`'s design (its
> *What removal does not do, and the gap that leaves* section) rather than built there, on
> PD-351's precedent. This file is the specification and the issue does not restate it.

## What was read first-hand, and what was not

**Everything below is first-hand.** The Linear connector answered: PD-361's body **and its five
comments** were read directly, including the product owner's decision comment of 2026-09-05, which
is the decision this change builds to. The Supabase connector answered: DEV
(`fpmrimzxadewsaiwpsel`) was read live for the applied migration list, the absence of
`public.club_removals`, the three triggers on `public.club_members` with their full definitions,
and the participation-gate trigger count (**21**, matching the repo's own claim). `088` and `093`
were read from the migration files in this repo, not from prose about them.

**One mechanical note, and it is not about content.** These artifacts were scaffolded by
`openspec new change` and validated by `openspec validate … --strict`, driven as
`node node_modules/@fission-ai/openspec/bin/openspec.js …` because `node_modules/.bin/` did not yet
exist at the moment they were written — the container's `npm ci` was still running. **That was
transient and is not a repo defect:** `npx openspec validate … --strict` resolves normally once
dependencies are installed, and is the command to use. Nothing about the artifacts is hand-rolled
around the tooling.

## The product owner's decision, verbatim (2026-09-05)

> "A `club_removals` row keyed on `(club_id, user_id)`, consulted by the **invite-link claim path
> only**. A removed rider pasting a still-live link is refused; nothing else about them changes."

and, in the same comment:

> "The wide reading is explicitly not what was chosen. … the owner's reason for taking the narrow
> one is that a removal should not silently become a permanent ban."

**Neither half is reopened anywhere below.** The narrow reading turned out to be expressible
without touching `085`'s join-request path or PD-360's in-app-invite path, so the escape hatch the
owner asked for — *stop and say so rather than widening* — was not needed. What it leaves open is
in *Open questions* below, as a question rather than as a silent widening.

## Why

**`088`'s Remove button can be undone by the rider it removed, and the admin is never told.**

`public.remove_club_member(uuid, uuid)` deletes exactly one `club_members` row and one
belt-and-braces `club_join_requests` row, and its own comment says the quiet part out loud: *"they
may rejoin or re-request immediately, because removal is not a ban."* For a **private** club that
sentence is now wrong in a way `088` could not have known, because `093` shipped afterwards: an
invite link minted before the removal is still live, and `private.club_invite_link_reachable_by`
— the single definition of *this caller may use this token* — carries seven conjuncts and **not one
of them is about removal**:

```
private.live_club_invite_link(t)                      -- the link is alive
private.may_invite_to_club_for(k.created_by, k.club_id) -- the minter is still authorised
not private.is_blocked(uid, k.created_by)
not private.is_blocked(uid, k.owner_id)
private.may_participate_for(uid)
uid <> k.owner_id
not private.is_club_member_for(uid, k.club_id)        -- ← a removed rider PASSES this one
```

A removed rider is, by definition, no longer a member. So they satisfy the last conjunct *because*
they were removed, and every other conjunct is untouched by the removal. They paste the URL and
they are a member again, with no approval and no notification to anybody.

**The two remedies that exist today are both wrong-shaped.** Revoking the link works and punishes
every other rider holding it. Blocking works completely and is one rider's decision about another
rider *everywhere in the app*, where removal is one club's decision about one membership.

## The fix, in one sentence

**Record that the removal happened, and add an eighth conjunct.**

That is the whole change: one table, one predicate in one existing helper, and one trigger that
clears the record when it stops being true. It needs **no new capability concept**, and the reason
is written into `093` already — `may_invite_to_club_for`'s own comment calls itself *"the FIRST
grant in this schema whose validity is re-derived at use rather than fixed at creation."* A removal
bar is exactly another such re-derived predicate on the same path, sitting beside it in the same
function. Nothing here invents a new class of rule; it adds a second instance of one `093` already
argued for and asserted.

## Where the predicate goes, and why it cannot go anywhere else

**Into `private.club_invite_link_reachable_by`, and nowhere else.** Three constraints in `093`
between them leave exactly one site:

- **`093.22` reads `prosrc`** for the *absence* of any caller predicate in the two public bodies —
  and **this change must extend it before that argument is true.** `093.22` is a closed list of
  five substrings (`is_blocked`, `terms_accepted_at`, `onboarding_completed_at`, `revoked_at`,
  `expires_at`); `club_removals` matches none of them, so a removal predicate dropped into either
  public body leaves it green today. `093.18` does not cover the case either — it enumerates four
  named dead states and a removed rider is a fifth. So the single-site rule here is an *architectural*
  reason that the build has to turn into a mechanical one (`tasks.md` 3.13), not a guard already
  standing. The reason itself is unchanged: a caller predicate in a public body has no policy
  underneath it.
- **`093.18` asserts the preview and the claim answer identically in every dead state.** A test in
  the claim alone would make the preview *more* permissive than its claim — the removed rider
  browses the club, taps Join, and is refused. `093`'s comment names that case: *"A preview MORE
  permissive than its claim is a pure disclosure."*
- **`private.join_club_from_invite` is shared with the in-app accept path.** Putting the predicate
  there would refuse PD-360's invite too — which is precisely the wide reading the owner declined.
  It is the one placement that looks natural, closes both doors at once, and is the wrong answer to
  this decision.

So the single-site rule `093` set for itself is what makes the narrow reading expressible: one
conjunct, in the function both invite-link entry points already share and neither invite nor
join-request path touches.

## What the refused rider is told, and what that discloses

**The existing generic dead-link copy, unchanged: `This invite link is no longer valid.`** Not
*"you were removed from this club"*. This is a decision, and it is the one rider-facing decision in
the change.

- **`088` decided that removal is silent, and this must not quietly reverse it.** Its header states
  *"Removal is indistinguishable from leaving, to everybody including the removed rider"*, with
  reasons: a notification about a private club resolves under the recipient's own RLS and would be
  written and never returned, and a notification to the rest of the club publishes a moderation
  action to an audience that did not take it. A distinct message on the claim screen would make
  removal distinguishable from leaving for the first time — through a side channel, at a moment the
  rider chose, rather than through a decision anybody made.
- **`093`'s whole architecture is built so that no dead token is distinguishable from any other**
  (`093.17`), so that the endpoint cannot be used as an oracle. A "you were removed" branch needs
  either a readable `club_removals` row or a second definer read inside the public body — the first
  makes the bar enumerable, the second breaks `093.22`.
- **It costs nothing in client code.** `ClubInviteJoin` already folds *already a member*, expired,
  revoked, unmatched and malformed into that one string. A removed rider becomes the sixth case in
  a branch that already exists.

**What it costs, stated rather than left to be discovered:** a removed rider who does not know they
were removed reads "no longer valid", asks the admin for a new link, and the new link fails too.
The honest remedy is to tell the rider at removal time, which is a notification and therefore
`088`'s decision to reopen, not this change's. It is named in *Open questions*.

**The residual oracle, named:** the bar is behaviourally observable even though no message says so
— the removed rider's claim fails where a friend's claim of the same token succeeds. That is
inherent to any fix that works, it discloses a fact about the rider to the rider, and it is
accepted.

## What Changes

**One migration, and the build must settle its number before it writes the file.** `106` is the
last file on `development`, but DEV records an applied migration `a_club_may_outlive_its_last_member`
(`20260905203011`) with **no file in the repo** — filed as PD-406, and the resolution is the
owner's. Every artifact here says *the next migration* and no number appears anywhere in this
change on purpose.

### New

- **`public.club_removals`** — `club_id`, `user_id`, `removed_at`, and **deliberately no
  `removed_by`**. Primary key is the pair `(club_id, user_id)`, which is the whole shape: it is a
  **state** table holding at most one row per barred pair, not a log of removals.
  The absent column is a decision, not a saving: `manage-club-riders` states as a requirement that
  *"nothing anywhere SHALL record who removed whom"*, and an actor column with no reader would
  break that for an audit trail nobody asked for. `removed_at` records **when**, which is what an
  expiry would need if the owner ever wants one, and nothing else reads it either.
  **RLS enabled, no policies, and no grant to any client role** — it is reachable only by the
  `security definer` functions that write and read it. Nobody can select it, including the rider it
  names and the admin who wrote it.
- **One `private` trigger function plus its `after insert on public.club_members` trigger** — it
  deletes the removal row for a pair that has just become a member again, by **any** route. This is
  what stops the bar becoming the permanent ban the owner declined.

### Changed

- **`public.remove_club_member(uuid, uuid)`** — replaced by `create or replace` in the next
  migration, gaining exactly one statement: an idempotent upsert of the removal row, written
  **after** its existing authority checks and beside its existing two deletes. No signature change,
  no new raise site, no change to who may call it or to what it refuses.
- **`private.club_invite_link_reachable_by(text, uuid, boolean)`** — replaced, gaining the eighth
  conjunct. No signature change, and the conjunct is written as a `not exists` so a removal row for
  a *different* club or a *different* rider is inert.

### Explicitly NOT in this change

Each of these is a decision, and the first three are the owner's decision of 2026-09-05.

- **`085`'s join requests are untouched.** A removed rider may request to join again the minute
  they are removed, and an admin may approve it. No predicate, policy or RPC of `085`'s moves.
- **PD-360's in-app invites are untouched.** An admin may invite a removed rider, and
  `accept_club_invite` admits them. `private.club_invite_is_answerable_for` and
  `private.club_takes_invites_for` do not move.
- **A removed rider may still join a PUBLIC club by pressing Join**, because `club_members`' INSERT
  policy admits any signed-in rider to a public club and narrowing it is the wide reading. On a
  public club this change bars a link and nothing else — see the negative case in the spec, where it
  is asserted rather than left implied.
- **No notification of any kind.** Not to the removed rider, not to the admins. `088` decided that
  and this change does not reopen it.
- **No client surface at all** — no screen, no `src/lib/data/` module, no `src/lib/actions/`
  function, no cache key, no type, no Zod schema. Nothing in `src/` changes. The reason is that
  every consequence of the change is already rendered by a branch `093` shipped, and the
  alternatives (an admin's removals list, a Clear button) are surfaces nobody has asked for and
  which would each need their own visibility decision.
- **No audit trail of removals.** The table is state and is deleted on readmission. If the product
  later wants *who removed whom, and when*, that is a different table with a different retention
  answer and it should be decided rather than inherited from this one.
- **No expiry job, no scheduled sweep, no Edge Function.**

## Capabilities

### New Capabilities

- `club-removals`: what a removal records, who may write one and who may never read one, exactly
  which admission path consults it, which admission paths deliberately do not, how it is
  distinguished from a rider leaving voluntarily, when it is cleared, and what it means once the
  club or the rider's account is deleted — stated per role: owner, admin, member, the removed
  rider, a non-member, a blocked rider in either direction, and a signed-out visitor.

### Modified Capabilities

- `club-invite-links`: the capability's definition of *this caller may use this token* is a closed
  list of conjuncts, and a closed list gains a member. The delta also has to say that the refusal
  is a **dead-token** outcome rather than a new one, because that is what keeps every existing
  requirement about indistinguishable dead states true.
- `club-membership-administration`: the standing requirement is that removal deletes one membership
  row and nothing else, and that a removed rider may return by every route. Both halves change
  shape — a second write appears, and one of the routes closes.
- `database-enforced-integrity`: this change adds the first table in the schema that **records a
  refusal in order to bar a future action**, and the invariant that makes it safe — that it is
  cleared by every path which contradicts it — is a new class of rule. It sits directly against the
  standing treatment of a `declined` join request, which is history and must *not* be cleared by a
  later join. Getting the two confused in either direction is a bug.

## Open questions

Each carries a recommended default so the build is not stalled, and says who can answer it.

### 1. Does a removal expire? **Default: no.** (Owner's, non-blocking — this is one of the two sub-answers PD-361 asked for.)

A removal is a decision the club made, and nothing in the app decays a decision on a timer. The
window is stated instead of guessed: a removal row lives until the rider is readmitted, the club is
deleted, or the rider's account is deleted. That is the retention answer, and it is bounded by
something a person does rather than by a clock.

Cheap to reverse in either direction: an expiry is one `now() < removed_at + interval` in one
conjunct.

### 2. Can an admin clear a removal? **Default: yes — by readmitting the rider, and only that way.** (Owner's, non-blocking — the second sub-answer.)

Readmission by any route clears it, so all three of the club's doors are also the Clear button:
approve their join request, send them an in-app invite, or — on a public club — let them press
Join. No new RPC, no new screen, no new advisor.

**The residual, stated because it is the argument for the other answer:** an admin cannot clear a
removal *without* readmitting, so an admin who wants to re-invite a removed rider **by link** finds
that a fresh link does not work for them either, and nothing tells the admin why. The remedy is to
use one of the other two doors. If the owner wants a standalone clear, it is a `public`
`security definer` RPC taking a club and a rider — one function, one advisor, and a surface to hang
it on, which is why it is not built speculatively.

### 3. A rider removed while holding a **pending in-app invite** can still accept it. (Owner's, non-blocking — and this is the one thing the narrow reading leaves genuinely open.)

**Default: leave it, and record it here rather than fix it silently.** The invite row is a
pre-minted admission grant of exactly the same shape as the link, so the defect PD-361 describes
has a second instance one table over. It is *not* refused by this change, because the owner's
decision names the invite-link claim path alone, and refusing a live invite is a behaviour change
to PD-360's path.

Two things make it much smaller than the link case: an invite is addressed to one rider by name, so
it is not the "a link is out there and I have forgotten who has it" problem; and `088` **already**
clears the other pre-minted grant on removal — it deletes any `club_join_requests` row for the
pair, belt and braces, for the recorded reason that a surviving one *"would let a second admin undo
this removal by approving it."* A `delete from public.club_invites where club_id = … and
invitee_id = … and status = 'pending'` inside `remove_club_member` is the same sentence about the
same hazard, and it is one line in the same migration.

**It is put as a question rather than taken as a default** because it changes a row on PD-360's
table, and the owner asked to be told rather than to have the scope absorbed. Phrased as the rider's
state, which is what has to be answered:

> An admin invited a rider to a private club, the rider has not answered yet, and the admin then
> removes them from that club for something else. The rider opens the invite in their notifications
> and taps Accept. Are they in the club?

Today: yes. With this change: still yes. With the one extra line: no, and the invite is gone from
their list.

### 4. Should the removed rider be told at removal time? **Default: no — out of scope.** (Owner's, non-blocking.)

This is `088`'s decision, made with reasons about private-club notification visibility that still
hold, and reopening it means a notification type, a fan-out and a readability arm. It is named here
only because *Why* above admits that a silent bar plus a generic message is a rider who cannot find
out why their link fails.

## Impact

**Database** — one migration (number deferred to PD-406's resolution) and new assertions in
`supabase/tests/rls_test.sql`. **This proposal writes neither file**: both are claimed by another
session's territory at the time of writing, and the code half of PD-361 is a later firing's.
Re-derive the suite size with `PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"` and
reconcile by **label set**, never by count.

**Security advisors** — **+1 INFO** (`rls_enabled_no_policy`, on `club_removals`) and **+0 WARN**.
There is no new `public` function: `remove_club_member` already exists and is replaced, and the two
functions that gain or receive work — the reachability helper and the trigger function — are in
`private`, which PostgREST does not publish. An
`authenticated_security_definer_function_executable` WARN appearing when this applies means
something was created in `public` that belongs in `private`.

**Participation gate** — **+0 triggers**, and the count staying still is the assertion.
`club_removals` holds no client grant, so no `authenticated` writer exists for a gate trigger to
gate; adding one would raise the count while gating nothing, which `078.9` asserts against. Measured
on DEV before the change: **21**.

**Sequencing** — **migration-first, and in practice migration-only.** The reasoning, since a new
table plus a predicate in an existing helper is not obviously either case:

- *Does a shipped client write a new column?* No. `club_removals` is written by a definer function
  from a call the client already makes with an unchanged signature, so the `096` hazard
  (`PGRST204` against an older database) has nothing to bite on.
- *Does it add a second PostgREST relationship and make an unhinted embed ambiguous?* No — measured,
  not assumed. `club_removals` is a junction between `clubs` and `profiles` and therefore adds an
  inferred many-to-many path, but `club_members`, `club_join_requests` and `club_invites` already
  provide several, so that pair is ambiguous today and **nothing embeds `profiles` from `clubs`**:
  every profile embed in `src/lib/data/` is hinted, which
  `src/lib/data/__tests__/embed-hints.test.ts` already enforces. The `092` hazard needs an *existing
  unhinted* embed to break and there is none.
- *Is there a bundle to order against at all?* No. Nothing in `src/` changes, so there is no
  newer-bundle-against-older-database case and no older-bundle-against-newer-database case. The only
  client-observable effect is that a claim which used to succeed now returns the dead-token outcome
  `ClubInviteJoin` already renders.

So the migration may apply at any time relative to any deploy, and the honest statement is that
**one side of the sequencing question is empty** rather than that the order does not matter.

**The hand-exercise gate DOES fire, and this is the change's one real hazard.** Two live write paths
run new code from the moment the migration applies: `remove_club_member` (every removal) and — more
sharply — **`after insert on public.club_members`, which is every club join in the app**, alongside
the `notify_club_joined` trigger already there. A raise in that trigger takes a rider's join down
with it. Every affected path is exercised by hand on DEV first, in a rolled-back transaction, as
`authenticated`, counting rows rather than assuming them — `tasks.md` group 4.

**Reads and writes** — none. No component, no `src/lib/data/` module, no `src/lib/actions/`
function, no cache key, no type and no Zod schema changes. Stated as a positive claim rather than
omitted, because the conventions about embeds naming their foreign key, reads living in
`src/lib/data/` and writes living in `src/lib/actions/` are unreachable by a change with no client
surface — and a later session adding an admin removals list inherits every one of them.

**Design** — nothing to draw. No frame is needed and none should be invented; the only screen
involved is `ClubInviteJoin`'s existing failure state, whose copy does not change.

**Dependencies** — none added.

**Docs** — `docs/reference/schema.md` gains a `club_removals` row and a line under
`remove_club_member`; `CLAUDE.md`'s advisor accounting gains one INFO. **The main thread writes
those, not a subagent, and not this change.**
