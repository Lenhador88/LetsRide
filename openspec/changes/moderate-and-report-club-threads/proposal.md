# Moderate and report club threads

## Why

**Two halves, both decided by the product owner on 2026-08-31:** *"348 an admin can delete a
thread, and users can report a thread. This is as usual under the 3 dots."* Neither is reopened
below; what follows specifies them.

**Half one — the admin arm.** `public.moderate_club_thread(thread uuid)`
(`supabase/migrations/082_club_discussions_become_threads.sql:252`) gates on `c.owner_id = v_uid`
and nothing else. `088` (PD-326) made `club_members.role = 'admin'` writable for the first time in
this project's life — the column has carried the value since `001`'s CHECK and nothing had ever
written it — so a rider promoted through `promote_club_member` now finds that **the one moderation
control in a club refuses them**, with a message that says nothing. Every other admin-shaped
capability in the schema reads `private.is_club_admin_for`; this one predates it. PD-348's body is
explicit that this was left out of PD-326 deliberately rather than missed: a different migration
touching a different function, in a file that diff never opened.

**Half two — reporting.** A club thread is the only user-generated content surface in this app with
**no report affordance at all**. A postcard has one (`011`, `PostcardMenu`); a thread has a ⋯ menu
that offers deletion and nothing else. App Store Review Guideline 1.2 asks a user-generated-content
app for a way to report, a way to block, a way to hide and action on what is reported — and a
thread, which is a persistent titled object every member of a club reads, currently answers the
first of those with nothing. `076` (PD-297) is the shape for the answer and its title is the whole
lesson: **reports have a reader**. `011` shipped a report table with no reader and it took
sixty-five migrations to close.

## What Changes

- **`094_moderate_and_report_club_threads.sql`** — one migration. `092`, `093` and `095` are held
  by concurrent changes; this file is `094` and the number is not negotiable.
- **`public.moderate_club_thread` gains the admin arm**, by delegating its whole access-control
  decision to `private.is_club_admin_for(v_uid, d.club_id)` — the predicate `085` built and `088`'s
  three RPCs already use. **One predicate, not a second spelling of one** (design.md D1). Written
  as `create or replace`, which preserves the ACL; a drop-and-recreate would be born `EXECUTE` to
  `PUBLIC` (D3).
- **A new table `public.club_thread_reports`**, on `011`'s `postcard_reports` shape: reporter,
  subject, reason, optional note, `unique (reporter_id, thread_id)`. **A new table rather than a
  widened `postcard_reports`** — D5 defends that at length, and the short version is that the two
  subjects carry different audience predicates, different cascades and a live triage view whose
  join to `postcards` is unconditional.
- **Two policies and no more**: the reporter reads only their own rows (`011`'s exact shape), and
  an INSERT whose `EXISTS` against `club_threads` inherits `081`'s membership and block predicates
  without naming either.
- **A reader, in the same migration** — `private.club_thread_report_queue` (a view running as its
  owner) and `private.remove_reported_thread(uuid)` (returns the evidence it is about to destroy).
  Both in `private`, both revoked from every client role including `service_role`. `076`'s objects
  are the model line for line.
- **`enforce_participation_gate` on the new table**, `before insert … for each row when
  (current_user = 'authenticated')`, per `023`.
- **Client**: a `Report thread` row on the thread's existing ⋯ menu, the `canModerate` gate widened
  to admins, and one shared confirm sheet behind both delete rows. `src/lib/actions/club-threads.ts`
  gains `reportClubThread`; `src/lib/validation/clubs.ts` gains the schema, reusing
  `REPORT_REASONS` rather than copying it.
- **RLS assertions for every one of the negative cases below**, per `openspec/config.yaml`.

## What Does NOT Change

- **No admin role, no moderator claim, no in-app moderation queue.** `076` declined to invent one
  and this change declines the same. The reader of a report is the project owner at the Supabase
  dashboard.
- **The club owner and the club admin SHALL NOT read reports.** They gain a delete; they gain no
  read. This is the single most dangerous thing a reasonable implementer would add — see D7 and the
  question at the top of the report.
- **`delete_own_club_message` is untouched.** PD-348's body says so in as many words: it is
  author-only by design (`081`), and a club admin deleting another rider's *message* is a separate
  product question nobody has asked.
- **No new DELETE policy arm on `club_threads`.** The moderation right stays an RPC for `081`'s
  measured reason — RLS filters a DELETE by what the caller may READ, so an admin who has blocked
  the author would match zero rows and PostgREST would report success.
- **No UPDATE or DELETE on `club_thread_reports` for anyone.** `011`'s *"a report is a statement of
  fact at a moment in time"* carries over: a reporter cannot edit or withdraw.
- **`postcard_reports` is not touched** — not its columns, not its policies, not its grants, not
  `private.postcard_report_queue`.
- **No notification of any kind.** Not to the author, not to the admins, not to the reporter. D8.
- **Nothing to `anon`** (decision #1), and no anonymous surface is created or implied.
- **No Block row on the thread menu.** The owner's sentence names two rows; blocking a rider is
  reachable from their postcard and their profile today. Stated because §The negative cases records
  a real consequence of its absence (N14).

## Impact

- **Affected specs:** `club-threads` (one MODIFIED requirement, three ADDED), `content-moderation`
  (ADDED only), `database-enforced-integrity` (ADDED only).
- **Coordination — two of those three capabilities do not exist yet.** `openspec/specs/` holds
  eight standing capabilities, and neither `club-threads` nor `content-moderation` is among them:
  the first is created by the active change `add-club-threads`, the second by the active change
  `act-on-postcard-reports`. Re-derive with `ls openspec/specs/` rather than trusting this line.
  Two consequences, and neither is a reason to restructure the deltas:
  - The MODIFIED requirement in `club-threads` targets a heading that today lives only in
    `add-club-threads`'s ADDED delta. **`club-timeline-engagement` is the precedent** — it modifies
    `club-timeline` requirements owned by the active `add-club-timeline` — so this is the house
    shape rather than a novelty. **Archive order matters**: `add-club-threads` must archive before
    this change, or the MODIFIED delta has nothing to match.
  - `content-moderation` is **ADDED only**, deliberately, so that whichever of the two changes
    archives first creates the capability and the second extends it. A MODIFIED delta there would
    join the pile-up `act-on-postcard-reports` already warns about on
    `database-enforced-integrity`.
- **Affected code:** `supabase/migrations/094_moderate_and_report_club_threads.sql` (new),
  `supabase/tests/rls_test.sql`, `src/app/(app)/clubs/detail/thread/page.tsx`,
  `src/lib/actions/club-threads.ts`, `src/lib/validation/clubs.ts`, `src/types/index.ts`,
  `docs/reference/schema.md`, `docs/reference/product-scope.md`. **Not** `CLAUDE.md` and **not**
  `docs/HANDOFF.md` — the main thread owns both, and the gate-trigger count moves, so that thread
  has an edit to make.
- **Security advisors: this change is expected to add ZERO.** Reasoned, not measured — no advisor
  tool is on this agent's allowlist. The reasoning: `moderate_club_thread` is *already* a `public`
  `security definer` function executable by `authenticated`, so it already fires
  `authenticated_security_definer_function_executable`, and **widening an existing function adds
  nothing** — the advisor fires once per such function, so the count moves by the number of new
  PUBLIC ones and this change adds none. The queue view and the take-down live in `private`, which
  the `security_definer_view` advisor does not reach and PostgREST does not route to. The proxy
  command in `tasks.md` §0.6 answers **24** on DEV today, matching `CLAUDE.md`'s table; the build
  session must confirm with `get_advisors(security)` after applying and treat any new WARN as
  unexpected.
- **Participation-gate triggers: +1.** Stated as a delta on purpose. It is **17** on DEV, measured
  2026-08-31, and `092` and `093` both land before this file — `092` alone adds two — so the
  absolute number is unknowable from here. `tasks.md` §0.4 re-measures; §5.13 asserts
  `before + 1`.

## The negative cases

These are the contract. Each is a statement about a role and a resource, so each lands as an
assertion in `supabase/tests/rls_test.sql`.

**On moderating a thread:**

1. A **plain member** of the club SHALL NOT delete another member's thread — not through the DELETE
   policy, and not through `moderate_club_thread`.
2. A **non-member** SHALL NOT moderate any thread in the club, whether the club is public or
   private. A non-member reads zero threads (`081`), so the refusal must not be the only barrier.
3. An **admin of a different club** SHALL NOT moderate a thread in this one. `is_club_admin_for`
   takes the club as an argument precisely so that authority is per-club, and this is the assertion
   that proves the argument is not ignored.
4. The **thread's own author**, holding no owner or admin standing, SHALL NOT reach
   `moderate_club_thread` at all. Their route is `081`'s DELETE policy. A function that also served
   the author would be the wider hammer used where the narrower one suffices.
5. A caller refused by the function SHALL NOT learn **why**. "No such thread", "not your club",
   "you are a plain member" and "that thread is in a club you cannot see" SHALL leave by **one raise
   site** with one `insufficient_privilege` and one message — asserted by comparing the message for
   a random uuid against the message for a real thread in a stranger's club, not by reading the
   body.
6. `anon` SHALL NOT hold EXECUTE on `moderate_club_thread`. It does not today and `create or
   replace` preserves that; a drop-and-recreate would silently grant it to `PUBLIC`, which includes
   `anon`.
7. An **owner who holds no `club_members` row** SHALL NOT lose the reach they have today. This is
   the `054`/PD-128 state, it is reachable now, and `enforce-creator-membership` is a separate open
   change — so the widened predicate must admit them or this change is a regression wearing a
   feature's clothes.
8. A **blocked** relationship SHALL NOT take the moderation right away, in either direction. `081`
   asserts this for the owner; the admin arm inherits it and SHALL be asserted separately, because
   the equivalent through a policy arm succeeds with zero rows and reports no error.

**On reporting a thread:**

9. A **non-member** SHALL NOT insert a report against a thread in that club — including a
   **public** club, where the rider can read the club row but not its threads. The refusal comes
   from the INSERT policy's `EXISTS`, which resolves under the caller's own RLS.
10. A rider SHALL NOT report **as somebody else**: `reporter_id = auth.uid()` is a policy conjunct,
    not a client convention.
11. A rider SHALL NOT report the **same thread twice**. `unique (reporter_id, thread_id)` is the
    anti-brigading key; the second attempt is a no-op at the client, never an error shown to the
    rider.
12. A rider SHALL NOT **edit or withdraw** a report — no UPDATE policy, no UPDATE grant, no DELETE
    policy, no DELETE grant. Asserted in **both** directions, because a well-meaning `grant all`
    restores only one of them.
13. A rider SHALL NOT set `created_at`. It is withheld from the INSERT column grant (`034` §4b,
    `081` §3), because the triage queue orders by it and a client-stamped value pins a report to
    the top of the operator's queue for ever.
14. A rider who has **blocked the author, or been blocked by them, SHALL NOT be able to report the
    thread** — the `EXISTS` resolves to zero rows under `081`'s block arm. **This is a designed
    consequence and it is stated because it is a trap, not because it is desirable**: block-then-
    report is unreachable by construction, exactly as it already is for a postcard under `011`. The
    remedy is ordering in the UI, not a policy change (D9, Q3).

**On who may READ a report — the `076` question:**

15. The **thread's author SHALL NOT read reports filed against their thread.** This is the
    load-bearing one. `rls_test.sql` already carries its postcard twin and the reason is
    retaliation: in a five-member club, learning that a report exists narrows the reporter to a
    handful of names even without a `reporter_id`.
16. The **club owner SHALL NOT read them.** They gain a delete in this change and no read.
17. The **club admin SHALL NOT read them**, for the same reason and one more: the admin may be the
    reported party, and `088` lets an admin be promoted by another admin.
18. `service_role` SHALL NOT read them. Named explicitly in the revoke at creation, because
    Supabase's project default grants it everything on a new `public` table — `076` §3b is the
    worked example of noticing that sixty-five migrations late.
19. `anon` SHALL NOT reach the table by any route.
20. The triage view SHALL NOT be readable by `anon`, `authenticated` or `service_role`, by three
    independent barriers: no USAGE on `private` for the first two, an explicit revoke for the
    third, and PostgREST not routing to `private` for all three.
21. The take-down SHALL NOT be callable by anyone from the client — enforced by **both** grant and
    schema placement, so neither alone is load-bearing.
22. The triage view SHALL NOT become a second way to read a club's private conversation. It runs as
    its owner and therefore steps past every membership and block predicate in the system; that is
    what it is for, and exactly why no PostgREST role may reach it.
23. The triage view SHALL NOT name the reporter beyond their uuid — no username, no email, no
    profile join. The reported rider's username is context for judging a thread; the reporter's
    name is not needed to judge it.
24. Neither object SHALL be a write surface. No INSERT, UPDATE or DELETE privilege on either, for
    any role, including the ones that arrive by default.

**On what survives what:**

25. Deleting the thread SHALL delete its reports, by cascade, and the operator SHALL be handed the
    evidence **before** the delete rather than after. `076` D5's decision, restated: the
    alternative is an archive of a rider's words about another rider outliving the account deletion
    `/legal/account-deletion` promises erases them.
26. Deleting the **reporter's account** SHALL delete their reports. `reporter_id → profiles(id) ON
    DELETE CASCADE`, and `029`'s standing rule that every FK into `profiles` has an index Postgres
    can use for the cascade.
27. Deleting the **club** SHALL delete its threads and therefore its reports, through the existing
    chain and with no new cleanup path.
28. **Leaving the club SHALL NOT delete a report, and SHALL NOT hide it from its reporter.** The
    SELECT policy carries no membership conjunct, deliberately: a report is the reporter's own
    statement, and evidence that evaporates when the reporter walks away is not evidence. The row
    holds a thread id, a reason and a note — no thread content — so this leaks nothing about a club
    they have left.
29. A **block SHALL NOT retract a report** in either direction, for the same reason `081` gives for
    threads: a conversation is not retracted because one participant stopped seeing the other.

**On the client:**

30. No rule in this change SHALL live only in a Zod schema. The reason list is a CHECK constraint,
    the uniqueness is an index, the authority is a `security definer` body, the consent gate is a
    trigger. `src/lib/validation/clubs.ts` owns the **message** and never the guarantee.
31. A menu row SHALL NOT be an authorization. Every row is gated on the viewer so the sheet does
    not offer what the database will refuse; a forged state reaches the same refusal.

## Open questions

Every one carries a recommended default so the build is never blocked. **Q1 is the only blocking
one and it is the product owner's.**

- **Q1 — ANSWERED 2026-08-31, and the answer is the default: NO.** Put to the product owner as
  three options — operator only, an unattributed flag for owners and admins, or the report with the
  reporter named — they chose **operator only, nothing in-app**. So D7 stands: not the author, not
  the owner, not the admin. Build it as specified. The original framing, kept because it is what
  makes the answer defensible:

- **Q1 (as put) — product owner, was BLOCKING. Does a report reach the club's admins in any form?** The owner's
  sentence says riders can report a thread and does not say who reads it. This change routes reports
  to the platform operator alone (D7). The alternative — an unattributed "this thread has been
  reported" flag for owners and admins — is one boolean away and is **not** reversible once shipped,
  because a rider who reports under one rule cannot un-report under another.
  **Default: no. Nothing in-app tells anybody that a thread was reported.** Blocking because it is
  the one decision here that changes who can see a rider's report, and because the safe default is
  the one that can be widened later.
- **Q2 — product owner, non-blocking. Should the reason step exist?** The design collects no reason
  for a postcard report (`Home / Report post` has four frames and no reason step), and there is no
  Figma frame for a thread report at all — `npm run figma -- ls "*eport*"` is the check. So this
  ships one-tap, sending `other`, which is the only value that asserts nothing the rider did not
  say. **The consequence is that `reason` carries no signal** while this is the only caller.
  **Default: one tap, `other`, and a note in `docs/FIGMA-FIDELITY-TODO.md` beside the identical
  postcard entry.**
- **Q3 — build session, non-blocking. Menu row order, given that block-then-report is unreachable
  (N14).** The thread menu has no Block row today, so the trap is only reachable from elsewhere.
  **Default: leave the thread menu as Report + Delete, and do not add Block in this change.** Adding
  it would need the ordering rule and a second confirm, and the owner's sentence names two rows.
- **Q4 — build session, non-blocking. Does the author's own `Delete thread` adopt the new confirm
  sheet?** Today it deletes on one tap with no confirmation of any kind, and it takes every message
  in the thread with it — collateral the ⋯ convention says to name in a sheet. **Default: yes, one
  sheet behind both rows with different copy.** Two implementations of one confirmation is the
  defect the sheets exist to avoid. Droppable without touching the migration.
- **Q5 — product owner, non-blocking. How long does a report live?** As specified: for as long as
  its thread and its reporter, and not one day longer — three cascades and no scheduled deletion,
  this repo having taken no decision on `pg_cron`. **Default: that, stated in the table comment at
  creation rather than left silent.** A different answer needs a mechanism, not a sentence.
- **Q6 — build session, non-blocking. One queue or two?** The operator now has
  `private.postcard_report_queue` and `private.club_thread_report_queue`. **Default: two, plus a
  one-line union in the `§Operating it` runbook footer.** A `union all` view over two different
  subject shapes either loses columns or invents nullable ones, and `076`'s queue earns its columns
  by being about exactly one thing.
