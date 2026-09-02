# Tasks — An Introduction Appears Only As Its Announcement

**No migration.** `097` already grants `authenticated` SELECT on `introduces_user_id` and
`introduction`, and this change adds no policy, no grant, no function and no table.
`openspec/config.yaml`'s rule pairing a migration with new assertions in
`supabase/tests/rls_test.sql` is therefore satisfied by there being no migration — **not** by
skipping assertions for one. If an implementer concludes a migration is required, **stop and say so**
rather than writing `101`: it would mean the rule above is wrong and the proposal needs re-reading.

**The whole change is a presentation filter over rows the policies already returned.** The only
predicate any diff here may add is `introduces_user_id is null`. A membership, block or club-privacy
term appearing anywhere in this diff is a review failure, not a detail.

## 0. Pre-flight

- [ ] 0.1 Read `proposal.md` §The rule and `design.md` §D1 before writing any filter. The arm chosen
      there is the one thing in this change that cannot be re-derived from the code.
- [ ] 0.2 Confirm the grants are still what the proposal measured, against
      `letsride-dev` (`fpmrimzxadewsaiwpsel`):
      `select privilege_type, column_name from information_schema.column_privileges where
      table_schema='public' and table_name='club_threads' and grantee='authenticated';`
      SELECT on `introduces_user_id` and `introduction`; **no** INSERT and **no** UPDATE on either.
- [ ] 0.3 Confirm nothing has been added to the repo that writes `club_thread_waves` since the
      proposal was written:
      `git grep -ln "club_thread_waves\|waveThread\|unwaveThread\|threadWaves" -- src/`.
      **Read the result, do not count it.** At the base this returns six files and they are NOT the
      five §The wave names: `ClubTimelineThreadRow.tsx` is absent (it takes a `wave` prop and
      imports `ClubWaveButton`, and none of those four literals appear in it), while
      `src/types/index.ts` and `src/lib/data/club-threads.ts` are present holding only true,
      surviving comments about a table this change does not drop. Two counts agreeing at six is
      exactly the coincidence `CLAUDE.md`'s comment trap warns about. What the grep is for is
      **new writers**: an `upsert`, `insert` or `delete` against `club_thread_waves` outside
      `lib/actions/club-waves.ts` is new scope; a comment is not.

## 1. The rule, expressed once

- [ ] 1.1 In `src/lib/data/club-threads.ts`, add one named, documented definition of the announcement
      rule — *a thread is an announcement while `introduces_user_id` is non-null* — and a short
      header saying it is a **presentation** rule over rows `081` already returned, not a visibility
      rule. Every read below applies it through that name.
- [ ] 1.2 Note in that header that the two call sites spell different column paths
      (`introduces_user_id` on the base table, `thread.introduces_user_id` through the reply read's
      embed), so what is shared is the name and the reason rather than a literal string.

## 2. The three reads

- [ ] 2.1 `getClubThreads` — apply the rule **in the query**, beside `.eq('club_id', …)`. Not after
      the read: `design.md` §D2 has the two things that break silently (the list's "is there more"
      signal, and `boundedHorizon`'s stated precondition that the rows ARE the window).
- [ ] 2.2 Extend `getClubThreads`' "What is deliberately NOT here" block with one paragraph: the
      filter is presentation, `081` is still what decides the audience, and a non-member of a public
      club gets `[]` from the policy with or without it.
- [ ] 2.3 `getClubThreadReplies` — add `introduces_user_id` to the `club_threads` embed's select list
      and filter `.is('thread.introduces_user_id', null)` beside the existing
      `.eq('thread.club_id', clubId)`. The embed is already `!inner`; this is the same mechanism that
      already scopes the window to one club, not a new one.
- [ ] 2.4 **Do not change `collapseToNewestPerThread`.** It never sees an announcement row after 2.3,
      so the pure function whose whole reason for existing is that it can be wrong invisibly keeps
      its contract and its tests. State in `getClubThreadReplies`' header that the window is now
      "recent messages on **listed** threads", and that `horizon` and `partial` are still measured on
      that window **before** the collapse.
- [ ] 2.5 Re-read the horizon paragraph in `CLUB_TIMELINE_REPLIES`' doc comment and correct it if the
      filter changed anything it asserts. The bound does not move; what the window holds does.

## 3. The unread map — the aggregate dot

- [ ] 3.1 `getClubThreadUnread` — after the RPC answers, narrow the map to threads the Threads list
      can show. Take the ids marked `has_unread`; **if there are none, return the map unchanged**
      (the `length === 0` early return this codebase already uses twice); otherwise read back which
      of those ids carry a marker and drop them.
- [ ] 3.2 Failure rule, matching the function's existing one: if that read errors, resolve the whole
      map to `{}`. A failed unread call costs the marks and nothing else, and it must never return
      marks it could not verify.
- [ ] 3.3 Document, in that function's header, that the narrowing is bounded by the **unread set**
      rather than by the roster, and why intersecting with page 1 of the Threads list was rejected
      (`design.md` §D3): a list ordered by creation can hold an active thread past its first page.
- [ ] 3.4 **Do not change `ClubOptionsMenu`'s expression.** Its `some(Boolean)` is already correct;
      what changes is its input. Add one line to its comment saying the map now answers for listed
      threads only, so the dot clears by visiting where it points.
- [ ] 3.5 Confirm the other two consumers need nothing: both index by thread id, and after §2 no
      announcement produces a row for them to look up.

## 4. The wave — retire the client path

- [ ] 4.1 `src/lib/actions/club-waves.ts` — delete `waveThread` and `unwaveThread`. Leave `waveJoin`
      and `unwaveJoin` untouched, including their comments.
- [ ] 4.2 `src/lib/data/club-waves.ts` — delete `getThreadWaveState` and the `thread` branch of
      `attachClubWaveState`. Keep `ClubWaveState`, `resolveClubWaveState` and the join path. Trim the
      file header's thread-embed paragraph to what still describes live code, and keep the join
      branch's inferred-not-measured note as it is.
- [ ] 4.3 `src/lib/query/keys.ts` — delete `queryKeys.clubs.threadWaves` and its docstring, and drop
      `waveThread`/`unwaveThread` from the `notifications.list()` claim table row that names them.
      `sendClubMessage` stays in that row.
- [ ] 4.4 `src/components/clubs/ClubTimeline.tsx` — delete the `threadWaves` query, the
      `waveThread`/`unwaveThread` imports and the `wave` prop on the thread-creation branch. The
      `reply` branch already passes none. Keep the join branch, `joinWaves`, `resolveClubWaveState`
      and `attachClubWaveState` exactly as they are.
- [ ] 4.5 `src/components/clubs/ClubTimelineThreadRow.tsx` — delete the `wave` prop, its render, its
      `ClubWaveButton` import and its `ClubWaveState` type import. **Keep `id={anchorKey}` on the
      outermost element** — that is PD-366's scroll anchor and its loss is invisible to every gate but
      the walk. Replace the `## wave` section of the file header with one sentence saying the club
      timeline's only waveable row is the announcement row, and why.
- [ ] 4.6 The wrapper element exists because a button may not nest inside an anchor. With the button
      gone it MAY be simplified, provided the anchor id and the tap target survive. **Default: keep
      the wrapper and drop only the `pr-2` it carried for the button**, so the row's padding is
      symmetric again — that is the one deliberate visual change in this task and it should be stated
      in the PR body rather than discovered in review.
- [ ] 4.7 `ClubWaveButton` stays. Do not touch `PostcardCard`'s `LikeButton`: different table,
      different object, explicitly out of scope.

## 5. Verify against DEV — including the arm no fixture covers

- [ ] 5.1 Re-run the proposal's census and record it in the PR body:
      threads total, introductions, ex-member introductions, thread waves, comments on introductions,
      `club_thread_waved` notifications.
- [ ] 5.2 **The ex-member arm has no rows on DEV** (0 of 3 introductions are detached). Exercise it by
      hand, in a **rolled-back** transaction, as `authenticated`: delete a `club_members` row whose
      rider holds an introduction, confirm the marker goes NULL and the text and comments survive, and
      confirm the thread is then returned by the same query `getClubThreads` issues. Roll back.
- [ ] 5.3 In the same rolled-back shape, confirm the reply-window filter returns no message belonging
      to a marked thread, and that it does return messages of an ex-member's introduction.
- [ ] 5.4 Confirm a non-member of a **public** club still reads zero threads and zero messages with
      the filter present — the filter must be irrelevant to that outcome, not the cause of it.

## 6. Tests

- [ ] 6.1 `src/components/clubs/__tests__/ClubTimelineThreadRow.test.tsx` — assert **no wave control
      renders**, on both the creation-shaped and reply-shaped row. **Verify it both ways**: an absence
      is invisible to a test that only checks what rendered, so re-add a control locally and watch the
      new assertion fail before keeping it. This is the same both-ways discipline the file's existing
      `+` assertions already carry.
- [ ] 6.2 Same file — confirm the existing floor-mark assertions still pass in **both** directions
      (`12+` on a `partial` row, `12` with no mark on a row that is not). They must not be disturbed.
- [ ] 6.3 `src/components/clubs/__tests__/ClubTimelineEventRow.test.tsx` — unchanged, and it must stay
      green: it is what pins the join row keeping its wave, its self-row absence, and its introduction
      door.
- [ ] 6.4 `src/lib/data/__tests__/club-timeline.test.ts` — re-run and extend only if the collapse's
      contract moved. It should not have (§2.4). If a test there asserted an announcement's activity
      entry, it is now asserting the old behaviour and needs rewriting rather than deleting.
- [ ] 6.5 A new unit test for the unread narrowing, on `postcards.test.ts`' mocked-resolver pattern:
      an announcement's unread is dropped; an ordinary thread's survives; **no second read is issued
      when nothing is unread**; a failing narrowing read resolves the whole map to `{}`.
- [ ] 6.6 A source-level test that all three reads still carry the rule, on
      `embed-hints.test.ts`' pattern — read **comment-stripped** source, because the headers this
      change adds describe the very column the filter names and a naive scan would pass on the prose
      alone. Verify both ways: deleting one filter must fail it.
- [ ] 6.7 `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- [ ] 6.8 `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` **after** staging, not before —
      the pointers in these artifacts are only checked once the files are visible to `git ls-files`.
- [ ] 6.9 `npm run docs:check` — the reference docs edited in §7 carry claims.
- [ ] 6.10 `npm run walk` against DEV, with the relay running (`scripts/supabase-relay.mjs`'s header
      first). The club detail and the Threads list are both on the route list; a shrunken `N/N` is a
      skip, not a pass.
- [ ] 6.11 **`PGPASSWORD=postgres npm test` is not required by this change and must not be modified.**
      Run it if anything under `supabase/` was touched — which would itself mean the change went out
      of scope.

## 7. Documentation

- [ ] 7.1 `docs/reference/schema.md` — on the `club_thread_waves` row, state that the table has no
      writer in the app as of this change, that its policies and both `098` triggers remain live, and
      point at this proposal's §The table with no writer.
- [ ] 7.2 `git grep -n "wave" -- docs/reference/` and correct anything that describes a thread wave as
      something a rider can do. Do not restate the reason in more than one place.
- [ ] 7.3 Do **not** edit `CLAUDE.md` or `docs/HANDOFF.md` — the main thread owns both.

## 8. Explicitly NOT in this change

Each of these is a decision, not an omission. Building any of them here is scope creep:

- [ ] 8.1 Dropping `club_thread_waves`, its `092` policies and grants, or `098`'s
      `notify_club_thread_waved` / `retract_club_thread_waved`. Destructive, needs the RLS suite's
      `092.*`/`098.*`/`100.*` assertions rewritten, and is safe only once this change is serving.
- [ ] 8.2 Removing `club_thread_waved` from `NotificationType` or from either client switch. The type
      is live and rows hold it.
- [ ] 8.3 An unread mark on the announcement row. `proposal.md` §Open questions Q2, default *no*.
- [ ] 8.4 Any change to the thread screen, its composer, its subscription, its moderation or its
      report path.
- [ ] 8.5 Any change to postcard waves.
- [ ] 8.6 A migration, of any kind, for any reason. See the head of this file.
