# Design — deliver push notifications

## Context

**What exists.** `036` created `public.notifications` — five types, four typed nullable subject
FKs, `read_at` as the only column a rider may write, no INSERT grant to any client role, and a
SELECT policy that re-asks the whole visibility question on every read: the recipient scope, a
block conjunct through `private.is_blocked`, and an `EXISTS` per rendered resource under the
*caller's own* row security. `060` gave the fan-out three candidate-relative predicates —
`private.is_club_member_for`, `private.can_read_ride`, `private.can_read_club` — so a trigger can
ask *"can THIS candidate resolve the subject"* rather than *"can the caller"*. `/notifications`,
its badge and `unread_notification_count()` all ship.

**The one property of that table that decides this entire design: it holds no text.** No
`club_name`, no `ride_title`, no `actor_username`, no `body`. `036` §2 calls that *"the single most
important thing about the shape"*, and it is right — a name snapshot is a visibility decision
nothing re-checks. A push, by contrast, is text or it is nothing. So this change has to produce,
at send time, exactly the string the recipient's own policy would have rendered, and then let that
string leave the database's reach permanently.

**What does not exist.** No device token. No scheduler: `pg_cron` and `pg_net` are not created by
any migration in this repo, and `036`, `041` and `026` each say so in their own words while
declining to depend on one. No push credentials. No native project — `capacitor.config.ts` is
written and unverified, and `cap add` has never run in this container.

**What could not be verified while writing this.** The Linear issue itself and the live database
both. See §Unverified at the foot of this file; every claim below that would ordinarily be read
off `list_tables` or `list_migrations` is instead read off the migration files, which is the same
artifact for schema shape and **not** the same artifact for applied state.

## Goals / Non-Goals

**Goals:**

- A `notifications` row written by `036`'s triggers reaches the recipient's phone, with the same
  copy `NotificationsListItem` would have drawn, and nothing the recipient could not read.
- The device token is a per-device secret that no client role can read, including its owner, and
  that cannot outlive the pairing between that device and that rider without healing itself.
- A push failure never touches the rider whose write produced the notification.
- Every state, credential and check that only a Mac, a device or the owner can exercise is named
  as such, so a green CI run is never mistaken for a working feature.

**Non-Goals:**

- Ride reminders, chat push, per-category preferences, a devices screen, in-app foreground
  banners, notification analytics, rich media payloads, action buttons, or grouping/summary
  notifications. Each is named in §D9 or in `proposal.md`.
- Web Push, a service worker, a manifest. Settled against; `rider-ux`'s brief and `CLAUDE.md`
  §What Not To Do both say so.
- Any widening of the `notifications` SELECT policy. The delivery path restates it under a pin;
  it does not relax it.

## Decisions

### D1 — The split falls on the blocker, and PD-291 closes on the third child

The issue proposes two PRs: plugin plus token table, then delivery. **Three, and cut differently.**

The reason is not tidiness. The token table's entire contract is a set of grant and policy
assertions, which `supabase/tests/rls_test.sql` gates completely on every PR touching
`supabase/**`. The plugin's contract is a registration callback that no machine in this container
can run. Bundling them makes the one fully-asserted, fully-gated migration in this epic
unmergeable until somebody has a Mac.

| Child | Deliverable | Waiting on | What proves it |
|---|---|---|---|
| **A** — *Push tokens — a table nobody may read* | `078`: `push_tokens`, its absent grants, `register_push_token`, `release_push_token`, the retention column, the FK index | nothing | the RLS suite, in full |
| **B** — *Register the device, and spend the one prompt deliberately* | the plugin, `src/lib/push/`, `pushPrimingState` + tests, the sheet and row, `signOut`'s fifth clear | a Mac, an Apple provisioning profile with the Push capability, an FCM project + `google-services.json` | `test:unit` covers the pure half; the rest is **[device]** |
| **C** — *Deliver a notification to a phone* | `079`: the outbox, its trigger, the three `can_read_*` predicates, `claim_push_batch`, `push_payload_for`; the `push-notify` Edge Function; the schedule | the APNs `.p8` + key id + team id, the FCM service account, a scheduler extension on both projects, an owner deploy | the RLS suite covers the SQL; delivery is **[device]** + **[owner]** |

**PD-291 names delivery to a phone, so it closes on C and on nothing earlier.** A and B are its
children and stay open beneath it. `CLAUDE.md` §The roadmap lives in Linear is explicit that
partly delivered means the story stays open, and the failure it warns about — *"the main feature is
not being developed in the main story we discussed about"* — is exactly what closing PD-291 on a
token table would be.

**B and C are independent of each other and both depend on A.** They can run in parallel once the
credentials land; C can be built and merged against zero registered devices, because an empty
`push_tokens` makes every claim a no-op.

### D2 — The enqueue is a trigger; the delivery is a schedule. Both, and each where it belongs

The question *"trigger-driven or scheduled"* has two different right answers because it is two
questions.

**Enqueue: a trigger, `AFTER INSERT` on `notifications`, writing one `push_deliveries` row.** A
plain local insert. No network, no extension, no `pg_net`. It fires for every writer and carries
**no** `WHEN (CURRENT_USER = …)` clause, per `database-enforced-integrity`'s standing rule that a
fan-out fires for every writer while a gate skips privileged ones — and the absence of the guard is
recorded at the trigger, because an absent guard is indistinguishable from a forgotten one.

**Delivery: a scheduled Edge Function** claiming a batch from the outbox.

The alternative — a `pg_net.http_post` from the same trigger, which is what a Supabase Database
Webhook is underneath — is rejected on three counts, and the first is the one that matters:

1. **It puts an outbound HTTP call inside every like, comment, RSVP, ride creation and club
   join.** `036`'s header is emphatic about what those six triggers already cost: *"from the moment
   this applies, every one of those runs new code inside the rider's own transaction, and a
   fan-out that raises takes that rider's write down with it."* That is deliberate for the
   notification, because a notification that silently does not happen is a gap with nothing to
   detect it. It is **wrong** for the push: a rider must be able to like a postcard while APNs is
   down. `pg_net` is asynchronous and would not in fact raise — which is worse, not better,
   because the failure then lands in `net._http_response` where nothing in this repo reads it.
2. **A push has to be re-checked immediately before it is sent, and a trigger sends at write
   time.** The whole point of `036` §3 is that a visibility decision taken at fan-out is not the
   same decision as one taken at read time. A push sent inside the fan-out transaction is a
   fan-out-time decision — the very thing that spec forbids for the row it is derived from.
3. **One scheduler serves three known jobs.** Delivery, the token retention sweep in D7, and the
   `notifications` retention sweep that `036` filed as a follow-up *"landing with the first
   scheduled job this project acquires"*. Building it once is why that follow-up was written the
   way it was.

**The trade this buys and pays: latency.** A sweep at interval *N* means a push is up to *N* late.
Recommended **30 seconds** where the scheduler supports sub-minute intervals and **1 minute**
where it does not. For every one of `036`'s five types — a like, a comment, an RSVP, a ride
created, a club joined — a minute is invisible. It is **not** acceptable for *"the group is
leaving"*, which is `rider-ux`'s named real-time case; that case does not exist yet and when it
does it is the trigger that reopens this decision. Say so in the migration header rather than
leaving the next session to rediscover the trade.

**The scheduler itself is an owner action and a named blocker.** Nothing in this repo creates
`pg_cron` and no session can enable it. The obvious substitute — a scheduled GitHub Actions
workflow calling the function — is rejected, and not on latency: it needs a credential that
authorises the call, which puts a secret outside the function's own secret store and breaks the
first of `delete-account`'s four rules for a scheduling convenience.

### D3 — `unique (token)`, and re-registration moves the row. This is the change's centre of gravity

A device token identifies a **device**, not a rider. APNs and FCM hand the same token to the app
regardless of who is signed in.

```
unique (user_id, token)   -- two riders, two rows, both live, both delivered to
unique (token)            -- one device, one row, one rider
```

The first shape is the natural one — it is what every other membership-ish table in this schema
looks like — and it is wrong. Under it, rider A signs out on a club-shared phone, rider B signs
in, B's app registers, and both rows exist. Every notification A receives thereafter renders on
B's lock screen: A's actor usernames, A's ride titles, A's private club names. **No policy is
violated; the delivery function did exactly what the table told it.** It is the only failure in
this app where one rider's data reaches another rider's screen with the entire RLS layer working
correctly, and it costs one word in a migration to prevent.

**A client upsert cannot express the second shape, and it fails closed and silent.** With a
`token`-keyed upsert and a `using (user_id = auth.uid())` policy, rider B's `ON CONFLICT DO UPDATE`
hits a row it may not see — so the update matches nothing, and depending on the path either
raises `23505` or writes nothing at all. Either way B's device is not re-homed and A's pushes keep
arriving. **Failing closed is the wrong direction here**, which is why registration is not a
client write.

**So: no write grants at all, and an own-row `security definer` RPC.** `register_push_token(token
text, platform text)` deletes every row carrying that token, whoever owns it, then inserts one for
`auth.uid()`. It takes no user id — the subject is `auth.uid()` and nothing else — which is
`delete-account`'s second rule and `moderate_comment`'s shape.

**The delete-by-token is safe for a reason, and the reason must be stated because it is the thing
that stops being true if anyone adds a SELECT grant.** The token is a high-entropy value the
device holds and nothing exposes. If a client role could *read* the table, this RPC would become a
push-denial vector: read another rider's token, call the RPC, silently steal their device
registration. It is safe **because** D4 grants nobody SELECT, so the two decisions are one
decision and a future "just a small read for a devices screen" reopens both.

### D4 — Nobody reads a device token. Not the owner, not the app, not a club owner, not `service_role` through PostgREST

`authenticated` and `anon` hold **no** SELECT, INSERT, UPDATE or DELETE on `push_tokens`. RLS is
enabled with **no policy at all**, which is `026`'s `password_reset_grants` shape — the INFO
advisor `rls_enabled_no_policy` it produces is correct by design and belongs in `CLAUDE.md`'s
advisor table as an eleventh expected entry.

Rejected: a SELECT grant scoped to `user_id = auth.uid()`. The argument for it is a "your devices"
screen; there is none in v1, the app already knows its own token from the plugin, and the cost is
D3's push-denial vector plus a per-device secret becoming readable by whatever XSS or leaked
session ever reaches the client. **When a devices screen is eventually wanted, it is an own-row RPC
returning `platform` and `last_seen_at` and never `token`** — write that sentence into the
migration so the screen does not arrive as a grant.

`service_role` reaches the table only through `claim_push_batch` and `push_payload_for`, both in
`public`, both granted to `service_role` by name and revoked from `public`, `anon` and
`authenticated`. **The Edge Function issues no `.from()` against any table.** That is a deliberate
narrowing of the service-role blast radius from "the whole database" to three function names, and
it is checkable: a grep of the function for `.from(` returns zero.

### D5 — The payload restates the read policy, under a textual pin, reusing `060`'s primitives

The payload has to be exactly what the recipient could read. Three ways to get it, and the repo
has already chosen one for this class of problem.

**(a) Impersonate the recipient** — `set local role authenticated` plus a forged
`request.jwt.claims` inside a `security definer` function, so RLS itself decides. Zero
restatement, and rejected: it is fragile in exactly the way `031` was, because **the RLS suite
runs as the table owner** for whom RLS does not apply, so a mistake in the impersonation passes
every assertion this repo can write.

**(b) Send a contentless push** — "You have a new notification" — and let the app fetch under the
rider's own session. Zero restatement, no leak possible, and rejected on two counts. A generic
string is the *"control that renders and does nothing"* the `notifications` spec already refuses
elsewhere; and it does not escape the problem, because the fetch happens later while the generic
string sits in the notification centre for ever. iOS additionally throttles `content-available`
pushes and delivers none when the app is force-quit, and Android delays data-only messages in
Doze — so the mechanism that makes (b) work at all is the least reliable one either platform
offers.

**(c) Restate the policy in one `security definer` function, pinned textually in the suite.**
Chosen. It is what `060` already did — `private.can_read_ride`'s own comment says *"IT RESTATES A
POLICY AND CAN GO STALE: clubs SELECT's qual is pinned textually in supabase/tests/rls_test.sql
§060.1b"* — and `align-fanout-recipients-with-readability` predicted this exact caller:
*"comes next: ride reminders, 'ride updated', push delivery and the Inbox epic all need the same"*.

So `public.push_payload_for(notification_id uuid)` — granted to `service_role` alone — returns
either a payload or nothing, having required **every** conjunct `036` §3 requires:

| Conjunct | Predicate |
|---|---|
| recipient scope | the row's own `user_id` |
| block, both directions | `private.is_blocked(user_id, actor_id)` — already takes both parties |
| actor resolves *(every type)* | `private.can_read_profile(user_id, actor_id)` — **new** |
| `postcard_liked` | `private.can_read_postcard(user_id, postcard_id)` — **new** |
| `postcard_commented` | `can_read_postcard` **AND** `private.can_read_comment(user_id, comment_id)` — **new** |
| `ride_joined` | `private.can_read_ride` — `060` |
| `club_joined` | `private.can_read_club` — `060` |
| `ride_created_in_club` | `can_read_ride` **AND** `can_read_club` — both, `060` |

The three new predicates complete the family `060` started and take the same shape: candidate as
an argument, `security definer`, `search_path` pinned, revoked from `public`/`anon`/
`authenticated`, and a comment saying which policy they restate and where that policy's qual is
pinned. **`ride_created_in_club` takes both conjuncts and the derivation "ride implies club" is
refused here for the reason `036` §3 already gives** — it holds against today's `rides` policy,
that policy has been rewritten twice, and nothing constrains it to keep the property.

**Returning nothing is a suppression, not a failure.** The outbox row is marked `suppressed` and
never retried, because the answer will not improve.

### D6 — A delivered push cannot be withdrawn, and that is stated rather than mitigated

Everything above makes the payload correct *at the instant it is sent*. Nothing makes it correct
afterwards. A rider blocked one second after delivery keeps the string in their notification
centre until they swipe it away; so does a rider removed from a private club.

There is no mitigation and the design does not claim one. iOS and Android both offer a
"replace/remove a delivered notification" API keyed on a collapse id, and using it would require
a *second* scheduled job re-checking every delivered push — an unbounded sweep that would itself
be a standing query over every rider's visibility. Rejected.

**What is done instead is to keep the exposure as small as the mechanism allows and write the
residue down.** The window is the scheduler interval plus APNs/FCM transit, i.e. seconds; the
in-app row disappears correctly on the next read, because `036` §3 is untouched; and the standing
`notifications` requirement gains a scenario saying in as many words that a delivered push is
outside the database's reach. `database-enforced-integrity`'s *"A derived row SHALL NOT hold a copy
of a visibility decision"* is modified for the same reason — a push payload is precisely such a
copy, this is the one place the schema has to permit one, and an unstated exception becomes an
unbounded one.

**The lock screen is a second surface and it is deliberately not treated as a third audience.**
A private club's name reaches the lock screen of a rider entitled to read it. Both platforms ship
a per-app *hide previews when locked* setting, that setting is the rider's own control, and
building a second one in-app would be a preference this change has otherwise decided not to have
(D9). Recorded as a decision so it is not rediscovered as an oversight.

### D7 — The token's retention window is 60 days, and it is implemented rather than asserted

`036` refused to write a number: *"nothing implements it, no `pg_cron` and no scheduled Edge
Function exist in this project, so a 90-day claim would be an unlabelled guess promoted to a fact
in the one artifact a future session reads as authoritative."* That reasoning was right and this
change discharges it rather than contradicting it — **the scheduler is being built here**, so the
sweep runs in the same job as the sender and the number is enforced.

A token row dies in four ways, three of them event-driven:

1. **Sign-out** — `release_push_token(token)` before the revocation (D8).
2. **Account deletion** — `on delete cascade` from `profiles`, joining the eleven FKs
   `add-account-deletion` enumerated. Asserted in the suite alongside them.
3. **APNs 410 `Unregistered` / 403 `BadDeviceToken`, FCM `UNREGISTERED` / `INVALID_ARGUMENT`** —
   deleted immediately, by the delivery function, through `claim_push_batch`'s companion. **Never
   on a transport error**: a 5xx, a timeout or a 429 retries with backoff and leaves the token
   alone, because deleting a live token on a provider outage silently unsubscribes every rider.
4. **60 days with no successful delivery and no re-registration** — `last_seen_at`, swept.

**`last_seen_at` is server-owned** and a rider cannot write it, which follows
`database-enforced-integrity`'s standing rule about a column the server owns; here it is trivially
satisfied, because no client role can write the table at all.

**And a cap: ten tokens per rider, most recent kept.** Enforced in `register_push_token`, not by a
CHECK, because a CHECK cannot count siblings. Without it a rider is an unbounded fan-out
multiplier and the delivery job's per-notification cost is unbounded — `event-fanout-integrity`'s
*"A fan-out SHALL be bounded and SHALL NOT be assumed small"* applied one table further down.

### D8 — Sign-out releases the token first, and the residual window is closed by the next boot rather than claimed closed

`signOut()` today does four clears, all local, all protecting the rider who just left.
`release_push_token` is a fifth and the first that is a **server** write, and the first whose
failure harms somebody else.

**Order matters and the existing function already teaches it.** `clearSessionStore()` runs *after*
the revocation because clearing first would take the refresh token away from the call that needs
it. `release_push_token` is an authenticated RPC, so it runs **before** `supabase.auth.signOut()`
for the same reason.

**When it fails — offline, which is the normal case for a rider walking away from a bike — the
rider still signs out.** That is the existing requirement's answer and it stands: *"a rider who
pressed Sign out and is still signed in is the worse outcome by far."* But it leaves the exact
hazard D3 exists to prevent, so the window is closed at the other end:

> **The app calls `register_push_token` on every cold start while a session exists**, not only on
> first grant. Because `register_push_token` deletes any row carrying that token first, the next
> rider's first launch re-homes the device unconditionally.

That makes the window *"until this device is next opened by whoever holds it"* rather than
*"for ever"*. It is not zero and the spec says so. Making it zero would need the token released
without a session, which nothing can authorise.

**A second, cheaper closure is deliberately not taken:** having the delivery function verify the
token still belongs to the notification's recipient. It does, by construction — the claim reads
tokens by `user_id` — so the check would pass in exactly the case that is broken, which is a check
that looks like a defence and is not.

### D9 — No per-category preferences in v1, and the condition that reopens it

The OS switch is the control. Both stores accept an app whose only notification preference is the
system one, the standing `notifications` spec already lists per-type preferences among the
surfaces it deliberately did not build, and a preference table is a second visibility-ish decision
to keep in sync with a fan-out that already has five types.

**The cost is real and one-sided:** iOS's switch is per-app, so a rider who mutes a chatty
category mutes their ride reminders too. That is acceptable while the only categories are `036`'s
five, which are all low-volume by construction — one row per like, comment, RSVP, ride or join,
each collapsed by `036` §9's uniqueness index.

**The condition that reopens it, stated so it is not a judgement call later: the first
high-volume category.** Ride chat is the named candidate — a busy thread is dozens of rows an
hour. **If chat push ships, preferences ship in the same change**, or the first busy ride teaches
every rider on it to turn LetsRide notifications off entirely, which is not recoverable.

**What v1 does owe the rider instead:** when `pushPrimingState` reads `blocked`, the sheet says
where the OS setting is, in the `blocked` mode PD-170's sheet already has.

### D10 — The ride reminder writes a `notifications` row first, and it is not built here

The *"your ride is tomorrow"* reminder is a schedule with no notification row behind it, and the
question is whether it writes one or delivers directly. **It writes one**, for three reasons and
against one real cost.

- The in-app list and the push must agree. A push with no row is a notification a rider cannot
  find again thirty seconds later, on the one screen built for finding notifications.
- The recipient set is `private.can_read_ride(candidate, ride)` over the crew — the same predicate
  `060` already wrote for `ride_joined`, applied to the same people. Delivering directly means a
  second recipient computation for the same audience, which is the *"two mechanisms for one
  event"* defect `036` refused for club postcards.
- The badge, the read state and the block re-check all come free from `036` §3.

**Three things make it a different change rather than a bigger one, and they are stated here so
that change does not decide them from scratch:**

1. **A sixth type.** `ride_upcoming` extends `notifications_type_check` *and*
   `notifications_subject_shape` — and that CHECK's `else false` is load-bearing: adding the type
   to one and not the other admits a row with no subject, which the policy returns with nothing to
   render.
2. **`actor_id` is `not null` and a reminder has no actor.** The organizer is the only defensible
   value, which means the organizer is *both* actor and recipient — the first deliberate exception
   to `event-fanout-integrity`'s *"A rider SHALL NEVER be notified of their own action"*. A
   reminder is not the organizer's action, so the exception is sound; but it is a **modified
   standing requirement**, not an implementation detail, and it must be written as one. The
   alternative — making `actor_id` nullable — is worse: `036` §3 makes the actor a rendered
   resource and therefore a conjunct on **every** row, so a nullable actor breaks the read policy
   for all five existing types to serve a sixth.
3. **Idempotence.** A reminder must fire once per (ride, rider) however many times the sweep runs,
   which is a uniqueness partial index in `036` §9's shape, not a `delivered` flag on a job row.

Filed as **child D — *"Your ride is tomorrow" — the first scheduled notification*** — depending on
C for the scheduler and on nothing else.

### D11 — `@capacitor/push-notifications`, and which of `delete-account`'s four rules survive

**The plugin, in one sentence per `.claude/agents/native.md`:** *Apple and Google hand a device
token only to native code, so there is no route from the webview to APNs or FCM at all; this
plugin is that route and nothing in the dependency tree substitutes for it.* Pinned exact, like
every other Capacitor package, for Capacitor's own move-together requirement. It brings the iOS
Push Notifications capability and `aps-environment` entitlement, and on Android 13+ the
`POST_NOTIFICATIONS` runtime permission — which is a second prompt, on a second platform, with
different one-shot semantics from iOS's, and `pushPrimingState` has to be right for both.

**`delete-account`'s four rules, each ruled on rather than inherited:**

1. **The key lives only in the function's secret store — APPLIES, and widens.** Three more
   secrets: the APNs `.p8` (a PEM private key), its key id and team id, and the FCM
   service-account JSON. `src/__tests__/no-service-role-key.test.ts` gains a detector for each
   format and — per its own convention — proves each detector still catches a real key, because a
   guard that has stopped matching passes for ever and looks exactly like a clean repo.
2. **It takes no user id — DOES NOT APPLY AS WRITTEN, and is replaced by something stronger.**
   This function is not called by a rider at all. It takes **no arguments from anyone**; its
   subject set comes from `claim_push_batch`. What replaces the rule is the caller check: the
   verified JWT's `role` claim must be `service_role`. `verify_jwt: true` alone is *not* that
   check — any signed-in rider's own access token satisfies it, exactly as the publishable key
   does for rule 3.
3. **It verifies the JWT itself — APPLIES, and is sharper here.** Both Supabase keys are valid
   JWTs differing only in a `role` claim, so a decode-only check that reads `role` without
   verifying the signature is forgeable by anyone who can type. Verify the signature, *then* read
   `role`.
4. **Nothing type-checks it — APPLIES, unchanged.** `tsconfig.json` excludes
   `supabase/functions`. This is the least-guarded code in the repo and it now holds the largest
   secret set in it.

**A fifth rule this function needs and `delete-account` did not:** *it issues no `.from()`.* Its
whole database reach is three function names, which is what keeps a service-role key from being a
general-purpose bypass of the layer this project's bugs come from.

### D12 — What is reused from PD-170's priming, and the three things that are genuinely different

**Reused, deliberately and structurally:** the `ContextMenu`-based sheet (scrim, portal, focus
trap, Escape); the `ask` / `blocked` two-mode explainer; the rule that **only `Continue` reaches
the OS API**, so the one-shot prompt is always spent by a deliberate tap; the pure decision
function with its own test file, split out for the reason `resolveComboboxKey` and `guard.ts` were
— eight inputs' worth of states, one of which is a rendering question; and the copy discipline,
because Apple reads the in-app rationale beside the usage string and a vague one is a routine flag.

**Genuinely different, and each one a trap if inherited rather than re-derived:**

1. **There is no fallback.** `locationPrimingState` returns `hidden` for a rider who already has a
   position, because the geocoded onboarding city keeps the near-you strip and the club distances
   working — *"the row is for the state where the feature is otherwise INVISIBLE"*. Push has no
   approximate answer. A rider who declines gets nothing, for ever, and on iOS the only route back
   is Settings. So the push row is **persistent while the permission is not granted**, where
   location's disappears the moment any position resolves, and the `blocked` mode carries far more
   weight.
2. **The web build is `unavailable` in its entirety.** `locationPrimingState`'s `unavailable`
   is a per-platform edge case; here it is the whole web app, permanently, because Web Push is
   settled against. `pushPrimingState` returns `hidden` on any non-native platform without
   consulting anything else — checked through `Capacitor.isNativePlatform()`, the same guard
   `secure-store.ts` already uses.
3. **A third state location has no analogue for: granted, registered, and no token ever
   arrived.** Location is one step — permission, then a fix. Push is two: `requestPermissions()`,
   then `register()`, then a `registration` **event** that may never fire — a missing
   `aps-environment` entitlement, a misconfigured FCM project, or no network all produce a granted
   permission and no token, with **no user-visible symptom at all**. `pushPrimingState` must be
   able to say so, the app must not report success on the permission alone, and this is the state
   most likely to ship broken because every gate in this repo is green while it is happening.

**Where the row draws: the top of `/notifications`, and nowhere else.** It is the one screen where
the offer is self-evidently relevant, and the rider standing on it is by definition interested in
notifications. The cost, stated: a rider who never opens `/notifications` is never asked.
The alternative — a one-time sheet after onboarding completes — converts better and spends the
one-shot prompt on a rider who has seen nothing the app does yet. Open question **Q3**; the row is
the recommended default.

**Never during onboarding.** `register_push_token` restates `private.may_participate()` (D13), so
a pre-completion registration would be refused; and spending iOS's single lifetime prompt on a
rider who has not finished signing up is the worst possible moment for it.

### D13 — The participation gate is restated inside the RPC, and the trigger is deliberately absent

`enforce_participation_gate` is on eleven tables and not on six. The instinct is to make
`push_tokens` the twelfth. **It must not be, and putting it there would be worse than leaving it
off**, for a mechanical reason:

> Every one of those eleven triggers carries `for each row when (current_user = 'authenticated')`.
> Inside a `security definer` function `current_user` is the **owner**. `push_tokens` is written
> **only** by `security definer` RPCs. So the trigger would never fire, on any write, ever — and
> it would appear in `select count(*) from pg_trigger where tgname =
> 'enforce_participation_gate'`, making the count read twelve and the coverage read complete.

That is precisely the failure `CLAUDE.md` warns about in the same paragraph — *"a table added
without one looks exactly like this list being right"* — arriving from the opposite direction: a
table added **with** one that does nothing.

**So the gate is restated inside `register_push_token`**, as `CLAUDE.md` requires of the three
own-row RPCs that own the profile stamps: *"Each restates the invariants its triggers carry, and
must."* `if not private.may_participate() then raise ... using errcode = 'check_violation'`, so
the error code a client sees is the `23514` the gate already raises and no caller needs a second
branch.

`release_push_token` is **not** gated. A rider must always be able to release a device, including
one whose account is in whatever state; refusing a release is refusing to stop sending them push.

## Risks / Trade-offs

- **The token table is the one thing here that is unfixable later.** Ten thousand devices
  registered under `unique (user_id, token)` cannot be de-duplicated after the fact — nothing
  records which pairing is current. This is why child A is cut to land first and alone, and why
  D3 is the longest decision in this file.
- **The payload function restates a policy and can go stale.** `060` accepted the same risk with
  the same mitigation, and the mitigation is a textual pin in `supabase/tests/rls_test.sql` that
  fails the moment `notifications` SELECT's qual changes. Without the pin this is a leak with a
  clean-looking policy set.
- **Everything that actually delivers is unverifiable here.** No Mac, no device, no APNs sandbox,
  no FCM, no `supabase` CLI, and `tsconfig.json` does not even type-check the function. The
  honest reading is that child C merges *verified to compile and not verified to work*, which is
  the lower-fidelity artifact `CLAUDE.md` §Working Principles requires be labelled rather than
  passed silently. The tasks list marks each such box.
- **A scheduled job on a free-tier project that auto-pauses after ~7 days idle.** A paused project
  runs no schedule, so push stops with no alert — one more reason on the pile for Pro before
  launch.
- **A fourth Edge Function is a fourth thing that goes stale on merge.** Deploying is an owner
  action, CI has no path that would notice, and this repo currently runs three functions none of
  which is current against its file. This one's staleness is silent in a new way: a stale
  *delivery* function keeps delivering, using the previous payload rules.
- **The outbox trigger starts writing rows the moment `079` applies.** If it applies before
  anything drains it, the table grows with nothing reading it. Additive first, deploy, then
  schedule — the third instance of the ordering `023`/`025` and `069`/`070` already taught.
- **Ten dependencies instead of nine.** Deliberate, justified in D11, and the first runtime
  dependency added since the secure-storage plugin.

## Open Questions

Every one carries a recommended default so the build is never blocked on an answer, and names who
can answer it. **Blocking** means the build cannot proceed correctly without it.

| # | Question | Who | Blocking | Recommended default |
|---|---|---|---|---|
| **Q1** | Sub-minute scheduling: is the scheduler extension available on both projects, and does it support intervals below one minute? | owner | **yes, for child C** | 30s where supported, 1 min otherwise; build against 1 min so the shorter interval is a tuning change |
| **Q2** | The APNs environment for `app-dev` — a separate sandbox key, or the same key against the sandbox host? | owner | **yes, for child C** | one `.p8` per team works for both; the *host* differs, so make it a function secret rather than a build constant |
| **Q3** | Where the priming row draws: the top of `/notifications`, or a one-time sheet after onboarding? | product owner | no | the row (D12) — it never interrupts, and a rider on that screen is self-selected |
| **Q4** | Does a push carry the private club's name / private ride's title, given it renders on a lock screen? | product owner | no | yes. The recipient is entitled to it and both platforms ship a per-app hide-previews control; building a second one contradicts D9 |
| **Q5** | Retention: is 60 days the right idle window for a token? | product owner | no | 60 days. Long enough that a rider on holiday is not silently unsubscribed, short enough that a sold phone stops receiving |
| **Q6** | The per-rider token cap — ten? | product owner | no | ten. A rider with more than ten live devices is a bug or an abuse case, not a rider |
| **Q7** | Does a foreground push draw anything, or only invalidate the cache? | product owner | no | invalidate only. An in-app banner duplicating a row the rider is looking at is noise, and the badge already moves |
| **Q8** | Is a delivered push acceptable as permanently un-withdrawable (D6)? | product owner | no | yes, and written into the spec rather than left implicit. There is no mechanism that would make it otherwise without an unbounded standing sweep |

## Unverified

Recorded per `CLAUDE.md` §Working Principles: an inferred value must never pass silently as a
measured one.

**Three of these were closed by the main thread on 2026-08-25, immediately after this file was
written**, from a session where both connectors resolved. What is recorded below is what each one
turned out to be, not what it was feared to be — the entries stay because the *reason* they were
unverified outlives the answers.

- ~~**The Linear issue PD-291 was not read.**~~ **CLOSED — read, and it has NO comments.** The
  body is the whole issue, and it says what the spawning brief attributed to it: an epic, a
  two-PR split, `@capacitor/push-notifications`, a device-token table, an Edge Function that
  delivers, fan-out from the six `private` triggers plus a scheduled reminder, priming in PD-170's
  pattern, and the two owner-held credentials. **Nothing in it contradicts a decision here.**

  **Two decisions above deliberately DEPART from the issue's wording, and both are departures
  rather than oversights** — flagged here so the next reader does not "correct" them back:

  1. The issue says the token table holds *"one row per device per rider"*. This proposal makes
     the uniqueness **`unique (token)`**, not `unique (user_id, token)`. Read literally, the
     issue's phrasing keeps two live rows for a shared phone, and rider A's notifications then
     render on rider B's lock screen with every RLS policy working exactly as designed.
  2. The issue says *"own-row RLS"*. This proposal grants **no SELECT at all**, not even own-row
     (`026`'s shape: RLS on, no policy). Own-row SELECT is what would make
     `register_push_token`'s delete-by-token unsafe.

- ~~**The live database was not queried.**~~ **CLOSED, and the answer changes Q1.** Measured
  2026-08-25 against **both** projects with `list_extensions`:

  | | PROD `zwprydcyryvudhurbnye` | DEV `fpmrimzxadewsaiwpsel` |
  |---|---|---|
  | `pg_cron` | available `1.6.4`, **not installed** | available `1.6.4`, **not installed** |
  | `pg_net` | available `0.20.4`, **not installed** | available `0.20.4`, **not installed** |

  So the inference was right that neither is *installed*, and wrong about what that implies:
  **both are available on this project and are one `create extension` away**, on the free tier as
  it stands. Q1 is therefore not "does a scheduler exist" — it does — but only "does it support
  the interval child C wants", and the 1-minute default this proposal already builds to is inside
  `pg_cron`'s documented range. **Installing either is still a decision, not a formality**: an
  extension is a new surface, and `pg_net` in particular is the mechanism D-whichever rejects for
  the enqueue path.

  Migration numbers re-derived at the same time: the repo holds **77** files and **both** projects
  are at `077`, so `078`/`079` are free and correct as written.
- **The advisor count.** D4 predicts an eleventh expected security advisor
  (`rls_enabled_no_policy` on `push_tokens`). Not measured — `get_advisors` was unreachable.
