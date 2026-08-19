## ADDED Requirements

### Requirement: A read that costs money SHALL be cached, with a stated lifetime, and SHALL NOT outlive the session

Every read this cache holds today is free at the point of use: a repeated query costs a round trip to
our own database. A read that bills a third party per request is a different kind of read, and the
cache stops being a latency optimisation and becomes a spend control.

Such a read SHALL be issued through the cache under a key spelled in `keys.ts`, like every other
read. **A declared key with no caller is worse than no key**, because it reads as coverage: the
place-search key exists today and nothing uses it, so retyping a term re-issues the query.

The key SHALL carry every input that changes the answer — the term and any bias — because two
different questions cached under one key show whichever answered first to both.

The entry SHALL have a stated lifetime chosen against how fast the answer actually changes, not
against the default. A place does not move; a rider's typing does.

A cached third-party response SHALL be destroyed at sign-out with the rest of the cache. A search
term is frequently a home address, so a residual entry is a previous rider's address readable by the
next rider on the same device.

#### Scenario: A repeated question is not repeated to the vendor
- **WHEN** the same term and the same bias are requested again within the entry's lifetime
- **THEN** the cached answer SHALL be returned
- **AND** no request SHALL reach the vendor and no metered attempt SHALL be recorded

#### Scenario: The lifetime is a decision with a reason
- **WHEN** the entry's lifetime is read
- **THEN** it SHALL be stated beside the key with the reason it is that number
- **AND** it SHALL NOT be inherited from whatever the cache defaults to

#### Scenario: Sign-out leaves no terms behind
- **WHEN** a rider signs out
- **THEN** every cached term and result SHALL be cleared by the existing sign-out sweep
- **AND** nothing SHALL persist them outside the cache — not local storage, not the session store, and
  not a module-level variable that survives the navigation

#### Scenario: A failed metered read is not cached as an answer
- **WHEN** a metered read fails, is refused by a ceiling, or is aborted
- **THEN** the failure SHALL NOT be stored as the answer for that key
- **AND** a later identical request SHALL be free to try again, once, rather than being served a
  cached failure for the entry's whole lifetime
