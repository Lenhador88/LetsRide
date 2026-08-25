# Deliver push notifications

## Why

**Everything upstream of the phone already works, and the last hop does not exist.** `036` writes
`notifications` rows from six fan-out triggers, `060` made their recipient sets match the read
policies, and `/notifications` renders them with a badge. A rider learns that somebody joined
their ride when they next open the app — which for the two cases this feature exists for, *the
group is leaving* and *your ride is tomorrow*, is exactly too late. PD-291's title is accurate:
nothing this app produces ever reaches a phone.

**This is the delivery hop and nothing else.** The table, the triggers, the recipient sets, the
read policy, the list screen, the badge and the unread RPC all exist and none of them changes
shape here. What is missing is a device token, a scheduled sender, and the credentials to talk to
APNs and FCM.

**The standing `notifications` spec named push delivery as a surface it deliberately did not
build**, alongside per-type preferences and a dismiss control, on the reasoning that *"a control
that renders and does nothing is a worse artifact than an absent one"*. This change is the
sanctioned way that requirement gets modified rather than quietly contradicted.

**It is blocked on three things no session can produce, and the proposal is what can be written
without them.** An APNs auth key (`.p8`) from App Store Connect, an FCM project with its service
account and `google-services.json`, and a scheduler extension enabled on both Supabase projects.
Add the Edge Function deploy, which is an owner action on every change under
`supabase/functions/`. Writing the design now means the day those arrive the build starts from a
decided shape rather than from a design question.

**And the sharpest risk here is not delivery, it is misdelivery.** A device token is a
per-device secret that outlives a sign-out unless something removes it. A stale one means rider
B's phone shows rider A's notifications — the only failure in this app where one rider's data
lands on another rider's lock screen without any policy having been wrong. That is a schema
decision (`unique (token)`, not `unique (user_id, token)`) and a sign-out decision, both taken
below, both cheap now and unfixable after the first thousand devices have registered.

## What Changes

- **PD-291 does not close on the first PR, and this proposal says where it does close.** The
  issue is an epic. It names *delivery to a phone*, so the story closes when a notification
  written by `036` appears on a real device — which is the third of three children below, not the
  first. Per `CLAUDE.md` §The roadmap lives in Linear, a story closes when the thing it names
  exists; the first PR ships a table nobody can observe.

  **The split falls on the blocker, not on the layer.** Each child is defined by what it is
  waiting for, so that the one child waiting for nothing can merge today:

  | Child | Title | Blocked on | Gated by |
  |---|---|---|---|
  | **A** | *Push tokens — a table nobody may read* | nothing | the RLS suite, in full |
  | **B** | *Register the device, and spend the one prompt deliberately* | a Mac, an Apple Developer provisioning profile, an FCM project | nothing that runs here |
  | **C** | *Deliver a notification to a phone* | the APNs `.p8`, the FCM service account, a scheduler extension, an owner deploy | nothing that runs here |

  **PD-291 closes on C.** A and B stay open under it, or are filed as children and PD-291 stays
  open until all three land — either is fine, and closing PD-291 on A is not.

  This is a **three**-way split rather than the two the issue sketches (*"the plugin + token table
  is one PR, delivery is another"*), and the reason is concrete rather than a preference: the
  token table is fully gated by `supabase/tests/`, and the plugin is verifiable on no machine in
  this container. Bundling them holds the one landable, fully-asserted migration hostage to a
  native change nothing here can exercise.

- **A new table, `public.push_tokens`, that no client role may read — including its owner.**
  One row per device. `authenticated` holds **no** SELECT, INSERT, UPDATE or DELETE grant of any
  kind; every write goes through two own-row `security definer` RPCs, and the only reader is the
  delivery function through a third RPC granted to `service_role` by name. This is stricter than
  `notifications` — which at least its recipient can read — and the reason is that a device token
  is a bearer credential for a push channel, not a record about a rider.

- **`unique (token)`, and re-registration *moves* the row rather than adding one.** A device
  belongs to exactly one rider at a time. Two riders sharing a phone is the normal case for a
  motorcycle club, and `unique (user_id, token)` leaves both rows alive and pushes rider A's
  notifications onto rider B's screen for ever.

- **A per-notification outbox and a scheduled sender.** An `AFTER INSERT` trigger on
  `notifications` writes one `push_deliveries` row — a local insert, no network, inside the
  rider's transaction. A scheduled Edge Function claims a batch, re-checks that the notification
  is still readable *by its recipient*, renders the copy, sends to every live token, and records
  the outcome. **The enqueue is trigger-driven and the delivery is scheduled**, which is the
  answer to that question rather than a dodge: the two halves have opposite failure requirements
  and putting both on one mechanism gets one of them wrong.

- **`@capacitor/push-notifications`** — one native plugin, and its one-sentence justification:
  *Apple and Google hand a device token only to native code, so there is no route from the webview
  to APNs or FCM at all; this plugin is that route and nothing in the dependency tree substitutes
  for it.* It brings the iOS Push Notifications capability, the `aps-environment` entitlement, and
  on Android 13+ the `POST_NOTIFICATIONS` runtime permission.

- **A priming sheet built on PD-170's shape, not a second one.** `LocationPrimingSheet`,
  `UseMyLocationRow` and the pure `locationPrimingState` are the precedent and this change reuses
  their structure — a `ContextMenu` sheet, an `ask`/`blocked` two-mode explainer, only `Continue`
  reaching the OS API, and a pure decision function with its own tests. **Three things are
  genuinely different** and are stated rather than inherited: there is no useful fallback (a rider
  who declines location still has a geocoded profile city; a rider who declines push gets
  nothing, for ever), the web build is `unavailable` in its entirety rather than per-platform, and
  push has a third state location has no analogue for — *granted, registered, and the token never
  arrived*, which is a silent failure with no user-visible symptom.

- **`signOut()` gains a fifth clear, and it is the first one that is somebody else's problem.**
  `clearQueryCache`, `clearGuardCache`, `clearRiderLocation` and `clearSessionStore` all protect
  the rider who just left. Releasing the device token protects the rider who signs in next. It
  runs **before** the revocation, because it needs a live session; and when it fails — offline —
  the rider still signs out and the window is closed by the next cold start rather than claimed
  closed here.

- **No per-category preferences in v1**, and the OS switch is the control. Recommended as the
  smaller thing, with the condition that reopens it stated: the first high-volume category a rider
  would plausibly want off on its own is ride chat, so if chat push ships, preferences ship with
  it.

- **The retention window for a token is stated *and implemented*: 60 days without a successful
  delivery or a re-registration.** `036` refused to state a number because nothing in this
  project could implement one. This change builds the scheduler, so the sweep runs in the same
  job as the sender and the number is enforced rather than asserted — which is the way that
  earlier refusal is discharged rather than contradicted.

**Explicitly not in this change:** the *"your ride is tomorrow"* reminder (decided below, built
elsewhere — it needs a sixth notification type and the first deliberate exception to *"a rider
SHALL NEVER be notified of their own action"*, which is `notifications`-epic work, not
push-delivery work); ride-chat push; a "your devices" management screen; per-category
preferences; a notification-tap analytics path; Web Push, a service worker or a manifest, all
three of which belong to a render model this app has left; and any in-app banner for a push
received while the app is foregrounded beyond invalidating the cache.

## Capabilities

### New Capabilities

- `push-registration`: the device token as a per-device secret — who may hold one, who may read
  one (nobody), what happens when it moves, rotates, is refused by APNs, outlives a sign-out, or
  is one of five on the same rider's account. Owns `unique (token)`, the absent grants, the two
  own-row RPCs, the participation gate that is deliberately *not* a trigger, and the retention
  window.
- `push-delivery`: the outbox, the schedule, the recipient re-check and the payload. Owns the
  rule that the delivered text is exactly what the recipient could have read for themselves at
  the moment it was sent, the handling of a token APNs or FCM reports unregistered, and the
  boundary between a fan-out failure (must be loud) and a push failure (must be silent to the
  rider whose write caused it).
- `push-permission-priming`: the one-shot OS prompt — when it is spent, what is read first, and
  every state the row and the sheet can be in, including the two the location precedent has no
  analogue for.

### Modified Capabilities

**Five of the eight standing capabilities are modified, and three are read and deliberately
untouched.** Every one was read requirement by requirement before this list was written.

- **`notifications`** — MODIFIED `The surfaces this change does not build SHALL be named rather
  than half-built`. That requirement names push delivery and per-type preferences in one breath as
  absent-not-disabled. Push delivery ships; per-type preferences stay absent but for a *different*
  reason, which has to be restated or the requirement reads as satisfied by inertia. Plus one
  ADDED requirement: a notification is pushed **at most once**, and a delivered push is a copy of
  a read decision that has left the database's reach and cannot be withdrawn.
- **`event-fanout-integrity`** — MODIFIED `A fan-out failure SHALL NOT be silently swallowed` and
  `A fan-out SHALL NOT write a row that the read policy can never return to its recipient`. The
  first has to grow a boundary: the notification write must still take the rider's transaction
  down if it raises, and the *push* must never be able to, because a dead APNs must not fail a
  like. Stating "not swallowed" without that boundary is how the enqueue ends up making an
  outbound call inside a rider's like. The second extends from the notification row to the outbox
  row: enqueuing a push for a notification whose subject never resolved is the same defect one
  table further down.
- **`database-enforced-integrity`** — MODIFIED `A derived row SHALL NOT hold a copy of a
  visibility decision` and `Every role's reach into a rider's identity SHALL be stated`. A push
  payload **is** a copy of a visibility decision — the one this schema has to permit, because a
  notification with no text is not a notification — so the requirement must state the conditions
  under which one may be produced instead of being contradicted by the first payload written. The
  second gains `service_role`'s reach, which today is stated only for `delete-account`, and gains
  the device token as a thing that is *about* a rider and readable by none of the roles that can
  read the rest of them. Plus one ADDED requirement: a per-device bearer secret SHALL be readable
  by no client role, its owner included.
- **`client-session-storage`** — MODIFIED `Sign-out SHALL destroy every local trace of the rider`.
  Sign-out acquires a **server-side** obligation for the first time, and it is the only item on
  that list whose failure harms the next rider rather than the last one. The requirement's
  existing offline scenario resolves in favour of signing out anyway; that answer is kept, and the
  residual window it leaves is stated and closed by a rule elsewhere rather than waved at.
- **`client-cache-invalidation`** — MODIFIED `Every mutation SHALL declare what it invalidates`.
  A push received while the app is foregrounded is the first signal in this app that another
  rider's mutation happened, arriving outside both the mutation path and the Realtime path. It
  declares keys like a mutation does, or `/notifications` shows a badge whose list does not move.

**Read and deliberately not modified**, so that this is a conclusion rather than an omission:

- **`client-render-shell`** — the priming row's states and the "does not flash" rule are
  `push-permission-priming`'s own, and stating them again here would be a second copy. Nothing
  about first paint, offline, or the empty-versus-forbidden distinction changes.
- **`realtime-subscriptions`** — push is not a subscription. It opens no channel, and its "not a
  delivery guarantee" requirement already covers the analogous claim without needing to name push.
- **`ride-chat`** — chat push is out of scope by name, and nothing about chat visibility,
  retention or state moves.

**Nothing is REMOVED and nothing is RENAMED.** No SELECT policy on any existing table changes,
and the `notifications` read policy in particular is untouched — the delivery path restates it,
under a pin, rather than widening it.

## Impact

**Database.** New migrations from **`078`** — re-derive with `ls supabase/migrations/` against
`list_migrations` rather than trusting that number, which has moved underneath a proposal in this
repo before. One new table with no client grants, one outbox table, one `AFTER INSERT` trigger on
`notifications`, three `security definer` functions in `public` (two granted to `authenticated`,
one to `service_role` alone), and three new `private.can_read_*` predicates completing the family
`060` started. **No existing SELECT policy changes.**

**`031`'s lesson applies directly and is the most likely way this ships broken.** `service_role`
holds no EXECUTE on anything in `private`, and PostgREST routes only to `public` — so
`supabase-js`'s `.schema('private')` is refused before it reaches Postgres. Every function the
delivery Edge Function calls must live in `public` and be granted to `service_role` **by name**,
and the assertion that catches a mistake names the role — `has_function_privilege('service_role',
…)` — rather than calling the function, because the RLS suite runs as the table owner for whom
neither barrier exists.

**Code.** `package.json` gains one runtime dependency (ten, from nine).
`src/lib/push/` — a new directory: the pure `pushPrimingState`, the registration lifecycle, the
token release. `src/components/push/PushPrimingSheet.tsx` and `PushPrimingRow.tsx`, both modelled
on `src/components/location/`. `src/lib/actions/auth.ts` (`signOut` gains its fifth clear).
`src/lib/query/keys.ts` (the push registration state). `src/app/(app)/notifications/page.tsx` (the
row's one call site). `capacitor.config.ts` and both native projects, neither of which has ever
been generated here.

**Supabase.** A fourth Edge Function, and the second to hold a service-role key. It differs from
`delete-account` in the one way that matters for review: **it is not called by a rider at all**,
so *"it takes no user id"* is replaced by *"it takes no arguments from anyone and refuses every
caller whose verified JWT is not `role: service_role`"*. A signed-in rider's own access token
passes `verify_jwt`; that is what the check exists for.

**Secrets.** Three more, all in the function's own secret store and nowhere else: the APNs auth
key (`.p8`, a PEM private key), its key id and team id, and the FCM service-account JSON.
`src/__tests__/no-service-role-key.test.ts` gains detectors for both new formats — and, per its
own self-check convention, proves each detector still catches a real key rather than passing
because it stopped matching.

**Tests.** Every migration pairs with assertions in `supabase/tests/rls_test.sql`. The table's
whole contract is assertable there and most of it is a grant assertion naming a role. Two things
are **not** assertable anywhere in this repo and are named as such rather than left to look
covered: the plugin's registration callback, and any byte ever reaching APNs or FCM.

**Nothing about the native or delivery half is testable in this container.** No Mac, no Xcode, no
device, no Android SDK, no APNs sandbox, no `supabase` CLI. `capacitor.config.ts` already carries
that constraint for the shell; it now covers a permission prompt, a registration callback, a
token round trip and every byte of delivery. The tasks list marks each such box **[device]** or
**[owner]** so a green CI run is never mistaken for a working feature.

**Sequencing.** Child A is additive and lands on its own. Child C's migration — the outbox
trigger — is additive too, but it starts writing outbox rows the moment it applies, so it must
not apply until something drains them or the table grows unboundedly with nothing reading it.
That ordering is *additive first, deploy, then schedule*, which is the same shape `023`/`025` and
`069`/`070` taught, arriving at a third pair.
