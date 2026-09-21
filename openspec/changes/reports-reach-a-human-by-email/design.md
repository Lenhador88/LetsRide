# Design

## Context

See `proposal.md` §Why for the motivation and the measured table. What shapes the approach is that
**one working precedent landed an hour before this was written and four of the five sources cannot
be read by the credential the sender holds.**

Measured on DEV (`fpmrimzxadewsaiwpsel`), 2026-09-19, because each is a claim this change depends on:

| Reading | Value |
|---|---|
| Last applied migration | `123_report_a_postcard_comment` (06:17Z) — `122` at 06:08Z, `121_push_delivery` at 02:03Z |
| Report tables | **5**: `postcard_reports` (`011`/`076`), `club_thread_reports` (`094`), `ride_thread_reports` (`122`), `postcard_comment_reports` (`123`) — plus `feedback` (`084`), which is not a report but is on the same rail |
| Queue views in `private` | 4, one per report table. `feedback` has none |
| `public` tables · `service_role` SELECT revoked | 36 · 6 — `club_thread_reports`, `postcard_comment_reports`, `postcard_reports`, `push_deliveries`, `push_devices`, `ride_thread_reports` |
| `feedback` columns | `id, user_id, body, app_version, route, created_at, posthog_session_id` — the last added by `096` §3 and **not in `084`**, which is why the projection was derived from the live catalogue rather than from the migration file |
| Report table columns (all four, identical) | `id, reporter_id, <subject>_id, reason, note, created_at` |

**The reason `084`'s header is not enough on its own:** it says the reading story is PD-322's and
names nothing about `posthog_session_id`, because that column did not exist when it was written. A
projection derived from `084` would have shipped a replay pointer to a mail provider without anyone
noticing. `information_schema.columns` is the source of truth for what a projection may name.

## D1 — A sweep, and therefore no `pg_net` in the delivery path

PD-457 decides it: *"A sweep rather than a per-row trigger. A sweep needs no `pg_net`."*

`121` had no choice. A push must reach a device the database cannot address, so the database has to
initiate: trigger → outbox → `pg_cron` → `pg_net` → function → APNs. Delivery is impossible without
outbound HTTP *from Postgres*.

Here the function **pulls**. The database initiates nothing and holds no outbound capability in the
delivery path at all. The consequences are worth separating, because they pull in different
directions:

- **Constraint 1 becomes structural.** *A delivery failure must never fail the rider's insert* is
  usually implemented as a best-effort call that swallows its errors. Here there is no call. Nothing
  executes on the rider's write path — no trigger, no `pg_net`, no notify — so there is nothing that
  could fail it. This is the strongest form of the guarantee available and it is the reason the
  trigger half of `121` is not copied.
- **The invocation becomes somebody's job.** A trigger cannot be forgotten; a schedule can. Three
  candidates are weighed in `proposal.md` §The schedule. `pg_cron` + `pg_net` wins on
  *reviewability* — `121` §10's argument, unchanged: a job outside the migration chain is invisible
  to `db:drift`, to the RLS suite and to `reviewer`, so no later session can discover it exists.
- **But the feature is usable before the extensions are.** A hand invocation sends a real digest with
  no `pg_cron`, no `pg_net` and no Vault secret. `121` could not offer that, and it is what keeps the
  owner's step list short at submission time.
- **`124` therefore applies cleanly with neither extension installed** — required twice over, since
  neither is installed on DEV or PROD and the RLS suite runs the chain on plain Postgres 17 where
  `supabase_vault` does not exist either. Every `vault.`, `net.` and `cron.` reference sits inside
  dynamic SQL behind a catalogue check (`121` §10's mechanism, copied).

## D2 — RPCs, not `.from()`, and the grants make it enforced

Four of the five report tables have `service_role`'s grants revoked. The function holds the
service-role key. So `supabase.from('postcard_reports').select()` from the function returns `42501`
**by design** — `076` §3b revoked it precisely so that the one credential that bypasses RLS cannot
enumerate who accused whom.

Two readings of that are possible and one is wrong. The wrong one is *the revoke is in the way, grant
it back for the digest*: it would hand a general-purpose read of every report to a key whose blast
radius is the entire schema, in order to send an email. The right one is `121` D11 rule 5:
**the function's entire database reach is a list of function names.** Two, here. A future change that
wants a table wants an RPC instead.

That also makes the projection *enforced at the boundary rather than trusted in TypeScript*: the
function cannot widen what it was given, because there is no argument to widen and no table to read.

## D3 — The marker, and why it is a table rather than a watermark

Three shapes were considered.

**A watermark (one `last_sent_at` per source) — rejected, and it is the tempting one.** It is two
columns and no cascade. It also loses rows: `created_at` is `now()`, which is the *transaction start*
clock, so a report inserted inside a long transaction commits **after** a later report with an
earlier stamp. A sweep taking `max(created_at)` as its next floor skips it for ever, silently, and
nothing anywhere can detect that a report was never mailed. A lost report is the failure this whole
change exists to prevent.

**A column per source table (`digest_sent_at`) — rejected.** It needs UPDATE on four tables whose
entire contract is that they have no UPDATE policy and no UPDATE grant to anybody (`011` §4, `094`
§3, both asserted in both directions). Adding one for a mailer's bookkeeping would make *a report is
not editable* false in order to record that a mail went out.

**A marker table keyed on (source, source row) — chosen.** One row per source row ever claimed, one
nullable FK per source with `on delete cascade` and a CHECK that exactly one is non-null. It gives
idempotence (a unique index per source id), crash recovery (`claimed_at`), deletion safety (the
cascade, N39/N40) and zero writes to any source table. The cost is one table and one `union all`.

**No copy on it** (`121` §1, and `database-enforced-integrity`): no subject text, no rendered mail,
no `last_error`. A provider's error body can echo the payload it rejected, so a column for it is a
payload column with a different name.

## D4 — At-least-once, and the exact ordering

| Step | Transaction | If it dies here |
|---|---|---|
| 1. `claim_moderation_digest(50)` — reclaim stale, insert markers, **increment `attempts` on every row it hands out**, return projection | commits before the send | nothing was sent, nothing is marked; the entries are `claimed`, their attempt is already counted, and the reclaim window frees them |
| 2. render the mail in memory | — | as above |
| 3. `sendDigestMail()` — the provider accepts | outside the database | **the bounded annoyance case**: the mail is delivered and unmarked, so a later digest repeats those lines — at most until the attempt cap, because step 1 already counted the try |
| 4. `complete_moderation_digest(ids, 'sent')` | its own transaction | as above |

**At-least-once, chosen explicitly.** Mark-then-send is at-most-once and it loses a report every time
the provider is unreachable at the wrong instant, silently, with a marker asserting the opposite.
A **bounded** number of duplicate lines costs its reader seconds; a report no mail ever named costs a
moderation failure and, in the Guideline 1.2 case, an honest answer to a reviewer.

**`attempts` increments AT CLAIM TIME, not on the completion path, and this is load-bearing rather
than tidy.** `121:840` does it in the claim — `attempts + case when cl.next_state='claimed' then 1
else 0 end` — for exactly this failure: if the sender dies *after* the provider accepted and *before*
`complete_moderation_digest`, no completion call ever runs, so a counter that only the completion
path advances never moves, the reclaim window frees the same entries, and **the same batch re-mails
every hour for ever with the cap never engaging**. Counting at hand-out is what makes "a duplicate is
an annoyance" true; counting at completion makes it an unbounded loop that no test would notice
because every individual run looks correct. **An earlier revision of this design put the increment on
the completion path.**

**The reclaim window is 15 minutes** — longer than one invocation's wall clock (a digest is one HTTP
call, seconds) and shorter than the hourly interval, so a crashed run is recovered by the next tick
and never by two ticks racing. It is the only number of `121`'s three that transfers: there is no age
cut (a report's value does not decay) and the interval is hourly rather than per-minute.

**The attempt cap is 5, and a capped entry stays unsent.** It is not `sent`, which would lose it, and
not deleted, which would re-mail it for ever from the next claim. It sits there, and the source rows
sit in the dashboard queues — which is exactly today's state, and is why the worst case of this
feature is *no worse than not having built it*.

**Two concurrent invocations cannot mail the same rows, and the mechanism is NOT the advisory lock.**
`pg_try_advisory_xact_lock` is transaction-scoped and the claim transaction commits before the
provider is ever called (step 1), so the lock is long released by the time a mail goes out. What
actually holds the property is three things together: `claimed_at` plus the reclaim window (a row
handed out is invisible to the next claim for fifteen minutes) and the **per-source unique index** on
the marker (a source row is entered at most once, whatever races). The lock earns its place for one
narrower job — stopping two simultaneous claim transactions from both doing the marker insert and
colliding — which `on conflict do nothing` largely covers anyway. **The attribution matters because
the property would break silently** if a later session read the lock as the guard and shortened the
reclaim window. If the lock is kept, its key SHALL be a **stable named constant** (one
`hashtext('moderation_digest')`-style value in the function body): a per-invocation key is a no-op
that still reads as protection.

## D5 — The projection, per source, per column

The containment. There is no viewer to test a predicate against — the reader is the owner, who can
read every row in the database — so **what may leave is a list of columns and nothing else.**

**The authority is `claim_moderation_digest`'s `returns table (...)` clause and task 2.6's text pin
on it.** This table, `proposal.md` §Negative cases N13–N29 and the two spec deltas are four
*readings* of that one signature — written out because a reviewer cannot review a clause that does
not exist yet, and deliberately **not** deduplicated, because each audience needs it in its own
form. If any of the four disagrees with the shipped function, the function and its pin are right and
the prose is stale: move the projection deliberately and re-read all four rather than re-pinning the
string.

**Common to every source:** `entry_id`, `source` (the kind), `source_id`, `created_at`.

| Source | Also leaves | Deliberately does NOT leave |
|---|---|---|
| `postcard_reports` | `reason`, `note`, `reports_on_subject`, `reports_on_author` | `reporter_id`, the author's id and username, `caption`, **`image_path` and any signed URL**, the postcard's club |
| `club_thread_reports` | `reason`, `note`, `reports_on_subject`, `reports_on_author` | `reporter_id`, the author's id and username, `thread_title`, `club_id`, `club_name`, `club_is_public`, `message_count`, every message body |
| `ride_thread_reports` (`122`) | `reason`, `note`, `reports_on_subject`, `reports_on_author` | `reporter_id`, the author's id and username, the thread's title and messages, the ride's title, meeting point and organiser |
| `postcard_comment_reports` (`123`) | `reason`, `note`, `reports_on_subject`, `reports_on_author` | `reporter_id`, the commenter's id and username, **the comment's text**, the postcard's caption and `image_path` |
| `feedback` (`084` + `096`) | **`body`**, `app_version`, `route`, `has_session_replay` (boolean) | `user_id`, the author's username and email, **`posthog_session_id` itself** |

Four of those choices are worth their own line, because each is a thing a reasonable implementer adds
without thinking:

- **`reporter_id` is out, even as a uuid.** A uuid is pseudonymous, not anonymous — it joins to
  everything. `076` §3b revoked `service_role` from these tables for exactly this, and a mailbox at a
  third-party provider is a weaker container than a Postgres table with no grants.
- **`image_path` is out, and a signed URL doubly so.** `076`'s measured finding: a signed URL is
  served by validating its signature, not by re-running the policy, so it works for its full hour for
  anyone holding it — including a signed-out stranger a mail was forwarded to. A mail is the most
  forwardable object in computing.
- **`note` is in, and it is the reporter's free text.** Severity lives there — *"this is a photo of a
  child"* is the difference between an hour and a week — and it is the one field that makes the
  digest a triage signal rather than a row count. It names no rider by construction (a note that
  does name one is rider-authored content, the same class as `feedback.body`).
- **`posthog_session_id` is out, replaced by a boolean.** `096` §3's whole argument is that a bug
  report is actionable beside ninety seconds of footage. *"There is footage"* keeps that; the id
  itself is a pointer into a recording of a rider's screens, and it stays in the database where only
  the owner can reach it.

**What the mail looks like** (Q4's default, `text/plain`): a subject line assembled from counts alone
(`LetsRide: 3 reports, 1 feedback`), then one block per entry in the order above. Nothing
rider-authored reaches a header (N49).

## D6 — The residue: a sent mail is outside every cascade

`121` §0b wrote this for push and it is harder here. Once the provider accepts, the text is in the
owner's mailbox and in the provider's logs, and **no policy change, block, take-down, account
deletion or erasure request removes it.** A rider who deletes their account is promised erasure by
`/legal/account-deletion`; `029`'s cascade delivers it inside the database, and a digest sent
yesterday is outside it.

Three responses, and only the first two are this change's:

1. **Minimise.** D5 is the whole answer to the part that can be engineered: the smaller the
   projection, the less there is to be permanent. This is why `note` and `body` are the only
   rider-authored fields in the mail and why every identity is excluded.
2. **Say so.** `/legal/privacy` names a mail processor and `/legal/account-deletion` acknowledges
   that a copy already delivered to the operator is not retrievable (Q1 — proposed here, written
   outside this session's territory).
3. **Mailbox hygiene**, which is an owner practice and not a mechanism. Recorded as an expectation
   (N43), never claimed as enforcement — `036`'s warning holds: a number nothing implements becomes
   a fact nobody rechecks.

**No withdrawal sweep is possible and none should be attempted** — `121` §0b refused the equivalent
for push, and mail has no recall primitive at all.

## D7 — The provider boundary

One module, one interface, no leakage:

```ts
// mail.ts — the only file in this function that knows a provider exists.
export interface DigestMail { subject: string; text: string }
export type MailOutcome = { ok: true } | { ok: false; retryable: boolean; status: number }
export function sendDigestMail(mail: DigestMail): Promise<MailOutcome>
```

`index.ts` never sees a URL, a key or a status code; `shape.ts` owns the 4xx/5xx → `retryable`
classification and the renderer, both unit-tested with no network. The recipient is read from a
secret **inside** `mail.ts` and never passed in, so no call site can name an address (N3, N46).

Candidates and axes are in `proposal.md` §The provider. **Recommendation: Resend; Brevo if EU
residency must hold from the first mail.** Two properties decided it over the alternatives: a plain
`fetch` with a `Bearer` key (SES's SigV4 chain by hand in Deno is the disqualifier, not the pricing),
and the ability to send to the account owner's own address before any DNS exists — which is all this
change ever needs, because there is exactly one recipient and it is the account owner.

**Assumed rather than read**, and flagged: the provider is not named in PD-457, `CLAUDE.md` parks the
decision, and nobody is at the keyboard. Vendor limits and residency options are from general
knowledge and are not measured.

## D8 — Why the schedule is gated on Vault even though the blast radius is smaller than `121`'s

`docs/ENVIRONMENTS.md` §Scheduled jobs: a `pg_cron` job written in a migration replicates to DEV and
fires there. For push that meant real riders' phones ringing from DEV. For a digest it means the
owner's inbox receiving DEV's seeded test rows hourly — which is not a rider-facing incident, and is
still the failure that makes an alerting channel worthless. So the gate is copied rather than
re-argued: three per-project Vault secrets, absent on any project the owner has not configured, and
the two independently-created ones must agree (`121` §10's measured limitation — Postgres on Supabase
exposes no self-identifying project ref; `cluster_name` is `main` on both projects).

The second, independent guard is that DEV's function needs its **own** provider key and recipient
secret. Two things must be wrong before DEV mails anything.
