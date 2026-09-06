# club-invite-links

> **Read this delta against the active changes, not against `openspec/specs/`.** The
> `club-invite-links` capability is added by `invite-riders-to-a-club` (PD-360) and **is not
> archived**, so the base text these requirements modify lives in
> `openspec/changes/invite-riders-to-a-club/specs/club-invite-links/spec.md`. Archive that change
> before this one, or the delta has nothing to attach to.

## MODIFIED Requirements

### Requirement: Liveness and reachability SHALL each have exactly one definition, and neither RPC SHALL restate them

`private.live_club_invite_link(t)` SHALL be **the single definition of "live"**: the token matches,
`revoked_at` is NULL, `now() < expires_at`, and the club still exists. It SHALL take no caller, read
no `auth.uid()`, return zero rows for every dead state and never raise.

`private.club_invite_link_reachable_by(t, uid, lock)` SHALL be **the single definition of "this
caller may use this token"**, and the **only entry point either public RPC has**: live, **and** the
minter still holds `may_invite_to_club_for`, **and** not blocked with the minter, **and** not blocked
with the club's owner, **and** both participation stamps on the caller, **and** the caller is neither
the owner nor already a member, **and the caller SHALL NOT hold a removal record for the club**.

**The removal conjunct belongs here and provably nowhere else**, and the three reasons are the same
ones that put the other six here:

- put in either public body, it breaks the `prosrc` assertion below and lands a caller predicate
  where no policy sits underneath it;
- put in the claim alone, it makes the preview **more permissive than its claim** — the removed
  rider browses the club and is refused on the tap — which this requirement already names as a pure
  disclosure;
- put in the shared join body, it would refuse an **in-app invite** as well, which is a different
  product decision and is not this one.

**It is the second predicate in this capability whose validity is re-derived at every use rather
than fixed at creation**, alongside the minter's authority, and it needs no new concept: a link is
already only as good as the facts that are true when it is spent.

**Neither RPC body SHALL contain an `is_blocked` call, a `profiles` stamp test, or a
`club_removals` read**, asserted by reading `prosrc`. A preview more permissive than its claim is a
pure disclosure; a preview less permissive is a rider staring at "no longer valid" for a link that
works; and neither is visible from either body alone, because there is no policy underneath a
`security definer` read.

**The participation gate SHALL govern the READ as well as the write.** Without it, an account created
by calling GoTrue's `/auth/v1/signup` directly and never calling `accept_terms()` could hold a
forwarded token and read a private club's name, location and size.

Both public RPCs SHALL be **VOLATILE**, not `stable`: `reachable_by` may take `for share`, which
Postgres refuses in a non-volatile function, and a `stable` function is served over GET by PostgREST
— which would put a live capability token in the query string of the project's own request log.

#### Scenario: The predicate lives in one place
- **WHEN** `prosrc` for `club_invite_link_preview` and `claim_club_invite_link` is searched for
  `is_blocked`, `terms_accepted_at` and `club_removals`
- **THEN** none SHALL appear in either body

#### Scenario: The removed rider's preview and claim agree
- **WHEN** a removed rider calls the preview and then the claim with the same live token
- **THEN** the preview SHALL return zero rows and the claim SHALL reach the single raise site, with
  no state in which they can see the club and not join it

#### Scenario: An un-onboarded holder previews nothing
- **WHEN** a rider with `terms_accepted_at` NULL calls the preview with a live token
- **THEN** zero rows SHALL be returned, and their claim SHALL reach the single raise site with the
  same message as every other unreachable case

#### Scenario: A revoke and an in-flight claim serialise
- **WHEN** a claim resolves reachability while a revoke of the same link is committing
- **THEN** the `for share` taken on the link row before liveness is resolved SHALL make the two
  serialise, and the loser SHALL see the committed outcome

#### Scenario: A removal and an in-flight claim do NOT serialise
- **WHEN** a claim resolves reachability while a removal of the same rider is committing
- **THEN** the share lock on the link row SHALL not cover the removal, the claim MAY win, and the
  bound SHALL be that removing again is idempotent — stated rather than implied

### Requirement: Every dead state SHALL be one outcome, indistinguishable from a guess

The preview SHALL return **zero rows** and raise nothing. The claim SHALL have exactly **one raise
site**, one message and one SQLSTATE.

Expired, revoked, club deleted, minter demoted or departed, blocked with the minter, blocked with the
owner, un-onboarded, already a member, the caller being the club's owner, **removed from the club**,
malformed and unmatched SHALL all arrive there. A second message is an oracle telling a prober which
token strings are real.

**The removed rider is the twelfth state and SHALL NOT be given a thirteenth message**, however
tempting *"you were removed from this club"* is. It would make removal distinguishable from leaving
for the first time, reversing a decision `manage-club-riders` took deliberately — and it would do so
through a side channel rather than through a decision anybody made.

#### Scenario: Twelve dead states, one answer
- **WHEN** each of the states above is exercised against the preview and against the claim
- **THEN** the preview SHALL return zero rows every time and the claim SHALL raise the identical
  message and SQLSTATE every time
- **AND** the assertion SHALL compare the **message**, not only the SQLSTATE, because a
  SQLSTATE-only comparison passes green with an oracle present

#### Scenario: The removed rider is indistinguishable from an expired token
- **WHEN** a removed rider claims a live link and then an expired one
- **THEN** both SHALL produce the identical message and SQLSTATE, and the rendered copy SHALL be the
  existing generic string with no new branch

#### Scenario: A malformed token is not parsed
- **WHEN** a string that is not 32 hex characters is passed
- **THEN** it SHALL be compared as text and match no row, rather than raising a parse error that
  would confirm the token format

## REMOVED Requirements

### Requirement: Revoke SHALL kill the token and eject nobody, and removal SHALL NOT bar re-entry

**Reason**: Its second clause is the defect PD-361 exists to fix. The requirement recorded, as a
named gap, that *"a removed rider can walk back in"* — which is now false, so keeping the
requirement would leave a normative SHALL asserting the behaviour the change removes, and one of its
scenarios asserts re-admission directly.

**Migration**: Replaced in this same delta by *Revoke SHALL kill the token and eject nobody, and a
removal SHALL bar re-entry*, below. Everything the removed requirement said about revoke — that it
is an RPC with one raise site, that it ejects nobody, and that deleting a link keeps its riders — is
carried over unchanged; only the re-entry clause and its scenario change.

## ADDED Requirements

### Requirement: Revoke SHALL kill the token and eject nobody, and a removal SHALL bar re-entry

`public.revoke_club_invite_link(link uuid)` SHALL be an RPC rather than an UPDATE grant, with one
raise site covering "no such link", "not your club" and "already revoked".

**It SHALL remove nobody.** The riders a link already admitted keep their `club_members` rows,
deliberately: a mis-tap must not silently eject people who have already joined.

**Removal now holds against a live token.** `088`'s `remove_club_member` ejects a rider, and the
removal record it writes SHALL make every link into that club unclaimable by them — the one they
already hold and any minted afterwards. Revoke and remove are therefore no longer two halves of one
remedy: **revoke is aimed at a link**, and **remove is aimed at a membership**, and an admin
removing one rider SHALL NOT have to revoke a link the rest of the club is still using.

**The copy SHALL match what each control now does.** The Remove control MAY imply that the rider
stays out by link, and SHALL NOT imply that they cannot ask to rejoin or be invited back — because
they can, and that is the decision. The Revoke control's copy is unchanged.

#### Scenario: Revoking admits nobody new and removes nobody
- **WHEN** an admin revokes a link that has admitted three riders
- **THEN** all three SHALL keep their memberships, and a fourth claim SHALL reach the single raise
  site

#### Scenario: Deleting a link keeps its riders and loses only the attribution
- **WHEN** the link row is deleted rather than revoked
- **THEN** every `club_members.invite_link_id` referencing it SHALL become NULL and every membership
  SHALL survive, by `on delete set null`

#### Scenario: A removed rider cannot walk back in
- **WHEN** an admin removes a rider through `088` and the rider re-opens a live token
- **THEN** they SHALL reach the single raise site, and the other riders holding that token SHALL be
  unaffected

#### Scenario: Removing one rider does not cost the club its link
- **WHEN** an admin removes one rider and does **not** revoke the link
- **THEN** every other holder SHALL still claim it successfully

### Requirement: A link SHALL NOT be a way to re-invite a rider the club removed

An admin who mints a **new** link after a removal SHALL find that it does not admit the removed
rider either, because the bar is keyed on the club and the rider rather than on the link.

**The consequence SHALL be surfaced in the product rather than discovered**: the way to bring a
removed rider back is to approve their join request or send them an in-app invite, both of which
stay open and both of which clear the record on admission. Nothing tells the admin why a link failed
for one person, because nothing on the claim path can address the admin.

#### Scenario: A fresh link is refused for the same rider
- **WHEN** an admin mints a new link and the removed rider claims it
- **THEN** they SHALL reach the single raise site
- **AND** the same link SHALL admit any other eligible rider

#### Scenario: Readmission restores the link path
- **WHEN** the admin instead invites the removed rider in-app, they accept, and later leave
  voluntarily
- **THEN** a live link SHALL admit them again, because the record was cleared on admission
