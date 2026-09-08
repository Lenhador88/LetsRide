# database-enforced-integrity Specification

> **Provenance — read before quoting this file.** These requirements were folded out of
> `migrate-to-client-rendered-shell`'s delta specs when it was archived on 2026-08-06, and that
> was this repo's first archive, so this is the first time standing specs have existed at all.
>
> **The `### Requirement:` statements are the contract.** The prose under each one is the
> *original argument* for it, written before the change shipped, and it therefore sometimes
> describes the world as it was. Passages known to have gone stale have been corrected in place
> and say so; anything still phrased as "today" or "becomes" that is not marked is unverified —
> check it against the code before relying on it. Where this file and `CLAUDE.md` disagree about
> what the code *does*, `CLAUDE.md` and the code win; where they disagree about what it *must*
> do, this file does.

## Purpose
Every write rule that must still hold when the browser is the only caller. Today validity is
split between Zod schemas a Server Action parses and CHECK constraints in Postgres; once the
client owns the mutation path the constraint coverage is the entire story, and anything not
expressed as a CHECK, trigger or policy is advisory.
## Requirements
### Requirement: Text bounds on rider-authored columns SHALL be enforced by the database

**This is a live defect, not a risk the migration introduces.** The publishable key ships in
the bundle today and PostgREST accepts any rider's JWT, so a megabyte club name is one
hand-rolled request away right now. What the migration changes is that the app itself starts
issuing writes this way, so the gap stops being exotic.

Ten columns carry a length or presence rule that exists only in `src/lib/validation/`.
Verified against `pg_constraint` on the live project 2026-08-05: no CHECK exists for
`profiles.bio`, `profiles.bike_model`, `profiles.location`, `clubs.name`, `clubs.description`,
`rides.title`, `rides.description`, `rides.meeting_point`, `rides.route_description`, or
`rides.max_riders`. Each SHALL gain a CHECK matching its Zod schema exactly.

**Nine of the ten are still live. `rides.max_riders` is not** — `077` (PD-293) dropped the column
and `018`'s `rides_max_riders_range` with it, so the requirement holds over the remaining nine.

**One of those nine has no Zod schema left to match, and its CHECK is deliberately kept anyway.**
PD-320 took the description field off both ride forms, so `RIDE_DESCRIPTION_MAX` is gone and
nothing in the app writes `rides.description` — but `018`'s `rides_description_length` stands,
because the column still holds what riders wrote before the field left and the ride detail still
renders it. Read "matching its Zod schema exactly" as satisfied-and-frozen there rather than as
violated: the day a writer returns, it returns with a bound that matches this CHECK.

The bounds themselves are not new decisions. `clubs` and `rides` bounds were chosen rather
than measured (their Figma frames are OLD-stylesheet and marked To do) and the migration
adopts them as written rather than reopening them.

#### Scenario: A rider cannot store a value no screen can render
- **WHEN** any signed-in rider writes `clubs.name` longer than 60 characters, by any route
- **THEN** the database SHALL reject the write with a check violation
- **AND** the club list, Explore and every club detail sub-page SHALL be unaffected, including
  for non-members who reach the club through Explore

#### Scenario: An empty required field is refused
- **WHEN** a rider writes `rides.title` or `rides.meeting_point` as an empty or
  whitespace-only string
- **THEN** the database SHALL reject the write
- **AND** the trimmed-floor / raw-ceiling asymmetry SHALL match
  `postcard_comments_body_length`, so padding cannot smuggle a longer value past a trimmed
  check

#### Scenario: Optional text distinguishes cleared from never-set
- **WHEN** a rider clears their bio
- **THEN** the stored value SHALL be NULL rather than the empty string, and the constraint
  SHALL permit NULL

### Requirement: Club membership role SHALL NOT be self-assignable

The database SHALL refuse any `club_members` row whose `role` is `owner` or `admin`, except the
row a club's own `owner_id` creates for themselves.

**This is a live defect, not a risk the migration introduces.** `club_members` INSERT is
`auth.uid() = user_id AND (club is public OR club owner is caller)`. It constrains *who* the
row is for and says nothing about `role`; the only rule on `role` is the enum CHECK. `joinClub`
omits the column and relies on the `'member'` default — which is a convention in our code, not
a rule in the database, and PostgREST does not read our code. Any rider can already join any
public club as `admin` today. The migration is where this is fixed, not where it begins.

The roster screen renders the value — `/clubs/detail/members` labels `owner` and `admin` and
draws an owner ring — so a forged role is visible to every member of the club.

#### Scenario: A non-member joining a public club cannot arrive as owner or admin
- **WHEN** a signed-in rider who is not a member inserts a `club_members` row for a public club
  with `role` set to `owner` or `admin`
- **THEN** the database SHALL reject the write

#### Scenario: The creator's own owner row is still permitted
- **WHEN** the rider named in `clubs.owner_id` inserts their own membership row with
  `role = 'owner'`
- **THEN** the write SHALL succeed

#### Scenario: Nobody can promote an existing member
- **WHEN** any rider — including the club owner — attempts to UPDATE `club_members.role`
- **THEN** the write SHALL be refused, because no UPDATE policy on `club_members` exists
- **AND** this SHALL remain true until the invitations feature ships its own policy, so that
  the absence is a recorded gap rather than an accident

### Requirement: A rider SHALL NOT be able to make other riders' clients fetch a URL they control

No column a rider can write MUST ever be used as an image source, link target or fetch URL in
another rider's client.

`profiles.avatar_url` is unconstrained `text`, the `profiles` UPDATE policy is `auth.uid() = id`
with no column scoping, and `resolveAvatarUrls` uses the column as the fallback whenever
`avatar_path` is NULL. It is also in `PUBLIC_PROFILE_COLUMNS`, so it ships to every member
list, postcard byline, comment row and ride crew.

CLAUDE.md records that nothing has ever *written* the column. That is a statement about the
application, not about PostgREST, and the client-rendered app makes the difference moot.

#### Scenario: An arbitrary URL cannot reach another rider's image tag
- **WHEN** a rider sets their own `profiles.avatar_url` to a URL on a host they control
- **THEN** either the database SHALL reject the write, or no other rider's client SHALL ever
  use the column as an image source
- **AND** a blocked rider SHALL in no case learn the IP address or user agent of the rider who
  blocked them by this route

#### Scenario: Existing rows survive the decision
- **WHEN** the column is constrained or dropped
- **THEN** any non-NULL value present beforehand SHALL be reported before the change, since
  `014` preserved the column precisely because nobody could prove it was empty

### Requirement: Consent and lifecycle timestamps SHALL NOT be readable by other riders

`profiles.terms_accepted_at` and `profiles.onboarding_completed_at` SHALL be readable on the
caller's own row only, and the restriction MUST be enforced by the database rather than by the
projection a query happens to request.

RLS is row-level, not column-level: the `profiles` SELECT policy admits every non-blocked
rider with a username, and therefore admits every column of that row, including
`terms_accepted_at` and `onboarding_completed_at`. `PUBLIC_PROFILE_COLUMNS` narrows the
projection in application code, which is a convention the database does not enforce.

#### Scenario: Another rider's consent record is not retrievable
- **WHEN** any signed-in rider selects all columns of another rider's profile
- **THEN** `terms_accepted_at` and `onboarding_completed_at` SHALL NOT be returned
- **AND** the rider's own row SHALL still return them, because the onboarding resume step and
  the route guard both read the caller's own completion stamp

#### Scenario: A blocked rider reaches nothing
- **WHEN** a blocked rider selects any column of the blocking rider's profile
- **THEN** zero rows SHALL be returned, unchanged from today

#### Scenario: A second projection does not satisfy this
- **WHEN** the restriction is implemented
- **THEN** `authenticated` MUST NOT retain column-level SELECT on `terms_accepted_at` or
  `onboarding_completed_at` on `public.profiles` itself
- **AND** an alternative object placed beside the table SHALL NOT count, because
  `public.profiles` stays published by PostgREST and the grant is what decides —
  verified against `information_schema.column_privileges`, where `authenticated` currently
  holds SELECT, INSERT and UPDATE on both columns

### Requirement: Country codes SHALL be a known country

`profile_countries.country_code` SHALL be an assigned ISO 3166-1 alpha-2 code, not merely two
uppercase letters.

`profile_countries.country_code` has a CHECK of `^[A-Z]{2}$` only. Membership of the ISO
3166-1 list lives in `COUNTRY_CODES` and is checked by Zod alone, so `ZZ` stores successfully
today and renders as a blank flag beside its own code forever.

#### Scenario: An unassigned code is refused
- **WHEN** a rider adds `ZZ`, `XX` or any other well-formed but unassigned code
- **THEN** the database SHALL reject the write

#### Scenario: The picker's list stays the client's
- **WHEN** the constraint is added
- **THEN** it SHALL NOT introduce a `countries` reference table, since nothing joins against
  one and `014` deliberately declined to create it

### Requirement: Onboarding completion SHALL gate participation, not only navigation

A rider whose `profiles.onboarding_completed_at` is NULL MUST NOT be able to create content or
join anything, and the refusal SHALL come from the database rather than from a redirect.

Decision #5 states onboarding is required and not skippable. This requirement is **met**:
`023`'s `enforce_participation_gate` is the enforcement, applied 2026-08-05, and the route
guard is only a UX affordance on top of it.

The argument that produced it, kept because it is why the gate exists: before `023`, `proxy.ts`
was the *only* thing holding decision #5 — no policy prevented a rider whose
`onboarding_completed_at` was NULL from inserting a postcard, creating a club or a ride, or
joining anything, because `003`'s trigger guards the *stamp*, not the participation. Demoting
the route guard to a client component would have removed the only thing holding it.

**The gate is narrower than the requirement above reads, and its scope SHALL be counted rather
than enumerated.** Earlier revisions of this requirement listed the gated tables by name and
asserted "thirteen tables carry an INSERT policy and this gate names eight of them". Both numbers
went stale within a day of being written — `034` added `ride_messages` as a ninth gated table, and
`036` adds `notifications` as a fifteenth table that carries **no INSERT policy at all**, which is
a third category the enumeration cannot express. A standing spec asserting a stale count is worse
than one asserting nothing, because a table added without a gate looks exactly like the list being
right. The scope is therefore stated as a rule with the command that measures it:

```sql
select count(*) from pg_trigger
 where tgname = 'enforce_participation_gate' and not tgisinternal;
```

The rule, which does not go stale: **every table into which a rider inserts content another rider
can see carries the gate.** Per-viewer tables that produce nothing anyone else can see do not —
`profiles` UPDATE, `profile_countries`, `blocks`, `postcard_hides`, `feed_reads`, and every
`storage.objects` policy, which check the path prefix only.

**A table no rider can insert into at all is a third case and needs no gate**, because the gate
constrains *who may write* and there is nobody to constrain. `notifications` is the first of these:
`authenticated` holds no INSERT grant and the table carries no INSERT policy, so its only writer is
a `security definer` trigger. Adding the gate there would be worse than useless — inside a
`security definer` function `current_user` is the owner, so the gate's own
`WHEN (CURRENT_USER = 'authenticated')` clause is false and the trigger would never fire, which
reads as coverage and is not.

An un-onboarded rider also has a NULL `username`, which the `profiles` SELECT policy uses to
hide them from other riders — so their content would appear to everyone else with an
unresolvable author.

**What completion requires is `username` + consent, and NOT a location (PD-286).** The location
arm was part of this invariant from `003` §6a until `075`, and it was written down in three places
that had to agree: `complete_onboarding`'s own restatement, `enforce_onboarding_completion`'s
INSERT arm, and its UPDATE arm. The requirement is unchanged in *shape* — completion is still a
one-way stamp the client cannot forge, still refused without a username, still refused without
consent — and one conjunct narrower. `profiles.location` survives as an ordinary rider-editable
column with `018`'s length CHECK; what stops existing is the claim that a rider must fill it in
before they may participate.

#### Scenario: An un-onboarded rider cannot create content
- **WHEN** a rider whose `onboarding_completed_at` is NULL inserts into any table carrying
  `enforce_participation_gate`
- **THEN** the database SHALL reject the write
- **AND** the set of such tables SHALL be verified by counting the trigger rather than by reading a
  list, because a table added without one is indistinguishable from a correct list

#### Scenario: Per-viewer tables are deliberately excluded
- **WHEN** an un-onboarded rider inserts into `blocks`, `postcard_hides`, `feed_reads`,
  `profile_countries` or their own `profiles` row
- **THEN** the write SHALL succeed, because none of these produces content another rider can
  see and `profiles` is the row the wizard itself writes
- **AND** the exclusion SHALL be stated in the migration rather than left as silence

#### Scenario: A table with no INSERT grant is a third category and carries no gate
- **WHEN** a table exists into which no client role may insert — `notifications` is the first
- **THEN** it SHALL carry no participation gate
- **AND** the absence SHALL be recorded as deliberate in its migration, because the gate's
  `WHEN (CURRENT_USER = 'authenticated')` clause is false inside a `security definer` writer and a
  gate that never fires reads as coverage
- **AND** the enforcement SHALL instead be that the gate on the **parent** table already refused
  the event, so no un-onboarded rider's action can reach the fan-out at all

#### Scenario: An un-onboarded rider cannot file moderation records
- **WHEN** a rider who has not completed onboarding reports a postcard
- **THEN** the write SHALL be refused
- **AND** this SHALL hold regardless of whether an address is verified, because the gate is the
  onboarding stamp and never the address. The requirement previously justified itself by
  "email confirmation is off (decision #6)"; that premise was measured false on 2026-08-06
  (`mailer_autoconfirm: false` — confirmation is required). The rule is unchanged and its
  justification is stronger without the premise: a verified address is not evidence of
  onboarding, and no admin role exists to triage reports either way

#### Scenario: Completing onboarding is still the only way through
- **WHEN** the same rider sets a username, has a consent stamp, and receives the completion stamp
- **THEN** every write above SHALL succeed
- **AND** the stamp SHALL remain one-way, SHALL remain refused while `username` is NULL, and SHALL
  remain refused while `terms_accepted_at` is NULL — unchanged from `003` §6b and `023` §1.13
- **AND** it SHALL NOT be refused for a NULL `location` (PD-286), which is the one conjunct `075`
  removes

#### Scenario: Reading is unaffected
- **WHEN** an un-onboarded rider reads any table
- **THEN** the existing policies SHALL apply unchanged, so this requirement adds no new read
  restriction and cannot strand a rider mid-wizard

#### Scenario: A revoked consent stops a sitting crew member writing
- **WHEN** `private.may_participate()` is extended to require the current terms version, and a
  rider who is already on a ride's crew has consented only to an earlier one
- **THEN** their next message insert SHALL be refused with `check_violation`
- **AND** their read of the thread SHALL be unaffected, because the gate is on writes only
- **AND** this is the case in which the gate on `ride_messages` stops being defence in depth,
  which is why the trigger ships before the case exists

### Requirement: Consent evidence SHALL exist before a rider participates

A rider MUST NOT be able to complete onboarding or create content with
`profiles.terms_accepted_at` NULL, and the requirement SHALL be enforced by the database rather
than by the signup action.

`CLAUDE.md` names three integrity rules the client must not own: username charset, the
onboarding completion stamp, and T&C acceptance. `003` delivers the first two. `012` makes the
consent stamp immutable and server-timed **once written**, but nothing anywhere ever *requires*
it to be written: `003`'s completion guard checks `username` and `location` only, and the
acceptance rule lives in `signUpSchema`'s `z.literal(true)` and in the `signUp` action. Once the
client owns signup, consent evidence stops existing.

This is an EU project and the column is evidence, which is `012`'s own framing.

**Measured on the live project 2026-08-05, and worse than the audit assumed: 4 of 4 profiles
have `terms_accepted_at` NULL, and 3 of those have completed onboarding.** No rider on this
database has a consent record today. That makes the rule correct and its rollout a product
decision rather than a migration detail — see the open question in `design.md`, because a
backfilled timestamp is a fabricated consent record and this requirement does not authorise
one.

#### Scenario: Onboarding cannot complete without consent
- **WHEN** a rider sets `onboarding_completed_at` while `terms_accepted_at` is NULL
- **THEN** the database SHALL refuse the stamp, in the same guard and with the same
  `check_violation` shape `003` uses for `username` and `location`

#### Scenario: The stamp remains server-owned
- **WHEN** a client sends its own timestamp on first acceptance
- **THEN** the value stored SHALL be server time, and thereafter immutable, unchanged from `012`

#### Scenario: Existing riders are not silently stamped
- **WHEN** this rule is applied to a database containing riders with NULL consent
- **THEN** no migration SHALL write a value into `terms_accepted_at` on their behalf
- **AND** they SHALL be routed through a re-consent step instead, or the rule SHALL be deferred
  until one exists

### Requirement: A private club's ride SHALL NOT be publicly visible

`rides.is_public` and `rides.club_id` are independently settable, so a ride attached to a
private club can carry `is_public = true` — and the `rides` SELECT policy's
`is_public OR club member` then makes it, and its crew through `ride_members`, readable by every
signed-in rider. `CreateRideForm` ships the checkbox `defaultChecked`, so the default path
produces exactly this.

The database SHALL refuse a ride whose `club_id` names a private club unless `is_public` is
false.

**Pre-flight measured on the live project 2026-08-05: 3 rides, 0 with a `club_id`, 0 private
clubs, 0 violating rows.** The constraint adds cleanly with no data migration. It will not stay
that way — `/rides/new` started offering `club_id` on 2026-08-05, so the window in which this is
free is short.

#### Scenario: A private club's ride cannot be marked public
- **WHEN** a member of a private club creates or updates a ride with that `club_id` and
  `is_public = true`
- **THEN** the write SHALL be rejected

#### Scenario: A club turning private takes its rides with it
- **WHEN** a club owner sets `is_public = false` on a club that has public rides
- **THEN** those rides SHALL cease to be publicly visible rather than being left behind as an
  orphaned exposure

### Requirement: Ride visibility SHALL be stated per role

Every role that can reach a ride SHALL have its access stated, so each line maps onto an
assertion. The policy exists and has never been written down role by role, which is what
allowed the private-club case above to go unnoticed.

**This change adds no arm.** `public.rides` SELECT and `private.can_read_ride` are untouched, and
an assertion pins both — a failing pin here means the change is wrong, not that the pin is stale.

**What it adds is a reader who is not in the policy at all.** `public.ride_invite_link_preview` is
`security definer`, so it bypasses row security by construction and hands eight named columns of a
ride to a rider holding a URL and nothing else. A read path *outside* the policy is precisely the
thing this requirement exists to stop going unwritten, so it is enumerated here as a role rather
than left to the new capability's own spec.

**Three properties make that reader safe, and all three are asserted:** the column list is fixed
in SQL and never `rides.*`, so a column added later is not disclosed by default; the block check is
**restated in the function's body**, because there is no policy underneath it to carry decision #2;
and the function returns zero rows for every non-live token, so it discloses nothing about which
tokens exist.

**The rule is stated in two places and both are normative.** `private.can_read_ride` (`060`) is a
candidate-relative restatement of this policy, maintained so a fan-out can ask the question for
somebody other than the caller. Any change to the policy SHALL be made to that function in the
same migration and in the same position.

#### Scenario: Organizer
- **WHEN** the organizer reads their own ride
- **THEN** it SHALL be returned regardless of `is_public`, `club_id` or club visibility

#### Scenario: Club member
- **WHEN** a member of the ride's club reads it
- **THEN** it SHALL be returned

#### Scenario: Non-member, public ride with no club
- **WHEN** any signed-in rider reads a ride with `club_id` NULL and `is_public = true`
- **THEN** it SHALL be returned, since decision #1 makes "public" mean "any signed-in rider"

#### Scenario: Non-member, private club's ride
- **WHEN** a signed-in rider who is not a member of the ride's private club reads it
- **THEN** zero rows SHALL be returned, and its crew SHALL be unreachable through `ride_members`

#### Scenario: Invited rider, not yet crew
- **WHEN** a rider holding a `pending` or `accepted` invite reads a ride that is neither public
  nor in a club they belong to
- **THEN** it SHALL be returned, by the arm `083` added inside the block-dominated group

#### Scenario: Token holder, before claiming
- **WHEN** a signed-in rider holding a live token, and no other route to the ride, reads
  `public.rides` directly
- **THEN** zero rows SHALL be returned — **the token buys no policy reach**
- **AND** the only thing they may read is the eight-column preview, through the definer RPC

#### Scenario: Token holder, after claiming
- **WHEN** the same rider has claimed
- **THEN** they SHALL read the ride by the invite arm above and by no new mechanism, being
  indistinguishable in the policy from an accepted in-app invitee

#### Scenario: Blocked rider
- **WHEN** a rider blocked by the organizer reads the ride, by any route including a club they
  both belong to, an invite, **or a live token**
- **THEN** zero rows SHALL be returned
- **AND** the token route SHALL be refused by a check in the RPC's own body, since no policy runs
  beneath a `security definer` function

#### Scenario: Signed-out visitor
- **WHEN** a request arrives with no session
- **THEN** zero rows SHALL be returned, because `anon` holds no grant on `rides`, and no EXECUTE
  on either new RPC

#### Scenario: Invited rider who accepted and later left the crew
- **WHEN** an accepted invitee deletes their `ride_members` row and reads the ride
- **THEN** it SHALL still be returned, because `accepted` is a live invite
- **AND** they SHALL be able to rejoin, which depends on this — `ride_members` INSERT carries its
  own `EXISTS (rides …)` evaluated under their row security

#### Scenario: Invited rider who declined
- **WHEN** a rider who declined an invite reads the ride
- **THEN** zero rows SHALL be returned, unless another arm admits them

### Requirement: Blocking SHALL remain enforced in RLS and SHALL survive the client owning the queries

A blocked rider MUST remain unreachable in both directions, and no screen SHALL apply a block
filter of its own.

Decision #2 is unaffected by the render model: the policies do not know or care which process
issued the statement. This requirement exists so the migration's test pass asserts it rather
than assuming it.

**`clubs` deliberately carries no block predicate, and `rides` deliberately does.** Product
owner ruling, recorded here so the asymmetry is pinned by assertions rather than rediscovered
as a bug: a club is an organisation, not a person. A blocked rider keeps seeing the club in
Explore and on its page; what they do not see is the *person*, and `club_members` already
filters the roster so the blocker never appears in it. `rides` carries
`not private.is_blocked(auth.uid(), organizer_id)` because a ride has an organiser and that
organiser is a person.

#### Scenario: A blocked rider disappears symmetrically
- **WHEN** rider A blocks rider B, and B queries `postcards`, `postcard_comments`,
  `postcard_likes`, `club_members`, `ride_members`, `rides` or `profiles` for A's rows,
  directly from the client
- **THEN** zero rows SHALL be returned in each case
- **AND** the same SHALL hold with A and B exchanged, because the row is directional and the
  effect symmetric

#### Scenario: A blocked rider still sees the club itself
- **WHEN** rider A blocks rider B, and B loads Explore or a club page for a club A owns or
  belongs to
- **THEN** the club SHALL still be returned, because `clubs` carries no block predicate by
  decision
- **AND** A SHALL NOT appear in that club's roster, because `club_members` does carry one

#### Scenario: No client-side filtering is introduced
- **WHEN** any screen renders a list that could contain a blocked rider
- **THEN** it SHALL NOT apply a block filter of its own, so that the policy remains the single
  place the rule lives

### Requirement: Storage object ownership SHALL remain database-enforced

A rider MUST NOT be able to upload outside their own folder, nor reference an object in another
rider's folder from a row they author.

Every upload surface binds its path to the uploader in SQL: `postcards` through the INSERT
policy's `image_path like 'postcards/' || auth.uid() || '/%'`, and `profiles` and `clubs`
through CHECK constraints on the row. Fifteen `storage.objects` policies exist across five
folders, none granted to anything but `authenticated`, and none of them UPDATE.

#### Scenario: A rider cannot claim another rider's object
- **WHEN** a rider inserts a `postcards` row whose `image_path` sits in another rider's folder
- **THEN** the write SHALL be rejected by the INSERT policy

#### Scenario: A rider cannot upload outside their own folder
- **WHEN** a rider uploads to `avatars/<another uid>/…`, `covers/`, `club-avatars/` or
  `club-covers/` outside their own folder
- **THEN** Storage SHALL refuse the upload

#### Scenario: No capacity rule is claimed for `ride_members`
- **WHEN** a rider joins a ride
- **THEN** nothing SHALL limit the size of its crew: `rides.max_riders` was enforced by
  `063` and dropped, column and trigger together, by `077` (PD-293) — the design draws no
  capacity affordance anywhere, so the rule could only reach a rider as an unexplained refusal
- **AND** nothing SHALL claim otherwise: `RIDE_CREW_LIMIT` bounds what the crew rail *renders*
  and is not a database rule

### Requirement: A child table whose audience is NARROWER than its parent's SHALL enforce that by composition, never by a privileged helper alone

Where a table's audience is narrower than the audience of the row it hangs off, its SELECT policy
SHALL contain **both** an `EXISTS` against the parent evaluated under the caller's own row
security **and** the narrowing predicate. A `security definer` helper SHALL NOT be the only
condition.

**Every child table in this schema until now inherits its parent's audience exactly** —
`postcard_comments`, `postcard_likes`, `postcard_reports` and the `storage.objects` read policy
all express it as a bare `EXISTS` and restate nothing, which is deliberate and correct for them.
A ride's chat is the first table that is narrower, and the two obvious implementations are both
wrong in opposite directions: the bare `EXISTS` alone admits every rider who can see the ride,
and the narrowing helper alone **bypasses the parent's policy entirely**, because a
`security definer` function does not run under RLS.

That second failure is not hypothetical here. `rides` SELECT carries
`NOT private.is_blocked(auth.uid(), organizer_id)` and a private-club predicate; a `ride_members`
row survives blocking the organizer, leaving the club, and the club turning private. So "holds a
crew row" and "can see the ride" are independent conditions, and only their conjunction is the
audience. `private.is_club_member` has the identical shape and no such gap only because `clubs`
deliberately carries no block predicate — which makes copying that shape verbatim the specific
trap this requirement closes.

**Which conjunct is the strict one is a property of the parent, not of the pattern, and it is not
always the parent.** A club's threads are the worked counter-example. `clubs` SELECT is
`is_public OR owner_id = auth.uid() OR private.is_club_member(id)`; `is_public` admits **every
signed-in rider**, so on a public club the parent `EXISTS` is satisfied by the entire platform and
contributes nothing. There, the **narrowing helper is the load-bearing half** and the `EXISTS` is
the redundant one — the exact inverse of the ride chat. An implementer who carries the ride chat's
*conclusion* ("the `EXISTS` is what protects you") rather than its *reasoning* returns every public
club's child rows to every rider in the app.

Both conjuncts are still required in both directions, and the reason a redundant conjunct stays
SHALL be stated truthfully rather than borrowed. Writing "the helper alone is a leak" where it is
not is itself a defect: `061` records that a comment whose stated reason is false is how the next
session removes the conjunct.

#### Scenario: The parent-visibility conjunct is present and is not redundant
- **WHEN** a policy on a table whose audience is narrower than its parent's is written or
  reviewed
- **THEN** it SHALL contain an `EXISTS` against the parent evaluated under the caller's own row
  security
- **AND** that conjunct SHALL NOT be removed on the grounds that the narrowing predicate already
  implies it

#### Scenario: The narrowing conjunct is present even where the parent is the permissive half
- **WHEN** the parent's SELECT policy admits a strictly wider audience than the child's — a public
  club admitting every signed-in rider, for instance
- **THEN** the narrowing predicate SHALL be present and SHALL be understood as the load-bearing
  conjunct
- **AND** a review SHALL establish **which** conjunct is strict for that parent before accepting the
  policy, rather than transferring the answer from another table

#### Scenario: A redundant conjunct is justified by what could change it, not by a borrowed reason
- **WHEN** one conjunct provably implies the other under the parent's current policy
- **THEN** both SHALL still be written
- **AND** the stated reason SHALL be that the implication is a property of the parent's present
  policy which a later arm can break silently, and that using a `private` membership helper as a
  sole conjunct anywhere establishes by example that the shape is safe
- **AND** the stated reason SHALL NOT assert a leak that does not exist

#### Scenario: A blocked rider cannot reach a child row through a definer helper
- **WHEN** a rider who has blocked, or been blocked by, a parent row's owner still satisfies the
  narrowing predicate
- **THEN** zero child rows SHALL be returned
- **AND** the refusal SHALL be attributable to the parent-visibility conjunct, asserted in
  isolation from the narrowing one

#### Scenario: Where the parent carries no block predicate, the child carries its own
- **WHEN** a child table hangs off a parent whose SELECT policy contains no `private.is_blocked`
  call — `clubs` today
- **THEN** the child's own SELECT policy SHALL carry the block arm against the **author** of the
  child row, because decision #2 is not satisfied by inheritance from a parent that does not
  enforce it
- **AND** the RLS suite SHALL assert that the parent still carries no block predicate, so that the
  day one is added, the reasoning is re-read rather than silently outlived

#### Scenario: Each conjunct is asserted alone
- **WHEN** assertions are written for such a policy
- **THEN** at least one case SHALL fail if the parent-visibility conjunct is removed, and at
  least one different case SHALL fail if the narrowing conjunct is removed
- **AND** a single case that both conjuncts happen to hide SHALL NOT be accepted as coverage,
  because it cannot say which one did the work

#### Scenario: The privileged helper is not published
- **WHEN** the narrowing predicate is a `security definer` function
- **THEN** it SHALL live in the `private` schema so PostgREST cannot publish it
- **AND** `authenticated` SHALL hold EXECUTE on it, because an RLS expression is evaluated as the
  querying role, and that grant SHALL be asserted by naming the role rather than by calling the
  function — the suite runs as the table owner, for whom no barrier exists

### Requirement: A column the server owns SHALL NOT be writable by a client that can insert the row

Where a column's value must come from the server — a timestamp that orders a conversation, a
stamp that records an act — a DEFAULT SHALL NOT be treated as the enforcement. The value SHALL be
imposed by a trigger, or the column grant SHALL be withheld.

A DEFAULT applies only when the column is **omitted**. `authenticated` holds INSERT on every
content table and PostgREST lets a client name any column in the insert body, so a DEFAULT is a
convention the database does not enforce — the same class of claim as `joinClub` relying on
`club_members.role`'s default, which `019` exists to close.

It has never mattered for `postcard_comments.created_at`, because a comment thread is short and
nobody has an incentive to forge a position in it. It matters the moment a column decides the
order of a conversation: a message stamped with a far-future time pins itself to the top of every
participant's thread permanently, and the only remedy is a delete.

**A secret narrows the choice to one of the two, and `091` is the sharpest instance in the
schema.** `public.ride_invite_links.token` is the credential itself, so a client able to name it
could mint a link with a token it chose — a predictable or reused string, or one already pasted
somewhere — and the entropy guarantee would be worth nothing. For a secret the enforcement SHALL
therefore be the withheld **grant** specifically, on `044`'s reason rather than a new one: a
withheld grant refuses the write at the door with `42501`, where a trigger silently rewrites what
the client sent — and a client that believes it chose the token is the one state this column cannot
afford. `expires_at` is the same argument one step down: a client able to name it sets its own
ceiling. **This narrows the rule for secrets and does not replace it**: a
write-once stamp a grant cannot express — `012`'s `profiles.terms_accepted_at`, and `044` lines
48–65 on why — is still correctly a trigger.

#### Scenario: The token is withheld by the grant
- **WHEN** `information_schema.column_privileges` is read for `authenticated` on
  `public.ride_invite_links`
- **THEN** INSERT SHALL be held on `(id, ride_id, created_by)` only
- **AND** `token`, `expires_at`, `created_at` and `revoked_at` SHALL NOT appear

#### Scenario: Naming the column is refused, not ignored
- **WHEN** an insert names `token`
- **THEN** it SHALL fail with `42501` rather than silently taking the default

#### Scenario: A client-supplied value is overwritten rather than ignored
- **WHEN** a rider inserts a row naming a server-owned column with any value
- **THEN** the stored value SHALL be the server's
- **AND** the enforcement SHALL be a trigger or a withheld column grant, never the client
  omitting the column

#### Scenario: The trigger takes no caller input and is not callable
- **WHEN** the value is imposed by a trigger function
- **THEN** that function SHALL take no argument, SHALL derive the value from the server alone,
  and SHALL have EXECUTE revoked from `public`, `anon` and `authenticated`
- **AND** it SHALL therefore add no `authenticated_security_definer_function_executable` advisor
  finding

#### Scenario: Trigger firing order is stated rather than relied on by luck
- **WHEN** a table carries more than one `BEFORE INSERT` row trigger
- **THEN** the migration SHALL state that Postgres fires them in name order and SHALL say whether
  anything depends on it
- **AND** where nothing depends on it, that SHALL be written down rather than left as an
  unexamined coincidence

#### Scenario: An ordering column alone is not a total order
- **WHEN** rows are ordered by a timestamp
- **THEN** a deterministic tiebreak SHALL be part of the ordering, the index and any pagination
  cursor
- **AND** the three SHALL agree, so that a row cannot appear twice or vanish between pages

### Requirement: A table with no designed edit SHALL carry no UPDATE grant

Where editing a row has not been designed, the table SHALL have no UPDATE policy **and** no
UPDATE grant to `authenticated`.

The grant is the second, independent layer — the one that still holds if a future policy is
written too permissively. `009` applied this to `postcard_likes` and `blocks`, `011` to
`postcard_comments`, `postcard_hides` and `postcard_reports`, and each stated the same reason: a
table with no mutable column has nothing to grant UPDATE for. It is stated here as a rule rather
than repeated a sixth time in a migration comment.

**Editing is a design problem, not a permission one.** It means deciding whether "edited" is
disclosed, from when, and what the record of a conversation means once it can be rewritten. None
of that exists for any table in this schema.

**One designed mutation is the same answer, not an exception — `091`.** Where a table has exactly
one, that mutation SHALL be a `security definer` RPC and the table SHALL still carry no UPDATE
grant and no UPDATE policy for any client role. `public.ride_invite_links` has exactly one: revoke.
A column grant on `(revoked_at)` would let a client write NULL and **un-revoke** a link the
organizer killed, and would let them write a future timestamp.
`public.revoke_ride_invite_link` is therefore the only path, with one raise site so a caller learns
nothing about a link that is not theirs.

#### Scenario: Revoke is not reversible by a client
- **WHEN** any rider attempts to UPDATE `ride_invite_links` by any route
- **THEN** it SHALL be refused, asserted per grantee with `has_table_privilege` rather than by a
  grant-row count, since `postgres` and `service_role` hold everything by Supabase default

#### Scenario: Nobody can update a ride message
- **WHEN** any rider — including its author and the ride's organizer — attempts to UPDATE
  `ride_messages`
- **THEN** the write SHALL be refused
- **AND** both the absent policy and the absent grant SHALL be asserted, because either alone
  would be undone by a single future line

#### Scenario: An upsert against such a table uses do-nothing, not do-update
- **WHEN** a caller writes an upsert against a table with no UPDATE grant
- **THEN** it SHALL use `on conflict do nothing`
- **AND** `on conflict do update` SHALL be refused with `42501` rather than silently affecting
  nothing

#### Scenario: The absence is a recorded gap, not an accident
- **WHEN** a table is created with no UPDATE path
- **THEN** the migration SHALL say so explicitly
- **AND** the day editing is designed, adding the grant SHALL be understood as a deliberate
  widening rather than a one-line fix

### Requirement: A username SHALL NOT be removable once set

`public.profiles.username` SHALL be durable from the moment it first holds a value. Once
`username` is non-NULL, no write issued by the `authenticated` role SHALL be able to return it to
NULL, and the refusal SHALL come from the database rather than from the absence of a screen that
offers it.

**This is a live defect, not a risk this change introduces.** Reproduced on `letsride-dev`
2026-08-08 as `authenticated` with `request.jwt.claims.sub` set to the row's own id, inside a
transaction that was rolled back: `update public.profiles set username = null` succeeded and the
stored value became NULL. On production, `authenticated` holds column-level UPDATE on `username`
(`025` re-granted it per column), both CHECK constraints admit NULL by construction, and
`enforce_onboarding_completion` guards `terms_accepted_at` and `onboarding_completed_at` only.

**Why this is a visibility rule and not a data-hygiene one.** The `profiles` SELECT policy is
`(auth.uid() = id) OR (username IS NOT NULL AND NOT private.is_blocked(auth.uid(), id))`, so
username-nullness is the predicate that hides an unfinished signup from every other rider. A rider
who nulls their own username therefore removes their row from every other rider's read — bylines,
comment authors, member lists, ride crews and the availability check — while continuing to see it
themselves. `003` makes `onboarding_completed_at` one-way and requires a username to reach it, so
the resulting row is in a state onboarding declares impossible, and the route guard reads the
surviving completion stamp and sends the rider to `/postcards` rather than back into the wizard.
Decision #7 makes the username the only display name there is; there is no `full_name` to fall
back to.

The rule is **"once set, never unset"**, keyed on the username's own prior value rather than on
onboarding completion, so it also covers a rider who chose a name at step 1 and has not yet
finished step 2.

**The invariant is the stored value**: after any such write, `username` SHALL hold what it held
before. Whether the attempt is refused with an error or absorbed silently is an error-surface
choice, not part of this contract — `design.md` §D2 makes it and owns it.

#### Scenario: An onboarded rider cannot null their own username

- **WHEN** a rider whose `onboarding_completed_at` is set updates their own `profiles` row with
  `username` set to NULL, by any route including a direct PostgREST request
- **THEN** the stored `username` SHALL be unchanged
- **AND** the rider SHALL remain visible to every other signed-in, non-blocked rider, in
  postcard bylines, comment authors, club member lists and ride crews

#### Scenario: A rider mid-onboarding cannot null a username they have already chosen

- **WHEN** a rider whose `onboarding_completed_at` is NULL, and whose `username` is already set,
  updates their own row with `username` set to NULL
- **THEN** the stored `username` SHALL be unchanged
- **AND** the name SHALL remain unavailable to any other rider attempting to take it, enforced by
  the `profiles_username_lower_key` unique index rather than by what the availability check
  reports — so a name cannot be freed and re-taken by this route

#### Scenario: An upsert is not a second route into the column

- **WHEN** a rider issues a PostgREST upsert against their own row —
  `Prefer: resolution=merge-duplicates`, which compiles to `INSERT … ON CONFLICT DO UPDATE` —
  carrying `username` as NULL
- **THEN** the stored `username` SHALL be unchanged
- **AND** this SHALL be asserted rather than derived: `authenticated` holds INSERT on `username`
  and an INSERT policy exists, so the upsert is a genuine second client route into the column, and
  "the BEFORE UPDATE trigger fires for the DO UPDATE arm" is a two-step derivation that no test
  currently pins

#### Scenario: The legitimate first write is unaffected

- **WHEN** a rider whose `username` is NULL sets it to a valid value
- **THEN** the write SHALL succeed, unchanged from today
- **AND** onboarding step 1 SHALL remain an ordinary UPDATE against a column `authenticated`
  still holds, so no new function, grant or client change is required to complete it

#### Scenario: Completing onboarding still works

- **WHEN** a rider who has set a username calls `complete_onboarding(location)`
- **THEN** the stamp SHALL be written exactly as before
- **AND** the function's own username guard SHALL remain the thing that enforces "no completion
  without a username", because a `security definer` function runs as the owner and the trigger's
  `current_user <> 'authenticated'` gate short-circuits for it

#### Scenario: A security definer function is not covered and the gap is stated, not assumed

- **WHEN** any `security definer` function updates `profiles.username`
- **THEN** this requirement SHALL NOT be relied upon to stop it, because `current_user` inside
  such a function is the function's owner and the trigger returns early for any role that is not
  `authenticated`
- **AND** **six** functions reference `public.profiles` and every one of them is
  `security definer` — `private.may_participate`, `private.transfer_owned_clubs`,
  `public.accept_terms`, `public.complete_onboarding`, `public.handle_new_user`,
  `public.my_onboarding_state`. **Three of them write it** (`accept_terms`,
  `complete_onboarding`, `handle_new_user`); none writes `username`, which is why the gap is
  empty today rather than merely unexplored
- **AND** `public.handle_new_user` is the one to watch: it INSERTs the profile row at signup and
  deliberately leaves `username` NULL. Seeding a username there from OAuth or `user_metadata`
  would be a write this requirement does not reach, so that change SHALL carry the rule in its
  own body
- **AND** any future one SHALL restate the rule in its own body, the way `complete_onboarding`
  already restates `003`'s and `023`'s guards for the same reason

#### Scenario: Operator and service paths keep their escape hatch

- **WHEN** `service_role`, `postgres`, the seed, or the signup trigger writes `profiles.username`,
  including writing NULL
- **THEN** the write SHALL proceed, because the trigger's existing `current_user <> 'authenticated'`
  gate is preserved rather than narrowed
- **AND** this SHALL be deliberate: it is what keeps a rider stranded by any future defect
  repairable from the dashboard, and it is why this rule is not expressed as a CHECK constraint,
  which no role can pass

#### Scenario: Account deletion and club transfer are unaffected

- **WHEN** the account-deletion path runs — the `delete-account` Edge Function as `service_role`,
  and `private.transfer_owned_clubs` behind `031`'s wrapper
- **THEN** it SHALL behave exactly as `029`–`032` specify
- **AND** deletion SHALL remain a hard delete of the `auth.users` row cascading to `profiles`,
  not an anonymisation that blanks the username, so nothing in that path writes `username` at all

#### Scenario: An empty or whitespace-only username is already refused and stays refused

- **WHEN** a rider writes `''`, `'  '`, a two-character name, or a value containing a newline into
  `profiles.username`
- **THEN** the database SHALL reject the write with `23514`, unchanged from `003`
- **AND** this SHALL be enforced by `profiles_username_format`
  (`username IS NULL OR username ~ '^[A-Za-z0-9_]{3,25}$'` — `056` set the charset and `057` the
  25; `'^[a-z0-9_]{3,20}$'` when this requirement was written, and neither widening admits
  anything but capitals and five more characters), which admits
  neither the empty string nor whitespace nor an embedded newline — verified against the live
  constraint rather than assumed, because "NULL is the only hole" is only true if the empty string
  is genuinely closed

#### Scenario: Deleting the profile row is not an alternative route to invisibility

- **WHEN** a signed-in rider deletes their own `public.profiles` row
- **THEN** zero rows SHALL be deleted, because no DELETE policy on `profiles` exists
- **AND** this SHALL be asserted rather than assumed: `authenticated` holds a table-level DELETE
  **grant** (measured `true`), so the refusal today rests entirely on the absence of a policy, and
  an assertion is what stops a future permissive policy from reopening the hole this requirement
  closes

### Requirement: Every role's reach into a rider's identity SHALL be stated

Every role's reach into another rider's identity SHALL be stated and asserted, including the roles
that reach nothing.

**The signed-out visitor's reach is no longer uniformly zero, and the requirement SHALL say so.**
`anon` holds no grant on `public.profiles` and never will — that half is unchanged and stays measured
— but since `115` (PD-430) a signed-out caller holding a ride invite token can obtain **one rider's
username**: the organiser of the ride that token names, through
`public.ride_invite_link_public_preview`. A requirement about *every role's reach into identity* that
omits the app's only anonymous read is wrong by omission, which is precisely the failure mode this
capability exists to prevent.

**The boundary SHALL be the projection.** No other column of `profiles` — not the id, not the avatar
path, not `location`, `home_country`, `terms_accepted_at`, `onboarding_completed_at` or
`analytics_opt_out_at` — SHALL be reachable anonymously by any route, and the anonymous function SHALL
select exactly one column from `profiles`.

**No role SHALL gain the ability to write, clear or edit another rider's identity**, and this change
adds no writer of any kind: the anonymous path performs no INSERT, UPDATE or DELETE.

#### Scenario: The rider themselves

- **WHEN** a rider reads or writes their own `profiles` row
- **THEN** they SHALL read every column their grants permit, SHALL set `username` while it is
  NULL, SHALL change it to another valid value while Q1 remains unanswered, and SHALL NOT return
  it to NULL

#### Scenario: Any other signed-in rider

- **WHEN** a signed-in rider updates a `profiles` row that is not their own, setting `username` to
  NULL or to anything else
- **THEN** zero rows SHALL be affected, because the UPDATE policy is `auth.uid() = id`
- **AND** this SHALL hold irrespective of the new rule, which never widens who may write

#### Scenario: A blocked rider

- **WHEN** rider A blocks rider B, and B reads A's `profiles` row by any route
- **THEN** zero rows SHALL be returned, unchanged, and the same SHALL hold with A and B exchanged
- **AND** this change SHALL open no new inference channel. **One pre-existing channel is stated
  rather than denied**: `profiles_username_lower_key` is a plain unique index, so B attempting to
  take A's name gets `23505` and learns it exists, while `isUsernameTaken` reads under the
  block-aware SELECT policy and reports it free. That asymmetry predates this change, is unaltered
  by it, and is the reason the mid-onboarding scenario above is worded against the index rather
  than against the availability check
- **AND** a **signed-out** blocked rider holding a ride invite token is the one case this change
  changes: they reach the organiser's username through the anonymous preview, because no identity is
  available to filter on. It is the accepted residual recorded in `anonymous-ride-preview`, and it
  SHALL NOT be extended to any other column or any other rider
- **AND** their reach into *identity* SHALL remain exactly that one username however the ride
  projection grows — the ride's own fields, `meeting_point` included, are facts about a **ride** and
  SHALL NOT be read as widening this rule. `username` SHALL stay the only `profiles` column the
  anonymous function names

#### Scenario: Club owner, admin, member and non-member

- **WHEN** a rider holding any `club_members.role` — `owner`, `admin` or `member` — or holding no
  membership at all, reaches another rider's profile through a club roster, a ride crew, a postcard
  byline or Explore
- **THEN** they SHALL read exactly the columns the `profiles` SELECT policy already admits and SHALL
  write nothing
- **AND** no role SHALL gain the ability to clear, set or edit another rider's username; club role
  confers no authority over another rider's identity, and `club_members` has no UPDATE policy to
  change a role with in any case

#### Scenario: Signed-out visitor

- **WHEN** a request arrives with no session and names `public.profiles` directly, by any statement
- **THEN** zero rows SHALL be returned and zero rows written, because `anon` holds no grant on
  `profiles` — measured, `has_table_privilege('anon','public.profiles','SELECT')` is `false`
- **AND** that measurement SHALL be unchanged by `115`, which grants EXECUTE on a function and no
  privilege on any table

#### Scenario: Signed-out visitor holding a ride invite token

- **WHEN** a signed-out caller passes a live token to `public.ride_invite_link_public_preview`
- **THEN** exactly one rider's `username` — the organiser's — SHALL be returned, and no other column
  of `profiles` and no other rider SHALL be
- **AND** the same caller SHALL reach nothing further: the organiser's other rides, their clubs,
  their postcards and their profile SHALL all return zero rows

#### Scenario: The anonymous projection selects one identity column

- **WHEN** the anonymous function's return signature and body are read from the catalogue
- **THEN** `username` SHALL be the only `profiles` column it names
- **AND** the assertion SHALL be a catalogue read rather than an inspection of a returned row, since a
  row whose other values happen to be NULL cannot distinguish "not selected" from "empty"

#### Scenario: The route guard is not the enforcement

- **WHEN** any rule above is tested
- **THEN** it SHALL be asserted against the database as the role in question, never against a
  redirect, and never as the table owner — for whom neither a policy nor a grant exists

### Requirement: A table whose rows are addressed to a rider other than their writer SHALL grant no INSERT to any client role

Where a row's `user_id` names somebody other than the rider whose action created it, `authenticated`
SHALL hold **no INSERT grant** on that table and the table SHALL carry **no INSERT policy**. Its
only writer SHALL be a `security definer` trigger owned by the table owner.

Every other table in this schema pins its rows to their writer — `auth.uid() = user_id`,
`auth.uid() = author_id`, `auth.uid() = organizer_id` — and that pin is what makes a client-owned
mutation path safe. A notification inverts it: the row is *about* the actor and *addressed to*
somebody else, so no `with check` clause on `auth.uid()` can express its correctness. There is no
policy that both permits the write and forbids forging it, which is why the grant has to be absent
rather than the policy narrow.

#### Scenario: The grant is absent, not merely unused
- **WHEN** the table is created
- **THEN** `authenticated` SHALL hold no INSERT privilege on it
- **AND** the assertion SHALL name the role — `has_table_privilege('authenticated', …, 'INSERT')`
  — rather than attempting an insert, because the RLS suite runs as the **table owner**, for whom
  neither the grant nor RLS applies, so an attempted insert would succeed and prove nothing
- **AND** this SHALL be `031`'s lesson applied prospectively: the assertions that would have caught
  `029`'s uncallable function named a role rather than calling it

#### Scenario: A policy is not a substitute for the missing grant
- **WHEN** an INSERT policy is proposed for such a table
- **THEN** it SHALL be refused
- **AND** the reason SHALL be that a policy plus a grant is one over-permissive `with check` away
  from a forgeable row, while an absent grant fails closed regardless of what any future policy says

#### Scenario: The trigger's write is not a client write
- **WHEN** the `security definer` trigger inserts
- **THEN** it SHALL succeed notwithstanding the absent grant and the absent policy, because the
  function's owner owns the table and `relforcerowsecurity` is false on it
- **AND** that mechanism SHALL be stated in the migration, because it is the load-bearing reason
  the design works and it is invisible in the policy set

### Requirement: A derived row SHALL NOT hold a copy of a visibility decision

A row written as a consequence of another row SHALL store references, and SHALL NOT store a
denormalised copy of any text, name, title or count that a policy governs.

A stored copy is a visibility decision that nothing re-checks. It is correct at the instant it is
written, it is owned by its recipient, and it survives every event that would have withdrawn the
original — leaving the club, being removed, being blocked, the club turning private. The failure is
silent and permanent and looks correct to review, because the value really was true once.

#### Scenario: References, not copies
- **WHEN** a derived table is designed
- **THEN** it SHALL carry foreign keys to what it describes
- **AND** it SHALL NOT carry a name, title, caption, username or body copied from them

#### Scenario: The reader's own policy decides what resolves
- **WHEN** a derived row is read
- **THEN** the resources it references SHALL be read under the reader's own row security at that
  moment
- **AND** a row whose references do not resolve SHALL NOT be returned

#### Scenario: A count is not a copy either
- **WHEN** a count over a policy-governed table is needed
- **THEN** it SHALL be computed under the reader's row security rather than denormalised onto a row
- **AND** this SHALL match the existing decision that `postcard_likes` and `postcard_comments` carry
  no denormalised count, because the correct count is per-viewer

### Requirement: A trigger that must run for every writer SHALL NOT be gated on `current_user`, and one that must skip privileged writers SHALL

Whether a trigger carries a `current_user` guard SHALL be a stated decision recorded at the trigger,
because both shapes exist in this schema, both are correct where they are, and copying the wrong one
fails silently in opposite directions.

Inside a `SECURITY DEFINER` function `current_user` is the **owner**, not `authenticated` — measured
on Postgres 16, and the reason `003`'s and `012`'s guards short-circuit when reached from
`accept_terms()` or `complete_onboarding()`. The nine `enforce_participation_gate` triggers use
`WHEN (CURRENT_USER = 'authenticated')` deliberately, so a privileged path is not refused by a gate
meant for riders. A fan-out trigger needs the opposite: it must fire for every writer, because a
notification that silently does not happen for a seed, a maintenance write or a future RPC is a gap
with nothing to detect it.

#### Scenario: The gate skips privileged writers, by design
- **WHEN** a `security definer` function or the table owner writes to a gated table
- **THEN** `enforce_participation_gate` SHALL NOT refuse it
- **AND** this SHALL remain the behaviour, because the alternative refuses the app's own accessors

#### Scenario: A fan-out fires for every writer, by design
- **WHEN** any writer — client, seed, owner, or a `security definer` function — inserts a row that
  should produce a derived row
- **THEN** the derived row SHALL be written
- **AND** the trigger SHALL carry no `WHEN (CURRENT_USER = …)` clause and its function SHALL contain
  no `current_user` branch

#### Scenario: The choice is recorded where it is made
- **WHEN** a trigger is added
- **THEN** its migration SHALL state which of the two shapes it uses and why
- **AND** the absence of a guard SHALL be as explicitly recorded as its presence, because an absent
  guard is indistinguishable from a forgotten one

### Requirement: A policy restated for a candidate SHALL be changed in lockstep with the policy, and the two SHALL share one body where they can

Where a `security definer` function restates a row-security policy so that it can be evaluated for a
rider other than the caller, the restatement SHALL be treated as part of the policy. A change to
either SHALL change both, in the same migration.

Where the restated predicate is a **helper**, the caller-relative and candidate-relative forms SHALL
be **one body with two entry points**: the caller-relative wrapper's `prosrc` SHALL be exactly a
delegation passing `auth.uid()` as the candidate, and the candidate-relative body SHALL mention
`auth.uid()` nowhere. Two independently-written bodies SHALL NOT be accepted, however similar.

Both SHALL be pinned by **equality** in the RLS suite, never by `like`. A substring match is
satisfied by the mention alone, so an arm added to the wrapper and not to the body passes it while
leaving the restatement silently narrower than the policy — with the policy's own pinned qual
unchanged, so that assertion does not fire either.

#### Scenario: A wrapper that grows an arm is caught
- **WHEN** an arm is added to a caller-relative wrapper and not to the shared body
- **THEN** the equality pin on the wrapper's `prosrc` SHALL fail
- **AND** a `like` assertion naming the shared body SHALL be recorded as insufficient, because it
  passes in exactly this case

#### Scenario: The restatement is verified by agreement, not only by text
- **WHEN** the suite verifies a candidate-relative restatement
- **THEN** it SHALL assert that the policy and the restatement return the same answer for each named
  role the policy enumerates
- **AND** the text pin and the agreement assertion SHALL both exist, because the first catches a
  rewrite and the second catches a rewrite that is textually different and semantically wrong

#### Scenario: The candidate-relative form is reachable by no client role
- **WHEN** grants on a candidate-relative visibility helper are examined
- **THEN** `authenticated` and `anon` SHALL hold no `execute`, because such a function answers
  questions about other riders and is therefore a block oracle
- **AND** only the caller-relative wrapper SHALL be granted, because an RLS expression is evaluated
  as the querying role

### Requirement: A status column SHALL NOT be a copy of a fact another table owns

Where a column records an answer, a decision or a state, it SHALL NOT be maintained as a mirror of a
row in another table. The other table SHALL be read live at the point the answer is rendered.

A trigger SHALL NOT be hung on an existing, already-shipped write path in order to keep such a
mirror in step. That is `036`'s hand-exercise hazard — new code inside every rider's own transaction
on a live path, where a raise takes their write down — spent on maintaining a duplicate.

#### Scenario: An invite's status answers the invitation, not the membership
- **WHEN** a rider joins a ride by a route other than answering their invite
- **THEN** the invite's `status` SHALL remain unchanged
- **AND** the surface SHALL render their membership by reading the crew, not by reading the status

#### Scenario: No trigger is added to the crew table
- **WHEN** the triggers on `public.ride_members` are examined after the migration
- **THEN** they SHALL be exactly those that existed before it

### Requirement: A privileged object SHALL NOT be created in `public` and revoked afterwards

Any database object whose audience is the project owner alone SHALL be created in the `private`
schema. It SHALL NOT be created in `public` and then have its privileges revoked.

The two are not equivalent, and the difference is measurable rather than stylistic. Measured on
DEV 2026-08-24 in a rolled-back transaction: a view created in `public` by a migration running
as `postgres` is born with
`{postgres=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}`, because
`pg_default_acl` carries two default-privilege entries for that schema. The same view created in
`private` is born with `relacl = NULL` — the owner and nobody else, because `pg_default_acl`
holds no entry for `private` at all. `anon` and `authenticated` additionally hold no USAGE on
`private`, and PostgREST routes only to `public`.

So a `public` object is published the instant it is created and unpublished only if someone
remembers the revoke, in the right migration, before it merges; a `private` object is
unreachable by construction. The failure mode of the first is silent, ships green, and is
invisible to CI, the RLS suite and the OpenSpec workflow alike.

The explicit `revoke all … from anon, authenticated, service_role` SHALL still be written on
every such object, as the second independent layer — the one that survives a future change to
default privileges on `private`.

#### Scenario: An owner-only view is unreachable by every client role
- **WHEN** a view intended for the project owner is created
- **THEN** it SHALL be in `private`
- **AND** `anon`, `authenticated` and `service_role` SHALL each hold no SELECT privilege on it
- **AND** no PostgREST route SHALL resolve to it

#### Scenario: The revoke is written even where the grant never existed
- **WHEN** an owner-only object is created in `private`
- **THEN** the migration SHALL still name `revoke all … from anon, authenticated, service_role`
- **AND** the redundancy SHALL be explained in the migration rather than left to look like an
  oversight

#### Scenario: `service_role` is named explicitly wherever an object is locked down
- **WHEN** a migration revokes privileges to make an object owner-only
- **THEN** the revoke SHALL name `service_role` alongside `anon` and `authenticated`
- **AND** the migration SHALL NOT assume Supabase's defaults exclude it, because they do not

### Requirement: A `security definer` function SHALL be justified by a caller who cannot do the work themselves

`security definer` SHALL be used only where the calling role genuinely cannot perform the
operation under its own privileges — the shape `private.is_blocked` and
`public.moderate_comment` both have, where a rider must act on a row RLS forbids them to read.

A function whose only caller is the database owner SHALL be `security invoker`. The owner
already holds `BYPASSRLS` and owns the tables, so `security definer` there buys nothing and
leaves a standing escalation that becomes live the moment its EXECUTE grant widens.

This is also what keeps the security-advisor surface honest:
`authenticated_security_definer_function_executable` fires on a `security definer` function
executable by `authenticated`, and the eight existing WARNs are each a deliberate instance of
the justified shape. A ninth with no rider caller would be noise in the one list a session uses
to tell an expected advisor from a new one.

#### Scenario: An owner-only privileged operation adds no advisor
- **WHEN** a function reachable only by the database owner is added
- **THEN** it SHALL be `security invoker`
- **AND** the change SHALL add no `authenticated_security_definer_function_executable` advisor
- **AND** the advisor count SHALL be re-derived with `get_advisors(security)` after applying,
  never read off a document

#### Scenario: A narrow privileged removal names one table and one row
- **WHEN** a function exists to remove a single row on the owner's behalf
- **THEN** it SHALL accept an identifier and no predicate
- **AND** it SHALL name exactly one table in its `delete`
- **AND** rows removed alongside it SHALL be removed by declared cascades, not by further
  statements in the function body

### Requirement: A revoke SHALL be verified where its ground truth actually lives

`supabase/tests/` runs on plain Postgres as the table owner, and `harness.sql` deliberately
grants `service_role` no table privileges — so `has_table_privilege('service_role', …)` reads
`false` locally by construction and `true` on the hosted project. An assertion made there passes
for an environment reason rather than the intended one, which is the same class of defect as
`031`'s uncallable function passing a suite that ran as the owner.

Every privilege claim in a migration SHALL therefore be assigned to the layer that can actually
falsify it: `anon` and `authenticated` claims to the local suite, `service_role` and PostgREST
claims to a verification step run against the hosted project after applying.

Where the local suite asserts the *absence* of a privilege, it SHALL also prove the harness
would have granted it — the anti-vacuity probe `047` introduced.

#### Scenario: An `authenticated` refusal is asserted locally and provably non-vacuous
- **WHEN** the suite asserts that `authenticated` cannot read a new object
- **THEN** it SHALL also create a throwaway object of the same kind in `public`, assert that
  `authenticated` inherits the privilege on it from the reproduced Supabase default, and drop it
- **AND** without that probe the refusal assertion SHALL be treated as unproven

#### Scenario: A `service_role` refusal is verified against the hosted project
- **WHEN** a migration revokes or withholds a privilege from `service_role`
- **THEN** the migration SHALL carry a verification step naming the query to run against the
  hosted project
- **AND** the local suite SHALL NOT assert it, and SHALL say why in a comment

#### Scenario: A referential cascade is proven not to depend on the revoked grant
- **WHEN** a grant is revoked from a role that a cascade path passes through
- **THEN** the suite SHALL exercise the cascade end to end after the revoke
- **AND** SHALL NOT reason about referential actions in a comment instead

### Requirement: A column added to a table whose grants are an absolute allowlist SHALL state its grant decision explicitly

Six migrations in this repo replaced a table-level grant with an **absolute** `revoke` plus an
explicit column allowlist, because a bare `revoke select (col)` against a table-level grant is a
documented no-op (`025` §DEFECT 1). On such a table, **a column added later is invisible to
`authenticated` until somebody names it**, and a column named later is visible to everyone the
row policy admits.

Every migration adding a column to one of those tables SHALL state, in the file, which of the three
lists the column joins and why — including when the answer is "none of them". Silence is not a
decision; it is `025`'s standing cost collecting.

Two further rules follow, and the second is the one this repo has already been bitten by:

- **A migration that needs to widen an allowlist SHALL issue a bare additive `grant` naming only
  the new column.** It SHALL NOT restate the list.
- **If a migration ever must restate one, it SHALL carry the full current list plus its addition.**
  `044` and `046` are the worked example and they fail SILENTLY: both issue an absolute `revoke
  update` + `grant update (…)` rather than a delta, and `044`'s list still names `id` and
  `author_id`, so running `046` first reinstates exactly what `046` removed with no error and
  nothing red (`docs/reference/migrations.md` §The ordering chain).

**The set of affected tables SHALL be re-derived, never read off a list.** That reference's own
table names six tables and its own re-derive query returns **20** on DEV as of 2026-09-01,
`profiles` and `feedback` among them:

```sql
select c.relname, count(*) filter (where a.attacl is not null) as columns_with_acl
from pg_class c join pg_attribute a on a.attrelid = c.oid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0
group by 1 having count(*) filter (where a.attacl is not null) > 0 order by 1;
```

#### Scenario: A new column on `profiles` states its grant decision
- **WHEN** a migration adds a column to `public.profiles`
- **THEN** the file SHALL say whether the column joins `025`'s SELECT, INSERT and UPDATE lists, and
  why
- **AND** if it joins none, the file SHALL name the accessor through which the client reaches it
  instead, or state that no client reaches it at all

#### Scenario: Widening an allowlist does not restate it
- **WHEN** a migration grants a client role a privilege on a new column of such a table
- **THEN** the statement SHALL name only that column
- **AND** the privileges the table already had SHALL be unchanged afterwards, verified by
  `has_column_privilege` per column rather than by reading the migration

#### Scenario: A column with no grant is invisible rather than broken
- **GIVEN** a column on `profiles` in none of `025`'s three lists
- **WHEN** any code path reads the caller's own profile row
- **THEN** it SHALL use an explicit projection that omits the column, never `select('*')`
- **AND** adding the column to `OWN_PROFILE_COLUMNS`, `PUBLIC_PROFILE_COLUMNS` or
  `VIEWED_PROFILE_COLUMNS` SHALL turn the reading screen into a `42501` on the error boundary —
  which is `025` §DEFECT 2d and is a build error, not a leak

### Requirement: A rider's preference SHALL NOT become an authorization gate

A column recording what a rider *wants* SHALL NOT be read by any policy, CHECK, grant or trigger
that decides what a rider *may do*. The moment it is, a preference has become a permission and a
rider who expresses one gets a degraded app they never asked for.

The distinction is not stylistic. This repo's gates — `023`'s participation gate, `019`'s role
rules, the block helper — all answer "is this rider allowed". A preference answers "what did this
rider choose", and the two have different failure directions: a wrong gate refuses a legitimate
write, a wrong preference produces slightly wrong data.

The one shape that is permitted is a trigger that **normalises a column and never refuses a row**.

#### Scenario: A preference is not tested by anything that can refuse
- **WHEN** the objects reading a preference column are enumerated
- **THEN** none SHALL be a policy `using`/`with check` clause, a CHECK constraint, or a trigger with
  a `raise` reachable from that read
- **AND** any trigger that does read it SHALL only ever assign to a column of `NEW`

#### Scenario: A rider who expresses a preference loses no capability
- **GIVEN** two riders identical but for the preference
- **WHEN** each performs every write path the app offers
- **THEN** the outcomes SHALL be identical, row for row, error for error

### Requirement: A grandchild table SHALL restate its grandparent's audience rather than inherit it through one hop

Where a table hangs off a child that itself narrows its parent — a message on a thread inside a
club — its SELECT policy SHALL express the **full** audience, not merely an `EXISTS` against the
intermediate row.

An `EXISTS` against the intermediate table evaluated under the caller's row security does compose
correctly today, because the intermediate's own policy runs. But the cost of relying on that is
that the grandchild's audience becomes undiscoverable from its own policy text, and a later change
to the intermediate silently retargets it. The two-hop chain SHALL be written out.

#### Scenario: A message's policy names the club, not only the thread
- **WHEN** the SELECT policy for messages inside a club thread is written
- **THEN** it SHALL contain the club-visibility `EXISTS`, the club-membership predicate, and the
  message's own block arm
- **AND** it SHALL NOT be reduced to a bare `EXISTS` against the thread on the grounds that the
  thread's own policy already decides it

#### Scenario: Each hop is asserted independently
- **WHEN** assertions are written for the grandchild
- **THEN** a rider refused by club visibility, a rider refused by club membership, and a rider
  refused by the block arm SHALL each be asserted as a separate case

### Requirement: A coordinate SHALL name the writer that produced it, and a rider's own value SHALL outrank a derived one

Where two writers can produce the same column — a rider choosing a value, and a background process
deriving one — the schema SHALL make the two distinguishable, and the rider's value SHALL win.

The marker SHALL be structural: columns that are present only on one arm, tied together by a CHECK
that makes the arms mutually exclusive. It SHALL NOT be a separate source enum, which is a second
statement of the same fact and free to disagree with the columns it labels.

Precedence SHALL be enforced by a trigger or a policy in Postgres, and SHALL NOT rest on the derived
writer declining to write. This repo's derived writers are Edge Functions: `tsconfig.json` excludes
`supabase/functions`, deploying is an owner action with no CI path, and `031` is the standing lesson
that an assumption about what a non-client role can reach goes unnoticed because the RLS suite runs
as the table owner. A precedence rule living only in a function is a rule one unreviewed deploy can
remove, silently, in the direction that stores a plausible wrong value.

The enforcement SHALL clear or restore rather than raise, wherever the write it guards is an
enrichment on a path the rider is already on. A raise there aborts a write the rider asked for
because of a value they did not.

**Where the derived writer runs as the rider's own role, the derived arm is self-asserted, and the
spec SHALL say so rather than claim a guarantee.** A client that holds the grant the derived writer
needs can write the derived arm by hand, and no CHECK can tell who issued a statement. The chosen
arm SHALL still be protected — a trigger can refuse to let it move — so the asymmetry is: *"this row
was chosen"* is enforced, *"this row was derived"* is a claim. Closing the second half requires
taking the grant away and giving the derived writer a `security definer` path instead, which is a
**destructive** change and SHALL be sequenced after that writer is deployed, per the additive-first
rule `021`/`025` established.

#### Scenario: The row says which writer produced its value
- **WHEN** any row carrying a derived-or-chosen value is read
- **THEN** the writer SHALL be determinable from the columns of that row alone
- **AND** a combination claiming both writers, or a value claiming neither, SHALL be refused by CHECK

#### Scenario: The chosen arm cannot be forged over, and the derived arm can be forged into
- **WHEN** a rider hand-writes the derived arm onto a row that carries a chosen value
- **THEN** the trigger SHALL restore the chosen value, so the claim SHALL NOT stand
- **AND WHEN** a rider hand-writes the derived arm onto a row that carries neither
- **THEN** it SHALL be accepted while the client holds the grant, and the spec SHALL record that as a
  stated gap rather than assert a provenance guarantee the grants do not support

#### Scenario: The derived writer cannot overwrite the chosen one
- **WHEN** the derived writer updates the value on a row that already carries a rider's chosen one
- **THEN** the stored value SHALL remain the rider's
- **AND** any artifact derived from the rejected value SHALL be cleared in the same statement
- **AND** the statement SHALL NOT raise

#### Scenario: The rule is asserted against a role, not against a function
- **WHEN** the RLS suite covers this
- **THEN** it SHALL assert the stored outcome of a write issued as the caller, not the behaviour of
  the function that would normally issue it

### Requirement: A clearing trigger SHALL state which values it clears, and SHALL decide from `OLD` and `NEW` alone

A `BEFORE UPDATE` trigger that assigns `NEW.<column> := NULL` overwrites whatever the statement
supplied for that column. That is the correct behaviour for a value the statement could only be
carrying by accident — a stale derived path — and the wrong behaviour for a value the statement is
deliberately supplying in the same breath as the change that fires the trigger. A clearing trigger
SHALL say, in its own comment, which of the two it means for each column it touches.

**"Supplied by this statement" is not decidable and SHALL NOT be written as if it were.** Postgres
gives a `BEFORE` trigger no way to see the `SET` list: `NEW` carries the old value for an omitted
column, so an omission and a repetition of the stored value are the same input. The decision SHALL
therefore be made from a *difference* between `OLD` and `NEW` — which is a proxy for supply, not the
thing itself — and the trigger SHALL be designed so that the proxy fails in the clearing direction.

It SHALL NOT depend on the client sending every column of the group, because the client owns the
mutation path and a hand-rolled request that omits a column is indistinguishable from one that
never had it.

**Measured, because the obvious verification misses it.** Reading the trigger definition says it
fires on a change to one column; it does not say that a value written for a *different* column in
the same statement is discarded, and no amount of reading the `WHEN` clause reveals it. On DEV 2026-08-18, inside a rolled-back transaction, an UPDATE
setting `rides.meeting_point`, `latitude`, `longitude` and `geocode_confidence` together returned the
new meeting point and three NULLs. A test that writes the columns in two statements passes and proves
nothing, because it is the single-statement case that the feature needs.

#### Scenario: A value that differs from the stored one survives
- **WHEN** one statement changes the column the trigger watches and carries a value for the cleared
  group that differs from what the row holds
- **THEN** the differing value SHALL be stored, because `OLD` and `NEW` can tell it apart from the
  stored one
- **AND** anything derived from the superseded value SHALL still be cleared

#### Scenario: An omitted group is cleared, not kept
- **WHEN** one statement changes the watched column and omits the group entirely
- **THEN** the whole group SHALL be cleared, because `NEW` carries the old values and keeping them
  would preserve a value the row can no longer be said to hold

#### Scenario: A repeated value is cleared, like an omitted one
- **WHEN** a hand-rolled client repeats the row's existing group values alongside a changed watched
  column
- **THEN** the group SHALL be cleared — the proxy cannot distinguish that from an omission, and the
  direction it fails in SHALL be the clearing one

#### Scenario: The single-statement case is asserted
- **WHEN** the RLS suite covers a clearing trigger
- **THEN** at least one assertion SHALL write the watched column and the cleared group in the **same**
  statement

### Requirement: An owner-membership row SHALL be removable only by transfer or by the club's deletion

For every row in `public.clubs`, the `public.club_members` row whose `user_id` equals that club's
`owner_id` SHALL NOT be deletable by any client role. The database SHALL permit its removal in
exactly two circumstances: the parent `clubs` row no longer exists, or the caller is not
`authenticated` — which is the elevated ownership transfer and the account-deletion cascade.

**This is a live gap, not a risk the change introduces.** `club_members` DELETE is
`auth.uid() = user_id` with no owner exception, read from `pg_policy` on 2026-08-31 rather than
recalled, and `leaveClub` deletes unconditionally. The rule that stops an owner leaving today is a
`{isOwner ? … : …}` ternary in `ClubOptionsMenu`, which is the weaker of the two places by this
repo's own standing rule — so the state is reachable by a hand-rolled request against the publishable
key that already ships in the bundle.

The refusal SHALL be `check_violation` (`23514`), never `insufficient_privilege`, so that an
assertion cannot pass by accepting an ordinary RLS denial.

The rule SHALL key on `clubs.owner_id` and SHALL NOT key on `club_members.role`. Those are two
different answers to "who owns this club" and they are permitted to disagree: `054` exists because
they did, and `088`'s `promote_club_member` carries an explicit arm for the owner whose roster row
says `member`.

#### Scenario: The owner cannot delete their own roster row
- **WHEN** the rider named in `clubs.owner_id` deletes their own `club_members` row, whether through
  `leaveClub` or directly against PostgREST with the publishable key
- **THEN** the database SHALL reject the delete with `23514`
- **AND** the refusal SHALL NOT depend on any component hiding a control

#### Scenario: An ordinary member can still leave
- **WHEN** a rider who is not the club's `owner_id` deletes their own `club_members` row
- **THEN** the delete SHALL succeed, at every role the roster admits — `member` and `admin` alike
- **AND** it SHALL succeed for a club that is public and for one that is private

#### Scenario: Deleting the club still cascades
- **WHEN** the owner deletes the club through `public.delete_owned_club`
- **THEN** the cascade into `club_members` SHALL succeed, because the guard permits a delete whose
  parent `clubs` row no longer exists
- **AND** the `clubs` DELETE policy SHALL be unchanged

#### Scenario: The parent-is-gone test answers existence, not visibility
- **WHEN** the guard tests whether the parent `clubs` row still exists
- **THEN** it SHALL do so with row-level security out of the way
- **AND** a version that ran the test under the caller's own RLS SHALL be treated as a defect, because
  "the club is invisible to me" and "the club does not exist" would be the same empty result and the
  guard's answer to the second is to **permit** the delete — a guard that fails open

#### Scenario: The elevated transfer passes through
- **WHEN** a caller whose `current_user` is not `authenticated` deletes the departing owner's roster
  row — the voluntary-leave transfer, or the account-deletion cascade
- **THEN** the delete SHALL succeed
- **AND** this SHALL remain true, so that account deletion can transfer a club rather than cascade it
  and destroy every other member's postcards

#### Scenario: A club whose owner holds no roster row is unaffected
- **WHEN** the guard evaluates for a club in the state `054` made survivable — `clubs.owner_id` set,
  no matching `club_members` row
- **THEN** nothing SHALL be refused, because there is no row to guard
- **AND** that owner SHALL still be able to leave through the transfer, which deletes zero roster rows
  and succeeds

### Requirement: An owner SHALL leave their club only through an elevated operation that names no rider

An owner's departure SHALL be performed by a `security definer` function that takes a **club and
nothing else** — no rider id, no successor id, no role argument, and no mode or confirmation flag.
Every rider it writes SHALL be derived by the database from the club's own roster.

`authenticated` cannot reach the writes this needs by any client route, and the three barriers are
each load-bearing elsewhere: `owner_id` is absent from `authenticated`'s UPDATE **column grant** on
`clubs` (`045`), so a client transfer fails `42501` before any policy is evaluated; `clubs` UPDATE
carries `with check (auth.uid() = owner_id)`, which is also what stops a rider dumping a club on an
unwilling stranger; and `club_members` has no UPDATE policy at all, which `036` §7.6 relies on.
Widening any of the three would widen it for every other purpose.

Taking no rider id is what preserves `019`'s property that `admin` is claimable by no client, and its
corollary that **`owner` is nameable by no client**: there is no argument through which a caller could
propose a successor, so the negative case "handed the club to somebody of my choosing" is
**unrepresentable** rather than merely refused. This is `085`'s *"no input by which to attempt it"* and
`088`'s two-verbs-no-role-argument shape, applied to a third write path.

#### Scenario: There is no successor to pass, so a successor cannot be passed
- **WHEN** the function's signature is read from `pg_proc`
- **THEN** it SHALL accept exactly one `uuid` and nothing else
- **AND** the rider it promotes SHALL be selected by a `private` function from `club_members`

#### Scenario: A rider cannot leave somebody else's club
- **WHEN** any rider calls it for a club whose `owner_id` is not them, including a club that does not
  exist and a club they are merely an admin of
- **THEN** it SHALL raise `insufficient_privilege` from **one** site, so the caller learns nothing
  about a club they do not own, including whether it exists
- **AND** the ownership re-check inside the body SHALL be the entire access control, because RLS does
  not apply inside a definer function

#### Scenario: The transfer is one statement or it did not happen
- **WHEN** the ownership move, the successor's promotion and the leaver's removal are performed
- **THEN** all three SHALL commit together or none SHALL
- **AND** no state in which `clubs.owner_id` and the roster's `owner` row name different riders SHALL
  be reachable through this path

#### Scenario: It adds exactly one executable elevated surface
- **WHEN** the security advisors are read after the migration applies
- **THEN** exactly **one** new `authenticated_security_definer_function_executable` SHALL appear,
  taking the total from 24 to 25
- **AND** the successor selector and the delete guard SHALL add none, because both live in `private`,
  which grants no USAGE to any client role and which PostgREST does not publish

#### Scenario: The participation gate is not silently walked around
- **WHEN** the transfer updates `clubs` and `club_members`
- **THEN** `enforce_participation_gate` SHALL not fire, and the reason SHALL be asserted rather than
  assumed: it is a **BEFORE INSERT** trigger on both tables and these are UPDATEs, and its
  `WHEN (current_user = 'authenticated')` clause is false inside a definer body in any case
- **AND** a rider who has not accepted the terms SHALL still be unable to own a club at all, because
  the gate refused their `clubs` insert

### Requirement: A rider action described as leaving SHALL NOT be capable of deleting a club

No operation a rider invokes as "leave" SHALL delete a club, under any state of the roster, any
staleness of the client's cache, and any blocking relationship. Deletion SHALL be reachable only
through a confirmation that states what it destroys, and SHALL run through the single existing
club-deletion path.

**The failure this forbids is reachable from an ordinary stale cache with no blocking involved.** A
client decides which affordance to draw from a roster count that is cached and is read under RLS. If
one function performed both the transfer and the deletion, a count that was correct a minute ago
would let a tap on *Leave club* destroy a club and every postcard in it, having promised nothing of
the kind.

#### Scenario: A leave against a club with no successor refuses rather than deletes
- **WHEN** the leave operation is called for a club with no other admin — whether it has other members
  or none at all
- **THEN** it SHALL raise `check_violation` and SHALL delete nothing
- **AND** the club, its roster, its postcards, its rides and its threads SHALL be unchanged

#### Scenario: Deletion goes through the one existing path
- **WHEN** a club is deleted as the outcome of an owner choosing to leave
- **THEN** it SHALL run through `public.delete_owned_club`, inheriting its ownership re-check, its
  `is_default` refusal, its rule that only `is_public = false` rides go with the club, and its return
  of the club's Storage paths
- **AND** no second deletion route SHALL exist

#### Scenario: The confirmation states what a deletion destroys, and the counts are floors
- **WHEN** the confirmation is shown to an owner who is the only rider on the roster
- **THEN** it SHALL show the same counts the existing club-deletion confirmation shows, phrased as
  floors
- **AND** it SHALL NOT imply that an empty roster means no other rider's content is at stake — a rider
  can join a public club, post a postcard and leave, and nothing removes what they posted

### Requirement: Succession SHALL be decided by the database, deterministically, and SHALL NOT be filtered by blocking

The successor SHALL be chosen by SQL from stored columns: the `club_members` row with
`role = 'admin'` and `user_id <> clubs.owner_id`, ordered by `joined_at` ascending and tie-broken by
`user_id`. The selection SHALL NOT consider `blocks` in either direction, and SHALL NOT be
influenced by any value the caller supplies.

**Blocking is excluded deliberately and the negative case is the argument.** Blocking is symmetric
even though the row is directional, so an admin who blocked their club's owner would remove
themselves from a block-filtered candidate set — dropping the club to "no successor" and leaving the
owner with no exit but destroying a club full of other riders' postcards. A rule an adversary can
trigger by tapping Block is not a rule. The existing account-deletion succession also ignores blocks
and must, having no viewer at all; filtering here would make a club inherit differently depending on
*why* its owner left.

#### Scenario: The same roster always yields the same successor
- **WHEN** the selection runs twice against an unchanged roster, including one holding two admins who
  share a `joined_at`
- **THEN** it SHALL return the same rider both times

#### Scenario: A blocked admin can still inherit
- **WHEN** the club's only other admin has blocked the owner, or the owner has blocked them
- **THEN** the transfer SHALL succeed and that admin SHALL become `clubs.owner_id`
- **AND** the result SHALL be identical in both block directions
- **AND** no screen SHALL name the successor to the departing owner, because a per-viewer read of that
  rider returns nothing and a privileged one would disclose a rider a block is hiding

#### Scenario: A member is never a successor
- **WHEN** the club holds other riders but none at `role = 'admin'`
- **THEN** the selection SHALL return nothing and the leave SHALL be refused
- **AND** this SHALL differ deliberately from the account-deletion succession, which falls back to
  the longest-tenured member because it has nobody to ask and its alternative is destroying the club

#### Scenario: A stray second owner row is never picked
- **WHEN** the roster somehow holds a row with `role = 'owner'` for a rider who is not
  `clubs.owner_id`
- **THEN** the selection SHALL NOT return them, because it filters to `role = 'admin'`

#### Scenario: The two succession rules order identically where their candidate sets coincide
- **WHEN** both the voluntary-leave selector and the account-deletion selector run against a roster
  whose non-owner members are all admins
- **THEN** they SHALL name the same rider
- **AND** this SHALL be asserted rather than guaranteed by extraction, because the two rules
  deliberately differ in candidate set and unifying them behind a flag would put a product decision
  inside a boolean

### Requirement: The default club SHALL NOT be left, transferred by a rider, or deleted

The club carrying `clubs.is_default` SHALL refuse the voluntary-leave operation with
`insufficient_privilege`, in addition to the deletion refusal it already carries.

`058` joins every rider to that club on completing onboarding, so it always has members and can never
reach the account-deletion succession's "nobody left, delete it" arm — it transfers, to whichever
rider joined earliest. `059` recorded the consequence as a known gap: an ordinary rider holding
rename and imagery rights over the club everyone is in, **reachable only by that club's owner deleting
their account**. A voluntary leave has the option an account deletion does not — the owner can simply
stay — so without this refusal the gap would move from "reachable by erasing your account" to "one tap
in the club menu", silently.

The refusal MAY name its reason, because `authenticated` holds SELECT on `clubs.is_default` and the
caller can already read it — so nothing is disclosed by saying so.

#### Scenario: The welcome club's owner cannot leave it
- **WHEN** the rider named in `clubs.owner_id` for the club carrying `is_default` calls the leave
  operation
- **THEN** it SHALL raise `insufficient_privilege`
- **AND** it SHALL do so whether or not that club has another admin

#### Scenario: The welcome club's owner cannot delete it either
- **WHEN** they reach the deletion path instead
- **THEN** it SHALL raise, unchanged from `059`

#### Scenario: Unflagging is the only route, and it is not a client's
- **WHEN** `clubs.is_default` is cleared
- **THEN** the club SHALL become leavable and deletable like any other
- **AND** no client role SHALL hold INSERT or UPDATE on that column, so clearing it requires database
  access

### Requirement: Every role's reach into a club whose ownership has moved SHALL be stated

A transfer SHALL change exactly `clubs.owner_id`, the successor's `club_members.role`, the departing
owner's roster row, and the club's two image paths. Every audience predicate SHALL re-resolve from
those columns, and no SELECT policy SHALL change.

Stated role by role so each line maps onto an assertion, and so "the visibility layer is untouched"
is a checked claim rather than an assumption.

#### Scenario: The departing owner
- **WHEN** the transfer commits
- **THEN** they SHALL hold no `club_members` row and SHALL NOT be `clubs.owner_id`
- **AND** for a **private** club they SHALL read nothing of it — not the club, its roster, its rides,
  its postcards, its threads or its messages — including postcards and threads they wrote themselves
- **AND** for a **public** club they SHALL read it as any signed-in non-member does
- **AND** their postcards, their rides and their `ride_members` rows SHALL all survive, and their
  `feed_reads` watermark SHALL survive, because `feed_reads` cascades from `clubs` and `profiles` and
  never from `club_members`

#### Scenario: The successor
- **WHEN** the transfer commits
- **THEN** they SHALL be `clubs.owner_id` with `role = 'owner'`, and both SHALL be true in the same
  statement
- **AND** they SHALL reach everything an owner reaches: the edit and delete paths, `081`'s thread
  moderation and own-message deletion, `088`'s three rider-management RPCs including over other
  admins, and `085`'s join-request approval
- **AND** their `joined_at` SHALL be unchanged, so the roster's tenure order is not rewritten by a
  transfer

#### Scenario: A remaining admin who was not chosen
- **WHEN** the transfer commits
- **THEN** their role and reach SHALL be unchanged
- **AND** they SHALL NOT be able to remove or demote the new owner, which `088` already refuses

#### Scenario: A remaining member
- **THEN** their reach SHALL be unchanged, and the club SHALL be indistinguishable to them except for
  the owner ring on the roster and the cleared avatar and cover

#### Scenario: A non-member
- **THEN** a public club SHALL remain readable to them and a private one SHALL remain unreadable,
  unchanged in both cases
- **AND** `discoverable_private_clubs` SHALL return the same seven columns for a private club whose
  ownership just moved

#### Scenario: A blocked rider
- **WHEN** a rider blocked with the new owner reads the club
- **THEN** the block SHALL behave exactly as it did before the transfer, in both directions
- **AND** the transfer SHALL write no row into `blocks` and read none

#### Scenario: A signed-out visitor
- **WHEN** any of these paths is reached without a session
- **THEN** the leave operation SHALL raise, and `anon` SHALL hold no grant on `clubs`,
  `club_members` or either new function
- **AND** no requirement here SHALL be read as granting a visitor anything: decision #1 stands and the
  assertion is the negative one

#### Scenario: No SELECT policy moved
- **WHEN** the policy set is read after the migration applies
- **THEN** the policy counts and commands for `clubs` and `club_members` SHALL be unchanged —
  `club_members` still `SELECT`, `INSERT`, `DELETE` and **no UPDATE**, read as the sorted command list
  rather than as a count
- **AND** `anon` SHALL still hold zero grants on both

### Requirement: A value the client must supply SHALL be BOUNDED by the database even where it cannot be OWNED by it

`044` closed `postcards.created_at` by taking the grant away, and that is the strongest instrument
available: a column the client cannot write is a column the client cannot lie about. Where the
value can only come from the rider's own device — a capture time read out of a file, a coordinate,
a measurement — that instrument does not exist, and its absence SHALL NOT be read as permission to
leave the column unbounded.

Such a column SHALL carry a CHECK bounding it in every direction where an out-of-range value would
cost somebody something, and every consumer SHALL be told, in the column comment and in the spec,
that the value is a **claim** rather than a fact. A CHECK SHALL be preferred over a BEFORE trigger
that clamps, for `044`'s stated reason: a constraint fails the write at the door with a bug
report, while a trigger accepts the request and quietly discards half of it, producing a support
ticket nobody can reproduce.

`now()` in such a CHECK is permitted where the predicate can only ever become **more** true as
time passes — measured on Postgres 16: the constraint is accepted, the ceiling fires, and dropping
and re-adding it revalidates clean against rows that already passed. A predicate that could go
from true to false while a row sits still SHALL NOT use it, because `pg_restore` and
`VALIDATE CONSTRAINT` would then fail on data that was legal when it was written.

#### Scenario: An unownable column is still bounded
- **WHEN** a column's value can only be supplied by the client
- **THEN** it SHALL carry a CHECK constraint, and the absence of a grant-based defence SHALL NOT
  be treated as the absence of a defence

#### Scenario: The bound is asserted against the database, not against the schema that validates it
- **WHEN** the bound is tested
- **THEN** the assertion SHALL attempt the write and observe the database's refusal, not exercise
  the Zod schema, because a rider can decline to run the schema

#### Scenario: The client's own limit matches the constraint exactly
- **WHEN** the client filters an out-of-range value before sending it
- **THEN** its limit SHALL be the same value as the CHECK's, so the constraint never fires on an
  honest rider and never fails to fire on a dishonest one

#### Scenario: A claim is not promoted to evidence
- **WHEN** any screen, moderation decision or automated rule reads such a column
- **THEN** it SHALL NOT treat the value as proof of anything about the rider, and a server-owned
  column SHALL be preferred wherever one answers the question

### Requirement: A disclosure the rider may decline SHALL be reduced before the request, never after it

Where a rider is offered a choice about how much of a value to publish, the reduction SHALL happen
on the device, before the request is built. A precise value SHALL NOT be stored alongside a flag,
column or convention instructing readers to show less of it.

Row security is **row**-level. A policy that returns a row returns every column on it that the
reader holds a grant for, and Postgres has no per-row column security — `062` had to revoke a
grant to close one column, and a grant is per role, not per row. So a "stored but not shown" rule
can never be a database rule; it can only be honoured by a screen, which makes it a deferred
disclosure. `openspec/config.yaml`: a visibility rule that is not in the database *"silently
becomes whatever the migration author assumed."*

#### Scenario: The declined value never reaches the server
- **WHEN** a rider declines to disclose a value
- **THEN** no column, log, notification, Storage object or derived artefact on the server SHALL
  contain it or anything from which it can be recovered

#### Scenario: A visibility flag is not accepted as a control
- **WHEN** a design proposes storing a precise value with a flag governing its display
- **THEN** it SHALL be rejected, and the reduction SHALL be moved to the device instead

#### Scenario: The reduced value is what the document holds
- **WHEN** the reduction is implemented in a form
- **THEN** the reduced value SHALL be what the form carries, so the unreduced one is not one
  `querySelector` — or one refactor of the action — away from being sent

#### Scenario: The rule is stated per role, including the negative
- **WHEN** such a column is added
- **THEN** its audience SHALL be stated for every role that can reach the parent row, including
  the roles that reach nothing, and SHALL be asserted in `supabase/tests/`

#### Scenario: Where the reduction has an observable form, the database SHALL bound it
- **WHEN** a reduced value is recognisable from the value itself — a rounded coordinate, a
  truncated identifier, a bucketed count
- **THEN** a CHECK SHALL require that a row claiming to be reduced **is** reduced, so the bound on
  the disclosure is a database fact rather than the client's word

#### Scenario: That CHECK asks about the stored value, not about a reduction it never saw
- **WHEN** such a CHECK is written
- **THEN** it SHALL test a property of the value in the row, and SHALL NOT attempt to compare it
  against the database's own reduction of an original the database has never seen
- **AND** two implementations disagreeing on a boundary case SHALL both be admitted, because a
  parity test between a client and the database is unwinnable and would refuse honest writes

### Requirement: Columns that are meaningful only together SHALL be constrained to arrive together

Where two or more nullable columns are meaningless in isolation — a latitude without a longitude,
a coordinate without the marker saying how precise it is, a path without the value it was derived
from — a CHECK SHALL reduce the legal states to the meaningful ones. The alternative is every
reader inventing its own guess about a half-populated row, and those guesses drifting.

`rides_geocode_coupling` (`051`) is the standing instance: it couples `latitude`, `longitude` and
`geocode_confidence`, carries the bounds in the same constraint, and is joined by
`rides_map_paths_need_a_coordinate` for the derived paths. A second table adding coordinates SHALL
copy that shape rather than invent a second idiom.

#### Scenario: Every half-state is refused
- **WHEN** a row arrives with some of a coupled group set and others NULL
- **THEN** the write SHALL be refused, and each half-state SHALL have its own assertion rather
  than one assertion standing for the set

#### Scenario: Bounds travel with the coupling
- **WHEN** a coupled group has natural ranges
- **THEN** the ranges SHALL be expressed in the same constraint, so a reader sees the whole rule
  in one place

#### Scenario: The coupling is not delegated to the client
- **WHEN** the coupling is implemented
- **THEN** it SHALL NOT rely on the fact that the app's own form always sets the group together,
  because the client owns the mutation path and any client can send any subset

#### Scenario: A client that drops one member of a group drops all of them
- **WHEN** a client discards a value it would otherwise have sent — a clamp, a validation failure,
  a rider declining
- **THEN** it SHALL discard the whole coupled group, because dropping one member turns a value the
  client meant to suppress into a refused write

#### Scenario: An instant stored without its offset is a coupled group
- **WHEN** a timestamp is derived from a zone-less source
- **THEN** the offset it was resolved in SHALL be stored with it and coupled to it, because the
  wall clock is otherwise unrecoverable and no later migration can backfill it

### Requirement: A relaxed write rule SHALL NOT turn a refusal into a silent overwrite

When a rule that previously **refused** a write is relaxed, every line the refusal used to guard
SHALL be re-read as if it were newly reachable, and any of them that destroys existing data SHALL
be made explicitly non-destructive in the same migration.

`public.complete_onboarding(p_location text)` is the worked example and the reason this
requirement exists. Its body ends in

```sql
update public.profiles p
   set location = p_location, ...
```

which is unconditional. Until `075` a NULL or blank `p_location` raised `check_violation` several
lines above, so that assignment could never receive one. Removing the raise makes it reachable on
the very first call the new client makes — `rpc('complete_onboarding', { p_location: null })` — and
the function is **re-runnable by design** (`059`: *"re-running this updates the location and returns
the ORIGINAL stamp"*). A relaxation that stopped at deleting the raise would therefore ship a
granted RPC that erases `profiles.location`, a rider-authored column, with no error and nothing red.

The write SHALL become `location = coalesce(nullif(btrim(p_location), ''), p.location)`: **NULL and
blank both mean "leave it as it is", never "clear it".** `btrim`/`nullif` are folded in for the
same reason — `018`'s `profiles_location_length` CHECK refuses a trimmed-empty string, so storing a
whitespace argument would raise a `23514` the caller cannot act on where doing nothing is correct.

**This is a rule about relaxations generally, not about one function.** The database is the only
enforcement this app has (`CLAUDE.md`: a rule that only reaches a Zod schema is advisory), so a
guard removed from a `security definer` body removes the *only* thing standing between a client
argument and whatever the body does with it.

#### Scenario: Completing onboarding with no location does not clear an existing one
- **WHEN** a rider whose `profiles.location` is already set calls `complete_onboarding(null)` or
  `complete_onboarding('   ')`
- **THEN** the call SHALL succeed and the stored `location` SHALL be unchanged
- **AND** the returned stamp SHALL still be the ORIGINAL completion stamp for an already-complete
  rider, unchanged from `059`

#### Scenario: Completing onboarding with a location still stores it
- **WHEN** any caller — including a client bundle deployed before this change — calls
  `complete_onboarding('Utrecht')`
- **THEN** the location SHALL be stored and the stamp SHALL be set in the same statement, exactly
  as before `075`
- **AND** the function signature SHALL remain `complete_onboarding(text)`, so `021`'s grant,
  `025`'s footer and every existing caller keep naming the same function

#### Scenario: A blank location is never stored
- **WHEN** `complete_onboarding` is called with a string that is empty after `btrim`
- **THEN** the column SHALL be left at its previous value rather than being written
- **AND** no `23514` SHALL reach the caller from `profiles_location_length` for that argument

### Requirement: When the database stops requiring a value, every client-side copy of that requirement SHALL stop requiring it too

A rule relaxed in Postgres SHALL be relaxed in every Zod schema, form attribute and refusal message
that restates it, in the **same change**. A validity rule that survives only in the client is not
merely redundant — it is a rule no other gate in this repo can see, applied to a population the
relaxation itself creates.

`CLAUDE.md` states the direction this normally fails in: a rule that reaches only a Zod schema is
advisory, because the client owns the mutation path and a rider can decline it. **The inverse is
the one this change would ship**, and it is worse, because it does not fail open — it fails
*closed*, refusing a rider the database would have accepted. `profileEditSchema` carries
`location: locationSchema` (`.trim().min(1)`), so once `075` lands, every rider onboarded under it
has NULL `location` and cannot save their own profile at all — not a bio, not a bike, not anything
— until they supply the value the wizard just stopped asking for. It lands on the first screen a
new rider visits after onboarding.

Nothing in this repo catches it: `lib/actions/` has no direct tests, the RLS suite runs against
Postgres and cannot see a Zod schema, and the walk's profile-edit phase signs in as a fixture rider
who already has a location.

The refusal *message* is the same rule in its third form. A retained
`'onboarding cannot be completed before username and location are set'` asserts a requirement the
schema no longer has, in the string a support session reads first, and the assertions covering it
match on SQLSTATE rather than text — so it goes stale silently and by construction.

#### Scenario: A rider with no location can edit their own profile
- **WHEN** a rider whose `profiles.location` is NULL submits the profile edit form changing only
  their bio or their bike
- **THEN** the write SHALL succeed
- **AND** no field SHALL be presented as mandatory that the database does not require
- **AND** this SHALL hold for the very first profile edit after onboarding, which is the case the
  relaxation creates and the only case that exists at first

#### Scenario: Clearing a location is permitted and stores NULL
- **WHEN** a rider empties the location field and saves
- **THEN** the column SHALL be set to NULL rather than to an empty string, matching `bio` and
  `bike_model` and matching the only value `018`'s `profiles_location_length` admits for "none"
- **AND** a rider who cleared it SHALL be indistinguishable from one who never set it, which is
  already true of every other optional profile column

#### Scenario: An over-long location is still refused
- **WHEN** a rider submits a location longer than 100 characters
- **THEN** the write SHALL be refused with the length message
- **AND** `018`'s CHECK SHALL remain the guarantee behind it, unchanged — optional is not
  unbounded

#### Scenario: No refusal message names a rule that was removed
- **WHEN** any remaining guard refuses a completion attempt
- **THEN** its message SHALL name only the conditions that still apply — a username, and consent
- **AND** all three copies SHALL be changed together (`complete_onboarding`, and both arms of
  `enforce_onboarding_completion`), because the assertions covering them match on SQLSTATE `23514`
  and cannot tell the messages apart

### Requirement: An availability check SHALL treat the caller's own value as available to the caller

A check answering "may I have this?" SHALL exclude the caller's own row, so that a rider
resubmitting a value they already hold is told it is available — because it is.

`056`'s `public.username_exists(text)` has no `id <> auth.uid()` arm, so it answers *taken* for the
caller's own name. That is unreachable today: the one screen calling it is reached once, before the
rider has a name. This change makes it reachable, because the recovery path for a partially-failed
completion, and for a rider mid-wizard when the deploy lands, both consist of returning to that
screen with a username already set.

The exclusion does **not** address PD-146 and SHALL NOT be described as doing so: a name held by a
rider who has blocked the caller still reads free, because that is the block-aware SELECT policy
rather than this predicate, and `usernameVerdict` remains what reconciles the two on screen.

#### Scenario: A rider's own username reads as available to them
- **WHEN** a rider who already holds `ripper` checks the availability of `ripper` or `RIPPER`
- **THEN** the check SHALL report it available
- **AND** submitting it SHALL succeed as a no-op update of their own row, raising no `23505`

#### Scenario: Another rider's username still reads as taken
- **WHEN** a rider checks a name held by a different rider they can see
- **THEN** the check SHALL report it taken, unchanged
- **AND** the unique index on `lower(username)` SHALL remain the thing that actually decides, with
  the check advisory as before

#### Scenario: The exclusion grants no new reach
- **WHEN** the function is called by any role
- **THEN** it SHALL remain `security invoker` with `set search_path = ''`, SHALL still return a
  boolean and never a row or an id, and SHALL remain revoked from `public` and `anon`

### Requirement: Every role's reach into another rider's onboarding state SHALL be restated when the invariant changes

Relaxing a completion rule SHALL NOT widen who can read or write onboarding state, and the
unchanged negatives SHALL be asserted rather than assumed — an unstated negative silently becomes
whatever the migration author assumed.

The subject of `complete_onboarding` is `auth.uid()` and there is no parameter naming a rider. That
is what makes every "another rider" case below a property of the signature rather than of a policy,
and it is why the signature must not grow a user id.

#### Scenario: A rider completes only their own onboarding
- **WHEN** any signed-in rider calls `complete_onboarding`
- **THEN** it SHALL act on `auth.uid()` and on no other row
- **AND** the function SHALL take no user id, so "we check the id matches the caller" is not one
  refactor away from not doing that

#### Scenario: No rider can forge or clear the stamp directly
- **WHEN** a rider PATCHes `profiles.onboarding_completed_at` or `terms_accepted_at` through
  PostgREST, on their own row or anyone else's
- **THEN** the write SHALL be refused for want of a column grant (`025`), unchanged by this change
- **AND** `enforce_onboarding_completion` SHALL remain `security invoker` with its
  `current_user <> 'authenticated'` early return intact, so the seed, the signup trigger and a
  support fix still pass through — `033`'s footer requires this and `075` does not touch it

#### Scenario: A signed-out visitor reaches none of it
- **WHEN** `anon` attempts `complete_onboarding`, `accept_terms` or `my_onboarding_state`
- **THEN** execution SHALL be refused, unchanged from `021`'s `revoke all ... from public, anon`
- **AND** this change SHALL add no policy, grant or route admitting `anon`, per decision #1

#### Scenario: Club owners, admins, members and non-members gain nothing
- **WHEN** a club owner or admin views the roster of any club, including the welcome club every
  rider joins on completion
- **THEN** they SHALL see membership and nothing about whether a member has a `location`,
  because `025` leaves `onboarding_completed_at` and `terms_accepted_at` unreadable by other
  riders and `location` is an ordinary profile column that was already readable
- **AND** no role SHALL gain the ability to see WHICH riders skipped the location, because the
  app stores no record that a step was skipped — a NULL `location` is indistinguishable from one
  cleared in the profile editor, and that is deliberate

#### Scenario: A blocked rider's reach is unchanged
- **WHEN** rider A has blocked rider B and either one completes onboarding
- **THEN** every block-aware policy SHALL behave exactly as before, because this change touches no
  policy and no `private.is_blocked` call site
- **AND** the username availability check SHALL remain block-aware and therefore still wrong in one
  direction (PD-146) — the completing step is now the username step, so a rider blocked by a name's
  holder is refused with `23505` on the step that also completes onboarding

#### Scenario: A refused username leaves the rider un-onboarded, not half-onboarded
- **WHEN** the username write is refused — `23505` from the unique index, or `23514` from the
  charset, length or reserved-name CHECKs
- **THEN** `complete_onboarding` SHALL NOT have been called
- **AND** the rider SHALL remain with a NULL completion stamp and SHALL be able to retry on the
  same screen, because the write that can be refused for a rider-actionable reason runs first

#### Scenario: A rider with no location is a first-class rider everywhere
- **WHEN** a rider completes onboarding with `profiles.location` NULL
- **THEN** they SHALL be visible to every other signed-in rider, because the `profiles` SELECT
  policy keys on `username is not null` and never on `location` or on the completion stamp
- **AND** no read path SHALL filter riders by `location is not null`
- **AND** they SHALL be joined to the club carrying `clubs.is_default` exactly as before (`058`),
  since that block hangs off the transition into completion and not off the location

#### Scenario: The welcome-club join is unchanged in both directions
- **WHEN** a rider completes onboarding under the relaxed rule
- **THEN** the `club_members` insert SHALL still run inside the same transaction, still inside the
  `when others` block that can never take the stamp down with it, and still only on the transition
  into completion — so a rider who joined, left and re-ran the RPC is not put back in
- **AND** `notify_club_joined` SHALL still skip its fan-out for that club (`058` §4), so no rider
  gains a notification from this change
- **AND** `059`'s `raise warning` for "no club carries `clubs.is_default`" SHALL be preserved
  verbatim, because it is the only diagnostic for the failure that presents as success

### Requirement: A column that becomes nullable SHALL have its three-valued behaviour decided at every site that interpolates it

When an existing `NOT NULL` column is made nullable, every predicate that already interpolates it
goes three-valued. **The direction it fails in is decided by the KIND of expression, not by the
author's intent**, and the kinds disagree. Each site SHALL be enumerated from the catalogue and its
new behaviour SHALL be stated, not inferred.

The four behaviours, measured on DEV 2026-09-05 for `clubs.owner_id`:

- **An RLS `using` or `with check` clause fails CLOSED.** `auth.uid() = owner_id` is NULL, and a
  policy admits only TRUE.
- **A `WHERE` conjunct inside a helper fails CLOSED.** `c.owner_id <> candidate` is NULL, so the row
  is not returned.
- **A CHECK constraint fails OPEN.** `avatar_path LIKE 'club-avatars/' || owner_id || '/%'` is NULL,
  and a CHECK rejects only on FALSE.
- **A predicate wrapped in a total function fails OPEN.** `NOT private.is_blocked(x, owner_id)` is
  TRUE, because `is_blocked` is an `EXISTS` and returns `false` rather than NULL — the NULL is
  swallowed before the negation sees it.

The last is the dangerous one, because it looks identical to the second and behaves like the
opposite of it. A `security definer` helper has no policy beneath it, so a site that fails open there
is open everywhere.

#### Scenario: Every interpolating site is enumerated from the catalogue
- **WHEN** a migration makes an existing column nullable
- **THEN** the change SHALL enumerate every policy, function and constraint referencing that column,
  obtained by querying `pg_policy`, `pg_proc` and `pg_constraint`
- **AND** it SHALL NOT rely on a list recalled from prose or from a previous migration, because a
  site added since is invisible to both

#### Scenario: A site that fails open is closed explicitly
- **WHEN** a site's new behaviour admits a row it previously refused
- **THEN** the migration SHALL add an explicit `IS NOT NULL` conjunct at that site
- **AND** it SHALL NOT rely on a neighbouring conjunct that happens to refuse for an unrelated
  reason, because such a conjunct is one refactor from removal

#### Scenario: A site that fails closed is asserted, not assumed
- **WHEN** a site's safety depends on NULL propagation rather than on a written predicate
- **THEN** the RLS suite SHALL carry an assertion naming the role and the resource
- **AND** the assertion SHALL state that the guarantee rests on three-valued logic, so that a later
  author who rewrites the predicate learns what they are relying on

#### Scenario: A privileged read is checked separately from the policy
- **WHEN** the column gates a `security definer` accessor
- **THEN** that accessor SHALL be audited independently of the table's RLS policies
- **AND** narrowing a SELECT policy SHALL NOT be treated as narrowing any accessor, since a definer
  body has no policy beneath it

### Requirement: An accessor that bypasses a visibility policy SHALL restate every other conjunct of it

A `security definer` function exists to open exactly one hole in exactly one policy. When such a
function reproduces a policy's qual in order to remove one conjunct, it SHALL reproduce **every
remaining conjunct** rather than approximating the predicate.

This is not a style rule. Inside a `security definer` function `current_user` is the *owner*, so
RLS does not apply and no trigger guard beginning `if current_user <> 'authenticated'` runs. The
restated qual is the *entire* remaining access control on that read; a conjunct dropped by
oversight is not caught by anything, and the RLS suite cannot see it because that suite runs as
the table owner too.

`public.ride_journal_postcard_ids(uuid)` is the standing precedent: it restates the whole
`postcards` SELECT qual and carries a comment naming the branch that must stay unconditional.

#### Scenario: The hidden-postcards accessor evaluates the audience predicate NOT AT ALL
- **WHEN** the accessor returns a rider's hidden postcards
- **THEN** it SHALL NOT evaluate `private.is_blocked` or `private.is_club_member`, and SHALL NOT
  return any value derived from either
- **AND** this is deliberately the opposite of `ride_journal_postcard_ids`' precedent above:
  restating the qual is right when the answer is *which rows to return*, and wrong here, where
  the answer would be a **per-row flag whose value another rider controls**
- **AND** the only predicate it applies SHALL be the caller's own `user_id` scope and the
  exclusion of the caller's own postcards, both facts about the caller

#### Scenario: An accessor SHALL NOT restate a conjunct that would drop its own subject
- **WHEN** the blocked-riders accessor reads a `profiles` row
- **THEN** it SHALL NOT restate `username is not null` from the `profiles` SELECT policy
- **AND** every `blocks` row whose `blocker_id` is the caller SHALL yield exactly one row out,
  because a block missing from the list cannot be lifted

#### Scenario: Both accessors are reachable by the client and by nobody else
- **WHEN** privileges are asserted
- **THEN** `has_function_privilege('authenticated', <accessor>, 'execute')` SHALL be true for
  both, because PostgREST routes only to `public` and the client has no other path
- **AND** the same predicate SHALL be false for `anon`
- **AND** the assertion SHALL name the role rather than calling the function, since the suite
  runs as the table owner, for whom no barrier exists — the gap that let `029` ship broken

#### Scenario: Neither accessor takes a rider id
- **WHEN** either accessor is called
- **THEN** its subject SHALL be `auth.uid()` and SHALL NOT be an argument
- **AND** no argument SHALL widen the set of rows returned beyond the caller's own

### Requirement: A rule about what a rider may SEE SHALL be enforced where the client cannot reach it

The render model is the client, so any rule stating what a value *may be* has to end up as a
CHECK, trigger, policy or `security definer` function body. A rule that only ever reaches a
component or a Zod schema is advisory, because the client owns the mutation and render path.

This applies to *withholding* as much as to validating: a preview the rider must not see SHALL
be withheld by the database, not merely left unrendered.

#### Scenario: The hidden list is emptied of detail by the database, not by the component
- **WHEN** a rider reads their hidden postcards
- **THEN** the accessor SHALL return only the postcard's id and when this rider hid it
- **AND** a caller reaching the function directly through PostgREST SHALL receive the same two
  columns the app does, so the property does not depend on the client
- **AND** the component SHALL NOT be the thing that decides not to draw a preview

#### Scenario: The return type SHALL NOT regain a restorability flag
- **WHEN** a later change proposes returning whether a hidden postcard could be restored, or the
  reason it could not
- **THEN** it SHALL first revisit this requirement, because such a flag reduces to
  `not private.is_blocked(auth.uid(), author_id)` for every postcard whose club membership the
  rider already knows — which is every postcard they hid
- **AND** NULLing the columns beside such a flag SHALL NOT be accepted as a mitigation, since the
  rider already knows who authored the postcard they chose to hide, so the flag is the whole
  signal

### Requirement: A screen widening the projection of another rider's row SHALL name each added column

`025` grants `authenticated` SELECT on eight `profiles` columns, and that grant is **table-wide,
not row-scoped**: every column it names is readable on every row the SELECT policy admits. What
stops one rider learning another's bio today is therefore not a permission — it is the app's own
choice to project four columns (`PUBLIC_PROFILE_COLUMNS`) in shared contexts.

That makes widening the projection a **silent** change: adding a column to a select list needs no
migration, trips no policy, fails no assertion and raises no advisor. A change that widens what
one rider learns about another SHALL therefore name each added column and state why it is safe,
so the widening is reviewable at all.

This requirement adds a rule about *projections*. It does not alter *Every role's reach into a
rider's identity SHALL be stated*, whose scenarios continue to govern who may reach a row; a
dedicated profile screen is a fifth reach path alongside the club roster, ride crew, postcard
byline and Explore already named there.

#### Scenario: A new shared-context projection is a subset of the grant

- **WHEN** a column allowlist for reading another rider's row is introduced or extended
- **THEN** every column in it SHALL appear in `025`'s
  `grant select (...) on public.profiles to authenticated`
- **AND** a test SHALL enforce this by reading the migration, because a column named outside the
  grant returns `42501` for the whole row rather than omitting that column

#### Scenario: Consent and lifecycle stamps stay out of every projection

- **WHEN** any allowlist naming another rider's columns is written
- **THEN** it SHALL contain neither `terms_accepted_at`, `onboarding_completed_at` nor
  `terms_version`
- **AND** this SHALL hold by test rather than by comment, matching the existing guard on
  `PUBLIC_PROFILE_COLUMNS`

#### Scenario: The narrow allowlist stays narrow

- **WHEN** a screen needs more columns of another rider than the shared-context allowlist carries
- **THEN** it SHALL introduce a separate, named allowlist for that screen
- **AND** SHALL NOT widen the shared-context allowlist, which would ship the added columns to
  every member list, ride crew and byline that renders a rider

#### Scenario: A column added to `profiles` later

- **WHEN** a migration adds a column to `profiles` and grants it to `authenticated`
- **THEN** it SHALL NOT become visible to other riders merely by being added to a screen's select
  list without a stated decision
- **AND** the default SHALL be exclusion from every other-rider projection

### Requirement: A merged view of several tables SHALL be assembled under the caller's own row security, and SHALL NOT be served by a `security definer` union

Where a screen shows one ordered stream built from rows of several tables whose audiences differ,
the rows SHALL be obtained by separate reads, each returning under the SELECT policy of the table
that owns it. No `security definer` function SHALL return such a union.

This is the general form of the rule `034` learned the hard way and it is stated here because the
next three screens want the same shape — the profile timeline, the standalone ride Journal
(PD-257), and any Inbox aggregate.

**Why a definer union is not merely a shortcut.** Its body runs as the owner, for whom row
security does not apply, so every audience rule of every source has to be restated inside it by
hand. For the club timeline that is five predicates and four symmetric block arms, drawn from
four unrelated policies, one of which (`083`'s live-invite disjunct on `rides`) has nothing to do
with the subject at all. And **`supabase/tests/` cannot see the mistake**: the suite runs as the
table owner, for whom neither RLS nor the grants exist, so a definer body that silently returns a
private club's thread titles passes every assertion in the file.

**The costs of the client merge are the ones to pay.** More round trips, and a bound per source
rather than one bound over the union. Both are visible, bounded and stated in the spec that uses
them. A restated audience rule that drifts is none of those things.

Where a merged view genuinely cannot be built from ordinary reads, the exception SHALL be a
narrow `security definer` accessor **returning ids and never rows**, on the precedent of
`ride_journal_postcard_ids` (`062`) and `club_stamp_postcard_ids` (`086`), so that RLS still
decides every row that renders.

#### Scenario: No union accessor is added
- **WHEN** a client screen needs an ordered stream over several tables
- **THEN** it SHALL issue one read per table and merge the results in the client
- **AND** no function SHALL be added that returns rows of more than one of those tables

#### Scenario: An id-returning accessor is the only permitted narrowing
- **WHEN** ordering or correlation genuinely cannot be expressed by the client
- **THEN** a `security definer` accessor MAY return identifiers and an ordering key
- **AND** the rows themselves SHALL still be read through the caller's own RLS, so a caller who
  may not see a row receives nothing for its id

#### Scenario: The suite's blind spot is stated where the temptation is
- **WHEN** a session considers replacing several reads with one privileged function
- **THEN** the deciding fact SHALL be that the RLS suite runs as the table owner and would pass
  regardless
- **AND** the absence of a failing test SHALL NOT be read as evidence that the union is safe

### Requirement: An accessor that composes more than one visibility predicate SHALL justify each one individually, including the ones that exclude nobody today

`062` established the pattern: where a column grant is revoked to prevent a correlation, a
`security definer` accessor returning **ids only** restores the intended read without restoring the
grant. `062`'s accessor composes two predicates. This change's composes three, and the rule the
second one needs is that **the migration SHALL name, per predicate, the rider it excludes** — and
where it excludes nobody today, SHALL name the reachable state in which it will.

A predicate justified only as "defence in depth" SHALL be treated as unjustified. `036` §3 already
forbids the inverse reasoning — deriving one visibility from another — by name; this is the same
rule pointed at the conjuncts rather than at the omissions.

#### Scenario: Each predicate names its excluded rider
- **WHEN** `public.club_stamp_postcard_ids` is created
- **THEN** the migration SHALL name, for the outer club gate, `083`'s invitee — a rider who reads one
  ride of a private club and no part of the club — as the rider it excludes
- **AND** SHALL name, for the per-ride gate, a non-member of a **public** club facing that club's
  private ride
- **AND** SHALL name, for the restated postcards qual, a blocked author, a hidden postcard and a
  club the reader has left

#### Scenario: Each exclusion is asserted separately
- **WHEN** the suite covers the accessor
- **THEN** each of the three SHALL have its own assertion with its own label
- **AND** a suite in which removing any one predicate leaves every assertion green SHALL be treated
  as incomplete

#### Scenario: The redundant-looking gate is mutation-tested
- **WHEN** the outer club gate's assertion is written
- **THEN** the gate SHALL be removed in a scratch copy, the assertion SHALL be confirmed red, and the
  removal reverted
- **AND** an assertion for a predicate that has never been seen to fail SHALL NOT be counted as
  coverage

### Requirement: An accessor that restates a policy SHALL be pinned as text, and the pin SHALL instruct a reader to move the restatements rather than re-pin the string

`private.can_read_ride`, `private.can_read_club` and `public.ride_journal_postcard_ids` all restate a
policy and all can go stale; `060` says so in its own comments and PD-211 is what it cost when only
one of a pair moved. This change adds a fourth restatement of `postcards` SELECT.

Every such restatement SHALL be pinned in `supabase/tests/rls_test.sql` under **its own** function's
name, and every pin's failure message SHALL say to update the restatements in the same change rather
than to re-pin the string.

#### Scenario: The new restatement is pinned under its own name
- **WHEN** `086` is applied
- **THEN** `postcards` SELECT's qual SHALL be pinned as whole text under
  `club_stamp_postcard_ids`' name, in addition to the existing pin under
  `ride_journal_postcard_ids`' name
- **AND** a change to that policy SHALL therefore fail **two** assertions, which is the point

#### Scenario: A lazy re-pin is the failure mode named in the message
- **WHEN** the pin fails
- **THEN** its message SHALL name both accessors and instruct that both bodies move
- **AND** the message SHALL state that a green suite after a re-pin with only one body updated is
  exactly PD-211's shape

### Requirement: A grant revoked to prevent a correlation SHALL stay revoked, and the accessor SHALL be asserted to be a filter rather than a grant

`select (ride_id)` on `public.postcards` SHALL remain revoked from `authenticated`, `anon` and every
other client role. No accessor added by this change SHALL return it.

The suite SHALL assert both halves: that the grant is absent, and that the accessor answers — because
a suite asserting only the first cannot tell a working accessor from a broken one, and a suite
asserting only the second cannot tell a filter from a widening.

#### Scenario: The column grant is unchanged
- **WHEN** `086` is applied
- **THEN** `authenticated`'s SELECT column list on `public.postcards` SHALL be exactly what it was
  before, asserted as a sorted string rather than a count

#### Scenario: The accessor is a filter
- **WHEN** a reader calls the accessor
- **THEN** every id it returns SHALL be a postcard that reader can read through the ordinary
  `postcards` SELECT policy
- **AND** this SHALL be asserted as an equality between the accessor's result and the reader's own
  filtered read, not as a spot check

