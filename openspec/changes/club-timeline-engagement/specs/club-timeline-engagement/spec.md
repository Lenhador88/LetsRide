## ADDED Requirements

### Requirement: A wave SHALL inherit its subject's audience and SHALL restate no predicate of its own

A wave row SHALL be visible exactly when its subject is visible to the caller, and that SHALL be
achieved by an `EXISTS` against the parent table evaluated under the caller's own row security —
never by restating membership, club visibility, or a block on the subject.

Each SELECT policy SHALL be `user_id = auth.uid() or (<parent EXISTS> and not
private.is_blocked(auth.uid(), user_id))` — the own-row branch a disjunct of the **whole** policy,
for the reason the withdrawal requirement below states.

- `club_thread_waves`' parent SHALL be
  `exists (select 1 from public.club_threads t where t.id = club_thread_waves.thread_id)`.
- `club_join_waves`' parent SHALL be
  `exists (select 1 from public.club_members m where m.club_id = club_join_waves.club_id and m.user_id = club_join_waves.subject_user_id)`.

**Both sides of every comparison in a parent `EXISTS` SHALL be table-qualified.** `club_members`
has a column named `club_id` and one named `user_id`, so an unqualified comparison deparses to
`m.club_id = m.club_id` and the subquery degenerates into "can I read any roster row anywhere".

Neither policy SHALL name `private.is_club_member`, `clubs.is_public`, `clubs.owner_id`, or a block
on the thread's author or the join's subject. Each parent policy already carries all of them, and a
second copy is a policy free to drift.

The INSERT policy SHALL use the **same** `EXISTS` as SELECT, so "cannot wave what you cannot see"
needs no separate rule and cannot fall out of step with it.

#### Scenario: A non-member of a public club sees and writes no wave
- **WHEN** a signed-in rider who is not a member of a public club queries either wave table for
  that club
- **THEN** `club_thread_waves` SHALL return zero rows, because `club_threads` SELECT requires
  `private.is_club_member`
- **AND** an INSERT SHALL be refused, because the INSERT policy's `EXISTS` is the same one
- **AND** neither outcome SHALL depend on any predicate written in this change

#### Scenario: A policy change on the parent reaches the wave with no edit here
- **WHEN** the SELECT policy on `club_threads` or `club_members` is later narrowed or widened
- **THEN** the corresponding wave table's audience SHALL move with it
- **AND** no migration, no policy and no client module SHALL need editing for that to hold

#### Scenario: The client adds no audience filter
- **WHEN** either wave read is issued from `src/lib/data/`
- **THEN** its predicates SHALL name only the subject ids and, for joins, the club
- **AND** SHALL NOT include a membership test, a block test, a club-visibility test or a role test

### Requirement: Every role's reach into a wave SHALL be stated, including the negative cases

Membership below is `private.is_club_member(club_id)`, which is a `club_members` row **or**
`clubs.owner_id` (`054`, split by `060`), so an owner holding no roster row is a member for every
rule here.

| Role | May read a wave | May wave a thread | May wave a join | Notes |
|---|---|---|---|---|
| Club **owner** | yes, all | yes | yes | reaches everything a member does |
| Club **admin** (`club_members.role = 'admin'`) | yes, all | yes | yes | **no policy in this change tests `role`**, and none SHALL |
| Club **member** | yes, all | yes | yes | |
| **Non-member of a PUBLIC club** | **no thread waves**; **join waves for that club's joins, which they can already read** | **no** | **YES** | `club_members` SELECT has a public-club disjunct and `club_threads` SELECT does not; the two halves differ and the difference is not an oversight. **The join-wave WRITE follows the read, because the INSERT policy uses the same `EXISTS`** — making it "no" would require restating membership, which the first requirement above forbids by name. `092.1` asserts both halves |
| **Non-member of a PRIVATE club** | none | no | no | `085`; `ClubPreviewScreen` issues no such read |
| **Rider blocked by, or blocking, the WAVER** | never sees that wave, and it never counts for them | n/a | n/a | symmetric, via the reactor block arm |
| **Rider blocked by, or blocking, the THREAD AUTHOR** | sees no wave on that thread | **no** | n/a | the thread row is already absent |
| **Rider blocked by, or blocking, the JOIN SUBJECT** | sees no wave on that join | n/a | **no** | the membership row is already absent |
| **Signed-out visitor** | reaches the shell and no data | no | no | `anon` holds no grant on either table and this change adds none |

`club_join_waves`' row for a non-member of a public club is reachable — for reading **and for
writing** — and empty in practice, because `ClubTimeline` disables every member-only read for a
non-member and the screen draws no join entries for them to decorate. **The spec states the policy
outcome rather than the screen's**, because the policy is the boundary and the screen is the
affordance.

An earlier draft of this table said such a rider may not wave a join. That contradicted this
capability's own first requirement — the INSERT policy uses the **same** `EXISTS` as SELECT, and
the only way to refuse the write would be a membership conjunct that requirement forbids. The
table is corrected rather than the policy, because a signed-in rider welcoming a newcomer to a
**public** club is not a harm the change set out to prevent.

#### Scenario: An admin reaches exactly what a member reaches
- **WHEN** a rider whose `club_members.role` is `admin` opens the club
- **THEN** they SHALL read and write exactly the waves a `member` would
- **AND** no policy, grant, RPC or control introduced by this change SHALL reference `role`

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** a request against either wave table arrives with no session
- **THEN** zero rows SHALL be returned and every write SHALL be refused, because `anon` holds no
  grant
- **AND** this change SHALL add none, per decision #1

#### Scenario: The owner of a club they have left still waves in it
- **WHEN** the rider named in `clubs.owner_id` holds no `club_members` row and waves a thread
- **THEN** the write SHALL succeed, because the parent `EXISTS` resolves through
  `private.is_club_member`'s owner disjunct
- **AND** no owner-specific arm SHALL appear in either policy

### Requirement: A blocked rider's wave SHALL be invisible AND uncounted, and the count SHALL therefore be per-viewer

Both wave tables SHALL carry the symmetric reactor arm
`user_id = auth.uid() or not private.is_blocked(auth.uid(), user_id)`.

The count SHALL be computed from the rows RLS returns and SHALL NOT be stored. `009` refused a
`like_count` column for this reason and the refusal SHALL transfer: *"the correct count is
per-viewer: a blocked rider's like must not be visible to, or counted for, the rider who blocked
them."*

**Three consequences follow and SHALL be treated as designed behaviour, stated wherever the count
is defined:**

1. **Two riders looking at one thread MAY see different totals**, and neither is told why.
2. **A rider blocked by every other member still sees `1`** — their own, through the own-row arm.
3. **A wave placed before a block SURVIVES the block.** Blocking changes what a rider can see,
   never what exists (`009` §7).

Because the number is not a shared fact, it SHALL NOT be used as one. A wave count SHALL NOT order,
rank or sort any list; SHALL NOT feed a threshold, badge or label implying a shared judgement
("popular", "trending", "3+ waves"); and SHALL NOT be denormalised onto `club_threads`,
`club_members` or any other row.

#### Scenario: A blocked rider's wave is absent from the rows and from the total
- **WHEN** A has blocked B, and B has waved a thread both can otherwise reach
- **THEN** A's read SHALL return the row set without B's wave
- **AND** A's count SHALL be one lower than B's own count of the same thread
- **AND** the two SHALL be produced by one mechanism, not by a client-side subtraction

#### Scenario: A rider blocked by everyone still sees their own wave
- **WHEN** a rider is blocked by every other member of the club and waves a thread
- **THEN** their own count SHALL read `1`
- **AND** every other member's count SHALL read `0`
- **AND** neither view SHALL disclose that the other exists

#### Scenario: The count feeds no ordering
- **WHEN** the change is complete
- **THEN** no list, feed, strip or query in the app SHALL order by a wave count
- **AND** no cursor or page boundary SHALL be derived from one, because a per-viewer sort key makes
  pagination differ per rider

#### Scenario: A block placed after a wave does not delete it
- **WHEN** B waves a thread and A then blocks B
- **THEN** the row SHALL still exist
- **AND** it SHALL be absent from A's reads and from A's count, and present in B's

### Requirement: A wave SHALL be withdrawable by its author regardless of whether its subject is still visible

DELETE SHALL be `using (user_id = auth.uid())` with **no visibility conjunct**, which is `009`'s
rule and its reason: a rider must be able to withdraw a wave from a subject that has gone out of
view, or the row is stranded.

**The SELECT policy is what makes that reachable, and it SHALL be asserted rather than assumed.**
`081` measured that RLS applies the SELECT policy to a `DELETE` whose `WHERE` names a column, so a
row the caller owns but cannot read survives its own delete with PostgREST reporting success.
Relaxing the DELETE policy cannot repair that, because SELECT is applied first.

**The own-row branch SHALL therefore be a disjunct of the WHOLE SELECT policy**, not a disjunct
inside the block arm. Inside the block arm it is a **no-op** — `blocks_no_self_block` already makes
`is_blocked(x, x)` false — and the parent `EXISTS` still dominates, so a rider blocked by a
thread's author, **and** a rider who has merely left the club, both read zero of their own waves
and both get `DELETE 0` with the row surviving while every remaining member still sees it. That
shape was specified first, measured on the real chain, and corrected; `postcard_likes` carries it
today and is filed separately. Un-hoisting the branch SHALL fail an assertion, because it looks
like a tightening and its cost is invisible from the DELETE policy alone.

No role other than the row's author SHALL delete a wave. There SHALL be no owner or admin
moderation verb for a wave, no `security definer` RPC, and no new advisor.

#### Scenario: A wave on a thread whose author has since blocked the waver is still withdrawable
- **WHEN** B waves A's thread and A then blocks B
- **THEN** B SHALL still be able to read and delete their own wave
- **AND** the delete SHALL match the row rather than reporting a silent success against zero rows
- **AND** B SHALL still read no OTHER rider's wave on that thread, and still not read the thread

#### Scenario: A rider who has left the club can still withdraw what they left behind
- **WHEN** a rider leaves a private club in which they waved a thread and welcomed a joiner
- **THEN** both waves SHALL still be deletable by them, each delete matching its row
- **AND** no block SHALL be involved, `private.is_club_member` simply having stopped answering
- **AND** the other waver's rows SHALL be untouched by the departure

#### Scenario: No club role can delete another rider's wave
- **WHEN** a club owner or admin attempts to delete a wave they did not write
- **THEN** the delete SHALL match zero rows
- **AND** no RPC SHALL exist that would let them, because `moderate_club_thread` already removes
  the thread and cascades its waves

### Requirement: A join wave SHALL die with the membership it decorates, not with the rider

`club_join_waves` SHALL carry
`FOREIGN KEY (club_id, subject_user_id) REFERENCES club_members (club_id, user_id) ON DELETE CASCADE`,
available because `club_members`' primary key is `(club_id, user_id)`.

`add-club-timeline` requires that a leave erases its own join entry and that a rejoin is
indistinguishable from a first join. A wave keyed only to `profiles` would break both: the rows
would outlive the entry they decorate, be unreachable from any screen, and **reappear on the
rejoin**, showing a rider as welcomed by riders who did nothing.

`user_id` — the waver — SHALL reference `profiles(id) ON DELETE CASCADE` in its own right. Both
foreign keys into `profiles` SHALL have an index Postgres can use, per the standing rule
`add-account-deletion` established; on both tables the primary key leads with a different column,
so both need their own.

#### Scenario: Leaving the club takes the waves with the join entry
- **WHEN** a rider leaves a club in which their join was waved by five members
- **THEN** all five wave rows SHALL be deleted by cascade
- **AND** no client code SHALL be responsible for that cleanup

#### Scenario: A rejoin starts at zero
- **WHEN** that rider rejoins the club
- **THEN** a new join entry SHALL appear at the new `joined_at` with **no** waves
- **AND** the timeline SHALL make no claim about it being their first join

#### Scenario: Deleting the WAVER's account removes their waves and nothing else
- **WHEN** a rider deletes their account (`029`–`032`)
- **THEN** every wave they placed SHALL be removed by cascade from `profiles`
- **AND** waves placed by others on subjects that rider is not part of SHALL be untouched
- **AND** the deletion SHALL find them by index rather than by scanning either table

#### Scenario: Deleting the SUBJECT's account removes the join and its waves
- **WHEN** the rider a join wave is addressed to deletes their account
- **THEN** their `club_members` rows SHALL cascade from `profiles`, and the waves SHALL cascade
  from those
- **AND** no orphan wave SHALL remain naming a rider who no longer exists

#### Scenario: A role change disturbs no wave
- **WHEN** `promote_club_member` or `demote_club_admin` (`088`) writes `club_members.role`
- **THEN** no wave row SHALL be affected, `role` not being part of the key

### Requirement: A wave SHALL be a participation-gated content write

Both wave tables SHALL carry a `BEFORE INSERT` `enforce_participation_gate` trigger with
`when (current_user = 'authenticated')`, taking the gate count from **17** to **19**.

A wave is a rider-authored act visible to others and addressed, in the join case, to a named
person. `023` refuses content writes without a consent stamp, and an account created by calling
GoTrue's `/auth/v1/signup` directly and never calling `accept_terms()` SHALL be unable to wave.

The `when` clause is **not decoration**: `023` §2 measured that inside a `security definer` body
`current_user` is the owner, so a guard written in the function body would be true on every call and
the gate would never fire. It is evaluated in the caller's context before the function is entered.

#### Scenario: An unconsented account cannot wave
- **WHEN** an account with `terms_accepted_at` NULL attempts either INSERT
- **THEN** the write SHALL be refused by the trigger
- **AND** the refusal SHALL come from the database, not from a Zod schema or a disabled button

#### Scenario: The gate count is measured, not asserted from prose
- **WHEN** the migration is applied
- **THEN** `select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not
  tgisinternal` SHALL return **19**
- **AND** the suite SHALL assert the presence on each new table by name, because a flat count
  cannot tell a new table's gate from a moved one

### Requirement: A rider SHALL NOT be able to welcome themselves, and a rider MAY endorse their own thread

`club_join_waves` INSERT SHALL additionally require `user_id <> subject_user_id`.

`club_thread_waves` SHALL carry **no** such restriction, matching `postcard_likes`, which permits a
self-like.

The asymmetry is deliberate and SHALL be recorded where the constraint is written, so it is not
read as an oversight and removed for consistency. A wave on a thread is an endorsement of a topic,
which a rider may coherently feel about their own. A wave on a join is *welcome*, addressed to a
person; addressed to oneself it expresses nothing, and refusing it in the WITH CHECK keeps a
self-addressed row out of the fan-out's path rather than relying on the fan-out to exclude it.

#### Scenario: A self-welcome is refused by the database
- **WHEN** a rider attempts to wave their own join
- **THEN** the INSERT SHALL be refused
- **AND** the affordance SHALL be absent from their own join row, so the refusal is not the first
  the rider hears of it

#### Scenario: A rider may wave their own thread
- **WHEN** a rider waves a thread they started
- **THEN** the INSERT SHALL succeed
- **AND** no notification SHALL be written, the fan-out being on joins only

### Requirement: The wave SHALL NOT introduce a timeline source, and the condition under which that changes SHALL be stated

A wave decorates an entry that is already on the stream. It SHALL contribute no `ClubTimelineEvent`,
no ordering key and no `ClubTimelineSource`, so `mergeClubTimeline`, `boundedHorizon` and the
coherence horizon are untouched by this change and **no new horizon is declared**.

Each wave read SHALL be scoped to the subject ids the timeline is already holding — `attachLikeState`'s
shape — and SHALL therefore be bounded by the timeline's own bound rather than by one of its own.

**If a later change draws a wave as its own entry** — *"Ana waved at Bruno"* — it becomes a source,
and it SHALL then declare a horizon like every other source, per `add-club-timeline`'s standing
requirement. Stating the condition is the requirement; the entry is a non-goal here.

#### Scenario: The merge is unchanged
- **WHEN** the change is complete
- **THEN** `mergeClubTimeline`'s inputs SHALL hold the same five sources it holds today
- **AND** no source SHALL be added, and no `horizon` field SHALL be computed from a wave read

#### Scenario: A wave read is bounded by the entries on screen
- **WHEN** the wave reads are issued
- **THEN** each SHALL name the subject ids already returned by the timeline's own sources
- **AND** SHALL NOT issue an unbounded read of either wave table

#### Scenario: A failed wave read costs marks and not rows
- **WHEN** either wave read errors
- **THEN** the timeline entries SHALL render with the toggle unpressed and no count
- **AND** no error state SHALL be shown for the timeline, and no entry SHALL be withheld

### Requirement: The wave affordance SHALL define every state, and SHALL be absent rather than inert where it cannot succeed

| State | Behaviour |
|---|---|
| Empty | zero waves SHALL render **no count at all**, never `0` |
| Loading | the entry SHALL render immediately with the toggle disabled and no count; the stream SHALL NOT be gated on the wave read |
| Error | a failed read costs marks not rows; a failed **write** SHALL roll the optimistic toggle back and surface its message inline without reflowing the row |
| Offline | the write SHALL fail and say so. It SHALL NOT be queued: a wave is an expression at a moment, and replaying it on reconnect makes the app act for the rider later, possibly after they have blocked the subject |
| Permission denied | **the affordance SHALL be absent, not disabled and not erroring.** A rider who cannot read the subject never sees the entry; both INSERT policies use the same `EXISTS` as SELECT, so entry-visible-but-write-refused is empty by construction. A refusal SHALL NOT be rendered as a message naming a block |
| Partial | the two reads are independent; thread waves rendering while join waves have not SHALL be correct and SHALL NOT blank either |
| Stale | read on load, no subscription. Another rider's wave appears on the next load; the rider's own toggle is optimistic and locally authoritative until the write answers |

#### Scenario: A zero count draws nothing
- **WHEN** an entry has no waves
- **THEN** no numeral SHALL be drawn beside the glyph
- **AND** the row's height SHALL NOT change when the first wave arrives in a way that shifts the
  controls under a rider's thumb

#### Scenario: The toggle is never queued offline
- **WHEN** a rider taps wave with no connectivity
- **THEN** the write SHALL fail, the toggle SHALL revert, and a message SHALL be shown
- **AND** no retry SHALL be scheduled, and nothing SHALL be replayed on reconnect

#### Scenario: The refusal never names a block
- **WHEN** a write is refused because the subject is not readable
- **THEN** the message SHALL NOT distinguish "blocked" from "not a member" from "no such subject"
- **AND** the affordance SHALL not have been drawn in the first place

### Requirement: A thread's share affordance SHALL share the CLUB, and SHALL say so in its label

The product owner answered this on 2026-08-31, choosing the first of the two futures this
requirement originally held open. A club thread's ⋯ menu gains a row that calls
`shareAppLink(routes.club(clubId))` and is labelled **`Share club`**. No control SHALL call
`shareAppLink(routes.clubThread(id))` or produce any URL addressing a thread.

`081`'s SELECT policy admits only a club's members to its threads, so a thread link resolves to
*content unavailable* for every recipient who is not already inside the club — **which is the live
defect PD-299 was opened against**, in that issue's own words, on a different surface.

**The word `club` in the label is the whole safety property.** A row reading `Share` on a thread
screen promises the thread; only the label stops a rider believing they have sent someone a
conversation. A refactor that shortens it reinstates the defect with nothing red anywhere, which is
why the label is a requirement rather than copy.

The second future — a capability URL for a thread, with the full apparatus `091` gives
`ride_invite_links` — remains out of scope and SHALL NOT arrive incrementally. A link granting reach
into a members-only club conversation is a larger decision than the icon it would sit behind.

**This row inherits a known defect and SHALL be annotated as doing so.** `routes.club(clubId)` on a
*private* club is refused by RLS to the non-member it is sent to. That is PD-299 #2, fixed by
`invite-riders-to-a-club` (PD-360), which replaces both callers with one shared control that
branches on `clubs.is_public`. Until that lands this is deliberately a second caller of a
known-broken path, and the site says so.

#### Scenario: No thread URL is produced anywhere
- **WHEN** the change is complete
- **THEN** no component, action or helper SHALL construct an absolute URL for a club thread
- **AND** `routes.clubThread` SHALL continue to be used only for in-app navigation

#### Scenario: The row names the club, not the thread
- **WHEN** a member opens a thread's ⋯ menu
- **THEN** the row SHALL read `Share club`
- **AND** the URL it shares SHALL address the club

#### Scenario: The capability URL is still a decision nobody has taken
- **WHEN** a later session wants a share row that reaches the thread itself
- **THEN** it SHALL design the expiry, the revoke, the use count and the secret-authorised RPCs
- **AND** SHALL NOT reach a capability URL as a side effect of wanting a share button to work

### Requirement: The words half of "say welcome" SHALL be rider-initiated and SHALL create no schema

A join entry MAY offer **Say welcome**, which opens the existing thread composer with its title
pre-filled and nothing else pre-decided. It SHALL create no row until the rider submits, and it
SHALL add no table, column, trigger or RPC.

**No trigger SHALL create a `club_threads` row.** `club_threads.author_id` is `NOT NULL` with no
default and cascades from `profiles`, so an automatic thread must name a rider who did not write
it — and both candidates fail: the joiner as author may delete the thread others welcomed them in,
cascading their messages away, and the club owner as author means the application has published a
rider's username into a title that no verb can edit (`club_threads` has no UPDATE policy and no
UPDATE grant), that the named rider cannot delete, and that keeps naming them after they leave.

The Welcome club (`058`) makes the automatic shape self-defeating besides: one join per signup
means one thread per rider for ever, and carving that club out — as `private.notify_club_joined`
already does for its own fan-out — leaves the rider with the emptiest app as the only one
guaranteed no welcome.

#### Scenario: No thread is created without a rider composing it
- **WHEN** any rider joins any club, by any path — `joinClub`, `createClub`,
  `complete_onboarding` (`058`), or `private.join_club_from_request` (`085`)
- **THEN** no `club_threads` row SHALL be written
- **AND** no trigger SHALL be added to `club_members` by this change

#### Scenario: The composer is pre-filled and fully editable
- **WHEN** a member taps Say welcome on a join entry
- **THEN** the thread composer SHALL open with a title naming the joiner and an empty body
- **AND** the rider SHALL be able to change or discard both, the row being written only on submit

#### Scenario: A welcome thread names a rider who may leave, and that is a rider's own sentence
- **WHEN** the joiner later leaves the club, blocks the author, or deletes their account
- **THEN** the thread SHALL behave exactly as any other rider-authored thread does under `081`
- **AND** no additional rule SHALL be introduced for it, because the title is a rider's sentence
  about another rider and not the application publishing a name on its own initiative

### Requirement: Historical joins SHALL be wavable with no backfill

Every `club_members` row predating this change SHALL be wavable the moment `092` applies, because
a wave hangs off the membership row that already exists.

**No backfill SHALL be performed**, and none is needed. This is stated as a requirement because the
declined shape had no such property: an automatic thread per join forces a choice between
backfilling — one thread per existing membership, and in the Welcome club one per rider — and not
backfilling, which draws some joins as threads and some as plain rows with the boundary at a deploy
date no rider can see.

#### Scenario: An old join is wavable immediately
- **WHEN** a member opens a club whose joins all predate the migration
- **THEN** every join entry on the timeline SHALL carry the wave affordance
- **AND** no migration SHALL have written a row for any of them

#### Scenario: No join entry renders differently from another
- **WHEN** joins from before and after the migration appear in one stream
- **THEN** they SHALL be indistinguishable in composition and in the affordances they carry
