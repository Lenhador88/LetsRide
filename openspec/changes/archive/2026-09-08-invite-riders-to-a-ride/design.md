# Design — Invite riders to a ride

Everything here is measured against the repo (`supabase/migrations/`, `supabase/tests/rls_test.sql`,
`docs/reference/schema.md`) with the file and line that produced it. **No live database was
reached** — see `proposal.md` §Read this first.

## Who may invite, and why it is the organizer alone

**The organizer of the ride, and nobody else.** This is the first thing the specification states
because every other decision hangs off it.

An invite is not a message. **It is a grant of `select` on a row**, and in this schema a grant of
visibility has only ever been made by the resource's owner:

- `rides` UPDATE and DELETE are `auth.uid() = organizer_id` (`017`:71, `008`:114). The organizer is
  the only rider who can move a ride between audiences at all.
- `rides` SELECT's organizer arm is the only **unconditional** one — it survives `is_public`, the
  club, and the block check. Every other rider reaches a ride through a predicate about a group.
- A club's audience is likewise the owner's: `club_members.role` has had `admin` since `001` and
  **nothing has ever written it**, so there is no second tier anywhere in this schema to point at
  as precedent.

Letting any crew member invite means any crew member can hand a **non-member** a readable row for a
**private club's** ride. That is a policy this repo has been careful about twice — `022` exists to
stop a private club's ride being publicly visible, and `029` treats `rides.club_id` being
`ON DELETE SET NULL` as a trap for the same reason. Delegating it to N riders is a different
security statement from delegating it to one, and it should be made deliberately rather than
inherited from "the crew is already a group".

**It is cheap to widen later and expensive to narrow.** Widening is one predicate in the INSERT
`with check` — `private.is_ride_crew(ride_id)` in place of the organizer `EXISTS` — with no table
change, no new column and no data migration: `055`'s precedent verbatim, where `036` shipped
`ride_joined` to the organizer alone and said in its own comment that *"widening it is a
recipient-set change with no schema impact, so it can land later without a migration."* Narrowing
after riders have sent invites is a data problem.

Two consequences of the choice, both stated rather than left implicit:

- **The `ride_invites` SELECT policy carries no organizer arm**, because today `inviter_id` *is*
  the organizer and an arm reading `rides.organizer_id` would be a second way to reach the same
  set. A dead arm that reads as live is what `CLAUDE.md` warns about with `club_members.role`. The
  arm arrives **with** crew invites, in the same file, or not at all.
- **`(ride_id, invitee_id)` uniqueness has no contested case yet.** Two riders racing to invite the
  same person is unreachable while there is one inviter per ride. The rule the constraint already
  encodes — first invite wins, the row keeps its original `inviter_id` — is written down now so it
  is not decided by whoever hits the `23505` first.

## Where the invite arm sits in the rides policy

The arm goes **inside the block-dominated group**, as a third disjunct beside the public arm and
the club-member arm:

```sql
using (
  organizer_id = auth.uid()
  or (
    not private.is_blocked(auth.uid(), organizer_id)
    and (
      (is_public and (club_id is null or private.is_club_public(club_id)))
      or (club_id is not null and private.is_club_member(club_id))
      or private.has_live_ride_invite(id)              -- 083
    )
  )
)
```

**Never as a fourth top-level arm beside `organizer_id = auth.uid()`.** That placement is the
entire security difference, and it is a one-line diff away in either direction:

| Placement | A blocked invitee | Verdict |
|---|---|---|
| Inside the group (above) | `not private.is_blocked(...)` is false, so the whole group is false and the ride is invisible | Correct |
| Top-level, beside the organizer arm | The disjunct is true independently, so a rider the organizer has blocked reads the ride | **A block bypass** |

Decision #2 is that a blocked rider disappears from *"feeds, search, chat, member lists, and ride
crews simultaneously"*. An invite that outlives a block is a hole in exactly that. The organizer arm
is top-level because a rider cannot block themselves out of their own ride; nothing else may join
it there.

**The arm is a disjunct, not a conjunct, and it does not narrow anything.** A rider who can already
see the ride some other way is unaffected — an invite adds reach and never removes it. That is why
an invite to a rider who is already a club member is inert rather than wrong.

**Consequence, stated because it is the change's real cost:** an invite to a ride in a **private
club** gives a rider who is not a member of that club a readable `rides` row. Everything that
delegates to `rides` SELECT comes with it, and "it only grants the ride" is the summary that is
wrong by one surface — so the radius is a table rather than a sentence:

| Surface | Reached? | Why |
|---|---|---|
| `ride_members` — the crew list | **yes** | its SELECT policy's own `EXISTS (rides …)` |
| `storage.objects` under `ride-maps` — the ride's map tile | **yes** | `051`'s "readable with the ride" policy runs the same `EXISTS` |
| `public.ride_journal_postcard_ids(ride)` | **yes** | granted to `authenticated` and gated on `private.can_read_ride`, which this change amends. The invitee learns **which** of the postcards they can already read are tagged to this ride — `062`'s own comment names that correlation as the load-bearing part of the function. A real disclosure, bounded and intended |
| the club, its other rides, its member list, its threads | no | `private.is_club_member` |
| the ride's chat, and `ride_reads`' write predicate | no | `private.is_ride_crew` |
| tagging a postcard to the ride | no | `041` needs both conjuncts |
| `ride_map_render_attempts` | no | both its policies are organizer-scoped |

Every row is a scenario rather than a sentence, and the three positives are asserted as
**positives** — a suite that only proves the negatives cannot tell an intended reach from one
nobody noticed.

## The two copies of the rides policy, and why both must move

`private.can_read_ride(candidate uuid, target_ride uuid)` (`060`) is a **second implementation of
`rides` SELECT** — the policy's predicate with `auth.uid()` replaced by `candidate` and
`private.is_club_member` replaced by `private.is_club_member_for(candidate, …)`. It exists because
a policy can only ever be evaluated for the caller, and a fan-out needs the answer for somebody
else (`036` trap (c)).

`supabase/tests/rls_test.sql` §060.1 pins the `rides` SELECT qual **by equality, not by `like`**,
naming that function, and its own message says what to do when it fires:

> *"If this fails, the helper is stale — update it in the same change rather than re-pinning this
> string, or every notification fan-out starts filtering against a policy that no longer exists."*

So `083` changes **both**, in the same file, in the same position:

| Copy | Form | Reads |
|---|---|---|
| `rides` SELECT policy | caller-relative | `private.has_live_ride_invite(id)` |
| `private.can_read_ride` | candidate-relative | `private.has_live_ride_invite_for(candidate, r.id)` |

**And the two invite helpers are one body with two entry points**, on `060`'s
`is_club_member` / `is_club_member_for` pattern, for the reason §060.1's neighbouring assertion
gives in as many words: a `like '%..._for%'` match is satisfied by the mention alone, so an arm
added to the wrapper and not to the body would leave `can_read_ride` silently narrower than the
policy it restates, with **neither** §060.1 **nor** a substring match able to see it. The wrapper's
`prosrc` is therefore pinned by equality too:

```sql
select private.has_live_ride_invite_for(auth.uid(), target_ride);
```

— and the `_for` body is asserted to mention `auth.uid()` **nowhere**, which is `060`'s own
assertion transferred and is trap (c) in its enforceable form.

**If only the policy moves**, the failure is silent and specific: an invited rider opens the ride
fine, and the fan-out deciding whether to notify them filters against a rule that no longer
exists — writing rows nobody can read, or withholding rows that would have rendered. `036` §2 calls
that class *"a second copy of a visibility decision that nothing re-checks"*, and PD-211 is this
repo's own worked example of it shipping.

## Accept, decline, and what actually writes the crew row

**Accept is an RPC**, not a client UPDATE plus a client INSERT. Three reasons, in order of weight:

1. **Two writes, one answer.** Flipping `ride_invites.status` and inserting `ride_members` are two
   PostgREST round trips from a browser this app does not control. Every interleaving is reachable:
   accepted-but-not-crew (the organizer sees an accept, the crew list disagrees), and crew-but-still-
   pending (the invitee is on the ride and still being asked). One function, one transaction, one
   observable state.
2. **PD-330 reuses it.** A token-bearing claim has no invite row addressed to the claimer, so it
   cannot be a client UPDATE on a row scoped by `invitee_id = auth.uid()`. Both paths call
   `private.join_ride_from_invite(rider, ride)`, which is the only place either writes a crew row.
3. **It is where the gate gets restated** — see below.

**The existing `ride_members` INSERT policy is already sufficient and is deliberately not used.**
Measured: `with check ((auth.uid() = user_id) and exists (select 1 from rides r where r.id =
ride_id))`. With the invite arm on `rides` SELECT, that `EXISTS` is satisfied for an invitee, so an
invitee could join through the ordinary RSVP path with no invite RPC at all. Two things follow, and
both are requirements rather than notes:

- **The policy is not changed.** It is what makes joining a public ride work, and narrowing it to
  "only through an invite" would break every ordinary RSVP.
- **"Accept writes the `ride_members` row; nothing else may" is therefore false as stated, and the
  honest rule is narrower**: `accept_ride_invite` is the only path that sets `status = 'accepted'`,
  and the only path that joins the ride *and* answers the invite in one statement. A rider who was
  invited may still simply RSVP; the invite stays `pending`, and the organizer learns through
  `ride_joined` rather than `ride_invite_accepted`. That state is legitimate and the surfaces must
  render it (see below).

**`join_ride_from_invite` is `078`'s case exactly.** `enforce_participation_gate` on `ride_members`
carries `when (current_user = 'authenticated')`, and inside a `security definer` function
`current_user` is the **owner** — so the gate trigger cannot fire for this writer, and adding a
second trigger would raise the count while gating nothing, which is the failure `078.9` asserts the
absence for. The gate is therefore **restated in the function body**: `terms_accepted_at is not
null and onboarding_completed_at is not null` for `rider` — never for `auth.uid()`, which is the
subject-taking rule `060` enforces elsewhere in this same change and is the difference that matters
the day PD-330's token-bearer becomes the second caller — raising the same error class the
trigger does. An assertion pins the restatement, because a definer function that silently stopped
checking looks exactly like one that never needed to.

**It also re-checks readability.** Between the invite and the accept, the organizer may have blocked
the invitee — in which case the ride is no longer readable to them and the definer function would
otherwise cheerfully insert the crew row. So the body calls
`private.can_read_ride(rider, target_ride)` — the maintained restatement, reachable because it
is `private` and this is a definer context.

**It returns `false` rather than raising**, and that is a disclosure rule rather than a style
choice: a raise here reaches the rider as its own message, distinguishable from
`accept_ride_invite`'s *"no answerable invite"*, so an invitee blocked after being invited would
learn that their invite still exists and that something about the organizer changed. Decision #2
requires that a block never be revealed *"by any gap, count or marker"*, and two different strings
on one button are a marker. The caller folds `false` into its own single raise, so the accept path
has exactly **one** observable failure.

**The gate still raises, and the asymmetry is the point.** Failing the gate is a fact about the
rider themselves, which they may be told; failing readability is a fact about somebody else's ride
and their relationship to its organizer, which they may not.

**One ordering rule, and the natural order is the wrong one.** The `status` update happens
**before** the join, because the arm that makes `can_read_ride` answer true *is this invite being
live*. Validate-then-write — the shape a reviewer reaches for — makes the `declined → accepted`
reopen fail on exactly the ride the reopen exists for: a private, invite-only one, where `declined`
grants no read. The raise is what unwinds the update when the join is refused.

## Why nothing hangs off `ride_members`

The tempting fix for "invited, then joined by RSVP, invite still pending" is an `AFTER INSERT`
trigger on `ride_members` that resolves a matching invite. **Refused**, for two reasons:

1. **`ride_members` is a live write path.** `036`'s hand-exercise rule exists for this: from the
   moment the trigger applies, every RSVP in the app runs new code inside the rider's own
   transaction, and *"a trigger that raises takes that rider's write down with it."* This change
   already spends that budget on `can_read_ride`, which is enough.
2. **It would make `status` a copy of membership**, which `036` §2 forbids: *"a name snapshot is a
   second copy of a visibility decision that nothing re-checks."* `status` answers *"what did this
   rider say to this invitation"*. Membership answers *"are they on the ride"*. They are different
   questions with different lifetimes — leaving the crew does not un-answer an invitation — and
   collapsing them makes both wrong.

**So the surfaces read membership live**, which is what this repo does everywhere else:

- The invitee's pending list excludes rides they are already crew on — a `not exists (ride_members
  …)` in the read, not a status check.
- The organizer's invite list renders a row whose invitee holds a `ride_members` row as **Joined**,
  read from the crew, whatever the invite says.

## The state machine, and what each state grants

| `status` | Set by | Grants read on the ride | Deletable | Answerable |
|---|---|---|---|---|
| `pending` | the INSERT's column default — never the client | yes | by the **inviter** only | yes → `accepted` or `declined` |
| `accepted` | `accept_ride_invite` only | **yes** | no | no |
| `declined` | `decline_ride_invite` only | **no** | no | yes → `accepted`, by the invitee only |

Transitions: `pending → accepted`, `pending → declined`, `declined → accepted`. Nothing else, and
`accepted → declined` in particular is not a transition — leaving a ride is a `ride_members` DELETE
and touches no invite row.

**The read arm is `status in ('pending','accepted')`, spelled as a list.** Not `status <>
'declined'`: a fourth status added later must default to granting nothing, and an inequality
defaults to granting everything. That is the same failure shape as `036`'s `else false`, which its
own comment calls load-bearing rather than defensive tidiness.

**Why `accepted` grants read at all** is the cliff in `proposal.md` §Two things: with `pending`
alone, accept → leave → the ride disappears and cannot be rejoined, because `ride_members` INSERT's
`EXISTS (rides …)` runs under the rider's own RLS. An accepted invite is the durable record that
this rider was admitted; membership is a separate, revocable fact on top of it.

**Why `declined` grants nothing.** It is the rider saying no. Keeping read would leave a ride they
declined sitting in whatever list a future "rides you can see" screen builds.

**Why decline is not a delete.** A delete is indistinguishable from never-invited, so the organizer
could re-send it — daily. The row is the record of the refusal and the unique index is what makes
that record binding. The inviter's DELETE policy is scoped to `status = 'pending'`, so the one
party the rule constrains cannot clear it.

## Notifications

Three new types, all carrying **`ride_id` alone** — the same subject shape as `ride_joined`, so the
three new arms of `notifications_subject_shape` are copies of an existing one and the SELECT
policy's per-column resolvability conjuncts already cover them with no change:

| Type | Recipient | Actor | Fires on |
|---|---|---|---|
| `ride_invited` | `new.invitee_id` | `new.inviter_id` | `after insert on ride_invites` |
| `ride_invite_accepted` | `new.inviter_id` | `new.invitee_id` | `after update` when `status` becomes `accepted` |
| `ride_invite_declined` | `new.inviter_id` | `new.invitee_id` | `after update` when `status` becomes `declined` |

`notifications_type_check` goes from five strings to **eight**. Both CHECKs must move together, and
`036`'s own comment says why the second is not optional: without the `else false` arm, a type in the
first CHECK and missing from the second *"would silently admit a row with no subject at all"*.

**Trap (c) applies here even though no fan-out computes a set**, and this is the subtle part. All
three recipients are a single named rider read straight out of `NEW`, so the standing requirement's
wording — *"the recipient set SHALL be computed by direct query"* — has nothing to bite on, which
invites the conclusion that caller-relative helpers are safe here. They are not: the **resolvability
check** (`036` §7.5 — never write a row the read policy can never return) is a question about the
*recipient*, not the caller, and answering it with `private.is_ride_crew` or
`private.has_live_ride_invite` would compute the **actor's** answer and apply it to the recipient.
Both fan-outs take the subject-taking form:

- `ride_invited` → `private.can_read_ride(new.invitee_id, new.ride_id)`. True by construction in an
  `AFTER INSERT` (the invite row exists in the transaction, so the new arm answers yes), which is
  precisely why it is worth writing: it is the self-consistency check that fails the day the two
  copies of the policy drift.
- both answers → `private.can_read_ride(new.inviter_id, new.ride_id)`. Trivially true while the
  inviter is the organizer, and not trivially true the day crew invites land.

Plus, on all three, `not private.is_blocked(recipient, actor)` — the fan-out half of decision #2's
double application. The read half is already in `notifications` SELECT and stays there; a block
created *after* the row is what that second application exists for.

**`auth.uid()` appears nowhere in any of the three.** `036` trap (b): it is NULL in the RLS suite,
in psql and in a seed, so a suppression written against it filters out every recipient and every
negative assertion passes vacuously.

**No `when` clause on any of the three triggers.** `036` trap (a): a fan-out must fire for every
writer, including a seed and a future `security definer` RPC — and here two of the three writers
*are* `security definer` RPCs, so a `when (current_user = 'authenticated')` would disable the answer
notifications entirely.

**Self-invites cannot reach a fan-out** because `check (invitee_id <> inviter_id)` refuses the row,
which is the database expressing *"a rider SHALL NEVER be notified of their own action"* one layer
earlier than the standing requirement asks.

**Revoking retracts.** `after delete on ride_invites` deletes exactly the `ride_invited` row its
matching fan-out would have written — `retract_postcard_liked`'s shape (`036`), matched on the full
event key. It does **not** touch the answer notifications, which are records of something that
happened and are unreachable anyway (a row with an answer cannot be deleted).

**The Accept / Decline controls are read from the live invite row, never from the notification.**
`036` §2 requires every string a notification draws to come from the live subject; the same argument
applies with more force to a **button**, because a stale one performs a write. So the notification
list joins the invite by `(ride_id, invitee_id = the reader)` under the reader's own RLS, and a row
whose invite is gone, answered, or no longer visible renders as plain text with no controls. A
`type = 'ride_invited'` row is *not* sufficient evidence that an invite is answerable.

## The chat stays shut

**An invitee does not see the ride's chat before accepting, and the enforcement is a helper this
change does not touch.** `ride_messages` SELECT is
`exists (rides r …) and private.is_ride_crew(ride_id) and (author_id = auth.uid() or not
private.is_blocked(...))`, and `private.is_ride_crew` reads `rides.organizer_id` and `ride_members`
and nothing else (`034`:108). An invitee satisfies the first conjunct — that is what this change
does — and fails the second. Nothing new is required.

**What is required is the prohibition.** The invite arm makes `ride_messages`' two conjuncts
disagree for a rider for the first time on a private ride, and the disagreement reads like an
inconsistency: *they can see the ride, why can't they see the chat?* The answer is `034`'s, verbatim
— *"seeing a ride is not being on it"* — and the cheap "fix" is one arm in `is_ride_crew`, which
would also silently open `ride_reads` (its write predicate is the same helper) and `postcards`
ride-tagging (`041` requires `is_ride_crew` to tag). So `is_ride_crew`'s body is **pinned by
equality** in the suite, mentioning `ride_invites` nowhere, and the prohibition is a requirement
rather than a comment.

## The rider picker

**It searches `profiles` under the existing SELECT policy and adds no exposure of its own.**
Measured: `(auth.uid() = id) or (username is not null and not private.is_blocked(auth.uid(), id))`,
with per-column SELECT grants since `025`. So the picker may return exactly what
`PUBLIC_PROFILE_COLUMNS` already permits — `id`, `username`, `avatar_url` — and it cannot return an
email, a consent stamp or an onboarding stamp, because no client role holds the grant (`025`).
Blocked riders are absent in both directions with no filter in the query, which is decision #2
working as designed.

**No new RPC, no `security definer` search, no new grant.** A definer search over `profiles` is the
obvious way to make prefix matching fast and it is exactly the thing not to build: it would step
past the block arm, and a "no results" that means "blocked" is a block oracle.

**But "readable by id" and "searchable by prefix" are different exposures, and this is the app's
first people search.** The policy has permitted it since `002`; nothing has offered it. This is the
one decision in this change that is the product owner's rather than the schema's, and
`Questions Closed` Q1 carries the default and the tighter alternative.

The shape the default implies, so a feature agent does not invent it:

- **Prefix only** — `username ilike <q> || '%'`, never `%<q>%`. An infix match over usernames is a
  substring index of the whole directory.
- **Minimum two characters**, enforced in the read and mirrored in `src/lib/validation/rides.ts`.
  One character enumerates a thirty-sixth of the platform per keystroke.
- **Capped**, 20 rows, ordered by `username`. Not paginated: a picker that pages is a directory
  browser.
- **Excludes the ride's existing crew and its existing invitees** — a client-side filter over rows
  the caller can already read, not a policy. A rider absent from the picker for that reason has
  already disclosed their membership to this caller through the crew list.
- **No "not found" that distinguishes a blocked rider from a nonexistent one.** Both are an empty
  list.

## Retention, expiry and the cascade window

**A `ride_invites` row lives as long as its ride, its invitee and its inviter, and nothing else
deletes one except a revoke of a pending row.** Three FKs, all `on delete cascade`:

| FK | On delete | Consequence |
|---|---|---|
| `ride_id → rides(id)` | cascade | Deleting a ride takes every invite to it. Nobody is notified — `rides` DELETE is organizer-only and there is nothing left to notify them *with*, which is `schema.md`'s stated position for the crew already |
| `invitee_id → profiles(id)` | cascade | Account deletion removes every invite **to** them |
| `inviter_id → profiles(id)` | cascade | Account deletion removes every invite **from** them, out of every invitee's list |

Both `profiles` cascades are required and neither is visible in the other's key — the same pairing
`036` states for `user_id`/`actor_id`. The row records *"rider A named rider B for ride R at time
T"*, a relationship between two identified riders, so `029`'s account-deletion contract has to reach
it in both directions.

**Notifications inherit `036`'s window unchanged**: a `ride_invited` row dies with its ride, its
actor or its recipient, and — new here — with its invite, through the retraction trigger.

**A pending invite does not expire, and that is a decision.** A 30-day expiry was considered and
declined: nothing renders an invite except the invitee's own list and the organizer's, an unanswered
invite grants read to one named rider on one ride, and an expiry sweep needs a schedule this repo
does not have (an Edge Function on a cron, per decision #8's first reading). **What would reopen
it is PD-330**: a link is a *bearer* credential, and a bearer credential with no expiry is a
different risk from a row naming one rider. Say so there rather than inheriting silence as approval.

**Every index a cascade path needs.** `029` asserts that every FK into `profiles` leads an index, so
`ride_invites` carries one per FK column plus the unique `(ride_id, invitee_id)`, which already
leads with `ride_id`.

## Questions Closed

Each carries the default that lets the build continue, and who can overrule it.

**Q1 — Is a platform-wide username search acceptable? (product owner, blocking for the picker
only)** Default: **yes**, in the shape above — prefix-only, minimum two characters, capped at 20,
no fuzzy matching, no paging. It discloses nothing the `profiles` policy has not permitted since
`002`, and there is no alternative that still satisfies *"name a rider in the app"*: there is no
friends graph (`013`) and restricting to riders who share a club would make the feature unusable
for exactly the case it exists for. The tighter option, if the owner wants it: restrict the picker
to riders who share a club with the caller, which is expressible as an existing predicate and
narrows the feature to people you could already have found.

**Q2 — Organizer-only invites, or the whole crew? (product owner)** Default: **organizer only**, per
§Who may invite. Widening is one predicate and no schema change.

**Q3 — May the invitee reopen their own declined invite? (product owner)** Default: **yes**, per
`proposal.md` §Two things. The literal reading is one predicate away.

**Q4 — Does an invite carry a message from the inviter? (product owner)** Default: **no**. A free-text
column addressed at one rider is a messaging surface with no report path, no moderation RPC and no
`018` bound written for it, and the app has no design for it. It is a column and a CHECK away if
the answer changes; it is not a thing to add speculatively.

**Q5 — Does an organizer see *who* declined, or only a count? (product owner)** Default: **who**.
The organizer already sees the full crew and already chose the invitee by name, so the identity is
not new information, and a count would make the list unactionable. The invitee is not told that the
organizer can see it, because there is nothing to tell: refusing an invitation from a named person
is legible.

**Q6 — Does accepting set `status = 'going'` or `'maybe'` on the crew row? (recommended default)**
Default: **`going`**. Accept is an affirmative answer to a question; `maybe` is reachable
immediately afterwards through the ordinary RSVP control, which is unchanged.
