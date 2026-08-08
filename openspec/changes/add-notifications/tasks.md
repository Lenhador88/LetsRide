# Tasks

Grouped so each squad agent picks up its own section: **§1–§3 `data`**, **§4 `design-system`**,
**§5–§6 `feature`**, **§7 `test`**, **§8** the wrap-up. `reviewer` runs on this proposal before
§1 starts, and again before the PR.

**Read `design.md` §Migration Plan before starting §3.** `036` is additive in schema and **not
inert**: six triggers hang off five shipped write paths, so DEV comes first and PROD comes last —
the opposite of `034`. That ordering is the single most important thing in this file.

**Open questions with defaults are in `design.md` §Open Questions.** Q1 and **Q2b** are blocking for
the *answer* and non-blocking for the *build*; each has a stated default and the build proceeds on
it. **Q6 is settled** — the retention window is *as long as the subject exists* and carries no
number. Q1, Q2b, Q3, Q4 and Q7 are the **product owner's alone**; do not settle them in a session.

## 1. Schema — write `036_notifications.sql`

- [ ] 1.1 Re-derive the migration number rather than trusting the proposal: `list_migrations`
      against `ls supabase/migrations/` on **both** databases. Proceed only if both read 35 rows
      ending `035_comment_whitespace_floor`; if not, stop and reconcile first.
- [ ] 1.1b **Also check the sibling proposals, which no database query can see.**
      `grep -rn "0[0-9][0-9]_[a-z_]*\.sql" openspec/changes/*/` across the unarchived changes.
      `enforce-creator-membership` needs **two** files and names `029`/`030`, both taken on
      2026-08-06, so it re-derives into `036`/`037` the moment anyone picks it up. Numbering is
      first-come; if it got there first, renumber **before** writing SQL — filename order equals
      apply order.
- [ ] 1.2 Create `public.notifications`: `id uuid pk`, `user_id uuid not null references
      profiles(id) on delete cascade`, `actor_id uuid not null references profiles(id) on delete
      cascade`, `type text not null`, `created_at timestamptz not null default now()`,
      `read_at timestamptz null`.
- [ ] 1.3 Add the four typed nullable subject columns, each with its own `on delete cascade`:
      `postcard_id → postcards`, `comment_id → postcard_comments`, `ride_id → rides`,
      `club_id → clubs`. Per `design.md` §D1 — **not** a polymorphic `subject_id`; a polymorphic
      column can carry no FK, so the cascade requirement would be unsatisfiable.
- [ ] 1.4 Add the `type` CHECK enumerating the five types, and a second CHECK naming exactly which
      subject columns are non-NULL for each. Add a column comment on `club_id` recording that it is
      *context* for `ride_created_in_club`, not only a subject.
- [ ] 1.5 Add the unique index over `(user_id, type, actor_id, postcard_id, comment_id, ride_id,
      club_id)` **`NULLS NOT DISTINCT`**. Carry `015`'s reason in a comment: a plain UNIQUE treats
      two NULLs as different, so it would never fire and a like/unlike loop would stack rows.
- [ ] 1.6 Add the index on `(user_id, created_at desc)` that serves both the list and the count.
- [ ] 1.6b **Index every cascade path — six FK columns, six usable indexes.** A plain index on
      `actor_id` (it sits **third** in the uniqueness index, so it cannot lead a lookup), and a
      **partial** index on each of `postcard_id`, `comment_id`, `ride_id`, `club_id`, each
      `where <column> is not null` so a row enters only the subject index it uses.
      `add-account-deletion` requires this for the two `profiles` keys — *"WHEN a future migration
      adds a table referencing `profiles` THEN it SHALL add the index in the same file"* — and `036`
      is the first table it applies to. The four subject keys are this change's own decision, taken
      for the same reason one level down. `design.md` §D11.
- [ ] 1.6c Add no index for a **read query no screen issues**. That prohibition lives in
      `event-fanout-integrity` and, as first drafted, forbade 1.6b; both specs now name each other.
      A cascade is a delete path with a requirement behind it, not a speculative query.
- [ ] 1.7 Enable RLS. Grant `authenticated` **SELECT only** at table level, plus a **column-level
      UPDATE grant on `read_at` alone**. No INSERT grant, no DELETE grant, no `anon` grant of any
      kind. Record in the header that the absent INSERT grant — not the absent policy — is what
      makes the trigger the only writer.
- [ ] 1.8 Write the SELECT policy from `design.md` §D2: `user_id = auth.uid()` AND
      `not private.is_blocked(auth.uid(), actor_id)` AND an `EXISTS` against `profiles` for
      `actor_id` AND, per `type`, an `EXISTS` **for every resource the copy renders** — all
      conjoined, all under the caller's own RLS. Add a policy comment saying why the resolvability
      conjuncts cannot be removed as redundant with the fan-out check.
- [ ] 1.8b The conjunct set is per type and is **not** one table per type. `postcard_commented`
      takes `postcards` **AND** `postcard_comments`; `ride_created_in_club` takes `rides` **AND**
      `clubs`, because it renders the club's name and opens the ride. Do **not** collapse the last
      one on the grounds that ride-visibility implies club-visibility — it holds against today's
      `rides` policy, which `017` and `022` have already rewritten twice, and nothing constrains it
      to keep holding.
- [ ] 1.8c The `profiles` conjunct is on **every** type and is not redundant with the block
      conjunct: a rider can null their own `username` in one request, which drops them out of
      `profiles` SELECT with no block anywhere. Without it the row is counted and cannot be drawn.
- [ ] 1.9 Write the UPDATE policy with a predicate **identical to SELECT's** — recipient, block and
      every resolvability conjunct — in both `using` and `with check`. A wider UPDATE lets
      `mark all read` touch rows SELECT hides, and the affected-row count is then a channel that
      discloses a block. Record why, including that the draft's opposite choice bought nothing: an
      evicted row is in neither the count nor the list. Write **no** INSERT policy and **no** DELETE
      policy.
- [ ] 1.10 Record in the header that `notifications` deliberately does **not** carry
      `enforce_participation_gate`, and why: no client can insert, and the gate's
      `WHEN (CURRENT_USER = 'authenticated')` clause is false inside a `security definer` writer, so
      it would never fire and would read as coverage.

## 2. Fan-out — the five triggers, in the same migration

- [ ] 2.1 Write the five `private` fan-out functions: `SECURITY DEFINER`, `SET search_path = ''`,
      every reference schema-qualified, `EXECUTE` revoked from `public`, `anon`, `authenticated`.
- [ ] 2.2 In every function, take the actor from `NEW` — `postcard_likes.user_id`,
      `postcard_comments.author_id`, `ride_members.user_id`, `rides.organizer_id`,
      `club_members.user_id`. **`auth.uid()` must appear nowhere.** `design.md` §D4 has the reason:
      it is NULL with no JWT, so a `<> auth.uid()` suppression filters out *every* recipient and the
      fan-out writes nothing in exactly the environment the suite runs in.
- [ ] 2.3 In every function, exclude the actor from the recipient set — after the union, not inside
      one arm of it. Without this, every club creation notifies its own creator.
- [ ] 2.4 In every function, exclude candidates where `private.is_blocked(actor, candidate)`. Use
      **only** `is_blocked(a, b)` and `is_club_public(club)`; `private.is_club_member` and
      `private.is_ride_crew` read `auth.uid()` internally and must not be used — they answer for the
      caller, so the set becomes everybody or nobody and passes a one-member test.
- [ ] 2.5 `ride_created_in_club` — `AFTER INSERT ON rides`, fires only when `NEW.club_id` is not
      null. Recipients: `club_members` for that club, minus the actor — **`club_members` alone, NOT
      unioned with `clubs.owner_id`**. One `INSERT … SELECT`, not a loop.
- [ ] 2.5b Record the reason at the site, because the omission looks like the bug it prevents:
      `rides` SELECT's only club arm is `private.is_club_member(club_id)`, whose body queries
      `club_members` with **no owner arm** — so a row written to an ownerless owner is one the
      SELECT policy drops on every read, for ever. `club_joined` keeps the union because `clubs`
      SELECT *does* carry `owner_id = auth.uid()`. What differs is the subject's policy, not the
      club. `design.md` §D4.
- [ ] 2.5c Record that this is a **consequence of a pre-existing defect** and not a decision that
      owners do not want the notification: an ownerless owner cannot see their own private club's
      rides today, and `rides` INSERT refuses them a ride in their own club.
      `enforce-creator-membership` closes it from the other end and the two sets then coincide;
      **neither change is sequenced on the other**.
- [ ] 2.6 `ride_joined` — `AFTER INSERT ON ride_members`. Recipient: `rides.organizer_id` only, per
      Q1's default. Nothing on UPDATE, so a `going`↔`maybe` change notifies nobody.
- [ ] 2.7 `postcard_liked` — `AFTER INSERT ON postcard_likes`. Recipient: `postcards.author_id`.
- [ ] 2.8 `postcard_unliked` — `AFTER DELETE ON postcard_likes`, deleting **exactly** the row the
      matching insert would have written: scoped by `user_id` **AND** `type` **AND** `actor_id`
      **AND** `postcard_id`, all four. The four-column predicate is a prefix of the uniqueness
      index, so it costs nothing.
- [ ] 2.8b **Never scope it by `type + postcard_id` alone.** Without `actor_id`, rider A's unlike
      deletes rider B's notification for the same postcard — a write one rider can aim at another
      rider's row, in the one table whose entire premise is that no rider can write to it. A holds
      no grant; the trigger does, and it is running on A's delete. Reachable with one tap by anyone
      who can see the postcard.
- [ ] 2.8c Record that this trigger also fires on **cascaded** deletes — a postcard being deleted,
      or an account deletion reaching `postcard_likes.user_id` — once per row, inside the deletion's
      transaction. Harmless, because `notifications.postcard_id` and `.actor_id` cascade the same
      rows anyway, and bounded because the delete is an index-prefix match. Do **not** add a
      `pg_trigger_depth()` or `TG_OP` guard to skip it: a guard that skips the cascade case is one
      refactor from skipping the rider case.
- [ ] 2.9 `postcard_commented` — `AFTER INSERT ON postcard_comments`. Recipient:
      `postcards.author_id`. Subject is `comment_id`, so two comments produce two rows.
- [ ] 2.10 `club_joined` — `AFTER INSERT ON club_members`. Recipients: `clubs.owner_id` ∪ members
      with `role in ('owner','admin')`, minus the actor. Ordinary members are **not** notified.
- [ ] 2.11 Every fan-out uses `on conflict do nothing`, never an `exception when others` handler —
      the one expected collision is absorbed without a handler that would also hide a real fault.
- [ ] 2.12 Attach all six triggers with **no `WHEN (CURRENT_USER = …)` clause**, and record at each
      site that the omission is deliberate. `023`'s clause is correct on the participation gate and
      wrong here; an absent guard is otherwise indistinguishable from a forgotten one.
- [ ] 2.13 Write `public.unread_notification_count()` — **`security invoker`**, `stable`,
      `set search_path = ''`, capped by a `limit` subquery in `club_unread_counts()`'s shape.
      `security definer` here is the badge-that-never-clears bug; record that in a comment.
- [ ] 2.14 Write the migration header: what it adds, the five write paths it now runs inside, the
      DEV-then-PROD ordering and why it is the opposite of `034`, and a §Verification footer
      predicting every number §3 will check.

## 3. Apply — DEV first, then PROD

- [ ] 3.1 Apply `036` to **DEV** (`fpmrimzxadewsaiwpsel`).
- [ ] 3.2 Exercise all five write paths against DEV: like, comment, RSVP, create a ride in a club,
      join a club. Each must still succeed, and each must write the expected rows. **A raising
      trigger takes the rider's write down with it** — this step is the whole reason for the split.
- [ ] 3.3 Verify against DEV: RLS on; `authenticated` holds SELECT and a `read_at`-only UPDATE and
      nothing else; `anon` holds zero grants; six triggers present, none with a `WHEN` clause;
      `prosecdef` **false** on `unread_notification_count`; `indnullsnotdistinct` **true** on the
      unique index.
- [ ] 3.4 Run the RLS suite green including §7's new assertions, and record the new assertion count
      with the command that derives it.
- [ ] 3.5 Apply `036` to **PROD** (`zwprydcyryvudhurbnye`) only after §5 and §6 are merged to
      `development` and the Preview deploy is confirmed. Re-exercise the five write paths.
- [ ] 3.6 Check the security advisors on both: expect **eight**, unchanged. A new
      `authenticated_security_definer_function_executable` means a function landed in `public` or a
      `revoke` did not — treat it as a failed apply, not a finding to file.
- [ ] 3.7 Update `CLAUDE.md` §Supabase Rules' applied-state line and `docs/HANDOFF.md`, each with
      the command that verifies it rather than a typed number.

## 4. Design system — the row, the icon and the badge

- [ ] 4.1 Read the frame rather than inferring it: `npm run figma -- tree "Inbox - Notifications"`
      and `npm run figma -- text "Inbox - Notifications"`. Add `--all` if any variant slot looks
      missing.
- [ ] 4.2 Build the notification row as a **new component**, not a `ListUser` prop. `ListUser` is a
      48px single-line row; this is 72px with a two-line text block (name + relative stamp on line
      one, copy on line two) and an optional trailing 56×56 thumbnail.
- [ ] 4.2b Render its text from the **measured tokens**, not from a nearby component: actor username
      `Poppins/16/Semibold` (16/24 w600); relative stamp `Poppins/14/Regular` (14/20 w400); the copy
      `Poppins/14/Regular`. Measured 2026-08-07 via `npm run figma -- text "Inbox - Notifications"`.
      The name is a step heavier *and* larger than the copy beneath it; a single-token row loses
      that.
- [ ] 4.3 Build the unread dot from `v2 / Component / Notification` — 16×16, `Warning/100` on
      `Grey/5`. It has no text child: it is a dot, not a count badge. **Contrast is already computed
      and passes — 4.22:1 against the 3:1 non-text bar.** Do not re-derive it, and do not apply the
      4.5:1 text bar to a component with no text.
- [ ] 4.4 Implement the `Header` decision taken in `design.md` §D9 — **a second named slot** for the
      x302 control, alongside the existing `action` at x342. This is an architecture decision
      already made, not one to resolve here: `Header` is a primitive every screen renders, `action`
      already has two call sites (`/profile`'s `<ProfileMenu />` and `RideHeader`), and it is the
      only code this change touches outside the notifications directories. The rejected alternative
      — `action` accepting a fragment — and its three reasons are in §D9; do not re-open it.
- [ ] 4.4b Section titles use the existing `SectionHeader` unchanged: its `text-xl font-semibold` is
      `Poppins/20/Semibold`, checked in its source rather than assumed. Build no new section
      component.
- [ ] 4.5 Use `MailboxIcon` from `@/components/icons/generated`. Settled by the product owner — do
      not substitute a bell; there is none in the 53-icon set.
- [ ] 4.6 Add the section header treatment for Today / Yesterday / This week / All time using the
      existing `SectionHeader`, and a loading skeleton for the list shape.
- [ ] 4.7 Log anything inferred rather than measured in `docs/FIGMA-FIDELITY-TODO.md`.

## 5. Read and write path

- [ ] 5.1 Add `NotificationRow` and its `type` union to `src/types/index.ts`. No `title`,
      `clubName`, `actorUsername` or any other snapshot field on the row itself.
- [ ] 5.2 Add `src/lib/data/notifications.ts`: a paginated list read embedding the actor profile and
      the subject, keyset-ordered on `(created_at desc, id desc)`, and a wrapper on
      `unread_notification_count()`. Reads go here and nowhere else.
- [ ] 5.3 Add `src/lib/actions/notifications.ts` with `markNotificationsRead()`, invalidating
      `keys.notifications.all()`.
- [ ] 5.4 Add the `notifications` group to `src/lib/query/keys.ts` — `all`, `list`, `unread` — with
      `list` and `unread` under the shared prefix **so no invalidation can reach one without the
      other**. Add the row to the file's header table and record the count-and-list reason.
- [ ] 5.5 Add the day-section helper to `src/lib/utils.ts`, named for the screen it serves, resolving
      boundaries in `APP_TIME_ZONE`. Reuse `formatRelativeTime` for the per-row stamp — it needs no
      zone.

## 6. Screen and header control

- [ ] 6.1 Build `/notifications` as a client page: sectioned list, keyset pagination, gated on its
      data and never on `isLoading`.
- [ ] 6.2 Implement the seven states from `specs/notifications`. **The three kinds of zero rows
      collapse to one empty state deliberately** — record that at the site, because it is the one
      place in the app where permission-denied and empty are not told apart, and the reason is that
      distinguishing them discloses a block.
- [ ] 6.3 A failed count renders **no dot**, never a stale one. A dot the rider cannot clear by
      visiting the screen is worse than a missing one.
- [ ] 6.4 Marking read offline refuses with a message and is **not** queued; rows are not
      optimistically shown as read and then silently reverted.
- [ ] 6.5 Add the header control to the four tab-root screens — `/postcards`, `/rides`, `/clubs`,
      `/profile` — and to **no** detail screen.
- [ ] 6.6 Tapping a row navigates to its subject; a subject deleted since the list loaded renders
      not-found rather than an error.
- [ ] 6.7 **Filter nothing.** No component, data function or action drops a row for visibility — not
      for a block, not for an unresolvable subject, and **not for an unresolvable actor**. The
      SELECT policy's `profiles` conjunct (1.8c) is what removes those rows, so the count and the
      list agree by construction.
- [ ] 6.7b An earlier revision of this task said *"render nothing for a row whose actor does not
      resolve"*. That is simultaneously a nonzero count over a shorter list and a component-level
      visibility filter — both forbidden by this change's own `client-cache-invalidation` delta —
      and it rested on the actor being unresolvable only through a block. It is not: any rider can
      null their own `username` in one request. If a row with an unresolvable actor ever reaches the
      screen, the repair is the missing conjunct in the policy, never a branch in the renderer.

## 7. Tests

- [ ] 7.1 Add the RLS assertions to `supabase/tests/rls_test.sql`. Per `openspec/config.yaml`, a
      policy change with no new assertion is not finished.
- [ ] 7.2 **Grant assertions name the role**, never attempt a statement:
      `has_table_privilege('authenticated', 'public.notifications', 'INSERT')` is false;
      `has_function_privilege` is false for each fan-out function. The suite runs as the **table
      owner**, for whom neither the grant nor RLS applies, so an attempted insert would succeed and
      prove nothing. This is `031`'s lesson and the exact shape of the bug `029` shipped.
- [ ] 7.3 Assert the recipient scoping: the recipient reads their rows; the actor reads zero; a
      third rider reads zero; the postcard author cannot enumerate who was notified.
- [ ] 7.4 Assert self-suppression for all five types, **including** that a club creation notifies
      nobody and an organizer RSVPing to their own ride notifies nobody.
- [ ] 7.5 Assert blocking **twice**: a block before the action writes no row, and a block created
      after the row hides it — each with A and B exchanged, because the row is directional and the
      effect symmetric.
- [ ] 7.6 Assert the resolvability conjunct in isolation: leaving a **private** club evicts the row,
      leaving a **public** club does not. Two separate assertions — one cannot say which arm did the
      work.
- [ ] 7.7 Assert every cascade, including the two-level one (an organizer's deletion removes rides
      and therefore other riders' notifications) and the `club_id` asymmetry (deleting a club takes
      the notification while `rides.club_id` SET NULL leaves the ride).
- [ ] 7.8 Assert uniqueness: like, unlike, like again → exactly **1** row. This is the assertion
      that catches a unique index written without `NULLS NOT DISTINCT`.
- [ ] 7.9 Assert the club fan-out with **two members plus a non-member**. One member cannot
      distinguish a correct recipient set from `private.is_club_member`'s everybody-or-nobody.
- [ ] 7.10 Assert the `admin` arm by inserting the row **as the table owner**, and record why: no
      client can create or promote an admin (`club_members` INSERT admits `member`, or `owner` for
      the club's own `owner_id`, and there is no UPDATE policy at all), and zero admin rows exist.
      Omitting it as untestable is not acceptable — it ships the day invitations do.
- [ ] 7.11 Assert the fan-out fires with **no JWT present**, which is what proves the actor is read
      from `NEW` and not from `auth.uid()`.
- [ ] 7.12 Assert that `unread_notification_count()` returns exactly the number of unread rows the
      list returns, under a block and under an evicted subject.
- [ ] 7.12b **Assert the fan-out set is a subset of the read set, per type.** For each of the five,
      every recipient the fan-out wrote for must be able to **read the row back under their own
      session**. An assertion that only counts rows written cannot see this failure, which is the
      one the draft shipped: the owner union wrote `ride_created_in_club` rows the policy drops for
      ever.
- [ ] 7.12c Assert the `ride_created_in_club` recipient set with a club whose **owner holds no
      `club_members` row** — insert the club, delete the owner's membership row as that owner
      (`club_members` DELETE is a bare `auth.uid() = user_id`), then create a ride as another
      member. Zero rows for the owner, and the assertion records that this matches what `rides`
      SELECT already refuses them.
- [ ] 7.12d Assert `club_joined` in the **same** ownerless state and expect the owner **does** get a
      row and **can read it** — `clubs` SELECT's owner arm. The two assertions together are what
      show the asymmetry is deliberate; either alone reads as an inconsistency.
- [ ] 7.12e Assert the two-conjunct case for `ride_created_in_club`: a **public** club, a ride with
      `is_public` false, a recipient who has left the club. The club resolves, the ride does not,
      and the row must not be returned. This is the leak a one-table-per-type conjunct would open.
- [ ] 7.12f Assert the actor conjunct with **no block involved**: set the actor's `username` to NULL
      as that rider, and the recipient's list and count must both fall by one. Restore it and both
      must come back, with the original `created_at` and read state — eviction, not deletion.
- [ ] 7.12g Assert the retraction scoping with **two** actors: A and B both like the same postcard,
      A unlikes, B's notification survives. A one-actor assertion cannot fail and does not cover it.
- [ ] 7.12h Assert `mark all read` affects exactly `unread_notification_count()` rows, measured
      immediately before, while the rider holds evicted unread rows. Compare the two numbers — do
      **not** inspect the table as the owner, for whom the policy does not apply.
- [ ] 7.12i Assert the hide case explicitly: an author who hides their own postcard still reads
      every `postcard_liked` and `postcard_commented` row about it. This is the assertion an earlier
      scenario title got backwards, and a suite written from that title cannot pass.
- [ ] 7.12j Assert `rides.is_public` flipped to false directly by the organizer: a recipient still
      in the club keeps the row, one who has left loses it. Separate from the club-turned-private
      case, which reaches the same outcome by a different column on a different table.
- [ ] 7.12k Assert that leaving a club or a ride retracts **nothing** — the `club_joined` and
      `ride_joined` rows survive the actor's departure. The absence of a retraction is a decision
      and needs an assertion, or it is indistinguishable from a forgotten trigger.
- [ ] 7.12l Assert the six FK indexes exist and lead with their column, by querying `pg_index`
      rather than by reading 1.6b's list — the derivation `add-account-deletion` requires.
- [ ] 7.13 Unit tests for the day-section helper, including the `APP_TIME_ZONE` boundary and the two
      DST days — asserting offsets rather than strings, since `TZ=UTC` in `vitest.config.ts` lets a
      naive implementation pass.
- [ ] 7.14 Extend `keys.test.ts` so `list` and `unread` cannot be invalidated independently.

## 8. Wrap-up

- [ ] 8.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`,
      `PGPASSWORD=postgres npm test` — capture each exit code from the command itself, never from
      the end of a pipe.
- [ ] 8.2 Run `npm run walk` against DEV through the relay, and add the notifications route to it.
- [ ] 8.3 Run `reviewer` on the branch before the PR. Non-negotiable.
- [ ] 8.4 PR to **`development`**, not `main`. Drive it to merged in the same session.
- [ ] 8.5 Update `CLAUDE.md` §Product Scope's Inbox row — notifications now exist without the tab —
      and `docs/HANDOFF.md`, each claim beside the command that verifies it.
- [ ] 8.6 Move **PD-118** to `Done`, and file the open questions the owner still has to answer as
      their own issues labelled `Owner only` — **Q1, Q2b, Q3, Q4 and Q7**. Q2 is `data`/`feature`'s,
      Q5 is `design-system`'s, and Q6 is settled and needs no issue.
- [ ] 8.6b File the **three pre-existing defects** this change found and did not fix, each with the
      measurement that proves it, per `proposal.md` §Known gaps:
      (a) `private.is_club_member` has no owner arm, so an ownerless owner cannot see or create
      rides in their own private club. `enforce-creator-membership` already names the general form —
      *"a non-member for every purpose the schema recognises"* — but enumerates only the write
      consequences (`017` refuses the ride, `009` the postcard, `getYourClubs` omits the club); add
      **ride visibility** to that list, since it is the one this change tripped over;
      (b) any rider can null their own `username` and vanish from `profiles` SELECT, because the
      column grant is live, the CHECK admits NULL and `enforce_onboarding_completion` returns early;
      (c) `club_members` DELETE has no owner carve-out, which is the one-request route to (a).
- [ ] 8.6c File the retention sweep as a follow-up, to land with the first scheduled job this
      project acquires. **It carries no number** — the window this change states is *as long as the
      subject exists*.
- [ ] 8.7 Before archiving this change, re-read `openspec/specs/client-cache-invalidation/spec.md`
      and `openspec/specs/database-enforced-integrity/spec.md` **as the previous archive left them**
      and rewrite both deltas against that text. Archiving replaces a requirement wholesale and
      OpenSpec will not warn you. **Both contested requirements are contested by the same
      requirement in another change, not by a sibling:**
      `Onboarding completion SHALL gate participation` has **three** claimants
      (`add-account-deletion`, `add-ride-chat`, this one) and is the **only** requirement in the
      repo with three; `Counts SHALL stay per-viewer` has **two** — `add-account-deletion` carries a
      `## MODIFIED` block against it directly. Re-derive with
      `grep -rn "^### Requirement: <text>" openspec/`, discarding `changes/archive/`, which is where
      these requirements came from and is already folded into `openspec/specs/`.
