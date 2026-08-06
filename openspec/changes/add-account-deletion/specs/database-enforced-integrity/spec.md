> **⚠ COORDINATION — two active changes modify `Club membership role SHALL NOT be
> self-assignable`, and OpenSpec will not warn you.** The other is
> `enforce-creator-membership`. Archiving folds a delta into
> `openspec/specs/database-enforced-integrity/spec.md` by replacing the requirement wholesale,
> so **whichever change archives second silently discards the first one's edit**.
>
> They are reconcilable in substance, and this is the merged text both should converge on:
>
> - `authenticated` may insert `role = 'member'` only.
> - The **owner row is written by the database** at club creation (`enforce-creator-membership`'s
>   `AFTER INSERT` trigger), not by the client — so the old scenario "the creator's own owner row
>   is still permitted" describes a write that no longer happens.
> - The **privileged ownership transfer** (`add-account-deletion`, `security definer`, `private`
>   schema, no `authenticated` EXECUTE) may set `role = 'owner'` on the rider it is
>   simultaneously making `clubs.owner_id`. It bypasses RLS, so the narrowing above does not
>   bind it.
>
> Before archiving whichever of the two goes second: re-read
> `openspec/specs/database-enforced-integrity/spec.md` as the first one left it, and rewrite this
> delta against *that* text rather than against the version you drafted.

## MODIFIED Requirements

### Requirement: Club membership role SHALL NOT be self-assignable

**This is the merged text — see the coordination banner above.** The database SHALL refuse any
`club_members` row whose `role` is `owner` or `admin` **from `authenticated`, without
exception**. The owner's row SHALL be written by the database itself when the club is created
(`enforce-creator-membership`'s `AFTER INSERT` trigger), never by the client. The **only**
exception is the account-deletion ownership transfer, which promotes the rider it is
simultaneously making `clubs.owner_id`; it runs `security definer` in the `private` schema with
no `authenticated` EXECUTE, so it does not write as `authenticated` at all and the narrowing
above does not bind it.

**`019` closed the original hole, and this requirement's earlier text described the world
before it.** That text read: *"Any rider can already join any public club as `admin` today."*
`019_club_member_role` was applied 2026-08-05 and its INSERT policy admits `role = 'owner'`
only when `clubs.owner_id = auth.uid()`, so that sentence has been false since. It is recorded
here rather than deleted because it was copied forward twice — once into the standing spec and
once into this delta — and a reader who meets it a third time should recognise it.

What `019` left is narrower and is what the two changes above close between them: its owner arm
still admits a client-written `role = 'owner'` row, which stops being needed the moment the
database writes that row itself.

The roster screen renders the value — `/clubs/[id]/members` labels `owner` and `admin` and
draws an owner ring — so a forged role is visible to every member of the club.

**Account deletion is the first thing in this system that has to change a club's owner, and
`clubs.owner_id` is not the only place ownership is recorded.** `clubs` UPDATE and DELETE are
`auth.uid() = owner_id`, but the roster label and `ClubDetail.viewer_role` are both read from
`club_members.role`. A transfer that moves `clubs.owner_id` alone therefore produces a club
whose database owner has no owner affordances in the app and whose roster shows no owner at
all — a silent disagreement between two columns that nothing reconciles. `019` left
`club_members` with no UPDATE policy on purpose, so no rider can close that gap afterwards
either. The transfer SHALL close it in the same transaction, and the exception SHALL be
stated here rather than discovered when a club arrives ownerless.

#### Scenario: A non-member joining a public club cannot arrive as owner or admin
- **WHEN** a signed-in rider who is not a member inserts a `club_members` row for a public club
  with `role` set to `owner` or `admin`
- **THEN** the database SHALL reject the write

#### Scenario: Not even the club's own owner may insert an owner row
- **WHEN** the rider named in `clubs.owner_id` inserts a `club_members` row for their own club
  with `role = 'owner'`
- **THEN** the write SHALL be refused
- **AND** this SHALL NOT break club creation, because the database wrote that row in the same
  statement as the club and no client statement ever needs to attempt it

  *(This scenario replaced one reading "The creator's own owner row is still permitted … the
  write SHALL succeed". Both changes touching this requirement must state it the same way or
  the second to archive silently reinstates a write the first removed.)*

#### Scenario: Nobody can promote an existing member
- **WHEN** any rider — including the club owner, an admin, an ordinary member, a non-member or
  a rider on either side of a block — attempts to UPDATE `club_members.role`
- **THEN** the write SHALL be refused, because no UPDATE policy on `club_members` exists
- **AND** this SHALL remain true until the invitations feature ships its own policy, so that
  the absence is a recorded gap rather than an accident
- **AND** the ownership transfer below SHALL NOT be implemented by adding an UPDATE policy,
  since a policy is reachable by every rider it admits and the transfer is reachable by none

#### Scenario: An ownership transfer promotes exactly one row, and chooses it itself
- **WHEN** the account-deletion transfer reassigns `clubs.owner_id` to a remaining member
- **THEN** that rider's `club_members.role` SHALL become `owner` in the same transaction, so
  that `clubs.owner_id` and the roster agree at every point another rider could observe them
- **AND** the transfer SHALL take no caller-supplied rider, role or club, deriving all three
  from the departing account
- **AND** the departing owner's own `club_members` row SHALL be gone by cascade, so no club
  SHALL be left with two `owner` rows

#### Scenario: The transfer is not reachable by any rider
- **WHEN** any signed-in rider — owner, admin, member, non-member, or a rider blocked by or
  blocking the club's owner — calls the transfer directly
- **THEN** it SHALL be unreachable: the function lives in `private`, PostgREST does not publish
  it, and `authenticated` holds no EXECUTE
- **AND** no rider SHALL gain the ability to hand a club to themselves or to anyone else

#### Scenario: A blocked rider is an eligible recipient
- **WHEN** the longest-tenured remaining member of a transferring club is a rider the departing
  owner had blocked, or who had blocked the departing owner
- **THEN** they SHALL be eligible, and `private.is_blocked` SHALL NOT be consulted anywhere in
  the transfer
- **AND** this follows the standing ruling that `clubs` carries no block predicate because a
  club is an organisation rather than a person, and from the fact that the block row itself
  cascades away with the departing account

#### Scenario: The recipient is always an existing member
- **WHEN** a candidate is selected
- **THEN** it SHALL be a rider who already holds a `club_members` row for that club
- **AND** a non-member SHALL never be made owner, because that would create a membership nobody
  asked for in a club they may never have been able to see

### Requirement: Consent and lifecycle timestamps SHALL NOT be readable by other riders

`profiles.terms_accepted_at`, `profiles.onboarding_completed_at` **and any further column
recording what a rider consented to — including `terms_version`** — SHALL be readable on the
caller's own row only, and the restriction MUST be enforced by the database rather than by the
projection a query happens to request.

RLS is row-level, not column-level: the `profiles` SELECT policy admits every non-blocked
rider with a username, and therefore admits every column of that row, including
`terms_accepted_at` and `onboarding_completed_at`. `PUBLIC_PROFILE_COLUMNS` narrows the
projection in application code, which is a convention the database does not enforce.

**`025` closed that by revoking the table-level grant and re-granting an explicit column
allowlist, and the standing cost of that shape is what this change has to obey: every column
added to `profiles` from now on is invisible to `authenticated` until someone adds it to those
grants.** `terms_version` is a consent record, so the correct action is to add it to none of
the three lists — not SELECT, not INSERT, not UPDATE — and to let `accept_terms()` write it as
the database, exactly as it writes the timestamp. The failure mode this requirement now guards
is an implementer adding the column to the SELECT allowlist to "make it work", which republishes
a consent record to every rider who can see the row and undoes `025` one column across.

#### Scenario: Another rider's consent record is not retrievable
- **WHEN** any signed-in rider selects all columns of another rider's profile
- **THEN** `terms_accepted_at`, `onboarding_completed_at` and `terms_version` SHALL NOT be
  returned
- **AND** the rider's own row SHALL still return them, because the onboarding resume step and
  the route guard both read the caller's own completion stamp

#### Scenario: A blocked rider reaches nothing
- **WHEN** a blocked rider selects any column of the blocking rider's profile
- **THEN** zero rows SHALL be returned, unchanged from today

#### Scenario: A second projection does not satisfy this
- **WHEN** the restriction is implemented
- **THEN** `authenticated` MUST NOT retain column-level SELECT on `terms_accepted_at`,
  `onboarding_completed_at` or `terms_version` on `public.profiles` itself
- **AND** an alternative object placed beside the table SHALL NOT count, because
  `public.profiles` stays published by PostgREST and the grant is what decides —
  verified against `information_schema.column_privileges`

#### Scenario: The new consent column joins the restriction rather than the allowlist
- **WHEN** `terms_version` is added to `profiles`
- **THEN** `authenticated` SHALL hold no SELECT, INSERT or UPDATE on it, so it appears in none
  of `025`'s three column allowlists
- **AND** the only writer SHALL be the own-row `security definer` accessor that already records
  the acceptance, so a rider cannot name their own terms version any more than their own
  timestamp

#### Scenario: Every role is refused, not merely the ones the screens exercise
- **WHEN** a club owner, a club admin, a fellow member, a non-member, or a rider on either side
  of a block selects `terms_version` from another rider's profile row
- **THEN** the column SHALL be refused for all of them by the same grant
- **AND** the refusal SHALL NOT depend on which screen issued the query

### Requirement: Onboarding completion SHALL gate participation, not only navigation

A rider whose `profiles.onboarding_completed_at` is NULL **or whose `profiles` row does not
exist at all** MUST NOT be able to create content or join anything, and the refusal SHALL come
from the database rather than from a redirect.

Decision #5 states onboarding is required and not skippable. This requirement is **met**:
`023`'s `enforce_participation_gate` is the enforcement, applied 2026-08-05, and the route
guard is only a UX affordance on top of it.

The argument that produced it, kept because it is why the gate exists: before `023`, `proxy.ts`
was the *only* thing holding decision #5 — no policy prevented a rider whose
`onboarding_completed_at` was NULL from inserting a postcard, creating a club or a ride, or
joining anything, because `003`'s trigger guards the *stamp*, not the participation. Demoting
the route guard to a client component would have removed the only thing holding it.

**The gate is narrower than the requirement above reads**, and that is worth carrying: `023`
puts it on eight tables — `postcards`, `clubs`, `rides`, `club_members`, `ride_members`,
`postcard_comments`, `postcard_likes`, `postcard_reports` — and **not** on `profiles` UPDATE,
`profile_countries`, `blocks`, `postcard_hides`, `feed_reads` or any `storage.objects` policy.

An un-onboarded rider also has a NULL `username`, which the `profiles` SELECT policy uses to
hide them from other riders — so their content would appear to everyone else with an
unresolvable author.

**Account deletion introduces a second population this gate has to refuse, and the exclusion
list above was reasoned about the first one only.** Every rider `023` considered has a
`profiles` row; a rider holding an unexpired access token for a deleted account has none. The
gate happens to answer correctly — `private.may_participate()` is an `exists(...)`, so a missing
row is `false` rather than NULL or an error — but that is a property of the query shape, not
something any assertion states. The five ungated tables are the interesting half: they are
refused by the foreign key to `profiles` rather than by the gate, which is a different mechanism
with a different error code and no test behind it. Both halves are asserted here so that the
window between a deletion and an access token's expiry is a measured property rather than an
assumption.

#### Scenario: An un-onboarded rider cannot create content
- **WHEN** a rider whose `onboarding_completed_at` is NULL inserts into `postcards`, `clubs`,
  `rides`, `club_members`, `ride_members`, `postcard_comments`, `postcard_likes` or
  `postcard_reports`
- **THEN** the database SHALL reject the write

#### Scenario: Per-viewer tables are deliberately excluded
- **WHEN** an un-onboarded rider inserts into `blocks`, `postcard_hides`, `feed_reads`,
  `profile_countries` or their own `profiles` row
- **THEN** the write SHALL succeed, because none of these produces content another rider can
  see and `profiles` is the row the wizard itself writes
- **AND** the exclusion SHALL be stated in the migration rather than left as silence: thirteen
  tables carry an INSERT policy and this gate names eight of them

#### Scenario: An un-onboarded rider cannot file moderation records
- **WHEN** a rider who has not completed onboarding reports a postcard
- **THEN** the write SHALL be refused
- **AND** this SHALL hold specifically because email confirmation is off (decision #6), so an
  account can be created with an address nobody controls and used to file reports that no
  admin role exists to triage

#### Scenario: Completing onboarding is still the only way through
- **WHEN** the same rider sets a username and location and receives the completion stamp
- **THEN** every write above SHALL succeed
- **AND** the stamp SHALL remain one-way and SHALL remain refused while either field is NULL,
  unchanged from `003`

#### Scenario: Reading is unaffected
- **WHEN** an un-onboarded rider reads any table
- **THEN** the existing policies SHALL apply unchanged, so this requirement adds no new read
  restriction and cannot strand a rider mid-wizard

#### Scenario: A caller with no profile row is refused by the gate on all eight tables
- **WHEN** a caller holding a valid access token whose `profiles` row has been deleted inserts
  into any of the eight gated tables
- **THEN** the write SHALL be refused with `check_violation`
- **AND** `private.may_participate()` SHALL return false for that caller rather than NULL or an
  error, which SHALL be asserted directly rather than inferred from the refusal

#### Scenario: The five ungated tables refuse the same caller by foreign key
- **WHEN** the same caller inserts into `blocks`, `postcard_hides`, `feed_reads`,
  `profile_countries` or `profiles`
- **THEN** each write SHALL be refused with `23503`, because every one of them references
  `public.profiles` and `profiles` references `auth.users`
- **AND** this SHALL be asserted per table, because the gate deliberately does not cover them
  and a foreign key is the only thing that does

#### Scenario: A deleted rider cannot re-create their own profile row
- **WHEN** a caller whose account has been deleted inserts a `profiles` row for their own
  subject id
- **THEN** the write SHALL be refused, because `profiles.id` references `auth.users(id)` and
  that row is gone
- **AND** the refusal SHALL NOT depend on `023`'s INSERT arm, which is defence in depth for the
  forbidden half-deleted state rather than the control for this one

#### Scenario: No deletion path removes a profile row on its own
- **WHEN** any code path in this feature removes rider data
- **THEN** it SHALL cut at `auth.users` and let the cascade take `public.profiles`
- **AND** a state in which an `auth.users` row survives its `profiles` row SHALL be treated as a
  defect, because that is the one state in which the participation gate is the only thing
  standing between a rider and a self-authored profile row

### Requirement: Storage object ownership SHALL remain database-enforced

A rider MUST NOT be able to upload outside their own folder, nor reference an object in another
rider's folder from a row they author. **An ownership transfer SHALL NOT be the exception**: no
club row MUST ever name an image path under a uid that is not its own `owner_id`.

Every upload surface binds its path to the uploader in SQL: `postcards` through the INSERT
policy's `image_path like 'postcards/' || auth.uid() || '/%'`, and `profiles` and `clubs`
through CHECK constraints on the row. Fifteen `storage.objects` policies exist across five
folders, none granted to anything but `authenticated`, and none of them UPDATE.

**`016`'s two club CHECKs are the ones account deletion touches, and the constraint is weaker
evidence against a transfer than it first appears.** `clubs_avatar_path_owned` is
`avatar_path is null or avatar_path like ('club-avatars/' || owner_id::text || '/%')`, and a
CHECK is evaluated against the finished row. A transfer that clears both paths at or before the
moment it changes `owner_id` therefore satisfies both constraints as written — the NULL arm is
already the escape. Only a transfer that tries to *keep* the images needs a relaxation, and that
is the option this change rejects, because it would leave a departed rider's uid inside a live
path forever. So the requirement here is that the constraints survive this change unrelaxed; if
a relaxation is nonetheless proposed, it carries the burden below.

#### Scenario: A rider cannot claim another rider's object
- **WHEN** a rider inserts a `postcards` row whose `image_path` sits in another rider's folder
- **THEN** the write SHALL be rejected by the INSERT policy

#### Scenario: A rider cannot upload outside their own folder
- **WHEN** a rider uploads to `avatars/<another uid>/…`, `covers/`, `club-avatars/` or
  `club-covers/` outside their own folder
- **THEN** Storage SHALL refuse the upload

#### Scenario: Unenforced capacity is recorded, not silently assumed
- **WHEN** `rides.max_riders` is set
- **THEN** nothing SHALL claim it is enforced: no policy, trigger or constraint limits
  `ride_members` by it, and this migration does not add one

#### Scenario: An ownership transfer leaves no path pointing at a departed rider
- **WHEN** a club changes hands because its owner deleted their account
- **THEN** `avatar_path` and `cover_image_path` SHALL be NULL on the transferred row, and the
  club SHALL fall back to initials
- **AND** `clubs_avatar_path_owned` and `clubs_cover_image_path_owned` SHALL still exist by name
  afterwards, because clearing the paths satisfies them rather than requiring their removal

#### Scenario: A relaxation, if adopted at all, still refuses a forged path
- **WHEN** either club path CHECK is replaced rather than satisfied
- **THEN** the replacement SHALL still refuse any path whose uid segment names a rider who never
  uploaded the object
- **AND** it SHALL NOT be reduced to a shape check on the prefix alone, which would let any
  member point a club's imagery at any rider's folder

#### Scenario: Sweeping a departed rider's folders widens nobody's grant
- **WHEN** the deletion removes objects under all five of the departing rider's prefixes
- **THEN** no new `storage.objects` policy SHALL be created, and no existing one SHALL be
  widened
- **AND** the count of `storage.objects` policies granted to anything other than `authenticated`
  SHALL remain zero, so no owner, admin, member, non-member or blocked rider gains reach into a
  folder that is not their own
