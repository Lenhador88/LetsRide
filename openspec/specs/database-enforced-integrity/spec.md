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
- **WHEN** the same rider sets a username and location and receives the completion stamp
- **THEN** every write above SHALL succeed
- **AND** the stamp SHALL remain one-way and SHALL remain refused while either field is NULL,
  unchanged from `003`

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

#### Scenario: The parent-visibility conjunct is present and is not redundant
- **WHEN** a policy on a table whose audience is narrower than its parent's is written or
  reviewed
- **THEN** it SHALL contain an `EXISTS` against the parent evaluated under the caller's own row
  security
- **AND** that conjunct SHALL NOT be removed on the grounds that the narrowing predicate already
  implies it

#### Scenario: A blocked rider cannot reach a child row through a definer helper
- **WHEN** a rider who has blocked, or been blocked by, a parent row's owner still satisfies the
  narrowing predicate
- **THEN** zero child rows SHALL be returned
- **AND** the refusal SHALL be attributable to the parent-visibility conjunct, asserted in
  isolation from the narrowing one

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

