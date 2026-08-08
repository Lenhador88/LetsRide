## 0. Before anything — three answers and two measurements

- [ ] 0.1 **Q1 — product owner, blocking.** Does `maybe` get the same rights as `going`?
  Default: **yes**, identical; crew membership is the presence of the `ride_members` row and
  never its status. This decides the shape of `private.is_ride_crew` and therefore every
  assertion in group 2, so it cannot be deferred past the first line of SQL.
- [ ] 0.2 **Q5 — designer, blocking.** What does a rider who can see the ride but is not on its
  crew see at `/rides/[id]/chat`? Default: **"Join the ride to see the chat"** plus the existing
  RSVP control. No frame draws it, and rendering it as the empty state instead is a
  `client-render-shell` violation rather than a styling choice.
- [ ] 0.3 **Q2 — product owner, blocking at launch and not now.** Retention window for a chat
  message. Default: **none in the first pass** — a message lives as long as its ride. Build
  proceeds on the default; the answer must exist before real riders do.
- [x] 0.4 **Pre-flight, MEASURED 2026-08-07 against `zwprydcyryvudhurbnye`, RLS bypassed
  (service role, via the Supabase MCP `execute_sql`), so these are true counts and not
  per-viewer ones:**

  | Fact | Value |
  |---|---|
  | `rides` / `ride_members` rows | **5 / 5** |
  | `ride_members.status` CHECK | `going`, `maybe` — no third value |
  | Tables in publication `supabase_realtime` | **0** — the publication exists and is empty |
  | `private` functions | seven; **no crew helper exists** |
  | `private.may_participate()` | the two stamps only; does not consult the terms version |
  | `private.current_terms_version()` | `'0-placeholder'` |
  | Highest migration file / applied | **033 / 033**, zero drift |

  Two of these decide something. The **empty publication** means the `alter publication` in 2.10
  is not a formality — nothing in this database is published today, so nothing has ever proved
  the mechanism works here. The **`going`/`maybe`-only CHECK** is why `is_ride_crew` tests row
  presence and does not filter on `status`.

  **`CLAUDE.md` §Supabase Rules reads "Applied state: `001`–`032`" and is stale by one.** Fix it
  in group 6 rather than working around it.
- [ ] 0.5 Re-derive the migration number rather than trusting this file. It reads **034** at
  write time, 2026-08-07. `ls supabase/migrations/` against `list_migrations`; this repo's docs
  have had that number wrong in both directions, and `enforce-creator-membership` still claims
  `029`, which is taken.
- [ ] 0.6 Measure two behaviours on a scratch database before writing SQL, in `021` §3's style —
  record the observations in `034`'s header, not the recollection:
  **(a)** a `BEFORE INSERT` trigger that assigns `new.created_at` wins over a value supplied by
  the caller, and the two `BEFORE INSERT` triggers on this table fire in **name** order;
  **(b)** an RLS SELECT policy calling a `private` `security definer` helper is evaluated
  correctly for the `authenticated` role, i.e. `authenticated`'s EXECUTE grant on
  `private.is_ride_crew` is what makes the policy work — assert it by naming the role
  (`has_function_privilege('authenticated', …)`), which is `031`'s lesson: the suite runs as the
  table owner, for whom no barrier exists, so calling the function proves nothing.

## 1. `034_ride_messages.sql` — the table, the helper, the policies

Every task touching SQL is paired with its assertion task, per `openspec/config.yaml`. The whole
file is **additive**: one new table, one new `private` function, one new trigger function, four
policies, three indexes, one publication membership, grants to `authenticated` only. Nothing is
dropped, no existing SELECT policy is touched, no grant is revoked — so unlike `021`/`023`/`025`
there is **no deploy ordering constraint**, and it may be applied before the code that uses it.
Say that explicitly in the header, because this repo's default assumption is now the careful one.

- [ ] 1.1 Header: the pre-flight from 0.4, the measurements from 0.6, `design.md` §D1's
  three-conjunct argument in full, and the statement that this file is safe to apply at any time
  relative to the code deploy and why.
- [ ] 1.2 `public.ride_messages` — `id uuid primary key` (**no default**; the client supplies it,
  and `design.md` §D4 says why the reason is idempotency rather than reconciliation),
  `ride_id uuid references public.rides(id) on delete cascade not null`,
  `author_id uuid references public.profiles(id) on delete cascade not null`,
  `body text not null`, `created_at timestamptz not null` with a DEFAULT that the trigger in 1.6
  makes irrelevant — keep it anyway so a migration-issued insert needs no clock.
  `constraint ride_messages_body_length check (length(btrim(body)) >= 1 and length(body) <= 1000)`,
  copying `postcard_comments_body_length`'s trimmed-floor / raw-ceiling asymmetry exactly (Q3).
  **No `updated_at`**, because there is no UPDATE — and say so in the file rather than leaving
  the absence to be read as an oversight.
- [ ] 1.3 `alter table public.ride_messages enable row level security;` plus a
  `comment on table` recording the one thing `list_tables` should show a future session: *a
  ride's chat belongs to its crew, which is narrower than the ride's own audience — see 034 §2.*
  (`028` exists because a database comment is the `data` agent's first read and no edit to
  `CLAUDE.md` can reach it.)
- [ ] 1.4 Three indexes. `ride_messages_thread_idx on (ride_id, created_at desc, id desc)` — the
  thread read and its keyset cursor, and the tiebreak is part of the index because `design.md`
  §D6 requires the index, the query and the cursor to agree. `ride_messages_author_id_idx on
  (author_id)` — **not for a screen**, for the `ON DELETE CASCADE` from `profiles`, which is
  `011`'s stated reason for `postcard_comments_author_id_idx` and is `add-account-deletion`'s
  "a future migration adds a table referencing `profiles`, it SHALL add the index in the same
  file" rule meeting its first case.
- [ ] 1.5 `private.is_ride_crew(uuid)` — `security definer`, `stable`, `set search_path = public`,
  `revoke all … from public`, `grant execute … to authenticated`. `005`'s shape exactly. Two
  arms: `rides.organizer_id = auth.uid()`, **or** a `ride_members` row exists. **Does not filter
  on `status`** — a comment must say why, and must say that a third status is the first thing to
  revisit here.
- [ ] 1.6 `public.set_ride_message_created_at()` — `before insert on public.ride_messages for
  each row`, `security definer`, `set search_path = ''`, `revoke all … from public, anon,
  authenticated`. Assigns `new.created_at := now()` unconditionally. The comment must say that a
  DEFAULT is not a rule because `authenticated` holds INSERT and PostgREST lets a client name
  any column, and that ordering *is* the product here.
- [ ] 1.7 The four policies, all `to authenticated`:
  - **SELECT** — the three conjuncts from `design.md` §D1, with a `comment on policy` stating
    that the `EXISTS` against `rides` is **not** redundant with `private.is_ride_crew` and why.
    That comment is the mitigation for the highest-probability regression in this change.
  - **INSERT** — `author_id = auth.uid()` **and** `exists (select 1 from public.rides r where
    r.id = ride_messages.ride_id)` **and** `private.is_ride_crew(ride_messages.ride_id)`. The
    same composition; a rider may only write where they may read.
  - **DELETE** — `author_id = auth.uid() or exists (… rides r … r.organizer_id = auth.uid())`.
    Carry `011`'s CAUTION comment verbatim in substance: this does **not** reach a message the
    caller cannot see, and `moderate_ride_message` is deliberately not built.
  - **No UPDATE policy**, and the file says so in a comment rather than by silence.
- [ ] 1.8 Grants: `revoke all on public.ride_messages from anon, authenticated;` then
  `grant select, insert, delete on public.ride_messages to authenticated;`. **No UPDATE**, which
  is the second independent layer per `009` §5 and `011` §5.
- [ ] 1.9 `drop trigger if exists enforce_participation_gate on public.ride_messages;` then the
  trigger, `before insert for each row when (current_user = 'authenticated')`, reusing `023`'s
  existing function — nothing new is created. The header must state that this is **defence in
  depth today, not the primary control**, and name the case that makes it load-bearing (a
  `may_participate()` that consults `current_terms_version()`), rather than overclaiming.
- [ ] 1.10 `alter publication supabase_realtime add table public.ride_messages;` — with the
  measured note that the publication holds **zero** tables today, and that a subscription to a
  table outside it connects, reports `SUBSCRIBED` and never fires. **Do not set
  `REPLICA IDENTITY FULL`**; state why in the file, because it looks like an obvious improvement
  and it is a content leak into a stream that cannot evaluate a policy.
- [ ] 1.11 Footer `§Verification` block in `016`/`022`/`023`'s style — every expected number with
  the query that produces it: 4 policies all `to authenticated`, 0 UPDATE policies,
  `has_table_privilege('authenticated','public.ride_messages','update')` false, `anon` holding
  zero privileges, 3 indexes, 2 non-internal triggers, `prosecdef` true and `proconfig` holding
  `search_path=""` (**the literal quotes** — matching on `search_path=` finds nothing and reads
  as a pass), and one row in `pg_publication_rel`.

## 2. Assertions in `supabase/tests/rls_test.sql`

Each of these maps onto a requirement in `specs/ride-chat/spec.md` or
`specs/database-enforced-integrity/spec.md`. The fixture needs a ride with an organizer holding
**no** `ride_members` row, one `going` crew member, one `maybe` crew member, one non-crew rider
who can see the ride, one rider who cannot, and a private club's ride.

- [ ] 2.1 **Positive, then the one that matters.** A `going` crew member reads and writes; a
  `maybe` crew member reads and writes **identically**; the organizer with no `ride_members` row
  reads and writes. Three assertions, and the third is the one a membership-only predicate fails.
- [ ] 2.2 **A rider who can see the ride and has not RSVP'd gets zero rows and `42501` on
  insert.** The single most important negative in this change. Assert on a **public** ride so
  that ride visibility is unambiguously satisfied and only the crew predicate is doing the work.
- [ ] 2.3 **A rider who cannot see the ride at all gets zero rows** — private club, non-member.
- [ ] 2.4 **A crew member who blocks the organizer gets zero rows**, with their `ride_members`
  row untouched, asserted in both directions. This isolates the `EXISTS(rides)` conjunct: the
  crew conjunct alone admits them.
- [ ] 2.5 **A crew member who leaves the ride's private club gets zero rows**, `ride_members` row
  untouched. This isolates the same conjunct through a **different** predicate, which is why it
  is a second assertion and not a duplicate of 2.4 — one case cannot say which predicate hid the
  row, and a later edit could remove one while the suite stays green.
- [ ] 2.6 **Leaving the crew ends reading immediately, and does not retract the conversation.**
  Delete the `ride_members` row; the leaver reads zero rows **including their own messages**;
  every remaining crew member still reads the leaver's messages. The "including their own" half
  is what pins the author arm inside the conjunction rather than at the top level.
- [ ] 2.7 **Blocking between two crew members is symmetric and per-author.** A blocks B: A does
  not see B's messages, B does not see A's, both still read everyone else's, both remain crew.
  Asserted with A and B exchanged.
- [ ] 2.8 **Your own message survives a block.** The blocked rider still reads their own messages
  while remaining crew and while the ride is still visible to them.
- [ ] 2.9 **`anon` holds zero privileges** on `ride_messages`, and no policy targets anything but
  `authenticated`. Scope the grant assertion to the grantee, or use `has_table_privilege` —
  `015`'s footer got this wrong the first time and read 2 against a correct database, because
  `postgres` and `service_role` hold everything by Supabase default.
- [ ] 2.10 **No UPDATE, two ways.** No UPDATE policy exists, and
  `has_table_privilege('authenticated','public.ride_messages','update')` is false. Assert both;
  either alone is undone by one future line.
- [ ] 2.11 **DELETE, one assertion per branch.** Author deletes their own — succeeds. Organizer
  deletes another rider's on their own ride — succeeds. A crew member who is neither — matches
  **zero rows** and the message survives, so *the surviving row is the assertion*, because a
  DELETE filtered by `USING` succeeds against zero rows rather than raising.
- [ ] 2.12 **The KNOWN GAP is asserted as a gap, not as working.** Organizer blocks a crew
  member, then deletes that rider's message by id: `DELETE 0`, and the row survives. Assert the
  gap so that the day `moderate_ride_message` is built, this assertion is what has to change —
  the same way `011` recorded its own measurement.
- [ ] 2.13 **`created_at` is server-owned.** Insert naming `created_at` as a far-future value;
  the stored value is `now()`. Then assert the trigger's `prosecdef` and its revoked EXECUTE for
  `authenticated` and `anon`.
- [ ] 2.14 **Author cannot be forged**, and **body bounds hold**: empty, whitespace-only, and
  over the ceiling are each refused with `23514`; a body padded with whitespace to exceed the
  raw ceiling is refused, which is the case the trimmed floor alone would let through.
- [ ] 2.15 **A duplicate `id` is refused with `23505`** and overwrites nothing.
- [ ] 2.16 **The participation gate.** An un-onboarded rider cannot insert a message — and,
  because the gate is defence in depth here, assert the *primary* control too: that rider cannot
  hold a `ride_members` row in the first place, so the read is closed by construction. Both, or
  the assertion proves less than it looks.
- [ ] 2.17 **`private.is_ride_crew` is not executable by `anon`, is executable by
  `authenticated`, and is absent from `public`** so PostgREST does not publish it — `009`'s
  assertion shape for `private.is_blocked`. Name the **role**, per `031`'s lesson.
- [ ] 2.18 **Publication membership** — exactly one row in `pg_publication_rel` for
  `supabase_realtime` naming `public.ride_messages`. Cheap, and it is the assertion that catches
  the failure with no error to read.
- [ ] 2.19 **Nothing moved in the existing visibility layer.** Policy counts for `rides` and
  `ride_members` unchanged, every one still `to authenticated`, `anon` still holding zero grants
  across `public`, and the "exactly one SELECT policy per table" invariant still holding with
  `ride_messages` added to it.
- [ ] 2.20 `PGPASSWORD=postgres npm test` green, and **re-derive** the assertion total rather
  than quoting it: `PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"`. The suite read
  594 before this change — check rather than trust that number, and compare **label sets** rather
  than counts if it disagrees, which is the only comparison that shows whether an assertion was
  lost.

## 3. Apply, and verify against the hosted project

- [ ] 3.1 Apply `034` to DEV first, per `docs/ENVIRONMENTS.md`, then PROD. Run the footer queries
  from 1.11 against each.
- [ ] 3.2 **Check the security advisors.** Expect the count and identity **unchanged at eight** —
  `private.is_ride_crew` is in `private`, which PostgREST does not publish and `service_role`
  holds no USAGE on, and `set_ride_message_created_at` has EXECUTE revoked from `authenticated`.
  A new `authenticated_security_definer_function_executable` finding means a `revoke` did not
  land; `021`'s footer explains why the file and the database can silently disagree
  (`apply_migration` takes SQL as an argument, not a path).
- [ ] 3.3 Confirm `alter publication` actually landed. It requires ownership of the publication,
  which is not something a migration usually needs — verify from `pg_publication_rel` on the
  hosted project rather than from the migration having returned without error.
- [ ] 3.4 `npm run db:drift` — the repo, DEV and PROD agree on the chain.

## 4. The screen and the data path

- [ ] 4.1 `src/lib/data/ride-messages.ts` — `getRideThread(rideId, cursor?)`, ordered
  `created_at desc, id desc`, `limit 50` (`design.md` §D6 argues the number). Returns oldest-first
  for render. Reads go through `resolveSupabase`; the component never calls Supabase.
- [ ] 4.2 `src/lib/actions/ride-messages.ts` — `sendRideMessage(rideId, id, body)`. The `id` is a
  **parameter**, generated by the caller once and reused across retries; generating it inside the
  action defeats the idempotency rule. `deleteRideMessage(messageId)` ships behind no UI (Q4).
- [ ] 4.3 `src/lib/validation/ride-message.ts` — one Zod schema, bounds matching the CHECK
  exactly. It owns the message, never the guarantee.
- [ ] 4.4 `keys.ts` — `rides.thread(rideId)` nested under the existing `rides.detail(rideId)`
  prefix, so a ride-wide invalidation reaches it. Add the row to that file's header table; it is
  the first key fed by a subscription rather than only by `invalidate`, and the header should say
  so.
- [ ] 4.5 `formatChatTime` in `src/lib/utils.ts` — named for its screen per `CLAUDE.md`'s
  no-generic-formatter rule. `HH:mm`, the shape the design draws (`08:18`, `19:22`, `22:01`).
  Zone per Q10; default `APP_TIME_ZONE`.
- [ ] 4.6 `/rides/[id]/chat/page.tsx` and the components. Gate on the **data**, never on
  `isLoading`. `null` is `notFound()`; `undefined` is "not yet". The three zero-row cases from
  `design.md` §D8 are three different renders.
- [ ] 4.7 `RideHeader` gains the chat button — `Element / Icon / Chat Bubble`, 40×40, in the
  action row, **not** a row in `RidePageMenu`. Rewrite that component's doc comment: it currently
  explains why chat is omitted, and leaving that text in place is exactly the stale-claim class
  `reviewer`'s documentation audit exists for. The `Warning/100` unread dot stays omitted —
  PD-120.
- [ ] 4.8 Grouping and the author name. The design shows the author's name on the **first**
  message of a consecutive run by one rider and not on the following ones (`Section` frames), and
  never on your own. Own messages are `Grey/100` ground with `White/100` text and a
  `White/50%` timestamp; others are `Grey/10` with `Grey/100` text. No avatars in the bubbles.
- [ ] 4.9 Day separators (Q8) and the composer placeholder (Q9) — both are designer answers with
  defaults; build the defaults and flag them in `docs/FIGMA-FIDELITY-TODO.md`.
- [ ] 4.10 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build` green.

## 5. The subscription

- [ ] 5.1 The hook: `useEffect` opens one channel named from the ride id alone, cleanup calls
  `supabase.removeChannel(channel)`. Listen for **`INSERT` only** — `design.md` §D5(c) is the
  reason and it is a security one, so it needs a comment at the call site, not only in a spec.
- [ ] 5.2 Re-authenticate the socket on token refresh, and remove every channel on sign-out. The
  second is what stops a socket authorised as rider A surviving into rider B's session on a
  shared device.
- [ ] 5.3 Refetch on reconnect and on foreground, merging by id and preserving scroll position.
  A subscription is an optimisation over revalidation, never a replacement.
- [ ] 5.4 Optimistic send: render immediately with the client-generated id, reconcile against the
  server row on arrival, and on failure mark it failed with a retry — never leave it looking sent.
  The retry reuses the id, and `23505` on that id is **success**.
- [ ] 5.5 **Verify a blocked rider receives nothing, against the real project, with two
  sessions.** This is the one requirement in this change that `npm test` cannot close: the RLS
  suite runs on plain Postgres with no Realtime server. Read `scripts/supabase-relay.mjs`'s
  header first — Chromium in this container cannot reach Supabase directly.
- [ ] 5.6 Verify a non-crew rider subscribing to the channel by name receives nothing. The name
  is derivable and is not a secret; the policy is the control, and this is the assertion that
  says so.
- [ ] 5.7 Verify the subscription fires at all before believing any of the above — a channel that
  reports `SUBSCRIBED` against an unpublished table is silent in exactly the same way a correctly
  filtered one is.

## 6. Documentation this change found wrong

Each is a claim that reads as verified and is not. Fix them in the same PR, per the
documentation-claims audit `reviewer` runs.

- [ ] 6.1 `CLAUDE.md` §Supabase Rules: *"Applied state: `001`–`032`, all of them"* — it is
  `001`–`033`; `033_restore_function_comments` is applied. Measured 2026-08-07. This is the exact
  line that file warns has been wrong in both directions.
- [ ] 6.2 `CLAUDE.md` §Schema gains the `ride_messages` row, and the `enforce_participation_gate`
  narrowing note ("eight tables") becomes nine in **both** places it appears — §Writes go through
  `src/lib/actions/` and the standing spec. Two copies, and the one that drifts is the one nobody
  reads.
- [ ] 6.3 `CLAUDE.md` §Product Scope, Rides row: *"Chat needs the Inbox epic"* — it does not, and
  did not; per-ride chat is its own epic with its own tables. `.claude/agents/realtime.md` says
  the same and should say what actually blocks what.
- [ ] 6.4 `docs/FIGMA-FIDELITY-TODO.md` §Ride detail: *"Chat is drawn and not built … No tables
  at all — this is the Inbox epic"* — becomes built, minus Pin/Mute, the unread dot, and the
  day separator and placeholder that Q8/Q9 answer.
- [ ] 6.5 `RideHeader`'s doc comment (4.7) and `RidePageMenu`'s — the latter is **correct** and
  should stay: chat is a header button, not a menu row.
- [ ] 6.6 `openspec/changes/enforce-creator-membership/` names `029_creator_membership.sql` and
  `030_club_member_owner_arm.sql`; both numbers were taken on 2026-08-06. Not this change's to
  fix, but flag it in the PR body — it is the same class of error as 6.1 and it will cost
  somebody an hour.

## 7. Coordination before archiving

- [ ] 7.1 **Two of this change's MODIFIED requirements are also modified by
  `add-account-deletion`** — `Stale data SHALL be bounded and visible` and `Onboarding completion
  SHALL gate participation, not only navigation`. Archiving replaces a requirement wholesale, so
  whichever goes second discards the first one's edit. Re-read each standing spec as the first
  change left it and rewrite the delta against **that** text. The merged text is at the top of
  each delta file.
- [ ] 7.2 `add-account-deletion`'s `account-erasure-cascade` says *"eleven tables"* and needs a
  twelfth plus a chat scenario. This change writes **no delta against it** — that capability is
  not standing yet — so the fold-in is a task on whichever of the two archives second.
- [ ] 7.3 Confirm `enforce-creator-membership` and this change are compatible in the direction
  `design.md` §D2 states: it makes the organizer arm redundant and never wrong, and this change
  does not depend on it in either direction.

## 8. Linear

- [ ] 8.1 Move **PD-115** to `Development (AI)` on pickup, not at the end — it is the concurrency
  lock and the only signal that says which story is being worked right now.
- [ ] 8.2 The sub-issues point at this proposal and do not restate it: **PD-116** schema/RLS
  (groups 1–3), **PD-117** screen (group 4), **PD-119** realtime (group 5). **PD-120** (unread)
  and **PD-121** (pin/mute) stay out of this change and their bodies should say which requirement
  here scopes them out, so neither gets built by accident.
- [ ] 8.3 Q1, Q2 and Q5 are blocking and are the product owner's or the designer's. If they are
  unanswered when the build reaches them, move to `Needs help` with a comment naming the
  question — that is strictly better than guessing and merging.

## 9. Review and merge

- [ ] 9.1 Run `reviewer` **on this proposal, before any code** — the first of its two passes, and
  the cheaper one. `openspec/` is in the CI denylist, so a proposal-only PR runs zero jobs and
  this is the only gate a proposal gets. Point it at `design.md` §D1: the three-conjunct
  composition is the claim most worth a second pair of eyes, because the wrong version passes
  every positive test.
- [ ] 9.2 Run `reviewer` again before the code PR, including the RLS and data-exposure audit.
- [ ] 9.3 Branch off `development` and open the PR against `development`, never `main`.
- [ ] 9.4 Drive it to merged. Committed and pushed is not shipped.
