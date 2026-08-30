## MODIFIED Requirements

> **Read this delta against `invite-riders-to-a-ride`, not against `openspec/specs/`.** The
> `ride-invites` capability is added by PD-329's change, which is still active and unarchived, so
> the base text these requirements modify lives in
> `openspec/changes/invite-riders-to-a-ride/specs/ride-invites/spec.md`. Archive that change
> before this one, or the delta has nothing to attach to.

### Requirement: Only the ride's organizer SHALL create an invite

`public.ride_invites` INSERT SHALL be permitted only where `inviter_id = auth.uid()` **and** the
caller is the ride's `organizer_id`, evaluated by an `EXISTS` against `public.rides` under the
caller's own row security, **and** the caller is not blocked with the invitee in either direction.

No crew member, club member, club owner or club admin SHALL be able to create an invite.

`public.ride_invites` SHALL carry **no** UPDATE grant and **no** UPDATE policy for any client role.

**A second writer of this table now exists, and it is not a client.**
`public.claim_ride_invite_link` is `security definer` and therefore inserts as the owner, bypassing
both the policy and the column grants above. That is not an exception to this requirement — the
policy still governs every client insert, and the claim path is subject to its own, narrower
statement in `ride-invite-links`. It is written here because a reader of this requirement alone
would conclude that an `accepted` row for a rider nobody named is impossible, and it is not.

**The rows the two paths produce differ in exactly three ways**, and nothing else:

| | In-app invite | Link claim |
|---|---|---|
| `status` at insert | `pending`, always | `accepted`, always |
| `inviter_id` | the organizer, who chose this rider | the link's `created_by` — nobody chose this rider |
| `link_id` | NULL | the link |

#### Scenario: A crew member cannot invite
- **WHEN** a rider holding a `ride_members` row for the ride, who is not its organizer, attempts
  the insert
- **THEN** it SHALL be refused with `42501` by the INSERT policy

#### Scenario: A rider cannot pre-answer an invite they send
- **WHEN** the organizer's insert names `status`, `created_at`, `responded_at` **or `link_id`**
- **THEN** it SHALL be refused with `42501`, because INSERT is granted per column over
  `(id, ride_id, invitee_id, inviter_id)` alone
- **AND** `link_id` SHALL NOT be added to that grant, so no client can claim an admission came
  through a link when it did not, or launder one that did

#### Scenario: No client role holds UPDATE on the table
- **WHEN** `has_table_privilege` is asked for `authenticated` and for `anon` for UPDATE
- **THEN** both SHALL be false, asserted per grantee, and no UPDATE policy SHALL exist
- **AND** this SHALL remain true after `claim_ride_invite_link` exists, since it writes as the
  owner and needs no grant

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** a request for `public.ride_invites` arrives with no session
- **THEN** zero rows SHALL be returned and every write SHALL be refused

### Requirement: An invite SHALL be unique per ride and invitee, and SHALL NOT name its own inviter

`public.ride_invites` SHALL carry `unique (ride_id, invitee_id)` and
`check (invitee_id <> inviter_id)`.

**The unique key is now load-bearing for a second property: the use count.** Because a claim
upserts on that key, a rider claiming the same link twice produces no second row, so the derived
use count cannot be inflated by re-opening a link. Relaxing the key would silently break the count
as well as the anti-spam property.

**`check (invitee_id <> inviter_id)` is what refuses an organizer claiming their own link**, since
a link's `created_by` becomes the row's `inviter_id`. That is the correct outcome and the surface
SHALL NOT rely on it — it SHALL read the caller's organizer status and offer no Join control —
but the CHECK is the guarantee.

Where two paths could admit the same rider, **the first row SHALL win and SHALL keep its original
`inviter_id`.** A claim SHALL update `status`, `responded_at` and `link_id`, and SHALL NOT rewrite
`inviter_id`.

#### Scenario: A repeat invite is refused, not duplicated
- **WHEN** the organizer inserts a second invite for a rider who already holds one, in any status
- **THEN** it SHALL be refused with `23505`, and no second notification SHALL be written

#### Scenario: A claim after an in-app invite keeps the original inviter
- **WHEN** a rider holding a `pending` invite from the organizer claims a link minted by that same
  organizer
- **THEN** one row SHALL remain, `status` SHALL become `accepted`, `inviter_id` SHALL be unchanged
  and `link_id` SHALL be set

#### Scenario: The organizer cannot claim their own link
- **WHEN** a ride's organizer calls `claim_ride_invite_link` with a token from their own ride
- **THEN** the insert SHALL be refused by `check (invitee_id <> inviter_id)` with `23514`

## ADDED Requirements

### Requirement: An invite SHALL record whether a link admitted it, and that record SHALL NOT be a dependency

`public.ride_invites` SHALL gain `link_id uuid references public.ride_invite_links(id) on delete
set null`, nullable, holding no grant to any client role for INSERT or UPDATE.

**`on delete set null`, never `cascade`.** Deleting a link must not delete the riders it admitted;
that is decision 3 expressed as a referential action. An invite is a fact about two riders and a
ride, and the link is provenance.

`link_id` SHALL be readable by whoever may already read the invite row, and SHALL be used for
exactly one purpose: deriving a link's use count. **No policy, trigger or read predicate SHALL
branch on it.** A rider admitted through a link SHALL be indistinguishable from an accepted
in-app invitee everywhere access is decided — otherwise it becomes a copy of a visibility
decision, which the standing rule against derived visibility copies forbids.

#### Scenario: The column carries provenance and nothing else
- **WHEN** every policy, trigger and helper touching `ride_invites` is read
- **THEN** none SHALL reference `link_id`, asserted by inspection of `pg_policy` quals and
  `prosrc`, so provenance cannot become an audience test

#### Scenario: Deleting a link keeps its riders
- **WHEN** a `ride_invite_links` row is deleted
- **THEN** every `ride_invites` row that referenced it SHALL survive with `link_id` NULL, and
  every corresponding `ride_members` row SHALL be untouched

#### Scenario: No client writes it
- **WHEN** `information_schema.column_privileges` is read for `authenticated` on
  `public.ride_invites`
- **THEN** `link_id` SHALL appear in neither the INSERT nor the UPDATE column list
