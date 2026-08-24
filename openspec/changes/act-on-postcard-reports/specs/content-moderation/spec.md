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

#### Scenario: Neither view is a write surface
- **WHEN** any role attempts INSERT, UPDATE or DELETE against the triage surface or the
  pending-photo surface
- **THEN** the attempt SHALL be refused for every role except the database owner
- **AND** no INSERT, UPDATE or DELETE privilege SHALL exist on either object for `anon`,
  `authenticated` or `service_role`

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

### Requirement: A take-down SHALL leave evidence that outlives the content it removed

`postcard_reports.postcard_id` is `ON DELETE CASCADE`, so removing a reported postcard erases
the reports about it. **That cascade is kept deliberately** — a report is a complaint about a
piece of content, and retaining reports pointing at nothing means retaining a reporter's
identity and free-text note indefinitely for no stated purpose.

What SHALL survive instead is an append-only record of the **action**: an owner-only ledger in
`private`, written in the same transaction as the delete and before it, so a failed delete
rolls the ledger row back with it.

The ledger SHALL record the postcard id, the author id, a snapshot of the caption and
`image_path`, the report count and distinct reasons at the moment of removal, `acted_at`, and a
free-text note. It SHALL NOT record `reporter_id`: it records what was removed and why, not who
complained.

#### Scenario: Removing a postcard leaves a ledger row and no reports
- **WHEN** the owner takes down a postcard that carries reports
- **THEN** the reports against it SHALL be gone, by the existing cascade
- **AND** exactly one ledger row SHALL exist naming that postcard, its author, its caption, its
  image path, and the number and kinds of report it carried

#### Scenario: The ledger is append-only for everyone
- **WHEN** any role attempts to UPDATE or DELETE a ledger row
- **THEN** the attempt SHALL be refused for every role except the database owner
- **AND** no UPDATE or DELETE privilege SHALL exist on the ledger for `anon`, `authenticated` or
  `service_role`

#### Scenario: No client role can read the ledger
- **WHEN** `anon`, `authenticated` or `service_role` selects from the ledger
- **THEN** the read SHALL be refused, by the same three barriers that protect the triage surface

#### Scenario: A failed take-down leaves no ledger row
- **WHEN** the take-down is called with an id that matches no postcard
- **THEN** no ledger row SHALL be written
- **AND** the function SHALL report that it removed nothing

### Requirement: A take-down SHALL make the un-removed photo findable

Deleting the `postcards` row does not delete the Storage object at `image_path` — Postgres and
Storage are separate systems — and `delete from storage.objects` is refused outright by
Supabase's own guard (`42501: Direct deletion from storage tables is not allowed`). So **no SQL
this change can write is able to remove the photo**, while `/legal/privacy` already tells riders
that removing a postcard removes its photo.

A take-down SHALL therefore be a two-step procedure whose second step is discoverable rather
than remembered: a surface SHALL list every take-down whose Storage object still exists, and the
procedure SHALL be written down as a runbook.

#### Scenario: A take-down whose photo is still in the bucket is listed
- **WHEN** the owner takes down a postcard and does not yet delete its Storage object
- **THEN** the pending-photo surface SHALL list that take-down with its `image_path`
- **AND** the entry SHALL disappear once the object is removed through the Storage API

#### Scenario: The pending-photo surface is owner-only
- **WHEN** `anon`, `authenticated` or `service_role` selects from the pending-photo surface
- **THEN** the read SHALL be refused, by the same three barriers as the triage surface

#### Scenario: The removed photo is unreachable to riders in the meantime
- **WHEN** a rider requests the Storage object of a taken-down postcard before step two runs
- **THEN** the request SHALL be refused, because `010`'s Storage SELECT policy resolves
  visibility through a `postcards` row that no longer exists

### Requirement: The take-down ledger SHALL carry a stated retention window

The ledger holds a caption, an image path encoding a rider's uuid, and an author id. That is
personal data, and it SHALL have a stated window from the day the table is created rather than
becoming a permanent record by default.

The window SHALL be recorded in the table's own comment and in the runbook. **No mechanism
enforces it on a schedule** — this project has taken no decision on scheduled jobs — so the
window is a documented procedure until it has one, and that gap SHALL be stated rather than
implied.

#### Scenario: The window is discoverable from the database
- **WHEN** a session reads the ledger's table comment
- **THEN** it SHALL find the retention window and the fact that nothing enforces it
  automatically

#### Scenario: The window is not silently permanent
- **WHEN** the retention window is chosen
- **THEN** it SHALL be a stated number of months agreed by the product owner, defaulting to 24
- **AND** a ledger with no window SHALL NOT ship
