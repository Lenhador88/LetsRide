# Reports and rider feedback reach a human by email

## Why

**Product owner, 2026-09-18, asked how reports should reach them:** *"Maybe can we have for now the
reports sending an email to myself?"* PD-457 says yes, and folds rider feedback onto the same rail
because it is the same shape and there is no mail sender in this repository at all.

App Store Review Guideline **1.2** asks a user-generated-content app for *timely responses to
concerns*. Three of its four bullets are built. The fourth is a person, and that person currently
finds out a rider reported something by deciding, unprompted, to open the Supabase dashboard.

**This settles a decision `CLAUDE.md` has parked.** Email delivery beyond Supabase's built-in auth
mails is listed there as *deliberately undecided — raise rather than invent*. Saying yes decides it,
so the PR records the decision and the provider where the next session will find it.

**It supersedes PD-322**, which decided this question in August — Slack, hourly sweep, one-way — and
was never built. `084` §0's header is explicit that where anyone reads `feedback` is out of scope and
belongs to PD-322; that pointer is now stale and this change is what makes it stale. Email replaced
Slack; there are not two live decisions.

**Measured this session (2026-09-19), because every one of these is a claim this change moves:**

| Reading | Value | How |
|---|---|---|
| Mail senders in the repository | **0** | `grep -rniE "resend\|postmark\|mailgun\|sendgrid\|brevo\|nodemailer\|smtp" src/ scripts/ supabase/` |
| Edge Functions on disk | **4** — `delete-account`, `push-notify`, `resolve-ride-location`, `search-places` | `ls supabase/functions/` |
| Slack webhooks (PD-322's answer) | **0** | `grep -rn "hooks.slack.com" .` |
| Migrations applied on DEV | tops out at **`123_report_a_postcard_comment`** | `list_migrations fpmrimzxadewsaiwpsel` |
| Report queue views in `private` | **4** — `postcard_report_queue`, `club_thread_report_queue`, `ride_thread_report_queue`, `postcard_comment_report_queue` | `information_schema.views where table_schema='private'` |
| Readers of `public.feedback` | **0 of any kind** — no view, no policy, no SELECT grant to any client role | `084` §0, `096` §3 |
| `public` tables · `service_role` SELECT revoked | **36 · 6** (`club_thread_reports`, `postcard_comment_reports`, `postcard_reports`, `push_deliveries`, `push_devices`, `ride_thread_reports`) | `CLAUDE.md` §Supabase Rules' query |

**Two of those readings are newer than PD-457's body and change its scope.** `122` and `123`
(PD-454, slot-2) landed `ride_thread_reports` and `postcard_comment_reports` with their own queues
at 06:08Z and 06:17Z today. PD-457 names three sources; there are now **five** tables a human must
read. A digest that silently covers three of five re-opens `076`'s gap — *reports have a reader* —
for the two newest report surfaces in the app, on the same milestone. **§Sources decides it: five.**

**And the `service_role` reading is load-bearing rather than trivia.** Four of the five report
tables have `service_role`'s grants revoked (`076` §3b's criterion, applied again by `094` and by
`122`/`123`). The function that assembles the digest holds the service-role key and therefore
**cannot read four of its five sources with `.from()` at all.** That is not an obstacle to work
around; it is what forces the whole design through named RPCs, exactly as `121` forced `push-notify`
(D2).

## What Changes

- **One migration, `124`** — the sent-marker, two RPCs, the Vault-gated tick, the comments and the
  verification block. **The number must be re-derived from `list_migrations` immediately before the
  file is written** (`tasks.md` §0.1); `121`'s own header is this repo's worked example of a
  proposal's number going stale between proposal and build.
- **`public.moderation_digest_entries`** — the marker. One row per source row that has been claimed
  for a digest, carrying the source kind, one FK per source, `claimed_at`, `sent_at` and `attempts`.
  **Not one character of copy** (`121` §1's rule, and `database-enforced-integrity`'s): no subject
  text, no rendered mail body, no `last_error`.
- **`public.claim_moderation_digest(batch_size int)`** — `security definer`, granted to
  `service_role` **by name** and to nobody else. Returns stale claims to unsent, inserts markers for
  unmarked source rows, **counts an attempt on every row it hands out** (D4), and returns **the exact
  projection that may leave the database** — enumerated per column in `design.md` §The projection.
- **`public.complete_moderation_digest(uuid[], text)`** — records `sent`, `retry` or `skipped` for
  the claimed entries. Same grant shape.
- **`private.moderation_digest_tick()`** — the scheduled entry point, `121` §10's Vault gate reused
  line for line, granted to **nobody at all**, `service_role` included. Applies cleanly with neither
  `pg_cron` nor `pg_net` installed.
- **One Edge Function, `supabase/functions/send-moderation-digest/`** — `index.ts` (Deno, the I/O),
  `shape.ts` (every decision, importable by Vitest so `tsc` sees it — `121`'s split, which exists
  because nothing else type-checks this directory) and `mail.ts` (the provider doorway, §The
  provider).
- **Two tripwires in `src/__tests__/`** — a detector per provider-key format added to
  `no-service-role-key.test.ts`, and a new assertion that the function directory contains no
  email-address literal and no reference to `SUPPORT_EMAIL`.
- **RLS suite assertions** for every negative case below that is a statement about a role and a
  resource, appended to `supabase/tests/rls_test.sql` (`openspec/config.yaml`'s tasks rule).
- **Docs**: the provider decision into `CLAUDE.md`'s parked list (main thread's file — the PR body
  carries the wording, per `CLAUDE.md` §The Agent Squad), the table into `docs/reference/schema.md`,
  the applied-state row into `docs/reference/migrations.md`, the secrets into
  `docs/ENVIRONMENTS.md`, and how a failed digest is read into `docs/reference/observability.md`.

## Sources — five, decided

PD-457's body names three (`postcard_reports`, `club_thread_reports`, `feedback`). Two more report
tables exist as of this morning: `ride_thread_reports` (`122`) and `postcard_comment_reports` (`123`),
PD-454's, applied to DEV at 06:08Z and 06:17Z.

**Decided: the sweep covers all five, and a sixth source is a one-line addition.** The claim function
is a `union all` over per-source `select`s, each projection-checked on its own; a new report table
joins by adding a branch and a CHECK value. **A digest that covers some report tables is worse than
one that covers none**, because it trains its reader that the absence of a mail means the absence of
a report — and the two newest tables are the two reportable surfaces a store reviewer reaches first.

**The ordering is a fact, not a blocker.** `122`/`123`'s *files* are on PD-454's branch; its PR (#469)
is open and merges before this one, so they are on `development` before `124` is written. Nothing in
PD-457 needs PD-454 to *deliver* anything — the five-source sweep only needs those files present,
because the RLS suite replays the chain from `001` and a `union all` naming a table no file creates
cannot apply. `tasks.md` §1.2 is the checkpoint.

**Two clever alternatives were considered and rejected, recorded here because both get re-proposed:**

- **A `to_regclass` guard per source table, so the file applies with or without `122`/`123`.** This
  is the wrong transfer of `121` §10's pattern. `121` guards references to *extensions* whose absence
  is a stable property of every replay, and none of those references is DDL. Guarding on a source
  table makes the marker's FK columns, the `source` CHECK's value set and the `union all` itself
  conditional — **the schema becomes a function of merge timing**, and task 2.6's projection pin then
  pins a three-source signature in CI while DEV runs the five-source one.
- **A polymorphic marker (`source` + bare `source_id`, no FKs), to decouple from the source tables.**
  It solves less than it looks: the coupling was never the marker, it was the `union all`'s
  `select … from public.ride_thread_reports`, and in a `set search_path=''` definer body that name
  resolves at **runtime** — so the file would create cleanly and fail on the first tick, which is
  worse than red CI. And dropping the per-source FK costs **retention**, not disclosure: an inner
  join already drops a deleted subject, so N39's disclosure property survives without the FK, but
  orphan markers would accumulate for ever and N42's *"retention is the cascade window and nothing
  else"* would become false.

## What Does NOT Change

- **The dashboard queues stay the reader of record.** The digest is a *pointer*, strictly additive
  to `076`/`094`/`122`/`123`. No queue view is modified, no take-down function is touched, and no
  column is added to any report table. If the mail never arrives, the position is exactly today's.
- **No admin role, no moderator claim, no in-app moderation surface.** `011`, `076`, `094`, `122` and
  `123` each declined to invent one; so does this.
- **Nobody in the app gains a read.** Not the reported rider, not the reporter, not a club owner or
  admin, not the ride's organiser, not the postcard's author, not the feedback's author.
  `public.feedback` stays write-only: `084`'s absent SELECT grant and absent SELECT policy do not
  move, because they must move together and neither is needed here.
- **Nothing to `anon`** (decision #1). No table grant, no policy, no `anon`-executable function, no
  widening of `public.ride_invite_link_public_preview`. A signed-out visitor reaches the app shell
  and `/legal/*` and no part of this change.
- **`SUPPORT_EMAIL` is not read, imported, defaulted to or mentioned by the mail path.** It is the
  one *published* address (PD-300); the digest's destination is a private mailbox. §N46–N47 name the
  two controls that keep them apart and the one gap neither closes — the value of the secret itself.
- **No rider-facing change of any kind** — no screen, no copy, no component, no `src/lib/data/` read,
  no `src/lib/actions/` write, no cache key, no notification. A rider cannot tell this shipped.
- **No `pg_net` dependency for correctness.** §The schedule.
- **No age cut and no suppression by age**, which is where this parts company with `121`. A push's
  entire value is timeliness, so `121` §7 suppresses a row older than six hours. A report's value
  does not decay: a three-day-old report of a photo that is still up is *more* urgent, not less.
- **No moderation workflow.** The marker says *this was mailed*, never *this was handled*. There is
  no `resolved_at` anywhere in this change, for `076`'s reason: that is a moderation product's
  column, and adding one makes the queue a workflow with two writers.

## What transfers from `121`, and what does not

`121_push_delivery.sql` and `supabase/functions/push-notify/` merged one hour before this proposal
was written (PD-303) and are the closest existing shape. Read both before building.

**Transfers, deliberately and near-verbatim:**

| From `121` | Why it transfers |
|---|---|
| RLS on, **zero policies**, revoke from `anon`, `authenticated` **and `service_role`** (§2) | The intended access is none, and the SELECT half is `076` §3's criterion. **Unlike `121` §2, the write half is not claimed as a security property** — the completion RPC hands it back by name (N8) |
| Every database reach through named RPCs granted to `service_role` only; **zero `.from()`** in the function (§6–§9, D11 rule 5) | Four of five sources have `service_role` revoked, so this is enforced rather than conventional |
| **No `last_error` column** (§1) | A provider error body can echo the payload; the column is a copy column with a different name |
| The atomic claim, the `claimed_at` reclaim window, the bounded `attempts` (§7, §8) | Identical crash-recovery problem |
| The **Vault-gated schedule** (§10), apply-clean with neither extension | Identical DEV-fires-too hazard from `docs/ENVIRONMENTS.md` §Scheduled jobs |
| `index.ts` / `shape.ts` split | Nothing type-checks `supabase/functions/`; the split is what lets Vitest and `tsc` see the decisions |
| A key-format detector in `src/__tests__/no-service-role-key.test.ts`, verified both ways | One more secret format, same trap |
| The residue argument (§0b) | Restated in a harder form: the recipient is a person, not a device (N41) |

**Does not transfer:**

| Not from `121` | Because |
|---|---|
| **The AFTER INSERT trigger** (§3) | PD-457: *a sweep rather than a per-row trigger*. Nothing at all hangs off a rider's write path, which is what makes constraint 1 structural rather than a `try`/`catch` (N30) |
| **`pg_net` as a requirement** | The function *pulls*. §The schedule |
| **`push_payload_for`'s visibility re-check** (§6) | There is no viewer to re-check. The digest's reader is the owner, who can read everything; **the containment is the projection, not a predicate** (N29) |
| The per-device fan-out, `invalidate_push_device`, the token touch | One destination, no credential per recipient |
| The six-hour age cut | §What Does NOT Change |
| The one-minute interval | Hourly. A report needs a same-working-day answer, not a same-minute one (Q2) |

## The schedule, and who owns it

**The function pulls from the database rather than the database pushing to the function, and the
consequence is that nothing in the database is load-bearing for delivery.** `pg_net` is needed only
to *invoke* the function on a clock, and the invocation can come from anything:

1. **`pg_cron` + `pg_net`** calling `private.moderation_digest_tick()` — `121`'s shape, and it is
   free once PD-303's owner step installs both extensions. **Recommended**, because it is in the
   migration chain where `db:drift`, the RLS suite and `reviewer` can all see it.
2. **A hand invocation** — the dashboard's *Invoke*, or a `curl` with the service-role key. **This
   works the day the function deploys, with no extension, no `pg_cron` and no Vault secret**, which
   `121` could not offer: a push cannot be sent by a human deciding to send it.
3. An external scheduler (GitHub Actions). **Rejected**, for `121` §10's reason: a job no session can
   find out exists.

**Consequences to state plainly.** Scheduling is an **owner** step, like the deploy and the secrets
(`deploy_edge_function` is on the deny list and there is no `supabase` CLI in this container). Until
it is taken, the digest sends nothing and the rows sit in the dashboard queues — today's state, and
it degrades to today's state rather than to a broken one. A session checks it rather than assuming:
`select jobname, schedule from cron.job` and `list_edge_functions fpmrimzxadewsaiwpsel`. The Vault
gate is what stops the chain replicating a schedule that mails from DEV.

## The provider

> **Recommendation: Resend, with a `MailSender` interface that makes the choice a ~30-line diff.**
> It is a single `POST https://api.resend.com/emails` with a `Bearer` key — no SDK, no npm
> dependency from Deno, no request signing — and its `onboarding@resend.dev` sender can mail the
> account owner's own address before any DNS exists, which is exactly and only what this change
> needs. **Brevo is the pick if EU data residency must hold from the first mail**; it is the same
> one-`fetch` shape against `api.brevo.com` from a French processor.

**Assumed, not read, and flagged as such** (`CLAUDE.md` §Working Principles): the owner is not at the
keyboard, `CLAUDE.md` lists this as *deliberately undecided — raise rather than invent*, and PD-457
asks the PR to record the choice. So the build proceeds on the recommendation and the decision stays
cheap to reverse. **Every vendor fact in the table below is from general knowledge and is not
measured** — free-tier limits and residency options move, and the owner will read the current terms
at signup. Nothing in the build depends on which row wins.

| | Resend | Brevo | Postmark | SES (`eu-west-1`) |
|---|---|---|---|---|
| Plain `fetch`, no dependency | yes | yes | yes | **no — SigV4 HMAC chain by hand** |
| Free tier at ~1–20 mails/day | ample | ample (300/day) | tight (trial) | effectively free |
| Sends before DNS is set up | **yes** — `onboarding@resend.dev` to the account owner | single-sender verification by email | single-sender verification | verified recipient in sandbox |
| EU data residency | region selection, plan-dependent | **native (FR)** | no | **same region as the project** |
| Custom domain required first | no | no | no | no (sandbox) |

**The boundary is one module and one interface.** `mail.ts` exports
`sendDigestMail(mail: DigestMail): Promise<MailOutcome>` where `MailOutcome` is
`{ ok: true } | { ok: false; retryable: boolean; status: number }`, and **nothing else in the
function knows a provider exists**. Swapping providers touches one file; the classification of
4xx/5xx into `retryable` lives there and is unit-tested through `shape.ts` with no network.

## Negative cases

The heart of the proposal. Whatever assembles the digest runs as a privileged role and can read rows
RLS would refuse — that is the point, and it is `094`'s recorded risk. **The digest must carry what
decides whether to open the queue now, and must not become a general-purpose export of the
database.**

**Who may cause a send (N1–N6):**

1. **N1** — A signed-in rider SHALL NOT invoke the function. It refuses every caller whose *verified*
   JWT does not carry `role: service_role`, which is sharper than `verify_jwt: true`: that setting is
   satisfied by any rider's own access token and by the publishable key (`push-notify`'s
   `assertServiceRoleCaller`, D11 rule 3).
2. **N2** — `anon` SHALL NOT invoke it, by any route. This function is **not** a second named
   exception to decision #1 and asks for no grant to `anon` anywhere.
3. **N3** — The function SHALL take **no arguments from anybody**: no body, no query string, no
   source name, no row id, no batch id and — the one that matters — **no recipient**. There is no
   argument a confused deputy could point at a rider or at an address.
4. **N4** — A rider's insert SHALL NOT cause a send. There is no trigger, no `pg_net` call and no
   function invocation on any rider write path, so the mail cannot be reached from the app at all.
   A flood of forged reports produces **one mail per tick** regardless of row count, capped at
   `batch_size` entries.
5. **N5** — `public`, `anon` and `authenticated` SHALL hold no EXECUTE on `claim_moderation_digest`
   or `complete_moderation_digest`; `service_role` holds both **by name**. A client that could claim
   could suppress; a client that could complete could mark an unsent report sent.
6. **N6** — `private.moderation_digest_tick()` SHALL be executable by **nobody**, `service_role`
   included. Its only caller is `pg_cron`, which runs as the superuser (`121` §10).

**Who may read the bookkeeping (N7–N12):**

7. **N7** — No rider SHALL read `moderation_digest_entries`: RLS on, **zero policies**, explicit
   revoke from `anon` and `authenticated` (which is not a no-op — this project's default privileges
   grant a new table to both).
8. **N8** — **`service_role` SHALL be revoked on it too, and the claim this revoke can carry is
   narrower than it looks.** The SELECT half is real: the table answers *which reports were mailed
   and when* over every rider at once, which is `076` §3's criterion, and this makes the seventh
   revoked table. **The write half is NOT a security property and must not be written as one.**
   `complete_moderation_digest(uuid[], text)` is granted to `service_role` (task 1.9), so a holder
   of that key can already stamp `sent_at` on an unsent entry and suppress a report from ever
   reaching a human — through the RPC, with a nicer name. **An earlier revision of this line claimed
   the revoke prevented that. It does not, and task 2.2 would have asserted the revoke and passed
   while the stated property was false.** The honest statement is stronger: *suppression by a holder
   of the service-role key is not preventable by grants at all* — the containment is that the key
   exists in exactly one place, the function's secret store, guarded by
   `src/__tests__/no-service-role-key.test.ts`. What the revoke buys is what a revoke can buy: no
   accidental `.from()` write from a function that meant to call an RPC, and an API surface for that
   credential of **exactly two named functions**. `121` has the identical shape for
   `complete_push_delivery`; the only difference was that this proposal elevated it into a
   requirement with a security claim attached to it.
9. **N9** — A reported rider SHALL NOT be able to learn that a report about them was mailed. No
   in-app surface says so and no rider-readable column changes.
10. **N10** — A reporter SHALL NOT learn that their report was mailed, read or acted on. Reporting
    stays the one-way act `011` designed.
11. **N11** — No client role SHALL gain reach to any `private` object. Three independent barriers
    stand unchanged: no USAGE on `private` for `anon`/`authenticated` (`005`), an explicit revoke
    for `service_role` (`031` granted it USAGE), and PostgREST routing only `public`.
12. **N12** — The marker table SHALL carry **no text at all** — no note, body, caption, title,
    username, rendered mail or provider error string. It carries ids, a source kind and timestamps.

**What leaves the database — the projection (N13–N29):**

> **The authority is the SQL, not this prose.** `claim_moderation_digest`'s `returns table (...)`
> clause is the projection, and task 2.6's text pin in the RLS suite is what holds it. The
> enumerations here, in `design.md` §D5 and in both spec deltas are four **readings** of that one
> signature, written out because a reviewer cannot review a clause that does not exist yet. When they
> disagree with the shipped function, the function and its pin are right and these are stale — move
> the projection deliberately and re-read all four, rather than re-pinning the string.

13. **N13** — **No username, display name, avatar path or any other `profiles` column of any rider**
    SHALL appear in the mail, for any source.
14. **N14** — **No column of `auth.users`, ever** — above all no rider email address. The only
    address involved is the owner's own, and it comes from a secret.
15. **N15** — **No `reporter_id`, not even as a uuid.** Reporter safety is `076` §3b's entire reason
    for revoking `service_role`, and a mailbox is a worse place to keep an accusation's author than a
    table is. The owner resolves the reporter in the queue view at the moment they act.
16. **N16** — No reported rider's id either: the mail carries the **report id** and the **subject id**
    (postcard, thread or comment) and no identifier of a person. **It is not fully unlinkable, and
    the overstatement is worth correcting:** `reports_on_author` is keyed on the author, so two
    entries in one digest sharing a value let the reader infer that two otherwise-unlinkable subject
    ids belong to **one** rider. That is a quasi-identifier, accepted because it is what makes
    repeat-offender triage possible at all, and it is **not** a decision #2 problem — a block needs a
    *pair* of riders and the projection contains no pair (N28 stands).
17. **N17** — **No postcard caption, no `image_path`, and above all no signed URL.** A signed URL is
    a bearer token that outlives RLS for its full TTL (`076`: one hour, measured), a mailbox keeps
    it for ever, and a forwarded mail hands it to someone with no account at all.
18. **N18** — **No club name, club id, `is_public` flag, thread title, message body or message
    count.** `094` §5's risk, restated: the queue must not become a second way to read a private
    club's conversation, and a mail is a queue that has left the building.
19. **N19** — No postcard comment text and no ride thread text, for the same reason. The digest says
    *a comment on postcard X was reported as harassment*; the words are in the queue.
20. **N20** — **`feedback.body` DOES leave, and the distinction that makes it consistent with N17–N19
    is INTENDED AUDIENCE, not a judgement about free text.** `feedback.body` is authored **to the
    operator**, who is its intended and only reader — as is a report's `note`, which is why that
    leaves too. A postcard caption, a comment, a message in a thread and a club's name are authored
    to an audience the rider chose, and the operator is not in it. Forwarding the first is delivery;
    forwarding the second is disclosure. (An earlier revision
    argued this as *the one deliberate free-text export*, which reads as an exception being
    tolerated rather than a line being drawn.) **The gap the distinction exposes:** the rider was
    never told their message reaches a third-party mail processor, which is exactly what makes Q1's
    privacy copy load-bearing for this field in particular.
21. **N21** — `feedback.user_id` SHALL NOT leave, nor the author's username or email. Feedback is
    read as a message, not as a rider's file.
22. **N22** — **`posthog_session_id` SHALL NOT leave.** The mail carries a boolean
    `has_session_replay`. `096` §3's value — *"unactionable alone and completely actionable beside
    ninety seconds of footage"* — survives as *there is footage, go and look*; a pointer into a
    replay of a rider's screens does not land in a third-party mail provider's storage.
23. **N23** — `app_version` and `route` MAY leave: both are app-written, neither names a rider, and
    `084` already withholds the query string from `route` precisely so that no subject id rides
    along in it.
24. **N24** — No count over anything the mail is not about. Two counts, named
    **`reports_on_subject`** and **`reports_on_author`**, plus a per-source total for the batch; no
    table sizes, no rider totals, no schema. **They are deliberately unqualified, matching the live
    queue views' `reports_on_this_postcard` / `reports_on_this_author`.** An earlier revision called
    them `open_*`, which is a qualifier with nothing behind it: there is no `resolved_at` anywhere —
    `076` and `094` refuse one and N42 keeps it refused — so "open" could only ever mean *every
    report ever filed*, a monotonically rising number presented to its reader as a backlog. `076`
    §1's documented under-count (reports cascade with their subject) applies to both.
25. **N25** — **The mail SHALL NOT let its reader enumerate rows they were not sent.** It is rendered
    text with no query interface: no "view all" link, no token, no endpoint, no attachment, no
    pagination cursor. More rows are reachable only by authenticating to the dashboard as the owner
    — which is the reach they already had.
26. **N26** — No link into the app and no deep link carrying an id. A link in a mail is a click away
    from a session, and `src/lib/native/deep-links.ts` owns where a link from outside may send a
    rider; this change asks it for nothing.
27. **N27** — **The mail SHALL NOT be a reply channel to a rider.** `Reply-To` is the sender or
    absent, never a reporter and never a feedback author, so a one-tap reply cannot reach a rider who
    was never told their words would be forwarded.
28. **N28** — **A block SHALL NOT be observable in the digest.** The projection contains no pair of
    riders at all, so no directional or symmetric block can be read out of it. The digest
    deliberately does not consult `private.is_blocked`, and that is correct rather than an omission:
    it names no viewer, and the owner connection is not a rider (decision #2 is unchanged and
    untouched).
29. **N29** — **The digest SHALL NOT become a second way to read a row RLS would refuse.** It steps
    past every membership, hide, crew and block predicate in the system, exactly as the queue views
    do and for the same reason. The containment is **the enumerated projection plus a destination
    that is a secret** — not a predicate, because there is no viewer to test one against.

**Ordering, failure and duplication (N30–N38):**

30. **N30** — **A delivery failure SHALL NOT fail a rider's insert**, and the guarantee is
    structural: there is no code of any kind on the rider's write path. Not a `try`/`catch`, not a
    `pg_net` call marked best-effort — nothing to fail.
31. **N31** — **A delivery failure SHALL NOT lose the row.** Delivery is **at-least-once**: the
    provider accepts, *then* the marker is stamped. Mark-then-send (at-most-once) is refused —
    **a duplicate mail is an annoyance and a lost report is a moderation failure.**
32. **N32** — The sweep SHALL NOT mutate, delete or flag any source row. The marker lives in its own
    table, so the worst outcome of this entire feature is the state that exists today: rows waiting
    in a dashboard queue that nobody mailed.
33. **N33** — A function that dies mid-send SHALL leave its entries `claimed` and unsent, and the
    reclaim window SHALL return them. The visible consequence is a repeated line in one later mail,
    never a report that no mail ever named — and **the repetition SHALL be bounded**, because
    `attempts` is incremented **at claim time** on every row handed out (D4). A counter advanced only
    by the completion path never moves in exactly this case, and the same batch re-mails hourly for
    ever with the cap never engaging; `121:840` counts at hand-out for this reason.
34. **N34** — Two concurrent invocations SHALL NOT mail the same rows, and **the mechanism is not the
    advisory lock**. `pg_try_advisory_xact_lock` is transaction-scoped and the claim commits before
    the provider is called, so it is released before any mail goes out; it stops two simultaneous
    claim transactions colliding on the marker insert and nothing more. The property is held by
    `claimed_at` + the reclaim window + the per-source unique index, together. Stated this way
    because it would break silently if a later session read the lock as the guard and shortened the
    window — and if the lock is kept, its key SHALL be a stable named constant, since a
    per-invocation key is a no-op that reads as protection.
35. **N35** — A provider **5xx, 429 or timeout** SHALL be `retry`: the claim is released, and the
    attempt is **already counted** by the claim rather than by this path. A **4xx other than 429**
    (bad key, unverified sender, malformed payload)
    SHALL also be counted rather than retried for ever *or* swallowed silently — it is a
    configuration fault, the attempt cap stops the loop, and the entry stays **unsent**. No outcome
    deletes an entry and no outcome marks a failed send as sent.
36. **N36** — **Nothing SHALL be sent when there is nothing to send.** Zero claimed rows is a return
    before the provider is called: no empty digest, no "0 new reports" mail. A mailbox trained to
    ignore the digest is this feature's real failure mode.
37. **N37** — No provider error body SHALL be written to any table (`121` §1). Failures are read in
    the function's logs — `npm run logs:errors`, 24 hours.
38. **N38** — A claimed entry whose subject has vanished underneath it SHALL complete as `skipped`,
    not as a failure and not as a mail with a blank line in it. An empty projection is an answer
    (`121` §6's "a gate refusal is an EMPTY RESULT rather than an error").

**Deletion, retention and residue (N39–N44):**

39. **N39** — **An unsent `feedback` row whose author deletes their account SHALL NOT be mailed.**
    `084` §0b cascades the row with the profile and the marker cascades with the row, so the next
    claim cannot see it and an already-claimed entry resolves to N38. Deletion wins; the digest never
    resurrects content a rider asked to have erased.
40. **N40** — The same for a report whose **subject** or **reporter** is deleted, through `011`/`076`
    and `094`'s existing cascades. No new cleanup path and no orphan marker: one FK per source, each
    `on delete cascade`, with a CHECK that exactly one is non-null.
41. **N41** — **A mail already sent is outside every cascade in this system, permanently.** No policy
    change, block, take-down, account deletion or erasure request removes a line from the owner's
    mailbox or the provider's logs. `121` §0b's residue in a harder form — the recipient is a person,
    not a device. **This is why the projection above is the whole security model**, and why
    `/legal/privacy` and `/legal/account-deletion` need to be honest about a mail processor (Q1).
42. **N42** — Marker retention is the cascade window and nothing else: a marker dies with its
    subject, and no scheduled deletion, `resolved_at` or ledger exists. Stated at creation, as
    `CLAUDE.md` requires of any table touching personal data.
43. **N43** — The provider's retention and the owner's mailbox retention are **not enforceable by
    this change** and are recorded as such: a stated expectation for the owner (delete the digest
    folder periodically), never a mechanism this migration can claim.
44. **N44** — The digest SHALL NOT be treated as a ledger. It is not in the database, cannot be
    joined, counted or audited, and must never become the answer to *what was reported last month*.

**Secrets and the two addresses (N45–N49):**

45. **N45** — The provider API key SHALL NOT appear in `src/`, `scripts/`, `ios/`,
    `.env.local.example`, `vercel.json` or `next.config.ts`. A detector for its format joins
    `src/__tests__/no-service-role-key.test.ts`, **verified both ways** — zero now, and still
    catching a real key of that format.
46. **N46** — **The destination address SHALL NOT appear in the repository at all** — not in the
    function, not in a config file, not in a test fixture, and there is **no default**. A missing
    `DIGEST_RECIPIENT` secret is a refusal to send, never a fallback.
47. **N47** — **The digest SHALL NOT send to `SUPPORT_EMAIL`, and the honest claim is that the two are
    conflatable only by a change CI catches — not that they are unconflatable.** An earlier revision
    said "by construction" and overstated it: a Deno file *can* resolve `../../src/lib/support.ts`,
    so nothing structural forbids it. The two real controls are the **deploy-artifact boundary** (the
    function is deployed on its own and never bundles `src/`) and **task 4.2's test**, which asserts
    the function directory holds no `@`-address literal and no reference to `SUPPORT_EMAIL`. **The gap
    neither control closes:** the digest goes to whatever address the owner puts in
    `DIGEST_RECIPIENT`, so the separation of the private inbox from the published one ultimately
    rests on that secret's value. It therefore belongs in `docs/ENVIRONMENTS.md` beside the secret
    (task 5.3) and not only in a task-list parenthesis.
48. **N48** — The function SHALL issue **zero `.from()` calls**. Its entire database reach is two RPC
    names, which is what keeps a service-role key from being a general bypass of the layer this
    project's bugs come from (D11 rule 5). Asserted on comment-stripped source, filter verified both
    ways.
49. **N49** — **No rider-authored value SHALL reach a mail header.** Rider text appears only in the
    body; the subject line is assembled from counts alone. A note or feedback body in a header is a
    header-injection and a disclosure in one.

## Open questions

Every one carries a recommended default, so nothing here blocks the build.

- **Q1 — product owner, non-blocking (but before PROD). Does `/legal/privacy` name a mail
  processor?** A third party now receives rider-authored text (N20) and report metadata. **Default:
  yes — one sentence naming the processor and its purpose, plus a line in
  `/legal/account-deletion` acknowledging N41's residue.** **It is deferred because nothing mails at
  merge** — the provider is unchosen, the key and the recipient are owner steps and the function is
  not deployed — so copy naming a mail processor would be a false claim on the day it shipped, and
  naming Resend off an assumed decision would be the worst version of that. It belongs in the
  follow-up that lands with the first real send, and it is **load-bearing for N20** specifically: a
  rider writing feedback was never told their message reaches a third-party processor. *(An earlier
  revision gave the reason as `src/app/legal/` being outside this session's territory. That was
  wrong — the path is unclaimed by any slot — and the next session should not read it as a rule.)*
- **Q2 — build session, non-blocking. How often?** **Default: hourly, `0 * * * *`**, which is
  PD-322's surviving answer. A report needs a same-working-day response, not a same-minute one;
  hourly bounds the mail volume at 24/day worst case and there is no age cut to interact with.
- **Q3 — build session, non-blocking. One mail per digest or one per row?** **Default: one digest
  per tick, all sources, `batch_size` 50, oldest first.** One mail per report is a mailbox that
  gets muted, and muting is indistinguishable from the gap this change closes.
- **Q4 — build session, non-blocking. Plain text or HTML?** **Default: `text/plain`.** It cannot
  load a remote image, it cannot carry a tracking pixel, and it renders identically in every client.
- **Q5 — build session, non-blocking. Does `public.feedback` lose `service_role`'s grants?**
  **Default: yes, revoke in `124`.** `084` §2 kept them with the reasoning *"whoever builds the
  reading story may well want a function that does"* — this is that story, and it reaches feedback
  through the RPC instead, which makes N48's zero-`.from()` property uniform across all five sources
  rather than true of four. It is the eighth revoked table, and the cascade is unaffected (`076`
  §3b measured that a referential action does not consult privileges).
- **Q6 — product owner, non-blocking. Which provider?** **Default: Resend**, per §The provider, and
  the interface makes it a one-file change. Answer it by putting a key in the secret store; the code
  does not need to know first.
- **Q7 — ANSWERED, 2026-09-19. Does `124` cover five sources or three?** **Five.** PD-454's PR (#469)
  is open and merges first, so `122`/`123`'s files are on `development` before `124` is written, and
  the coupling that made three attractive is gone. Kept in this list as a closed question rather than
  deleted, because §Sources also records the two alternatives that were rejected.
- **Q8 — product owner, non-blocking. Should a *failed* digest be visible to anyone but the logs?**
  **Default: no.** After the attempt cap the entry stays unsent and the rows stay in the queue; the
  owner re-arms with one statement at the dashboard (`tasks.md` §6.3's runbook line). An alert about
  a failed alert needs a second delivery channel, which is a larger design than this one.

## Impact

- **Affected specs:** a **new** `moderation-digest-delivery`; **ADDED only** deltas to
  `content-moderation` and `database-enforced-integrity`. No requirement written by another change is
  modified and no heading is shared, so this change and the two active report changes can land in
  any order. Re-derive with `ls openspec/specs/` and `ls openspec/changes/`.
  **`database-enforced-integrity`'s "A derived row SHALL NOT hold a copy of a visibility decision" is
  being MODIFIED in flight by `deliver-push-notifications`** (the four conditions); this delta adds a
  *sibling* requirement about a copy that leaves the database's reach entirely and touches that
  heading's text not at all.
- **Affected code:** `supabase/migrations/124_*.sql` (new), `supabase/functions/send-moderation-digest/`
  (new), `supabase/tests/rls_test.sql` (appended), `src/__tests__/` (two tripwires). **No file under
  `src/app/`, `src/components/`, `src/lib/data/` or `src/lib/actions/` is touched** — slot-2 holds
  three of those and this change needs none of them.
- **Ordering, and it is `CLAUDE.md` §The sequencing rule applied:** `124` is purely additive and
  inert — it creates a table nothing writes and functions nobody can call yet — so it may apply
  before or after any deploy. What must not happen is a **schedule** before the **function** is
  deployed, or a function deployed before its secrets exist: the first posts to a 404 hourly, the
  second burns the attempt cap on every claimed entry and leaves them unsent until an owner re-arms
  them. Order: `124` applies → the function deploys (owner) → the secrets land (owner) → one hand
  invocation proves it end to end → the schedule starts (owner).
- **Store submission:** this is the mechanism half of Guideline 1.2's fourth bullet. The response
  itself stays a person.
