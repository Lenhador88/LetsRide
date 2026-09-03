# Known issues

> The roadmap is Linear. This holds the issues that are *understood* — mechanism, the sites
> to re-derive, and why each was not folded into the PR that found it. Ordered roughly by cost.

## Known issues, roughly by cost to fix

**CLOSED by PD-338 — the ride strand guard is now about the transition, not the shape.**

`EditRideForm`'s `wouldStrand` used to disable Save whenever a ride was neither public nor in a
club, and PD-320 made exactly that combination the composer's default output — so a rider with no
clubs created rides they could only edit by publishing them to everyone. `narrowsToNobody`
(`src/lib/rides/audience.ts`) replaces it: an edit that *reduces* a ride's standing audience to
its organizer alone is refused, an edit to a ride already in that shape saves.

**Two things about the fix that a later reader will otherwise re-litigate.** The `Narrow` reading
was a **stated assumption rather than an owner answer** — it was taken in an unattended run, and
`openspec/changes/scope-the-strand-guard-to-the-transition/design.md` §Open questions Q1 carries
the `Wide` alternative (drop the guard outright) with the evidence a later decision needs; Wide is
Narrow minus one predicate, so nothing is foreclosed. And the guard is **advisory by design**:
the `rides` UPDATE policy carries no `is_public` predicate at all, which is why the change needed
no migration and why the action's copy of the rule must never be described as enforcement.

```bash
git grep -n "narrowsToNobody" -- src/          # the predicate, and its two call sites
npx vitest run src/lib/rides src/components/rides src/lib/actions/__tests__/ride-audience.test.ts
```

**Private clubs are findable and requestable — and four things about them are decisions rather
than gaps (`085`, PD-325).**

- **A DECLINE is never told out loud, and it cannot be with the schema as it stands.** `036` §3's
  `notifications` SELECT policy conjuncts `club_id is null or exists (select 1 from clubs …)`
  under the READER's own row security, and a declined requester holds no `club_members` row for a
  private club — so a decline notification would be written, never returned and never counted.
  Silently, for ever, looking correct to every reviewer and every test that only checks the row
  was inserted. `085.26` asserts the zero and the migration comments the absence where a reader
  would expect the type, because **this is the single most likely thing for a later session to
  "fix"**. The two obvious fixes are both worse: widening the conjunct makes EVERY
  `club_id`-carrying notification resolve for any non-member holding one, and a subject-less type
  is LOSSY, because `036`'s event key is unique over the four subject columns with
  `NULLS NOT DISTINCT`, so two declines from two clubs by the same admin collapse to one row.
  **What ships instead**: the club stays in the rider's Explore list with no control on the card,
  and the club's reduced screen reads their own request row and says *"You asked to join. The club
  said no."* That is why `private.club_takes_join_requests_for` deliberately has no declined
  conjunct — excluding them would leave the request readable from psql and from nowhere in the
  product. **Whether the rider should be told more loudly than that is the owner's call**, and it
  is the one question this build put to them.
- **"Owner or admin" is owner-only in practice, and every rule here says the wider thing on
  purpose.** `019` makes `club_members.role = 'admin'` insertable and writable by nobody — there
  is no UPDATE policy on that table at all, which is the property `036` §7.6 relies on — and DEV
  carried **zero** admin rows when this was built (re-measure:
  `select count(*) from club_members where role = 'admin'`). So `private.is_club_admin_for`'s
  second arm is empty until **PD-326** ships role promotion, and the club's owner is the only
  rider who can answer anything. The rules are written owner-or-admin so PD-326 inherits them
  rather than having to hunt down `owner_id = auth.uid()`; the RLS suite's admin assertions need
  a fixture row created directly, because no client path can make one.
- **A discoverable private club's avatar draws INITIALS**, and that is correct rather than
  missing. `016`'s two `storage.objects` policies each run their own `EXISTS` against `clubs`
  under the reader's RLS, so a non-member reads neither object, `signImagePaths` answers null and
  `Avatar` falls back. `085.6` pins both zeros so the day a storage arm lands the test names it;
  the one-arm change that would alter it is written out in
  `openspec/changes/show-private-clubs-and-request-to-join/design.md` §The avatar that will not
  sign rather than made. The COVER stays members-only either way — an avatar is the
  club's identity, a cover is its content.
- **The `Requests` section on the club detail is the MINIMUM that makes a request answerable, and
  PD-326 should absorb it rather than build a second one.** Same route, same
  `queryKeys.clubs.joinRequests(clubId)`, same `getClubJoinRequests`. Two things it deliberately
  leaves undone so neither reads as an oversight: **the Clear control on a declined row** — `085`'s
  DELETE policy already admits an admin clearing one, so it is one line of JSX rather than a second
  migration — and **role promotion**, without which the bullet above stands. It gates on
  `viewer_is_owner || viewer_role === 'admin'` and **the first half is not interchangeable with
  `viewer_role === 'owner'`** (PD-280): the two diverge for an owner holding no roster row, which
  `createClub`'s two un-transacted inserts make reachable, and gating on the role alone would have
  hidden the section from the only rider who can act.

**A club's stamps now carry its rides' photos, and two boundaries were deliberately NOT moved
(`086`, PD-328).**

- **`club_unread_counts()` is untouched**, so a ride-sourced stamp moves no badge. The counter is
  `015`'s watermark against `club_id`-scoped rows, and widening it would make a club's dot light
  for a postcard posted app-wide — a rider would open the club and find nothing new there.
- **`getPostcardFilters` is untouched**, so a NULL-`club_id` postcard tagged to a club's ride
  carries no club tile in the feed's filter bar. The tile is built from `club_id`, which IS the
  audience; deriving it from the ride would put a club's name on a postcard whose audience is the
  whole app.
- **Its value on DEV today is zero and that is a fixture fact, not a verdict.** Re-measure before
  concluding anything: `select count(*) from postcards p join rides r on r.id = p.ride_id where
  r.club_id is not null and p.club_id is distinct from r.club_id` — 0 against 12 postcards on DEV,
  which says the test data has no such row rather than that riders will not create them.
  **PD-309** (`A postcard's audience follows its entry point`, unbuilt) would make FUTURE ride
  postcards carry the club as their audience anyway; whichever lands second should re-run that
  query and re-measure how much of the tag arm is still doing work.
**Does `tools:` accept a wildcard? The next session can answer it for free, and this one could
not (PD-154).** Every squad brief now lists each MCP tool twice — the friendly name and the
UUID-prefixed one the same server registers as in other sessions — which is 51 duplicate entries
across 8 briefs. `tools: mcp__Supabase__*` would replace the lot, but it is undocumented for
subagent frontmatter and **untestable from inside a session**: the agent registry loads at session
start, so a probe brief written mid-session is never registered. Measured 2026-08-27 by trying
exactly that, and independently confirmed by a `reviewer` running on the *pre-diff* copy of its
own brief in the same session.

So the cheap experiment is: **write a one-off brief with `tools: ToolSearch, mcp__Supabase__*`,
and have the FOLLOWING session spawn it** and report whether `ToolSearch` surfaces anything. One
subagent, no build. If wildcards resolve, the twins and half of
`src/__tests__/agent-briefs.test.ts`'s new parity case collapse into one entry per connector. If
they do not, the duplication is correct and this line can go.

**Ride invites are in — and three things about them are decisions rather than gaps (`083`,
PD-329).**

- **A PENDING invite can be revoked and re-sent without limit.** `083`'s DELETE policy is scoped to
  `status = 'pending'`, so the anti-spam property the story names holds against a **refusal** and
  not against silence: the retraction trigger clears the notification, so each re-send writes a
  fresh one rather than being absorbed by `036`'s uniqueness index. An unanswering invitee's only
  exits are to decline (terminal for them too) or to block. Bounding it is a product decision — a
  cooldown, a re-send cap, or dropping the retraction so the index absorbs the repeat — and it is
  **PD-332**, in `Needs decision`, with the four options scored, rather than settled by omission.
- **A pending invite does not expire.** Considered and declined: nothing renders one except the two
  riders' own lists, and a sweep needs a schedule this repo does not have. **PD-330 is what reopens
  it** — a link is a *bearer* credential and a bearer credential with no expiry is a different risk
  from a row naming one rider. The expiry decision is owed **there**, not here.
- **`private.join_ride_from_invite` is PD-330's seam.** `accept_ride_invite` is its only caller
  today; a token-bearing claim becomes its second without touching the write. One invite concept,
  one `ride_members` write, two ways of reaching it.

**The rider picker is a sequential scan**, and that is accepted at this size rather than
overlooked. Nothing in the chain serves a username prefix search and Postgres cannot use a b-tree
for `ILIKE` at all, so each keystroke scans `profiles` with a `security definer` block check per
surviving row — bounded by a two-character minimum, a prefix anchor and a 20-row cap. An index
added without changing the query shape would be dead weight that reads as live, which is why `083`
carries none — an earlier draft added one and it came out before merge. Its §The rider picker has no
index has the two real fixes, and **PD-333** carries them with the reason the second must be
`security INVOKER` and never DEFINER.


**Ride times are still `APP_TIME_ZONE`. The fix is decided and unbuilt — PD-193, `Todo AI`
2026-08-19.** `CLAUDE.md` §Technology Decisions calls the pinned zone a documented interim whose
answer is "a zone column on `rides`". The column was picked up, deliberately **not** built, and the
scope as written was wrong twice; the product owner's question — *should the zone not be known while
posting?* — resolved both, and the answer differs per path rather than per screen.

**A picked place: knowable at post time.** The client holds the coordinate at submit, so the zone
goes in the same INSERT as `departure_at` and `wallClockToUtc` resolves against it. No async
correction.

**This half was scoped against a Dutch-only index and PD-273 inverted it.** The reasoning recorded
here until 2026-08-19 was that every pickable place is Dutch — measured with
`select country, count(*) from public.places`, one row, NL 736,538 — so a picked ride could not
reach a foreign zone and the `APP_TIME_ZONE` fallback was already right in practice. `070` dropped
that index and the typeahead now reads a **global** geocoder through `search-places`, so **a rider
can pick a foreign meeting point today**, on DEV now and on PROD at the promotion. The query above
no longer runs on DEV, and re-deriving the same conclusion from PROD's surviving copy would read
the retired index rather than the live search. **"A picked ride never learns a zone" is a real
wrong answer now, not a theoretical one** — which raises this half of PD-193 rather than settling
it. **Do not hardcode Amsterdam for picked rides**; derive it from the coordinate the client
already holds.

**A typed address: NOT knowable at post time, structurally.** The zone comes from the geocode, the
geocode needs the Geoapify key, that key exists only in the function's secret store, and
`requestRideMapRender` is fire-and-forget by requirement — `specs/ride-map-tiles` refuses a vendor
call between Save and the redirect. So it lands after the insert. **It is no longer the only way to
enter a foreign address** — that was true of the Dutch-only index and is not true of the geocoder,
per the paragraph above — so this is one of two paths this story now owes an answer, not the whole
of it: `resolve-ride-location` must write `timezone` **and** shift `departure_at` in
the same statement, or the organizer sees 08:00 for a ride they typed as 09:00, asynchronously,
minutes after Save. The correction fires only when the resolved zone differs from `APP_TIME_ZONE`,
so a Dutch ride is untouched.

Four things to carry into the build. `rides` UPDATE grants are an **absolute** column list
(`044`/`046`), so a `timezone` column needs its own `grant update (timezone)` or the function's
write is refused into the existing `column_write_refused` path. A CHECK cannot validate an IANA
name — `pg_timezone_names` is a view and is not immutable — but a trigger can. `departure_at` is
read by the `036`/`055`/`060` notification fan-out, so shifting it is not only a display concern.
And it should ride **PD-267**'s redeploy rather than asking for a second one. The scored comparison
of four options, and the multi-country note (a `timezone` column on `places` filled by the loader
offline, rather than a client-side coordinate→IANA library), are on PD-193.

**An item tracked in Linear carries its PD-id inline.** An item with no id is not untracked by
oversight — the group marked **absorb on contact** is unfiled on purpose, per the product owner,
2026-08-09: *"If it seems within the context of the build, and recommended, just do it."* Fix one
in the next branch that already has the file open, say so in the PR body, and do not open a story
for it. The census that justifies that, and the bucketing trap inside it, are in `CLAUDE.md`
`docs/reference/linear.md` §Sequencing — run it there rather than trusting a second copy here.

- **`feed_reads.last_seen_at` is written from the DEVICE clock and compared against server
  timestamps.** `PD-253`. `markClubSeen` and `markFeedSeen` both send `new Date().toISOString()`;
  `club_unread_counts()` compares it against `postcards.created_at` and `rides.created_at`, which
  are server-generated. So a handset ten minutes fast silently marks read every postcard and ride
  arriving in the next ten, and a slow one re-lights a badge the rider cleared. Nothing errors,
  nothing logs, and **the wrong answer follows the device rather than the account** — which is what
  makes it invisible to every gate here. `061` refused to inherit it (a `BEFORE INSERT OR UPDATE`
  trigger on `ride_reads` imposes the value) and that refusal is how it was found. The same issue
  carries a second, milder one: `club_unread_counts()` does not exclude the reader's own postcards,
  so posting into a club badges it for your own post.

- ~~**`createClub` and `createRide` can leave a club with no owner row, or a ride whose organizer
  is not on its own crew.**~~ **CLOSED IN CODE by `PD-103` — `103_creator_membership.sql` + `104_club_member_owner_arm.sql`. NOT YET APPLIED to either project; the fix is not live until they are.** The
  entry is struck rather than deleted because its *mechanism* is still the thing to read before
  writing any new create: two inserts with no transaction, and a hand-rolled rollback that stopped
  being one when the writes moved to the browser. PostgREST has no multi-statement transaction, so
  **every** two-round-trip create has that window — the fix was to leave the intermediate state
  unrepresentable (an `AFTER INSERT` trigger seeds the row), not to narrow the window.
  `openspec/changes/enforce-creator-membership/` holds the reasoning, and `openspec/changes/enforce-creator-membership/design.md` §D1 says why
  a trigger rather than the `security definer` RPC both call sites named for months.

  **One claim it made that was wrong, corrected rather than deleted, because a careful reader
  reaches for it again:** it named the fix as a `security definer` function *called by both
  actions*, which three repo comments also said. An RPC binds only the callers that choose to call
  it, and this app ships a publishable key that lets anyone insert into `clubs` directly — only a
  trigger binds every writer. (It also called the result "a UI orphan rather than a hidden row",
  which held only for a *public* club; a private orphan was on neither club list.)

  **Still open, and deliberately:** `PD-194`'s ownership transfer shipped separately in `095`, so
  the club-side delete guard lives there rather than here. **PROD does not have `103` or `104`
  yet** — neither is applied anywhere yet. The apply to DEV follows the merge, gated on the deploy
  being confirmed serving; PROD follows its own promotion. The ratings below are for that work,
  which is all that is left of this entry. **Check, do not trust:** `list_migrations` on both refs.

  **The promotion has an ORDER and it is the one direction that breaks.** Deploy the code first,
  then apply `103`, then `104`. Applying `103` against a bundle that still issues the second
  insert is an instant outage of club and ride creation — `23505` on a row the trigger already
  wrote, then the old compensating delete removes the club, so every attempt reports *"That club
  could not be created."* The reverse gap is self-healing: a bundle with no second insert against
  a database with no trigger makes orphans, and `103`'s backfill repairs exactly those.
  `104` must come last, after the deployed bundle has stopped sending `role: 'owner'`.

  > **Recommendation** 8/10
  >
  > the invariant is live on DEV and absent on PROD, which is the half of a split that goes stale
  > quietly — and the ordering above is the kind of thing that is obvious now and lost in a month
  >
  > **Complexity** 2/10
  >
  > a promotion and two applies in a fixed order; no code, no decision
  >
  > **Urgency** 3/10
  >
  > PROD holds one club and few rides, so the window it closes is nearly empty today. Rises the
  > day real riders create clubs, and sharply if the store build ships
  >
  > **Customer value** 2/10
  >
  > no rider sees it working; it is the harm of losing a club to a closed tab, prevented
  >
  > **This session** N
  >
  > a firing ends at `Deployed to DEV`, and the promotion is the owner's on their own timing

- **Two riders deleting at the same moment can destroy a third rider's postcards.** `PD-175`, a
  sub-issue of `PD-102` because it sits inside the deletion deliverable. The narrow race that
  `032` §3 documents and deliberately leaves open: the successor lock dies with the RPC
  transaction, well before the Edge Function's `deleteUser`. Not fixable in SQL — the window is
  between two HTTP calls in two processes — and **the RLS suite cannot see it either**, since its
  idempotency assertion runs both calls inside one psql transaction.

  > **Recommendation** 6/10
  >
  > worth closing before the flow ships, not before the flow is built
  >
  > **Complexity** 4/10
  >
  > an advisory lock is small; a marker column is a migration plus a recovery story for runs
  > that die holding it
  >
  > **Urgency** 1/10 today
  >
  > genuinely conditional: it needs two riders deleting within seconds, in a club they share.
  > There are four accounts — `select count(*) from auth.users` on PROD, 4 as of 2026-08-09. It
  > rises with the user count, and sharply the day deletion is reachable from the UI at all
  >
  > **Customer value** 3/10
  >
  > nobody sees it working; what it prevents is a club cascading away with every postcard every
  > *other* member ever posted there, for riders who did nothing and get no warning
  >
  > **This session** N
  >
  > it is a design choice between two mechanisms, and the flow it protects does not exist yet

- **Account deletion's flow is built (2026-08-16, `PD-102`) and shipped BEHIND a flag, because
  commit order inside a branch does not make a redeploy fail-closed.** `029`–`032` are applied.
  The re-authentication arm (D6/Q7) landed in `supabase/functions/delete-account/index.ts` as its
  own commit ahead of the client one; **an earlier revision of this line claimed that ordering
  alone kept a redeploy fail-closed, and reviewer finding #1 (2026-08-16) is that it does not** —
  both commits merge together, the client half auto-deploys to DEV on merge, and the function half
  deploys by hand, later, if at all, so merging this alone would have put a live "Delete account"
  row on `/profile` whose password is checked by nothing. **What made it fail-closed at the time:
  `NEXT_PUBLIC_ACCOUNT_DELETION_ENABLED`** (`src/lib/flags.ts`) — the row did not render, on
  either project, until that project's own env var read exactly `'true'`. **Both the flag and
  `src/lib/flags.ts` were deleted on 2026-08-19 and the row now renders unconditionally**, once
  the redeploy it was waiting for had been verified by content; see below. `ProfileMenu`'s
  Delete account row opens a sheet (`DeleteAccountSheet`, not a route — `2303:9370` turned out to
  be a second `ContextMenu`-shaped overlay over `/profile`, not its own screen), the action
  distinguishes the function's `reauth_required`, its `unauthorized` and its new
  `verification_unavailable` (a GoTrue call that could not complete, never read as "already
  deleted" — reviewer finding #2), and a deleted account's session is now destroyed on any device
  that discovers it, not just the one that ran the deletion (`client-session-storage`'s `gone`
  GuardState). **Store blocker 2** — App Store 5.1.1(v) — went from "flow not built" to "flow
  built, off by default" to, on 2026-08-19, a live row a rider can actually reach.

  **`2.6` closed 2026-08-19 — the live exercise ran against the redeployed build, seven cases, all
  passing**, and `3.4`'s open wrong-password arm closed with it. Three disposable accounts through
  `/auth/v1/signup` on DEV, all three deleted by the probe itself, `select count(*) from auth.users
  where email like 'probe-pd102-%'` back to 0. Two things stopped being inferred: replaying a real
  token against a deleted account answers `unauthorized` (previously reasoned from GoTrue's docs),
  and a real non-empty wrong password answers `reauth_required` rather than the
  `verification_unavailable` a mis-set status allowlist would produce. DEV's and PROD's
  `ezbr_sha256` are equal, so the run describes PROD's build too — which is the one claim sha
  equality supports, currency never being it. The table is in
  `openspec/changes/add-account-deletion/tasks.md` §2.6.

  **The flag is GONE, product owner 2026-08-19: *"Just get rid of the toggle and show the delete
  account option"*.** `src/lib/flags.ts` and its test are deleted, `ProfileMenu` renders the row
  unconditionally, and `NEXT_PUBLIC_ACCOUNT_DELETION_ENABLED` is out of `.env.local.example`. It
  was the right call rather than a shortcut: a flag whose premise is false is not a safety margin,
  and this one had a second cost — it made `6.3` unrunnable, because nothing could reach the sheet
  to exercise `functions.invoke` and its preflight. **What gates the destructive call is the
  function**, which refuses a missing or wrong password before anything is transferred, swept or
  deleted; a client-side flag never protected that endpoint, which is live under `verify_jwt` and
  reachable by any signed-in rider's own token with or without a UI.

  **The consequence to hold, because it is the one the flag was also doing silently: `main` now
  ships this to real riders on the next promotion, and the browser path has still never run.**
  Every `2.6` case is `curl`, which needs no preflight. Merging to `development` puts it on DEV,
  which is exactly where `6.3` should run — walk the sheet there before promoting. The failure
  mode if the browser path is broken is an error on screen, not a wrong deletion, so this is a
  sequencing note rather than a reason to hold the merge.

  Also open: `2.4` (idempotency under concurrent deletions — unverified, no new work), `6.3` (the
  live walk, now unblocked), and two decisions that are the owner's/legal's rather than a
  session's — `1.6b` (a club's last member leaving can still destroy third-party postcards) and Q4
  (retain a de-identified consent record — blocks launch, not the build). **A second `delete-account` call with the same token still returns `unauthorized` as
  success**, and that is unchanged, still correct, and now measured rather than inferred.

- **The signed-URL fallback (`client-cache-invalidation`'s task 7 delta) covers `Avatar` and
  `ClubCard`'s cover, not every raw `<img>` that can point at a deleted object.**
  `profile/detail`'s and `profile`'s own cover banners, and `NotificationsListItem`'s club-avatar
  and postcard thumbnails, still render broken on a 404 rather than falling back — the same defect
  as the two that are fixed, on screens `PD-102` did not need to touch to satisfy its own scope.

  > **Recommendation** 5/10
  >
  > a real gap, but a narrow one — reachable only in the window between a deletion/transfer and
  > the next revalidation, on screens that are not this app's most-visited
  >
  > **Complexity** 2/10
  >
  > the same `onError`-tracked-by-src pattern `Avatar`/`ClubCard` already use, copied to three
  > more `<img>` sites — no new component needed unless a fourth site makes a shared one worth it
  >
  > **Urgency** 2/10
  >
  > rises only as account deletion and club transfers see real traffic
  >
  > **Customer value** 2/10
  >
  > a rider sees a broken-image icon for up to an hour instead of initials — a real but small
  > polish, not a functional break
  >
  > **This session** N
  >
  > out of scope for `PD-102`'s groups 3/4/7/6.1; the next session touching any of these three
  > files should pick it up rather than opening a fourth for three lines each

- **Inbox still has no tab, and DMs are what is left of the epic.** Per-ride chat (`034`, PD-115)
  and notifications (`036`, PD-118) both shipped; the tab was dropped rather than built (PD-100),
  so the nav is four tabs and `/notifications` will become `/inbox/notifications` when it returns.
  **The design still draws five**, so its absence reads as an omission to anyone in Figma rather
  than here — `Navbar.tsx`'s own docstring carries the reason at the point of temptation, and that
  is the copy to keep current. `docs/reference/product-scope.md` holds the scoped grep that
  counts the tabs, including why a bare `grep -c "href:"` reads 9.
- **The swipe deck only moves forward.** A swipe in either direction advances, per the product
  owner, so there is no way back except "Start over". **Decided, not a defect** — no issue, and
  nothing to fix.

**Absorb on contact — the five below are deliberately unfiled.** Each is a few lines in a file
someone will open anyway.

- ~~**There is no `clubIdSchema`.**~~ **Added 2026-08-10 with PD-142**, in `getClub` and
  `getClubForEdit` following `getRide`, so a malformed id reaches not-found instead of the error
  boundary. The club timeline's two content reads are **still serialised** behind the club, and
  that half is untouched on purpose: `getClubFeed` and `getRides` have no id guard of their own,
  so parallelising them is a separate change with its own negative case.
- **The legal pages lost their per-page `<title>`.** `export const metadata` and `'use client'`
  cannot coexist, and a rendered `<title>` is the second one in `<head>`. Four lines with
  `document.title` if it matters.
- **`pb-rsvp-bar-extra` shifts when the RSVP bar appears** on the ride detail, because whether
  it renders depends on the read.
- **`createRide` returns a generic message on `23514`.** A rider picking a private club with
  "public" ticked gets "That ride could not be created." with no explanation. Not reachable
  today (0 private clubs); live the moment someone makes one.
- **`club_members` holds a table-level UPDATE grant nothing uses.** Promotion is blocked only by
  the *absence* of a policy, so RLS filters to zero rows rather than raising. Asserted both ways.

**Filed, because each needs something a branch cannot supply** — a proposal, or the designer:

- ~~**A rider learns a ride is full by trying to join it.**~~ **Resolved by removal — `077`
  (PD-293), 2026-08-24.** There is no cap, so there is nothing a rider can be refused for and no
  affordance to draw. The design drew none anywhere — no "Ride is full" state, no seats-remaining
  count, no disabled RSVP pill — and the product owner chose to drop the limit rather than
  commission the frame. What it leaves behind is stated rather than hidden: `ride_members` is
  unbounded in the database, and `RIDE_CREW_LIMIT = 200` on what the crew rail renders is the
  only ceiling left. Reopen if one ride ever attracts thousands.

- ~~**Three claims in `docs/FIGMA-FIDELITY-TODO.md` went stale with `063`.**~~ **Fixed in the
  `077` branch**, which opened that file anyway. All three said `max_riders` was unenforced or
  that nothing caps `ride_members`, and after `077` they are true again — the tracking item is
  now closed as *dropped* rather than *done*, and `RIDE_CREW_LIMIT`'s reasoning is back to its
  original, unnarrowed form.
- **Both RSVP pills fail WCAG AA**, and two more pairings besides — the Maybe pill at 2.54:1,
  `Accent Brand/100` with white at 3.52:1, the ride-host label at 4.10:1, the unselected RSVP
  label at 4.17:1. Left exactly as drawn; remedies costed in `docs/FIGMA-FIDELITY-TODO.md`.
  **A live question for the designer** — the green is used well beyond one screen. `PD-176`,
  `Owner only`.

---
