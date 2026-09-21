# moderation-digest-delivery Specification

## Purpose
TBD - created by archiving change reports-reach-a-human-by-email. Update Purpose after archive.
## Requirements
### Requirement: A report or a feedback row SHALL reach a human without anyone opening the dashboard

Rows in `public.postcard_reports`, `public.club_thread_reports`, `public.ride_thread_reports`,
`public.postcard_comment_reports` and `public.feedback` SHALL be swept by a scheduled Edge Function
that sends one digest mail to the operator.

The digest SHALL be **strictly additive** to the existing readers. No queue view, take-down function,
policy, grant or column on any source table is modified by this capability, so the failure mode of
the whole rail is the state that existed before it: rows waiting in a queue that nobody mailed.

#### Scenario: A filed report is mailed without a human deciding to look
- **WHEN** a rider files a report and the scheduler next runs
- **THEN** the operator SHALL receive one mail naming that report
- **AND** the source row SHALL be unchanged — not flagged, not updated, not deleted

#### Scenario: A feedback row reaches a human for the first time
- **WHEN** a rider submits feedback
- **THEN** it SHALL appear in the next digest
- **AND** `public.feedback` SHALL remain write-only to every client role: no SELECT grant and no
  SELECT policy is added by this change

#### Scenario: Nothing to send sends nothing
- **WHEN** the scheduler runs and no unsent source row exists
- **THEN** the function SHALL return without calling the mail provider
- **AND** no mail SHALL be sent, including an empty or "0 new" digest

#### Scenario: The mail never arriving leaves the position unchanged
- **WHEN** the provider is unreachable for a day, or the schedule was never started
- **THEN** every source row SHALL still be readable in its `private` queue view by the project owner
- **AND** no row SHALL have been consumed, hidden or marked handled

### Requirement: A delivery failure SHALL NOT fail a rider's write, and SHALL NOT lose the row

The sweep SHALL be the only reader. **No trigger, no `pg_net` call and no function invocation SHALL
exist on any rider write path**, so a mail failure is not merely tolerated on that path — there is
nothing on it to fail.

Delivery SHALL be **at-least-once**: the marker recording that a row was mailed SHALL be written only
after the provider has accepted the mail. At-most-once is refused, because a duplicated line in a
digest is an annoyance and an unmailed report is a moderation failure.

#### Scenario: The provider is down while a rider reports
- **WHEN** a rider inserts a report row while the mail provider returns 500 to everything
- **THEN** the insert SHALL succeed
- **AND** the rider SHALL see no error, no delay and no difference of any kind

#### Scenario: The function dies after the provider accepted
- **WHEN** the mail is accepted and the process dies before the completion call
- **THEN** the entries SHALL remain unsent and claimed
- **AND** the reclaim window SHALL return them to unsent, so a later digest repeats those lines
- **AND** the repetition SHALL be bounded, because the attempt counter SHALL be incremented **by the
  claim** on every row it hands out rather than by the completion path — which never runs in this
  case, so a completion-side counter would leave the same batch re-mailing every interval for ever
- **AND** no source row SHALL be lost or unmailable

#### Scenario: The function dies before sending
- **WHEN** entries are claimed and the process dies before the provider is called
- **THEN** no marker SHALL record a send
- **AND** the same rows SHALL be claimed again by a later run

#### Scenario: Two invocations overlap
- **WHEN** two invocations claim concurrently
- **THEN** the second SHALL claim zero rows and return without calling the provider
- **AND** the property SHALL be held by `claimed_at`, the reclaim window and the per-source unique
  index on the marker — **not** by a transaction-scoped advisory lock, which is released when the
  claim transaction commits and therefore before any mail is sent
- **AND** where such a lock is used for the marker insert, its key SHALL be a stable named constant
  rather than a per-invocation value

#### Scenario: A retryable failure is bounded rather than infinite
- **WHEN** the provider returns 5xx, 429 or times out
- **THEN** the claim SHALL be released, the attempt having already been counted at claim time
- **AND** after the attempt cap the entry SHALL remain **unsent** — neither marked sent nor deleted

#### Scenario: A configuration failure is not swallowed and not retried for ever
- **WHEN** the provider returns a 4xx other than 429 — a bad key, an unverified sender, a malformed
  payload
- **THEN** the attempt counter SHALL bound the retries
- **AND** the failure SHALL be readable in the function's logs
- **AND** no provider error body SHALL be written to any table

### Requirement: What leaves the database SHALL be an enumerated column projection, decided in SQL

The claim function runs as a privileged role and therefore resolves rows that RLS would refuse to
every rider. There is no viewer to test a predicate against, so **the projection is the containment**:
the columns the mail may carry SHALL be enumerated in the function's `returns table` clause, per
source, and the Edge Function SHALL be unable to widen it because it passes no subject argument and
issues no `.from()`.

**That clause and its text pin in the RLS suite are the authority.** The scenarios below and the
prose enumerations in `proposal.md` and `design.md` are readings of it; where they disagree with the
shipped function, the function is right and the prose is stale.

#### Scenario: No rider is named
- **WHEN** a digest is assembled from any source
- **THEN** it SHALL contain no `profiles` column of any rider — no username, display name or avatar
- **AND** no column of `auth.users`, and in particular no rider email address

#### Scenario: The reporter is not identifiable from the mail
- **WHEN** a report of any of the four kinds is mailed
- **THEN** the mail SHALL NOT contain `reporter_id`, in any form, including a bare uuid
- **AND** the operator SHALL resolve the reporter in the `private` queue view at the moment they act

#### Scenario: The reported content does not leave
- **WHEN** a report is mailed
- **THEN** the mail SHALL NOT contain the postcard's caption or `image_path`, any signed URL, the
  club's name or id, the thread's title, any message body, or a postcard comment's text
- **AND** it SHALL carry the subject's id, the reason, the optional reporter note and two counts,
  `reports_on_subject` and `reports_on_author`, unqualified because no `resolved_at` exists anywhere
  in this system to make an "open" count meaningful

#### Scenario: A signed URL never appears in a mail
- **WHEN** any postcard-related row is mailed
- **THEN** no Storage URL, signed or otherwise, SHALL appear in the mail
- **AND** the reason SHALL be recorded: a signed URL is validated by signature rather than by policy,
  so it works for its full TTL for anyone a mail is forwarded to, including a signed-out stranger

#### Scenario: Feedback's body leaves and its author does not
- **WHEN** a feedback row is mailed
- **THEN** `body`, `app_version`, `route` and a `has_session_replay` boolean MAY leave
- **AND** `user_id`, the author's username, their email and `posthog_session_id` SHALL NOT

#### Scenario: The mail is not a query interface
- **WHEN** the operator reads a digest
- **THEN** it SHALL contain no link into the app, no tokenised URL, no attachment and no pagination
  cursor
- **AND** rows outside that digest's own claim SHALL be reachable only by authenticating to the
  dashboard as the database owner

#### Scenario: A block is not observable in a digest
- **WHEN** either party to a block appears in a claimed row
- **THEN** the projection SHALL contain no pair of riders, so neither the directional row nor its
  symmetric effect SHALL be inferable from the mail
- **AND** `private.is_blocked` SHALL NOT be consulted by the claim, because it names no viewer

#### Scenario: No rider-authored value reaches a mail header
- **WHEN** the mail is assembled
- **THEN** the subject line SHALL be built from counts alone
- **AND** no note, feedback body, username or address from the database SHALL appear in any header

### Requirement: The digest's bookkeeping SHALL be unreachable by every client role, `service_role` included

The marker table SHALL have RLS enabled and **no policy**, and SHALL be revoked from `anon`,
`authenticated` and `service_role`. The two RPCs SHALL be granted EXECUTE to `service_role` **by
name** and revoked from `public`, `anon` and `authenticated`. The scheduled tick SHALL be granted to
nobody at all.

#### Scenario: A signed-in rider reaches no part of the rail
- **WHEN** any rider authenticated as `authenticated` selects from the marker table or calls either
  RPC, by PostgREST or any SQL path available to that role
- **THEN** every attempt SHALL be refused
- **AND** `has_table_privilege('authenticated', 'public.moderation_digest_entries', 'select')` SHALL
  be false, as SHALL `insert`, `update` and `delete`
- **AND** `has_function_privilege('authenticated', …)` SHALL be false for both RPCs

#### Scenario: `anon` reaches nothing
- **WHEN** a request arrives with the publishable key and no session
- **THEN** `anon` SHALL hold no privilege on the marker table, no EXECUTE on either RPC and no route
  to the function
- **AND** this change SHALL add no second named exception to decision #1

#### Scenario: `service_role` cannot read or write the marker table directly
- **WHEN** a caller holding the service-role key selects from or updates the marker table
- **THEN** it SHALL be refused
- **AND** the SELECT half SHALL be the recorded reason: the table answers which reports were mailed
  and when, over every rider at once
- **AND** the revoke SHALL NOT be claimed to prevent a suppression: `complete_moderation_digest` is
  granted to `service_role` and confers exactly that, so suppression by a holder of that key is not
  preventable by grants and is contained only by the key existing in one secret store
- **AND** what the revoke SHALL be credited with is an API surface for that credential of exactly
  two named functions, and no accidental direct write

#### Scenario: The scheduled tick is callable by nobody
- **WHEN** any role including `service_role` calls `private.moderation_digest_tick()`
- **THEN** it SHALL be refused
- **AND** its only caller SHALL be `pg_cron`, which runs as the superuser

#### Scenario: A rider cannot cause a send
- **WHEN** a rider inserts any number of report or feedback rows
- **THEN** no mail SHALL be attempted as a consequence of the insert
- **AND** the number of mails SHALL be bounded by the schedule's interval and the batch size, never
  by the number of rows

#### Scenario: Neither party to a report learns a mail happened
- **WHEN** the reported rider, the reporter, the thread's author, the postcard's author, the ride's
  organiser or a club owner or admin reads anything the app offers
- **THEN** nothing SHALL indicate that a report was mailed, read or acted on
- **AND** no rider-readable column SHALL change when a digest is sent

### Requirement: A row deleted before its digest SHALL NOT be mailed, and a mail already sent SHALL be acknowledged as unrecallable

The marker SHALL carry one nullable foreign key per source, each `ON DELETE CASCADE`, with a CHECK
that exactly one is non-null and agrees with the source kind. Retention of a marker SHALL be the
cascade window and nothing else.

#### Scenario: An account deletion beats the digest
- **WHEN** a rider deletes their account while one of their feedback rows is unsent
- **THEN** the row SHALL cascade away per `084` §0b and its marker SHALL cascade with it
- **AND** the deleted content SHALL NOT appear in any later digest

#### Scenario: A claimed row that vanishes is skipped, not failed
- **WHEN** a claimed entry's subject is deleted between the claim and the send
- **THEN** its projection SHALL resolve to nothing and the entry SHALL complete as skipped
- **AND** the digest SHALL NOT contain a blank entry and SHALL NOT report a failure

#### Scenario: A deleted subject takes its reports and their markers
- **WHEN** a postcard, comment, thread or reporter is deleted
- **THEN** the existing cascades SHALL remove the reports
- **AND** no orphan marker SHALL remain, and no new cleanup path SHALL be required

#### Scenario: A sent mail is outside every cascade, and this is stated rather than mitigated
- **WHEN** a mail has been accepted by the provider
- **THEN** no policy change, block, take-down, account deletion or erasure request SHALL remove it
  from the operator's mailbox or the provider's logs
- **AND** the projection SHALL be recognised as the whole security model for that residue
- **AND** no withdrawal sweep SHALL be attempted

#### Scenario: Retention is legible without reading a migration
- **WHEN** an operator inspects the marker table
- **THEN** its table comment SHALL state that a marker dies with its subject and by nothing else
- **AND** it SHALL state that the marker records *this was mailed*, never *this was handled*, and
  that there is no `resolved_at`

### Requirement: The provider SHALL sit behind one module, and no key or destination address SHALL exist in this repository

The mail provider SHALL be reached through a single module exposing one named interface, so the
choice of provider is a one-file diff. The API key and the destination address SHALL live only in the
Edge Function's secret store.

#### Scenario: No key in the repository
- **WHEN** `src/`, `scripts/`, `ios/`, `.env.local.example`, `vercel.json` and `next.config.ts` are
  scanned on comment-stripped source
- **THEN** no provider API key of any supported format SHALL be present
- **AND** the detector SHALL be verified in both directions — zero now, and still matching a real key
  of that format

#### Scenario: No destination address in the repository, and no default
- **WHEN** the function directory is scanned
- **THEN** it SHALL contain no email-address literal
- **AND** an absent recipient secret SHALL be a refusal to send rather than a fallback to any address

#### Scenario: The published support address SHALL NOT become the digest's destination
- **WHEN** the mail path resolves its recipient
- **THEN** it SHALL read a secret, and SHALL NOT read, import or default to `SUPPORT_EMAIL`
- **AND** a test SHALL assert that the function directory references neither `SUPPORT_EMAIL` nor any
  address literal, so hard-coding the published address fails CI
- **AND** the claim SHALL be stated as *conflatable only by a change CI catches*, never as
  structurally impossible — a Deno file can resolve a relative path into `src/`, and the controls are
  the deploy-artifact boundary plus that test
- **AND** the residual control SHALL be recorded where the secret is documented: the destination is
  whatever value `DIGEST_RECIPIENT` holds
- **AND** the reason SHALL be recorded: the published address goes in the App Store listing and the
  digest's destination is a private mailbox

#### Scenario: The function's database reach is a list of function names
- **WHEN** the function's source is scanned on comment-stripped source
- **THEN** it SHALL contain zero `.from(` calls
- **AND** its entire database reach SHALL be the two RPCs, so the service-role key it holds is not a
  general bypass of RLS

#### Scenario: A provider swap does not touch the sweep
- **WHEN** the provider is changed
- **THEN** only the provider module SHALL change
- **AND** the retry classification, the renderer and the projection SHALL be unaffected

### Requirement: The schedule SHALL be gated per project so a non-production database cannot mail

A schedule written in a migration replicates through the chain and fires on every project it reaches.
The job SHALL therefore be gated on per-project Vault secrets, which do not replicate, and the
migration SHALL apply cleanly with neither `pg_cron` nor `pg_net` installed.

#### Scenario: An unconfigured project does nothing
- **WHEN** the tick runs on a project whose Vault secrets are absent
- **THEN** it SHALL return without calling anything
- **AND** it SHALL raise no error

#### Scenario: A copied secret set is caught
- **WHEN** the endpoint secret does not name the project-ref secret
- **THEN** the tick SHALL refuse to post and SHALL raise a warning naming the mismatch
- **AND** the limitation SHALL be stated: Postgres on Supabase exposes no self-identifying project
  reference, so two independently-created secrets agreeing is what stands in for one

#### Scenario: The migration applies on plain Postgres
- **WHEN** the RLS suite replays the chain on a database with no `pg_cron`, no `pg_net` and no
  `supabase_vault`
- **THEN** the migration SHALL apply without error
- **AND** every reference to those extensions SHALL sit inside dynamic SQL behind a catalogue check

#### Scenario: The digest can be sent by hand before any extension exists
- **WHEN** the owner invokes the deployed function directly with the service-role key
- **THEN** a real digest SHALL be assembled and sent
- **AND** this SHALL be the documented way to prove the rail end to end before the schedule starts

