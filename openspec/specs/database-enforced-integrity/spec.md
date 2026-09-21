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

The database SHALL refuse any `club_members` row whose `role` is `owner` or `admin` from `authenticated`, without exception:
`authenticated` may insert `role = 'member'` and nothing else, and **no client SHALL be able to
claim `owner` or `admin` by any verb, on any table.** The owner's row SHALL be written by the
database itself when the club is created — `103`'s `AFTER INSERT` trigger — and SHALL NOT be
writable by the client at all.

**Every writer of a role other than `member` is a `security definer` function that takes no role
argument, so none of them writes as `authenticated` and the narrowing above does not bind them:**

- **`admin`** — `public.promote_club_member(target_club, rider)` writes the literal `'admin'` and
  `public.demote_club_admin(target_club, rider)` writes the literal `'member'` (`088`); neither
  accepts a role parameter, so — as with `085`'s `private.join_club_from_request` — there is no
  input by which a caller could attempt a value the design does not offer. Each is gated inside its
  own body — promotion on `private.is_club_admin_for(auth.uid(), target_club)`, the owner or an
  admin; demotion on the owner, or the admin stepping down — because RLS does not apply inside a
  definer function and that check is therefore the entire access control.
  `club-membership-administration` states the authority in full.
- **`owner`, by ownership transfer** — two transfers set `role = 'owner'` on the rider they are
  simultaneously making `clubs.owner_id`: account deletion's `private.transfer_owned_clubs`
  (`032`/`107`), reached only through `public.transfer_owned_clubs_for_deletion`, whose EXECUTE is
  granted to `service_role` alone (`031`); and `public.leave_owned_club` (`095`), published to
  `authenticated` but taking a club and no rider id. Both run as the owner and bypass RLS.

`019` enforced the client half through the INSERT policy's WITH CHECK plus the **absence of any
UPDATE policy**, and `036` §7.6 rests on the second half. Both survive: `088` adds no UPDATE policy
and revokes `048`'s dead per-column UPDATE grant with nothing re-granted, so the absence is an
absence of privilege as well as of policy.

**What changed and why.** `019` admitted one exception: the rider named in `clubs.owner_id` could
insert their own `role = 'owner'` row, because `createClub` wrote it as a second round trip and
without that arm club creation stopped working. Creator membership is now established by the
database in the same statement as the club, so nothing in the application ever sends `role`
`'owner'` again and the arm's only remaining use would be to duplicate a row that already exists.
`104` removes it, leaving `authenticated` able to insert `role = 'member'` and nothing else —
strictly narrower than `019`, and the last self-assignable non-member role closed.

The rest of `019` is unchanged and restated because a requirement is replaced whole: `club_members`
INSERT is still `auth.uid() = user_id` plus the club being public or owned by the caller, and there
is still no UPDATE policy. The roster screen renders the value — `/clubs/detail/members` labels
`owner` and `admin` and draws an owner ring — so a forged role would be visible to every member of
the club.

**Ordering is load-bearing.** The arm had to be removed only after the deployed client stopped
sending `role: 'owner'`. Removing it earlier makes every club creation fail against a client that
still sends it, and whether a `WITH CHECK` is evaluated for a row an `on conflict do nothing`
discards is unmeasured — so the removal is its own migration (`104`), applied after the code
deploy, on the pattern `021`'s split established.

#### Scenario: A non-member joining a public club cannot arrive as owner or admin
- **WHEN** a signed-in rider who is not a member inserts a `club_members` row for a public club
  with `role` set to `owner` or `admin`
- **THEN** the database SHALL reject the write

#### Scenario: Not even the club's own owner may insert an owner row
- **WHEN** the rider named in `clubs.owner_id` inserts a `club_members` row for their own club with
  `role = 'owner'`
- **THEN** the write SHALL be refused once the arm is removed
- **AND** this SHALL NOT break club creation, because the row already exists by the time any client
  statement could attempt it

#### Scenario: Nobody can promote an existing member
- **WHEN** any rider — including the club owner — attempts to UPDATE `club_members.role`
- **THEN** the write SHALL be refused, because no UPDATE policy on `club_members` exists
- **AND** this SHALL remain true until the invitations feature ships its own policy, so that
  the absence is a recorded gap rather than an accident

#### Scenario: No client role can write `admin` by any verb
- **WHEN** a rider attempts to insert a `club_members` row with `role = 'admin'`, or to update an
  existing row to `'admin'`, on a public club, a private club, and a club they own
- **THEN** every attempt SHALL be refused
- **AND** the UPDATE half SHALL be refused **twice over** — by the absent grant and by the absent
  policy — and both SHALL be asserted, because removing either alone would look like a passing test

#### Scenario: The RPCs take no role argument
- **WHEN** the two functions' signatures are read from `pg_proc`
- **THEN** neither SHALL accept a `text` role parameter, and each SHALL write its value as a literal
  in `prosrc`

#### Scenario: Only the owner or an admin can make an admin
- **WHEN** a rider who is neither the club's owner nor one of its admins calls `promote_club_member`
- **THEN** it SHALL raise `insufficient_privilege`
- **AND** an admin's promotion SHALL succeed — `club-membership-administration`'s *Promotion SHALL be
  open to admins* is the decision, and it records the counter-argument

#### Scenario: The owner's roster row is unreachable by either RPC
- **WHEN** either RPC targets `clubs.owner_id`
- **THEN** it SHALL raise, whether or not that rider holds a roster row and whatever role it carries

#### Scenario: A rider who demoted themselves through Explore is repaired
- **WHEN** a club owner holds a `club_members` row with `role = 'member'` for their own club,
  which was reachable by tapping `Join club` on their own orphan club in Explore until `103`
- **THEN** the migration SHALL correct the role to `owner`
- **AND** it SHALL be an UPDATE, since an insert would find the existing row and do nothing

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

Every column in this schema holding an ISO 3166-1 alpha-2 country code SHALL be constrained to an
**assigned** code, not merely to two uppercase letters, and that constraint SHALL live in the
database rather than in a Zod schema.

There are two such columns after this change: `profile_countries.country_code` (`014`/`020` — the
travel log) and `profiles.home_country` (`113` — the rider's home market). **They are different
facts and neither is derivable from the other**: `014`'s own comment calls its table *"Countries a
rider says they have ridden in"*, so a rider who has ridden in France and lives in the Netherlands
is correctly described by both and by neither alone. Overloading one to mean the other corrupts
both meanings and is very hard to unpick later.

The rule generalises from `020`'s reasoning rather than repeating its wording: membership of the
ISO 3166-1 list lived in `COUNTRY_CODES` and was checked by Zod alone, so `ZZ` stored successfully
and rendered as a blank flag beside its own code for ever. Once the client owns the mutation path,
`COUNTRY_CODES.includes(value)` is advice.

#### Scenario: An unassigned code is refused, on either column
- **WHEN** a rider writes `ZZ`, `XX` or any other well-formed but unassigned code, to
  `profile_countries.country_code` or to `profiles.home_country`, by any route including a direct
  PostgREST call that never ran the client's validation
- **THEN** the database SHALL reject the write with `check_violation`

#### Scenario: A malformed value is refused, and by a different constraint
- **WHEN** a rider writes `` (empty), `nl`, `NLD`, `' NL '`, `1`, or a 249-character string
- **THEN** the database SHALL reject it
- **AND** the refusal SHALL come from the **shape** constraint rather than the membership one, so
  a client that eventually wants to tell *"not a code"* from *"not a country"* has two error
  identities to do it with — `020`'s stated reason for keeping `014`'s check after adding its own

#### Scenario: The picker's list stays the client's
- **WHEN** either constraint is added or regenerated
- **THEN** it SHALL NOT introduce a `countries` reference table, since nothing joins against one
  and `014` deliberately declined to create it
- **AND** the SQL literal SHALL be generated from `src/lib/countries.ts` by script rather than
  transcribed, because this is now the **third** hand-kept pairing of that list and nothing
  reconciles the copies automatically

#### Scenario: A CHECK SHALL NOT delegate the list to a function
- **WHEN** a future change is tempted to replace both literals with a shared
  `private.is_assigned_country_code(text)`
- **THEN** it SHALL NOT, because Postgres does not re-validate a CHECK when the function behind it
  changes — a list edited in one place would leave already-stored rows violating a constraint that
  reports itself as valid

### Requirement: Onboarding completion SHALL gate participation, not only navigation

A rider whose `profiles.onboarding_completed_at` is NULL MUST NOT be able to create content or join
anything, and the refusal SHALL come from the database rather than from a redirect.

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

Both tables `093` adds carry it — `club_invites`, because inviting is participation, and
`club_invite_links`, because minting a bearer token into a club is participation — so the count
moves by **+2**, and the delta SHALL be asserted together with the two table names, never the
absolute. **17 on DEV and 17 on PROD, measured 2026-08-31**, before the concurrent changes holding
`092`, `094` and `095` land. An absolute after-count is therefore meaningless in isolation, which is
exactly why the rule is stated as a delta plus two names.

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

**A `security definer` writer SHALL restate the gate in its own body and SHALL NOT be given a
compensating trigger.** `private.join_club_from_invite` writes a `club_members` row as the owner, and
the gate trigger on `club_members` carries `when (current_user = 'authenticated')`, which can never
be true inside it. It therefore calls `private.may_participate_for(rider)` — the **subject-taking**
form, never `private.may_participate()`, which is caller-relative and on the claim path would answer
for the wrong rider entirely. Adding a trigger to compensate would raise the gate count while gating
nothing, which is what `078.9` asserts the absence of.

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

#### Scenario: An un-onboarded rider cannot invite or mint
- **WHEN** a rider whose `onboarding_completed_at` or `terms_accepted_at` is NULL inserts into
  `club_invites` or `club_invite_links`
- **THEN** the write SHALL be refused with `check_violation` by the gate

#### Scenario: An un-onboarded rider cannot be admitted by anybody else's action
- **WHEN** an onboarded admin's invite is accepted by an un-onboarded rider, or such a rider claims a
  live token
- **THEN** no `club_members` row SHALL be written, and the refusal SHALL come from
  `private.may_participate_for` inside the writer rather than from a trigger

#### Scenario: The gate is not reachable through the read path either
- **WHEN** an un-onboarded rider calls `club_invite_link_preview` or `my_live_club_invites`
- **THEN** both SHALL return zero rows, because a `security definer` read has no policy beneath it
  and a check absent from the body is absent everywhere

#### Scenario: The count is asserted as a delta with names
- **WHEN** the suite checks the gate after `093`
- **THEN** it SHALL assert the trigger is present **by table name** on both new tables **and** that
  the flat count rose by exactly two, because a count alone cannot tell a new gate from a moved one

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

**A club's owner is one of those roles and was omitted.** The original six scenarios named
organizer, club member, non-member with a public ride, non-member with a private club's ride,
blocked rider and signed-out visitor — five of which `openspec/config.yaml` requires, with
**owner and admin absent**. `private.is_club_member` reads `club_members` only, so an owner
holding no membership row fell through every scenario here and lost their own private club's
rides in both directions. The scenarios below close that, and are stated in terms of
`clubs.owner_id` rather than of any membership row so they remain true whether or not the row
exists.

**A ride's crew is NOT one of those roles, and that omission cost a second defect.** Nothing here
said so, and *"a rider on this ride's crew"* reads as a role that can obviously see the ride.
It cannot: `rides` SELECT resolves through organizer, public, or club member, and **neither
`ride_members` nor `private.is_ride_crew` appears in its `qual`** — transcribed from `055`'s
migration header and from `supabase/tests/rls_test.sql` §055.7, and **confirmed against DEV
(`fpmrimzxadewsaiwpsel`) on 2026-08-17**, where the policy text is verbatim as `055` recorded it.
A `ride_members` row survives every event that takes the ride away —
blocking removes nobody from a roster, and leaving a club reaches nothing on `ride_members` — so
*"holds a crew row"* and *"can see the ride"* are **independent**. A fan-out addressing the crew
therefore addressed riders the read policy discards, permanently and with nothing to raise. The
negative scenario below states that so it is a contract rather than an observation.

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

#### Scenario: Club owner holding no membership row
- **WHEN** the rider named by `clubs.owner_id` reads a ride in that club while holding no
  `club_members` row for it
- **THEN** it SHALL be returned, on the same terms as for a member, regardless of the club's
  `is_public`
- **AND** that rider SHALL be able to create a ride in that club
- **AND** neither SHALL depend on the owner-membership row existing

#### Scenario: Club admin
- **WHEN** a rider holding `club_members.role = 'admin'` reads a ride in that club
- **THEN** it SHALL be returned because they hold a membership row, and for no other reason
- **AND** no admin-specific arm SHALL exist in any ride policy, since `admin` has no
  representation outside `club_members`

#### Scenario: Crew member with no other route to the ride
- **WHEN** a rider holding a `ride_members` row reads that ride while satisfying none of the
  organizer, public or club-member arms — because they blocked the organizer, or because they
  left the ride's private club
- **THEN** zero rows SHALL be returned, and crew membership SHALL NOT be a route to a ride
- **AND** `rides` SELECT SHALL carry **no** `ride_members` arm and **no** `private.is_ride_crew`
  arm, which SHALL be asserted as an absence rather than assumed from the policy reading
  correctly today
- **AND** the reason SHALL be recorded: two audiences narrower than the crew — `034`'s
  `ride_messages` SELECT/INSERT and `041`'s postcard ride-tag `WITH CHECK` — are expressed as an
  **intersection** of an RLS-filtered `EXISTS` against `rides` with `private.is_ride_crew`, so a
  crew arm here would make the `EXISTS` implied by the crew conjunct and collapse both to crew
  membership alone, restoring the ex-club-member chat leak `034` shipped in draft and fixed
- **AND** anything needing to know whether a **specific other** rider can see a ride SHALL ask a
  candidate-relative predicate instead, per the `candidate-relative-visibility` capability, rather
  than widening this policy

#### Scenario: Non-member, public ride with no club
- **WHEN** any signed-in rider reads a ride with `club_id` NULL and `is_public = true`
- **THEN** it SHALL be returned, since decision #1 makes "public" mean "any signed-in rider"

#### Scenario: Non-member, private club's ride
- **WHEN** a signed-in rider who is not a member of the ride's private club reads it
- **THEN** zero rows SHALL be returned, and its crew SHALL be unreachable through
  `ride_members`
- **AND** this SHALL hold for a rider who owns some *other* club

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

#### Scenario: Former member who does not own the club
- **WHEN** a rider deletes their `club_members` row for a private club they do not own and then
  reads a ride in it
- **THEN** zero rows SHALL be returned immediately, because reach is keyed on the current row or
  on `clubs.owner_id` and never on membership history
- **AND** this SHALL hold even while they still hold a `ride_members` row for that ride

#### Scenario: Blocked rider
- **WHEN** a rider blocked by the organizer reads the ride, by any route including a club they
  both belong to, an invite, **or a live token**
- **THEN** zero rows SHALL be returned
- **AND** the token route SHALL be refused by a check in the RPC's own body, since no policy runs
  beneath a `security definer` function
- **AND** this SHALL hold even while they still hold a `ride_members` row for that ride

#### Scenario: Blocked rider who owns the club
- **WHEN** the club's owner reads a ride in their own club whose organizer they have blocked, or
  who has blocked them
- **THEN** zero rows SHALL be returned
- **AND** ownership SHALL NOT override a block in either direction, blocking being symmetric even
  though the row is directional

#### Scenario: Signed-out visitor
- **WHEN** a request arrives with no session
- **THEN** zero rows SHALL be returned, because `anon` holds no grant on `rides`, and no EXECUTE
  on either new RPC
- **AND** the owner arm SHALL NOT change this, since it resolves through `auth.uid()`, which is
  NULL with no session

#### Scenario: Invited rider who accepted and later left the crew
- **WHEN** an accepted invitee deletes their `ride_members` row and reads the ride
- **THEN** it SHALL still be returned, because `accepted` is a live invite
- **AND** they SHALL be able to rejoin, which depends on this — `ride_members` INSERT carries its
  own `EXISTS (rides …)` evaluated under their row security

#### Scenario: Invited rider who declined
- **WHEN** a rider who declined an invite reads the ride
- **THEN** zero rows SHALL be returned, unless another arm admits them

#### Scenario: The policy text itself is pinned, because a fan-out now restates it
- **WHEN** `rides` SELECT is reviewed, refactored or replaced
- **THEN** its full `qual` text SHALL be pinned by an assertion whose label names
  `private.can_read_ride`, so a rewrite fails the suite with a pointer at the function that
  restates it rather than silently turning a fan-out's recipient set into a wrong answer
- **AND** the pin SHALL be understood as deliberately brittle: it fails on a cosmetic reformat as
  well as on a semantic change, which costs one session five minutes and is the cheaper of the two
  errors
- **AND** `clubs` SELECT SHALL carry the **twin** pin, labelled with `private.can_read_club`,
  because `ride_created_in_club` restates both policies and one pin covers only one of them
- **AND** neither pin SHALL be read as covering the helper bodies its policy text delegates to —
  an arm added to `private.is_club_member` leaves both `qual` texts byte-identical, so that
  function carries its own pin, by equality
- **AND** the two structural pins that already exist — that the policy leads with an unconditional
  organizer arm, and that it has no crew arm — SHALL remain, because neither catches a rewrite of
  the middle of the policy

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
rider's folder from a row they author, nor **read** an object whose owning row they cannot read.

Every upload surface binds its path to the uploader in SQL: `postcards` through the INSERT
policy's `image_path like 'postcards/' || auth.uid() || '/%'`, and `profiles`, `clubs` and `rides`
through CHECK constraints on the row. **Six** folders now exist in the `media` bucket — `avatars`,
`covers`, `club-avatars`, `club-covers`, `postcards` and `ride-maps` — none granted to anything but
`authenticated`, and none of them UPDATE. Re-derive the policy count rather than reading it here,
because it has been stated as a number once already and a folder added without its three policies
looks exactly like this sentence being right:

```sql
select cmd, count(*) from pg_policies
 where schemaname = 'storage' and tablename = 'objects' group by cmd order by cmd;
```

**The read half is the addition, and it is the half that fails silently.** Measured 2026-08-09:
this repo's INSERT and DELETE policies check the folder prefix and the caller's uid **only**, while
every SELECT policy carries an `EXISTS` against the parent row evaluated under the caller's own
RLS. Both shapes are correct in their own position, and they are one line apart in a migration — a
write policy pasted into a read position grants every signed-in rider every object in the folder,
and reviews as a consistent-looking pair.

**Read the SELECT policies as a disjunction, not a conjunction.** Five of the six are
`own-folder OR EXISTS(parent)`; only `postcards` is the bare `EXISTS`. The own-folder arm is
permitted where the folder's uid identifies the same rider the owning row is about, and forbidden
where it identifies a mere uploader — `stored-media-visibility` owns that rule and the reasoning.
Describing the shape as "folder pin **plus** an `EXISTS`" is the error to avoid: it reads as a
conjunction and hides the arm entirely.

#### Scenario: A rider cannot claim another rider's object
- **WHEN** a rider inserts a `postcards` row whose `image_path` sits in another rider's folder
- **THEN** the write SHALL be rejected by the INSERT policy

#### Scenario: A rider cannot upload outside their own folder
- **WHEN** a rider uploads to `avatars/<another uid>/…`, `covers/`, `club-avatars/`,
  `club-covers/` or `ride-maps/` outside their own folder
- **THEN** Storage SHALL refuse the upload

#### Scenario: No capacity rule is claimed for `ride_members`
- **WHEN** a rider joins a ride
- **THEN** nothing SHALL limit the size of its crew: `rides.max_riders` was enforced by
  `063` and dropped, column and trigger together, by `077` (PD-293) — the design draws no
  capacity affordance anywhere, so the rule could only reach a rider as an unexplained refusal
- **AND** nothing SHALL claim otherwise: `RIDE_CREW_LIMIT` bounds what the crew rail *renders*
  and is not a database rule

#### Scenario: A rider cannot read another rider's object whose owning row is invisible to them
- **WHEN** a rider fetches an object **outside their own folder** while the row naming it is not
  visible to them under that row's own SELECT policy
- **THEN** the fetch SHALL be refused
- **AND** the refusal SHALL come from an `EXISTS` against the owning row rather than from the path,
  which is constructed from ids the rider can already see and is therefore not a secret
- **AND** the own-folder arm SHALL NOT be treated as an exception to this, because it admits only
  the rider whose uid the folder names — a rider reaching their own bytes has learned nothing

#### Scenario: A row cannot widen an object's audience by naming it
- **WHEN** a rider sets a path column on a row they author to an object in another rider's folder
- **THEN** the write SHALL be refused by a CHECK pinning the path to the row's own owner column
- **AND** the SELECT policy SHALL independently require the object's owner segment to match that
  column, so the two controls fail independently rather than in series

#### Scenario: A ride's map tile is visible to exactly the ride's audience
- **WHEN** a rider fetches an object under `ride-maps/`
- **THEN** it SHALL be permitted if and only if the `rides` row naming it is visible to them
- **AND** the policy SHALL NOT narrow it to the crew, because the tile depicts `meeting_point`,
  which the same screens render as text to everyone who can see the ride
- **AND** `private.is_ride_crew` SHALL NOT appear in any `storage.objects` policy

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
UPDATE grant to `authenticated`. **The absence is the enforcement**: with RLS on, a command with no
policy is refused for every row.

The grant is the second, independent layer — the one that still holds if a future policy is
written too permissively. `009` applied this to `postcard_likes` and `blocks`, `011` to
`postcard_comments`, `postcard_hides` and `postcard_reports`, and each stated the same reason: a
table with no mutable column has nothing to grant UPDATE for. It is stated here as a rule rather
than repeated a sixth time in a migration comment.

Both tables `093` adds are in that class, and each has one column a client would otherwise be
able to write to its own advantage:

- **`club_invites`** — `status` and `responded_at` are written by `accept_club_invite` and
  `decline_club_invite` alone. A grant here would let an invitee answer on the inviter's behalf, or
  an inviter mark their own invite accepted.
- **`club_invite_links`** — `revoked_at` is written by `revoke_club_invite_link` alone. A grant on
  that column would let a client **un-revoke** by writing NULL back, which is worse than the edit it
  appears to allow.

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

#### Scenario: Neither table takes an UPDATE
- **WHEN** `has_table_privilege` is asked for `authenticated` and for `anon`, for UPDATE, on both
  tables
- **THEN** all four answers SHALL be false, asserted per grantee — a table-wide count reads 2 against
  a correct database, because `postgres` and `service_role` hold everything by Supabase default
- **AND** `pg_policies` SHALL show no UPDATE policy on either

#### Scenario: The CRUD set is deliberately incomplete
- **WHEN** a later change adds an UPDATE policy to either table
- **THEN** it SHALL state which RPC it replaces and why, because completing the set is how the
  un-revoke and the answer-your-own-invite paths arrive

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

### Requirement: A column whose value comes from a third party SHALL carry the evidence that admitted it

Where a column's value is obtained from an external provider rather than authored by a rider, the
row SHALL also carry the quality signal that justified storing it, and a CHECK SHALL make the two
inseparable. A value SHALL NOT be storable without its evidence.

`rides.latitude` is a **guess** produced by geocoding free text. A coordinate with no record of how
confident the geocoder was is indistinguishable from a coordinate somebody typed, and the rule that
would have rejected it lives in a function that a client can decline to call.

#### Scenario: The coordinate and its confidence stand or fall together
- **WHEN** a coordinate is written to a ride
- **THEN** a CHECK SHALL require a confidence value at or above the stated floor to be present in
  the same row
- **AND** the CHECK SHALL equally require that a row with no coordinate carries no confidence, so
  the two cannot drift apart

#### Scenario: The derived artifact requires the value it was derived from
- **WHEN** a tile path is written to a ride
- **THEN** the CHECK SHALL require a coordinate to be present
- **AND** the converse SHALL NOT be required, because a successful geocode followed by a failed
  render or upload is a real end state that must remain writable

#### Scenario: What the database cannot check is stated rather than implied
- **WHEN** the constraint is documented
- **THEN** it SHALL state that the provider's match granularity is **not** checked by the database,
  because the row does not carry it
- **AND** the rule SHALL NOT be described as database-enforced on that axis
- **AND** a rider writing a value that disagrees with their own free-text field SHALL be recorded
  as within their authority, since they author that field

#### Scenario: A stale derivative is cleared by the database, not by the writer
- **WHEN** the source field a stored value was derived from changes
- **THEN** a trigger SHALL clear the derived value and every artifact of it in the same statement
- **AND** the clearing SHALL win over values supplied by that same statement, so it SHALL be a
  `BEFORE` trigger rather than a follow-up write a client could race

#### Scenario: The clearing trigger is scoped to the field it watches
- **WHEN** the trigger is written
- **THEN** it SHALL be scoped with `WHEN (old.<field> IS DISTINCT FROM new.<field>)`
- **AND** the reason SHALL be recorded against the bulk updates that already run on the table —
  `propagate_club_privacy_to_rides` rewrites `is_public` across every ride in a club, and an
  unscoped trigger would clear every one of their derivatives at that moment

### Requirement: A `security definer` function reached by a client SHALL re-check authorization internally

`public.delete_owned_club` is the first function in this repo that a **client** calls with
elevated rights. Every existing `security definer` function is either own-row by construction
(`accept_terms`, `complete_onboarding`, `my_onboarding_state`), narrow by construction
(`moderate_comment` deletes one comment on a postcard the caller authored), a policy helper
(`private.is_*`), or `service_role`-only (`private.transfer_owned_clubs`). This one takes an
arbitrary id from the client and destroys rows.

Therefore any `security definer` function granted to `authenticated` SHALL:

- **Re-state the authorization predicate its caller's RLS would have applied.** `security
  definer` runs with the owner's rights, so the `clubs` DELETE policy does not protect the rows
  the function touches. The ownership test is the function's own job and its absence is not
  visible in any policy listing.
- **Pin `SET search_path`**, so a client-controlled `search_path` cannot redirect a table
  reference inside a definer-rights body.
- **Be asserted by naming the role**, `has_function_privilege('authenticated', …, 'EXECUTE')`,
  rather than by calling it. The RLS suite runs as the table owner, for whom the `EXECUTE`
  barrier does not exist — `031` shipped a function nothing could call because the suite could
  call it fine.
- **Be asserted for refusal by a non-owner**, not only for success by an owner. A definer
  function that has lost its ownership check passes every positive test.
- **Be recorded in `CLAUDE.md`'s security-advisor table.** It raises
  `authenticated_security_definer_function_executable`, taking the count from six to seven and
  the total from eight to nine. An advisor absent from that table reads as a regression; a
  deliberate one that was never added there reads as a regression for ever.

#### Scenario: The ownership check is removed from the function body

- **WHEN** `delete_owned_club` is altered so it no longer compares `owner_id` to `auth.uid()`
- **THEN** the RLS suite SHALL fail on the non-owner refusal assertion

### Requirement: A cascade whose blast radius crosses an ownership boundary SHALL be disclosed at the point of action

`postcards.club_id → clubs` is `ON DELETE CASCADE`, so deleting a club destroys postcards authored
by riders who are not the actor. The cascade itself is settled (`009`, for a club deleted by its
owner) and is not reopened. What this requirement adds is that **the database's blast radius SHALL
be surfaced to whoever triggers it**, with live counts read under the actor's own RLS, before the
irreversible step.

This generalises past the club case on purpose: the next `ON DELETE CASCADE` that crosses from one
rider's row to another rider's content inherits it.

#### Scenario: A destructive action's counts cannot be read

- **WHEN** the counts behind a cross-ownership cascade cannot be fetched
- **THEN** the destructive action SHALL be refused rather than offered with a blank or zero count

### Requirement: A trigger that rewrites rows a client did not name SHALL be disclosed before the write

`propagate_club_privacy_to_rides` fires on a club's `is_public` update and rewrites `rides` rows
the client never mentioned, one-directionally. A rider toggling one switch cannot infer that from
any screen.

Any trigger that mutates rows outside the client's own statement SHALL be surfaced in the UI that
triggers it, including whether the effect reverses. Silent fan-out that is *additive* — the `036`
notification triggers — is exempt; this requirement is about fan-out that **destroys or
downgrades** existing state.

#### Scenario: A club is made private

- **WHEN** the owner submits `is_public = false`
- **THEN** the screen SHALL have stated beforehand that the club's public rides become private and
  are not restored by making the club public again

### Requirement: A timestamp compared against a server-generated one SHALL be generated by the same clock

Where a stored timestamp is compared against a column the database generates, that timestamp SHALL
also be generated by the database. A client-supplied value SHALL NOT be placed on either side of
such a comparison.

**This is narrower than "the server owns this column" and it catches a case that rule does not.** A
read watermark is not obviously server-owned — the rider is the authority on what they have read, so
letting the client say "I read up to here" reads as correct. It stops being correct the moment the
other operand is a server timestamp: the comparison then spans two clocks that nothing keeps in
step, and a phone running minutes fast marks as read everything that arrives in that window while a
slow one re-shows what the rider already saw. **Nothing fails, nothing logs, and the wrong answer is
per-device**, so it cannot be reproduced from another handset.

`034` already made the server own `ride_messages.created_at` so that a device clock never orders a
conversation. This requirement is the other half of that ruling: an ordering guarantee on one side
of a comparison is worth nothing if the other side is a guess.

**The already-shipped instance is named rather than left to be rediscovered.**
`feed_reads.last_seen_at` is written by `markClubSeen` and `markFeedSeen` as
`new Date().toISOString()` and is compared inside `club_unread_counts()` against
`postcards.created_at` and `rides.created_at`. That is this defect, live, on a shipped path. It is
recorded here and deliberately not fixed by this change, which touches a different table.

#### Scenario: The stored value is the database's, whatever the client sent
- **WHEN** a client writes a timestamp that will be compared against a server-generated column
- **THEN** the stored value SHALL be server time
- **AND** the enforcement SHALL be a trigger or a withheld column grant, never the client sending
  the right thing

#### Scenario: An upsert is covered on both arms
- **WHEN** the value arrives through an upsert
- **THEN** the imposition SHALL fire on INSERT **and** on UPDATE
- **AND** a `BEFORE INSERT` trigger alone SHALL NOT be accepted, because the second visit to the
  same row takes the UPDATE arm and would keep the client's value

#### Scenario: A DEFAULT is not the enforcement
- **WHEN** the column carries `default now()`
- **THEN** that SHALL NOT be treated as satisfying this requirement
- **AND** the reason SHALL be stated: a DEFAULT applies only when the column is omitted, and an
  upsert's UPDATE arm must name it

#### Scenario: The comparison is identified before the column is designed
- **WHEN** a new table stores a timestamp
- **THEN** the migration SHALL state what that timestamp is compared against, if anything
- **AND** where the answer is "a column the server generates", this requirement SHALL apply

### Requirement: A shared metered resource SHALL be rationed by the database, and never by the client of the metered service

Where a third party meters a quota that every rider draws on, the ceiling SHALL be a policy in
Postgres, evaluated under the calling rider's own role, and SHALL NOT live in the code that calls the
vendor.

Three properties force this and none of them is a preference:

- **The caller cannot count.** Edge Functions are stateless and multi-instance, so an in-memory
  counter counts one instance's traffic and a rider issuing concurrent requests bypasses it entirely.
- **The caller holds no service-role key**, by decision #8 and by the account-deletion precedent, so
  it cannot be given a privileged side channel in which to keep score without giving it the thing
  the architecture exists to withhold.
- **Nothing type-checks or gates an Edge Function.** `tsconfig.json` excludes them, deploying is an
  owner action with no CI path, and `031` is the standing lesson that an assumption about what a
  non-client role can reach goes unnoticed because the RLS suite runs as the table owner. A ceiling
  living only in a function is a ceiling one unreviewed deploy can remove.

The count SHALL be recorded **before** the metered call, and SHALL count *attempts*, never successes.
A counter that rises on success alone misses the retry loop, which is the only traffic pattern that
can exhaust a quota.

The ceiling SHALL be enforced at two scopes — per subject and per application — because a per-subject
ceiling alone permits a hundred honest subjects to exhaust the same quota, and an application-wide
ceiling alone lets one subject spend everyone's share.

The counting function SHALL be `security definer`, SHALL live outside the schema PostgREST routes to,
and SHALL NOT be executable by any client role: a subject-taking counter that a rider can call is an
oracle for another rider's activity.

#### Scenario: The ceiling refuses at the boundary, under the rider's own role
- **WHEN** a subject at their ceiling attempts another metered operation
- **THEN** the row recording the attempt SHALL be refused by the INSERT policy
- **AND** the refusal SHALL happen before the vendor is contacted
- **AND** the same refusal SHALL occur whether the request arrives through the application, through
  PostgREST directly, or concurrently from several devices

#### Scenario: A subject cannot forge their own headroom
- **WHEN** a rider writes to the metering table by hand
- **THEN** the subject column SHALL be forced to `auth.uid()` by the policy
- **AND** the timestamp SHALL be server-owned, with no INSERT or UPDATE grant on it for any client role
- **AND** the table SHALL carry no UPDATE and no DELETE grant for any client role, so recorded spend
  cannot be erased

#### Scenario: The metered table is gated like every other participation surface
- **WHEN** an account that has not accepted the terms attempts a metered operation
- **THEN** the write SHALL be refused by the same participation gate that guards every other content
  table
- **AND** the count of tables carrying that gate SHALL be re-derived rather than read from prose, since
  a table added without one is indistinguishable from the list being right

#### Scenario: The ceiling is asserted by grantee, not by table
- **WHEN** the RLS suite covers the metering table
- **THEN** every grant assertion SHALL name its grantee, because `postgres` and `service_role` hold
  everything by Supabase default and a table-wide count reads a false pass
- **AND** at least one assertion SHALL prove the refusal is not vacuous by admitting a write below the
  ceiling and refusing the one that crosses it

### Requirement: An opaque third-party identifier SHALL be stored as provenance, namespaced, and never as a join key

A column holding an identifier issued by an outside system SHALL be documented, constrained and read
as *evidence of where a value came from*. It SHALL NOT be joined on, resolved, or relied upon to
still mean anything.

The identifier SHALL carry its source. An unnamespaced id is indistinguishable from the next
provider's, and the day a provider changes, every stored row silently claims to have come from the
new one.

There SHALL be no foreign key. A reference table that is loaded wholesale, or that can be retired
entirely, cannot carry one without either blocking every reload or destroying every referencing row
on one.

The column's length bound SHALL be set from a measured identifier. A bound that admits the previous
provider's format and refuses the next one turns every write into a constraint violation the rider
can neither see nor shorten.

#### Scenario: A dangling identifier is the designed state
- **WHEN** the system that issued a stored identifier is retired
- **THEN** rows carrying it SHALL be unchanged, unrewritten and unbackfilled
- **AND** every screen reading those rows SHALL render from the values stored beside the identifier
- **AND** nothing SHALL attempt to resolve it

#### Scenario: Provenance survives a provider change
- **WHEN** two providers have issued identifiers into the same column
- **THEN** a reader SHALL be able to tell which provider issued any given one from the row alone
- **AND** any CHECK or trigger keyed on "this value was chosen rather than derived" SHALL continue to
  hold for both

#### Scenario: The bound is raised before the first write that needs it
- **WHEN** a new provider's identifier is longer than the constraint admits
- **THEN** the constraint SHALL be widened in a migration that lands before the code that writes one
- **AND** the widened bound SHALL be recorded with the measurement that produced it, not with an
  estimate

### Requirement: A requirement the database does not carry SHALL be scoped to the gate that introduced it, and SHALL NOT be readable as an invariant

Where a change makes a value mandatory at one entry point without a CHECK, a trigger or a policy
behind it, the change SHALL state that the value remains permanently optional everywhere else, SHALL
scope the refusal to that one entry point, and SHALL NOT permit any read, type or query to begin
assuming the value is present.

`clubs.location_name`, `location_place_id`, `latitude` and `longitude` are the case. Creating a club
without them is refused by the client; **the database refuses nothing**, and that is the design
rather than a gap.

**`CLAUDE.md`'s rule that no new integrity rule may live only in a Zod schema is not being broken,
and the reason is that this is not an integrity rule.** An integrity rule says what a value *may be*
and must therefore live where the client cannot reach it. This says what one screen *insists on
collecting*. The database's statement about a club's location is unchanged — it may be absent, for
ever — and `066`'s coupling CHECK, which requires the four to arrive together or all stay null,
remains the only thing Postgres says about them.

Two consequences, and the second is the dangerous one:

- **A client that skips the gate creates a locationless club and is refused by nothing.** Accepted:
  the column has always permitted it, every reader already tolerates it, and no policy, count or
  visibility decision depends on it. **Not** because such a club resembles the ones that exist —
  measured 2026-09-08, DEV 15/15 and PROD 2/2 carry a location, so today it would resemble none of
  them.
- **A later reader must not turn "a club must say where it is based" into a non-null assumption.**
  A non-null type, a `!`, or a distance sort that reads absence as zero breaks the moment any row
  carries NULL — an owner clearing the field on edit, or a club created before this gate — and
  breaks silently. **The count of such rows today is zero, and that is exactly why this is written
  down**: a reader who checks the database finds every row populated and concludes the assumption is
  safe.

#### Scenario: The gate is scoped to creation
- **WHEN** a club is created through the app with no location
- **THEN** the create action SHALL refuse it with a field message naming the field, before any write
- **AND** a club is **edited** with no location — because it never had one — the edit SHALL succeed,
  and all four columns SHALL be written as NULL exactly as they are today
- **AND** the two SHALL be expressed as two schemas sharing one body, never as one schema with a
  conditional, because a conditional is how the edit path silently acquires the gate

#### Scenario: The database refuses nothing, and this is asserted rather than assumed
- **WHEN** a signed-in rider inserts a `clubs` row with all four location columns NULL, by any route
  that is not the create form
- **THEN** the insert SHALL succeed, `066`'s `clubs_location_coupling` SHALL be satisfied, and no
  CHECK, trigger or policy SHALL refuse it
- **AND** this change SHALL add no migration, no `NOT NULL` and no backfill
- **AND** the RLS suite SHALL gain no new assertion, because no policy or constraint moved — stated
  so a reviewer does not read the absence as an omission

#### Scenario: Every read keeps its null branch
- **WHEN** any surface reads a club's location — `/clubs/explore`, `ExploreClubsStrip`, a club detail
  page, a distance sort
- **THEN** it SHALL tolerate NULL permanently, SHALL NOT hide or filter out a club that carries none,
  and SHALL NOT treat an absent coordinate as `0`
- **AND** the existing guard in `src/lib/data/clubs.ts` —
  `if (!near || item.latitude === null || item.longitude === null) return item` — SHALL remain, and
  no type SHALL be narrowed to non-null on the strength of this change

#### Scenario: Every role's reach is unchanged
- **WHEN** this change ships
- **THEN** any signed-in, onboarded rider SHALL still be able to create a club and become its owner,
  and an un-onboarded rider SHALL still be refused by `023`'s participation gate rather than by this
  form
- **AND** a club **admin**, **member** and **non-member** SHALL still be unable to set or change that
  club's location; only the owner may, through the edit path, under the policy that already governs it
- **AND** a **blocked** rider SHALL be unaffected in both directions, because blocking governs
  visibility and membership and this change touches neither
- **AND** a signed-out visitor SHALL reach none of it: `/clubs/new` is not a public path and `anon`
  holds no grant on `clubs`

### Requirement: A function that widens a table's reach SHALL name every column it returns, and that list SHALL be the whole disclosure

Where a `security definer` function exists in order to let a rider read something their own row
security refuses, its return list SHALL be enumerated column by column in the migration, and the
rule SHALL be that the enumeration **is** the security statement — not a summary of it.

Such a function SHALL NOT return `select *`, SHALL NOT return a composite of the underlying row
type, and SHALL NOT return a column added to the underlying table later without a migration that
says so.

This is `062`'s discipline generalised. There, the narrow return was *ids only*, because the rows
themselves were readable and only the correlation needed widening. Here the row is **not** readable,
so the function must return values — which makes the column list the entire boundary and makes
`select *` a permanent, silent widening.

#### Scenario: The accessor's return list is enumerated and pinned
- **WHEN** `public.discoverable_private_clubs` is created
- **THEN** its `returns table (…)` SHALL name exactly seven columns
- **AND** the suite SHALL pin that list, so that a column added to `public.clubs` cannot reach a
  non-member by being added to this function without a review

#### Scenario: A composite return type is refused
- **WHEN** the function's signature is reviewed
- **THEN** it SHALL NOT be `returns setof public.clubs`, and the migration SHALL state why: that
  form makes every future `alter table public.clubs add column` a widening with no diff to notice
  it in

#### Scenario: Two shapes of the same widening share one body
- **WHEN** both the list of discoverable clubs and a single club's preview are needed
- **THEN** they SHALL be one function with an optional filter argument, not two functions
- **AND** the reason SHALL be `060`'s: two copies of one visibility rule drift, and the copy that
  drifts is the one nobody read

### Requirement: A membership row written for a rider other than its subject SHALL be written by exactly one function, and that function SHALL restate the gate

`public.club_members` has had exactly two writers: the rider themselves under the INSERT policy
(`auth.uid() = user_id`), and `complete_onboarding` (`058`). This change adds a third, which is the
first that writes a membership row **on one rider's behalf at another rider's instruction**.

Every such writer SHALL be a single named function; SHALL hardcode `role = 'member'` rather than
reading a role from its input; SHALL restate the participation gate for the **subject** of the row,
because `enforce_participation_gate` carries `when (current_user = 'authenticated')` and cannot
fire for a definer writer; and SHALL NOT be compensated for by adding a second gate trigger.

The `club_members` INSERT policy SHALL NOT be widened to accommodate it. A definer function is not
subject to RLS, so widening the policy would grant the client something the client does not need.

#### Scenario: The INSERT policy is byte-for-byte unchanged
- **WHEN** the migration is applied
- **THEN** `club_members`' INSERT policy qual SHALL be identical to its pre-migration text
- **AND** this SHALL be asserted by equality, because "we did not need to change it" and "we
  changed it and it still works" are indistinguishable from a green suite otherwise

#### Scenario: The role is a literal
- **WHEN** the approval function's body is examined
- **THEN** `'member'` SHALL appear as a literal and the function SHALL take no role argument
- **AND** `019`'s rule that `admin` is insertable by nobody SHALL remain true after this change,
  asserted by attempting an `admin` insert through every path including the new RPC

#### Scenario: The gate cannot be bypassed by the new path
- **WHEN** an un-onboarded rider is approved
- **THEN** the write SHALL fail
- **AND** the count of `enforce_participation_gate` triggers on `club_members` SHALL be unchanged,
  asserted separately

### Requirement: A private club's NAME SHALL be discoverable while its CONTENT SHALL NOT, and the boundary SHALL be enumerated

The standing requirement *"A private club's ride SHALL NOT be publicly visible"* states one half of
this boundary. This change moves the other half and the two SHALL be stated together, because
stating only the ride half is how the club half gets assumed.

After this change, for a signed-in rider who is neither a member nor the owner of a private club
and is not blocked with its owner:

| Resource | Reachable? |
|---|---|
| the club's `name`, `location_name`, coordinates, `members_count`, `avatar_path` | **yes**, through the accessor only |
| the club's `description`, `cover_image_path`, `owner_id`, `created_at`, `is_default` | no |
| the club's avatar or cover **bytes** in `storage.objects` | no |
| any `club_members` row for it | no |
| any `rides` row for it | no |
| any `postcards` row scoped to it | no |
| any `club_threads` or `club_messages` row for it | no |
| any `feed_reads` or `club_thread_reads` row for it | no |
| the `clubs` row itself, by any query | no |
| any notification naming it | no |

#### Scenario: Every negative row is asserted separately
- **WHEN** the suite covers this table
- **THEN** each `no` SHALL be its own assertion with its own label, because a single combined
  assertion cannot say which predicate did the work and a later change that breaks one of them
  would still pass

#### Scenario: The positives are asserted as positives
- **WHEN** the suite covers the `yes` row
- **THEN** the accessor SHALL be asserted to **return** the club for a non-member
- **AND** a suite that only proves the negatives cannot tell an intended reach from one nobody
  noticed

#### Scenario: The blocked rider is excluded from both columns
- **WHEN** the reader is blocked with the club's owner in either direction
- **THEN** every row in the table above SHALL be **no**, including the first

### Requirement: A privileged operation on a shipped table SHALL restate the authority the table's policies would have carried

`security definer` runs with RLS bypassed — measured on Postgres 16 for `021` §3 and relied on
again — so a definer function that writes `club_members` inherits **none** of `008`'s, `019`'s or
`048`'s protections. Each of the three new RPCs SHALL therefore restate, in its own body:

- **who the caller must be**, read from `clubs.owner_id` and `club_members.role` rather than from
  any caller-relative helper's convenience;
- **who the target may be**, including the explicit `rider <> clubs.owner_id` conjunct that a
  role-only predicate does not supply for `054`'s ownerless owner;
- **that the caller is not the target.**

Each SHALL have exactly one raise site, and each SHALL be `set search_path = ''` with
`#variable_conflict error` — `043`'s shape, and `043`'s stated reason for the pragma: the guarantee
becomes local to the function rather than depending on a cluster GUC an operator can set to
`use_column`.

#### Scenario: The definer marking and the search path survived the apply
- **WHEN** `prosecdef` and `proconfig` are read for all three functions
- **THEN** each SHALL be `t` and `{search_path=""}`
- **AND** each SHALL be asserted individually rather than counted, because a function created
  without `security definer` is otherwise a code review rather than a red test

#### Scenario: Reachability is asserted by naming the role
- **WHEN** the three functions' grants are checked
- **THEN** `has_function_privilege('authenticated', …)` SHALL be true and
  `has_function_privilege('anon', …)` SHALL be false for each
- **AND** PUBLIC's default EXECUTE grant SHALL be gone for each
- **AND** none SHALL be asserted by attempting the call, because the suite runs as the table owner
  for whom no barrier exists — `031`'s lesson

### Requirement: A private club's avatar object SHALL be readable by exactly the audience that can already read its name, and its cover SHALL NOT

`016`'s `"Club avatars are readable with the club"` policy SHALL gain a third disjunct admitting a
rider for whom `private.club_takes_join_requests(c.id)` is true. `"Club covers are readable with the
club"` SHALL be untouched: an avatar is the club's identity and a cover is its content.

**The disjunct SHALL use the ONE-argument caller-relative wrapper.** The two-argument
`private.club_takes_join_requests_for(uuid, uuid)` is revoked from `authenticated` by `085`, a
`storage.objects` policy is evaluated as the querying role, and the two-argument form would raise
`42501` on every club-avatar read for every rider — a worse failure than the initials it replaces,
and invisible to any test that only inspects the policy text.

The `(storage.foldername(name))[2] = c.owner_id::text` binding SHALL be carried into the new
disjunct verbatim. It is `010` §2's line and `016`'s second of two independent locks: without it,
attaching another rider's object path to a club you own makes that object readable to the club's
audience.

The accepted cost SHALL be stated rather than implied: **every private club's avatar image becomes
readable to every signed-in rider not blocked with that club's owner** — the same audience
`public.discoverable_private_clubs` already gives the club's name, town and member count to.

#### Scenario: A discoverer reads the avatar and not the cover
- **WHEN** a rider who may request to join a private club reads `storage.objects` for that club's
  `avatar_path` and for its `cover_image_path`
- **THEN** the avatar SHALL return one row and the cover SHALL return **zero**
- **AND** `085.6`'s cover half SHALL be reproduced unchanged, so the assertion that a non-member
  reads no cover survives this change verbatim

#### Scenario: A blocked rider reads neither
- **WHEN** a `blocks` row exists in either direction with the club's owner
- **THEN** `private.club_takes_join_requests` SHALL be false and the avatar SHALL return zero rows

#### Scenario: The policy is callable by the role that evaluates it
- **WHEN** the new disjunct is read from `pg_policies`
- **THEN** it SHALL name the one-argument form, and
  `has_function_privilege('authenticated','private.club_takes_join_requests(uuid)','execute')` SHALL
  be true
- **AND** the two-argument form SHALL remain revoked from `authenticated`, asserted separately

#### Scenario: A member's and an owner's reads are unchanged
- **WHEN** the club's own members and owner read both objects
- **THEN** both SHALL resolve exactly as they do today, through the two disjuncts `016` already
  carries

### Requirement: A reaction table SHALL inherit its subject's audience through a parent `EXISTS`, and SHALL restate nothing

Where a table holds a rider's reaction to a row in another table, its SELECT and INSERT policies
SHALL consist of exactly two conjuncts:

1. an `EXISTS` against the parent row, evaluated under the caller's own row security; and
2. a symmetric block arm on the **reactor**, with an own-row escape hatch —
   `user_id = auth.uid() or not private.is_blocked(auth.uid(), user_id)`.

It SHALL restate no membership predicate, no club-visibility predicate, no role test and no block
arm on the parent's own author. The parent's policy already answers all of them, and the `EXISTS`
runs under the caller's session, so the reaction's audience tracks the subject's exactly.

This is `009`'s `postcard_likes` shape stated as a general rule because this change is the second
and third instance of it, and the reason it works is easy to lose: *"the EXISTS subquery is
evaluated under the querying rider's own RLS, so like visibility tracks postcard visibility exactly
rather than restating it… Restating it would be two predicates that have to be kept in step, and
the one that drifts is the one nobody reads."*

**The INSERT policy SHALL use the same `EXISTS` as SELECT**, so "cannot react to what you cannot
see" is one predicate rather than two that can diverge.

#### Scenario: A reaction policy names no audience of its own
- **WHEN** a reaction table is added
- **THEN** its policies SHALL name only its own key columns, the parent `EXISTS`, and the reactor
  block arm
- **AND** a policy change on the parent SHALL move the reaction's audience with no edit anywhere

#### Scenario: The parent's own block arm is not copied
- **WHEN** the parent's SELECT policy carries a block arm on its author
- **THEN** the reaction's policy SHALL NOT repeat it
- **AND** a reaction by an unblocked rider on a row by a blocked one SHALL be unreachable because
  the parent row is, not because the reaction restated the rule

### Requirement: A reaction count SHALL be computed under RLS, SHALL NOT be stored, and SHALL NOT be used as a shared fact

A count of reactions SHALL be an aggregate over the rows the caller's own policies return. It SHALL
NOT be denormalised into a column on the parent or anywhere else.

**The count is therefore per-viewer, and what that forbids SHALL be stated wherever it is
defined.** Because two riders may legitimately see different totals for one row, a reaction count
SHALL NOT order, rank or sort any list; SHALL NOT provide a cursor or page boundary; and SHALL NOT
feed a threshold, badge or label that implies a shared judgement.

`009` refused a `like_count` column for the disclosure half of this and it was right. The coherence
half is the part no screen makes visible: a rider blocked by everyone still reads their own count
as `1`, and the obvious repair — a global count — discloses that a hidden rider exists and acted,
which decision #2 forbids.

#### Scenario: No denormalised count column is added
- **WHEN** a reaction table is added
- **THEN** no column holding a count of its rows SHALL be added to any table
- **AND** no trigger SHALL maintain one

#### Scenario: A per-viewer number never becomes an ordering
- **WHEN** any list containing reactable rows is ordered
- **THEN** the ordering key SHALL be a value every viewer computes identically
- **AND** a reaction count SHALL NOT appear in an `order by`, a keyset cursor or a page boundary,
  because a per-viewer sort key makes pagination differ per rider

### Requirement: A row whose subject is a MEMBERSHIP SHALL key to the membership, not to the rider

Where a derived or reaction row is about a rider's presence **in a container** — a club membership,
a ride crew place — its foreign key SHALL address the membership row, so that leaving cascades it
away.

Keying such a row to `profiles` alone produces a row that outlives the thing it describes, is
unreachable from any screen, survives an account deletion of neither party, and **reappears if the
rider rejoins** — asserting a fact about a membership that did not exist when the row was written.

`club_members`' primary key is `(club_id, user_id)`, so a two-column foreign key with
`ON DELETE CASCADE` is available and SHALL be used. The reactor's own key to `profiles` is separate
and SHALL remain, so deleting the reactor's account removes their rows independently.

**Both foreign keys into `profiles` SHALL have an index Postgres can use**, per the standing rule.
A composite primary key leading with another column does not serve one.

#### Scenario: Leaving cascades the rows about the membership
- **WHEN** a rider leaves a club
- **THEN** every row keyed to that membership SHALL be deleted by cascade
- **AND** no client code SHALL be responsible for the cleanup

#### Scenario: A rejoin does not resurrect them
- **WHEN** that rider rejoins
- **THEN** the new membership SHALL carry none of the old rows
- **AND** nothing SHALL assert a fact about the previous membership

#### Scenario: Every profile foreign key leads an index
- **WHEN** a table referencing `public.profiles` is added
- **THEN** an index leading with that column SHALL be added in the same migration
- **AND** the assertion SHALL read the catalog rather than time a deletion

### Requirement: A new content table SHALL carry the participation gate, or SHALL state why it does not

Any table holding rider-authored content visible to another rider SHALL carry a `BEFORE INSERT`
`enforce_participation_gate` trigger with `when (current_user = 'authenticated')`.

The `when` clause SHALL be present and SHALL NOT be moved into the function body: inside a
`security definer` body `current_user` is the owner, so a body guard is true on every call and the
gate never fires (`023` §2, measured).

The gate count SHALL be **measured** after the migration rather than asserted from prose, and the
suite SHALL additionally assert the trigger's presence **by table name** — a flat count cannot
distinguish a new table's gate from a moved one, which is the error `078`'s own task list made in
the other direction.

#### Scenario: A reaction table is gated
- **WHEN** a table holding a rider's reaction visible to others is added
- **THEN** it SHALL carry the gate trigger
- **AND** an account with `terms_accepted_at` NULL SHALL be refused the write by the database

#### Scenario: The count is re-derived
- **WHEN** the migration is applied
- **THEN** `select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not
  tgisinternal` SHALL be run against both projects
- **AND** the number SHALL be recorded with that command beside it, never alone

### Requirement: A DELETE policy on an own-row table SHALL be reachable, and the SELECT policy is what decides

A table whose rows a rider may delete SHALL be checked for the interaction `081` measured: RLS
applies the **SELECT** policy to a `DELETE` whose `WHERE` names a column, so a row the caller owns
but cannot read survives its own delete with PostgREST reporting success.

For an own-row table this SHALL be made unreachable by the SELECT policy's own-row disjunct —
`user_id = auth.uid()` — rather than by relaxing the DELETE policy, which changes nothing because
SELECT is applied first.

The own-row disjunct SHALL therefore be asserted as **load-bearing for the delete path**, so that
removing it is caught rather than mistaken for a tightening.

#### Scenario: An own row is deletable however the caller is blocked
- **WHEN** a rider deletes their own row on a table whose parent has since become invisible to them
- **THEN** the row SHALL be deleted
- **AND** the delete SHALL NOT report a silent success against zero matched rows

#### Scenario: Removing the own-row read arm breaks the delete
- **WHEN** the SELECT policy's `user_id = auth.uid()` disjunct is removed
- **THEN** an assertion SHALL fail
- **AND** the failure SHALL name the delete path, because the change looks like a tightening and
  its cost is invisible from the DELETE policy alone

### Requirement: A grant one rider can cause for another SHALL be re-derived at every use, never trusted from creation

Where a rider's action creates something that will later admit **another** rider — an invite, a
capability token — the authority behind it SHALL be evaluated again at the moment of use, against the
current state of the club and of the rider who created it. A policy check at creation SHALL NOT be
treated as evidence of authority at redemption.

**This is a new class of rule in this schema, and it exists because every other grant here is a fact
that is still true when it is read.** Ownership, membership and a block are all evaluated at read
time by construction. An invite is the first artefact that carries a *past* decision forward, and a
past decision by a rider who has since left, been demoted, or whose club has changed shape is not a
decision the club is still making.

`private.may_invite_to_club_for(candidate, club)` SHALL therefore be called by:

- the INSERT policy, through its caller-relative wrapper;
- `private.join_club_from_invite`, for the **inviter** or the link's **minter**, before the
  membership row is written;
- `private.club_invite_is_answerable_for` and `private.club_invite_link_reachable_by`, so a dead
  grant disappears from the surface rather than presenting a control that always fails.

`091`'s `expires_at` is the same rule in its narrow form — the ride's departure is re-read at every
use rather than trusted from the stored column — and this requirement generalises it from a
timestamp to an authority.

#### Scenario: An outstanding invite dies with its inviter's authority
- **WHEN** the inviter leaves the club or is demoted from `admin`, and the invitee then accepts
- **THEN** no membership row SHALL be written, and the refusal SHALL be the surface's single
  indistinguishable message

#### Scenario: A pointer does not become a grant when the club changes shape
- **WHEN** an ordinary member invites a rider to a **public** club and the club is then made private
- **THEN** the accept SHALL be refused, because `may_invite_to_club_for` is false for a member of a
  private club
- **AND** the same invite sent by an **admin** SHALL still be accepted

#### Scenario: The check is in the writer, not only in the policy
- **WHEN** `private.join_club_from_invite`'s body is read
- **THEN** it SHALL contain the authority test, the participation test and both block tests, because
  a `security definer` writer bypasses the policies and the trigger that would otherwise carry them

#### Scenario: A single raise site survives the extra checks
- **WHEN** any of those tests fails
- **THEN** the function SHALL return `false` rather than raising, so its caller keeps one observable
  failure and a block is not disclosed by a second error string or a different SQLSTATE

### Requirement: A widened authority SHALL reuse the existing predicate rather than restate it

When an existing `security definer` function's authority is widened to a role another function
already admits, it SHALL delegate to the **same predicate helper** and SHALL NOT write a second
expression that happens to mean the same thing.

For club authority that helper is `private.is_club_admin_for(candidate uuid, target_club uuid)`
(`085`), which `088`'s three manage-riders RPCs and `085`'s approval RPC already call. A body
writing `clubs.owner_id = auth.uid() or exists (club_members … role in ('owner','admin'))` inline
SHALL be treated as a defect even though it evaluates identically today: two spellings of one rule
drift, and the drift is silent because both look correct in isolation.

Adding the helper **beside** the predicate it replaces — `c.owner_id = v_uid or
private.is_club_admin_for(…)` — SHALL likewise be treated as a defect. The helper's first disjunct
is that predicate.

A `security definer` function MAY call a `private` helper no client role holds EXECUTE on, because
it runs as the owner. A grant added to "make it work" SHALL be treated as a defect: the caller is
wrong, not the ACL.

#### Scenario: The widened function names one predicate
- **WHEN** the moderation function's body is read after the change
- **THEN** it SHALL contain exactly one authority expression, and that expression SHALL be a call to
  `private.is_club_admin_for`

#### Scenario: The helper's body is pinned by equality
- **WHEN** the helper is relied on for the owner arm
- **THEN** its body SHALL be compared by **equality**, never by `like`, because a mention of the
  name in a comment satisfies a pattern match

### Requirement: Ownership SHALL be tested at `clubs.owner_id`, and a role-only predicate SHALL be treated as a regression

`clubs.owner_id` is the column that establishes ownership. `club_members.role = 'owner'` is a roster
row kept in step with it, and a club owner holding **no** roster row was a reachable state (`054`,
PD-128) until `103` wrote the owner's row in the same statement as the club and repaired every club
that lacked one. The owner arm SHALL stay regardless, because a predicate SHALL NOT depend on an
invariant a trigger enforces elsewhere.

Any predicate deciding an owner's authority SHALL therefore include the `clubs.owner_id` arm —
directly, or through a helper whose first disjunct is that arm. A predicate written as
`club_members.role in ('owner','admin')` alone SHALL be treated as a **regression**, not a
simplification, because it would silently remove the owner's right the day that invariant breaks.

**The client carries the identical trap.** A viewer gate written as `viewer_role === 'owner' ||
viewer_role === 'admin'` SHALL be treated as the same defect as the SQL one; the correct gate reads
the ownership boolean and the role separately.

#### Scenario: An ownerless owner keeps every right they hold today
- **WHEN** an owner with no `club_members` row exercises an authority the change widened
- **THEN** it SHALL succeed
- **AND** this SHALL be asserted explicitly, because every other assertion in the change passes
  against the predicate that refuses it

### Requirement: A function SHALL be widened with `create or replace`, because a recreated function is born granted to PUBLIC

Where the signature is unchanged, an existing function SHALL be modified with `create or replace`,
which preserves its ACL and its OID.

A `drop function` followed by `create function` SHALL be treated as a defect unless the signature
forces it, and where it is forced, the `revoke all … from public, anon` and the `grant execute … to
authenticated` SHALL be re-issued in the same file (`082` §7 is the worked example).

The reason is that a newly created function is born with `EXECUTE` to `PUBLIC`, which includes
`anon` — so decision #1 is breached by a routine refactor, with nothing red anywhere.

#### Scenario: The privilege set survives the widening
- **WHEN** the function's privileges are read after the migration
- **THEN** `anon` SHALL hold no EXECUTE and `authenticated` SHALL hold EXECUTE
- **AND** the assertion SHALL exist even though the migration did not intend to touch the ACL,
  because that is precisely the case where a mistake is silent

### Requirement: A new table's revoke SHALL name `service_role` at creation

`revoke all … from anon, authenticated` SHALL NOT be considered complete for a table holding
personal data. Supabase's project default grants `service_role` SELECT, INSERT, UPDATE, DELETE,
TRUNCATE, REFERENCES and TRIGGER on a new `public` table, and `service_role` bypasses RLS.

`076` §3b measured exactly this on `postcard_reports`, sixty-five migrations after that table was
created, and described it as *"a standing leak: the only thing between that key and every reporter's
identity was that nothing had asked."* A table created after `076` SHALL name `service_role` in its
revoke from the first line.

Revoking it SHALL NOT break account deletion: a referential cascade runs as the constraint's system
trigger and does not consult privileges. That SHALL be **measured** in a rolled-back transaction
rather than reasoned, because the failure mode is account deletion breaking and nothing in CI would
notice.

#### Scenario: A new report table is unreachable by the service-role key
- **WHEN** `service_role` selects from the new table
- **THEN** it SHALL be refused
- **AND** the deletion cascade that removes a rider's rows SHALL still run

### Requirement: A new gated table SHALL carry the participation gate, and the count SHALL be claimed as a delta

Every new table admitting a client INSERT of rider-authored content SHALL carry
`enforce_participation_gate` as a `before insert … for each row when (current_user =
'authenticated')` trigger (`023`).

The `when` clause SHALL be written. It is what stops the gate firing for the table owner, and it is
also why a `security definer` writer must restate the rule in its own body — `current_user` inside a
definer function is the owner.

**The trigger count SHALL be claimed as a delta against a measurement taken immediately before the
migration applies, never as an absolute number written by hand.** It is 17 on DEV as of 2026-08-31
and concurrent changes move it before this one lands. The measurement is:

```sql
select count(*) from pg_trigger where tgname='enforce_participation_gate' and not tgisinternal;
```

The assertion SHALL check the gate **by table name** as well as by count, because a count alone
cannot tell a new gate from a moved one.

The `comment on function public.enforce_participation_gate()` SHALL be composed from the **live**
comment read at apply time rather than from a copy in an older migration file, because concurrent
changes rewrite the same string and the last writer wins.

#### Scenario: The gate is present and bites
- **WHEN** a rider whose `terms_accepted_at` is NULL inserts into the new table
- **THEN** the write SHALL be refused with `23514`
- **AND** the trigger SHALL be asserted present by table name, and the flat count asserted as the
  pre-migration measurement plus one

### Requirement: An additive migration widening a live function SHALL still take the hand-exercise gate

`036`'s gate is usually read as being about triggers hung on shipped write paths. It SHALL also
apply when a migration **replaces a function riders already call**: from the moment it applies,
every existing call runs new code inside a rider's own transaction, and a raise there takes that
rider's write down with it.

The exercise SHALL be by hand, on DEV, in a rolled-back transaction, as `authenticated`, covering
the previously-permitted caller as well as the newly-permitted one — a widening that accidentally
narrows is invisible to a test that only checks the new case.

The migration SHALL apply **before** the bundle that calls it serves, both halves being additive,
and the ordering argument SHALL be stated as which side fails safe rather than as a fixed rule.

#### Scenario: The previously-permitted caller is exercised too
- **WHEN** a function's authority is widened
- **THEN** the role that could already call it SHALL be exercised by hand alongside the new role
- **AND** the check SHALL be a real call in a rolled-back transaction, not a reading of the body

### Requirement: A foreign key whose SET NULL would null a NOT NULL column SHALL name its column list

A composite foreign key declared `ON DELETE SET NULL` nulls **every** referencing column. Where any
of them is `NOT NULL`, the referenced delete fails at runtime with a not-null violation — and the
constraint is accepted at DDL time, so the migration is green, the assertions pass, and the failure
arrives the first time a rider performs the ordinary action the key was hung off.

Any such foreign key SHALL therefore declare the column list — `ON DELETE SET NULL (<column>)` —
and the assertion beside it SHALL delete a referenced row that is **actually referenced**, because
a delete of an unreferenced row succeeds under both spellings and proves nothing.

#### Scenario: The bare form is refused by the test, not by the DDL
- **WHEN** a composite `ON DELETE SET NULL` key is declared over a column list including a
  `NOT NULL` column, without a column list
- **THEN** the DDL SHALL be accepted
- **AND** deleting a referenced parent row SHALL fail with a not-null violation
- **AND** an assertion SHALL exist that performs exactly that delete

#### Scenario: The scoped form leaves the row standing
- **WHEN** the key names its column list and a referenced parent row is deleted
- **THEN** the delete SHALL succeed
- **AND** the child row SHALL survive with only the named column nulled

### Requirement: A CHECK spanning a column that a foreign key nulls SHALL be one-directional

A foreign key's `SET NULL` action is an UPDATE, so every CHECK on the child row is re-evaluated
with that column already nulled. A CHECK asserting that two columns are *both set or both null* is
therefore violated by the very action the key exists to perform, and refuses the parent delete —
the same failure as the requirement above, one SQLSTATE further on and from a different constraint.

A pairing CHECK across such a column SHALL be written in the direction that survives the nulling:
it may require that a **set** marker implies its companion, and SHALL NOT require that a set
companion implies the marker.

#### Scenario: A biconditional pairing refuses the parent delete
- **WHEN** two columns are constrained to be both set or both null and one is nulled by a foreign
  key action
- **THEN** the parent delete SHALL fail with a check-constraint violation

#### Scenario: The surviving direction still forbids the half-state that matters
- **WHEN** the pairing is written as "a set marker implies its companion is set"
- **THEN** the parent delete SHALL succeed
- **AND** a write setting the marker without its companion SHALL still be refused

### Requirement: `club_members` SHALL carry no UPDATE policy, and adding one SHALL be treated as a role-escalation change

`authenticated` holds a column-level `UPDATE (club_id, role, user_id)` grant on `club_members` and
the table carries **no UPDATE policy**, which is the only reason that grant is inert. Row security
with no matching policy refuses every UPDATE; the grant is a survival from before the role column
had a designed writer.

Consequently, **adding any UPDATE policy to `club_members` re-arms that grant**, and the obvious
own-row policy lets an ordinary member set their own `role` to `admin` — measured on DEV, in a
rolled-back transaction. That defeats the standing requirement that a club membership role SHALL
NOT be self-assignable, and it defeats it silently: the policy that causes it reads correct, names
no role, and is two lines long.

No feature SHALL add an UPDATE policy to `club_members` in order to give a client a writable column
there. A column a client must write SHALL go on a table whose UPDATE surface is already designed,
or be written by a `security definer` function that needs no policy at all. An assertion SHALL pin
the policy count so a later change cannot add one quietly.

#### Scenario: The UPDATE policy count is zero and asserted
- **WHEN** the policies on `club_members` are enumerated
- **THEN** exactly zero SHALL be for UPDATE
- **AND** an assertion SHALL fail if that number changes

#### Scenario: A member cannot promote themselves
- **WHEN** an ordinary member attempts to update their own membership row's role
- **THEN** the write SHALL be refused, by the absence of a policy rather than by any predicate

### Requirement: A `security definer` writer SHALL restate the participation gate, and a trigger SHALL NOT be counted as covering it

Every `enforce_participation_gate` trigger carries `when (current_user = 'authenticated')`, and
`current_user` inside a `security definer` body is the function's owner. A content write performed
inside such a function is therefore **ungated by the trigger on its own table**, whatever the
trigger count says.

Such a function SHALL test the calling rider's consent stamp itself, against the subject taken from
the session. Adding a trigger instead SHALL NOT be treated as a remedy: it would raise the coverage
count while gating nothing, which is the precise failure an existing assertion already exists to
prevent elsewhere.

Where a change adds no table, its participation-gate trigger count SHALL be claimed as **unchanged**
rather than incremented, and the gate's coverage SHALL be claimed against the function.

#### Scenario: The function refuses an un-onboarded caller
- **WHEN** a rider whose consent stamp is NULL calls the writing function
- **THEN** it SHALL refuse
- **AND** the refusal SHALL come from the function body, the trigger being unable to fire

#### Scenario: No trigger is added to launder the count
- **WHEN** this change is applied
- **THEN** the participation-gate trigger count SHALL be unchanged
- **AND** no trigger SHALL be added to a table solely to make coverage read complete

### Requirement: A new content column SHALL carry its bounds as a CHECK, matching the sibling column it may be compared with

Rider-authored text added to an existing table SHALL carry a non-blank and a maximum-length CHECK
in the same migration that adds the column. A schema in the client MAY mirror the bound for the
message and the live counter and SHALL NOT be the only place it exists.

Where the new text sits beside an existing rider-authored column that readers will compare it with,
the bound SHALL be the same one, so that neither can be longer than the other for reasons nobody
decided.

#### Scenario: The bound is enforced without the client
- **WHEN** a write bypassing the client supplies whitespace only, or more than the maximum
- **THEN** the database SHALL refuse it with a check-constraint violation

#### Scenario: The bound matches its sibling
- **WHEN** the new column's maximum is compared with the message body's
- **THEN** they SHALL be equal, and the equality SHALL be stated where the column is defined

### Requirement: The shape of a notification's subject SHALL be a CHECK, and SHALL constrain every subject column for every type

`notifications_subject_shape` SHALL name **every** subject column in **every** arm — after this
change, sixteen arms each fixing five columns — with an `ELSE false` fallthrough.

**A CHECK that names only the columns a type uses is not a shape.** Adding `thread_id` and leaving
the fourteen existing arms untouched would let a `postcard_liked` row legally carry a `thread_id`,
placing it in a different equivalence class under the uniqueness index, breaking its own retraction's
four-column scope, and making it resolvable or not according to a thread nothing about it renders —
with nothing refusing it. The rule generalises: **a new subject column obliges every existing arm.**

This is the standing rule that no integrity rule may live only in client code, applied to a table no
client may write at all: the constraint is not defending against a rider, it is defending against the
next fan-out.

#### Scenario: Adding a subject column obliges every existing arm

- **WHEN** a migration adds a subject column to `notifications`
- **THEN** every existing arm of `notifications_subject_shape` SHALL be re-stated to require the new
  column NULL
- **AND** the constraint SHALL be dropped and re-added whole rather than patched, so that reading the
  file shows the complete shape

#### Scenario: The type list and the shape cannot silently disagree

- **WHEN** a type is added to `notifications_type_check` and forgotten in
  `notifications_subject_shape`
- **THEN** the insert SHALL be refused by the `ELSE false` arm
- **AND** the failure SHALL be loud at the first write of that type rather than silent for ever

### Requirement: A notification's uniqueness SHALL be `NULLS NOT DISTINCT` over every subject column

`notifications_event_key` SHALL cover the recipient, the type, the actor and **every** subject
column, with `NULLS NOT DISTINCT`. A subject column added without extending the key SHALL be treated
as a defect.

**A subject column outside the key collapses rows that name different things.** With `thread_id`
absent and `club_id` standing in, one rider's replies across every thread of one club collapse to a
single notification — the recipient is told once and never again, with no error, no log line and no
failing assertion. `NULLS NOT DISTINCT` is what makes the key fire at all, since most rows leave most
subject columns NULL; a plain UNIQUE treats two NULLs as different and the constraint would never
catch anything. That is `015`'s `feed_reads` lesson exactly.

#### Scenario: The key covers every subject column

- **WHEN** the index is derived after apply
- **THEN** the columns of `notifications_event_key` SHALL be exactly the recipient, the type, the
  actor and every subject column on the table
- **AND** this SHALL be derived from `pg_index` against `information_schema.columns` rather than read
  off a migration file

#### Scenario: Appending to the key preserves every existing collapse

- **WHEN** a column that is NULL on every existing row is appended to the key
- **THEN** no existing equivalence class SHALL split, because `NULLS NOT DISTINCT` compares those
  NULLs equal
- **AND** the rebuild SHALL therefore be provable from the data rather than argued from intent
- **AND** a failure of the `create unique index` SHALL be read as a pre-existing duplicate and
  investigated, never worked around by weakening the index

### Requirement: A trigger that must fire for every writer SHALL carry no `WHEN` clause, and one that must skip privileged writers SHALL keep its

`public.club_messages` SHALL keep its `enforce_participation_gate BEFORE INSERT … WHEN
(CURRENT_USER = 'authenticated')` trigger unchanged, and the fan-out trigger `098` adds to the same
table SHALL carry **no** `WHEN` clause. (`098` added three triggers across two tables; `101` dropped
`club_thread_waves`, and the two wave triggers with it.)

**Two triggers on one table with opposite clauses is the point, not an inconsistency.** The gate is a
rule about the client and must skip a privileged write; a fan-out is a rule about the data and must
fire for every writer, including the seed the RLS suite runs as. Copying either onto the other is a
silent defect in opposite directions: a gated fan-out never fires for a privileged write, and an
ungated participation gate refuses a `security definer` RPC.

**The participation-gate trigger count SHALL NOT move.** This change creates no table, and the
parent table already carries the gate — measured at **22** on both projects on 2026-09-01. The count
SHALL be asserted rather than left inferred, following the precedent of asserting a count that stays
still.

#### Scenario: The gate still refuses an unconsented rider on the parent table

- **WHEN** a rider with `terms_accepted_at` NULL attempts to post a club message
- **THEN** it SHALL be refused with `23514`
- **AND** zero notification rows SHALL exist afterwards, because an `AFTER` trigger never runs on a
  refused write

#### Scenario: The gate count is unchanged

- **WHEN** `select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not
  tgisinternal` is run after apply
- **THEN** it SHALL return the same number it returned before
- **AND** the assertion SHALL be present in the suite, because a table added later without a gate
  looks exactly like this count being right

#### Scenario: The fan-out fires for a write the gate skips

- **WHEN** a club message is inserted as the table owner, so the gate's `WHEN` clause is false
- **THEN** the gate SHALL not run and the fan-out SHALL still write its row
- **AND** this SHALL be asserted, because it is the exact case a copied `WHEN` clause would break and
  the case every assertion in the suite depends on

### Requirement: A club SHALL always hold an owner-membership row

For every row in `public.clubs` there SHALL exist a row in `public.club_members` with the same
`club_id`, `user_id = clubs.owner_id` and `role = 'owner'`. The rule SHALL be enforced by the
database, and the state in which it does not hold SHALL have no representation reachable by any
writer.

**This is a live defect, not a risk the change introduces.** `createClub` issues two inserts with
no transaction because PostgREST has no multi-statement transaction. Until 2026-08-06 both inserts
and a compensating delete ran inside one server request; they run in the browser now, so closing
the tab between them leaves the club without its membership row. Nothing anywhere — no CHECK, no
trigger, no constraint — currently asserts that this cannot be.

The state is not cosmetic. `private.is_club_member` has no owner arm, so an orphan club's owner is
a non-member for every purpose the schema recognises: `017` refuses them a ride in their own club,
`009` refuses them a postcard to it, `getYourClubs` omits it and `getExploreClubs` shows a public
one back to them with a `Join club` button that records them as `role = 'member'` — permanently,
because `club_members` has no UPDATE policy.

#### Scenario: Creating a club establishes the owner's membership in the same statement
- **WHEN** any signed-in rider inserts a row into `clubs`, by any route including a hand-rolled
  PostgREST request
- **THEN** the matching `club_members` row with `role = 'owner'` SHALL exist when the statement
  returns
- **AND** the client SHALL NOT be required to issue a second write for the invariant to hold

#### Scenario: A failed membership write takes the club with it
- **WHEN** the membership write raises for any reason — the participation gate, a constraint, a
  deadlock
- **THEN** the `clubs` row SHALL NOT exist afterwards, because both are one statement
- **AND** no compensating delete in application code SHALL be relied on for this

#### Scenario: The owner cannot leave their own club
- **WHEN** the rider named in `clubs.owner_id` deletes their own `club_members` row, whether
  through `leaveClub` or directly against PostgREST
- **THEN** the database SHALL reject the delete with a check violation
- **AND** the refusal SHALL NOT depend on the UI hiding the control, which is what holds this
  today
- **AND** there SHALL be exactly two exceptions, both of them elevated paths rather than client
  writes: the **voluntary-leave transfer**, which reassigns `clubs.owner_id` in the same statement,
  and the **club's own deletion**, whose cascade the guard permits because the parent row is
  already gone

> **The enforcement of this scenario ships in `095`, not here — `an-owner-leaves-their-club`
> (PD-194) carries the club-side `BEFORE DELETE` guard and the two exceptions above, and this
> change keeps the two seeding triggers, the backfill and the ride-side guard.** `design.md` §D3
> records why the split is safe in both orders and why neither change blocks the other; that
> change's §D8 records why it is a split rather than a supersession. The requirement stated here is
> unchanged and is still this change's to state — what moved is which migration enforces it.

#### Scenario: Deleting the club still works
- **WHEN** the owner deletes the club itself
- **THEN** the cascade to `club_members` SHALL succeed, because the guard SHALL permit a delete
  whose parent `clubs` row no longer exists
- **AND** the `clubs` DELETE policy SHALL be unchanged

#### Scenario: A privileged transfer is still possible
- **WHEN** a role other than `authenticated` reassigns `clubs.owner_id` and deletes the departing
  owner's membership row
- **THEN** the delete SHALL succeed, because the guard binds `authenticated` only
- **AND** this SHALL remain true so that account deletion can transfer a club rather than cascade
  it, destroying other riders' postcards — and so that a voluntary owner-leave, should one be
  built (PD-194), needs no change to this rule

#### Scenario: Existing orphans are repaired rather than left
- **WHEN** the rule is applied to a database that already contains clubs with no owner-membership
  row, or whose owner holds a row with the wrong `role`
- **THEN** the missing rows SHALL be inserted and the wrong roles SHALL be corrected
- **AND** `joined_at` SHALL be taken from `clubs.created_at` rather than the migration's clock, so
  that a tenure-ordered read of the roster is not reordered by the repair
- **AND** this SHALL NOT be read as reversing the no-backfill ruling on consent: an owner-membership
  row is derived from `clubs.owner_id`, which is already stored, whereas a consent timestamp
  records an act only the rider can perform

### Requirement: A ride's organizer SHALL hold a crew row

For every row in `public.rides` there SHALL exist a row in `public.ride_members` with the same
`ride_id` and `user_id = rides.organizer_id`. The invariant is the row's **presence**; its `status`
MAY be `going` or `maybe`.

`createRide` has the same two-insert shape and the same window as `createClub`. The consequence is
different and more visible: `toRideListItem` draws the organizer "on the ride by construction"
whether or not the row exists, while `getRideCrew` reads `ride_members` alone — so the ride card
and `/rides/detail/crew` disagree about the same ride, and `RideAttendanceBar` is hidden from the
organizer, leaving them no route back onto their own crew.

#### Scenario: Creating a ride puts the organizer on the crew
- **WHEN** any signed-in rider inserts a row into `rides`, by any route
- **THEN** the matching `ride_members` row with `status = 'going'` SHALL exist when the statement
  returns

#### Scenario: The organizer cannot leave their own crew
- **WHEN** the rider named in `rides.organizer_id` deletes their own `ride_members` row, including
  through `setRideAttendance(rideId, null)`
- **THEN** the database SHALL reject the delete with a check violation

#### Scenario: The organizer may still say maybe
- **WHEN** the organizer updates their own `ride_members.status` to `maybe`
- **THEN** the write SHALL succeed, because the invariant is presence rather than status
- **AND** the existing `ride_members` UPDATE policy SHALL be unchanged

#### Scenario: Deleting the ride still works
- **WHEN** the organizer deletes the ride
- **THEN** the cascade to `ride_members` SHALL succeed, by the same parent-is-gone rule the club
  guard uses

#### Scenario: The two read paths agree by construction
- **WHEN** any rider who can see a ride reads its card and its crew roster
- **THEN** the organizer SHALL appear in both
- **AND** no read function SHALL synthesise an organizer row it did not read, so that the rule
  lives in one place

### Requirement: Creator membership SHALL be established without a callable elevated function

The mechanism that establishes creator membership SHALL take no caller-supplied argument, SHALL
NOT be executable by `authenticated`, `anon` or `public`, and SHALL derive every value it writes
from the row being inserted.

An RPC would bind only the callers that choose it, leaving `insert into clubs` reachable with the
publishable key that already ships in the bundle; it would restate five columns and their
constraints in a signature that must be kept in step with the table; and an elevated function
`authenticated` can execute adds a security-advisor finding for nothing a trigger does not give.

#### Scenario: There is no id to pass, so someone else's id cannot be passed
- **WHEN** any rider attempts to cause an owner-membership row for a rider other than themselves
- **THEN** there SHALL be no interface that accepts a rider id
- **AND** the values written SHALL come from `NEW.owner_id` / `NEW.organizer_id` on a row the
  `clubs` / `rides` INSERT policy already restricted to `auth.uid()`

#### Scenario: Nobody can call it directly
- **WHEN** `authenticated` or `anon` attempts to execute the function that performs the write
- **THEN** execution SHALL be refused, and the function SHALL NOT be published by PostgREST

#### Scenario: It adds no executable elevated surface
- **WHEN** the security advisors are read after the migration applies
- **THEN** no new `authenticated_security_definer_function_executable` finding SHALL appear
- **AND** the known findings SHALL be unchanged in number and identity

#### Scenario: The participation gate is enforced once, not twice
- **WHEN** a rider whose `onboarding_completed_at` or `terms_accepted_at` is NULL attempts to
  create a club or a ride
- **THEN** the write SHALL be refused on the `clubs` / `rides` insert by `023`'s gate
- **AND** no `club_members` or `ride_members` row SHALL exist for them afterwards
- **AND** the gate not firing a second time inside the elevated function SHALL be asserted rather
  than assumed, because a definer function runs as its owner and the gate's `WHEN` clause is
  evaluated in that context

### Requirement: The creator-membership invariant SHALL be asserted against the table, never against a query result

Any check that the invariant holds SHALL run with row-level security bypassed, or as the club's own
owner. No screen, read function or test SHALL infer the invariant from a count returned under
another rider's session.

`club_members` SELECT carries a block predicate in both directions. A club whose only member is its
owner therefore returns `members_count = 0` to a rider the owner has blocked — which is byte-for-byte
what an orphan looks like from the client. The same is true of `getClub`'s
`members_count:club_members(count)` embed, which runs under RLS.

#### Scenario: A blocked rider sees a healthy club as memberless
- **WHEN** rider A owns a club whose only member is A, A blocks B, and B reads that club's roster
  and member count
- **THEN** B SHALL see zero rows and a count of zero, unchanged from today
- **AND** this SHALL NOT be treated as a violation of the invariant, nor surfaced to B as an error
  state

#### Scenario: The assertion runs with the policy out of the way
- **WHEN** the RLS suite asserts that no club lacks its owner-membership row
- **THEN** the assertion SHALL run with RLS bypassed rather than under the ambient
  `authenticated` role
- **AND** an assertion written under `authenticated` SHALL be treated as a defect, because it
  passes on a database full of orphans owned by riders the runner is blocked from

#### Scenario: No orphan-detection affordance is built
- **WHEN** any screen is tempted to warn a rider that a club looks memberless
- **THEN** it SHALL NOT, because a count that can distinguish "orphan" from "blocked" is a
  block-visibility leak

### Requirement: Every role's access to a creator-membership row SHALL be stated

Every role that can reach a creator-membership row SHALL have its access stated, and the row SHALL
inherit the existing `club_members` / `ride_members` SELECT policies unchanged.

It is an ordinary roster row. Stated role by role so each line maps onto an assertion, and so the
absence of a change to the visibility layer is a checked claim rather than an assumption.

#### Scenario: Owner
- **WHEN** a club's owner reads their own membership row
- **THEN** it SHALL be returned, unconditionally, by the `user_id = auth.uid()` arm

#### Scenario: Admin
- **WHEN** a rider holding `role = 'admin'` in the club reads the owner's row
- **THEN** it SHALL be returned if the club is visible to them, and they SHALL NOT be able to
  delete it, because `club_members` DELETE is `auth.uid() = user_id` and carries no admin arm
- **AND** no `admin` row exists on this database today, since nothing writes the value and there is
  no UPDATE policy — the rule is stated so it is not invented later

#### Scenario: Member
- **WHEN** a member of the club reads the roster
- **THEN** the owner's row SHALL be returned, and the member SHALL NOT be able to delete it

#### Scenario: Non-member
- **WHEN** a signed-in rider who is not a member reads the roster
- **THEN** the owner's row SHALL be returned for a public club and zero rows for a private one,
  unchanged from `008` and `009`
- **AND** they SHALL NOT be able to insert, alter or delete it

#### Scenario: Blocked rider
- **WHEN** a rider blocked by the owner, in either direction, reads the roster
- **THEN** the owner's row SHALL NOT be returned, unchanged from `009`
- **AND** the club itself SHALL still be returned, because `clubs` deliberately carries no block
  predicate

**The six scenarios above are `club_members` only, and this change seeds `ride_members` too.**
The ride half is stated below rather than assumed to be symmetric, because it is not: the two
tables reach the same outcome by different mechanisms, and an implementer who generalises from
the club rules will write the wrong assertion.

Measured from `pg_policy` on 2026-08-06, `ride_members` SELECT is:

```
EXISTS (SELECT 1 FROM rides r WHERE r.id = ride_members.ride_id)
AND (user_id = auth.uid() OR NOT private.is_blocked(auth.uid(), user_id))
```

So **two** block predicates bear on the organizer's own crew row: its own, on the roster
member (`user_id`, which for this row *is* the organizer), and the transitive one inside
`rides` SELECT (`NOT private.is_blocked(auth.uid(), organizer_id)`). Either alone would hide it.
That redundancy is the current state, not a requirement — the assertions below must pin the
outcome, so that removing one predicate later fails a test rather than passing silently.

#### Scenario: Organizer — their own crew row
- **WHEN** the rider named in `rides.organizer_id` reads `ride_members` for their own ride
- **THEN** their `going` row SHALL be returned, on a public ride and on a private-club ride alike
- **AND** they SHALL NOT be able to delete it, by the `BEFORE DELETE` guard this change adds
- **AND** they SHALL still be able to change its `status` to `maybe`, because the invariant is
  presence on the crew, not a particular status

#### Scenario: Club admin and club member — a private club's ride
- **WHEN** a rider holding `role = 'admin'` or `role = 'member'` in the ride's club reads the roster
- **THEN** the organizer's crew row SHALL be returned, because `rides` SELECT admits them through
  `private.is_club_member(club_id)`
- **AND** neither SHALL be able to insert, alter or delete it

#### Scenario: Non-member — public ride versus private-club ride
- **WHEN** a signed-in rider who is not in the ride's club reads the roster
- **THEN** the organizer's crew row SHALL be returned for a public ride whose club is NULL or
  public, and **zero rows** for a ride whose `club_id` names a private club
- **AND** the refusal SHALL come from `rides` SELECT via the `EXISTS`, not from any predicate on
  `ride_members` itself — so a future change that widens `rides` widens this too, deliberately

#### Scenario: Blocked rider — both predicates, asserted separately
- **WHEN** a rider blocked by the organizer, in either direction, reads the roster
- **THEN** the organizer's crew row SHALL NOT be returned
- **AND** this SHALL be asserted **twice**: once proving `ride_members`' own
  `NOT private.is_blocked(auth.uid(), user_id)` arm hides it, and once proving the ride itself is
  invisible so the `EXISTS` hides it — because a single assertion cannot distinguish which
  predicate did the work, and a later edit could remove one while the test stays green

#### Scenario: No SELECT policy is edited
- **WHEN** this change is applied
- **THEN** the policy set for `clubs`, `club_members`, `rides` and `ride_members` SHALL differ from
  today by exactly one INSERT policy on `club_members` and nothing else

### Requirement: A right that a DELETE policy cannot deliver SHALL be delivered by a `security definer` RPC, not recorded as a known gap

When a table's intended delete rights include a case where the deleter cannot READ the row —
because a block, a departed membership or a parent going out of view removes it from their SELECT
policy — the delete SHALL be implemented as a `security definer` function rather than as a policy
with the gap written down beside it.

Postgres applies the SELECT policy to any statement whose `WHERE` clause reads a column, measured on
17.6 and recorded in `082`. A DELETE filtered by `USING` therefore **succeeds against zero rows** and
reports success, so the rider is told their message is gone and it is not. This repo has recorded the
same defect three times — `011` §1b for comments, `034`'s organizer arm for ride messages, and
`102`'s residual `DELETE 0` for a rider who left a crew — and each time the remedy named was an RPC
that was not built.

**A recorded gap is not a mitigation.** It is invisible to the RLS suite, which runs as the table
owner for whom no policy applies, and invisible to the rider, who sees a success.

#### Scenario: A new table with a delete right ships the RPC in the same migration
- **WHEN** a migration creates a table whose rows a rider may remove
- **THEN** it SHALL determine whether any intended deleter can be unable to read the row
- **AND** where one can, the table SHALL carry **no DELETE policy and no DELETE grant**, and the
  right SHALL be a `security definer` function scoped inside its own body
- **AND** the absence of the grant SHALL be the enforcement, so a later policy written too
  permissively cannot open a second path

#### Scenario: The RPC's scope is asserted, and not by calling it
- **WHEN** such a function is added
- **THEN** an assertion SHALL name the role — `has_function_privilege('authenticated', …)` and the
  same for `anon` — rather than exercising the function
- **AND** the reason SHALL be `029`'s: the suite runs as the table owner, for whom neither the grant
  barrier nor RLS exists, so a passing call proves nothing about a client role

#### Scenario: The function discloses nothing about rows outside its scope
- **WHEN** the function is called with an id the caller has no right to
- **THEN** it SHALL remove nothing
- **AND** it SHALL NOT distinguish "that id does not exist" from "that id is not yours", because the
  function bypasses RLS and is therefore the only thing standing between the caller and the whole
  table

### Requirement: Dropping a table a shipped bundle reads SHALL be sequenced against the bundle being SERVING, not against the merge

A migration that drops a table, a column or a function which any shipped client reads SHALL apply
only after the replacing client is confirmed **serving** — a `READY` deployment on the merge sha with
a null alias error — and the confirmation SHALL be a distinct, evidenced step rather than an
inference from the merge.

This repo applied a destructive file **102 seconds** after a merge, out from under a Preview still
calling the function it dropped. A merge is not a deploy: Vercel builds after it, and an
already-loaded browser tab keeps its pre-merge JS until it is reloaded regardless.

#### Scenario: The confirmation is a command with an output, not a judgement
- **WHEN** a destructive migration is about to apply
- **THEN** the deployment state for the merge sha SHALL be read and recorded
- **AND** "the PR merged" SHALL NOT satisfy this, and neither SHALL "CI is green"

#### Scenario: The additive and destructive halves are separate files
- **WHEN** one change both creates a replacement object and drops the object it replaces
- **THEN** they SHALL be two migration files with two numbers
- **AND** the reason SHALL be that one must apply before the deploy and the other after, which a
  single file cannot do
- **AND** the two SHALL be applied in filename order with the deploy between them, and that ordering
  SHALL be recorded per-file in `docs/reference/migrations.md` §Applied state

#### Scenario: A dropped name is not reused by its replacement
- **WHEN** a replacement table serves the same purpose as the dropped one
- **THEN** it SHALL take a different name
- **AND** the reason SHALL be both mechanical and diagnostic: the additive migration must create it
  while the old table still exists, and an old bundle meeting a same-named table with a different
  column set receives malformed rows instead of a clean `PGRST205`

#### Scenario: A dropped table's rows are counted before they are destroyed
- **WHEN** a destructive migration removes rider-authored rows
- **THEN** the count SHALL be measured on each project and recorded in the change
- **AND** a decision to archive or not archive SHALL be stated explicitly, including when the count
  is zero

### Requirement: A recorded bar SHALL be state that every contradicting path clears, and SHALL be distinguished from a recorded refusal that is history

Two kinds of row look identical and behave in opposite ways, and this schema now holds both. Which
one a table is SHALL be decided when it is created and stated at the table, because the failure in
each direction is silent.

**A BAR is state.** It says *this actor may not do this thing right now*. It SHALL be keyed on the
pair it constrains, SHALL be idempotent to write, and **SHALL be deleted by every path that
contradicts it** — a bar that outlives the condition it describes is a permanent refusal nobody
decided on, held in a row nobody can read.

**A REFUSAL is history.** It says *this was declined*, and it SHALL survive later events, because
the record of a decision is the point of it. A `declined` join request is the worked example: it
must **not** be cleared when the rider later joins by another route, because it is the club's
record of having said no once.

The consequences, each testable:

- A bar SHALL name no actor unless something reads the actor. An actor column with no reader is an
  audit trail that arrived without a decision, on the most sensitive fact in the row.
- A bar SHALL be readable by no client role unless a designed surface reads it. Refusing to grant it
  is cheaper than deciding, for every role, what seeing it would mean.
- A bar SHALL cascade from every entity it names, so that deleting either end erases it without a
  sweep or a scheduled job.
- A bar SHALL have a stated retention window at creation, expressed as the events that end it rather
  than as a duration, when nothing decays it on a clock.
- **The path that clears a bar SHALL observe the resulting state, not the route that produced it.**
  Clearing it inside each admission path leaves the next admission path to remember, and the one
  that forgets fails silently and permanently.

#### Scenario: A bar is cleared by every route that contradicts it
- **WHEN** an actor barred from a resource is subsequently granted that resource by any route,
  including one added later
- **THEN** the bar SHALL be gone
- **AND** the clearing SHALL be driven by the granted state itself, so a new route inherits it
  without being edited

#### Scenario: A refusal is not cleared by a later grant
- **WHEN** a rider whose join request was `declined` later joins the same club through another route
- **THEN** the declined row SHALL survive, because only the club may clear its own refusal

#### Scenario: A bar holds no actor and no client grant
- **WHEN** a bar table is read from the catalogue
- **THEN** it SHALL carry no column identifying who imposed it, unless a designed surface reads that
  column
- **AND** neither `anon` nor `authenticated` SHALL hold any grant on it, with the assertion scoped to
  those grantees rather than counting table-wide

#### Scenario: Both ends cascade
- **WHEN** either entity a bar names is deleted
- **THEN** the bar SHALL be gone, with no cleanup step added to any deletion path

#### Scenario: The kind is stated where the table is created
- **WHEN** a table holding a bar or a refusal is added
- **THEN** its migration SHALL state which of the two it is and what ends it
- **AND** a bar with no stated end SHALL be treated as a defect, because it is a permanent refusal
  that no one agreed to

### Requirement: A home country SHALL be required at completion, and SHALL be tolerated as NULL for ever

`profiles.home_country` SHALL be **nullable** at the database level, and
`public.complete_onboarding` SHALL refuse to stamp `onboarding_completed_at` for a rider whose
stored `home_country` is NULL.

The country SHALL arrive as an ordinary column UPDATE on the rider's own row rather than as a new
RPC parameter, and `complete_onboarding`'s signature SHALL NOT change: adding a parameter creates
a PostgREST overload (`PGRST203`) on the one call every signup makes, and avoiding that means
dropping and recreating the function together with `021`'s and `025`'s grants. The value is
constrained against **every** writer by CHECK, so nothing is lost by not routing it through the
function.

A live table admits no NOT NULL here — every existing rider has no country, measured 2026-09-07 at
25 profiles on DEV and 5 on PROD, all of them NULL by construction. Nullable is therefore the only
available shape and is **not a weakening**: the requirement is a rule about *completion*, and
completion is stamped in exactly one place.

**The refusal SHALL live in the function body, not only in a trigger.** Inside a `security definer`
function `current_user` is the owner, and `enforce_onboarding_completion` opens with
`if current_user <> 'authenticated' then return new` — so a guard written only onto the trigger
never evaluates for the RPC that is the only way to complete onboarding. `075`'s header is the
worked example, `003` and `012` are the precedents, and a change that relaxed or tightened only the
trigger would pass `tsc`, pass this repo's RLS suite (which runs as the table owner, for whom
neither barrier exists) and ship nothing.

#### Scenario: A completion with no country is refused
- **WHEN** a rider whose `profiles.home_country` is NULL calls `complete_onboarding`
- **THEN** the call SHALL raise `check_violation`
- **AND** `onboarding_completed_at` SHALL remain NULL
- **AND** the rider SHALL remain unable to create content or join anything, because `023`'s
  participation gate reads that stamp

#### Scenario: An already-onboarded rider re-running the function is not refused
- **WHEN** a rider who already holds a `home_country` calls `complete_onboarding` again
- **THEN** the call SHALL succeed and SHALL return the **original** stamp, per `003` §6b

#### Scenario: The country write and the stamp are two statements, in that order
- **WHEN** the country step submits
- **THEN** the column write SHALL be issued first and the RPC second, so a refused value never
  leaves a rider stamped complete without one
- **AND** the intermediate state — a country, a username and no stamp — SHALL resume to the same
  screen, which SHALL preselect the stored country so the retry is one tap
- **AND** `complete_onboarding` SHALL NOT write `home_country` at all, so there is no path by which
  a re-run can clear it — the hazard `075` names as the single most dangerous line in that change
  is unreachable here rather than handled

#### Scenario: Existing riders keep NULL and are never re-prompted
- **WHEN** a rider whose `onboarding_completed_at` is already set holds a NULL `home_country`
- **THEN** nothing in this change SHALL write a value for them, prompt them, re-gate them or
  refuse them any capability
- **AND** the column comment SHALL say so, so that a later session which assumes non-null
  *"because onboarding requires it"* is contradicted by the schema rather than by folklore

#### Scenario: The requirement is not derived from anything
- **WHEN** a rider has a `profiles.location` such as `Amsterdam, NL`, or rows in
  `profile_countries`, or a device position
- **THEN** no migration and no action SHALL derive `home_country` from any of them, because the
  derivation is silently wrong for exactly the riders whose free text does not resolve — the
  population `localityOf` exists because of

#### Scenario: A new raise SHALL NOT reach the welcome-club block
- **WHEN** the completion guard is added to `complete_onboarding`
- **THEN** it SHALL sit **below** the existing consent and username guards, **above** `058`'s
  `club_members` insert and outside its `when others` handler
- **AND** unlike those two it SHALL be gated on `not v_was_complete` — the transition into
  completion — because `complete_onboarding` has no idempotency short-circuit (`003` §6b is a
  `coalesce` inside the UPDATE, not an early return), so an ungated arm refuses a re-run by every
  rider who onboarded before `113` and holds a NULL country permanently. That is the population
  the scenario above promises is never re-prompted; measured on DEV, 24 of 25 profiles
- **AND** no new raise SHALL be introduced inside that block, because a raise there rolls the
  completion stamp back and decision #5 leaves a rider with a NULL stamp no way out of the wizard

#### Scenario: The gate's table set is unchanged
- **WHEN** `113` and `114` are applied
- **THEN** `enforce_participation_gate` SHALL be on exactly the tables it was on before, and
  SHALL still NOT be on `profiles` UPDATE
- **AND** an account that never called `accept_terms()` writing `home_country` directly SHALL
  remain permitted and SHALL remain unable to complete onboarding, because writing a country
  confers no participation and the consent guard is evaluated independently

### Requirement: Every role's reach into a rider's home country SHALL be stated

`profiles.home_country` SHALL be readable by exactly the audience the `profiles` SELECT policy
already admits, and writable by its owner alone. Each role SHALL have its access stated so that
each line maps onto an assertion in `supabase/tests/rls_test.sql`, because an unstated negative
silently becomes whatever the migration author assumed.

The audience predicate is unchanged and is stated rather than referenced:
`auth.uid() = id OR (username IS NOT NULL AND NOT private.is_blocked(auth.uid(), id))`.

#### Scenario: The rider themselves
- **WHEN** a rider reads or writes `home_country` on their own row
- **THEN** they SHALL read it, SHALL set it while it is NULL, and SHALL change it to another
  assigned code
- **AND** they SHALL NOT return it to NULL: `enforce_onboarding_completion` SHALL coerce the
  removal away — `new.home_country := coalesce(new.home_country, old.home_country)`, `038`'s shape
  — and the assertion SHALL check the **stored value** rather than a SQLSTATE, because a coercion
  raises nothing

#### Scenario: Any other signed-in rider
- **WHEN** a signed-in rider updates a `profiles` row that is not their own, setting
  `home_country` to any value or to NULL
- **THEN** zero rows SHALL be affected, because the UPDATE policy is `auth.uid() = id`

#### Scenario: A blocked rider
- **WHEN** rider A blocks rider B, and B reads A's `home_country` by any route
- **THEN** zero rows SHALL be returned, and the same SHALL hold with A and B exchanged, because
  blocking is symmetric even though the row is directional
- **AND** this change SHALL open no new inference channel: there is no unique index, no
  availability check and no count over this column

#### Scenario: Club owner, admin, member and non-member
- **WHEN** a rider holding `club_members.role` of `owner`, `admin` or `member`, or holding no
  membership at all, reaches another rider's profile through a club roster, a ride crew, a
  postcard byline or Explore
- **THEN** they SHALL read `home_country` exactly as the SELECT policy already admits, and SHALL
  write nothing
- **AND** no club role SHALL confer authority to set, change or clear another rider's home country

#### Scenario: A signed-out visitor
- **WHEN** a request arrives with no session
- **THEN** zero rows SHALL be returned and zero rows written, because `anon` holds no grant on
  `profiles` at all
- **AND** no rule in this change SHALL be expressed in a way that admits `anon`, per decision #1

#### Scenario: The column is rider-owned, not server-owned
- **WHEN** the grants are written
- **THEN** `authenticated` SHALL hold SELECT, INSERT and UPDATE on `home_country`, the posture
  `location` already has
- **AND** it SHALL NOT take `025`'s server-owned posture, which is reserved for evidence the rider
  must not author — a consent stamp, a completion stamp, a terms version, an analytics preference
- **AND** the grant assertion SHALL be scoped to its grantee or use `has_table_privilege`, because
  `postgres` and `service_role` hold everything by Supabase default

#### Scenario: The route guard is not the enforcement
- **WHEN** a rider defeats or bypasses the client-side route guard and calls
  `complete_onboarding` directly with no country
- **THEN** the refusal SHALL be identical, because it lives in the database
- **AND** the guard SHALL NOT be modified to compensate for any defect in this rule

### Requirement: A completion invariant added to a live table SHALL be armed separately from the column it reads

A migration that adds a column a shipped client will write SHALL be separate from the migration
that begins refusing writes which omit it, and the deploy SHALL sit between them.

One file cannot be both sides of a deploy. The additive half must exist **before** the new bundle,
or the bundle writes a column that is not there (`PGRST204`) and calls a signature that is not
there (`PGRST202`) — `096` is the precedent, and the failure is that nobody can finish onboarding.
The restrictive half must not exist **until** the new bundle is serving, or the old bundle's
completion call — which passes no country — is refused for every rider mid-signup. `108`/`109` is
the shape.

#### Scenario: The additive migration is safe against the serving bundle
- **WHEN** `113` is applied while the current bundle is still serving
- **THEN** `complete_onboarding` SHALL be byte-identical before and after, and SHALL still stamp
  completion for a rider with no country
- **AND** the only behaviour `113` changes for the serving bundle is a trigger arm that is dead for
  every row whose `home_country` is NULL — which is every row

#### Scenario: The arming migration waits for a serving bundle, not a merge
- **WHEN** `114` is scheduled
- **THEN** it SHALL be applied only after the new bundle is confirmed **serving** — `READY` on the
  merge sha with `aliasError` null — never merely after the merge
- **AND** the same two-file split SHALL be preserved through the PROD promotion rather than
  collapsed into one

#### Scenario: The trigger edit is a coercion, and is exercised by hand before it applies
- **WHEN** `113` changes `enforce_onboarding_completion`, which fires inside every profile edit's
  own transaction
- **THEN** the new arm SHALL be a coercion rather than a raise, so it cannot take a shipped write
  path down
- **AND** every affected write SHALL be exercised by hand on DEV first, in a rolled-back
  transaction, as `authenticated`

### Requirement: A client writing two columns from one pick SHALL NOT be able to clear the one the database protects, and SHALL NOT rely on that protection alone

Where one rider action writes a pair of columns and only one of them carries a database-side
irreversibility rule, the client SHALL omit the protected column when it has no value for it, **and**
the protection SHALL be stated with the conditions under which it is silent. Neither substitutes for
the other.

The pair is `profiles.location` and `profiles.home_country`, written together from one place pick.
`home_country` cannot be cleared once set; `location` can.

**The protection, verified in the deployed `prosrc` on both projects 2026-09-08 rather than taken
from prose.** `enforce_onboarding_completion`'s UPDATE arm carries
`if old.home_country is not null then new.home_country := coalesce(new.home_country,
old.home_country); end if;` — `038`'s exact shape for `username`, placed above the
`old.onboarding_completed_at` early return so it is not dead code for the only population that can
have a country to lose. A coercion, not a raise: a client sending a blank country gets the stored
value back and sees no error.

**Two conditions narrow it, and both are why the client's omission is also required.** It is keyed on
`old.home_country is not null`, so it does nothing for a rider who has no country — measured
2026-09-08, that is **every** rider on both projects, 0 of 25 on DEV and 0 of 5 on PROD. And the
trigger's first statement is `if current_user <> 'authenticated' then return new; end if;`, so it is
a rule about what the *client* may write and does not cover a `security definer` path or the seed.

**No migration is proposed.** The coercion is correct as it stands, `profiles.location`'s deliberate
absence of one is PD-419's obligation rather than an oversight, and changing a trigger on an
already-shipped write path would owe a hand-exercise gate for a problem that does not exist.

#### Scenario: A rider changes their town to a place with no country
- **WHEN** a signed-in rider, on their own row, writes a new `location` from a pick whose
  `countryCode` is `null` or absent
- **THEN** the client SHALL send no `home_country` key at all
- **AND** if it sends `home_country: null` regardless, the stored value SHALL be unchanged — assert
  the **stored value**, never a SQLSTATE; an assertion written as a rejection would fail against a
  correct implementation
- **AND** a rider who has no stored country SHALL simply remain without one, because the coercion arm
  does not fire

#### Scenario: A rider changes their town to a place in another country
- **WHEN** the pick carries a `countryCode` different from the stored one
- **THEN** both columns SHALL be updated, and the country SHALL change — a *change* is permitted, a
  *removal* is not, exactly as `038` permits a rename and refuses a removal
- **AND** no other rider, in any club role — owner, admin, member, non-member — SHALL be able to set,
  change or clear either column on someone else's row; `001`'s UPDATE policy is `auth.uid() = id` and
  such a statement SHALL affect **zero rows**
- **AND** a **blocked** rider SHALL read zero rows for the other's profile in both directions, and a
  signed-out visitor SHALL read zero rows because `anon` holds no grant on `profiles`

#### Scenario: A rider clears their town
- **WHEN** a rider uses the profile setting's `Remove`
- **THEN** `profiles.location` SHALL be set to SQL NULL — not `''`, which would read as a town
  nobody typed — and the write SHALL carry no `home_country` key
- **AND** their stored `home_country` SHALL survive, and they SHALL NOT be returned to the wizard,
  because completion is a stored one-way stamp and `114` gates *becoming* onboarded rather than
  *being* onboarded
- **AND** clearing SHALL remain possible: PD-419's decision obliges withdrawal, and
  `profiles.location` SHALL NOT acquire a coercion arm as part of this change

#### Scenario: A completion is re-run by a rider who predates the requirement
- **WHEN** an already-stamped rider with a NULL `home_country` reaches `complete_onboarding` by any
  route
- **THEN** they SHALL NOT be refused, because `114`'s guard is gated on `not v_was_complete` — the
  transition into completion — and SHALL receive their **original** stamp
- **AND** their stored `location` SHALL NOT be overwritten, because the caller passes
  `p_location: null` and `075`'s `coalesce(nullif(btrim(p_location), ''), p.location)` reads that as
  *leave it alone*
- **AND** no caller in this change SHALL pass a real `p_location`, since that path **does** overwrite
  a stored town on a re-run

#### Scenario: The bounds are the database's and the messages are Zod's
- **WHEN** a town longer than 100 characters, or a country code that is empty, lower-case,
  three-letter, padded, or unassigned, reaches the row by any route
- **THEN** `018`'s `profiles_location_length` and `113`'s two `home_country` CHECKs SHALL refuse it
  with `23514`, whether or not the client ran `locationSchema` or `countryCodeSchema`
- **AND** the picker's `maxNameLength` SHALL truncate a long label before it can be submitted, so the
  rider is never handed a value they cannot shorten

### Requirement: A thread's activity timestamp SHALL be server-owned, monotonic, and written only by a trigger

`club_threads.last_activity_at` and `ride_threads.last_activity_at` SHALL be `not null`, SHALL
default to the thread's own `created_at`, and SHALL be written only by an `AFTER INSERT` trigger on
`club_messages` and `ride_thread_messages` respectively.

`authenticated` SHALL hold **no INSERT and no UPDATE grant** on either column, and neither table
SHALL gain an UPDATE policy. Both refusals SHALL exist independently: the column grant and the
absent policy each refuse the write on their own, and the RLS suite SHALL assert the grant scoped to
the `authenticated` grantee rather than by attempting a call, since the suite runs as the table owner
for whom no barrier exists.

The update SHALL be `greatest(last_activity_at, new.created_at)`, never a bare assignment. A message
row's `created_at` is a client-defaultable column, and a backdated or clock-skewed insert SHALL NOT
be able to pull a thread's position backwards. Monotonicity is also what makes the backfill and the
trigger order-independent.

The trigger SHALL fire `AFTER INSERT`, so that a message refused by the participation gate — a
`BEFORE` trigger that raises — records no activity.

**A rider SHALL NOT be able to move a thread other than by inserting a message they were already
entitled to insert.** This change SHALL add no write path, no RPC and no grant.

#### Scenario: A rider cannot write the column directly
- **WHEN** an `authenticated` rider attempts to INSERT or UPDATE `last_activity_at` on either table
- **THEN** the write SHALL be refused
- **AND** the suite SHALL assert the absent grant by grantee-scoped privilege inspection

#### Scenario: A backdated message does not move a thread backwards
- **WHEN** a message is inserted carrying a `created_at` older than the thread's current
  `last_activity_at`
- **THEN** the column SHALL be unchanged
- **AND** the thread SHALL keep its position

#### Scenario: A refused message records no activity
- **WHEN** the participation gate refuses a message insert
- **THEN** the thread's `last_activity_at` SHALL be unchanged
- **AND** the whole statement SHALL abort

### Requirement: A trigger writing a table with no UPDATE grant and no UPDATE policy SHALL be `security definer`

A trigger function runs as the calling role unless declared otherwise. Both thread tables carry a
table-level SELECT grant to `authenticated`, a column-scoped INSERT grant, and **no UPDATE grant and
no UPDATE policy at all** — so an `UPDATE` issued from a `security invoker` trigger would be refused
twice over.

That refusal is not a skipped bump. The `UPDATE` raises, the enclosing `INSERT` on the message table
aborts, and **every reply in the app stops working**. The failure is total, immediate, and invisible
to the RLS suite, which runs as the table owner.

The function SHALL therefore live in `private`, be `security definer`, be owned by `postgres`, and
carry a pinned `search_path` — matching `private.notify_club_thread_replied`, which already fires
`AFTER INSERT` on `club_messages` for the same structural reason.

Because the function bypasses RLS in its own body, it SHALL restate nothing about audience. It SHALL
address exactly one row, by the primary key taken from `new.thread_id`, and SHALL write exactly one
column. It SHALL make no decision a policy already owns.

#### Scenario: A reply succeeds under the caller's own privileges
- **WHEN** an `authenticated` crew member or club member inserts a message
- **THEN** the insert SHALL succeed and the thread's `last_activity_at` SHALL advance
- **AND** the rider SHALL have needed no grant on the thread table beyond SELECT

#### Scenario: The definer function widens nothing
- **WHEN** the trigger function runs
- **THEN** it SHALL update exactly one thread row, identified by `new.thread_id`
- **AND** it SHALL write only `last_activity_at`, and SHALL contain no audience predicate

#### Scenario: The advisor finding is accounted for
- **WHEN** the migration is applied to a hosted project
- **THEN** the security advisors SHALL be read
- **AND** a new `security definer` function in `private` SHALL be accounted for against the existing
  per-migration accounting rather than left unexplained

### Requirement: An existing thread's activity SHALL be backfilled in the migration that adds the column

The migration SHALL set `last_activity_at` for every existing thread on both tables from that
thread's newest message, falling back to the thread's own `created_at` where it has none.

Without the backfill, every thread already stored on both projects reads as having its creation
instant as its newest activity, so on the first render after the migration every live conversation
in the app collapses back to its start date — the exact defect the newest-activity decision was made
to prevent, applied to the entire existing corpus at once, and silently: the column would be
correctly typed, correctly defaulted, and wrong for every row.

The backfill SHALL be part of the same migration file as the column, so no deploy window exists in
which the column is present and unpopulated.

#### Scenario: An existing busy thread keeps its position through the migration
- **WHEN** `116` is applied to a project holding threads with messages
- **THEN** each thread's `last_activity_at` SHALL equal its newest message's `created_at`
- **AND** the timeline's first render after the migration SHALL show the same ordering a correct
  derived computation would have shown

#### Scenario: An existing thread with no messages is unmoved
- **WHEN** the migration is applied to a thread that has never been replied to
- **THEN** its `last_activity_at` SHALL equal its `created_at`

#### Scenario: The column is never observable as unpopulated
- **WHEN** the migration runs
- **THEN** the column, its default, its backfill and its constraint SHALL be in one file
- **AND** no client SHALL be able to read a `null` or a default-only value for an existing thread

### Requirement: An announcement thread SHALL be stamped uniformly, and its exclusion SHALL stay in the READ

The trigger SHALL NOT special-case `club_threads.introduces_user_id`. An announcement thread's
`last_activity_at` SHALL be maintained exactly like any other thread's, and simply never read for
ordering, because `getClubThreads` and `getClubThreadReplies` exclude the marker **in the query**
before ordering — PD-372's fix, which SHALL be preserved unchanged.

A trigger that skipped announcements would put a presentation rule in the database. It would also be
wrong the day `097`'s marker is NULLed when the subject leaves the club: the thread would become an
ordinary timeline thread carrying a `last_activity_at` frozen at its creation, sorting into a
position nothing in the schema explains.

The exclusion SHALL remain a presentation filter and SHALL NOT be read as an audience rule. A
non-member reads zero rows from `081` with or without it.

#### Scenario: An announcement thread is stamped but not listed
- **WHEN** a rider replies to a club introduction's announcement thread
- **THEN** that thread's `last_activity_at` SHALL advance
- **AND** it SHALL NOT appear as a thread entry on the club's timeline, because the read excludes it

#### Scenario: A former announcement sorts correctly if its marker is cleared
- **WHEN** `introduces_user_id` is NULLed on a thread that has been replied to
- **THEN** the thread SHALL appear at its newest activity
- **AND** SHALL NOT appear at its creation date, because the column was maintained all along

#### Scenario: The exclusion stays in the query
- **WHEN** the thread source is read
- **THEN** the marker filter SHALL be applied inside the query, before the bound and the ordering
- **AND** SHALL NOT be applied after the read, which would break the source's saturation signal

### Requirement: A deleted message SHALL NOT un-bump its thread

`last_activity_at` SHALL be maintained on INSERT only. No trigger SHALL recompute it on DELETE.

This is a decision, not an omission. Recomputing on delete costs a scan of the thread's messages per
moderation action, on the path a moderator uses, and the activity being erased **did happen** — the
thread's position records that the conversation was alive, not that a particular message survives.
A thread whose only reply is removed SHALL keep its bumped position until its next real message.

#### Scenario: A moderated message leaves the position standing
- **WHEN** a message is erased by its author or removed through the moderation RPC
- **THEN** the thread's `last_activity_at` SHALL be unchanged
- **AND** no scan of the thread's messages SHALL be performed

#### Scenario: A deleted thread takes its column with it
- **WHEN** a thread row is deleted
- **THEN** its `last_activity_at` SHALL go with it, by ordinary row deletion
- **AND** no orphaned activity record SHALL remain anywhere

### Requirement: A copy transmitted outside the database's reach SHALL be enumerated per column, and its permanence SHALL be stated

Where a privileged job transmits row contents to a destination no policy, cascade or deletion can
reach — an email, a webhook, a third-party API — the columns that may leave SHALL be enumerated in
**SQL**, per source, in the function that produces them, and the transmitting code SHALL be incapable
of widening them.

The enumeration is the access control. A privileged producer has no viewer whose row security could
be re-checked, so a predicate cannot do this work and an allowlist of columns is the only mechanism
left.

#### Scenario: The projection lives in SQL, not in the caller
- **WHEN** a privileged job assembles data for an external destination
- **THEN** the columns SHALL be fixed by the producing function's return type
- **AND** the caller SHALL pass no subject, table or column argument that could widen it
- **AND** the caller SHALL issue no direct table read

#### Scenario: Identity is excluded unless the destination is the subject
- **WHEN** the transmitted rows concern riders
- **THEN** no `profiles` or `auth.users` column SHALL be transmitted unless the recipient is that
  rider
- **AND** an identifier that joins to everything — a bare uuid of a person — SHALL count as identity
  for this rule

#### Scenario: A credential-like value is never transmitted
- **WHEN** a projection is designed
- **THEN** no signed URL, bearer token, session id or push token SHALL be included
- **AND** the reason SHALL be recorded where the projection is defined: such a value is validated by
  signature or possession rather than by policy, so it grants reach to whoever the message is
  forwarded to

#### Scenario: The permanence is written down where the copy is produced
- **WHEN** such a transmission is designed
- **THEN** the design SHALL state that no policy change, block, deletion or erasure request can
  withdraw what was sent
- **AND** it SHALL state that no withdrawal sweep will be attempted
- **AND** the minimised projection SHALL be recognised as the whole mitigation available in code

### Requirement: A table recording that a row was transmitted SHALL carry no copy of that row

A marker, outbox or delivery-log row SHALL carry references, bookkeeping timestamps and a state, and
SHALL NOT carry text from the row it describes, a rendered message, or a provider's error body.

#### Scenario: No payload column under any name
- **WHEN** a marker or outbox table is created
- **THEN** it SHALL have no column holding a body, note, caption, title, username or rendered message
- **AND** it SHALL have no `last_error` or equivalent, because a provider's error body can echo the
  payload it rejected

#### Scenario: The marker cannot outlive its subject
- **WHEN** the described row is deleted
- **THEN** the marker SHALL be removed by cascade
- **AND** exactly one foreign key SHALL identify the subject, enforced by a CHECK when the table
  serves several sources

#### Scenario: The marker is not a status the app can read
- **WHEN** any client role reads the marker table
- **THEN** it SHALL be refused, by RLS with no policy and by an explicit revoke naming
  `service_role`
- **AND** the marker SHALL NOT be interpretable as a moderation or workflow state

