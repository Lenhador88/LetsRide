## 0. Before anything — what was measured, and what is still owed

- [x] 0.1 **PD-291 read; it has no comments**, so the body is the whole issue and nothing in it
  contradicts a decision here. **Two decisions deliberately depart from its wording** — read
  `design.md` §Unverified before "correcting" either back. The issue says *"one row per device per
  rider"*; this proposal keys `unique (installation_id)`, which is that phrase taken at its word
  rather than at its column list. The issue says *"own-row RLS"*; this proposal grants **no**
  SELECT at all, which is what keeps a re-homing RPC safe.
- [x] 0.2 **Migration numbers.** 77 files in the repo, both projects at `077`, so `078`/`079` are
  free. Re-derive if this sits unstarted — `run.sh` applies by filename and two files sharing a
  prefix is a trap already sprung here.
- [x] 0.3 **Extensions, both projects.** `pg_cron` 1.6.4 and `pg_net` 0.20.4 available on each and
  installed on neither; `supabase_vault` **installed** on both. So Q1 is only the interval and the
  `create extension`, and D14's Vault gate has something to gate on.
- [ ] 0.4 **Q2 — owner, blocking for child C.** The APNs environment split for `app-dev` vs
  `app.letsride.social`. Default: one `.p8` per team serves both; the *host* differs
  (`api.sandbox.push.apple.com` vs `api.push.apple.com`), so it is a function secret, never a
  build constant, or the DEV function pushes to production devices. It is also the second
  independent guard behind D14's Vault gate.
- [ ] 0.5 **Q3–Q8 — product owner, none blocking.** Each has a recommended default in
  `design.md` §Open Questions and each default is recorded in the artifact that implements it, so
  a different answer is a new migration or a prop, not a rewrite. Build to the defaults rather
  than waiting. **Q4 is the one to put carefully**: it is not "may a push show a private club's
  name on a lock screen", it is "may it also be transmitted to Apple or Google".
- [ ] 0.6 **Read `docs/reference/schema.md` before writing `078`**, and
  `docs/ENVIRONMENTS.md` §Scheduled jobs before writing the job in 3.24. The second is a standing
  instruction this change is the first to trip.
- [ ] 0.7 **File the board shape before any PR opens.** A, B and C become **sub-issues of
  PD-291**, and PD-291 stays open until C lands. Not a new row for the remainder, not a comment on
  a closed issue.

---

## 1. CHILD A — `Push devices — a table nobody may read`. Blocked on nothing; gated in full

**Definition of this group:** nothing in it changes a SELECT policy, removes a grant the
application reads, or requires a machine this container does not have. It is additive, inert until
child B calls it, and its entire contract is assertable by `supabase/tests/`. **This is why it is
cut out of the plugin PR the issue sketched** — bundling them would hold the one fully-gated
migration in this epic behind a native change nothing here can exercise.

- [ ] 1.1 `078_push_devices.sql` — the table. `id`, `user_id` (`references public.profiles(id) on
  delete cascade not null`), `installation_id text not null`, `token text not null`, `platform
  text not null` with a CHECK for `('ios','android')`, `created_at` and `last_seen_at` both
  `timestamptz default now() not null`. **`unique (installation_id)`** — and **no** unique key on
  `token`, which is a mutable attribute. Design D3, and the header states both failures in D3's
  own words: `unique (user_id, token)` forks on a shared phone, `unique (token)` forks on a token
  **rotation** and then leaks past a sign-out until the idle sweep.
- [ ] 1.2 In the same file: `alter table ... enable row level security` and **no policy at all**,
  following `026`'s `password_reset_grants`. A `-- deliberately no policy` comment with the
  reason, so the next reader does not add one as a repair.
- [ ] 1.3 In the same file: `revoke all on public.push_devices from anon, authenticated;` explicitly,
  rather than relying on a default. The header states that the absent SELECT grant is what makes
  1.5 safe, so the two are one decision.
- [ ] 1.4 Index on `user_id` — the cascade path from `profiles`. `add-account-deletion` §1 is the
  precedent for why an unindexed cascade FK is four sequential scans under a lock.
- [ ] 1.5 `public.register_push_device(installation_id text, token text, platform text)` —
  `security definer`, `search_path` pinned, schema-qualified names, **no user id parameter**,
  subject `auth.uid()`. Body: restate the participation gate (`private.may_participate()`, raising
  with `errcode = 'check_violation'`), upsert on `installation_id` — replacing `user_id`, `token`
  and `platform` — then trim the caller's rows to the ten most recent by `last_seen_at`. Revoked
  from `public` and `anon`, granted to `authenticated`.
- [ ] 1.6 `public.release_push_device(installation_id text)` — `security definer`, deletes the
  caller's row for that installation. **Not** participation-gated; the header says why (refusing a
  release is refusing to stop sending someone push). Revoked from `public` and `anon`, granted to
  `authenticated`.
- [ ] 1.7 **Do NOT add an `enforce_participation_gate` trigger to this table**, and add a comment
  saying so with D13's reason: every existing one carries `when (current_user = 'authenticated')`,
  `current_user` inside a `security definer` function is the owner, so it would never fire while
  still raising the trigger count and making coverage read complete.
- [ ] 1.8 Table and column comments, in the house style: what the table is, that nobody may read
  it including its owner, the four ways a row dies, and the 60-day window in the words the spec
  uses.
- [ ] 1.9 **Assertions in `supabase/tests/rls_test.sql`** — paired with 1.1–1.7 per
  `openspec/config.yaml`. Minimum set, each naming a role rather than attempting a statement where
  the suite's owner-context would make the attempt meaningless:
  - [ ] 1.9a `has_table_privilege` false for `authenticated` and `anon`, on each of SELECT,
    INSERT, UPDATE, DELETE.
  - [ ] 1.9b `has_function_privilege('anon', …)` false and `('authenticated', …)` true, for both
    RPCs.
  - [ ] 1.9c Two riders, one installation: B registering A's installation leaves exactly one row,
    owned by B.
  - [ ] 1.9d **Rotation is an UPDATE.** Registering the same installation with a new token leaves
    exactly one row carrying the new token, and no row carrying the old one. **This is the
    assertion that would have caught the first version of D3** — the shared-phone test passes
    under `unique (token)` too, and only this one fails.
  - [ ] 1.9d2 **The rotation-then-sign-out leak, end to end.** A registers I with T1, rotates to
    T2, releases I; assert **zero** rows for A. Under a token-keyed table the T1 row survives, so
    this is the regression test for the whole decision.
  - [ ] 1.9e One rider, three installations: three rows survive, and releasing one leaves two.
  - [ ] 1.9e2 The cap: an eleventh registration leaves ten rows, and the one dropped is the oldest
    by `last_seen_at`.
  - [ ] 1.9f The gate: a rider with `terms_accepted_at` NULL gets `23514` and no row.
  - [ ] 1.9g `release_push_device` succeeds for a rider the gate would refuse.
  - [ ] 1.9h Cascade: deleting the `auth.users` row removes every device row, asserted beside the
    existing cascade assertions rather than in a new section.
  - [ ] 1.9i **No `enforce_participation_gate` trigger exists on this table** — asserted, so that
    adding one later is a red test rather than a silent no-op.
- [ ] 1.10 `npm test` green. Compare **label sets** against the previous run, not counts — a count
  cannot tell a rename from a loss, which is what `038` did to one of `036`'s assertions.
- [ ] 1.11 Apply `078` to DEV, then check `get_advisors(security)`. **Expect exactly one new
  advisor**: `rls_enabled_no_policy` (INFO) on `push_devices`. Anything else is unexpected by
  definition. Add the new row to `CLAUDE.md`'s advisor table — **main thread only**, agents do not
  write that file.
- [ ] 1.12 PR, `reviewer` before merge, merge to `development`, Linear to `Deployed to DEV`.
  **This PR does not close PD-291** and its body says so in one line.

---

## 2. CHILD B — `Register the device, and spend the one prompt deliberately`

**Blocked on:** a Mac, an Apple Developer provisioning profile carrying the Push Notifications
capability, and an FCM project with `google-services.json`. **The pure half is testable here; the
rest is not, and every box that is not carries `[device]`.**

- [ ] 2.1 `@capacitor/push-notifications`, **pinned exact** like every other Capacitor package —
  they must move together, so a caret on one is a version skew waiting for whichever `npm install`
  runs first. Ten runtime dependencies after this; re-derive with
  `node -p "Object.keys(require('./package.json').dependencies).length"` rather than trusting that.
- [ ] 2.2 The one-sentence justification, in `package.json`'s vicinity and in the PR body, per
  `.claude/agents/native.md`: *Apple and Google hand a device token only to native code, so there
  is no route from the webview to APNs or FCM at all; this plugin is that route and nothing in the
  dependency tree substitutes for it.* Name what it pulls in: the iOS Push Notifications
  capability and `aps-environment` entitlement, and Android 13+'s `POST_NOTIFICATIONS` runtime
  permission.
- [ ] 2.3 `src/lib/push/priming.ts` — the pure `pushPrimingState`, modelled on
  `src/lib/location/priming.ts` and carrying the same kind of header: each rule with the trap it
  avoids. States: `hidden`, `ask`, `blocked`, and **`stalled`** — granted, registered, no token.
- [ ] 2.4 `src/lib/push/__tests__/priming.test.ts` — every state, including the two the location
  precedent has no analogue for: non-native platform (always `hidden`, before any permission
  read), and `stalled`.
- [ ] 2.5 `src/lib/push/installation.ts` — `installationId()`: read the id from the existing
  secure store, generating one with `crypto.randomUUID()` on first call. **No new plugin** (D3);
  `@aparajita/capacitor-secure-storage` already holds the refresh token, so the value's lifetime is
  exactly *this install on this device*. A unit test that a second call returns the first value.
- [ ] 2.6 `src/lib/push/registration.ts` — `checkPushPermission()`, `requestPushPermission()`
  (the **only** function that may prompt), the `registration` / `registrationError` listeners,
  `registerCurrentDevice()` and `releaseCurrentDevice()`. Both RPC calls pass the installation id.
  Non-native platforms return early before touching the plugin, the way `secure-store.ts` does
  through `Capacitor.isNativePlatform()`.
- [ ] 2.7 **Cold-start registration.** `registerCurrentDevice()` runs unconditionally on every cold
  start while a session exists and the permission is granted — not only on first grant. This is
  the other end of D8's window and the thing that re-homes a shared device. Because the row is
  keyed on the installation, the re-home is **total**; under a token-keyed table it would move one
  token and leave any other row for the same device behind.
- [ ] 2.8 `src/components/push/PushPrimingSheet.tsx` — `ContextMenu`-based, `ask` / `blocked`
  modes, only `Continue` reaching the API. Copy claims listed in the header as
  `LocationPrimingSheet` lists its two, since Apple reads the in-app rationale.
- [ ] 2.9 `src/components/push/PushPrimingRow.tsx` — geometry borrowed from `UseMyLocationRow` /
  `ExploreClubsStrip`, a `<button>` with `aria-haspopup="dialog"`. Draws at the top of
  `/notifications` and nowhere else (Q3's default).
- [ ] 2.10 Wire the row into `src/app/(app)/notifications/page.tsx`. One call site.
- [ ] 2.11 `signOut()` in `src/lib/actions/auth.ts` gains `releaseCurrentDevice()` **before**
  `supabase.auth.signOut()`, failing silently. Extend the function's header, which already
  explains the ordering of the other four clears, with why this one is first and why its failure
  does not block sign-out.
- [ ] 2.12 Revoked-permission detection: on the next permission read after a rider disables
  notifications in OS settings, call `releaseCurrentDevice()` — **this installation only**, not
  every row for the rider, which would unsubscribe their other phone. Providers keep accepting
  sends for a token whose app permission was revoked and silently drop them, so nothing else would
  notice.
- [ ] 2.13 `src/lib/query/keys.ts` — a key for the push registration state, spelled there rather
  than inline, with the same header note the file's other entries carry.
- [ ] 2.14 Permission strings and native project config — **[device]**, on a Mac.
  `NSUserNotificationsUsageDescription` is not a thing; what Apple reads is the in-app rationale
  in 2.7 plus the App Store privacy answers. Android needs the `POST_NOTIFICATIONS` declaration.
- [ ] 2.15 **[device]** Grant on a real iOS device, confirm a token arrives, confirm the row lands.
- [ ] 2.16 **[device]** Decline on a real iOS device, confirm `blocked` mode and that the row keeps
  drawing.
- [ ] 2.17 **[device]** The `stalled` path: run once with the Push capability deliberately absent
  from the profile, confirm the state is reachable and distinguishable. This is the state most
  likely to ship broken and the only way to see it is to cause it.
- [ ] 2.18 **[device]** Android 13+: the runtime permission, and its different one-shot semantics.
- [ ] 2.19 **[device]** Two riders, one phone: sign out as A, sign in as B, confirm exactly one row
  and that it names B. Then repeat with the device in airplane mode at sign-out, and confirm the
  re-home happens on B's first launch instead.
- [ ] 2.19a **[device]** The same, **after forcing a token rotation** — the case 1.9d2 asserts in
  SQL, confirmed against a real provider. This is the trip worth making for D3.
- [ ] 2.20 `npm run walk` — **the walk cannot reach any of this**, and the tasks list says so
  rather than adding a phase. Adding a phase means adding a reason, and there is no browser path
  to a push registration.
- [ ] 2.21 PR, `reviewer`, merge, `Deployed to DEV`. **Does not close PD-291**; says so.

---

## 3. CHILD C — `Deliver a notification to a phone`. This is the one that closes PD-291

**Blocked on:** the APNs `.p8` + key id + team id, the FCM service account, a scheduler extension
(0.3), and an owner deploy. **Buildable and mergeable before any of them arrive** — an empty
`push_devices` makes every claim a no-op — but not *finishable*.

### 3a. The SQL

- [ ] 3.1 `079_push_delivery.sql` — `public.push_deliveries`: `notification_id` (`references
  public.notifications(id) on delete cascade`, unique), `state text` with a CHECK over
  `('pending','claimed','sent','suppressed','failed')`, `attempts int`, `claimed_at`,
  `completed_at`. **No payload column, no rendered-copy column, no club or ride name** —
  `database-enforced-integrity`'s modified requirement makes that a rule rather than a preference.
- [ ] 3.2 RLS enabled, no client grants, no policy. Same shape and same reasoning as `push_devices`.
  Expect a second `rls_enabled_no_policy` advisor.
- [ ] 3.3 The `AFTER INSERT` trigger on `notifications`, writing one row. **No
  `WHEN (CURRENT_USER = …)` clause**, and a comment recording that the absence is deliberate — per
  the standing requirement that an absent guard is indistinguishable from a forgotten one. It
  performs no readability check; the sender does that.
- [ ] 3.4 `private.can_read_postcard(candidate uuid, target uuid)`,
  `private.can_read_comment(...)`, `private.can_read_profile(...)` — completing the family `060`
  started, in exactly `can_read_ride`'s shape: candidate as an argument, `security definer`,
  `search_path` pinned, revoked from `public`/`anon`/`authenticated`, and a comment naming the
  policy each restates and where that policy's qual is pinned in the suite.
- [ ] 3.5 `public.push_payload_for(notification_id uuid)` — `security definer`, **granted to
  `service_role` alone**, revoked from `public`, `anon` and `authenticated`. Two separable halves:
  - [ ] 3.5a **The visibility gate, per COLUMN**, mirroring `036` §3's own qual — four
    `<column> is null or …` conjuncts plus the recipient scope, the block check and
    `can_read_profile`. **Not** a `case type` dispatch: a sixth type changes the type CHECK and
    leaves the SELECT qual alone, so a type-keyed gate diverges on exactly the event 4.1 files.
    `ride_created_in_club` then requires both conjuncts without anyone remembering that it does.
  - [ ] 3.5b **The copy dispatch, per type**, with an `else` arm that **raises** — `036:151-155`'s
    reasoning one function along: a bare `CASE` with no `ELSE` returns NULL for an unmatched type,
    and NULL copy is a crash in the sender or an empty notification on a lock screen.
  - [ ] 3.5c Returns nothing when the gate refuses; returns ids plus rendered strings and stores
    none of them.
- [ ] 3.6 `public.claim_push_batch(batch_size int)` — `security definer`, granted to
  `service_role` alone. Claims atomically (`for update skip locked`) so an overlapping run cannot
  double-send, and returns the recipient's devices with each row. **Two filters beyond `pending`:**
  - [ ] 3.6a `and n.read_at is null` — a rider who was in the app when the row landed and tapped it
    must not get a push about it forty seconds later. With a one-minute interval this is the
    ordinary case, not an edge one.
  - [ ] 3.6b An **age cut**: rows older than a few hours are marked `suppressed`, not sent. The
    free tier auto-pauses after ~7 days idle, and a size bound alone means a resumed project
    delivers a week of notifications in installments. Stated in the header beside the interval.
- [ ] 3.7 `public.complete_push_delivery(...)` / `public.invalidate_push_device(installation_id
  text)` — `security definer`, `service_role` alone. The second is the only route by which a
  provider refusal removes a device row.
- [ ] 3.8 **`031`'s lesson, applied prospectively.** Every function the Edge Function calls is in
  `public` — never `private` — because `service_role` holds no EXECUTE in `private` and PostgREST
  routes only to `public`, so `.schema('private')` is refused before it reaches Postgres.
- [ ] 3.9 The retention sweep: tokens idle 60 days, and completed/suppressed outbox rows older
  than 7 days. A `security definer` function granted to `service_role`, called by the same job.
- [ ] 3.10 **Assertions in `supabase/tests/rls_test.sql`**, paired per `openspec/config.yaml`:
  - [ ] 3.10a `has_function_privilege('service_role', …, 'EXECUTE')` true for each of the four
    delivery RPCs, and `('authenticated', …)` and `('anon', …)` false for each. **Named by role,
    not exercised** — `031`'s shape.
  - [ ] 3.10b Blocking, both directions, created *after* the notification: `push_payload_for`
    returns nothing. Asserted with the two riders exchanged.
  - [ ] 3.10c A rider who left a **private** club: nothing. A rider who left a **public** club:
    still a payload — asserted separately, because one assertion cannot say which arm did the work.
  - [ ] 3.10d `ride_created_in_club` with a public club and a non-public ride, recipient having
    left the club: nothing. **Not** replaced by an assertion relying on ride-visibility implying
    club-visibility.
  - [ ] 3.10e An unresolvable actor: nothing.
  - [ ] 3.10f The **textual pin**, covering **two** texts — `notifications` SELECT's qual **and**
    `notifications_type_check` — pinned against `push_payload_for`'s two halves, in the manner
    `060` pinned `clubs` SELECT at §060.1b. This is the assertion the whole design rests on.
    Pinning the qual alone is the trap: it does not move when a type is added, so it would stay
    green through exactly the change 4.1 makes.
  - [ ] 3.10f2 An unknown `type` makes `push_payload_for` **raise** rather than return NULL copy.
  - [ ] 3.10f3 A notification with `read_at` set is not claimed.
  - [ ] 3.10f4 A notification older than the age cut is claimed and marked `suppressed`, not sent.
  - [ ] 3.10g `claim_push_batch` claims each row at most once under concurrent calls.
  - [ ] 3.10h A recipient with zero tokens completes rather than fails.
- [ ] 3.11 `npm test` green; label sets compared, not counts.

### 3b. The Edge Function

- [ ] 3.12 `supabase/functions/push-notify/index.ts`. **It issues no `.from()`** — a grep of the
  file returns zero, and the header says why: a service-role key reaching arbitrary tables makes
  every policy in this repo decorative.
- [ ] 3.13 The caller check: verify the JWT's **signature**, then require `role: service_role`.
  `verify_jwt: true` is not this check — any signed-in rider's access token satisfies it, exactly
  as the publishable key satisfies a decode-only check. Header states which of
  `delete-account`'s four rules apply, which is replaced, and by what (design D11).
- [ ] 3.14 APNs: JWT signed with the `.p8` over ES256, `apns-topic` = the bundle id, the host read
  from a secret rather than a build constant (0.4).
- [ ] 3.15 FCM v1: OAuth from the service account, one message per token.
- [ ] 3.16 **The failure classifier — three outcomes, and it is the thing most likely to be wrong.**
  Delivered / token-is-dead / transport. `search-places` is the worked example of getting one
  wrong: `isPolicyRefusal` matched `42501` only, the gate raises `23514`, and a refusal fell to the
  outage branch. Folding a transport error into the dead-token branch here silently unsubscribes
  every rider on whichever platform is having an outage, and nothing reports it.
- [ ] 3.17 Bounded batch, bounded retries, backoff. `event-fanout-integrity`'s "bounded and not
  assumed small", one table further down.
- [ ] 3.18 `src/__tests__/no-service-role-key.test.ts` — detectors for a PEM private key block and
  a Google service-account JSON, **each proving it still catches a real key of that format**, per
  the file's own self-check convention.
- [ ] 3.19 **Nothing type-checks this file.** `tsconfig.json` excludes `supabase/functions`.
  Stated in the PR body, not discovered in review.
- [ ] 3.19a **`/legal/privacy` names Apple and Google as sub-processors**, in the existing *"Who
  processes your data today"* section, alongside Supabase, Vercel and Geoapify, with what each
  receives: another rider's username, a club's name, a ride's title, the provider token and the
  installation identifier. **This ships in this child, not as a follow-up** — the disclosure
  obligation begins with the first delivered push. It is the first time RLS-governed content
  leaves Supabase for a third party at all; every prior outbound call sends a query string or a
  coordinate.

### 3c. What only the owner can do

- [ ] 3.20 **[owner]** Create the APNs auth key in App Store Connect; set `APNS_KEY`,
  `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_HOST` as function secrets on **both** projects. Nowhere
  else — not `src/`, not `.env.local.example`, not Vercel, not a fixture, not any `NEXT_PUBLIC_*`.
- [ ] 3.21 **[owner]** Create the FCM project; `google-services.json` into the Android project,
  the service account into the function's secret store.
- [ ] 3.22 **[owner]** `create extension pg_cron` **and** `create extension pg_net` on both
  projects. Both available and neither installed (0.3), so these are two statements rather than an
  availability question. **`pg_net` is required, not optional**: `pg_cron` schedules SQL and cannot
  make an HTTPS request, so without it the schedule cannot reach the function. D2's objection to
  `pg_net` is specific to running it **inside a rider's transaction**, where it cannot raise and
  parks failures in `net._http_response`; from a cron job outside every rider's write it has none
  of those properties. Do not read D2 as a blanket prohibition — child C stalls on that reading.
- [ ] 3.23 **[owner]** Deploy `push-notify` to DEV, exercise, then PROD. `deploy_edge_function` is
  on the `deny` list and there is no `supabase` CLI in the container, so this is an owner action
  on every change under `supabase/functions/` — the function is drift from the moment it merges.
- [ ] 3.23a **Write the scheduled job gated on Vault — `docs/ENVIRONMENTS.md` §Scheduled jobs,
  discharged by name.** That section is a standing instruction aimed directly at this change: a
  `pg_cron` job written in a migration **replicates to DEV and fires there**, and `pg_net` carries
  the same hazard for outbound HTTP. The job SHALL read a per-project key from `supabase_vault` —
  installed on both projects already — and return without doing anything when it is absent or does
  not name the project it is running on. Scheduling outside the chain is rejected on
  reviewability: such a job is invisible to `db:drift`, to the RLS suite and to `reviewer`, so no
  later session can find out it exists. The migration header quotes §Scheduled jobs rather than
  paraphrasing it, and notes that Q2's sandbox host is the second independent guard — two things
  have to be wrong before a real rider's phone rings from DEV.
- [ ] 3.24 **[owner]** Schedule the job. **Ordering: `079` applies, then the function deploys,
  then the schedule starts.** The trigger writes outbox rows from the instant `079` applies, so a
  schedule that starts before there is anything to drain leaves the table growing with nothing
  reading it — additive first, deploy, then the destructive/activating step, which is
  `023`/`025` and `069`/`070` arriving a third time.
- [ ] 3.25 **[device]** End to end: rider A likes rider B's postcard; B's phone shows it. Then the
  five `036` types, one at a time.
- [ ] 3.26 **[device]** The negative end to end, which is the one worth the trip: A likes, B blocks
  A before the sweep runs, **no push arrives**, and the in-app row is gone too.
- [ ] 3.26a **[device]** Confirm the DEV job does **not** fire against production devices — the
  Vault gate (3.23a) plus the sandbox host (0.4), checked independently rather than together.

### 3d. Closing it

- [ ] 3.27 PR, `reviewer`, merge, `Deployed to DEV`.
- [ ] 3.28 Promote to `main` per `docs/ENVIRONMENTS.md` §Migrations, apply `079` to PROD in the
  order 3.24 states, and set PD-291 to `Done (in production)`. **This is the task that closes
  PD-291** — not 1.12, not 2.21. Children A and B close on their own merges; **PD-291 is their
  parent and stays open until this one lands** (0.7).

---

## 4. Filed rather than built

- [ ] 4.1 **Child D — *"Your ride is tomorrow" — the first scheduled notification*.** Design D10
  settles the shape so that change does not re-decide it: it writes a `notifications` row first;
  it needs a sixth type in **both** `notifications_type_check` and `notifications_subject_shape`
  (the `else false` arm is load-bearing); the organizer is `actor_id`, which makes it the first
  deliberate exception to *"a rider SHALL NEVER be notified of their own action"* and therefore a
  modified standing requirement rather than an implementation detail; and idempotence is a partial
  unique index in `036` §9's shape, not a flag on a job row. **And it adds a copy arm to
  `push_payload_for` — that one line is the whole reason D5's gate is per column**: the visibility
  half already covers `ride_upcoming`, because the type reuses `ride_id` and the column conjunct
  fires regardless of type, so only the per-type copy dispatch grows. If that is forgotten, 3.5b's
  `else` raises and 3.10f's pin on `notifications_type_check` has already turned the suite red.
  Depends on child C for the scheduler and on nothing else.
- [ ] 4.2 **The `notifications` retention sweep** that `036` filed as a follow-up *"landing with
  the first scheduled job this project acquires"*. That job now exists. It deletes outright and
  does **not** null `actor_id`, per the standing requirement.
- [ ] 4.3 **Per-category preferences**, blocked until the condition that reopens them: the first
  high-volume category, ride chat being the candidate. If chat push is proposed, this ships in the
  same change.
- [ ] 4.4 **A devices screen**, if ever wanted — an own-row RPC returning `platform` and
  `last_seen_at`, never a SELECT grant.
