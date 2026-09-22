## ADDED Requirements

### Requirement: The analytics opt-out SHALL NOT be conflated with any other consent, in either direction

`profiles.analytics_opt_out_at` records one preference: whether this rider's behaviour is measured
by the product-analytics client. It SHALL NOT be read as, written from, or rendered together with
any other consent the app holds — and specifically SHALL NOT be conflated with
`profiles.digest_opt_out_at`, which records whether the rider wants to be *interrupted weekly*.

**They are not the same question and they do not even have the same enforceability**, which is the
part that makes conflating them actively wrong rather than merely untidy. This capability already
records that the database **cannot** enforce the analytics preference: PostHog is a client-side SDK
and nothing in Postgres is in its path, so the column is a remembered preference the client is
trusted to honour. The digest opt-out is the opposite — the assembly runs in Postgres, so
`digest_opt_out_at is null` is a conjunct of a query and the preference is genuinely enforced. A
single control claiming to cover both would over-promise on one half and under-promise on the
other, in the same sentence.

This is the same rule this capability already applies to T&C consent — *"a preference the rider has
to accept the terms to express is not a preference"* — generalised: **each consent gets its own
column, its own RPC, its own control and its own copy.** A change that adds a third consent
inherits this requirement rather than re-deciding it.

Neither opt-out SHALL become an authorization gate. An opted-out rider loses no capability under
either column: an analytics opt-out costs them nothing, and a digest opt-out costs them the
interruption and not the content — they SHALL still be able to open the digest screen themselves.

#### Scenario: Each opt-out is set independently
- **WHEN** a rider sets one of the two
- **THEN** the other SHALL be unchanged
- **AND** both directions SHALL be asserted separately, because a single assertion cannot say which
  column did the work

#### Scenario: One control SHALL NOT set both
- **WHEN** the profile's settings are rendered
- **THEN** each opt-out SHALL have its own control, its own label and its own explanation of what
  it does and does not stop
- **AND** no control SHALL write both columns, and no copy SHALL describe one as covering the other

#### Scenario: The copy SHALL NOT claim a guarantee the mechanism cannot give
- **WHEN** each opt-out is described to a rider
- **THEN** the analytics one SHALL be described as a preference the app honours, per this
  capability's existing requirement that it SHALL NOT be described as a guarantee the database can
  give
- **AND** the digest one MAY be described as a thing that stops, because the selection runs in the
  database and the assertion backing it is a conjunct of a query

#### Scenario: Neither is an authorization gate
- **WHEN** a rider holds either stamp, or both
- **THEN** every screen, read and write available to any other rider SHALL remain available to them
- **AND** an opted-out rider SHALL still be able to open the digest screen and read its content
