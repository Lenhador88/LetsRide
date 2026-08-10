# Tag postcards to rides — one nullable column, and the audience rule it must not touch

> Linear **PD-123**. This file is the specification; the issue points at it and must not restate
> it. `CLAUDE.md` §The roadmap lives in Linear: *"A Linear issue that grows a specification is a
> bug."*

## Why

**`postcards` has no `ride_id`, and one missing column blocks two designed things.**

- **The ride detail's Journal sub-page.** `Ride - Journal (Postcards/Timeline)` (`2226:4865`) is
  drawn and the epic is **In progress**. Ride plan, Crew and Chat ship; `RidePageMenu`'s own doc
  comment records Journal as *omitted rather than offered as a dead row* because the column does
  not exist.
- **"New postcard on a ride you're going to."** `add-notifications` (PD-118) listed it as out of
  scope with one reason and one pointer: *"`postcards` has no `ride_id` — verified 2026-08-07, the
  column does not exist. Linear PD-123."*

**Verified again 2026-08-09** against `zwprydcyryvudhurbnye` and `fpmrimzxadewsaiwpsel`:
`postcards` is `id, author_id, club_id, image_path, caption, created_at, updated_at`. `ride_id`
exists on `ride_members`, `ride_messages` and `notifications`, and on nothing else.

**The reason this needs a proposal rather than a ticket is one sentence:**

> **`club_id` IS the audience. `ride_id` is a tag, and a tag that quietly becomes a second
> audience axis is a private club's postcards leaking to whoever can see a ride.**

`CLAUDE.md` is explicit that `postcards` carries no `is_public` flag on purpose — NULL `club_id`
means the app-wide feed, a set one means that club's members, and nothing else decides. Adding a
second nullable FK to the same table is the shape of a change where an implementer reaches for
`or ride_id = …` in the SELECT policy because it makes the Journal work. It does make the Journal
work. It also hands every rider who can see a public ride every club postcard tagged to it.

**And the column is not additive, which is the finding that changes the shape of the work.**
`postcards` grants are **table-level**, not per-column — measured, not assumed:

```sql
select acl.privilege_type from pg_class c
  cross join lateral aclexplode(c.relacl) acl
 where c.relname = 'postcards' and acl.grantee::regrole::text = 'authenticated';
-- SELECT, INSERT, UPDATE, DELETE  (relacl, i.e. table-level; a.attacl is empty)
```

So `alter table postcards add column ride_id uuid` grants `authenticated` INSERT **and UPDATE** on
it in the same statement, with no `with check` mentioning it anywhere. A one-line migration ships
a column any signed-in rider can point at any ride in the database, including rides they cannot
see, and can repoint afterwards for ever. That is the whole security surface of this change and it
arrives by default rather than by decision.

## What Changes

### The column

- **`postcards.ride_id uuid null references rides(id) on delete set null`.** Nullable, untyped by
  any CHECK, and **not** part of any uniqueness — a ride has many postcards and a postcard has at
  most one ride.
- **`on delete set null`, not cascade.** Decided in `design.md` §D1. A ride cascades from its
  organizer's account deletion (`029`, and `rides.organizer_id` is `ON DELETE CASCADE` — verified),
  so `cascade` here means *deleting your account destroys other riders' postcards*. That is
  `029`'s own bug, one migration after `029` fixed it for clubs.
- **One index**, copying `postcards_club_id_idx`'s shape exactly:
  `create index postcards_ride_id_idx on postcards (ride_id, created_at desc) where ride_id is not null`.
  It serves the Journal query *and* the `set null` sweep, which is an UPDATE keyed on `ride_id` and
  would otherwise scan `postcards` once per deleted ride.

### The write gate — the intersection, exactly as `034` established it

`postcards` INSERT `with check` gains one conjunct, and only that:

```
and (ride_id is null
     or (exists (select 1 from rides r where r.id = ride_id)   -- caller's own RLS
         and private.is_ride_crew(ride_id)))                    -- 034's helper, unchanged
```

**Both halves, never either alone.** `private.is_ride_crew` is `security definer`, so it answers
"is there a crew row" with no opinion about blocks or private clubs, and a `ride_members` row
outlives both. `034` shipped that leak in draft and its migration header records it; this is the
same predicate in the write direction. It is already a standing requirement —
`database-enforced-integrity` → *A child table whose audience is NARROWER than its parent's SHALL
enforce that by composition, never by a privileged helper alone* — and this change is its second
instance rather than a new idea.

**Crew, not merely visible**, and `034` owns what "crew" means (organizer, or any `ride_members`
row of either status) — read it there. Reasoning and the rejected alternative are in `design.md`
§D2.

### `ride_id` is set once and is not editable — and the UPDATE **policy** is not touched at all

`authenticated` gets **SELECT and INSERT** on the column and **no UPDATE**. Reaching that requires
revoking the table-level UPDATE and re-granting it over the seven columns that have it today —
`034`'s instrument, applied to the other verb.

**The UPDATE policy gains nothing, and an earlier revision of this proposal had it gain the same
conjunct "harmlessly, since the column cannot be written".** That was wrong, and the error is worth
naming because it is the one a reader re-derives: **a column privilege gates the SET list, and an
RLS `WITH CHECK` is evaluated over the whole new row.** The two are unrelated. A conjunct naming
`is_ride_crew(ride_id)` in the UPDATE `with check` is therefore fully reachable — it fires on a
*caption* edit — and an author who has since left the crew gets `42501` on a change that has nothing
to do with the ride.

That is not hypothetical here: `supabase/tests/rls_test.sql:719-727` already asserts the same
mechanism on this same policy for `club_id` — *"an author who left a club cannot edit their postcard
in it"* — and the comment above it records the lockout as a **deliberately accepted** side effect.
It is accepted there because `club_id` **is** updatable, so the `with check` is the only thing
stopping a rider moving a photo into a private club. `ride_id` is not updatable, so the same
conjunct would buy nothing and cost the same lockout. **The asymmetry is the whole reason**, and
this change asserts the difference rather than leaving it implied: a caption edit on a *tagged*
postcard by an author who has left the crew must **succeed**, which is the assertion that fails the
day someone adds the conjunct back.

**`postcards` does have an UPDATE policy and grant today** (`author_id = auth.uid()`), which is
worth stating because the sibling table does not — `postcard_comments` has neither. Nothing in
`src/` calls it; there is no `updatePostcard` action. Both are unchanged by this proposal.

### The SELECT policy is not touched, and that absence is the load-bearing part

The `postcards` SELECT policy stays byte-for-byte:

```
author_id = auth.uid()
OR (NOT private.is_blocked(auth.uid(), author_id)
    AND (club_id IS NULL OR private.is_club_member(club_id))
    AND NOT EXISTS (postcard_hides h WHERE h.postcard_id = id AND h.user_id = auth.uid()))
```

`ride_id` appears nowhere in it, in either direction — it neither grants nor withholds. An absence
is exactly what silently becomes something else, so it is asserted from **both** sides
(`ride-journal`, and `openspec/config.yaml`'s rule that a negative be testable): a postcard tagged
to a ride the viewer can see stays invisible if `club_id` says so, and a postcard tagged to a ride
the viewer cannot see stays visible if `club_id` says so.

### The Journal read

`getRideJournal(rideId)` — a plain `.eq('ride_id', rideId)` under the caller's own RLS, ordered
`created_at desc`. **Not** a `security definer` RPC, an Edge Function or a service-role read: inside
a definer function the postcards SELECT policy does not run at all, and `CLAUDE.md` records that
`current_user` there is the owner, so `023`'s participation gate would not fire either.
`015`'s `club_unread_counts()` is `security invoker` for precisely this reason and is the shape to
copy.

Consequence, stated rather than discovered: **two riders open the same ride's Journal and correctly
see different lists.** A club-scoped postcard is in the Journal only for that club's members; a
hidden one is missing for the hider; a blocked rider's are missing both ways. There is no "3 more"
marker, because a count of what you may not see is the leak the filtering prevented.

### `ride_id` and `club_id` are orthogonal and SHALL NOT be constrained to agree

The tempting CHECK — *the postcard's club must match the ride's club* — is the tag-becomes-audience
mistake wearing a different hat, and it is not even expressible as a CHECK (it references another
table, so it would have to be a trigger). A club postcard tagged to an unrelated public ride is
legal and renders for that club's members only. `design.md` §D4.

### Deliberately not built, each with its reason

| Out of scope | Why |
|---|---|
| **The `postcard_on_ride` notification** | It needs a seventh fan-out trigger on `postcards` INSERT — a **shipped write path**, so it carries `036`'s whole DEV-exercise-then-PROD gate. It also needs a *new* membership helper: `private.is_club_member` reads `auth.uid()` internally and is unusable at fan-out (`036`'s measured finding), so nothing today can ask "can **this candidate** see that postcard". Separately mergeable, in either order, neither half-built. Rule it must inherit is in `ride-journal` |
| **Retagging / an "edit tag" affordance** | No UPDATE grant on the column, by decision. Relaxing later is one `grant`; retracting a grant riders have used is not |
| **A denormalised journal count on `rides`** | The correct count is per-viewer, counted under RLS — `009`'s reasoning for likes, unchanged |
| **Photo location, the flag and city on the Journal card** | Drawn in the frame, blocked on schema, already logged in `docs/FIGMA-FIDELITY-TODO.md`. Not this column |
| **Backfilling `ride_id` on existing postcards** | There is no signal to derive it from. Every existing row stays NULL |
| **Ride cover images / map thumbnail on the Journal header** | Blocked on schema, unrelated |
| **A per-ride unread watermark** | `015`'s `feed_reads` is keyed `(user_id, club_id)` with `club_id` NULL as the app-wide feed — an **audience** watermark, and `ride_id` is not an audience. See below |

### `feed_reads` is untouched, and the consequence is a product answer rather than an omission

A tagged postcard keeps its `club_id`, so `club_unread_counts()` counts it in exactly the audience
it already counted it in. The tag moves no badge and no watermark, and this change adds no
`(user_id, ride_id)` row — a journal watermark would be `015`'s rejected `postcard_views` shape,
growing with content rather than with membership.

**The visible consequence: reading a postcard in a Journal does not mark it seen in its club's
feed.** That is correct under the watermark model — `feed_reads` records a position in an audience,
and the Journal is not one — but it is the kind of thing a rider notices, so it is a stated answer
here rather than a surprise later. The reverse holds too: a postcard already read in the feed
appears in the Journal with no "new" treatment, because the Journal has no unread concept at all.

## Capabilities

### New Capabilities

- **`ride-journal`** — the rider-facing contract for the link: who may tag and who must not, who
  reads the Journal and what each role sees, what happens to the tag when the ride, the club, the
  author or the tagger's membership goes, the seven screen states, ordering, pagination, counts,
  retention, and the rule the deferred notification inherits. Split from `ride-chat` deliberately:
  the two share a ride and share nothing else — chat is a private conversation with one audience,
  a journal is public content whose audience is each postcard's own.

### Modified Capabilities

- **`database-enforced-integrity`** — one requirement MODIFIED and two ADDED.
  - **MODIFIED: `A table with no designed edit SHALL carry no UPDATE grant`.** It is written at
    table granularity (*"the table SHALL have no UPDATE policy **and** no UPDATE grant"*) and
    cannot express this case at all: `postcards` has a designed edit, has an UPDATE policy, has an
    UPDATE grant, and gains a column with no designed edit. The rule is right and its granularity
    is wrong.
  - **ADDED: a rider-supplied reference SHALL have its referent's visibility checked by policy,
    because a foreign key does not.** A FK is validated with RLS bypassed, so `references rides(id)`
    accepts any ride in the database. Nothing in the standing set says this, and it generalises past
    this change to every future FK column on a rider-writable table.
  - **ADDED: adding a column to a table with table-level grants SHALL be treated as granting it.**
    Measured on `postcards` above. `034` got this right for `ride_messages` by granting INSERT per
    column; nothing wrote down why, so the next table inherits the trap.

> **Collision check — clean, verified 2026-08-09.** Neither in-flight change claims either of the
> two requirements above. Re-derive rather than trust it:
> `grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive`. In this file
> `add-account-deletion` holds **four** (`Club membership role`, `Consent and lifecycle timestamps`,
> `Onboarding completion`, `Storage object ownership`) and `enforce-creator-membership` holds
> **six** — `Club membership role` plus **five** of its own, not the four an earlier revision of this
> note claimed. **`A table with no designed edit SHALL carry no UPDATE grant` has one claimant: this
> change.**

### Read and NOT modified — a claim, not an omission

- **`ride-chat`** — read in full, unchanged. Its *Chat visibility SHALL be the intersection…*
  requirement is the pattern this change reuses on the write side, and its
  *The crew count a chat screen shows SHALL be per-viewer* is why the Journal grows no count column.
  Reusing a requirement is not modifying it.
- **`event-fanout-integrity`** — unchanged, and the deferred notification is **already bound** by
  *A fan-out SHALL NOT write a row that the read policy can never return to its recipient* and by
  *The recipient set SHALL be computed by direct query, never through a caller-relative helper*.
  Its per-type table gains a row when that change ships, not now: a table row for a type that does
  not exist is the stale enumeration `add-notifications` warned about.
- **`client-render-shell`** — the Journal is bound by every requirement in it and changes none.
  *Permission-denied and empty SHALL be told apart where the rider can act on the difference* is
  satisfied inside `ride-journal`'s own state requirement rather than by a delta, because
  `add-account-deletion` already claims it and a second claimant buys a merge conflict and no
  clarity.
- **`client-cache-invalidation`** — the Journal's key joins the existing `postcards` group and
  `createPostcard` widens its existing claim. No requirement changes. `Counts SHALL stay per-viewer`
  is likewise already claimed by `add-account-deletion`.

## Impact

**Database.** One migration, **`041_postcard_ride_tag.sql`**. `040_locality_centroid` is the highest
file and is applied — **verified 2026-08-09 by `list_migrations` against `ls supabase/migrations/`:
40 files, 40 rows, on both `letsride` and `letsride-dev`.** Re-derive rather than trusting this
paragraph; `CLAUDE.md` warns this exact line has been wrong in both directions.

**`041` is free against both databases and reserved against nothing else.** A database query cannot
see a sibling proposal: `enforce-creator-membership` still claims `029`/`030`, both long taken, and
renumbers into whatever is free the day it is picked up. Check both —
`list_migrations` against `ls supabase/migrations/`, **and**
`grep -rn "0[0-9][0-9]_[a-z_]*\.sql" openspec/changes/*/` across the unarchived proposals.

**It is additive in schema and it is inert.** One column, one index, one FK, **one** policy
replacement (INSERT `with check`; SELECT, UPDATE and DELETE untouched), one revoke-and-regrant of
UPDATE. No trigger hangs off an existing write path, so unlike `036` nothing existing starts running
new code — it may be applied before the code that reads it deploys, and DEV-then-PROD is ordinary
caution rather than a gate.

**One existing assertion goes red and must be rewritten in the same change.**
`supabase/tests/rls_test.sql:977` asserts
`has_table_privilege('authenticated','public.postcards','update') = true`. The revoke-and-regrant
makes that **false** while leaving every column-level answer true — the shape `notifications`
already has, measured on DEV: table `false`, column `true`. It becomes a `has_column_privilege`
assertion per column. This is a real behaviour change to a passing test, not a rename, and it is
listed as its own task rather than folded into "update the suite".

**One sequencing rule that is not ordinary.** The revoke-and-regrant of UPDATE **must enumerate the
seven columns that hold it today** — `id, author_id, club_id, image_path, caption, created_at,
updated_at` — read off the database at write time, not off this file. Omitting one silently
retracts a grant the app relies on; the failure surfaces as a rider unable to edit something, with
no error anyone can trace back to a migration.

**And it inverts the default for every column added to `postcards` after this one.** Once UPDATE is
column-level, a new column arrives with **no** UPDATE grant rather than an automatic one — the exact
opposite of the trap the ADDED requirement above is about, on the one table that requirement was
written from. That direction fails closed and is the safer of the two, so it is not a problem to
solve; it is a surprise to remove. Anyone adding a column here later and finding it read-only has
found this decision, not a bug, and `041`'s header says so in as many words.

**Advisors.** Expect the count and identity **unchanged at eight**. Nothing here is
`security definer`; `private.is_ride_crew` already exists and already carries `authenticated`'s
EXECUTE. A new WARN means a function landed in `public` or a revoke did not.

**Code.** New: `src/app/(app)/rides/[id]/journal/page.tsx`, `getRideJournal` in
`src/lib/data/postcards.ts`, a `journal` key in `keys.ts`. Changed: `RidePageMenu` gains the
Journal row it has been omitting (and its doc comment loses the reason it was absent);
`CreatePostcardForm` gains a ride select mirroring its club select; `createPostcard` and
`postcardRideIdSchema` carry the id; `Postcard` in `src/types/index.ts` gains the field.

**`POSTCARD_SELECT` is `*`, so `ride_id` starts arriving on every postcard read the moment the
migration applies** — before any type declares it and on screens that will never render it. That is
harmless (a UUID) and it is stated so it is a decision: the ride's *name* comes only from an
RLS-filtered embed, and a viewer who cannot see the ride gets a NULL embed and renders nothing.
No second lookup on the raw id, ever.

**No new runtime dependency.** Nine before, nine after — re-derive with
`node -p "Object.keys(require('./package.json').dependencies).length"`.

**Tests.** `041` pairs with assertions in `supabase/tests/rls_test.sql` per `openspec/config.yaml`.
Everything in `ride-journal` is assertable on plain Postgres with one exception, named as such: the
suite runs as the table owner, for whom neither RLS nor a column privilege exists, so **the absent
UPDATE grant on `ride_id` must be asserted by naming the role** —
`has_column_privilege('authenticated','public.postcards','ride_id','UPDATE')` — and never by
attempting the write. That is `031`'s lesson and the exact shape of the bug `029` shipped.

## Two defects this change found, does not own, and files rather than works around

Both are pre-existing, reachable today, and named here because a proposal that silently designs
around a hole is how the hole gets inherited as covered.

- **`postcards.created_at` is client-writable, and it is the feed's sort key *and* its pagination
  cursor.** No trigger imposes it (the only `BEFORE INSERT` trigger on the table is
  `enforce_participation_gate`; `postcards_set_updated_at` is `BEFORE UPDATE` and touches
  `updated_at` alone), the DEFAULT applies only when the column is omitted, and PostgREST lets a
  client name it. `authenticated` also holds UPDATE on it with no `with check` mentioning it. So an
  author can stamp a postcard in the future and pin it to the top of every feed permanently, and
  break the `before` cursor for everyone. `database-enforced-integrity`'s *A column the server owns
  SHALL NOT be writable by a client that can insert the row* names `postcard_comments.created_at` as
  the harmless instance and says it *"matters the moment a column decides the order of a
  conversation"*. It decides the order of the home screen. A trigger closes it; the blast radius is
  the whole feed and it is not this change's.
- **`is_ride_crew` is one RSVP away for any visible public ride.** The write gate is a real boundary
  for private-club rides and for blocked riders, and for a public ride it costs a rider one extra
  request to clear. That is not a flaw — pressing *Maybe* **is** declaring participation, which is
  what the gate asks — but a reader who expects it to be a spam boundary on public rides will be
  wrong. Stated so nobody builds anti-spam on it.
