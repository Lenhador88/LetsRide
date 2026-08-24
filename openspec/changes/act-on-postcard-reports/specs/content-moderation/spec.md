# content-moderation (delta)

## ADDED Requirements

### Requirement: Filed reports SHALL be readable by the project owner and by nobody else

`postcard_reports` is write-only today: `011` grants SELECT only to the reporter, and its own
table comment says *"Write-only in practice"*. A triage surface SHALL exist that presents every
filed report with the postcard it names, and it SHALL be reachable **only** by a connection
authenticating as the database owner — the Supabase dashboard's SQL editor.

The surface SHALL be created in the **`private` schema**. That is not a stylistic preference:
an object created in `public` by a migration is born granted to `authenticated` and
`service_role` by Supabase's default privileges, and PostgREST publishes `public`. The same
object in `private` is born with no grants at all, and `anon` and `authenticated` hold no USAGE
on that schema. See `design.md` D1 for the measurement.

The surface SHALL additionally carry an explicit `revoke all … from anon, authenticated,
service_role`, even though all three are already born without the grant, so that a later change
to default privileges cannot silently publish it.

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** a request arrives with the `anon` key, by any route including PostgREST
- **THEN** `anon` SHALL hold no USAGE on `private`, no privilege on the triage surface, and no
  route to it
- **AND** the signed-out visitor SHALL continue to reach only the app shell and `/legal/*`,
  which is what decision #1 already guarantees

#### Scenario: A signed-in rider cannot read the triage surface
- **WHEN** any rider authenticated as `authenticated` selects from the triage surface, by
  PostgREST or by any SQL path available to that role
- **THEN** the read SHALL be refused
- **AND** `has_schema_privilege('authenticated', 'private', 'usage')` SHALL be false
- **AND** `has_table_privilege('authenticated', '<triage surface>', 'select')` SHALL be false

#### Scenario: `service_role` cannot read the triage surface
- **WHEN** a caller holding the service-role key selects from the triage surface
- **THEN** the read SHALL be refused
- **AND** the refusal SHALL come from the object privilege, because `service_role` **does** hold
  USAGE on `private` (`031` granted it) and holds `BYPASSRLS`, so no other layer is doing the
  work here

#### Scenario: The reported postcard's own author still cannot read reports about it
- **WHEN** the author of a reported postcard reads `postcard_reports` as `authenticated`
- **THEN** they SHALL see zero rows, exactly as before this change
- **AND** the reporter's identity SHALL NOT be discoverable by the reported rider through any
  object this change adds

#### Scenario: A reporter still reads only their own reports
- **WHEN** a rider who has filed a report selects from `postcard_reports`
- **THEN** they SHALL see their own report rows and no others
- **AND** the policy `"Riders see only the reports they filed"` SHALL be unmodified by this
  change

### Requirement: The triage surface SHALL NOT become a second way to read postcards

The triage surface runs as the database owner, who holds `BYPASSRLS`. It therefore resolves
postcards that RLS would refuse to the caller: postcards in private clubs the owner is not a
member of, postcards a viewer has hidden, and postcards authored by a rider who has blocked
them. That bypass is the surface's purpose and SHALL be stated as such in the migration.

Because the bypass is real, unreachability is the entire defence, and the surface SHALL
therefore expose the minimum a triage decision needs.

#### Scenario: Blocking is not undone for anyone who can reach the client
- **WHEN** rider A has blocked rider B
- **THEN** no object added by this change SHALL make B's content, profile or report visible to
  A, or A's to B, through any role reachable from the client
- **AND** decision #2 SHALL remain enforced in RLS for every client role, with the owner
  connection as the single deliberate exception

#### Scenario: The surface exposes no `auth.users` data
- **WHEN** the triage surface is read by the owner
- **THEN** it SHALL NOT expose any column of `auth.users` — no email address, no sign-in
  metadata, no confirmation or password state
- **AND** the reported rider SHALL be identified by `profiles.username` and their uuid

#### Scenario: The surface exposes the reporter as an identifier only
- **WHEN** the triage surface is read by the owner
- **THEN** it SHALL expose `reporter_id` and SHALL NOT expose the reporter's username, profile
  or any other reporter-identifying column

#### Scenario: The surface exposes the image path
- **WHEN** the triage surface is read by the owner
- **THEN** it SHALL expose the reported postcard's `image_path`, because that is the only way to
  locate the Storage object that a take-down cannot delete

#### Scenario: The triage surface is not a write surface
- **WHEN** any role attempts INSERT, UPDATE or DELETE against the triage surface
- **THEN** the attempt SHALL be refused for every role except the database owner
- **AND** no INSERT, UPDATE or DELETE privilege SHALL exist on it for `anon`, `authenticated`
  or `service_role`

### Requirement: A take-down SHALL remove exactly one postcard and SHALL be callable by nobody from the client

A privileged removal SHALL exist that deletes exactly one postcard, named by id. It SHALL take
a single `uuid` argument and SHALL return what it did, so a wrong id is distinguishable from a
successful removal.

It SHALL live in `private`, SHALL be `security invoker` — **not** `security definer` — and SHALL
carry `set search_path = ''` with every name schema-qualified per `005`. `public.moderate_comment`
(`011` §1b) is the precedent for the narrowness and not for the escalation: that function is
`security definer` because a *rider* calls it and cannot read the row their action depends on,
whereas this one is called by the table owner, who already holds `BYPASSRLS` and has nothing to
escalate to. See `design.md` D4.

Callability SHALL be enforced by **both** the grant and the schema placement, so that neither
alone is load-bearing.

#### Scenario: No client role can call the take-down
- **WHEN** `anon`, `authenticated` or `service_role` attempts to call the take-down, by
  PostgREST or by SQL
- **THEN** the call SHALL be refused
- **AND** `has_function_privilege(<role>, '<take-down>(uuid)', 'execute')` SHALL be false for
  each of the three
- **AND** PostgREST SHALL have no route to it, because it routes only to `public`

#### Scenario: The take-down removes one postcard and nothing else
- **WHEN** the owner calls the take-down with the id of one reported postcard
- **THEN** exactly that postcard SHALL be deleted
- **AND** every other postcard, club, ride, profile, comment and report not attached to it SHALL
  still exist, asserted by counting survivors rather than by counting the deletion

#### Scenario: The take-down cannot be turned into a general delete
- **WHEN** the take-down's definition is read
- **THEN** it SHALL name exactly one table in its `delete`, SHALL filter on the `uuid` it was
  given, and SHALL NOT accept a predicate, a filter expression or a second id
- **AND** rows removed alongside the postcard SHALL be removed by the cascades `011` already
  documents, never by a second `delete` in the function body

#### Scenario: No rider gains a delete right over another rider's postcard
- **WHEN** a rider attempts to delete a postcard they did not author
- **THEN** the delete SHALL still affect zero rows, and the postcard SHALL survive
- **AND** `009`'s `"Authors can delete their own postcards"` policy SHALL be unmodified

### Requirement: A take-down SHALL hand back the evidence it destroys

`postcard_reports.postcard_id` is `ON DELETE CASCADE`, so removing a reported postcard erases
the reports about it. **That cascade is kept deliberately**, and so is the absence of any
archive behind it: a store holding a caption, an `image_path` encoding a rider's uuid and an
author id would outlive the account deletion `029` performs and `/legal/account-deletion`
promises erases all three. That is a retention decision with a lawful basis and a window behind
it, not a column a take-down function may add on its own.

So the evidence SHALL be returned to the operator **at the moment of acting**, by the take-down
itself, read before the delete that destroys it. Nothing in the database keeps a second copy.

**Two consequences SHALL be stated rather than discovered**, because both read as defects to
anyone assuming an archive exists:

- A per-author report count computed from live rows is an **open** count and never a lifetime
  one — each take-down zeroes that author's history, so a repeat offender under-counts exactly
  in proportion to how well moderation has been working.
- Nothing records that a take-down happened at all. The only artefact is whatever the operator
  keeps from the return value.

#### Scenario: The take-down returns what it removed
- **WHEN** the owner takes down a postcard that carries reports
- **THEN** the call SHALL return the postcard's id, author, caption and `image_path`, and every
  report against it with its reason, note, reporter identifier and timestamp
- **AND** the reports themselves SHALL then be gone, by the existing cascade

#### Scenario: A take-down that matches nothing is a clean answer
- **WHEN** the take-down is called with an id that matches no postcard
- **THEN** it SHALL report that it removed nothing, rather than raising
- **AND** nothing SHALL be written anywhere

#### Scenario: The per-author count is documented as open rather than lifetime
- **WHEN** a session or an operator reads the triage surface's per-author count
- **THEN** the surface's own comment SHALL say that the count covers open reports only and that
  a take-down erases that author's history

### Requirement: The photo SHALL be deleted in the same sitting, and the copy SHALL NOT promise more

Deleting the `postcards` row does not delete the Storage object at `image_path` — Postgres and
Storage are separate systems — and `delete from storage.objects` is refused outright by
Supabase's own guard (`42501: Direct deletion from storage tables is not allowed`). So **no SQL
this change can write is able to remove the photo.**

**And no policy hides it in the meantime.** It is tempting to reason that an orphaned object is
unreachable, because the `media` bucket is private and `010`'s Storage SELECT policy resolves
through a `postcards` row that no longer exists. That is true of an RLS-mediated read, and
**the app never does one**: `src/lib/data/media.ts` hands the browser a signed URL with a
one-hour TTL, and Supabase validates the signature rather than re-running the policy. A rider
whose feed had already rendered the postcard keeps a working URL for the rest of that hour, and
so does anyone they forward it to, signed out or with no account at all.

A take-down SHALL therefore be a two-step procedure whose second step is written down as a
runbook and understood as **time-bounded rather than optional**, and the rider-facing copy SHALL
NOT claim an immediacy the mechanism does not provide.

#### Scenario: The runbook names the second step and its window
- **WHEN** an operator follows the take-down runbook
- **THEN** it SHALL name the bucket and the path to delete, and SHALL say that until the object
  is deleted an already-issued signed URL keeps working for the remainder of its TTL

#### Scenario: The published copy does not promise an instant
- **WHEN** `/legal/privacy` describes what removing a postcard does
- **THEN** it SHALL NOT state that the photo becomes unfetchable immediately
- **AND** it SHALL name the signed-link window, so the claim stays true whether or not step two
  has run yet
