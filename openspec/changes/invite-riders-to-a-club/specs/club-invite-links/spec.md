# club-invite-links

## ADDED Requirements

### Requirement: A club invite token SHALL grant exactly two RPC calls and no policy reach

Possession of a live token SHALL permit `public.club_invite_link_preview(t)` and
`public.claim_club_invite_link(t)` and nothing else. Both SHALL be granted to `authenticated`
**alone**; `anon` SHALL hold no privilege on the table or on any function this capability adds.

**This capability SHALL add no arm to `clubs` SELECT and SHALL NOT touch `private.can_read_club`,
`club_members` SELECT, `discoverable_private_clubs` or any `storage.objects` policy.** After a claim
the rider's reach is an ordinary `club_members` row, so an admitted claimer is indistinguishable from
an approved join request everywhere access is decided. **The token is a way of reaching an existing
grant, never a new one.**

#### Scenario: A token holder reads nothing through RLS
- **WHEN** a rider holding a live token, who is not a member, selects from `clubs`, `club_members`,
  `club_threads`, `club_messages`, the club's rides and its postcards
- **THEN** every read SHALL return exactly what it returned before the token existed

#### Scenario: The pinned objects do not move
- **WHEN** the `clubs` SELECT qual and `private.can_read_club`'s `prosrc` are compared with the
  values the suite pins
- **THEN** both SHALL be byte-identical, and a failure SHALL mean this change is wrong

#### Scenario: No anonymous reach
- **WHEN** `has_function_privilege` is asked for `anon` on both RPCs, and
  `information_schema.table_privileges` is read for `anon` on `public.club_invite_links`
- **THEN** every answer SHALL be false or empty, asserted per grantee

### Requirement: Only an owner or admin of a PRIVATE club SHALL mint, list or revoke a link

`club_invite_links` INSERT SHALL require `created_by = auth.uid()` **and**
`private.may_mint_club_link(club_id)`, whose subject-taking body SHALL be
`private.is_club_admin_for(candidate, club) AND NOT the club is public`.

**A public club SHALL have no tokened link at all.** Every signed-in rider may already open a public
club's URL and join it, so a token there would be a capability surface with no capability behind it,
and a second, weaker description of one permission.

**Minting authority SHALL equal the authority that answers a join request.** Any looser set lets a
member hand out an admission that an admin has already refused.

SELECT and DELETE SHALL be the club's owner and admins, written as
`private.is_club_admin(club_id)` so the row follows the **club** rather than the minter — a link
outlives the admin who made it, and a co-admin must be able to see and kill it.

#### Scenario: An ordinary member cannot mint
- **WHEN** a member whose role is `member` inserts a link for a private club they belong to
- **THEN** it SHALL be refused with `42501`

#### Scenario: A public club refuses a link
- **WHEN** an owner or admin of a **public** club inserts a link
- **THEN** it SHALL be refused with `42501`
- **AND** the surface SHALL offer `Share club` instead, which shares the club's own URL

#### Scenario: A co-admin sees and can revoke another admin's link
- **WHEN** an admin who did not mint the link lists and revokes it
- **THEN** both SHALL succeed, because the policies name the club and not `created_by`

#### Scenario: A non-member and an ordinary member see no links
- **WHEN** either selects from `club_invite_links` for that club
- **THEN** zero rows SHALL be returned

### Requirement: The token SHALL be server-owned, and the table SHALL carry no UPDATE grant

`token` SHALL be 128 bits from `extensions.gen_random_bytes(16)` rendered as 32 lowercase hex, with a
`unique` constraint and `check (token ~ '^[0-9a-f]{32}$')`.

**It SHALL be server-owned by the GRANT and not by its default**: `grant insert` SHALL name
`(id, club_id, created_by)` and nothing else, because a default applies only when the column is
omitted and PostgREST will happily name it.

`expires_at` SHALL be `now() + interval '14 days'`, written by a **column default** — this is the one
place the ride precedent is not copied, because `091` needed a BEFORE INSERT trigger only to read
`rides.departure_at` and a club has no such column. It SHALL be server-owned the same way, by not
appearing in the grant.

There SHALL be **no UPDATE grant and no UPDATE policy**. `revoked_at` SHALL be written by
`public.revoke_club_invite_link` and by nothing else — a grant on that column would let a client
un-revoke by writing NULL back.

#### Scenario: A client cannot choose or rotate a token
- **WHEN** `information_schema.column_privileges` is read for `authenticated`
- **THEN** `token`, `expires_at`, `created_at` and `revoked_at` SHALL appear in no INSERT or UPDATE
  column list

#### Scenario: A client cannot un-revoke
- **WHEN** `has_table_privilege('authenticated', 'public.club_invite_links', 'update')` is asked
- **THEN** it SHALL be false, and no UPDATE policy SHALL exist

#### Scenario: Guessing is not an attack
- **WHEN** the token's entropy is reviewed
- **THEN** 128 bits SHALL be treated as sufficient that no rate limit, ledger or lockout is built for
  the claim path on the strength of guessing alone

### Requirement: Liveness and reachability SHALL each have exactly one definition, and neither RPC SHALL restate them

`private.live_club_invite_link(t)` SHALL be **the single definition of "live"**: the token matches,
`revoked_at` is NULL, `now() < expires_at`, and the club still exists. It SHALL take no caller, read
no `auth.uid()`, return zero rows for every dead state and never raise.

`private.club_invite_link_reachable_by(t, uid, lock)` SHALL be **the single definition of "this
caller may use this token"**, and the **only entry point either public RPC has**: live, **and** the
minter still holds `may_invite_to_club_for`, **and** not blocked with the minter, **and** not blocked
with the club's owner, **and** both participation stamps on the caller, **and** the caller is neither
the owner nor already a member.

**Neither RPC body SHALL contain an `is_blocked` call or a `profiles` stamp test**, asserted by
reading `prosrc`. A preview more permissive than its claim is a pure disclosure; a preview less
permissive is a rider staring at "no longer valid" for a link that works; and neither is visible from
either body alone, because there is no policy underneath a `security definer` read.

**The participation gate SHALL govern the READ as well as the write.** Without it, an account created
by calling GoTrue's `/auth/v1/signup` directly and never calling `accept_terms()` could hold a
forwarded token and read a private club's name, location and size.

Both public RPCs SHALL be **VOLATILE**, not `stable`: `reachable_by` may take `for share`, which
Postgres refuses in a non-volatile function, and a `stable` function is served over GET by PostgREST
— which would put a live capability token in the query string of the project's own request log.

#### Scenario: The predicate lives in one place
- **WHEN** `prosrc` for `club_invite_link_preview` and `claim_club_invite_link` is searched for
  `is_blocked` and `terms_accepted_at`
- **THEN** neither SHALL appear in either body

#### Scenario: An un-onboarded holder previews nothing
- **WHEN** a rider with `terms_accepted_at` NULL calls the preview with a live token
- **THEN** zero rows SHALL be returned, and their claim SHALL reach the single raise site with the
  same message as every other unreachable case

#### Scenario: A revoke and an in-flight claim serialise
- **WHEN** a claim resolves reachability while a revoke of the same link is committing
- **THEN** the `for share` taken on the link row before liveness is resolved SHALL make the two
  serialise, and the loser SHALL see the committed outcome

### Requirement: Every dead state SHALL be one outcome, indistinguishable from a guess

The preview SHALL return **zero rows** and raise nothing. The claim SHALL have exactly **one raise
site**, one message and one SQLSTATE.

Expired, revoked, club deleted, minter demoted or departed, blocked with the minter, blocked with the
owner, un-onboarded, already a member, the caller being the club's owner, malformed and unmatched
SHALL all arrive there. A second message is an oracle telling a prober which token strings are real.

#### Scenario: Eleven dead states, one answer
- **WHEN** each of the states above is exercised against the preview and against the claim
- **THEN** the preview SHALL return zero rows every time and the claim SHALL raise the identical
  message and SQLSTATE every time
- **AND** the assertion SHALL compare the **message**, not only the SQLSTATE, because a
  SQLSTATE-only comparison passes green with an oracle present

#### Scenario: A malformed token is not parsed
- **WHEN** a string that is not 32 hex characters is passed
- **THEN** it SHALL be compared as text and match no row, rather than raising a parse error that
  would confirm the token format

### Requirement: The preview SHALL be six named columns of exactly one club

`public.club_invite_link_preview(t)` SHALL return `club_id`, `name`, `avatar_path`, `location_name`,
`members_count` and `is_public`, and **nothing else**. `returns table`, never `returns setof
public.clubs`, so a column added to `clubs` later is not disclosed by a migration that never mentions
this function.

It SHALL return **a member count and never a roster**, no description, no cover, no owner, no
`created_at`, no rides and no threads.

`is_public` SHALL be returned because a rider deciding whether to join is deciding whether their
presence and content become visible to a closed group; withholding it makes the decision worse rather
than the club safer.

`avatar_path` SHALL be returned and SHALL NOT sign for a non-member, `016`'s storage policy running
its own `EXISTS` against `clubs` under the reader's row security — so the card draws initials,
deliberately, exactly as `085` left it.

#### Scenario: The return list is the disclosure
- **WHEN** `pg_get_function_result` is read for the function
- **THEN** it SHALL name exactly those six columns, so adding a seventh is a red test rather than a
  code review

#### Scenario: No roster
- **WHEN** a token holder previews a club with members
- **THEN** they SHALL receive a count and no rider id, username or avatar

### Requirement: A claim SHALL write one membership row, SHALL be idempotent, and SHALL bypass the join-request approval

`public.claim_club_invite_link(t)` SHALL take the **token** and never a club id or a rider id — the
subject is `auth.uid()` and the resource is the link.

It SHALL resolve through `private.club_invite_link_reachable_by(t, uid, lock => true)` and nothing
else, then write the membership through `private.join_club_from_invite`, which restates the
participation gate. The written `club_members` row SHALL carry `invite_link_id`.

**A claim SHALL NOT create a `club_join_requests` row and SHALL NOT wait for an approval.** The
admin's act of minting is the club's consent, given in advance; `085`'s approval step gates a
**rider-initiated** join, and since `085` every private club is already discoverable and requestable
by every signed-in rider, so a request-only token would grant nothing the app grants for free.

A pending `club_join_requests` row for the same pair SHALL be deleted in the same transaction, after
the membership is written, so the existing retraction trigger clears the admins' notification.

#### Scenario: A stranger claims and becomes a member
- **WHEN** a signed-in, onboarded, unblocked rider claims a live token for a private club
- **THEN** exactly one `club_members` row SHALL exist with `role = 'member'` and `invite_link_id` set
- **AND** `private.notify_club_joined` SHALL fan out to the owner and admins exactly as for any other
  join
- **AND** no `club_join_requests` row SHALL be created

#### Scenario: Claiming twice writes nothing twice
- **WHEN** the same rider claims the same token again
- **THEN** no second `club_members` row SHALL be written, the derived use count SHALL not move, and
  the RPC SHALL be indistinguishable from a first claim in what it discloses

#### Scenario: The club's own admin claiming their link
- **WHEN** an owner or an existing member calls the claim with their own club's token
- **THEN** it SHALL reach the single raise site, because `reachable_by` excludes the owner and
  existing members — and the surface SHALL read its own membership rather than relying on that

#### Scenario: A claim on a club that has since become public
- **WHEN** a live token's club is made public and a rider claims it
- **THEN** the claim SHALL succeed and SHALL admit nothing the club's own URL would not

### Requirement: Revoke SHALL kill the token and eject nobody, and removal SHALL NOT bar re-entry

`public.revoke_club_invite_link(link uuid)` SHALL be an RPC rather than an UPDATE grant, with one
raise site covering "no such link", "not your club" and "already revoked".

**It SHALL remove nobody.** The riders a link already admitted keep their `club_members` rows,
deliberately: a mis-tap must not silently eject people who have already joined.

**Unlike rides, an eject path exists** — `088`'s `remove_club_member` — and the surface MAY point at
it. **It does not stop a removed rider returning through the same live token**, because nothing
records a removal. That gap SHALL be stated in the migration and in the copy: the remedies are to
revoke the link and, if necessary, to block. The Revoke button's copy SHALL NOT imply a removal that
does not happen, and the Remove control SHALL NOT imply a permanence it does not have.

#### Scenario: Revoking admits nobody new and removes nobody
- **WHEN** an admin revokes a link that has admitted three riders
- **THEN** all three SHALL keep their memberships, and a fourth claim SHALL reach the single raise
  site

#### Scenario: Deleting a link keeps its riders and loses only the attribution
- **WHEN** the link row is deleted rather than revoked
- **THEN** every `club_members.invite_link_id` referencing it SHALL become NULL and every membership
  SHALL survive, by `on delete set null`

#### Scenario: A removed rider can walk back in
- **WHEN** an admin removes a rider through `088` and the rider re-opens a live token
- **THEN** they SHALL be re-admitted, and this SHALL be recorded as a named gap rather than
  discovered

### Requirement: The use count SHALL be derived and MAY go down

The count SHALL be the number of `club_members` rows carrying the link's id. **No counter column
SHALL exist**, because a counter drifts from the rows it claims to describe.

It SHALL be read under the asking admin's own row security, so it decreases when a rider **leaves**
and when a rider **blocks** that admin — `club_members` SELECT being block-dominated. The surface
SHALL say `N joined` and SHALL NOT present the number as an immutable ledger.

**`invite_link_id` SHALL be provenance and nothing else.** No policy, trigger or read predicate SHALL
branch on it: a rider admitted through a link SHALL be indistinguishable from one approved by an
admin everywhere access is decided.

#### Scenario: Nothing branches on the column
- **WHEN** every policy qual, trigger definition and helper body touching `club_members` is read
- **THEN** none SHALL reference `invite_link_id`

#### Scenario: No client writes it
- **WHEN** `information_schema.column_privileges` is read for `authenticated` on `club_members`
- **THEN** `invite_link_id` SHALL appear in neither the INSERT nor the UPDATE column list, which
  holds by default because the existing grants are per column over `(club_id, role, user_id)`

### Requirement: A claim SHALL be a tap, and no effect SHALL ever spend a token

**No `useEffect`, no route-guard branch and no `onAuthStateChange` listener SHALL call
`claim_club_invite_link`.** The only caller SHALL be a user-initiated event handler, asserted **in
the source** rather than only in the markup.

A stash is a string in a browser and the rider who signs in is not necessarily the rider who opened
the link. An automatic claim would join *whoever signs in next on this device* to a private club they
were never told about — with a membership row and a `club_joined` notification naming them to the
club's admins. At the database layer that is a perfectly valid claim, so **no assertion in
`supabase/tests/` can see it**; only the client contract can refuse it.

#### Scenario: The source carries no claiming effect
- **WHEN** the landing component's **comment-stripped** source is inspected
- **THEN** it SHALL contain no `useEffect`, no auth-state listener and exactly one call site for the
  claim, inside a handler
- **AND** the source SHALL be stripped of comments first, because a docstring saying "there is no
  `useEffect` in this file" fails a naive assertion against a correct file

#### Scenario: A second rider signing into the same tab claims nothing
- **WHEN** rider A opens a link, abandons sign-up, and rider B signs in in the same tab
- **THEN** nothing SHALL be claimed until somebody taps, and the screen SHALL show B the preview and
  whose club it is before they decide

### Requirement: The landing route SHALL be public so it can hold a credential, and SHALL show nothing without a session

`/clubs/join` SHALL be added to **both** `PUBLIC_PATHS` and `needsOnboardingState()`'s set.
`needsOnboardingState`'s first line is `if (!isPublicPath(pathname)) return true`, so adding the
route to the first alone silently answers the second `false`: the stamps are never read, the guard
answers "stay", and a rider who has just signed up sits on a screen whose only button raises
`check_violation` for ever.

With no session the screen SHALL render the shell, a **generic** sentence naming neither the club nor
its minter, and the two auth buttons. It SHALL call **neither RPC**. Decision #1 is untouched and no
`anon` grant SHALL be added to make this screen richer.

The token SHALL be a **query parameter**, not a path segment: the route tree is shared with the
Capacitor build, where `output: 'export'` would require `generateStaticParams` for a dynamic segment
and break `npm run build:native`.

The token SHALL be stashed in `sessionStorage` under its own key, distinct from the ride token's, and
`signOut` SHALL clear **both**.

#### Scenario: A visitor with no session sees no club
- **WHEN** `/clubs/join?token=…` is opened with no session, holding a live token, a dead one and none
  at all
- **THEN** all three SHALL render the identical generic screen and issue no RPC

#### Scenario: The wizard detour loses nothing
- **WHEN** a brand-new rider signs up from that screen and completes onboarding in the same tab
- **THEN** the stash SHALL survive the wizard and return them to `/clubs/join`, where one tap claims
- **AND** if they sign up in a different browser, the WhatsApp link SHALL still work, because the URL
  is the durable copy and the stash is only a convenience

#### Scenario: The two stashes never spend each other
- **WHEN** a rider holds a stashed ride token and a stashed club token in one tab
- **THEN** each landing screen SHALL read only its own key
- **AND** a club token passed to the ride RPC SHALL match no row, which is the ordinary dead-token
  answer rather than a grant

### Requirement: Links SHALL have a stated retention and a stated expiry

`expires_at` SHALL be `created_at + 14 days`, absolute. A club has no departure, so `091`'s
`least(departure, ceiling)` has no first argument here and the ceiling is the whole control.

A row SHALL survive its own expiry so the admin can see what they minted; it SHALL die when the club
is deleted, when its minter deletes their account, or when an admin deletes it.

#### Scenario: The club is deleted
- **WHEN** a club with live links is deleted
- **THEN** every link SHALL be removed by `on delete cascade`, and every token SHALL behave exactly as
  one that never existed

#### Scenario: The minter deletes their account
- **WHEN** the rider who minted a link deletes their account
- **THEN** the link SHALL be removed by `on delete cascade` on `created_by`, and each FK into
  `profiles` SHALL lead an index

#### Scenario: An expired link still lists
- **WHEN** an admin opens the link section after a link has expired
- **THEN** the row SHALL still be listed, marked expired, with its use count intact

### Requirement: Every link surface SHALL define all seven of its states

Empty, loading, error, offline, permission-denied-versus-empty, partial and stale SHALL each be
defined for the admin's link section and for the landing screen.

#### Scenario: The landing screen's states are distinguished
- **WHEN** the preview is read
- **THEN** `undefined` SHALL render a skeleton and `null` SHALL render one dead-link message that
  never says which state it is
- **AND** a **failed read** SHALL render an error with a retry, because "we could not ask" and "the
  answer is no" are different sentences

#### Scenario: Offline on the landing screen
- **WHEN** the device is offline
- **THEN** the screen SHALL say so and offer a retry rather than reporting the link dead, and the
  claim button SHALL be disabled

#### Scenario: Stale liveness
- **WHEN** a link is revoked while somebody has the landing screen open
- **THEN** the claim SHALL fail with the single message and the screen SHALL move to the dead-link
  state, because liveness is decided by the database at the moment of the tap and never by the
  cached preview
