## ADDED Requirements

### Requirement: A filtered list SHALL define every state, and an empty result SHALL NOT be read as a refusal

The Threads list now excludes rows for a reason unrelated to permission, so its states SHALL be
stated in full and none of them SHALL be inferred from the row count.

| State | Behaviour |
|---|---|
| Empty | A club with no listable threads SHALL draw the ordinary empty state, including the create affordance. It SHALL NOT be distinguished in copy from a club that has never had a thread — the rider is not owed the fact that other rows exist but are drawn elsewhere |
| Loading | Gated on the data, never on a loading flag. The skeleton SHALL be drawn until the club and — for a member — the list have resolved |
| Error | A failed list read SHALL draw the retryable error state. A failed **unread** read SHALL cost the marks alone and SHALL leave the list rendering unmarked |
| Offline | The existing offline message on the list and on "load more" SHALL be unchanged |
| Permission denied | Zero rows from the policies and zero rows after the filter are the same value and SHALL be told apart by the club's own viewer role, never by the count. A non-member of a public club SHALL see the join prompt; a member SHALL see the empty state |
| Partial | A page that filled SHALL offer "load more" on exactly the condition it does today, computed from the page the query returned |
| Stale | Read on load with no subscription. A thread created, deleted, marked or unmarked elsewhere appears on the next load or the next invalidation |

#### Scenario: Empty and denied are told apart by the viewer role
- **WHEN** the Threads list returns zero rows
- **THEN** the screen SHALL choose its message from the club's viewer role
- **AND** SHALL NOT infer permission from the number of rows

#### Scenario: An empty list still offers the create
- **WHEN** a member sees an empty Threads list
- **THEN** the create affordance SHALL be present in the empty state

#### Scenario: A failed decoration costs marks and not rows
- **WHEN** the unread read fails
- **THEN** the list SHALL render unmarked
- **AND** no error state SHALL replace it

### Requirement: An aggregate mark SHALL count only what its destination shows

A dot that summarises a list SHALL be computed over exactly the rows that list draws. A mark the
rider cannot clear by going where it points is a defect, not a decoration: it survives the visit,
so the affordance stops meaning anything.

Where the underlying source answers more broadly than the destination shows, the read SHALL narrow
it, and the narrowing SHALL use the same rule the destination uses to choose its rows.

The narrowing SHALL NOT be done by intersecting with one page of the destination, because a list
ordered by creation can hold an active row past its first page, and a mark that fails to appear is
worse than one that fails to clear.

#### Scenario: The dot clears by visiting what it points at
- **WHEN** the only unread activity in a club is a comment on a current member's introduction
- **THEN** the Threads entrance SHALL NOT be marked
- **AND** visiting the Threads list SHALL leave nothing unexplained

#### Scenario: The dot still lights for an unread ordinary thread
- **WHEN** any listed thread holds an unread message
- **THEN** the Threads entrance SHALL be marked
- **AND** the mark SHALL not depend on that thread being on the first page

#### Scenario: A failed narrowing costs the marks
- **WHEN** the read that narrows the unread map fails
- **THEN** the map SHALL resolve to nothing rather than to unverified marks
- **AND** every surface reading it SHALL render unmarked

### Requirement: A removed control SHALL leave the row it was on intact

Removing the wave from a thread row SHALL change nothing else about that row: its title, its lead
line, its participants, its comment count and floor mark, its unread dot, its accessible name, its
scroll anchor and its outbound link SHALL all be exactly as before.

Where the row's structure existed only to hold the removed control — a wrapper that stopped a button
being nested inside a link — the structure MAY be simplified, provided the row's anchor id and its
tap target survive unchanged.

#### Scenario: The row keeps everything else
- **WHEN** a thread row is drawn after the change
- **THEN** its title, lead, faces, count, floor mark, unread dot and accessible name SHALL be
  unchanged
- **AND** its scroll anchor SHALL still be present and SHALL still carry the row's own key

#### Scenario: The absence is asserted
- **WHEN** the change is tested
- **THEN** a test SHALL assert that no wave control renders on a thread row
- **AND** it SHALL be verified in both directions, since a test that only checks what rendered
  cannot see a control that should not be there
