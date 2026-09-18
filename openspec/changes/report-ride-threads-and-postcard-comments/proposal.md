# Report a ride thread and a postcard comment

## Why

**App Store Review Guideline 1.2 asks a user-generated-content app for four things** — a filter, a
mechanism to report offensive content, a block, and published contact information. Reporting exists
on two surfaces and is missing on two, and both of the missing ones are rider-written text a
reviewer reaches in the first two minutes of the app:

```
grep -rn "export async function .*[Rr]eport" src/lib/actions/*.ts
#   src/lib/actions/club-threads.ts:162  reportClubThread     (094)
#   src/lib/actions/moderation.ts:79     reportPostcard       (011)
grep -c "report" src/components/postcards/CommentList.tsx     # 0
```

**Ride threads** say it in their own source. `src/components/rides/RideThreadOptions.tsx`'s header:
*"No Report row this pass, and that is a deferral rather than a decision that reporting is
unwanted"*, naming `retire-ride-chat-for-ride-threads`'s Q4, whose own answer names the trigger —
*"the trigger that flips this to blocking is the store submission, not a rider count."* That
submission is now the milestone this issue sits in. `108` copied the club's threads onto rides;
`094`'s `club_thread_reports` is the same copy one file later.

**Postcard comments** have no report affordance at all, and the gap is older and quieter: `011`
built likes, comments, hides and reports in one file, and gave the report to the *postcard*. A
comment on somebody else's postcard is a different subject with a different author, and the only
remedies a rider has against one today are to block its author or to ask the postcard's author to
delete it.

## What Changes

- **Two migrations, `118` then `119`** — `117` is held by the concurrent PD-398 track. One file per
  subject, in a required order that §Impact states.
- **`public.ride_thread_reports`** (`118`) and **`public.postcard_comment_reports`** (`119`), both
  on `011` §4's shape as `094` refined it: reporter, subject, `reason` under a six-value CHECK, an
  optional `note`, a server-owned `created_at` withheld from the INSERT column grant, and
  `unique (reporter_id, <subject>_id)` as the anti-brigading key.
- **A new table per subject, never a widened `postcard_reports`.** `094` §2's four reasons carry
  over unchanged and the third still decides it on its own: `private.postcard_report_queue` inner-
  joins `public.postcards`, so a comment report or a thread report landing in that table either
  breaks the operator's live queue or vanishes from it behind a `left join` "fix" — *a report in a
  table no query returns is the failure `011` spent sixty-five migrations in*.
- **Two policies per table and no more**: SELECT `reporter_id = auth.uid()`, and an INSERT whose
  `EXISTS` against the subject table **inherits** the audience rather than restating it. For a ride
  thread that is `108`'s `rides` EXISTS + `private.is_ride_crew` + the block arm; for a comment it
  is `011`'s own-comment arm, the `postcards` EXISTS (club, hide and block) and the block arm on the
  commenter.
- **A reader in the same migration, per subject** — `private.ride_thread_report_queue` +
  `private.remove_reported_ride_thread(uuid)`, and `private.postcard_comment_report_queue` +
  `private.remove_reported_comment(uuid)`. All four in `private`, all four revoked from every client
  role including `service_role`. `076` and `094` §5 are the model, line for line.
- **`service_role`'s default grants are REVOKED on both new tables, at creation.** These are
  restricted-readership sinks by `076` §3's criterion — a row is one rider's accusation against
  another, and the reporter's identity is the thing that must not be enumerable by the one
  credential that bypasses RLS. Today three tables are revoked; after this change, five.
- **`enforce_participation_gate` on both new tables**, `before insert … when (current_user =
  'authenticated')`, per `023`.
- **Client**: a `Report thread` row on the ride thread's ⋯ menu (which removes the menu's mount
  gate, because the menu becomes structurally non-empty), and a `Report` control on every comment
  the viewer did not write. `src/lib/actions/ride-threads.ts` gains `reportRideThread`,
  `src/lib/actions/moderation.ts` gains `reportPostcardComment`; the two Zod schemas reuse
  `REPORT_REASONS` rather than copying it.
- **RLS assertions for every negative case below**, per `openspec/config.yaml`'s tasks rule.

## What Does NOT Change

- **The read path is not rebuilt, because it already exists.** The `private.*_report_queue` views
  are read by the project owner in the Supabase dashboard's SQL editor. A `src/`-only grep says
  there is no reader and is wrong. What this change owes is one more queue per new table, in the
  same migration — `076`'s title is the whole rule: **reports have a reader**.
- **No admin screen, no admin role, no moderator claim.** `011`, `076` and `094` each declined to
  invent one; so does this. An in-app moderation surface is a much larger change with its own RLS
  surface and its own audience questions.
- **Nobody gains a read.** Not the thread's author, not the ride's organiser, not the commenter,
  not the postcard's author whose photo the comment sits on, not the club's owner or admin. The
  product owner's 2026-08-31 answer on `094` Q1 — *a report reaches nobody in the club* — is
  reapplied rather than reopened; see D5.
- **No notification of any kind**, to anyone, about anything in this change.
- **No change to `postcard_reports`, `club_thread_reports` or either existing queue** — not their
  columns, policies, grants or comments.
- **No change to any deletion right.** `public.moderate_ride_thread` (`108`) keeps its organiser
  and author arms; `public.moderate_comment` (`011` §1b) keeps being the postcard author's way to
  remove a comment they cannot see. Reporting is a third, separate right and never implies either.
- **Reporting does not hide.** `011`'s separation stands: a report leaves the subject exactly as
  visible as it was, and the rider who wants it gone from their own view blocks or hides.
- **Ride thread *messages* and club *messages* stay unreportable**, deliberately. The reportable
  unit for a conversation is the thread, exactly as `094` decided it for clubs; a per-message report
  is a different table and a different queue and nothing has asked for one. Named here because the
  asymmetry with postcard comments is real and reasonable people read it as an oversight: a comment
  has no parent thread of its own to report, so the comment *is* the unit.
- **Nothing to `anon`** (decision #1). No table grant, no policy, no `security definer` function,
  no widening of `public.ride_invite_link_public_preview`. A signed-out visitor reaches the app
  shell and `/legal/*` and no part of this change.
- **The fourth 1.2 bullet — timely responses to reports — is a person, not code.** It stays the
  product owner's, and PD-457's mail path is a separate queued story that this change does not fold
  in or depend on.

## Capabilities

### New Capabilities

None. Both subjects extend capabilities that already have a home.

### Modified Capabilities

- `content-moderation`: **ADDED only** — the two new report subjects, their tables, their operator
  queues and take-downs, who may not read them, the `service_role` decision, retention, and the
  comment surface's client affordance.
- `ride-threads`: **ADDED only** — the crew's right to report a thread, the reportable set being
  exactly the readable set, the ⋯ menu's row set and the removal of its mount gate, and the cache
  claim reporting does not make.

## Impact

- **Affected specs:** `content-moderation` (ADDED only), `ride-threads` (ADDED only).
  **Coordination — neither capability is in `openspec/specs/` in the form this change extends.**
  `content-moderation` exists there (folded out of `act-on-postcard-reports`) and covers postcards
  only; `ride-threads` does **not** exist there at all — it is created by the active change
  `retire-ride-chat-for-ride-threads`. Re-derive with `ls openspec/specs/` rather than trusting
  this line. Both deltas are **ADDED only**, deliberately, so neither depends on which change
  archives first and neither collides with a requirement another change wrote. The generic schema
  rules this change obeys — a new table's revoke naming `service_role`, the participation gate
  claimed as a delta — are already ADDED requirements in `moderate-and-report-club-threads`'s
  `database-enforced-integrity` delta, so they are **applied here and not restated**, which is what
  keeps two changes from adding the same heading twice.
- **Affected code:** `supabase/migrations/118_report_a_ride_thread.sql` (new),
  `supabase/migrations/119_report_a_postcard_comment.sql` (new), `supabase/tests/rls_test.sql`,
  `src/lib/actions/ride-threads.ts`, `src/lib/actions/moderation.ts`, `src/lib/validation/rides.ts`,
  `src/lib/validation/comments.ts`, `src/components/rides/RideThreadOptions.tsx`,
  `src/app/(app)/rides/detail/thread/page.tsx`, `src/components/postcards/CommentItem.tsx`,
  `src/components/postcards/CommentList.tsx`, plus the two component test files and
  `docs/reference/schema.md`. **Not** `src/lib/data/` — the client never reads a report. **Not**
  `src/lib/query/keys.ts` — reporting changes nothing any key holds, so there is no key to add and
  no claim to make (D8). **Not** `src/types/index.ts` — no report row is ever read into the app.
  **Not** `CLAUDE.md` and **not** `docs/HANDOFF.md`; the main thread owns both, and the gate-trigger
  count and the revoked-table count both move, so it has two edits to make.
- **Migration order: `118` before `119`, and the reason is one comment rather than one object.**
  The two files share no table, view, function or policy, so the order is free on objects. It is
  **not** free on the `public.enforce_participation_gate()` comment, which both files restamp and
  which the last writer wins: `118` makes it twenty-three tables and `119` twenty-four, each
  composed from the LIVE comment rather than from a copy in an earlier file (`092`/`093`'s recorded
  trap). Applied in the other order the enumeration is wrong and nothing fails.
- **Both files are additive and both go MIGRATION-FIRST.** The client half writes a table that does
  not exist yet, so the reverse ordering gives a rider a Report control that answers `PGRST205` for
  the length of a deploy. Neither file adds a second PostgREST relationship to an existing embed,
  and neither removes anything, so there is no deploy-first side to weigh.
- **`036`'s hand-exercise gate does NOT fire.** Neither file hangs a trigger on an already-shipped
  write path and neither replaces a function anyone calls today — the gate triggers are on the two
  new tables, and all four `private` objects are new. This is the ordinary additive case, unlike
  `094`, which had to exercise a live `moderate_club_thread`.
- **Participation-gate triggers: +1 per file, +2 overall.** Stated as a delta on purpose. It is
  **22 on DEV, measured 2026-09-18** (`select count(*) from pg_trigger where
  tgname='enforce_participation_gate' and not tgisinternal`), and `117` lands between this
  measurement and these files, so the absolute number is unknowable from here.
- **Security advisors: zero new, and this one is reasoned from the mechanism.** Every new object is
  either a table in `public` (no advisor class) or a view/function in `private`, which
  `security_definer_view` does not reach and PostgREST does not route to. No new `public`
  `security definer` function is created, so the `authenticated_security_definer_function_executable`
  count does not move — **38 on DEV, measured 2026-09-18**. Confirm with `get_advisors(security)`
  after applying and treat any new WARN as unexpected rather than as noise.
- **`service_role`-revoked tables: 3 → 5** of 33 (`club_thread_reports`, `postcard_reports`,
  `push_devices` today; measured 2026-09-18 with `CLAUDE.md` §Supabase Rules' query). The criterion
  is a judgement about the rows and has no mechanical test, so D6 makes the judgement explicitly
  rather than inheriting it.

## The negative cases

These are the contract. Each is a statement about a role and a resource, so each lands as an
assertion in `supabase/tests/rls_test.sql`.

**Who may report, and who may not:**

1. A rider who is **not on the ride's crew** SHALL NOT report one of its threads — including a
   rider who can see the ride perfectly well, because `rides` visibility and thread visibility are
   an intersection (`108`) and only the crew half is being tested here. The refusal comes from the
   INSERT policy's `EXISTS`, resolved under the caller's own RLS.
2. A rider holding a **pending ride invite** SHALL NOT report a thread. `083` widens *ride*
   visibility and never thread visibility, so they read the ride and none of its conversation.
3. A rider who has **left the crew** SHALL NOT report a thread they could have reported yesterday,
   and SHALL NOT be told that is why.
4. A rider who **cannot see the postcard** SHALL NOT report **another rider's** comments on it — a
   private club they are not in, an author who blocked them, or a postcard **they themselves hid**,
   all three arriving through the same `postcards` EXISTS. **The exception is their own comment, and
   it is not a leak:** `postcard_comments` SELECT carries `author_id = auth.uid()` at **top level**
   (quoted in `design.md` §Context, and D9 depends on it), so a rider still reads — and may
   therefore self-report, inertly — a comment they wrote on a postcard that has since left their
   view. An assertion written against the rider's own comment would fail; §5.4 names somebody
   else's.
5. A rider SHALL NOT report **as somebody else**: `reporter_id = auth.uid()` is a policy conjunct,
   not a client convention.
6. A rider SHALL NOT report the **same subject twice**. `unique (reporter_id, <subject>_id)` is the
   anti-brigading key; the second attempt is a clean no-op at the client (`on conflict do nothing`),
   never an error shown to the rider, and never a second row in the operator's queue.
7. A rider SHALL NOT **edit or withdraw** a report — no UPDATE policy, no UPDATE grant, no DELETE
   policy, no DELETE grant, asserted in **both** directions because a well-meaning `grant all`
   restores only one of them.
8. A rider SHALL NOT stamp `created_at`. It is withheld from the INSERT column grant (`034` §4b,
   `081` §3, `094` §3), because the queue orders by it and a client-stamped value would pin a report
   to the top of the operator's queue for ever.
9. An **un-onboarded** rider SHALL NOT file a report, and the gate's refusal SHALL NOT tell them
   anything about the subject: `enforce_participation_gate` fires BEFORE the RLS `with check` and is
   keyed on the caller's own `terms_accepted_at`, so a readable subject and an unreadable one leave
   by the same door with the same `23514` — asserted by **string equality** between the two
   refusals, which is `093`'s membership-oracle lesson applied at creation.
10. A rider MAY report their **own** thread or their **own** comment — the policy permits it and it
    is inert, `011` and `094` having made the same call — but the affordance SHALL NOT be drawn for
    them. A menu row is a display hint, never an authorization.

**What a blocked pair can each see and do** (decision #2, enforced in RLS, symmetric though the row
is directional):

11. A rider who has **blocked the author — or been blocked by them — SHALL NOT be able to report**
    the thread or the comment. The `EXISTS` resolves to zero rows under the block arm, so
    block-then-report is unreachable by construction. **This is a designed consequence stated
    because it is a trap, not because it is desirable**, and it already holds for a postcard
    (`011`) and a club thread (`094` N14). Every fix is worse: a `security definer` reporting RPC
    would step past the block to confirm the subject exists and then have to decide what to tell a
    caller about a row they cannot see, and a block-arm exemption would let a rider probe for the
    existence of content by riders who blocked them.
12. **The remedy is ordering in the UI, and on the comment surface the fallback is real in SQL and
    unreachable from the app.** The postcard's author who has blocked a commenter cannot *report*
    that comment — they cannot see it. `public.moderate_comment` (`011` §1b) is `security definer`
    and keyed on `p.author_id = auth.uid()`, so **the privilege genuinely survives the block** and
    that function exists for exactly this measured reason. **What does not survive is the id.**
    `postcard_comments` SELECT hides the blocked rider's comment from the photo's owner, so the
    list never renders it and no screen can hand `moderate_comment` a target. The honest statement
    of the cost: a comment by a rider the photo's owner has blocked stays visible to **every other
    viewer**, while its owner can neither see it, report it, nor remove it through any control this
    app draws. **That is pre-existing (`011`) rather than introduced here, and this change does not
    redesign it** — the affordance a photo owner would need is a list of comments on their own
    postcard that the block does not filter, which is a new read path with its own audience
    question. An earlier revision of this line claimed the trap "costs a rider nothing" on this
    surface; it was the one assertion in N11/N12 that did not hold. On a ride thread the cost is the
    report, leaving blocking and leaving the crew, which is the position
    `retire-ride-chat-for-ride-threads` Q4 already accepted.
13. A block SHALL NOT **retract** a report already filed, in either direction. A statement made
    while both parties could see each other is not unmade by a later block.
14. A block SHALL NOT let the blocked party **discover** that a report exists. There is no
    in-app surface that says a subject was reported, to anybody.
15. No object this change adds SHALL make a blocked rider's content, profile or report visible to
    the other party **through any role reachable from the client**. The owner connection is the one
    deliberate exception and it is unreachable from the client by three independent barriers.

**Who may READ a report — the `076` question, and the load-bearing half of this proposal:**

16. The **thread's author** SHALL NOT read reports filed against their thread.
17. The **ride's organiser** SHALL NOT read them. They can already delete the thread
    (`moderate_ride_thread`); a delete is not a read, and conflating the two is how a reporter gets
    identified by elimination on a four-rider crew.
18. The **commenter** SHALL NOT read reports filed against their comment.
19. The **postcard's author** SHALL NOT read reports filed against comments on their own photo —
    the single most tempting thing a reasonable implementer would add here, because they already
    hold a delete right over those comments. They keep the delete and gain no read.
20. The **club owner or admin** of a club a ride belongs to SHALL NOT read either kind of report.
    A ride has no admin role at all (`108`), and a club's admin has no standing on a ride's
    conversation.
21. **`service_role` SHALL NOT read either table.** Named in the revoke at creation, because
    Supabase's project default grants it everything on a new `public` table and `076` §3b is the
    worked example of noticing that sixty-five migrations late.
22. **`anon` SHALL NOT reach either table by any route** — no grant, no policy naming it, no
    function, no PostgREST route that does not require a session.
23. Neither queue view SHALL be readable by `anon`, `authenticated` or `service_role`, by three
    independent barriers: no USAGE on `private` for the first two, an explicit revoke for the
    third, and PostgREST routing only to `public` for all three.
24. Neither take-down SHALL be callable by anyone from the client, enforced by **both** the grant
    and the schema placement so neither alone is load-bearing, and neither SHALL be
    `security definer`.
25. **Neither queue SHALL become a second way to read a row RLS would refuse.** This is `094`'s own
    recorded trap and the most important line in this proposal. Both views run as their owner and
    therefore step past every crew, club, hide and block predicate in the system — that is what
    they are for, and precisely why no PostgREST role may reach them. They are not a *narrower* way
    to read a ride's private conversation or a comment on a private club's photo; they are a
    *pre-joined* way to read what the owner could already read with a hand-written join. Nobody
    else gains a byte, and no route from the app to either object is created, implied or left open.
26. Neither queue SHALL name the **reporter** beyond their uuid — no username, no profile join, no
    email. The reported rider's username is context for judging the content; the reporter's name is
    not needed to judge it, and a view that ever escapes its schema then leaks less.
27. Neither queue SHALL expose any column of **`auth.users`**, and the comment queue SHALL NOT
    expose the postcard's `image_path`: a comment is judged on its text, and the Storage step
    `076`'s runbook owes exists only for a take-down that removes a photo. A photo that is itself
    the problem is reportable on its own, through the surface that already has that column.
28. Neither object SHALL be a **write surface** for any role but the owner.

**What survives what:**

29. Deleting the **subject** SHALL delete its reports, by cascade, and the operator SHALL be handed
    the evidence **before** the delete rather than after. `076` D5's retention decision, restated:
    an archive outliving the subject is a store of one rider's words about another that survives the
    account deletion `/legal/account-deletion` promises erases them.
30. Deleting the **reporter's account** SHALL delete their reports, through
    `reporter_id → profiles(id) ON DELETE CASCADE`, with an index Postgres can use for the cascade
    (`029`'s standing rule, satisfied by the unique key leading with `reporter_id`).
31. Deleting the **ride** SHALL delete its threads and therefore their reports; deleting the
    **postcard** SHALL delete its comments and therefore their reports. Through the existing chains,
    with no new cleanup path.
32. A subject deleted **after** being reported SHALL leave the operator's queue silently and SHALL
    NOT error anything. A take-down called against an id that no longer exists SHALL report that it
    removed nothing rather than raising.
33. **Leaving the crew, leaving the club or hiding the postcard SHALL NOT delete a report and SHALL
    NOT hide it from its reporter.** Neither SELECT policy carries a membership conjunct,
    deliberately: a report is the reporter's own statement, the row holds an id, a reason and a note
    and no content, and evidence that evaporates when the reporter walks away is not evidence.
34. **Retention is indefinite and stated at creation**, in each table's own comment: a report dies
    with its subject and with its reporter, through two `ON DELETE CASCADE`s and nothing else.
    There is no scheduled deletion, no `resolved_at` and no take-down ledger. A different answer
    needs a mechanism, not a sentence.

**On the client:**

35. No rule in this change SHALL live only in a Zod schema. The reason list is a CHECK, the
    uniqueness is an index, the audience is a policy, the consent gate is a trigger; Zod owns the
    message and never the guarantee.
36. A ⋯ menu SHALL NOT open **empty**. Adding Report makes the ride thread's menu structurally
    non-empty for every viewer — author sees Delete, non-author sees Report — which is what allows
    its mount gate to go, and the gate SHALL be removed in the same change rather than left as a
    condition that is now always true for a reason nobody can see.
37. Reporting SHALL invalidate **no** cache key, on either surface. Nothing the reporter or anyone
    else can read changes, and an invalidation would refetch a list to produce the identical rows.
38. A failed report SHALL say it failed and SHALL NOT tell the rider why — no PostgREST code, no
    relation name, no distinction between "you cannot see that" and "that does not exist".

## Open questions

Every one carries a recommended default, so nothing here blocks the build.

- **Q1 — product owner, non-blocking. Does either report reach anybody in-app?**
  **Default: no — operator only, nothing in-app, for either subject.** This is `094` Q1's answer
  (2026-08-31, *"a report reaches NOBODY in the club"*) applied to two new subjects rather than a
  fresh question, and the reasoning transfers exactly: the reported party is frequently the person
  who would read the flag — a ride's organiser can be the thread's author, a postcard's author can
  be the target of the comment — and on a four-rider crew an unattributed flag names the reporter
  by elimination. Non-blocking because the safe answer is the one that can be widened later: a
  rider who reported under "nobody sees this" cannot un-report under a different rule.
- **Q2 — build session, non-blocking. What does the comment's Report control look like?**
  There is no Figma frame for it — `npm run figma -- ls "*eport*"` returns **0 of 451**, and so do
  `"*omment*"` and `"*hread*"`, measured 2026-09-18. **Default: an inline text control beside the
  existing `Delete`, on the same 44px floor, drawn only for comments the viewer did not write** —
  the smallest thing that reuses what `CommentItem` already has and invents no new primitive. A
  per-comment ⋯ sheet is the alternative and it is a heavier one: it needs an icon in every row of a
  list that can run to fifty. Register it in `docs/FIGMA-FIDELITY-TODO.md` beside the two identical
  entries already there.
- **Q3 — build session, non-blocking. One tap or a reason step?** **Default: one tap, sending
  `other`**, as both existing report paths do, because `other` is the only value that asserts
  nothing the rider did not say. The consequence — `reason` carries no signal while these are the
  only callers — is a design gap rather than a schema one, and the fix is a reason frame in Figma
  rather than a guess here.
- **Q4 — build session, non-blocking. One migration or two?** **Default: two, `118` then `119`**,
  because one file covering both subjects is two tables, two views, two take-downs and two gates in
  one string — and this repo already has a documented workaround for a migration too large to pass
  as a string. Two files also roll back independently. The ordering constraint is in §Impact and is
  real but narrow.
- **Q5 — build session, non-blocking. Does a `Block` row go on the ride thread's menu while we are
  there?** **Default: no.** It would need the ordering rule N11/N12 describes and a second confirm,
  and blocking is already reachable from the rider's profile and from any postcard of theirs. The
  menu this change ships is Report + Delete, matching the club's.
- **Q6 — build session, non-blocking. One queue or four?** **Default: four, plus the one-line
  `union all` in each file's `§Operating it` footer**, extending `094`'s. A union view over four
  subject shapes either loses columns or invents nullable ones, and each queue earns its columns by
  being about exactly one thing.
