## Purpose

What `postcards.ride_id` means, who may set it, and who may read a ride's Journal. The column is a
**tag**: it groups postcards a viewer can already see, and it decides nothing about who may see one.
The whole capability exists to keep that sentence true under a schema change whose most natural
implementation makes it false.

**Where a requirement below is a statement about a role and a resource, it maps onto an assertion in
`supabase/tests/rls_test.sql`.** Not all of them are, and an earlier revision of this paragraph
claimed "two exceptions" while at least five of the thirteen requirements have no assertion behind
them. The honest split, because a spec that overstates its own coverage is how a gap gets inherited
as covered:

| Requirement | Enforced by |
|---|---|
| The SELECT policy is unchanged | suite (both directions) **+** a text diff of `qual` |
| Tagging requires ride-visibility and crew | suite — four cases, each conjunct in isolation |
| The tag is set once and is not editable | suite — `has_column_privilege`, naming the role |
| The tag dies with the ride, not the postcards | suite |
| The tag is not constrained to agree with the club | suite |
| Every role's reach is stated | suite |
| **The Journal is read under the caller's own RLS, with no privileged path** | **nothing in the suite** — see below |
| The Journal screen's states | `npm run walk` and `reviewer`; **not the suite** |
| Ordering, pagination, counts | suite covers the index only; order and cursor are `reviewer`'s |
| No learning a ride you cannot see | suite covers the error shape **and, since `062`, the embed's refusal**; what is left for `reviewer` is only the choice the amended requirement names |
| The deferred notification's recipient set | **nothing** — it constrains a change not yet written |
| Retention | suite, via the cascade assertions — no separate set |
| Surfaces not built | `reviewer` |

**The no-privileged-path rule is the one worth saying plainly: it is unenforced by the suite.** The
suite runs as the table owner, for whom RLS does not exist, so it cannot tell an invoker-rights read
from a definer-rights one by calling either. The partial cover is the security-advisor sweep — a new
`security definer` function in `public` raises
`authenticated_security_definer_function_executable` and moves the count off eight — and that only
fires if the function is reachable from PostgREST. A `security definer` helper in `private`, or the
rule being broken in TypeScript rather than SQL, is caught by **code review and nothing else**. It
is stated as a requirement anyway, because the alternative is that it is not written down at all.

The column-grant assertions must name the role rather than attempt the write, for the same
owner-runs-the-suite reason — `031`'s lesson.

## ADDED Requirements

### Requirement: A postcard's audience SHALL remain `club_id`'s, and `ride_id` SHALL NOT appear in the `postcards` SELECT policy

The `postcards` SELECT policy SHALL be unchanged by this capability, in **both** directions:
`ride_id` SHALL neither admit a viewer the policy would otherwise refuse, nor refuse one it would
otherwise admit. `club_id` NULL is the app-wide feed and a set `club_id` is that club's members, and
there SHALL continue to be no third determinant beyond blocks and hides.

**This is the failure the capability exists to prevent, and it arrives as a helpful fix.** An
implementer building the Journal reaches for `or ride_id = …` in the SELECT policy because it makes
the sub-page work. It does. It also returns every club-scoped postcard tagged to a ride to every
rider who can see that ride, and the leak has no symptom: the Journal looks right, the feed looks
right, and the club's postcards are readable by non-members.

#### Scenario: A non-member of a private club sees nothing of that club's postcards on a ride they are on
- **WHEN** a rider is on the crew of ride R and can see it, and a postcard scoped to private club C
  — of which they are not a member — is tagged to R
- **THEN** zero rows SHALL be returned to them for that postcard, from the Journal query and from
  every other read
- **AND** this SHALL hold whether R belongs to C, to another club, or to no club

#### Scenario: A postcard tagged to an invisible ride is still visible when its club says so
- **WHEN** a postcard with `club_id` NULL is tagged to a ride belonging to a private club the viewer
  is not a member of
- **THEN** that postcard SHALL still appear in the viewer's app-wide feed, unchanged
- **AND** the tag SHALL remove nothing, because `ride_id` is not an audience and a viewer who cannot
  resolve a ride has lost no right to the postcard

#### Scenario: Both directions are asserted, because one cannot catch the other
- **WHEN** assertions are written for this requirement
- **THEN** at least one case SHALL fail if `ride_id` is added to the SELECT policy as a widening
  arm, and at least one different case SHALL fail if it is added as a narrowing conjunct
- **AND** a single case that both mistakes happen to pass SHALL NOT be accepted as coverage

#### Scenario: The policy text is compared, not described
- **WHEN** `041` is reviewed or applied
- **THEN** the `postcards` SELECT policy `qual` SHALL be identical before and after, compared as
  text rather than asserted in prose
- **AND** the migration SHALL state in its header that SELECT is deliberately untouched, so a later
  reader does not read the absence as an oversight

### Requirement: Tagging SHALL require both that the tagger can see the ride and that they are on its crew, and neither conjunct alone

The `postcards` INSERT `with check` SHALL admit a non-NULL `ride_id` only when **both** an `EXISTS`
against `rides` evaluated under the caller's own row security **and** `private.is_ride_crew(ride_id)`
hold. A foreign key SHALL NOT be treated as any part of this check.

A foreign key is validated with RLS bypassed, so `references rides(id)` accepts every ride in the
database including ones the tagger cannot see. `private.is_ride_crew` is `security definer` with
`search_path = ''`, so on its own it confirms a crew row for riders the `rides` policy has already
refused — a `ride_members` row survives blocking the organizer, leaving the club, and the club
turning private. `034` measured both states and shipped that leak in draft; this is the same
predicate on the write side.

"Crew" SHALL mean whatever `034` and `private.is_ride_crew` mean by it — organizer, or any
`ride_members` row of either status — and SHALL NOT be restated here in different words.

#### Scenario: A crew member tags their own ride
- **WHEN** the ride's organizer, or a rider holding a `ride_members` row of status `going` or
  `maybe`, inserts a postcard naming that ride
- **THEN** the insert SHALL succeed
- **AND** `maybe` SHALL have identical rights to `going`, because crew membership is the presence of
  the row and never its status

#### Scenario: A rider who can see the ride but is not on it is refused
- **WHEN** a signed-in rider who is not the organizer and holds no `ride_members` row inserts a
  postcard naming a ride they *can* see — a public ride with no club, or a public club's ride
- **THEN** the insert SHALL be refused
- **AND** the refusal SHALL be attributable to the crew conjunct, asserted in isolation, because the
  visibility conjunct is satisfied

#### Scenario: A rider who cannot see the ride at all is refused
- **WHEN** a signed-in rider who is not a member of a private club inserts a postcard naming one of
  that club's rides
- **THEN** the insert SHALL be refused
- **AND** the refusal SHALL be attributable to the visibility conjunct, asserted in isolation, and
  SHALL hold **even if they somehow hold a `ride_members` row** for it

#### Scenario: A crew member who has blocked the organizer is refused
- **WHEN** a rider holding a `ride_members` row blocks the ride's organizer, in either direction,
  and their crew row is untouched
- **THEN** an insert naming that ride SHALL be refused
- **AND** the refusal SHALL come from the visibility conjunct, which the crew conjunct alone would
  admit

#### Scenario: A crew member who has left the private club is refused
- **WHEN** a rider holding a `ride_members` row for a private club's ride leaves that club
- **THEN** an insert naming that ride SHALL be refused, because `022` pins a private club's ride to
  `is_public = false` and `rides` SELECT then admits club members only
- **AND** this SHALL be asserted separately from the blocking case, because one assertion cannot say
  which conjunct did the work

#### Scenario: Neither conjunct is simplified away
- **WHEN** the INSERT policy is reviewed, refactored or replaced
- **THEN** both conjuncts SHALL remain and the policy SHALL carry a comment saying why
- **AND** removing either SHALL fail at least one assertion that removing the other does not

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** a request naming `ride_id` arrives with no session
- **THEN** it SHALL be refused, because `anon` holds no grant on `postcards`
- **AND** this change SHALL add none, per decision #1

#### Scenario: A rider who has not completed onboarding is refused before any of this
- **WHEN** a rider whose `terms_accepted_at` or `onboarding_completed_at` is NULL inserts a postcard,
  tagged or untagged
- **THEN** `enforce_participation_gate` SHALL refuse it, unchanged by this capability
- **AND** no path introduced here SHALL insert a postcard on a rider's behalf, because that trigger
  is gated on `WHEN (current_user = 'authenticated')` and a `security definer` writer would not fire
  it

### Requirement: A postcard's ride tag SHALL be set once and SHALL NOT be editable by anybody, including its author

`authenticated` SHALL hold INSERT on `postcards.ride_id` and SHALL hold **no UPDATE** on it. The
enforcement SHALL be the withheld column grant, not a policy predicate.

**`authenticated` SHALL hold no SELECT on `postcards.ride_id` either — amended by PD-166, decided
2026-08-17 and shipped as `062`.** This requirement originally read *"SHALL hold SELECT and
INSERT"*, and the SELECT half was load-bearing for the Journal: Postgres checks the column privilege
to FILTER on a column as well as to return it, so `.eq('ride_id', …)` needed it. That made the grant
simultaneously the Journal's mechanism and a correlation channel — a raw uuid comparable across
postcards by a viewer who can resolve neither the ride nor its crew. The amendment gives the
privilege to `public.ride_journal_postcard_ids(ride uuid)` instead, so the Journal keeps its filter
and no client holds the column. Requirement *"The Journal SHALL be a filter, never a second
audience"* below carries the read shape.

**A tag write SHALL NOT ask for the column back in its returning clause.** The INSERT grant is
untouched, so a postcard is still tagged once at creation; but an insert requesting the full
representation reads every column and is refused `42501`. A returning clause SHALL name granted
columns only.

**The UPDATE policy SHALL NOT gain a conjunct naming `ride_id`, in either `using` or `with check`.**
A column privilege gates the SET list; an RLS `WITH CHECK` is evaluated over the whole new row. They
are independent, so such a conjunct is **not** made inert by the withheld grant — it fires on a
caption edit, and an author who has since left the crew is refused a change that has nothing to do
with the ride. Escaping that needs a `BEFORE UPDATE` trigger comparing `OLD.ride_id`, which is a
second instrument for a feature nothing has asked for.

**The same mechanism is already accepted on this same policy for `club_id`, and the difference is
the reason.** `supabase/tests/rls_test.sql:719-727` asserts that an author who left a club cannot
edit their postcard in it, and accepts the lockout because `club_id` **is** updatable and the
`with check` is the only thing stopping a rider moving a photo into a private club. `ride_id` is not
updatable, so the conjunct would prevent nothing and cost the same lockout.

**`postcards` is not `postcard_comments`.** It carries an UPDATE policy (`author_id = auth.uid()`)
and a table-level UPDATE grant today, and nothing in `src/lib/actions/` calls either. Both SHALL be
left exactly as they are for the other seven columns.

#### Scenario: A caption edit still works after the author leaves the crew
- **WHEN** the author of a postcard tagged to ride R leaves R's crew — or blocks its organizer, or
  the club goes private — and then edits the caption
- **THEN** the edit SHALL succeed
- **AND** this SHALL be asserted, because it is the case that goes red the day somebody adds the
  `ride_id` conjunct to the UPDATE policy for symmetry with `club_id`
- **AND** the assertion SHALL cite `rls_test.sql:719-727` as the contrasting case, so the difference
  between the two columns is legible from either side

#### Scenario: The author cannot retag their own postcard
- **WHEN** the author of a postcard attempts to change its `ride_id` — to another ride they are crew
  of, or to NULL
- **THEN** the write SHALL be refused with `42501`
- **AND** the refusal SHALL come from the absent column grant, so it holds regardless of what any
  present or future UPDATE policy says

#### Scenario: The absent grant is asserted by naming the role
- **WHEN** the assertion for the rule above is written
- **THEN** it SHALL be
  `has_column_privilege('authenticated','public.postcards','ride_id','UPDATE') = false`
- **AND** it SHALL NOT be an attempted UPDATE, because the suite runs as the table owner for whom no
  column privilege exists and the attempt would succeed against a correct database

#### Scenario: The re-grant preserves exactly today's seven columns
- **WHEN** the table-level UPDATE grant is revoked and re-granted per column
- **THEN** the re-granted set SHALL be `id, author_id, club_id, image_path, caption, created_at,
  updated_at`, read off the database at write time rather than copied from any document
- **AND** an assertion SHALL name each of the seven, because a silently retracted grant surfaces as a
  rider unable to edit something with no error traceable to a migration

#### Scenario: Nobody else can set a tag on a postcard they did not write
- **WHEN** any rider other than the author attempts to insert or alter a postcard naming another
  rider's `author_id`
- **THEN** the write SHALL be refused by `author_id = auth.uid()`, unchanged
- **AND** this SHALL be asserted despite being pre-existing, because a new column is a new reason to
  try

#### Scenario: The absence is a recorded decision, not an accident
- **WHEN** `041` is written
- **THEN** it SHALL state that `ride_id` has no UPDATE path by decision
- **AND** the day retagging is designed, adding the grant SHALL be understood as a deliberate
  widening with its own gate, rather than a one-line fix

### Requirement: The tag SHALL die with the ride and SHALL NOT take other riders' postcards with it

`postcards.ride_id` SHALL be `on delete set null`. Deleting a ride SHALL remove the tag and SHALL
remove no postcard, and it SHALL change nothing about who can see any postcard.

`rides.organizer_id` is `ON DELETE CASCADE`, so a ride dies with its organizer's account. A cascade
here would therefore mean *one rider deleting their account destroys other riders' postcards* — the
defect `029` exists to close for clubs, re-created on the table it was protecting, one migration
later.

#### Scenario: Deleting a ride keeps every postcard on it
- **WHEN** a ride is deleted, by its organizer or by their account deletion
- **THEN** every postcard tagged to it SHALL survive with `ride_id` NULL
- **AND** this SHALL be asserted from the **other** rider's side — that rider selecting their own
  rows after the deletion — because a count taken as the deleter proves nothing

#### Scenario: Nulling the tag changes nobody's visibility
- **WHEN** a postcard's `ride_id` is nulled by the referential action
- **THEN** the set of riders who can select it SHALL be identical before and after
- **AND** that identity SHALL be asserted, because it is the strongest available evidence that
  `ride_id` never became an audience axis

#### Scenario: The referential action is not gated by the withheld grant
- **WHEN** the `set null` sweep runs
- **THEN** it SHALL succeed against rows the deleting rider can neither see nor update, because a
  referential action is applied by the system rather than under that rider's row security
- **AND** this SHALL be stated in `041`'s header, so that the apparent inconsistency with the absent
  UPDATE grant is not later "fixed" by adding a policy

#### Scenario: Deleting an account empties the Journals of rides that rider organised
- **WHEN** a rider deletes their account
- **THEN** every ride they organised SHALL be deleted and every other rider's postcards tagged to
  those rides SHALL survive, untagged, in the feeds they were posted to
- **AND** nobody SHALL be notified, because there is nothing to notify them with — the same reason
  `CLAUDE.md` already records for the crew of a cancelled ride

#### Scenario: Deleting a postcard's author removes the postcard and not the ride
- **WHEN** a postcard's author deletes their account
- **THEN** the postcard SHALL be removed by the existing `author_id` cascade and the ride SHALL be
  untouched
- **AND** the ride's Journal SHALL simply be shorter for everyone, with no placeholder

### Requirement: The Journal SHALL be read under the caller's own row security and SHALL NOT be read through any privileged path

The postcards a Journal renders SHALL be read from `postcards` by `src/lib/data/`, under the
caller's own row security. The rows SHALL NOT come out of an Edge Function, a service-role read, or
a view that runs as its owner.

Inside a `security definer` function the `postcards` SELECT policy does not run, so a function that
**returned rows** would hand **every** postcard tagged to the ride to **every** caller — every club
postcard to non-members, blocked riders' postcards to the rider who blocked them, hidden postcards
to the rider who hid them, in one function. `015`'s `club_unread_counts()` is `security invoker` for
exactly this reason.

**Amended by PD-166 (`062`): the FILTER is a `security definer` function and the ROWS are not.**
This requirement originally forbade any `security definer` path outright and specified the read as a
plain `.eq('ride_id', …)`. Both halves rested on `authenticated` holding SELECT on `ride_id`, which
`062` revokes — Postgres checks the column privilege to filter as well as to return, so a plain
`.eq` is now `42501` for every rider. The shape that replaces it keeps everything the paragraph
above is protecting:

- `public.ride_journal_postcard_ids(ride uuid)` returns **ids only**. It is `security definer`
  because it is the only thing holding the column.
- The caller reads those postcards through the ordinary `POSTCARD_SELECT` path, under its own RLS.
  So the policy still decides every row that renders, and a too-permissive accessor cannot widen
  what a rider sees — it could only name an id the subsequent read then drops.
- The accessor's own filter therefore governs the **correlation** — which postcards belong to this
  ride — which is the exposure PD-166 was filed about, and it is fenced twice: it reuses
  `private.can_read_ride` (`060`, whose restatement of `rides` SELECT the suite pins textually), and
  its restatement of `postcards` SELECT is pinned as whole text under the accessor's own name.

#### Scenario: The rows are read under the caller's own row security
- **WHEN** the Journal renders postcards
- **THEN** they SHALL be selected from `postcards` by the caller, so the SELECT policy runs
- **AND** no function SHALL return postcard rows, captions or image paths from a `security definer`
  body, which is the defect the paragraph above describes

#### Scenario: The filter names the ride and nothing else
- **WHEN** the query narrows to one ride
- **THEN** it SHALL do so by the ids `public.ride_journal_postcard_ids(<ride>)` returns, and nothing
  else — the equivalent of the feed narrowing by `author_id` or `club_id`
- **AND** it SHALL NOT re-filter by club, membership or block in application code, because both the
  accessor and the row read have already applied the audience rule and a third copy is a third place
  to drift

#### Scenario: Two riders see two different Journals for one ride, correctly
- **WHEN** two riders both on a ride's crew open its Journal, and one is a member of a club whose
  postcard is tagged there while the other is not
- **THEN** the two lists SHALL differ
- **AND** neither SHALL be told that the other's is longer

### Requirement: Every role's reach into a ride's Journal SHALL be stated

Reading the Journal SHALL be permitted to every rider who can see the ride — it SHALL NOT be narrowed
to the crew — and writing into it SHALL be crew-only. The asymmetry with chat is deliberate and SHALL
be recorded: a chat is a private conversation with one audience, and a journal is public content
whose audience is each postcard's own.

| Role, relative to ride R | Read R's Journal | Tag a postcard to R |
|---|---|---|
| Organizer of R | Yes — the postcards they may see | Yes |
| Crew of R (`going` or `maybe`) | Yes — the postcards they may see | Yes |
| Signed-in rider who can see R and is not on it | Yes — the postcards they may see | **No** |
| Non-member of R's private club | **No** — R itself is invisible, so the sub-page is unreachable | **No** |
| Rider blocked by, or blocking, R's organizer | **No** — R itself is invisible | **No** |
| Rider blocked by a postcard's author | Yes to the Journal, **No** to that postcard | n/a |
| Rider who hid a postcard | Yes to the Journal, **No** to that postcard | n/a |
| Club owner or admin, with no relationship to R | Exactly what any signed-in rider gets — **no elevated read** | **No** unless they are crew |
| Signed-out visitor | **No** — no session reaches any route but `/auth/*` and `/legal/*`, and `anon` holds no grant | **No** |

#### Scenario: A club admin gets no elevated reach
- **WHEN** a club's owner or an `admin` opens the Journal of a ride belonging to their club
- **THEN** they SHALL see exactly the postcards their own `postcards` SELECT admits, with no extra
  arm for their role
- **AND** no moderation affordance SHALL appear, because none exists — `postcard_reports` is still
  write-only with no triage, unchanged from `011`'s KNOWN GAP

#### Scenario: A blocked rider disappears from the Journal in both directions
- **WHEN** rider A has blocked rider B, in either direction, and both have postcards tagged to a ride
  they can both otherwise see
- **THEN** A SHALL NOT see B's postcards in the Journal and B SHALL NOT see A's
- **AND** the enforcement SHALL be `private.is_blocked` inside the existing `postcards` SELECT
  policy, with no `blocks` query anywhere in the Journal's code path

#### Scenario: A hidden postcard stays hidden in the Journal
- **WHEN** a rider has a `postcard_hides` row for a postcard tagged to a ride they can see
- **THEN** it SHALL be absent from their Journal
- **AND** it SHALL remain visible to every other rider whose audience admits it, because
  `postcard_hides` is per-viewer and one-directional

#### Scenario: The Journal sub-page is unreachable when the ride is
- **WHEN** a rider who cannot see a ride requests its Journal route directly
- **THEN** the ride detail SHALL resolve to `notFound()` and the Journal SHALL never render
- **AND** the guard SHALL NOT be relied on for this, because it is a UX affordance — the read returns
  nothing regardless

### Requirement: The Journal screen SHALL define every state it can be in

Empty, loading, error, offline, permission-denied, partial and stale SHALL each have a defined
rendering. Zero rows SHALL NOT be rendered as a blank region.

#### Scenario: The three kinds of zero rows are told apart where the rider can act, and collapsed where they cannot
- **WHEN** the Journal returns zero rows
- **THEN** *nobody has posted yet* and *everything posted here is invisible to me* SHALL render the
  **same** empty state, because they are indistinguishable from the client and the rider can act on
  neither, and a count of what is being withheld is itself the leak
- **AND** *I cannot see this ride* SHALL be distinguishable, because the ride detail 404s before the
  sub-page renders
- **AND** the collapse SHALL be a written decision in the change, not an omission

#### Scenario: Crew and non-crew get different empty states
- **WHEN** the Journal is empty and the viewer is on the crew
- **THEN** the empty state SHALL offer the compose affordance
- **AND** for a viewer who can see the ride but is not on it, it SHALL NOT — an affordance whose
  submit the database will refuse is worse than an absent one

#### Scenario: Loading gates on the data, never on `isLoading`
- **WHEN** the Journal first renders
- **THEN** it SHALL gate on the data being `undefined` and show a skeleton
- **AND** `null` SHALL mean a decided answer and `undefined` SHALL mean *not yet*, so no 404 flashes
  on load

#### Scenario: A failed read is distinguishable from an empty one
- **WHEN** the Journal query errors
- **THEN** `ErrorState` SHALL render with a retry, and it SHALL NOT be rendered as an empty Journal

#### Scenario: Offline is stated rather than silently degraded
- **WHEN** the rider has no connection
- **THEN** a previously-fetched Journal SHALL render from the cache with the stale marker the shell
  already defines, and a first visit SHALL render `OfflineState`
- **AND** composing into the Journal offline SHALL refuse rather than queue, matching every other
  write in this app

#### Scenario: Partial is not silently whole
- **WHEN** the ride resolves and the Journal query fails, or the reverse
- **THEN** the part that loaded SHALL render and the part that failed SHALL show its own error
- **AND** a failed Journal SHALL NOT take the ride detail down with it

### Requirement: The Journal SHALL be ordered, paginated and counted per-viewer, with no denormalised count anywhere

Order SHALL be `created_at desc` with a deterministic tiebreak, matching the index
`(ride_id, created_at desc) where ride_id is not null` and matching whatever cursor the page uses. Any
count the switcher or header shows SHALL be counted under the reader's own RLS. No column, on `rides`
or anywhere else, SHALL hold a journal count.

The correct count is per-viewer for the same reason `009` keeps none for likes and `011` none for
comments: two riders on one ride have two different correct answers.

#### Scenario: A count and its list agree by construction
- **WHEN** a Journal count is rendered beside the list
- **THEN** both SHALL come from the same predicate under the same session
- **AND** a count that can exceed the number of rows the rider can open SHALL be treated as a defect

#### Scenario: The index, the order and the cursor agree
- **WHEN** the Journal is paginated and the ride is intact
- **THEN** the ordering, the index and the cursor SHALL name the same columns in the same direction
- **AND** a row SHALL NOT be able to appear twice or vanish between pages
- **AND** this scenario SHALL be read as scoped to a live ride, because deleting the ride removes
  every row from the query by design — see below

#### Scenario: The ride disappearing mid-pagination takes the screen, not just the page
- **WHEN** a ride is deleted while a rider is partway through its Journal
- **THEN** the `set null` sweep SHALL empty the query, and the next page SHALL return zero rows
- **AND** the screen SHALL NOT render as a truncated list: the Journal's parent read resolves to
  `null`, which is a decided answer, so the ride detail SHALL `notFound()` and take the sub-page with
  it
- **AND** this SHALL NOT be treated as violating the no-vanishing-rows rule above, because the rows
  did not move between pages — the resource they hung off ceased to exist, which is a different
  event and needs the different handling

#### Scenario: The cascade path is indexed
- **WHEN** a ride is deleted
- **THEN** the `set null` sweep SHALL use `postcards_ride_id_idx`, whose leading column is `ride_id`
- **AND** the index SHALL NOT be justified by the Journal query alone, because without it the sweep
  scans `postcards` once per deleted ride and an account deletion deletes every ride its owner
  organised

#### Scenario: Ordering is a stated decision
- **WHEN** the order is chosen
- **THEN** newest-first SHALL be the default, matching every other list in the app
- **AND** flipping it to chronological SHALL remain a product decision that costs no schema change,
  because the same index serves a backward scan

#### Scenario: The Journal has no unread state and `feed_reads` is untouched
- **WHEN** a rider opens a ride's Journal
- **THEN** no `feed_reads` row SHALL be written or moved, and no per-ride watermark SHALL exist
- **AND** a postcard read in the Journal SHALL remain unread in its club's feed, because `feed_reads`
  is keyed `(user_id, club_id)` and records a position in an **audience**, which a ride is not
- **AND** a `(user_id, ride_id)` watermark SHALL NOT be added, because it is `015`'s rejected
  `postcard_views` shape — bounded by content rather than by membership
- **AND** the tag SHALL move no existing badge, because a tagged postcard keeps its `club_id` and
  `club_unread_counts()` counts it in exactly the audience it already counted it in

### Requirement: The ride tag SHALL NOT be constrained to agree with the club, and SHALL NOT be derived from it

No CHECK, trigger or policy SHALL require that a postcard's `club_id` match its ride's `club_id`, in
either direction. The two columns answer different questions and SHALL stay independent.

The constraint is intuitive, is not expressible as a CHECK — it references another table — and would
therefore arrive as a trigger, which is machinery in support of the exact confusion this capability
exists to prevent. A club postcard tagged to an unrelated ride is legal and renders for that club's
members only.

#### Scenario: A club postcard tags an unrelated ride
- **WHEN** a rider posts into club C and tags a public ride belonging to no club, being crew of that
  ride and a member of C
- **THEN** the insert SHALL succeed
- **AND** the ride's other crew who are not members of C SHALL NOT see it in the Journal, which is
  correct rather than a bug to be constrained away

#### Scenario: An app-wide postcard tags a private club's ride
- **WHEN** a member of private club D, who is crew of one of D's rides, posts app-wide and tags it
- **THEN** the insert SHALL succeed and the postcard SHALL appear in every rider's app-wide feed
- **AND** riders who cannot see D's ride SHALL learn nothing about D from it

#### Scenario: The picker offers exactly what the database accepts
- **WHEN** a ride picker is rendered on the composer
- **THEN** its options SHALL be the rides the rider is crew of — the same set the write gate admits
- **AND** it SHALL NOT be filtered by the club selected in the other field, nor re-filtered when that
  selection changes

### Requirement: A rider SHALL NOT learn a ride they cannot see from a postcard they can

The ride's title, meeting point, departure time and club SHALL reach a client only through an
RLS-filtered embed on the postcard read. A raw `ride_id` SHALL NOT be resolved by a second lookup, and
a NULL embed SHALL render nothing rather than a placeholder naming the ride.

**`062` makes the embed itself impossible, and that is an OPEN product question for PD-257 rather
than a rule this change can settle.** A PostgREST embed is a join whose predicate references
`postcards.ride_id`, and Postgres privilege-checks a column reference in a predicate exactly as it
does one in a target list — the premise the whole grant change rests on. So after `062` a postcard
cannot surface its ride **at all**: no chip, no name, no fallback, on any row including the reader's
own. Two ways forward, and neither is chosen here:

- **The chip stays absent.** What `062` recorded, on the ground that no frame in the design draws one
  — which is why the consequence did not block that change. Costs nothing and closes the question.
- **A second accessor, postcard → ride.** Then its visibility rule SHALL be stated the way the
  Journal's is, before it is written: it hands back the correlation PD-166 closed, one postcard at a
  time, so "which ride is this tagged to" needs the same `can_read_ride` answer the Journal's does,
  and a NULL result SHALL be indistinguishable from a ride the viewer cannot see.

Everything else in this requirement survives, and the first sentence's *intent* survives with it: a
rider still SHALL NOT learn a ride they cannot see from a postcard they can. `062` enforces that more
strictly than the embed did, by removing the read rather than filtering it.

`POSTCARD_SELECT` was `*` when this was written, so the raw `ride_id` UUID started arriving on every
postcard read the moment `041` applied — accepted here on the grounds that a UUID a viewer cannot
resolve tells them only that *some* ride is attached. **That reasoning was wrong in one respect and
PD-165 and PD-166 are the corrections**: the uuid is *comparable*, so two postcards carrying the same
one say "these were the same ride" to a viewer who can resolve neither it nor its crew. PD-165 took
the column out of `POSTCARD_SELECT`; `062` revoked the grant, which is what actually closed it,
because the browser can query PostgREST directly whatever this app's own select lists say. What was
never accepted, and still is not, is a client turning a tag into a name.

#### Scenario: The ride chip is absent, not empty
- **WHEN** a postcard is rendered to a viewer who cannot see its ride
- **THEN** no ride chip, label or link SHALL render
- **AND** it SHALL NOT render as "a ride", "Private ride" or a disabled control, because an absent
  affordance is better than one that discloses existence

#### Scenario: The tagging error does not distinguish a missing ride from a hidden one
- **WHEN** a rider names a ride id that does not exist, and a rider names one that exists but is
  invisible to them
- **THEN** both SHALL be refused with the same `42501`, and the client SHALL render one message
- **AND** this SHALL hold **because of** the write gate rather than in spite of it: the policy's
  `EXISTS` returns no rows in both cases, and RLS `WITH CHECK` is evaluated before the foreign key's
  `AFTER ROW` referential trigger, so `23503` is unreachable — **measured 2026-08-09** on
  `fpmrimzxadewsaiwpsel` in a rolled-back transaction
- **AND** an earlier revision of this spec recorded an accepted `23503`/`42501` oracle here; there is
  no oracle, and the gate in the requirement above is what closes it

### Requirement: The deferred notification's recipient set SHALL be stated before it is built, and SHALL be the three-way intersection of ride-visibility, crew and postcard-visibility

This change SHALL NOT build a `postcard_on_ride` notification. The change that does SHALL compute its
recipients as riders who **can see the ride**, **are on its crew**, **and can see the postcard** —
all three. The crew alone SHALL NOT be used, and neither SHALL crew ∩ postcard-visibility.

`036`'s SELECT policy drops the row unless **every** non-NULL subject column resolves under the
reader's own RLS, and a `postcard_on_ride` row carries two of them:

```
and (postcard_id is null or exists (select 1 from public.postcards sp where sp.id = …))
and (ride_id    is null or exists (select 1 from public.rides    sr where sr.id = …))
```

Each fails for a different rider and neither implies the other. **The postcard half:** a crew member
need not be able to see a postcard tagged to their ride, because it may be scoped to a club they are
not in. **The ride half:** `private.is_ride_crew` is `security definer` and a `ride_members` row
outlives blocking the organizer and leaving a private club, so a rider can be on the crew while
`rides` SELECT refuses them the ride — the state `034` measured. A fan-out missing either conjunct
writes rows that are dropped on every read, for ever, which is
`event-fanout-integrity`'s *A fan-out SHALL NOT write a row that the read policy can never return to
its recipient* — whose failure mode is the one that requirement names: nothing raises, no count
moves, no assertion fails.

#### Scenario: A crew member who cannot see the ride is not a recipient
- **WHEN** a rider holds a `ride_members` row for a ride they can no longer see — having blocked the
  organizer, or left the ride's private club
- **THEN** they SHALL NOT be written a `postcard_on_ride` row
- **AND** the crew predicate alone SHALL NOT be treated as having covered this, because
  `is_ride_crew` is `security definer` and returns true for exactly this rider

#### Scenario: `036`'s two CHECK constraints are amended before the first fan-out
- **WHEN** the notification change is written
- **THEN** its first migration task SHALL amend **both** `notifications_type_check` and
  `notifications_subject_shape`, the latter gaining an arm permitting
  `postcard_id is not null and ride_id is not null`
- **AND** skipping it SHALL fail loudly with `23514` on the first fan-out rather than silently,
  because `notifications_subject_shape` ends in `else false` — which is deliberate and SHALL NOT be
  relaxed to make room for the new type

#### Scenario: No notification is written by this change
- **WHEN** `041` is applied
- **THEN** no trigger SHALL be added to `postcards`, and the six existing fan-out triggers SHALL be
  untouched
- **AND** no notification type SHALL be added to any CHECK or enumeration, because a type nothing
  writes is a stale enumeration

#### Scenario: The intersection needs a helper that does not exist yet
- **WHEN** the notification change is scoped
- **THEN** it SHALL record that `private.is_club_member` reads `auth.uid()` internally and therefore
  computes the **actor's** membership rather than each candidate's
- **AND** it SHALL introduce a helper taking the candidate as an argument, or inline an `EXISTS` per
  candidate, in the way `036` did for `is_blocked(a, b)`

#### Scenario: The per-type table gains its row with the change, not before
- **WHEN** the notification ships
- **THEN** `event-fanout-integrity`'s recipient-set table SHALL gain a `postcard_on_ride` row naming
  the policy arm that resolves it
- **AND** it SHALL NOT be added now, because a table row for a type that does not exist is an
  enumeration asserting something false

#### Scenario: The author is not notified of their own postcard
- **WHEN** the notification ships and the author is themselves on the crew
- **THEN** they SHALL receive no row, per the standing self-suppression rule

### Requirement: The ride tag SHALL have a stated retention, and its absence SHALL be a decision

The tag's retention window SHALL be the **cascade window**: it lives as long as both the postcard and
the ride, and it is removed by the deletion of either — the postcard by its author's cascade, the tag
by the ride's `set null`. No time-based sweep SHALL be claimed.

A postcard tagged to a ride is a record that a named rider was at a named meeting point at a named
time. `ride_members` already records the association, so the tag adds a link rather than a new class
of personal data — but `CLAUDE.md` requires a window stated at creation rather than retrofitted, and
this is it.

#### Scenario: The window is written in the migration, in these words
- **WHEN** `041` is written
- **THEN** its header SHALL state the retention window
- **AND** it SHALL NOT name a number of days, because there is no `pg_cron` and no scheduled Edge
  Function in this project and a window nothing implements becomes a fact nobody rechecks

#### Scenario: The window is verifiable
- **WHEN** the retention claim is asserted
- **THEN** deleting the postcard and deleting the ride SHALL each be exercised and counted
- **AND** the assertions SHALL be the same ones the cascade requirement already needs, rather than a
  second set

### Requirement: The surfaces this change does not build SHALL be named rather than half-built

Retagging, a journal count on `rides`, the postcard's photo location and flag, ride cover images, and
the `postcard_on_ride` notification SHALL NOT be rendered as disabled or non-functional controls.

A control that renders and does nothing is a worse artifact than an absent one — the reasoning that
removed the Inbox tab rather than shipping it disabled.

**The Journal row is no longer the worked example, and the reversal is deliberate rather than drift.**
This requirement was written when `RidePageMenu` omitted a Journal row because the column did not
exist. PD-254 deleted that switcher and, with the product owner's approval, put a `Journal` **section**
on the ride plan carrying an explicit empty state — *Nothing yet · Prep shots count* — on the opposite
reasoning: a section nobody has seen is a feature nobody knows exists, and empty is the state every
ride starts in. The two are not in conflict. An **empty state that says it is empty** is not a control
that renders and does nothing; the rule still forbids the disabled row, and still forbids an affordance
whose write the database would refuse.

#### Scenario: The Journal section says what it is waiting for
- **WHEN** the ride plan renders for a crew member and the ride has no tagged postcards
- **THEN** the section SHALL draw its empty state rather than being hidden
- **AND** it SHALL NOT promise content it cannot show
- **AND** the doc comment recording *why it has no content* SHALL be removed in the same change that
  gives it content, rather than left describing a state that has ended

#### Scenario: The Add affordance and the write half ship together
- **WHEN** the `Add` tile on that section is offered
- **THEN** the composer it opens SHALL carry the ride, so a photo added from a ride's Journal appears
  in it
- **AND** until it does, the gap SHALL be recorded where a reader finds it rather than left to be
  discovered — PD-254 shipped the tile ahead of the write half on the owner's own sequencing, and
  logged it in `docs/FIGMA-FIDELITY-TODO.md` §Ride detail and in `RideJournal.tsx`

#### Scenario: No edit-tag affordance
- **WHEN** a postcard already carrying a ride is rendered, to its author or anyone else
- **THEN** no change-ride or remove-ride control SHALL appear
- **AND** the reason SHALL be recorded: the column carries no UPDATE grant by decision, and a control
  whose write the database refuses is the worst of both

#### Scenario: The photo location stays absent
- **WHEN** the Journal card is built from `v2 / Component / Postcard`
- **THEN** the drawn flag, city and country SHALL remain unbuilt, as they already are on the feed
- **AND** the reason SHALL stay where it is, in `docs/FIGMA-FIDELITY-TODO.md`, rather than being
  restated as a new gap
