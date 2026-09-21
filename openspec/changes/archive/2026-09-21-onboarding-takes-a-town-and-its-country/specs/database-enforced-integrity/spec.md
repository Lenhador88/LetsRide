<!--
COORDINATION — checked 2026-09-08:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive

Nothing below modifies an existing requirement. `A username SHALL NOT be removable once set` (`038`)
and `Every role's reach into another rider's onboarding state SHALL be restated when the invariant
changes` (`113`/`114`) are the two neighbours; both are correct as they stand and this change adds no
migration, so neither is touched. `require-a-home-country-at-onboarding` holds MODIFIED blocks on
this capability and is unarchived — the requirement below is ADDED and collides with none of them.

**This change contains no migration.** The requirement is here because it is a rule about what the
database already refuses, made load-bearing by an app change, and `openspec/config.yaml` asks for
access-control and integrity rules as testable statements about a role and a resource whether or not
a SQL file moved.
-->

## ADDED Requirements

### Requirement: A client writing two columns from one pick SHALL NOT be able to clear the one the database protects, and SHALL NOT rely on that protection alone

Where one rider action writes a pair of columns and only one of them carries a database-side
irreversibility rule, the client SHALL omit the protected column when it has no value for it, **and**
the protection SHALL be stated with the conditions under which it is silent. Neither substitutes for
the other.

The pair is `profiles.location` and `profiles.home_country`, written together from one place pick.
`home_country` cannot be cleared once set; `location` can.

**The protection, verified in the deployed `prosrc` on both projects 2026-09-08 rather than taken
from prose.** `enforce_onboarding_completion`'s UPDATE arm carries
`if old.home_country is not null then new.home_country := coalesce(new.home_country,
old.home_country); end if;` — `038`'s exact shape for `username`, placed above the
`old.onboarding_completed_at` early return so it is not dead code for the only population that can
have a country to lose. A coercion, not a raise: a client sending a blank country gets the stored
value back and sees no error.

**Two conditions narrow it, and both are why the client's omission is also required.** It is keyed on
`old.home_country is not null`, so it does nothing for a rider who has no country — measured
2026-09-08, that is **every** rider on both projects, 0 of 25 on DEV and 0 of 5 on PROD. And the
trigger's first statement is `if current_user <> 'authenticated' then return new; end if;`, so it is
a rule about what the *client* may write and does not cover a `security definer` path or the seed.

**No migration is proposed.** The coercion is correct as it stands, `profiles.location`'s deliberate
absence of one is PD-419's obligation rather than an oversight, and changing a trigger on an
already-shipped write path would owe a hand-exercise gate for a problem that does not exist.

#### Scenario: A rider changes their town to a place with no country
- **WHEN** a signed-in rider, on their own row, writes a new `location` from a pick whose
  `countryCode` is `null` or absent
- **THEN** the client SHALL send no `home_country` key at all
- **AND** if it sends `home_country: null` regardless, the stored value SHALL be unchanged — assert
  the **stored value**, never a SQLSTATE; an assertion written as a rejection would fail against a
  correct implementation
- **AND** a rider who has no stored country SHALL simply remain without one, because the coercion arm
  does not fire

#### Scenario: A rider changes their town to a place in another country
- **WHEN** the pick carries a `countryCode` different from the stored one
- **THEN** both columns SHALL be updated, and the country SHALL change — a *change* is permitted, a
  *removal* is not, exactly as `038` permits a rename and refuses a removal
- **AND** no other rider, in any club role — owner, admin, member, non-member — SHALL be able to set,
  change or clear either column on someone else's row; `001`'s UPDATE policy is `auth.uid() = id` and
  such a statement SHALL affect **zero rows**
- **AND** a **blocked** rider SHALL read zero rows for the other's profile in both directions, and a
  signed-out visitor SHALL read zero rows because `anon` holds no grant on `profiles`

#### Scenario: A rider clears their town
- **WHEN** a rider uses the profile setting's `Remove`
- **THEN** `profiles.location` SHALL be set to SQL NULL — not `''`, which would read as a town
  nobody typed — and the write SHALL carry no `home_country` key
- **AND** their stored `home_country` SHALL survive, and they SHALL NOT be returned to the wizard,
  because completion is a stored one-way stamp and `114` gates *becoming* onboarded rather than
  *being* onboarded
- **AND** clearing SHALL remain possible: PD-419's decision obliges withdrawal, and
  `profiles.location` SHALL NOT acquire a coercion arm as part of this change

#### Scenario: A completion is re-run by a rider who predates the requirement
- **WHEN** an already-stamped rider with a NULL `home_country` reaches `complete_onboarding` by any
  route
- **THEN** they SHALL NOT be refused, because `114`'s guard is gated on `not v_was_complete` — the
  transition into completion — and SHALL receive their **original** stamp
- **AND** their stored `location` SHALL NOT be overwritten, because the caller passes
  `p_location: null` and `075`'s `coalesce(nullif(btrim(p_location), ''), p.location)` reads that as
  *leave it alone*
- **AND** no caller in this change SHALL pass a real `p_location`, since that path **does** overwrite
  a stored town on a re-run

#### Scenario: The bounds are the database's and the messages are Zod's
- **WHEN** a town longer than 100 characters, or a country code that is empty, lower-case,
  three-letter, padded, or unassigned, reaches the row by any route
- **THEN** `018`'s `profiles_location_length` and `113`'s two `home_country` CHECKs SHALL refuse it
  with `23514`, whether or not the client ran `locationSchema` or `countryCodeSchema`
- **AND** the picker's `maxNameLength` SHALL truncate a long label before it can be submitted, so the
  rider is never handed a value they cannot shorten
