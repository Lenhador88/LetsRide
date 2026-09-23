## ADDED Requirements

### Requirement: The analytics opt-out SHALL NOT be conflated with any other consent, in either direction

`profiles.analytics_opt_out_at` records one preference: whether the product-analytics client
measures this rider. It SHALL NOT be read as, written from, or rendered together with any other
consent the app holds. In particular, it SHALL NOT be conflated with `profiles.digest_opt_out_at`,
which records whether the rider wants the weekly round-up.

Each consent gets its own column, its own RPC, its own control and its own copy. A change that
adds another consent inherits this requirement rather than re-deciding it.

**The two differ in what they can promise, so a single control would mislead about both.** This
capability already records that the database cannot enforce the analytics preference. The
digest opt-out enforces nothing yet either, because nothing is sent. Once a send exists, its
selection will run in Postgres and can honour the stamp directly. Each control's copy SHALL
describe only what its own mechanism does.

Neither opt-out SHALL become an authorization gate.

#### Scenario: Each opt-out is set independently
- **WHEN** a rider sets either opt-out
- **THEN** the other SHALL be unchanged
- **AND** both directions SHALL be asserted separately, because one assertion cannot tell which
  column did the work

#### Scenario: One control SHALL NOT set both
- **WHEN** the profile's settings render
- **THEN** each opt-out SHALL have its own control, in its own sheet (`PrivacySheet` for
  analytics, `NotificationsSheet` for the round-up), with its own label
- **AND** no control SHALL write both columns, and no copy SHALL describe one as covering the
  other

#### Scenario: Neither is a gate
- **WHEN** a rider holds either stamp, or both
- **THEN** every screen, read and write available to any other rider SHALL remain available to
  them, including `/rides/weekend`
