-- 124: reports and rider feedback reach a human by email — the marker, the
-- claim, the completion and the Vault-gated tick.
-- PD-457. ** SUPERSEDES PD-322 **, which decided this question in August
-- (Slack, hourly sweep, one-way) and was never built. `084` §0's header points
-- at PD-322 for "where anyone reads feedback"; this file is what makes that
-- pointer stale. Email replaced Slack and there are not two live decisions.
--
-- ** THE NUMBER WAS RE-DERIVED, NOT TAKEN FROM THE TASKS FILE. **
-- `list_migrations fpmrimzxadewsaiwpsel` tops out at
-- `123_report_a_postcard_comment` and `list_migrations zwprydcyryvudhurbnye` at
-- `a_completion_carries_a_country`, so `124` is free on both. `ls
-- supabase/migrations/*.sql` reads **121** and is the wrong source in both
-- directions: DEV holds rows whose files are on branches that have not merged
-- here (`122`, `123`, and three long-standing hand-applied ones), so the file
-- count is BELOW the spent numbers and taking `wc -l + 1` hands out `122` a
-- second time. `121`'s own header is the worked example.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE IS
-- ---------------------------------------------------------------------------
-- Five tables collect things a human has to look at: four report tables
-- (`011`/`076`, `094`, `122`, `123`) and `public.feedback` (`084` + `096`).
-- Today the only reader is the project owner deciding, unprompted, to open the
-- Supabase dashboard. This file is the database half of a mail digest that
-- tells them there is something to look at.
--
-- Four objects, plus one view that exists so the source list is written once:
--
--   * `public.moderation_digest_entries`      — the marker. Ids and
--                                               bookkeeping, NO COPY.
--   * `private.moderation_digest_projection`  — the union over the five
--                                               sources, and THE ONLY PLACE
--                                               the projection is computed.
--   * `public.claim_moderation_digest(int)`   — the atomic claim, the reclaim,
--                                               the attempt count and the
--                                               projection that may leave.
--   * `public.complete_moderation_digest(uuid[], text)` — the sender's verdict.
--   * `private.moderation_digest_tick()`      — the Vault-gated schedule.
--
-- ---------------------------------------------------------------------------
-- §0a  WHY THERE IS NO TRIGGER, AND WHAT THAT BUYS  (design D1)
-- ---------------------------------------------------------------------------
-- `121` had no choice about its trigger: a push must reach a device the
-- database cannot address, so the database has to initiate the call. Here the
-- Edge Function **pulls**. PD-457 decided it — *"a sweep rather than a per-row
-- trigger"* — and the consequence is worth stating as a guarantee rather than
-- as a preference:
--
-- ** A DELIVERY FAILURE CANNOT FAIL A RIDER'S INSERT, BECAUSE THERE IS NO CODE
-- ON A RIDER'S WRITE PATH AT ALL. ** Not a trigger, not a `pg_net` call marked
-- best-effort, not a `try`/`catch` that swallows its errors. Nothing to fail.
-- That is the strongest form of the constraint available and it is why the
-- trigger half of `121` is deliberately not copied.
--
-- The price is that the invocation becomes somebody's job: a trigger cannot be
-- forgotten and a schedule can. §7 is the schedule, and it is IN this chain
-- rather than outside it for `121` §10's reason — a job scheduled outside the
-- chain is invisible to `db:drift`, to the RLS suite and to review, so no later
-- session can find out it exists.
--
-- ** INTERVAL: HOURLY ** (§7's schedule, Q2's default). `121` runs per minute
-- because a push's entire value is timeliness. A report's value does not decay
-- — a three-day-old report of a photo that is still up is MORE urgent, not less
-- — so there is **no age cut here and no suppression by age**, which is the one
-- place this file parts company with `121` §7 on purpose.
--
-- ** RECLAIM WINDOW: FIFTEEN MINUTES ** (§4). The only one of `121`'s three
-- numbers that transfers. Longer than one invocation's wall clock (a digest is
-- one HTTP call, seconds) and shorter than the hourly interval, so a crashed
-- run is recovered by the next tick and never by two ticks racing.
--
-- ** ATTEMPT CAP: FIVE, AND A CAPPED ENTRY STAYS UNSENT ** (§4, §5). Not
-- `sent`, which loses the report; not deleted, which re-mails it for ever. It
-- sits there and the source rows sit in the dashboard queues — which is exactly
-- today's state, and is why the worst case of this whole feature is *no worse
-- than not having built it*.
--
-- ---------------------------------------------------------------------------
-- §0b  AT-LEAST-ONCE, AND WHY `attempts` IS COUNTED AT HAND-OUT  (design D4)
-- ---------------------------------------------------------------------------
--   1. claim    — reclaim stale, insert markers, count an attempt on every row
--                 handed out, return the projection.  ** COMMITS HERE. **
--   2. render   — in the function's memory.
--   3. send     — the provider accepts.              ** OUTSIDE THE DATABASE. **
--   4. complete — `sent`.
--
-- Send-then-mark is at-least-once and is chosen explicitly. Mark-then-send is
-- at-most-once and loses a report every time the provider is unreachable at the
-- wrong instant, silently, with a marker asserting the opposite.
--
-- ** `attempts` IS INCREMENTED BY THE CLAIM AND BY NOTHING ELSE, AND THIS IS
-- LOAD-BEARING RATHER THAN TIDY. ** It is `121:840`'s position
-- (`attempts + case when cl.next_state='claimed' then 1 else 0 end`) and it is
-- there for exactly this failure: if the sender dies AFTER the provider
-- accepted and BEFORE `complete_moderation_digest` runs, no completion call
-- ever happens — so a counter that only the completion path advances never
-- moves, the reclaim window frees the same entries, and ** THE SAME BATCH
-- RE-MAILS EVERY HOUR FOR EVER WITH THE CAP NEVER ENGAGING. **
--
-- "A duplicate line in a later digest is a cheap cost" is only true while the
-- duplicate is BOUNDED, and counting at hand-out is the whole of what bounds
-- it. Counting on the completion path makes it an unbounded loop that no test
-- would catch, because every individual run looks correct.
-- ** AN EARLIER REVISION OF THE PROPOSAL PUT THE INCREMENT ON THE COMPLETION
-- PATH. DO NOT MOVE IT BACK. ** §5 therefore does not touch `attempts`.
--
-- ---------------------------------------------------------------------------
-- §0c  WHAT SERIALISES TWO INVOCATIONS — AND IT IS NOT THE ADVISORY LOCK
-- ---------------------------------------------------------------------------
-- `pg_try_advisory_xact_lock` is transaction-scoped and the claim transaction
-- **commits before the provider is ever called**, so the lock is long released
-- by the time a mail goes out. ** IT IS NOT WHAT STOPS TWO INVOCATIONS MAILING
-- THE SAME ROWS. ** Three things together are:
--
--   1. `claimed_at` plus the fifteen-minute reclaim window — a row handed out
--      is invisible to the next claim for fifteen minutes;
--   2. the per-source UNIQUE index on the marker — a source row is entered at
--      most once, whatever races;
--   3. `for update ... skip locked` on the candidate set — two overlapping
--      claims never hand out the same marker row.
--
-- The lock earns its place for one narrower job: stopping two simultaneous
-- claim transactions from both running §4's marker insert and colliding, which
-- `on conflict do nothing` largely covers anyway.
--
-- ** THE ATTRIBUTION IS WRITTEN DOWN BECAUSE THE PROPERTY WOULD BREAK
-- SILENTLY. ** A later session that reads the lock as the guard, and then
-- shortens or removes the reclaim window because "the lock handles it", gets
-- double-mailed reports and nothing goes red.
--
-- ** THE LOCK KEY IS A STABLE NAMED CONSTANT ** — `c_claim_lock` in §4, the
-- literal `1240457` (this file, and PD-457). A key derived per invocation is a
-- no-op that still reads as protection, which is worse than no lock. `121`
-- takes no advisory lock, so nothing in this schema contends for that value;
-- a second scheduled job needs its own and should record it here.
--
-- ---------------------------------------------------------------------------
-- §0d  WHAT THE GRANTS BUY, AND THE CLAIM THAT MUST NOT BE MADE ABOUT THEM
-- ---------------------------------------------------------------------------
-- ** THE HONEST VERSION, replacing a claim the proposal made and a review
-- caught. ** The proposal argued that revoking `service_role` on the marker
-- table prevents that credential stamping `sent_at` on an unsent entry and
-- permanently suppressing a report. ** THAT IS FALSE AS STATED. **
-- `public.complete_moderation_digest(uuid[], text)` is granted to
-- `service_role` by name and hands back exactly that capability with a nicer
-- name: one call marks any entry `sent` whether or not a mail went anywhere.
--
-- ** SUPPRESSION BY A HOLDER OF THE SERVICE-ROLE KEY IS NOT PREVENTABLE BY
-- GRANTS, AND THIS FILE DOES NOT PRETEND OTHERWISE. ** The containment is that
-- the key exists in exactly one place — the Edge Function's secret store, with
-- `src/__tests__/no-service-role-key.test.ts` as the tripwire that keeps it out
-- of the app bundle — and that it is in `.claude/settings.json`'s
-- `autoMode.hard_deny`. That is a key-custody property, not a privilege one.
--
-- ** KEEP THE REVOKE ANYWAY, FOR WHAT IT GENUINELY BUYS: **
--
--   * No accidental `.from('moderation_digest_entries')`. A convenience read
--     or write added to the function later fails with `42501` instead of
--     working, which is how `076` §3b's zero-`.from()` property stays ENFORCED
--     rather than conventional.
--   * An API surface of exactly two named functions. `121` D11 rule 5: the
--     function's entire database reach is a list of function names, so a future
--     change that wants a table has to ask for an RPC and get reviewed.
--   * The read half is real on its own: the rows answer *which report was
--     mailed and when*, which is `076` §3's restricted-readership criterion.
--
-- `121` has the identical shape for `complete_push_delivery`. The only
-- difference is that this proposal elevated a housekeeping benefit into a
-- security claim, and a security claim that is false is worse than no claim —
-- the next session budgets against it.
--
-- ---------------------------------------------------------------------------
-- §0e  THE FIVE SOURCES, AND WHERE THE LIST IS WRITTEN
-- ---------------------------------------------------------------------------
-- ** THE SOURCE LIST AND THE `source` CHECK MUST STAY EQUAL TO
-- `supabase/functions/send-moderation-digest/shape.ts`'s `SWEPT_SOURCES`. **
-- Nothing automatic sits between the two — Deno cannot reach the database and
-- the RLS suite cannot reach that file — so the equality is maintained by hand
-- and asserted on the TypeScript side by a unit test. A kind in `SWEPT_SOURCES`
-- and absent here is a source the digest promises to sweep and does not, which
-- is the one failure that makes an alerting channel worse than none: it trains
-- its reader that no mail means no report.
--
-- ** THE LIST APPEARS IN FIVE PLACES, EACH A CONTIGUOUS BLOCK IN THE SAME
-- ORDER, EACH CARRYING THE SAME BANNER. ** Find every one of them with:
--
--   grep -n 'SOURCE LIST' supabase/migrations/124_reports_reach_a_human.sql
--
--   1/5  §1  the marker's five nullable FK columns
--   2/5  §1  the `source` CHECK's value list, and the agreement CASE beneath it
--   3/5  §1  the five unique indexes
--   4/5  §3  `private.moderation_digest_projection`'s five `union all` branches
--   5/5  §4  the marker insert's five `union all` branches
--
-- Adding or removing a source is those five blocks and nothing else: the
-- PROJECTION IS UNAFFECTED, because all four report tables are column-for-
-- column identical (`id, reporter_id, <subject>_id, reason, note, created_at`)
-- and a fifth report table joins the same way.
--
-- ** `to_regclass` GUARDS AND DYNAMIC SQL WERE CONSIDERED FOR THE SOURCE LIST
-- AND ARE REFUSED. ** It looks like a transfer of §7's pattern and it is not.
-- §7 guards references to EXTENSIONS whose absence is a stable property of
-- every replay of this chain, and none of those references is DDL. Guarding a
-- source TABLE would make the marker's FK columns, the `source` CHECK's value
-- set and the `union all` itself conditional — ** the schema would become a
-- function of merge timing **, and the RLS suite's projection pin would then
-- pin one signature in CI while the hosted database ran another. The one test
-- that matters would be testing a different function than the one that mails.
-- A reduced source list is a deliberate, visible edit to five marked blocks.
--
-- ---------------------------------------------------------------------------
-- §0f  THE RESIDUE: A SENT MAIL IS OUTSIDE EVERY CASCADE  (design D6)
-- ---------------------------------------------------------------------------
-- `121` §0b wrote this for push and it is harder here, because the recipient is
-- a person rather than a device. Once the provider accepts, the text is in the
-- owner's mailbox and in the provider's logs, and ** no policy change, block,
-- take-down, account deletion or erasure request removes it. ** A rider who
-- deletes their account is promised erasure; `029`'s cascade delivers it inside
-- the database, and a digest sent yesterday is outside it.
--
-- ** THIS IS WHY §3's PROJECTION IS THE WHOLE SECURITY MODEL. ** There is no
-- viewer to test a predicate against — the reader is the project owner, who can
-- already read every row in this database — so the containment is a list of
-- columns and a destination that is a secret, and nothing else. The smaller the
-- projection, the less there is to be permanent.
--
-- ** NO WITHDRAWAL SWEEP IS POSSIBLE AND NONE SHOULD BE ATTEMPTED. ** `121`
-- §0b refused the equivalent for push; mail has no recall primitive at all.
--
-- ---------------------------------------------------------------------------
-- §0g  APPLY ORDER — additive and inert, then deploy, then secrets, then clock
-- ---------------------------------------------------------------------------
-- This file creates a table nothing writes and two functions only `service_role`
-- can call. It is safe in either direction relative to any deploy. What must
-- NOT be reordered:
--
--   1. this file applies                              (additive, inert)
--   2. `send-moderation-digest` deploys               (owner)
--   3. the provider key and DIGEST_RECIPIENT land     (owner) — ** BEFORE 4 **,
--      because a deployed function with no key burns the attempt cap on every
--      claimed entry and leaves them unsent until someone re-arms them by hand
--   4. one hand invocation proves it end to end       (owner)
--   5. `create extension pg_cron` / `pg_net`, then §7's do-block is re-run and
--      the hourly schedule starts                     (owner)
--
-- Never 5 before 2, or the job posts to a 404 once an hour.

-- ===========================================================================
-- §1  THE MARKER — ids, bookkeeping, and NOT ONE CHARACTER OF COPY
-- ===========================================================================
-- Three shapes were weighed (design D3) and two are recorded here because both
-- get re-proposed:
--
--   ** A WATERMARK (one `last_sent_at` per source) — REJECTED, and it is the
--   tempting one. ** `created_at` defaults to `now()`, which is the TRANSACTION
--   START clock, so a report inserted inside a long transaction commits AFTER a
--   later report carrying an earlier stamp. A sweep taking `max(created_at)` as
--   its next floor skips that row for ever, silently, and nothing anywhere can
--   detect that a report was never mailed.
--
--   ** A `digest_sent_at` COLUMN ON EACH SOURCE — REJECTED. ** It needs UPDATE
--   on four tables whose entire contract is that they have no UPDATE policy and
--   no UPDATE grant to anybody (`011` §4, `094` §3, asserted both ways). It
--   would make *a report is not editable* false in order to record that a mail
--   went out.
--
-- ** NO TEXT COLUMN OF ANY KIND, AND NO `last_error`. ** `121` §1's rule and
-- `database-enforced-integrity`'s: no subject text, no rendered mail body, no
-- provider error string. A provider's error body can echo the payload it
-- rejected, so a column for it is a payload column with a different name.
-- Failures are read in the function's logs (`npm run logs:errors`, 24 hours).
--
-- ** AND NO `resolved_at`, DELIBERATELY. ** `076:313` and `094:624` both refuse
-- one and this change keeps it refused. The marker says *this was mailed*, never
-- *this was handled*; a `resolved_at` makes the queue a workflow with two
-- writers, which is a moderation product and not this.
create table public.moderation_digest_entries (
  id uuid default uuid_generate_v4() primary key,

  -- Which of the five the row below came from. Redundant against the FK columns
  -- by construction (the CHECK below proves they agree) and kept anyway,
  -- because it is the ONE place a reader compares this file against
  -- `shape.ts`'s `SWEPT_SOURCES`.
  source text not null,

  -- ** SOURCE LIST (1/5) ** — one nullable FK per source, `on delete cascade`.
  -- The cascade is the whole retention answer: a marker dies with its source
  -- row, which dies with its subject or its author. There is no scheduled
  -- deletion and no ledger.
  postcard_report_id uuid
    references public.postcard_reports(id) on delete cascade,
  club_thread_report_id uuid
    references public.club_thread_reports(id) on delete cascade,
  ride_thread_report_id uuid
    references public.ride_thread_reports(id) on delete cascade,
  postcard_comment_report_id uuid
    references public.postcard_comment_reports(id) on delete cascade,
  feedback_id uuid
    references public.feedback(id) on delete cascade,

  -- Incremented by the CLAIM and by nothing else (§0b). Five is the cap and it
  -- lives in §4/§5; this CHECK is BOUNDED RATHER THAN VALIDATING, `121` §1's
  -- shape, with headroom on purpose: at 5 the CHECK would raise INSIDE the
  -- claim and take the whole batch down, so raising the cap must not require
  -- touching a constraint.
  attempts int not null default 0,

  created_at timestamptz not null default now(),

  -- Non-null means a run holds this entry. READ rather than merely written: §4
  -- returns an entry stuck here for fifteen minutes to unclaimed, because an
  -- invocation that died between the claim and the completion would otherwise
  -- strand it for ever and its report would reach nobody.
  claimed_at timestamptz,

  -- Non-null means a provider accepted a mail naming this entry. It does NOT
  -- mean anybody read it, and it never means anybody acted.
  sent_at timestamptz,

  -- ** SOURCE LIST (2/5) ** — the value set, and it must equal `SWEPT_SOURCES`.
  constraint moderation_digest_entries_source_check
    check (source in ('postcard_report',
                      'club_thread_report',
                      'ride_thread_report',
                      'postcard_comment_report',
                      'feedback')),

  -- Exactly one FK is non-null. Without this the CASE below is NULL when every
  -- FK is NULL, `source = NULL` is NULL, and a CHECK that evaluates to NULL
  -- PASSES — so this line is what makes the agreement constraint total rather
  -- than decorative.
  constraint moderation_digest_entries_one_source_check
    check (num_nonnulls(postcard_report_id,
                        club_thread_report_id,
                        ride_thread_report_id,
                        postcard_comment_report_id,
                        feedback_id) = 1),

  -- ... and it agrees with `source`, so the kind cannot drift from the row it
  -- names. Same order as the block above.
  constraint moderation_digest_entries_source_agrees_check
    check (source = case
             when postcard_report_id         is not null then 'postcard_report'
             when club_thread_report_id      is not null then 'club_thread_report'
             when ride_thread_report_id      is not null then 'ride_thread_report'
             when postcard_comment_report_id is not null then 'postcard_comment_report'
             when feedback_id                is not null then 'feedback'
           end),

  constraint moderation_digest_entries_attempts_check
    check (attempts between 0 and 50)
);

alter table public.moderation_digest_entries enable row level security;

-- ---------------------------------------------------------------------------
-- §2  RLS ON, NO POLICY, AND NO GRANT TO ANY ROLE — service_role INCLUDED
-- ---------------------------------------------------------------------------
-- `026`'s `password_reset_grants` shape, restated by `078` §8 and `121` §2 and
-- followed here for the fourth time. The intended access is NONE. RLS is
-- enabled so that the absence of policies DENIES rather than allows.
--
-- ** A POLICY HERE WOULD DESCRIBE DIRECT ACCESS THAT MUST NOT EXIST. ** If you
-- arrived at this file because something cannot read `moderation_digest_entries`,
-- that is the design and not the defect.
--
-- The revoke is EXPLICIT rather than relied upon as a default, because it is
-- not one: this project carries `alter default privileges in schema public grant
-- all on tables to anon, authenticated`, which the test harness reproduces, so a
-- new table arrives FULLY GRANTED and this line takes it away.
revoke all on public.moderation_digest_entries from anon, authenticated;

-- ** service_role TOO. ** CLAUDE.md: a new table KEEPS Supabase's default
-- `service_role` grants, and revoking is the exception for a restricted-
-- readership sink. This is the seventh revoked table. §0d is the argument, and
-- it is deliberately NARROWER than the proposal's: the read half is real (which
-- report was mailed and when), the housekeeping half is real (no accidental
-- `.from()`, an API surface of exactly two function names), and the
-- suppression half is NOT bought by this line — `complete_moderation_digest`
-- hands the same capability back by name.
--
-- It costs the delivery path nothing: every row it needs arrives through the two
-- RPCs below, granted to `service_role` BY NAME.
--
-- It does not touch the cascades either. A referential action runs as the
-- constraint's system trigger and does not consult privileges at all, which
-- `076:261` MEASURED in a rolled-back transaction rather than reasoned about.
revoke all on public.moderation_digest_entries from service_role;

-- ** SOURCE LIST (3/5) ** — one UNIQUE index per source FK. Two jobs each:
-- idempotence (a source row is entered at most once however many times the
-- sweep runs, which is what makes §4's insert safe to re-run for ever) and the
-- FK's own leading-column index, so each cascade has an index to delete
-- through (`029`'s standing rule).
--
-- Plain rather than partial. A partial `where ... is not null` index would hold
-- fewer entries, and the referential-integrity query that runs on cascade is a
-- parameterised `where fk = $1` whose plan must not depend on the planner
-- proving a predicate implication. Correctness of the cascade beats index size
-- on a table this small.
create unique index moderation_digest_entries_postcard_report_key
  on public.moderation_digest_entries (postcard_report_id);
create unique index moderation_digest_entries_club_thread_report_key
  on public.moderation_digest_entries (club_thread_report_id);
create unique index moderation_digest_entries_ride_thread_report_key
  on public.moderation_digest_entries (ride_thread_report_id);
create unique index moderation_digest_entries_postcard_comment_report_key
  on public.moderation_digest_entries (postcard_comment_report_id);
create unique index moderation_digest_entries_feedback_key
  on public.moderation_digest_entries (feedback_id);

-- The claim's access path: unsent entries, oldest first.
create index moderation_digest_entries_unsent_idx
  on public.moderation_digest_entries (created_at)
  where sent_at is null;

comment on table public.moderation_digest_entries is
  'The moderation-digest marker (124, PD-457): one row per source row that has been entered into a digest, across the four report tables and public.feedback. ** IT HOLDS NO COPY ** — no subject text, no reason or note, no rendered mail, no provider error string, and no text column of any kind. Readable and writable by NO role, service_role included: RLS is on, there is no policy, and every grant is revoked; the delivery path reaches it through claim_moderation_digest() and complete_moderation_digest(), both granted to service_role by name. ** RETENTION IS THE CASCADE WINDOW AND NOTHING ELSE **: a marker dies with its source row, which dies with its subject or its author (029), and no scheduled deletion exists. ** MAILED IS NOT HANDLED **: there is deliberately no resolved_at (076, 094), because that column makes the dashboard queue a workflow with two writers. The digest is a pointer to the queues, never a ledger of what was reported.';

comment on column public.moderation_digest_entries.source is
  'Which of the five sources the FK below names. Redundant against the FK columns — moderation_digest_entries_source_agrees_check proves they agree — and kept because it is the one place this schema is compared by hand against send-moderation-digest/shape.ts''s SWEPT_SOURCES, a list nothing automatic can reconcile (Deno cannot reach the database and the RLS suite cannot reach that file).';

comment on column public.moderation_digest_entries.attempts is
  '** Incremented by claim_moderation_digest and by NOTHING ELSE. ** If it only advanced on the completion path, a sender that died after the provider accepted and before completing would never advance it, the reclaim window would free the same entries, and the same batch would re-mail every hour for ever with the cap never engaging. 121:840 takes the same position for the same reason. The cap is 5 and lives in the two functions; the CHECK is a backstop with headroom, so raising the cap never raises a 23514 inside the claim.';

comment on column public.moderation_digest_entries.claimed_at is
  'Non-null means a run holds this entry. Returned to NULL by the next claim after FIFTEEN MINUTES — longer than one invocation''s wall clock, shorter than the hourly interval — because an invocation killed between the claim and complete_moderation_digest would otherwise strand the entry for ever and its report would reach nobody. The attempt is already counted by then, so the reclaim is bounded by the cap.';

comment on column public.moderation_digest_entries.sent_at is
  'Non-null means a provider accepted a mail naming this entry. It does NOT mean anybody read it and it NEVER means anybody acted — see the table comment on the absence of resolved_at. An entry that is unsent with attempts at the cap is PARKED: the send failed or was skipped, the source rows are still in the dashboard queues, and a human re-arms it with `update public.moderation_digest_entries set attempts = 0 where id = ...`.';

-- ===========================================================================
-- §3  THE PROJECTION — the only thing that may leave the database
-- ===========================================================================
-- ** THE CONTAINMENT, AND IT IS A LIST OF COLUMNS RATHER THAN A PREDICATE. **
-- Every other read in this schema is gated on a viewer: a membership, a crew, a
-- hide, a block. Here there is no viewer to test — the reader is the project
-- owner, who can already read every row — so `design.md` D5 states the whole
-- security model as an enumerated projection, and this view is its one
-- implementation. `claim_moderation_digest` returns `p.*` from here and the RLS
-- suite pins BOTH this column list and that function's result type, so a
-- widening fails a test instead of shipping.
--
-- ** WHAT DOES NOT LEAVE, BY NAME, because each is a thing a reasonable
-- implementer adds without thinking: **
--
--   * ** No `reporter_id`, not even as a uuid. ** A uuid is pseudonymous, not
--     anonymous — it joins to everything. `076` §3b revoked `service_role` from
--     these tables for exactly this, and a third-party mailbox is a weaker
--     container than a Postgres table with no grants. The owner resolves the
--     reporter in the queue view at the moment they act.
--   * ** No author id, no username, no `profiles` column of any kind ** — which
--     is why this view joins `profiles` nowhere at all. The mail names no
--     person.
--   * ** No `auth.users` column, above all no rider email address. ** The only
--     address involved is the owner's own and it comes from a secret.
--   * ** No postcard caption, no `image_path`, and no signed URL. ** `076`
--     measured that a signed URL is served by validating its signature rather
--     than by re-running the policy, so it works for its full hour for anyone
--     holding it — including a signed-out stranger the mail was forwarded to.
--     A mail is the most forwardable object in computing.
--   * ** No club name, club id, `is_public` flag, thread title, message body or
--     message count **, and no comment text and no ride-thread text. `094` §5's
--     risk: the queue must not become a second way to read a private club's
--     conversation, and a mail is a queue that has left the building. The
--     digest says *a comment on subject X was reported as harassment*; the words
--     stay in the queue.
--   * ** No `posthog_session_id`. ** `096` §3 added it so a bug report could be
--     read beside ninety seconds of footage; *there is footage* is the part
--     worth mailing, and `has_session_replay` is that boolean. The id itself is
--     a pointer into a recording of a rider's screens and it stays here.
--     `084` does not mention this column at all, which is why the projection
--     was derived from `information_schema.columns` and not from that file.
--   * ** No block, in any readable form. ** The projection contains no PAIR of
--     riders, so no directional or symmetric block can be read out of it. This
--     view deliberately does not consult `private.is_blocked`, and that is
--     correct rather than an omission: it names no viewer to test one against.
--     Decision #2 is untouched.
--
-- ** TWO RIDER-AUTHORED FIELDS DO LEAVE, both deliberately: **
--
--   * `note` — the reporter's free text. Severity lives there, and it is the one
--     field that makes the digest a triage signal rather than a row count.
--   * `feedback.body` — a message a rider wrote TO the owner. A digest that
--     withheld it would be a notification that something had been said. Stated
--     as an exception with a reason rather than left to read as an
--     inconsistency with the club-thread line above.
--
-- ** `source_id` IS THE SUBJECT'S ID, NOT THE REPORT ROW'S — and the column
-- name invites the other reading, so it is settled here. ** The proposal
-- enumerates the projection in four places and pins it in one, and none of them
-- says which. `shape.ts`'s renderer prints it as `subject id` and every one of
-- the four queue views carries the subject id as a filterable column, so the
-- owner can paste it straight into the dashboard and see everything this mail
-- withheld. `reports_on_subject` is a count ABOUT that id, which only reads
-- coherently if the id names the subject. For `feedback` the row IS the subject
-- and the two readings coincide. ** The report row's own id does not leave **;
-- it is not needed, and one fewer id is one fewer thing that is permanent (§0f).
--
-- The counts are `reports_on_subject` and `reports_on_author` and ** NEVER
-- `open_*` **. There is no `resolved_at` in this schema, so there is no such
-- thing as a closed report and "open" would be a qualifier with nothing behind
-- it — worse, the author count is monotonically increasing, so it is a HISTORY
-- rather than a backlog and calling it open invites reading it as work
-- outstanding. The live queue views already call these
-- `reports_on_this_postcard` / `reports_on_this_author`, unqualified; this
-- matches them and matches `shape.ts`.
--
-- In `private`, granted to nobody, for `120` §8's reason: `anon` and
-- `authenticated` hold no USAGE on the schema (`005`) and PostgREST routes only
-- `public`, so there is no route to it at all. `service_role` DOES hold USAGE on
-- `private` (measured by `117`), which is why the absent table grant is the
-- thing doing the work and the revoke below is explicit.
create view private.moderation_digest_projection as
  -- ** SOURCE LIST (4/5) ** — one branch per source, in digest order. All four
  -- report tables are column-for-column identical, so the four report branches
  -- differ only in three table names and one join column.
  select e.id                                        as entry_id,
         'postcard_report'::text                     as source,
         p.id                                        as source_id,
         r.created_at                                as created_at,
         r.reason                                    as reason,
         r.note                                      as note,
         (select count(*) from public.postcard_reports o
           where o.postcard_id = p.id)::int          as reports_on_subject,
         (select count(*) from public.postcard_reports o
             join public.postcards op on op.id = o.postcard_id
           where op.author_id = p.author_id)::int    as reports_on_author,
         null::text                                  as body,
         null::text                                  as app_version,
         null::text                                  as route,
         null::boolean                               as has_session_replay
    from public.moderation_digest_entries e
    join public.postcard_reports r on r.id = e.postcard_report_id
    join public.postcards p on p.id = r.postcard_id

  union all
  select e.id, 'club_thread_report', t.id, r.created_at, r.reason, r.note,
         (select count(*) from public.club_thread_reports o
           where o.thread_id = t.id)::int,
         (select count(*) from public.club_thread_reports o
             join public.club_threads ot on ot.id = o.thread_id
           where ot.author_id = t.author_id)::int,
         null, null, null, null
    from public.moderation_digest_entries e
    join public.club_thread_reports r on r.id = e.club_thread_report_id
    join public.club_threads t on t.id = r.thread_id

  union all
  select e.id, 'ride_thread_report', t.id, r.created_at, r.reason, r.note,
         (select count(*) from public.ride_thread_reports o
           where o.thread_id = t.id)::int,
         (select count(*) from public.ride_thread_reports o
             join public.ride_threads ot on ot.id = o.thread_id
           where ot.author_id = t.author_id)::int,
         null, null, null, null
    from public.moderation_digest_entries e
    join public.ride_thread_reports r on r.id = e.ride_thread_report_id
    join public.ride_threads t on t.id = r.thread_id

  union all
  select e.id, 'postcard_comment_report', c.id, r.created_at, r.reason, r.note,
         (select count(*) from public.postcard_comment_reports o
           where o.comment_id = c.id)::int,
         (select count(*) from public.postcard_comment_reports o
             join public.postcard_comments oc on oc.id = o.comment_id
           where oc.author_id = c.author_id)::int,
         null, null, null, null
    from public.moderation_digest_entries e
    join public.postcard_comment_reports r on r.id = e.postcard_comment_report_id
    join public.postcard_comments c on c.id = r.comment_id

  union all
  select e.id, 'feedback', f.id, f.created_at, null, null, null, null,
         f.body, f.app_version, f.route, f.posthog_session_id is not null
    from public.moderation_digest_entries e
    join public.feedback f on f.id = e.feedback_id;

revoke all on private.moderation_digest_projection from anon, authenticated, service_role;

comment on view private.moderation_digest_projection is
  'THE projection (124 §3, PD-457): the only columns that may leave this database in a digest mail, computed once and read three times by claim_moderation_digest (candidate ordering, renderability, and the returned rows). It joins profiles NOWHERE, carries no reporter_id, no author id, no username, no caption, no image_path, no club or thread identity, no message or comment text and no posthog_session_id — has_session_replay is a boolean because 096 §3''s value survives as "there is footage, go and look". The two rider-authored fields it does carry are deliberate: a report''s `note` (where severity lives) and feedback''s `body` (a message written TO the owner). `source_id` is the SUBJECT''s id, which is what every queue view can be filtered on. In private and granted to nobody; service_role holds USAGE on the schema, so the absent table grant is what denies it.';

-- ===========================================================================
-- §4  public.claim_moderation_digest — the atomic claim
-- ===========================================================================
-- Four statements, and every split is load-bearing for the same reason `121` §7
-- gives: two data-modifying CTEs in ONE statement do not see each other's
-- effects, and "trying to update the same row twice in a single statement is
-- not supported. Only one of the modifications takes place, but it is not easy
-- (and sometimes not possible) to reliably predict which one." Written as one
-- statement this reads tidier and silently loses either the reclaim or the
-- claim.
--
--   1. the advisory lock          — §0c, and read §0c before trusting it
--   2. the reclaim                — separate, because the candidate set must
--                                   SEE it, and a CTE would read the snapshot
--                                   this statement is writing
--   3. the marker insert          — idempotent by the unique indexes
--   4. classify, move, and return — the attempt count and the skip resolution
--
-- ** AN ENTRY WHOSE SUBJECT HAS VANISHED IS RESOLVED INSIDE THE CLAIM, NOT LEFT
-- CLAIMED. ** If the projection's join drops a row, the entry would be handed
-- out with nothing to render, the sender would have no line to write, and the
-- reclaim window would hand it out again every fifteen minutes for ever. So
-- statement 4 classifies it and parks it in the same UPDATE that claims the
-- rest. `121` §6's principle: a gate refusal is an EMPTY RESULT rather than an
-- error.
--
-- ** AND IT IS DEFENSIVE TODAY RATHER THAN REACHABLE, WHICH IS WORTH SAYING
-- OUT LOUD SO NOBODY DELETES IT AS DEAD CODE. ** Measured on DEV: every FK from
-- a report table to its subject is `on delete cascade` and every subject's
-- `author_id` cascades from `profiles`, so a vanished subject takes its report
-- and therefore this marker with it, and a single claim runs in one snapshot.
-- It becomes reachable the moment a source arrives whose FK is not cascading,
-- or a subject gains a soft-delete flag the projection has to respect — and the
-- failure it prevents is an immortal entry, which is the same defect `121` §7
-- had to fix after shipping.
create function public.claim_moderation_digest(batch_size int)
returns table (
  entry_id           uuid,
  source             text,
  source_id          uuid,
  created_at         timestamptz,
  reason             text,
  note               text,
  reports_on_subject int,
  reports_on_author  int,
  body               text,
  app_version        text,
  route              text,
  has_session_replay boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  -- §0c. A STABLE NAMED CONSTANT. A per-invocation key would be a no-op that
  -- still reads as protection. 124 and PD-457; `121` takes no advisory lock, so
  -- nothing else in this schema contends for it. A second scheduled job needs
  -- its own value and should record it in §0c.
  c_claim_lock  constant bigint   := 1240457;
  c_attempt_cap constant int      := 5;
  c_reclaim     constant interval := interval '15 minutes';

  v_limit   int := least(greatest(coalesce(claim_moderation_digest.batch_size, 50), 1), 500);
  v_claimed uuid[];
begin
  -- The loser claims zero rows and returns, which is the same path as "nothing
  -- to send": the sender calls no provider and mails nothing.
  if not pg_try_advisory_xact_lock(c_claim_lock) then
    return;
  end if;

  -- ** THE RECLAIM, FIRST AND SEPARATE. ** It does NOT reset `attempts` — that
  -- is the whole of §0b: resetting it here would restore the unbounded loop the
  -- claim-time increment exists to bound.
  with stale as (
    select e.id
      from public.moderation_digest_entries e
     where e.sent_at is null
       and e.claimed_at is not null
       and e.claimed_at < now() - c_reclaim
     order by e.claimed_at
     limit v_limit
       for update skip locked
  )
  update public.moderation_digest_entries e
     set claimed_at = null
    from stale s
   where e.id = s.id;

  -- Unbounded on purpose, and bounded where it matters. Every unmarked source
  -- row gets a marker; only `v_limit` of them are HANDED OUT below, so a
  -- backlog drains over subsequent ticks at one mail an hour rather than
  -- standing in front of rows that arrived later. `on conflict do nothing` is
  -- the race guard over the `not exists`, which is only the cheap path.
  insert into public.moderation_digest_entries
    (source, postcard_report_id, club_thread_report_id, ride_thread_report_id,
     postcard_comment_report_id, feedback_id)
  select s.kind, s.pr, s.ctr, s.rtr, s.pcr, s.fb
    from (
      -- ** SOURCE LIST (5/5) ** — one branch per source, same order as §1.
      select 'postcard_report'::text as kind, r.id as pr,
             null::uuid as ctr, null::uuid as rtr, null::uuid as pcr, null::uuid as fb
        from public.postcard_reports r
       where not exists (select 1 from public.moderation_digest_entries m
                          where m.postcard_report_id = r.id)
      union all
      select 'club_thread_report', null, r.id, null, null, null
        from public.club_thread_reports r
       where not exists (select 1 from public.moderation_digest_entries m
                          where m.club_thread_report_id = r.id)
      union all
      select 'ride_thread_report', null, null, r.id, null, null
        from public.ride_thread_reports r
       where not exists (select 1 from public.moderation_digest_entries m
                          where m.ride_thread_report_id = r.id)
      union all
      select 'postcard_comment_report', null, null, null, r.id, null
        from public.postcard_comment_reports r
       where not exists (select 1 from public.moderation_digest_entries m
                          where m.postcard_comment_report_id = r.id)
      union all
      select 'feedback', null, null, null, null, f.id
        from public.feedback f
       where not exists (select 1 from public.moderation_digest_entries m
                          where m.feedback_id = f.id)
    ) s
  on conflict do nothing;

  -- Classify and move. `renderable` is the LEFT JOIN answering "does the
  -- projection produce a row for this entry" — see the header on why that arm
  -- is defensive today. Oldest first by the SOURCE row's stamp rather than the
  -- marker's, because on the first run every marker is inserted in one
  -- statement and shares a timestamp.
  with candidates as (
    select e.id, (p.entry_id is not null) as renderable
      from public.moderation_digest_entries e
      left join private.moderation_digest_projection p on p.entry_id = e.id
     where e.sent_at is null
       and e.claimed_at is null
       and e.attempts < c_attempt_cap
     order by coalesce(p.created_at, e.created_at)
     limit v_limit
       for update of e skip locked
  ),
  moved as (
    update public.moderation_digest_entries e
       -- ** THE ATTEMPT IS COUNTED HERE (§0b). ** A parked entry goes straight
       -- to the cap: unsent, and never handed out again without a human.
       set attempts   = case when c.renderable then e.attempts + 1
                                               else c_attempt_cap end,
           claimed_at = case when c.renderable then now() else null end
      from candidates c
     where e.id = c.id
     returning e.id as moved_id, c.renderable as moved_renderable
  )
  select array_agg(m.moved_id) filter (where m.moved_renderable)
    into v_claimed
    from moved m;

  -- `p.*` rather than an enumeration, so the projection is written ONCE (§3)
  -- and a column added there raises here instead of being silently dropped. The
  -- RLS suite pins both this signature and the view's column list.
  return query
  select p.*
    from private.moderation_digest_projection p
   where p.entry_id = any (v_claimed)
   order by p.created_at;
end;
$$;

revoke all on function public.claim_moderation_digest(int) from public, anon, authenticated;
grant execute on function public.claim_moderation_digest(int) to service_role;

comment on function public.claim_moderation_digest(int) is
  'Claims up to batch_size unsent digest entries (bounded to 500, oldest source row first) and returns THE PROJECTION — the only columns that may leave this database in a mail (124 §3). Granted to service_role alone and to no client role: a rider who could claim could suppress their own report. It reclaims first (an entry left claimed for FIFTEEN MINUTES is freed, because a run killed between the claim and the completion would otherwise strand it for ever), then inserts a marker for every unmarked source row across all five sources, then hands out a bounded batch. ** IT COUNTS THE ATTEMPT AT HAND-OUT, NOT ON THE COMPLETION PATH ** (121:840''s position): a sender that dies after the provider accepted never completes, so a counter only the completion path advanced would never move and the same batch would re-mail every hour for ever. ** THE ADVISORY LOCK IS NOT WHAT SERIALISES TWO INVOCATIONS ** — it is transaction-scoped and this transaction commits before any mail is sent; claimed_at plus the reclaim window plus the per-source unique index are (124 §0c). An entry whose subject has vanished is parked at the attempt cap inside the claim rather than handed out with nothing to render.';

-- ===========================================================================
-- §5  public.complete_moderation_digest — the four outcomes
-- ===========================================================================
-- The classifier lives in `shape.ts`'s `classifyMailStatus`; this is where its
-- verdict lands. ** THE VOCABULARY IS FOUR WORDS AND `failed` IS ONE OF THEM. **
-- The proposal's task 1.9 listed `sent` / `retry` / `skipped` and omitted it,
-- and `failed` is what an ordinary 4xx produces — a bad key, an unverified
-- sender, a malformed payload. Omitting it would make this function RAISE on
-- the first real misconfiguration, inside the completion of a batch that had
-- already been mailed.
--
--   'sent'    — a provider accepted a mail naming these entries. `sent_at`.
--   'retry'   — 429, 5xx, or no answer at all. The claim is released and the
--               attempt is ALREADY counted (§0b), so the cap bounds the loop.
--   'failed'  — a 4xx that will not fix itself. Parked at the cap.
--   'skipped' — nothing to render. Parked at the cap. Also written by §4.
--
-- ** NO OUTCOME MARKS AN UNSENT ENTRY `sent`, AND NO OUTCOME DELETES ONE. **
-- `sent` would lose the report; deleting would re-mail it for ever from the next
-- claim. A capped entry sits there unsent and its source rows sit in the
-- dashboard queues — today's state, which is why the worst case of this feature
-- is no worse than not having built it. Re-arming is one statement at the
-- dashboard (the `sent_at` column comment has it).
--
-- ** IT DOES NOT TOUCH `attempts` EXCEPT TO PARK. ** §4 owns the count. An
-- increment here as well would double-count every ordinary send.
--
-- ** AND SEE §0d ON WHAT THIS GRANT MEANS. ** Granting this to `service_role`
-- confers the ability to stamp `sent_at` on an entry no mail ever named, which
-- §2's revoke does NOT prevent and must not be claimed to. The containment is
-- that the key lives in one secret store.
create function public.complete_moderation_digest(entry_ids uuid[], outcome text)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  c_attempt_cap constant int := 5;
  v_rows int;
begin
  if complete_moderation_digest.outcome
       not in ('sent', 'retry', 'failed', 'skipped') then
    raise exception 'complete_moderation_digest: unknown outcome %',
      complete_moderation_digest.outcome
      using errcode = 'check_violation';
  end if;

  -- `and e.sent_at is null` makes every outcome idempotent: a replayed
  -- completion cannot move an entry that already went out, and cannot reset one
  -- to unsent either.
  update public.moderation_digest_entries e
     set sent_at    = case when complete_moderation_digest.outcome = 'sent'
                           then now() else e.sent_at end,
         claimed_at = null,
         attempts   = case when complete_moderation_digest.outcome
                                in ('failed', 'skipped')
                           then c_attempt_cap else e.attempts end
   where e.id = any (complete_moderation_digest.entry_ids)
     and e.sent_at is null;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.complete_moderation_digest(uuid[], text) from public, anon, authenticated;
grant execute on function public.complete_moderation_digest(uuid[], text) to service_role;

comment on function public.complete_moderation_digest(uuid[], text) is
  'Records the sender''s verdict on a claimed batch and returns how many entries it moved. Granted to service_role alone. FOUR outcomes: sent (stamps sent_at), retry (releases the claim; 429, 5xx or no answer), failed (an ordinary 4xx — a bad key or an unverified sender — parked at the attempt cap) and skipped (nothing to render; also written by the claim). ** failed IS PART OF THE VOCABULARY ** — the proposal omitted it, and without it this function raises on the first real misconfiguration. ** NO OUTCOME MARKS AN UNSENT ENTRY SENT AND NO OUTCOME DELETES ONE ** — the first loses the report, the second re-mails it for ever. ** IT DOES NOT COUNT ATTEMPTS ** (claim_moderation_digest does, 124 §0b); it only parks. Every outcome is idempotent through `and sent_at is null`. Granting it to service_role confers the ability to stamp sent_at on an entry no mail named, which the marker table''s revoke does not prevent and is not claimed to: see 124 §0d.';

-- ===========================================================================
-- §6  public.feedback LOSES service_role's DEFAULT GRANTS  (Q5's default)
-- ===========================================================================
-- ** `084` §2 IS QUOTED RATHER THAN PARAPHRASED, BECAUSE THIS FILE IS THE THING
-- IT DEFERRED TO: **
--
--   "`service_role` keeps Supabase's default grants, unlike `078`, and the
--    reason is that whoever builds the reading story may well want a function
--    that does."
--
-- ** THIS IS THAT READING STORY, AND IT WANTS THE OPPOSITE. ** The digest reads
-- `feedback` through `claim_moderation_digest`, exactly as it reads the four
-- report tables whose grants `076` §3b, `094`, `122` and `123` already revoked.
-- Keeping the grant here would make the sender's zero-`.from()` property true of
-- four sources out of five — which is a property nothing enforces, because the
-- one table it could reach directly is the one carrying a rider's free text.
-- Revoking makes it uniform and therefore enforced.
--
-- `feedback` also meets `076` §3's restricted-readership criterion on its own
-- terms: the rows are messages riders wrote to the owner, joined to their
-- authors by `user_id`, and `084` gave them no reader of any kind — no view, no
-- policy, no SELECT grant to any client role. `service_role` was the one
-- credential that could enumerate them, and nothing had asked.
--
-- ** ACCOUNT DELETION IS UNAFFECTED, AND THAT IS MEASURED RATHER THAN ASSUMED
-- (`076:261`). ** A referential action runs as the constraint's system trigger
-- and does not consult privileges at all, so `feedback`'s `on delete cascade`
-- from `profiles` still fires for a `service_role` delete with no SELECT or
-- DELETE grant on the table. `delete-account` never names this table anyway: it
-- removes Storage objects and the `auth.users` row, and the cascades do the
-- rest. The RLS suite asserts the cascade in a rolled-back transaction rather
-- than trusting this paragraph.
--
-- This is the eighth revoked table, and the criterion stays a judgement about
-- the ROWS with no mechanical test (`CLAUDE.md` §Supabase Rules).
revoke all on public.feedback from service_role;

-- ===========================================================================
-- §7  THE SCHEDULE — gated on Vault, apply-clean without either extension
-- ===========================================================================
-- ** `docs/ENVIRONMENTS.md` §Scheduled jobs, and `121` §10 decided it: gate on
-- Vault, in the chain. ** A `pg_cron` job written in a migration replicates to
-- DEV and fires there. For push that meant real riders' phones ringing from
-- DEV; here it means the owner's inbox receiving DEV's seeded test rows hourly,
-- which is not a rider-facing incident and is still the failure that makes an
-- alerting channel worthless — a mailbox trained to ignore the digest.
--
-- Vault secrets do NOT replicate through the migration chain. That is the whole
-- gate: a project where the owner has not created them runs the job and does
-- nothing.
--
-- ** THE LIMITATION, CARRIED OVER FROM `121` §10 RATHER THAN RE-MEASURED. **
-- Postgres on Supabase exposes no self-identifying project reference —
-- `cluster_name` is 'main' on both projects and `current_database()` is
-- 'postgres' on both — so the database cannot check a secret against its own
-- identity. What it CAN check is that two independently-created per-project
-- secrets AGREE, which catches the failure this is actually about: a DEV secret
-- set copy-pasted from PROD. Stated as a limit rather than presented as the full
-- check.
--
-- The second, independent guard is that DEV's function needs its OWN provider
-- key and its own recipient secret. Two things must be wrong before DEV mails
-- anything.
--
-- ** NO KEY OF ANY KIND IS IN THIS FILE. ** Three secrets, created by the
-- owner, per project, with `vault.create_secret()`:
--
--   moderation_digest_project_ref    the project's own ref, e.g. fpmrimzxadewsaiwpsel
--   moderation_digest_endpoint       https://<ref>.functions.supabase.co/send-moderation-digest
--   moderation_digest_service_key    the service-role JWT the function verifies
--
-- ** AND IT APPLIES CLEANLY WITH NEITHER `pg_cron` NOR `pg_net` INSTALLED **,
-- which is required twice over: neither is installed on DEV or PROD, and the
-- RLS suite runs this chain against a plain Postgres 17 where `supabase_vault`
-- does not exist either. Every reference to `vault.`, `net.` and `cron.` below
-- is inside dynamic SQL behind a catalogue check, so nothing in this file
-- resolves a name that is absent.
--
-- ** THERE IS NOTHING FOR THIS JOB TO DO LOCALLY. ** `121`'s tick sweeps
-- retention unconditionally before its Vault gate; this one has no retention to
-- sweep, because a marker's whole lifetime is its source row's (§1). So an
-- unconfigured project's tick is a no-op from the first line.
create function private.moderation_digest_tick()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ref      text;
  v_endpoint text;
  v_key      text;
begin
  -- `to_regclass` returns NULL rather than raising when the extension is
  -- absent, which is what keeps this apply-clean on a plain Postgres.
  if to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;

  execute $q$select decrypted_secret from vault.decrypted_secrets
            where name = 'moderation_digest_project_ref'$q$ into v_ref;
  execute $q$select decrypted_secret from vault.decrypted_secrets
            where name = 'moderation_digest_endpoint'$q$ into v_endpoint;
  execute $q$select decrypted_secret from vault.decrypted_secrets
            where name = 'moderation_digest_service_key'$q$ into v_key;

  -- Absent on a project the owner has not configured — the primary gate, and
  -- the one the migration chain cannot replicate.
  if v_ref is null or v_endpoint is null or v_key is null then
    return;
  end if;

  -- The two per-project secrets must agree. See the header: this stands in for
  -- "names the project it is running on", which Postgres cannot answer for
  -- itself.
  if position('//' || v_ref || '.' in v_endpoint) = 0 then
    raise warning
      '124: the moderation digest is NOT running — moderation_digest_endpoint does not name moderation_digest_project_ref. One of the two Vault secrets was copied from the other project.';
    return;
  end if;

  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'net' and p.proname = 'http_post'
  ) then
    raise warning '124: pg_net is not installed, so the schedule cannot reach the function (owner action). Until it is, the digest is sent by invoking the function by hand, which needs no extension at all.';
    return;
  end if;

  -- ** THE FUNCTION TAKES NO ARGUMENTS FROM ANYBODY: no body, no query string,
  -- no source name, no row id, no batch id and — the one that matters — NO
  -- RECIPIENT. ** There is no argument a confused deputy could point at a rider
  -- or at an address. The empty body is the design, not an omission.
  execute format(
    'select net.http_post(url => %L, headers => %L::jsonb, body => %L::jsonb, timeout_milliseconds => 20000)',
    v_endpoint,
    json_build_object('Content-Type', 'application/json',
                      'Authorization', 'Bearer ' || v_key)::text,
    '{}'
  );
end;
$$;

-- ** GRANTED TO NOBODY, service_role INCLUDED. ** Its only caller is pg_cron,
-- which runs as the superuser. A grant to anything else would be a second route
-- into the outbound call.
revoke all on function private.moderation_digest_tick() from public, anon, authenticated, service_role;

comment on function private.moderation_digest_tick() is
  'The scheduled job (124 §7, PD-457). ONLY when three per-project Vault secrets are present and the endpoint names the ref, it posts to the send-moderation-digest Edge Function through pg_net; otherwise it returns having done nothing at all, which is every project the owner has not configured and both hosted projects today. In `private` and granted to NOBODY, service_role included: its only caller is pg_cron, which runs as the superuser. ** GATED ON VAULT because docs/ENVIRONMENTS.md §Scheduled jobs says a pg_cron job written in a migration replicates to DEV and fires there ** — Vault secrets do not replicate. Postgres exposes no self-identifying project ref (121 §10 measured it: cluster_name is `main` on both), so "names the project it is running on" is implemented as two independently-created secrets agreeing, which catches the copy-pasted secret set. DEV''s own provider key and recipient secret are the second, independent guard. Unlike 121''s tick it does no unconditional local work, because a marker''s retention is its source row''s.';

-- ---------------------------------------------------------------------------
-- The schedule itself, skipped when `pg_cron` is absent.
-- ---------------------------------------------------------------------------
-- ** RE-RUN THIS BLOCK AFTER `create extension pg_cron` (owner action). ** It is
-- idempotent: unschedule-if-present, then schedule. Nothing here resolves a
-- `cron.` name unless the extension is installed, because every reference is
-- inside `execute`.
do $schedule$
begin
  -- `to_regproc('cron.schedule')` is the natural spelling and it is WRONG here:
  -- pg_cron ships two overloads of that name, and to_regproc RAISES on an
  -- ambiguous one rather than returning NULL (121 §10 found this). The
  -- catalogue lookup answers the question that was actually being asked.
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'cron' and p.proname = 'schedule'
  ) then
    raise notice '124: pg_cron is not installed — the moderation digest schedule was NOT created. That is expected today (an owner action) and this migration is complete without it. The digest can be sent by hand with no extension at all. Re-run the do-block at 124 §7 after `create extension pg_cron;`.';
    return;
  end if;

  begin
    execute $c$select cron.unschedule('moderation-digest')$c$;
  exception when others then
    null;  -- not scheduled yet; the point is to be re-runnable
  end;

  -- ** HOURLY (Q2's default, §0a's stated latency). ** A report needs a
  -- same-working-day answer, not a same-minute one, and there is no age cut to
  -- interact with. It bounds the mail volume at 24/day worst case.
  execute $c$select cron.schedule('moderation-digest', '0 * * * *',
                                  'select private.moderation_digest_tick()')$c$;
end
$schedule$;

-- ===========================================================================
-- §Verification — run these against the project after applying, do not assume
-- ===========================================================================
--
-- Expected: 0 — no policies at all (§2). Adding one is the repair to refuse.
--   select count(*) from pg_policies where tablename = 'moderation_digest_entries';
--
-- Expected: t — RLS on, so the absence of policies denies rather than allows
--   select relrowsecurity from pg_class
--    where oid = 'public.moderation_digest_entries'::regclass;
--
-- Expected: f for every cell — SCOPED TO THE GRANTEE on purpose, since postgres
-- owns the table and an unscoped form always returns true
--   select r, p, has_table_privilege(r, 'public.moderation_digest_entries', p)
--     from unnest(array['authenticated','anon','service_role']) r,
--          unnest(array['select','insert','update','delete']) p;
--
-- Expected: 0 — the same thing read off the grant catalogue rather than
-- inferred, and grantee-scoped for the same reason
--   select count(*) from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('moderation_digest_entries', 'feedback')
--      and grantee = 'service_role';
--
-- Expected: 29 kept · 8 revoked — CLAUDE.md's service_role census moves by TWO
-- (the marker table and feedback). It read 30 · 6 on DEV before this file.
--   select count(*) filter (where sr) as kept, count(*) filter (where not sr) as revoked,
--          string_agg(relname, ', ' order by relname) filter (where not sr) as revoked_tables
--     from (select c.relname, has_table_privilege('service_role', c.oid, 'SELECT') as sr
--             from pg_class c join pg_namespace n on n.oid = c.relnamespace
--            where n.nspname='public' and c.relkind='r') t;
--
-- Expected: t,t then f,f,f,f,f,f — by grantee, 031's shape
--   select r, f, has_function_privilege(r, f, 'execute')
--     from unnest(array['service_role','authenticated','anon']) r,
--          unnest(array['public.claim_moderation_digest(int)',
--                       'public.complete_moderation_digest(uuid[],text)']) f;
--
-- Expected: f,f,f — ** the scheduled job is reachable by NOBODY **
--   select r, has_function_privilege(r, 'private.moderation_digest_tick()', 'execute')
--     from unnest(array['service_role','authenticated','anon']) r;
--
-- Expected: {search_path=""} and prosecdef = t on both public functions —
-- stored WITH the quotes, and an assertion matching the unquoted form reads 0
-- and passes as "unpinned" (121's footer)
--   select proname, prosecdef, proconfig from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname in ('public','private')
--      and proname in ('claim_moderation_digest','complete_moderation_digest',
--                      'moderation_digest_tick');
--
-- Expected: the twelve columns of §3, in order, and NOTHING ELSE. This is the
-- projection pin's hosted twin — if it disagrees with the RLS suite, the suite
-- is testing a different function than the one that mails
--   select pg_get_function_result('public.claim_moderation_digest(int)'::regprocedure);
--   select string_agg(column_name, ', ' order by ordinal_position)
--     from information_schema.columns
--    where table_schema = 'private' and table_name = 'moderation_digest_projection';
--
-- Expected: 0 — no entry is stranded in `claimed` past the reclaim window. The
-- standing health check for the whole rail: a non-zero answer that does not
-- clear on the next tick means §4's reclaim is not being reached, and every
-- entry it counts is a report nobody has been told about.
--   select count(*) from public.moderation_digest_entries
--    where sent_at is null and claimed_at < now() - interval '15 minutes';
--
-- Expected: 0 — nothing PARKED. A parked entry is unsent with attempts at the
-- cap, and the two reasons are told apart by whether the projection still
-- resolves: a row WITH a projection is a provider fault or a burnt cap and
-- needs the re-arm statement in the `sent_at` column comment; a row WITHOUT one
-- was skipped because its subject vanished and needs nothing.
--   select e.id, (p.entry_id is not null) as still_renderable
--     from public.moderation_digest_entries e
--     left join private.moderation_digest_projection p on p.entry_id = e.id
--    where e.sent_at is null and e.attempts >= 5;
--
-- Expected: 0 — no cron job and neither extension, which is the correct state
-- until the owner installs them and re-runs §7's block
--   select count(*) from pg_extension where extname in ('pg_cron','pg_net');
--
-- ---------------------------------------------------------------------------
-- The advisor sweep, and what to expect from it
-- ---------------------------------------------------------------------------
-- ** ONE new INFO: `rls_enabled_no_policy` on `moderation_digest_entries` **
-- (§2), which is correct by design and belongs in CLAUDE.md's expected-advisor
-- table beside `push_deliveries`, `push_devices` and `password_reset_grants`.
-- DEV read six of that class before this file.
--
-- ** AND NO NEW `authenticated_security_definer_function_executable` WARN. **
-- That advisor fires once per `security definer` function `authenticated` may
-- execute. This file adds three definer functions of which `authenticated` may
-- execute exactly ZERO — two are granted to `service_role` by name and one to
-- nobody at all. DEV read 38 of that class before this file and must read 38
-- after. A WARN appearing here means a grant was written wrong.
--
-- ** AND NO `anon_security_definer_function_executable` WARN. ** There is one
-- on DEV and it is decision #1's single named exception,
-- `public.ride_invite_link_public_preview(t)`. Nothing here is a second one:
-- this file grants `anon` nothing, anywhere.
--
-- ** AND NO `security_definer_view` WARN for §3's view. ** That advisor fires
-- for views in a schema PostgREST exposes; `private` is not one, which is why
-- `076`/`094`/`122`/`123`'s four queue views raise none either.
