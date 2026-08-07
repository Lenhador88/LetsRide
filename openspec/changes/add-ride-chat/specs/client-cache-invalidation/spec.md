# client-cache-invalidation (delta)

> **⚠ COORDINATION — `add-account-deletion` also modifies `Stale data SHALL be bounded and
> visible`, and OpenSpec will not warn you.** Archiving folds a delta into
> `openspec/specs/client-cache-invalidation/spec.md` by replacing the requirement **wholesale**,
> so whichever change archives second silently discards the first one's edit. Same hazard
> `enforce-creator-membership`'s delta records for `Club membership role SHALL NOT be
> self-assignable`.
>
> The two edits are reconcilable and they narrow the same requirement from different sides:
>
> - **`add-account-deletion`** adds the rule that a change made in *another rider's session* is
>   covered by the revalidation rule and cannot be expressed as an invalidation, because no key
>   in this rider's client can name it — plus three scenarios (deletion discovered by
>   revalidation, a cached screen never granting an affordance RLS will refuse, and a dead signed
>   URL rendering the fallback).
> - **This change** replaces the `Real-time is not assumed` scenario, which currently defers the
>   whole question to "the Inbox epic", with the decision that epic has now made.
>
> Neither edit touches the other's scenarios. **Before archiving whichever goes second: re-read
> `openspec/specs/client-cache-invalidation/spec.md` as the first one left it, and rewrite this
> delta against *that* text** — in particular, keep the other change's added scenarios rather
> than reproducing this file verbatim.
>
> **A scenario is matched by its heading, so renaming one reads as deleting it.** `Real-time is
> not assumed` keeps its name here even though its body is replaced wholesale; `validate
> --strict` rejects the rename with *"omits scenario(s) the current spec still has"*, which is
> the CLI catching exactly the silent-drop this banner is about. Change the body, keep the name.

## MODIFIED Requirements

### Requirement: Stale data SHALL be bounded and visible

Every screen SHALL revalidate when the app is foregrounded. Freshness SHALL be expressed as a
revalidation rule, and a subscription SHALL be permitted only for a stream that has been
explicitly specified as live — never as the default mechanism for keeping a screen fresh.

No screen currently knows that data changed elsewhere; the server re-rendered on navigation and
the question never arose. A cached client can hold a list open for as long as the rider leaves
the app running.

**The `Real-time is not assumed` scenario deferred this decision to "the Inbox epic", and that
epic has now made it.** Per-ride chat is the first stream in this app specified as live. What
changes is narrow and is stated as a narrowing rather than a relaxation: one named stream may
carry a subscription, and everything else stays on revalidation. A subscription is an
optimisation **on top of** the revalidation rule and never a replacement for it — a client that
trusts an event stream to have filled a gap shows a thread with a hole in it and no indication
that anything is missing, because missed events are never replayed.

The rest of the subscription contract — lifecycle, channel naming, publication membership,
per-subscriber authorization, optimistic reconciliation — is **not** this capability's, and is
deliberately not restated here. It lives in `realtime-subscriptions`, so that the second live
stream in this app inherits it rather than rediscovering it.

#### Scenario: Returning to the app refreshes what is on screen
- **WHEN** the app is foregrounded after being backgrounded
- **THEN** the visible screen SHALL revalidate its data
- **AND** this SHALL hold for a screen carrying a subscription exactly as it does for one that
  does not

#### Scenario: A ride whose details changed is not acted on stale
- **WHEN** a rider RSVPs to a ride whose departure time or meeting point has changed since the
  screen loaded
- **THEN** the write SHALL still be attempted against the current row, and the screen SHALL
  reflect the current values afterwards rather than the ones it was showing

#### Scenario: Real-time is not assumed
- **WHEN** freshness is specified for a screen
- **THEN** it SHALL be expressed as a revalidation rule by default
- **AND** a subscription SHALL be added only where a specification names that stream as live,
  which today is the per-ride message thread and nothing else
- **AND** the existence of one subscription SHALL NOT be read as permission to add others, since
  each carries a socket, a lifecycle and a per-subscriber authorization question of its own

#### Scenario: A live screen still revalidates
- **WHEN** a screen holds a subscription and the socket reconnects, or the app is foregrounded
- **THEN** the screen SHALL refetch its current state rather than assuming the events it missed
  will arrive
- **AND** the refetch SHALL reconcile with what the client already holds, matched by id, rather
  than replacing it and losing the rider's position

#### Scenario: A cache key fed by a subscription obeys every other rule unchanged
- **WHEN** a subscription writes into the query cache
- **THEN** it SHALL write through the same keys spelled in `src/lib/query/keys.ts`, never a
  string composed at the subscription site
- **AND** the key SHALL be scoped to the signed-in rider and SHALL NOT survive a sign-out, per
  the per-viewer rule this capability already carries
