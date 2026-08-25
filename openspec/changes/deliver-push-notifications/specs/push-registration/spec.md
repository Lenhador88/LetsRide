## Purpose

The device token as a per-device bearer secret: who may hold one, who may read one, what happens
when a device changes hands, when a token rotates, when a provider refuses it, and when a rider
signs out without a network. Every requirement is a statement about a role and a resource so each
maps onto an assertion in `supabase/tests/rls_test.sql` — with two exceptions named as such, the
security-advisor sweep and anything only a real device can exercise.

## ADDED Requirements

### Requirement: A device token SHALL be readable by no client role, including the rider it belongs to

`public.push_tokens` SHALL grant `authenticated` **no** SELECT privilege, and SHALL carry no
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
- **THEN** `has_table_privilege('authenticated', 'public.push_tokens', <priv>)` SHALL be false for
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
  rider or a signed-out visitor attempts to read `push_tokens` by any route
- **THEN** every one of them SHALL be refused
- **AND** this SHALL follow from the absent grant rather than from a policy, so no future policy
  can widen it

### Requirement: A token SHALL identify a device, and a device SHALL belong to exactly one rider

`public.push_tokens` SHALL carry `unique (token)` — **not** `unique (user_id, token)`. Registering
a token that already exists SHALL move it to the registering rider, deleting the prior row, and
SHALL NOT produce a second live row.

A push token is issued by APNs or FCM to an *installation*, not to an account. Two riders sharing
a phone is the normal case for a motorcycle club. Under `unique (user_id, token)` both rows live,
and every notification the first rider receives renders on the second rider's lock screen — actor
usernames, ride titles, private club names — **with every RLS policy in this schema working
correctly**. It is the only route in this app by which one rider's data reaches another rider's
screen without any visibility rule having been wrong.

#### Scenario: A shared device re-homes on registration
- **WHEN** rider A has registered token T, and rider B registers the same T
- **THEN** exactly one row SHALL carry T, and its `user_id` SHALL be B
- **AND** a delivery for A SHALL NOT reach that device

#### Scenario: One rider on several devices is normal
- **WHEN** a rider registers three distinct tokens
- **THEN** three rows SHALL exist for that rider
- **AND** a notification for them SHALL be delivered to all three

#### Scenario: A rotated token adds rather than replaces
- **WHEN** a provider issues a new token for a device whose old token is still recorded
- **THEN** the new token SHALL be registered as its own row
- **AND** the old row SHALL NOT be assumed dead; it SHALL be removed by a provider refusal or by
  the idle sweep, both below

### Requirement: Registration SHALL be an own-row RPC and SHALL NOT be a client write

`public.register_push_token(token text, platform text)` SHALL be `security definer`, SHALL take
**no user id**, SHALL derive its subject from `auth.uid()` and nothing else, SHALL delete every row
carrying the given token before inserting, and SHALL be the only path by which a row is created.

**A client upsert cannot express this and fails closed.** With a `token` conflict target and an
own-row policy, the second rider's `ON CONFLICT DO UPDATE` meets a row their policy does not
return — so it writes nothing or raises `23505`, and either way the device is not re-homed and the
previous rider's pushes keep arriving. Failing closed is the wrong direction for this one write.

**The delete-by-token is safe only because nothing can read a token.** If any client role could
read the table, this RPC would be a push-denial vector — read another rider's token, call the RPC,
silently steal their registration. The absent SELECT grant and this RPC are one decision.

#### Scenario: The subject is the caller and cannot be named
- **WHEN** the RPC is called
- **THEN** the row written SHALL name `auth.uid()`
- **AND** the function SHALL accept no parameter that could name a different rider

#### Scenario: The token cap is enforced by the function, not by a constraint
- **WHEN** a rider registers an eleventh token
- **THEN** the oldest rows by `last_seen_at` SHALL be removed so that at most ten survive
- **AND** this SHALL be enforced inside the function, because a CHECK cannot count siblings
- **AND** the reason SHALL be recorded: an uncapped rider is an unbounded delivery multiplier

#### Scenario: `anon` cannot execute either function
- **WHEN** EXECUTE is checked
- **THEN** `has_function_privilege('anon', …)` SHALL be false for `register_push_token` and
  `release_push_token`
- **AND** `authenticated` SHALL hold EXECUTE on both, because they are the only write path

### Requirement: An un-onboarded rider SHALL NOT register a token, and the gate SHALL NOT be a trigger

`register_push_token` SHALL refuse a caller for whom `private.may_participate()` is false, raising
with `errcode = 'check_violation'` so the client sees the same `23514` every other gated write
raises. **`enforce_participation_gate` SHALL NOT be added as a trigger on `push_tokens`**, and the
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
  `accept_terms()`, calls `register_push_token`
- **THEN** it SHALL raise `23514`
- **AND** no row SHALL exist for that rider

#### Scenario: The trigger's absence is asserted, not merely true
- **WHEN** the trigger set is checked
- **THEN** no `enforce_participation_gate` trigger SHALL exist on `push_tokens`
- **AND** the assertion SHALL exist so that adding one later is a test failure rather than a
  silent no-op

#### Scenario: Release is not gated
- **WHEN** a rider in any account state calls `release_push_token`
- **THEN** it SHALL succeed
- **AND** the reason SHALL be recorded: refusing a release is refusing to stop sending someone
  push

### Requirement: Sign-out SHALL release the device, and the residual window SHALL be closed by the next boot

`signOut()` SHALL call `release_push_token(token)` **before** `supabase.auth.signOut()`, because the
RPC needs a live session. A failure SHALL NOT prevent sign-out. **The app SHALL call
`register_push_token` on every cold start while a session exists**, not only on first grant, so
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
- **AND** it SHALL NOT be described as closed, because nothing can release a token without a
  session

#### Scenario: Boot registration is unconditional
- **WHEN** the app cold-starts with a session and a granted permission
- **THEN** it SHALL register its current token
- **AND** it SHALL do so even if it believes the token is already registered, because that belief
  is exactly what is wrong in the case this repairs

#### Scenario: A check that would look like a defence is refused
- **WHEN** it is proposed that the delivery path verify a token still belongs to the notification's
  recipient
- **THEN** it SHALL be refused as a mitigation for this case
- **AND** the reason SHALL be that the claim reads tokens *by* `user_id`, so the check passes in
  precisely the case that is broken

### Requirement: A token SHALL have a stated retention window, and that window SHALL be implemented

A token row SHALL be removed by exactly four mechanisms and by nothing else:

1. `release_push_token` on sign-out;
2. `on delete cascade` from `profiles`, so account deletion takes every token;
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

#### Scenario: Account deletion takes every token
- **WHEN** a rider's `auth.users` row is deleted
- **THEN** every `push_tokens` row naming them SHALL be gone
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
