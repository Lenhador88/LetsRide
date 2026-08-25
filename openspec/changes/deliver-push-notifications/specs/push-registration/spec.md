## Purpose

The device token as a per-device bearer secret: who may hold one, who may read one, what happens
when a device changes hands, when a token rotates, when a provider refuses it, and when a rider
signs out without a network. Every requirement is a statement about a role and a resource so each
maps onto an assertion in `supabase/tests/rls_test.sql` — with two exceptions named as such, the
security-advisor sweep and anything only a real device can exercise.

## ADDED Requirements

### Requirement: A device token SHALL be readable by no client role, including the rider it belongs to

`public.push_devices` SHALL grant `authenticated` **no** SELECT privilege, and SHALL carry no
SELECT policy. `anon` SHALL hold nothing of any kind. There SHALL be no RPC, view, count,
aggregate or error message through which any client role learns a token value, learns how many
tokens a rider has, or learns whether a given rider has any.

This is stricter than every other table in this schema, `notifications` included — that one is at
least readable by its recipient. The reason is that a device token is not a record *about* a
rider, it is a **bearer credential for a channel that reaches their lock screen**. Anything that
can read it can silence them, and under the registration rule below it can also steal their
device's registration.

**RLS SHALL be enabled with no policy at all**, following `026`'s `password_reset_grants`. The
`rls_enabled_no_policy` INFO advisor that produces is correct by design and SHALL be added to the
expected-advisor table in `CLAUDE.md`, because an advisor that is expected but undocumented is
indistinguishable from a new one.

#### Scenario: No client role holds any privilege on the table
- **WHEN** the table exists
- **THEN** `has_table_privilege('authenticated', 'public.push_devices', <priv>)` SHALL be false for
  each of SELECT, INSERT, UPDATE, DELETE, and likewise for `anon`
- **AND** the assertion SHALL name the role rather than attempting a statement, because the RLS
  suite runs as the table owner for whom neither the grant nor RLS applies — `031`'s lesson

#### Scenario: A future devices screen does not arrive as a grant
- **WHEN** a "your devices" surface is eventually wanted
- **THEN** it SHALL be an own-row `security definer` RPC returning `platform` and `last_seen_at`
- **AND** it SHALL NOT return `token`, and SHALL NOT be implemented by granting SELECT on the
  table, because that grant is what makes the registration RPC below safe

#### Scenario: Nobody else can reach it either
- **WHEN** a club owner, a ride organizer, a club admin, a fellow member, a non-member, a blocked
  rider or a signed-out visitor attempts to read `push_devices` by any route
- **THEN** every one of them SHALL be refused
- **AND** this SHALL follow from the absent grant rather than from a policy, so no future policy
  can widen it

### Requirement: The unique key SHALL be the installation, and a device SHALL belong to exactly one rider

`public.push_devices` SHALL carry `unique (installation_id)`. The provider token SHALL be a
**mutable attribute** of that row, and SHALL NOT be part of any unique key. Registering an
installation that already exists SHALL update it in place — moving it to the registering rider if
that has changed, and replacing its token if that has changed — and SHALL NOT produce a second
row.

A push token is issued by APNs or FCM to an *installation*, not to an account, so two riders
sharing a phone is the normal case for a motorcycle club. **But a token is not a stable name for
an installation either, because it rotates** — and keying on one produces a leak that survives
every other control in this specification:

> A device rotates T1 → T2. Under `unique (token)`, both rows are live and owned by the same
> rider. That rider signs out; a release naming the token the device currently presents takes T2
> and **leaves T1**. The next rider signs in, and cold-start re-registration re-homes T2 and
> cannot see T1. The previous rider's notifications render on the new rider's lock screen — with
> every RLS policy in this schema working exactly as designed — and the window is not "until the
> next cold start" but **up to the idle sweep**.

`unique (user_id, token)` fails the same way faster: both rows are live from the first sign-in,
with no rotation needed. `unique (installation_id)` is the only shape under which a release, a
re-home and a rotation each address one row.

#### Scenario: A rotated token updates the row rather than adding one
- **WHEN** a provider issues a new token for an installation already recorded
- **THEN** exactly one row SHALL exist for that installation, carrying the new token
- **AND** no row SHALL survive carrying the old token

#### Scenario: A shared device re-homes completely
- **WHEN** rider A has registered installation I, and rider B registers the same I
- **THEN** exactly one row SHALL carry I, and its `user_id` SHALL be B
- **AND** no delivery for A SHALL reach that device **by any token it has ever presented**, which
  is the property a token-keyed release cannot provide

#### Scenario: One rider on several devices is normal, and releasing one does not release the rest
- **WHEN** a rider has registered three installations and signs out on one of them
- **THEN** that installation's row SHALL be removed and the other two SHALL survive
- **AND** a release that cleared every row for `auth.uid()` SHALL be refused as the alternative,
  because it silently unsubscribes a rider's other phone

#### Scenario: The installation id is generated on the device, into storage that already exists
- **WHEN** an installation id is needed
- **THEN** it SHALL be generated once on the device and held in the existing secure store
- **AND** no additional native plugin SHALL be added for it, because the value is three lines of
  `crypto.randomUUID()` into a key that already exists
- **AND** a platform-vendor identifier SHALL NOT be used instead, because its lifetime semantics
  differ per platform and would then have to be reasoned about in every rule here

#### Scenario: A reinstall is a new installation, and the old row dies on its own
- **WHEN** the app is reinstalled and generates a fresh installation id
- **THEN** a new row SHALL be created
- **AND** the previous row SHALL be removed by the first provider refusal of its now-dead token,
  with the idle sweep as the backstop rather than the mechanism

### Requirement: Registration SHALL be an own-row RPC and SHALL NOT be a client write

`public.register_push_device(installation_id text, token text, platform text)` SHALL be
`security definer`, SHALL take **no user id**, SHALL derive its subject from `auth.uid()` and
nothing else, SHALL upsert on `installation_id`, and SHALL be the only path by which a row is
created. `public.release_push_device(installation_id text)` SHALL be its counterpart and SHALL
remove exactly one row.

**A client upsert cannot express this and fails closed.** With an `installation_id` conflict target
and an own-row policy, the second rider's `ON CONFLICT DO UPDATE` meets a row their policy does not
return — so it writes nothing or raises `23505`, and either way the device is not re-homed and the
previous rider's pushes keep arriving. Failing closed is the wrong direction for this one write.

**Re-homing is what the RPC is for, so its abuse case SHALL be stated rather than argued away.**
An installation id is not a credential: it is generated on the device and never leaves it, which
is what distinguishes it from a token — a token is handed to the app by an outside party and was
routinely known to the previous holder of the device. A party who nonetheless obtained an
installation id could re-home that device once, and what they would gain is **their own**
notifications delivered to a phone they do not hold, plus denial of push to whoever does. That is
self-harm and a nuisance, not a disclosure. It is stated because the absent SELECT grant is what
keeps it that way, and a later own-row SELECT would change the answer.

#### Scenario: The subject is the caller and cannot be named
- **WHEN** either RPC is called
- **THEN** the row written or removed SHALL be resolved against `auth.uid()`
- **AND** neither function SHALL accept a parameter that could name a different rider

#### Scenario: The cap is enforced by the function, not by a constraint
- **WHEN** a rider registers an eleventh installation
- **THEN** the oldest rows by `last_seen_at` SHALL be removed so that at most ten survive
- **AND** this SHALL be enforced inside the function, because a CHECK cannot count siblings
- **AND** the reason SHALL be recorded: an uncapped rider is an unbounded delivery multiplier

#### Scenario: `anon` cannot execute either function
- **WHEN** EXECUTE is checked
- **THEN** `has_function_privilege('anon', …)` SHALL be false for `register_push_device` and
  `release_push_device`
- **AND** `authenticated` SHALL hold EXECUTE on both, because they are the only write path

### Requirement: An un-onboarded rider SHALL NOT register a device, and the gate SHALL NOT be a trigger

`register_push_device` SHALL refuse a caller for whom `private.may_participate()` is false, raising
with `errcode = 'check_violation'` so the client sees the same `23514` every other gated write
raises. **`enforce_participation_gate` SHALL NOT be added as a trigger on `push_devices`**, and the
migration SHALL record why.

Every one of the existing `enforce_participation_gate` triggers carries
`for each row when (current_user = 'authenticated')`. Inside a `security definer` function
`current_user` is the **owner**. This table is written only by `security definer` functions, so
such a trigger would never fire on any write — while still appearing in
`select count(*) from pg_trigger where tgname = 'enforce_participation_gate'`, making the count
read one higher and the coverage read complete. A gate that cannot fire is worse than an absent
one, because an absent one is visible.

#### Scenario: A rider with a NULL consent stamp is refused
- **WHEN** an account created by calling GoTrue's `/auth/v1/signup` directly, never having called
  `accept_terms()`, calls `register_push_device`
- **THEN** it SHALL raise `23514`
- **AND** no row SHALL exist for that rider

#### Scenario: The trigger's absence is asserted, not merely true
- **WHEN** the trigger set is checked
- **THEN** no `enforce_participation_gate` trigger SHALL exist on `push_devices`
- **AND** the assertion SHALL exist so that adding one later is a test failure rather than a
  silent no-op

#### Scenario: Release is not gated
- **WHEN** a rider in any account state calls `release_push_device`
- **THEN** it SHALL succeed
- **AND** the reason SHALL be recorded: refusing a release is refusing to stop sending someone
  push

### Requirement: Sign-out SHALL release the device, and the residual window SHALL be closed by the next boot

`signOut()` SHALL call `release_push_device(installation_id)` **before** `supabase.auth.signOut()`, because the
RPC needs a live session. A failure SHALL NOT prevent sign-out. **The app SHALL call
`register_push_device` on every cold start while a session exists**, not only on first grant, so
that a release which could not run is repaired unconditionally by the next rider to open the app.

This is the fifth thing sign-out destroys and the first that is a server write, and the first
whose failure harms the *next* rider rather than the last one. The existing requirement's offline
answer — sign out anyway — is kept, so the hazard has to be closed at the other end.

#### Scenario: An offline sign-out still signs the rider out
- **WHEN** the release call fails because the device has no network
- **THEN** the rider SHALL still be signed out and SHALL still land on `/auth/login`
- **AND** the failure SHALL NOT be surfaced

#### Scenario: The window is stated rather than claimed closed
- **WHEN** a release fails and the device is handed to another rider
- **THEN** the window during which the previous rider's pushes may reach that device SHALL be
  *until the app is next opened with a session*, and SHALL be stated in those words
- **AND** it SHALL NOT be described as closed, because nothing can release a device without a
  session
- **AND** that bound SHALL hold only because the row is keyed on the installation: a token-keyed
  table makes the same sentence false, since a release naming one token leaves any other row for
  the same device untouched and the real bound becomes the idle sweep

#### Scenario: Boot registration is unconditional
- **WHEN** the app cold-starts with a session and a granted permission
- **THEN** it SHALL register its current token
- **AND** it SHALL do so even if it believes the installation is already registered, because that
  belief is exactly what is wrong in the case this repairs

#### Scenario: A check that would look like a defence is refused
- **WHEN** it is proposed that the delivery path verify a token still belongs to the notification's
  recipient
- **THEN** it SHALL be refused as a mitigation for this case
- **AND** the reason SHALL be that the claim reads tokens *by* `user_id`, so the check passes in
  precisely the case that is broken

### Requirement: A device row SHALL have a stated retention window, and that window SHALL be implemented

A device row SHALL be removed by exactly four mechanisms and by nothing else:

1. `release_push_device(installation_id)` on sign-out;
2. `on delete cascade` from `profiles`, so account deletion takes every device;
3. a provider reporting it permanently invalid — APNs `410 Unregistered` or `403 BadDeviceToken`,
   FCM `UNREGISTERED` or `INVALID_ARGUMENT` — deleted immediately;
4. **60 days with no successful delivery and no re-registration**, measured on a server-owned
   `last_seen_at` and swept by the same scheduled job that delivers.

**`036` declined to write a number because nothing in this project could implement one.** That
reasoning is discharged rather than contradicted: this change builds the scheduler, so the number
is enforced and verifiable rather than asserted.

#### Scenario: A transport failure never deletes a token
- **WHEN** a delivery attempt returns a 5xx, a timeout, or a 429
- **THEN** the token SHALL be left alone and the attempt retried with backoff
- **AND** the reason SHALL be recorded: deleting live tokens on a provider outage silently
  unsubscribes every rider at once, and nothing would report it

#### Scenario: Account deletion takes every device
- **WHEN** a rider's `auth.users` row is deleted
- **THEN** every `push_devices` row naming them SHALL be gone
- **AND** this SHALL be asserted in the suite alongside the existing cascade assertions

#### Scenario: `last_seen_at` is server-owned
- **WHEN** the column is checked
- **THEN** no client role SHALL be able to write it
- **AND** here that follows trivially from the absent grants, which SHALL be stated rather than
  left as an accident of this table's shape

#### Scenario: A rider on holiday is not silently unsubscribed
- **WHEN** a rider does not open the app for three weeks but their device keeps accepting
  deliveries
- **THEN** `last_seen_at` SHALL advance on each successful delivery and the token SHALL survive
- **AND** the window SHALL therefore measure *device reachability*, not app usage
