# Design — refuse a removed rider a live invite link

## Context

See `proposal.md` for the motivation and for the product owner's decision. What matters here is the
shape of the code the change lands in, all of it read first-hand from the migration files and from
DEV rather than from prose about them.

**`088`'s removal RPC** is a `security definer` function with an existing authority block, a single
raise site, one `club_members` delete and one belt-and-braces `club_join_requests` delete. It writes
nothing else and notifies nobody.

**`093`'s claim path** funnels every use of a token through one helper:

```
public.club_invite_link_preview(t)   ─┐
                                      ├─→ private.club_invite_link_reachable_by(t, uid, lock)
public.claim_club_invite_link(t)     ─┘         └─→ private.live_club_invite_link(t)
                                                └─→ (7 conjuncts, none about removal)
```

and the claim alone then calls `private.join_club_from_invite(...)`, which is **shared with the
in-app accept path**. Three assertions in the suite constrain where a predicate may go: `093.17`
(every dead state is one outcome), `093.18` (preview and claim agree in every dead state) and
`093.22` (the caller predicate is read off `prosrc` and must appear in neither public body).

**Measured on DEV, 2026-09-06.** `public.club_removals` does not exist. `public.club_members`
carries three triggers: `enforce_participation_gate` (BEFORE INSERT, `WHEN CURRENT_USER =
'authenticated'`), `notify_club_joined` (AFTER INSERT, no `WHEN`) and `protect_club_owner_membership`
(BEFORE DELETE, `WHEN CURRENT_USER = 'authenticated'`). The participation gate stands at **21**
triggers. DEV's last applied migration is `a_club_may_outlive_its_last_member` (`20260905203011`)
with no file in the repo — PD-406.

## Goals / Non-Goals

**Goals:**

- One predicate, in one place, reached by both invite-link entry points and by nothing else.
- A record that is erased the instant it stops being true, so the bar cannot become a ban by
  neglect.
- No new client-visible surface, no new copy, and no new `public` function.

**Non-Goals:**

- Any change to the join-request path, the in-app invite path, or the `club_members` INSERT policy.
- An audit trail of removals, an admin removals screen, or a Clear control.
- Telling anybody that a removal happened. That is `088`'s decision and it stands.

## Decisions

### D1. The predicate goes in `private.club_invite_link_reachable_by`, as an eighth conjunct

```sql
and not exists (
  select 1 from public.club_removals r
   where r.club_id = k.club_id and r.user_id = uid
)
```

**Alternatives, each rejected for a reason that is already written down in `093`:**

| Site | Why not |
|---|---|
| `public.claim_club_invite_link` | `093.22` reads `prosrc` for exactly this. A caller predicate there has no policy underneath it, and it would make the preview more permissive than its claim — `093` calls that *"a pure disclosure"*. |
| Both public bodies, duplicated | The defect `091` shipped and `093` was built to prevent: two copies of a caller predicate drift, and the weaker copy is always the security-critical one. |
| `private.live_club_invite_link` | That function is *a statement about the link alone* — it takes no caller. A caller predicate there changes what "live" means and would make a link dead for everybody because one rider was removed. |
| `private.join_club_from_invite` | Shared with the in-app accept path, so it closes both doors at once. That is the wide reading, and it is the trap this change is most likely to fall into because it looks like the tidiest fix. |
| A `club_members` INSERT policy arm | Would bar the public club's Join button too, and RLS cannot see which route wrote the row. Wide reading again, with a shipped screen breaking. |

**The conjunct is written as `not exists`, not as a join**, so a removal row for another club or
another rider cannot affect the result set, and the planner sees a primary-key probe.

### D2. The record is written inside `remove_club_member`, never by a DELETE trigger

Removal and voluntary departure both end as an absent `club_members` row, so the difference must be
captured at the moment of the act. `remove_club_member` is the only path carrying an authority
check, which makes the record exactly co-extensive with *an admin decided this*.

A `before delete on club_members` trigger could technically distinguish them — `current_user` is the
definer owner inside the RPC and `authenticated` on the rider's own delete — and is rejected anyway:
it would also fire for cascades (the club deleted, the account deleted) and record removals nobody
performed. The existing `protect_club_owner_membership` trigger already demonstrates how narrow that
`WHEN` clause has to be to be safe.

The write is an idempotent upsert:

```sql
insert into public.club_removals (club_id, user_id)
values (target_club, target_rider)
on conflict (club_id, user_id) do update set removed_at = now();
```

`do update` rather than `do nothing` so `removed_at` means *the most recent removal*, which is what
an expiry would need if the owner ever asks for one. Either is safe; the choice is stated so a later
reader does not think it accidental.

**Placement inside the body**: after the authority block and its single raise site, so an
unauthorised attempt writes nothing, and in the same transaction as the delete.

### D3. The record is cleared by an `after insert on club_members` trigger, in `private`

Route-agnostic by construction: it observes the membership row, so approving a request, accepting an
in-app invite, a public club's Join button and any admission path added later all clear it without
being edited. The standing integrity requirement about `current_user` guards decides its shape — it
must fire for **every** writer, including `security definer` ones, so it carries **no `WHEN`
clause**, exactly like `notify_club_joined` beside it.

**It is `security definer` with `set search_path = ''`, and this is the one line whose omission
turns this design into an outage.** A trigger function defaults to `security invoker`, so its
`delete` would run as the rider pressing Join — who holds no grant on `club_removals` and is
covered by no policy, because D4 revokes everything from every client role. The result is `42501`
on the delete and a rolled-back `club_members` INSERT, on **every** join in the app rather than
only on a barred pair, since the trigger has no `WHEN` clause and fires for every row. Measured on
DEV: all three triggers already on that table are `prosecdef = true`. Group 3 asserts it directly
rather than inferring it from a join succeeding.

**Alternatives rejected:**

- **Clear it inside each admission path.** Three edits today, and the fourth path is written by
  somebody who does not know this exists. That is the failure the standing requirement's
  *"observe the state, not the route"* clause names.
- **Never clear it, and let `remove_club_member` be the only writer.** This is the version that
  turns a removal into the permanent ban the owner declined — invisibly, since nobody can read the
  row. A rider removed once and readmitted stays barred from links for ever.
- **Make the conjunct time-relative instead** — bar only if `removed_at` is later than the rider's
  most recent join. There is no surviving record to compare against: the membership row is deleted
  on removal and on departure alike.

**The trigger must not raise.** It runs inside every club join in the app. A single `delete` against
a primary key cannot fail in normal operation, but the hand-exercise gate applies regardless, and it
is `tasks.md` group 4.

### D4. `club_removals` is state, keyed on the pair, with no actor column

`primary key (club_id, user_id)` is the whole design: at most one row per barred pair, idempotent to
write, deleted on readmission.

**No `removed_by`.** `manage-club-riders` requires that nothing anywhere records who removed whom.
An actor column would break that for an audit trail with no reader, on the most sensitive fact in
the table. If the product later wants *who removed whom, and when*, that is a different table, a
different retention answer and a different visibility decision.

`removed_at timestamptz not null default now()` stays: it records *when*, nothing reads it today,
and it is what an expiry would need.

Both foreign keys cascade — `club_id` from `clubs`, `user_id` from the rider's profile — so deleting
either end erases the row with no sweep and no step added to the account-deletion Edge Function.

### D5. RLS on, no policy, no grant to any client role

The cheapest correct answer to *who may read a removal*, and the one that needs no per-role
argument: nobody. There is no designed surface, so granting SELECT would mean deciding what an
admin, a member and the removed rider each see, for a screen that does not exist.

This produces one `rls_enabled_no_policy` INFO advisor, which matches the two tables already in that
position. **It adds no `authenticated_security_definer_function_executable` WARN**, because no
function is created in `public`: `remove_club_member` already exists and is replaced, and both other
functions live in `private`, which PostgREST does not publish.

### D6. The refused rider gets the existing generic message, and no client code changes

`ClubInviteJoin` already collapses *already a member*, expired, revoked, unmatched and malformed into
`This invite link is no longer valid.` A removed rider becomes the sixth case in a branch that
exists, so the change ships with **zero** diff under `src/`.

The alternative — *"you were removed from this club"* — is rejected in `specs/club-invite-links/` and
in `specs/club-membership-administration/`, on `088`'s recorded decision that removal is silent and
on `093.17`'s that no dead token is distinguishable from any other.

## Risks / Trade-offs

- **A trigger on every club join** → It carries no `WHEN` clause by design (D3), so it runs on the
  hottest club write path in the app. Mitigated by keeping it to one primary-key delete, by giving
  it no raise site, and by the hand-exercise gate in `tasks.md` group 4 — every affected path
  exercised on DEV in a rolled-back transaction, as `authenticated`, counting rows.
- **An admin cannot re-invite a removed rider by link** → Their remedy is an in-app invite or
  approving a request, both of which work and both of which clear the record. Nothing tells the
  admin why the link failed for one person, because nothing on the claim path can address them.
  Named in the spec and in `proposal.md`'s open questions rather than left to be discovered.
- **A removed rider is told nothing** → Accepted, on `088`'s decision. The cost is a rider who asks
  for a new link that also fails. Reopening it means a notification, which is a different change.
- **A removal does not serialise against a claim already in flight** → The share lock is on the link
  row; a removal touches a different table. The winning claim writes a membership row, which fires
  the clearing trigger, so the club is left with the rider as a member and no record — not a
  half-applied removal. The bound is that removing again is idempotent.
- **On a public club the bar is nearly decorative** → The rider presses Join and is admitted, which
  also clears the record. Closing that is the club-level ban the owner declined. Asserted in the
  spec so it cannot be mistaken for a defect later.
- **A pending in-app invite still admits a removed rider** → The one door the narrow reading leaves
  open, and the honest counterpart of the one PD-361 closes. Raised as an open question with a
  recommended default in `proposal.md`, not absorbed.
- **The clearing trigger fires for the club creator's own membership row** → Harmless (no removal
  row exists for a rider who has never been removed), and worth knowing because creator membership
  is itself written by a database path rather than by the client.

## Migration Plan

**One migration file, whose number the build must settle first.** `106` is the last file on
`development` and DEV records an applied `a_club_may_outlive_its_last_member` (`20260905203011`)
with no file behind it — PD-406. Nothing here picks a number; every task says *the next migration*.

**Order within the file**: create the table and its policies-and-grants posture; create the clearing
trigger function and its trigger; `create or replace` the reachability helper; `create or replace`
the removal RPC last, so the writer of the record lands after everything that reads and clears it.
Restamp both replaced functions' comments — a stale `comment on function` is what the next reader
consults through `list_tables`.

**Sequencing against the deploy: there is nothing to sequence against.** The change touches no file
under `src/`, so neither the newer-bundle-against-older-database case nor its reverse exists. The
reasoning that gets there is in `proposal.md` under Impact, including the measured check that no
unhinted `profiles` embed can be made ambiguous by the new junction.

**Rollback**: drop the trigger and re-`create or replace` the reachability helper without the eighth
conjunct. That restores the previous behaviour exactly, with the table left in place and inert. The
table itself is only droppable once the helper no longer references it, which is the order any
rollback would take anyway.

**After applying**: re-read the security advisors and expect exactly one new INFO; re-count the
participation-gate triggers and expect **21**, unchanged.

## Open Questions

The four that matter are in `proposal.md`, each with a recommended default and each addressed to the
product owner rather than to the build. None of them changes the approach, the specs or the task
breakdown: expiry and clearing already have their conservative defaults built in, the pending-invite
question is one statement in the same migration if the answer is yes, and telling the rider is a
different change entirely.
