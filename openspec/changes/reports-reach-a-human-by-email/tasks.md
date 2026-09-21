# Tasks — reports-reach-a-human-by-email (PD-457)

**This change HAS a migration**, so `openspec/config.yaml`'s tasks rule binds: every task adding or
changing a policy or a grant is paired with a task adding assertions to `supabase/tests/rls_test.sql`.

> **THE MIGRATION NUMBER IS `124` AND IT MUST BE RE-DERIVED BEFORE THE FILE IS WRITTEN.** Do not
> trust this line. `list_migrations fpmrimzxadewsaiwpsel` answered `123_report_a_postcard_comment`
> at 06:17Z on 2026-09-19, so `124` is determinate *at the time of writing this proposal* and not
> when you read it. `121_push_delivery.sql`'s own header is this repo's worked example of exactly
> this going wrong: its tasks file called it `079`, the number was spent the same day, and
> `ls supabase/migrations/` would have handed `121` out twice because DEV holds rows with no file on
> this tree. **Take the next number off `list_migrations`, not off `wc -l`**, and check both
> directions of drift (`CLAUDE.md` §Working Principles).

> **No question blocks this build.** Q1 and Q6 are the product owner's and both have defaults that
> let the code land: the provider is behind one module (Q6), and the privacy copy is a separate file
> outside this session's territory (Q1). Build the defaults.

> **Territory.** Slot-2 holds `src/lib/actions/`, `src/lib/data/`, `src/components/`,
> `supabase/migrations/` and `openspec/changes/report-ride-threads-and-postcard-comments/`. This
> change writes `supabase/migrations/124_*.sql` (a new file, no edit to theirs),
> `supabase/functions/send-moderation-digest/`, `supabase/tests/rls_test.sql` (append),
> `src/__tests__/` and its own change directory. It touches no file of theirs.

## 0. Pre-flight — re-derive, do not trust this file

- [ ] 0.1 `list_migrations` on **both** refs. Take the next free number; if it is not `124`, use the
  free one and say so in the PR rather than renumbering anyone's file. Count the **file-less** rows
  rather than the gap (`CLAUDE.md` §Supabase Rules).
- [ ] 0.2 Read **PD-457** body **and** comments. Read 2026-09-19: `Development (AI)`, milestone
  *Store submission*, labels `slot-1`/App/Database/Feature; the one comment is this session's
  territory block and confirms the number. A comment appearing since overtakes the body.
- [ ] 0.3 Re-derive the source list from the catalogue, not from the issue body — it named three and
  there are five:
  ```sql
  select table_name from information_schema.tables
   where table_schema='public' and table_name like '%_reports%' order by 1;
  select table_name from information_schema.views where table_schema='private' order by 1;
  ```
- [ ] 0.4 Re-derive each source's **columns** from `information_schema.columns`, never from its
  migration file. `084` does not mention `posthog_session_id`; `096` §3 added it, and a projection
  derived from `084` would ship a replay pointer (D5, N22).
- [ ] 0.5 Record the `service_role` revoke count before the file: **30 kept · 6 revoked** on DEV,
  2026-09-19, with `CLAUDE.md` §Supabase Rules' query. This change makes it 7 (the marker table) or
  8 (if Q5's default on `feedback` is taken).
- [ ] 0.6 Record the published-definer count for the zero-new-advisor claim, with
  `get_advisors(security)` and:
  ```sql
  select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute');
  ```
  Both new `public` RPCs are revoked from `authenticated`, so the expectation is **no new advisor of
  either class** — verify rather than assert.
- [ ] 0.7 Read `121_push_delivery.sql` §1, §2, §7, §8, §10 and `supabase/functions/push-notify/`
  (`index.ts` header, `shape.ts`). Read `076` §3/§3b and `084` §0/§0b/§2. The proposal's transfer
  table is a summary, not a substitute.

## 1. The migration — `124_reports_reach_a_human.sql`

- [ ] 1.1 Header: what this file is, the four objects, the at-least-once ordering (D4), the apply
  order (§7), and **why the sweep has no trigger** (D1). Name PD-457 and the superseded PD-322.
- [ ] 1.2 **Five sources — decided (Q7), not a judgement to re-take.** Before writing the file,
  confirm `122`/`123`'s **files** are present (`ls supabase/migrations/12*.sql`); PD-454's PR #469
  merges first, and the RLS suite replays the chain from `001`, so a `union all` naming a table no
  file creates cannot apply. If they are somehow absent, **stop and say so** rather than falling back
  to a `to_regclass` guard or a polymorphic marker — §Sources records why both are worse.
- [ ] 1.3 `public.moderation_digest_entries` — `id`, `source` under a CHECK, one nullable FK per
  source (`on delete cascade`), a CHECK that exactly one is non-null **and agrees with `source`**,
  `claimed_at`, `sent_at`, `attempts` with a bounded CHECK. **No text column of any kind and no
  `last_error`** (N12, N37).
- [ ] 1.4 One unique index per source FK, so a source row is entered at most once however many times
  the sweep runs, and each FK's leading-column index exists for its cascade (`029`'s standing rule).
- [ ] 1.5 `alter table … enable row level security`, **no policy**, and
  `revoke all … from anon, authenticated` — not a no-op under this project's default privileges.
- [ ] 1.6 `revoke all … from service_role`, with the two-half argument written out (N8): the read
  half is which report was mailed and when; the **write** half is that an UPDATE grant can suppress a
  report from ever reaching a human.
- [ ] 1.7 Table and column comments carrying the retention answer, the *mailed, never handled*
  distinction, and the absence of `resolved_at` (N42).
- [ ] 1.8 `public.claim_moderation_digest(batch_size int)` — `security definer`, `set search_path=''`,
  reclaim of stale claims (15 minutes, D4), marker insert with `on conflict do nothing`, **`attempts`
  incremented on every row handed out** (`121:840`'s position — D4 explains why the completion path
  is the wrong place and makes the duplicate unbounded), then the **enumerated projection** of D5 as
  `returns table (...)`, oldest first, capped. Revoke from `public, anon, authenticated`; grant
  EXECUTE to `service_role`. If `pg_try_advisory_xact_lock` is used, it guards the marker insert
  only — **not** the send (N34) — and its key is a stable named constant.
- [ ] 1.9 `public.complete_moderation_digest(entry_ids uuid[], outcome text)` — `sent`, `retry`,
  `skipped`. **It does not increment `attempts`** (1.8 owns that) and it does not re-decide the cap;
  a capped entry stays **unsent** (N35). Same revoke/grant shape. **Note in the header what this
  grant means**: it confers on any holder of the service-role key the ability to stamp `sent_at` on
  an unsent entry, which the marker table's revoke does **not** prevent and must not be claimed to
  (N8) — the containment is the key's one storage location.
- [ ] 1.10 `private.moderation_digest_tick()` — `121` §10's Vault gate, three per-project secrets,
  the endpoint-names-the-ref check, `pg_net` catalogue check, and the `pg_cron` do-block that skips
  cleanly when the extension is absent. Granted to **nobody**, `service_role` included.
- [ ] 1.11 Q5's default: `revoke all on public.feedback from service_role`, with `084` §2's reasoning
  quoted and answered (the reading story it deferred to is this one, and it reads through the RPC).
  Note the measured fact that a cascade does not consult privileges (`076` §3b), so account deletion
  is unaffected.
- [ ] 1.12 A `§Verification` footer of `has_table_privilege` / `has_function_privilege` /
  `pg_policies` probes with their expected answers, scoped to the grantee (`CLAUDE.md`: `postgres`
  and `service_role` hold everything by default, and an unscoped count reads high against a correct
  database).
- [ ] 1.13 Apply to DEV with `apply_migration`; re-run §Verification; read `get_advisors(security)`
  and compare to 0.6. **Paired with §2** — do not call this task done before the assertions exist.

## 2. RLS suite assertions — `supabase/tests/rls_test.sql` (append only)

- [ ] 2.1 `authenticated` holds no SELECT/INSERT/UPDATE/DELETE on `moderation_digest_entries`, and
  `anon` holds none either (N7).
- [ ] 2.2 `service_role` holds none, asserted where its ground truth lives — a savepoint-staged
  `has_table_privilege` or a grantee-scoped `role_table_grants` count, per `CLAUDE.md`'s two forms
  (N8).
- [ ] 2.3 The table has **zero policies**, and the assertion fails if one appears (`121` §2's shape).
- [ ] 2.4 `has_function_privilege` for `public`, `anon`, `authenticated` on both RPCs is false, and
  **true for `service_role`** — the role assertion `CLAUDE.md` requires for a function only a
  non-client role may reach, since the suite runs as the owner for whom no barrier exists.
- [ ] 2.5 `private.moderation_digest_tick()` is executable by nobody, `service_role` included (N6).
- [ ] 2.6 **The projection is pinned as text** against the live `pg_get_function_result` /
  `information_schema.routines` definition, so widening it fails a test rather than shipping (D5).
  The pin instructs a reader to move the projection deliberately rather than re-pin the string.
- [ ] 2.7 Deletion: a feedback row deleted with its author removes its marker; a report deleted with
  its subject removes its marker; no orphan remains (N39, N40).
- [ ] 2.8 Idempotence: two claims over the same rows produce one marker each and the second claim
  returns zero rows (N34's SQL half), and **`attempts` has advanced after the first claim with no
  completion call at all** — the assertion that would have caught the unbounded-duplicate bug D4
  describes.
- [ ] 2.9 The five source tables have no new column, policy or grant (N32, content-moderation delta).
- [ ] 2.10 Q5's revoke, if taken: `has_table_privilege('service_role','public.feedback','select')` is
  false, and a `delete from public.profiles` as `service_role` still cascades the feedback row —
  measured in a rolled-back transaction, `076` §3b's method.
- [ ] 2.11 `PGPASSWORD=postgres npm test` green; compare **label sets** rather than counts against
  the pre-change run (`CLAUDE.md`).

## 3. The Edge Function — `supabase/functions/send-moderation-digest/`

- [ ] 3.1 `index.ts` header on `push-notify`'s model: not deployed as it lands, nothing type-checks
  this directory, the five rules (secrets, no arguments, it verifies the caller itself, nothing
  type-checks it, zero `.from()`), and the activation order.
- [ ] 3.2 `assertServiceRoleCaller` — copied in spirit from `push-notify`, with the same note that it
  is sharper than `verify_jwt: true`, which any rider's access token satisfies (N1, N2).
- [ ] 3.3 No arguments: no body parse, no query string, no recipient parameter (N3).
- [ ] 3.4 `shape.ts` — every decision, no Deno global and no `jsr:` import, so Vitest and `tsc` can
  see it: the renderer, the 4xx/5xx → `retryable` classification, the batch size, the subject-line
  assembly from counts alone (N49), and the `has_session_replay` reduction (N22).
- [ ] 3.5 `mail.ts` — the provider doorway. `sendDigestMail(mail: DigestMail): Promise<MailOutcome>`
  and nothing else in the function knows a provider exists (D7). The recipient is read from a secret
  **inside** this module.
- [ ] 3.6 The loop: claim → render → send → complete. **Send before mark** (D4, N31). Zero claimed
  rows returns before the provider is called (N36).
- [ ] 3.7 `npm run functions:check` (`deno check`) and ESLint — the only two tools pointed at this
  directory.
- [ ] 3.8 Unit tests against `shape.ts` with no network: the renderer's output for each source, the
  retry classification per status, the empty-batch case, and that the rendered mail contains none of
  D5's excluded columns when handed a row that carries them.

## 4. Tripwires in `src/__tests__/`

- [ ] 4.1 Add a detector for the provider key's format to `no-service-role-key.test.ts`, on
  comment-stripped source, **verified both ways** — zero now, and still catching a real key of that
  format (N45). That file's own header explains why the second half is not optional.
- [ ] 4.2 New test: the function directory contains no email-address literal and no reference to
  `SUPPORT_EMAIL`, so hard-coding the published address fails CI (N46, N47).
- [ ] 4.3 Extend the zero-`.from()` assertion to this function, with the anchor note from
  `push-notify`'s header — `grep -n` on one file prints no path, so `CLAUDE.md`'s `:[0-9]+:` filter
  silently reports the unfiltered number (N48).
- [ ] 4.4 `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## 5. Docs — the claims, beside the commands that check them

- [ ] 5.1 `docs/reference/migrations.md` §Applied state: the new file's row, its ordering note, and
  the fact that it is additive and inert.
- [ ] 5.2 `docs/reference/schema.md`: the marker table's contract, its no-policy/no-grant shape, its
  retention, and the projection pointer.
- [ ] 5.3 `docs/ENVIRONMENTS.md`: the function's secrets per project, the three Vault secrets, and
  that DEV holds its own provider key and recipient so two things must be wrong before DEV mails.
- [ ] 5.4 `docs/reference/observability.md`: how a failed digest is read (`npm run logs:errors`,
  24 hours) and the runbook statement that re-arms a capped entry at the dashboard (Q8).
- [ ] 5.5 `npm run docs:check` and
  `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` — the cheap CI step is not the sweep.
- [ ] 5.6 **The PR body records the provider decision and that it supersedes PD-322**, in the wording
  `CLAUDE.md`'s *deliberately undecided* list will inherit. Agents do not write `CLAUDE.md`; the main
  thread does.

## 6. Owner actions — inside this story, not blocking the PR

- [ ] 6.1 Create the provider account and its API key (a free tier is enough; §The provider).
- [ ] 6.2 Set the function secrets on **each** project: the provider key and `DIGEST_RECIPIENT` (the
  owner's private address — **not** `SUPPORT_EMAIL`).
- [ ] 6.3 Deploy `send-moderation-digest` to DEV, then PROD. No session can:
  `deploy_edge_function` is on the deny list and there is no `supabase` CLI in the container.
- [ ] 6.4 Invoke it once by hand and confirm a real digest arrives — this works with no `pg_cron`, no
  `pg_net` and no Vault secret, and is the end-to-end proof (D1).
- [ ] 6.5 `create extension pg_cron; create extension pg_net;` (shared with PD-303's task 3.22), the
  three Vault secrets per project, then re-run `124` §10's do-block to start the hourly schedule.
- [ ] 6.6 Enable leaked-password protection is unrelated and stays open; do not fold it in.

## 7. Ordering — the one part that cannot be reordered for convenience

- [ ] 7.1 `124` applies. **Additive and inert**: it creates a table nothing writes and two functions
  only `service_role` can call. Safe in either direction relative to any deploy.
- [ ] 7.2 The function deploys (6.3).
- [ ] 7.3 The secrets land (6.2). **Before the schedule** — an unconfigured tick 500s
  `not_configured` before it claims, so no report is delivered for as long as the order is wrong.
  (It no longer spends the attempt cap: the guard moved ahead of the claim after review.)
- [ ] 7.4 One hand invocation proves it (6.4).
- [ ] 7.5 The schedule starts (6.5). **Never before 7.2**, or the job posts to a 404 hourly.

## 8. Wrap-up

- [ ] 8.1 `reviewer` on the final diff before the PR opens; its block goes in the PR body verbatim.
- [ ] 8.2 PR against `development`; drive it to merged; the Linear issue becomes `Deployed to DEV`.
  **A story closes when the thing it names exists** — the mail rail exists at merge; the owner steps
  in §6 are named in the PR body and the issue stays open until the digest has actually arrived once.
- [ ] 8.3 `/opsx:archive` this change before the PR, or say in the PR body why it stays open.
