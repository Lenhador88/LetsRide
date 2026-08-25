## Purpose

**Delta note.** `place-search` is not yet a standing capability: it exists as deltas in
`openspec/changes/replace-places-index-with-geocoder/specs/place-search/spec.md` and
`openspec/changes/inline-place-search-with-recent-starts/specs/place-search/spec.md`, both shipped
and unarchived. This delta adds a third proxy mode and does not modify any existing requirement in
either file — in particular the seven lookup states, the term-handling rules and the attribution
requirement all stand unchanged.

## ADDED Requirements

### Requirement: The proxy SHALL offer a reverse mode that turns a coordinate into a place

The proxy SHALL accept a third mode which takes a coordinate rather than a term and answers with a
single place, or with nothing where the provider returns none.

It SHALL be subject to every rule the existing modes are subject to and SHALL introduce no new
exception to any of them: the caller's JWT is verified against the auth server rather than trusted
from the gateway, no subject is read from the request body, no service-role key exists, the
provider key and hostname stay in the function's secret store, and the coordinate is never logged,
stored or attributed.

The order of operations SHALL be unchanged: verify, refuse an anonymous session, parse, **write
the ledger row, and only then call the provider.** A reverse lookup spends exactly the credit a
search does.

#### Scenario: A coordinate resolves to a place
- **WHEN** the proxy is called in reverse mode with a valid coordinate by a caller within their
  ceilings
- **THEN** it SHALL answer with a single place carrying an identifier, a label and a coordinate,
  in the same shape the search mode's results use

#### Scenario: Nothing found is not an error
- **WHEN** the provider returns no feature for the coordinate
- **THEN** the proxy SHALL answer successfully with no place

#### Scenario: An out-of-range coordinate spends nothing
- **WHEN** the coordinate is absent, non-finite or outside the valid ranges
- **THEN** the request SHALL be refused before the ledger row is written, and no provider call
  SHALL be made

#### Scenario: The identifier is namespaced like every other
- **WHEN** a place is returned
- **THEN** its identifier SHALL carry the provider namespace prefix, so a stored value's origin is
  readable from the value itself

#### Scenario: The coordinate is not logged
- **WHEN** any outcome is logged for a reverse lookup
- **THEN** the log line SHALL carry an outcome and a reason code and SHALL NOT carry the
  coordinate

### Requirement: A reverse lookup SHALL be metered on the same ledger as every other lookup

A reverse lookup SHALL write one row to the same spend ledger, under the caller's own forwarded
session, subject to the same three ceilings — the rider's hourly, the rider's daily and the
application-wide one — and to the same participation gate.

The provider quota is one pool. A second surface spending it without appearing in the ledger would
make the application-wide ceiling unable to see its own spend, and would let an account that never
accepted the terms spend a credit.

A refusal SHALL be indistinguishable between the three ceilings and the gate, exactly as it is for
the other modes; the client resolves which by counting its own ledger rows.

#### Scenario: The ledger row is written before the provider is called
- **WHEN** a reverse lookup is made
- **THEN** the ledger row SHALL be committed before any billable call
- **AND** a lookup that then fails at the provider SHALL still have spent the credit, because the
  ledger counts attempts rather than successes

#### Scenario: A rider at their ceiling is refused a reverse lookup
- **WHEN** a rider who has reached a per-rider ceiling makes a reverse lookup
- **THEN** it SHALL be refused before any provider call

#### Scenario: An account that has not accepted the terms cannot spend a credit
- **WHEN** an account with no consent stamp makes a reverse lookup
- **THEN** the ledger insert SHALL be refused by the participation gate and no provider call SHALL
  be made

#### Scenario: The ledger records no coordinate
- **WHEN** a reverse lookup writes its ledger row
- **THEN** the row SHALL record that a lookup happened and SHALL carry no column able to hold
  where it was

### Requirement: A client SHALL be able to tell "this build has no reverse mode" from "the lookup failed", and SHALL stop asking

The deployed proxy is routinely older than the repository, because deploying is an owner action
and merging is not. A client SHALL therefore treat the reverse mode's absence as a first-class
state.

A build that does not recognise the mode SHALL refuse the request **before writing a ledger row**,
so an unsupported reverse lookup costs nothing, and SHALL answer with a code distinct from every
other failure on this path.

A client SHALL remember that answer for the page load and SHALL NOT ask again.

#### Scenario: An unsupported mode spends nothing
- **WHEN** a reverse request reaches a build that does not know the mode
- **THEN** no ledger row SHALL be written and no provider call SHALL be made

#### Scenario: The refusal is distinguishable
- **WHEN** a reverse request is refused as unsupported
- **THEN** the code returned SHALL be distinguishable from the ceiling, the gate refusal and the
  unavailable outcomes

#### Scenario: The client does not re-probe
- **WHEN** a client has been refused once as unsupported
- **THEN** it SHALL make no further reverse request for the remainder of the page load

#### Scenario: The caller degrades rather than fails
- **WHEN** the reverse mode is unavailable for any reason
- **THEN** the calling surface SHALL fall back to the rider typing the place, and SHALL NOT
  present an error

### Requirement: A caller that resolves a place on the rider's behalf SHALL degrade to nothing, never to a message

Where the lookup is initiated by the application rather than by the rider — a prefill — every
failure SHALL resolve to "no answer" and SHALL raise nothing the caller has to render.

This is the line the locality resolver already takes for its own reason, and it generalises: a
message about a request the rider did not make cannot be acted on by them, and the surface always
has a working alternative, which is that the rider types the answer.

Where the lookup **is** initiated by the rider, the existing distinct states — offline, the
rider's own ceiling with its scope, unavailable with a retry, and cancelled — SHALL be preserved
unchanged.

#### Scenario: Every failure is the same failure for a prefill
- **WHEN** a prefill lookup meets an offline device, a ceiling, an outage, an unsupported mode or
  a malformed answer
- **THEN** the caller SHALL receive no answer and SHALL NOT receive a distinct error to render

#### Scenario: A prefill does not consume the rider's retry affordance
- **WHEN** a prefill fails
- **THEN** no retry control SHALL be presented for it

#### Scenario: The rider's own search is unchanged
- **WHEN** the rider types into a lookup field and that lookup fails
- **THEN** the seven-state behaviour already specified SHALL apply unchanged
