# realtime-subscriptions (delta)

> **This delta ADDS requirements and MODIFIES none, deliberately.** `openspec archive` folds a delta
> in by replacing a requirement **wholesale**, so two changes modifying the same requirement means
> whichever archives second discards the first one's edit silently. Everything below is new text
> touching no existing requirement.
>
> The standing requirements — *"A table SHALL be in the publication before anything subscribes to
> it"*, *"Each live stream SHALL have exactly one deterministically-named channel"*, *"Realtime
> authorization SHALL be verified per subscriber, and DELETE events SHALL NOT be subscribed to"* —
> all apply unchanged to `ride_thread_messages`. They are not restated; what is added below is the
> part they do not cover, which is **swapping** one publication member for another across a deploy.

## ADDED Requirements

### Requirement: Moving a live stream between tables SHALL add the new publication member before the deploy and remove the old one only after

When a subscribed table is replaced by a differently-named one, the publication entry for the new
table SHALL be created in the **additive** migration, applied before the client that subscribes to
it is serving; the old table's entry SHALL disappear only with the **destructive** migration, applied
after that client is confirmed serving.

This is the standing publication requirement and `CLAUDE.md` §Supabase Rules' sequencing rule pulling
in opposite directions on the same change, which is why the two halves cannot share a file. A
subscription against a table that is not in the publication does not error — it connects and simply
never fires, which is the failure mode this ordering exists to prevent, and it is indistinguishable
from a quiet conversation.

`drop table` removes a table from a publication on its own; a preceding
`alter publication ... drop table` is redundant rather than wrong.

#### Scenario: The new table is publishable before anything subscribes
- **WHEN** the additive migration applies
- **THEN** `public.ride_thread_messages` SHALL be a member of `supabase_realtime`
- **AND** this SHALL be verified against `pg_publication_tables` on the project, not assumed from the
  migration text

#### Scenario: The old table stays publishable until nothing subscribes
- **WHEN** the additive migration applies and the destructive one has not
- **THEN** `public.ride_messages` SHALL remain a member, because an already-loaded browser tab is
  still running the pre-merge bundle and still subscribing to it
- **AND** the two tables being members simultaneously SHALL be the expected state for the length of
  the gap, not drift

#### Scenario: A silent stream is caught before a rider finds it
- **WHEN** the new subscription is first exercised
- **THEN** it SHALL be exercised by an actual insert observed arriving, not by the subscription
  reporting `SUBSCRIBED`
- **AND** `SUBSCRIBED` against a non-published table SHALL be understood as a success signal that
  proves nothing

#### Scenario: The retired stream's channel name is not reused
- **WHEN** the new stream's channel is named
- **THEN** it SHALL be deterministic and distinct from the retired chat's
- **AND** the channel SHALL be scoped to the thread rather than to the ride, because the screen that
  subscribes is a thread and a ride-scoped channel would deliver messages from threads the subscriber
  is not looking at
