## ADDED Requirements

### Requirement: The Threads list SHALL be the list of a club's ordinary threads, and SHALL be defined by what it excludes

A club's Threads list SHALL hold every thread `081` returns to the viewer **except** those carrying
an introduction marker. The exclusion SHALL be applied in the query, not to the rows it returned.

Two properties of that list depend on the filter being in the query, and both fail silently if it
is not:

- **The "is there another page" signal.** The list decides there is more to read by comparing the
  page it received against the page size it asked for. A page shortened after the read reads as the
  end of the list, and every thread past that point becomes unreachable.
- **The timeline's threads horizon.** It is computed from the same read on the assumption that the
  rows returned *are* the window that was read. A read that drops rows afterwards SHALL compute its
  own horizon instead, and a read that filters in the query does not have to.

#### Scenario: A full page stays a full page
- **WHEN** a club holds more threads than one page and some of them are introductions
- **THEN** the first page SHALL contain a full page of ordinary threads
- **AND** the "load more" affordance SHALL be offered on exactly the condition it is today

#### Scenario: The keyset cursor is unaffected
- **WHEN** the rider loads a later page
- **THEN** the cursor SHALL page over ordinary threads only
- **AND** no page SHALL repeat or skip a row at a boundary

### Requirement: The introduction marker SHALL remain unwritable by every client role, and that SHALL now be treated as a listing guarantee

Until this change the marker only decorated a row. It now decides whether a thread is listed at all,
so its unwritability is what stops a rider from choosing whether their own thread appears on a club's
Threads list.

The following SHALL hold, and SHALL be treated as load-bearing rather than tidy:

- `club_threads`' INSERT grant SHALL NOT include the marker column.
- `club_threads` SHALL have no UPDATE grant and no UPDATE policy for any client role.
- The only writer of the marker SHALL be the introduction function, which reads its subject from the
  authenticated session and never from an argument.

A future change proposing a client grant on that column, or an UPDATE policy on `club_threads`, SHALL
be read as changing what riders can hide from each other, not as a convenience.

#### Scenario: A rider cannot hide their own thread from the list
- **WHEN** a rider inserts a thread naming the marker column
- **THEN** the write SHALL be refused for lack of a column grant

#### Scenario: A rider cannot push somebody else's thread off the list
- **WHEN** a rider attempts to update any thread's marker
- **THEN** the write SHALL be refused, there being no UPDATE grant and no UPDATE policy

#### Scenario: The only marker writer names nobody
- **WHEN** the introduction function marks a thread
- **THEN** the subject SHALL come from the authenticated session alone

### Requirement: A club whose only threads are introductions SHALL present an empty list, and SHALL still offer the create

Such a club's Threads list SHALL draw its ordinary empty state — the one that says there are no
threads and offers to start one. It SHALL NOT draw a list, a spinner, an error, or a message
implying the rider is not permitted to see something.

The entrance to that list SHALL remain offered to members, because the list is creatable: an
entrance to an empty screen that offers the create is not the unreachable-screen defect, and the
create affordance SHALL be present in the empty state as it is today.

The timeline's foot, which names the lists holding older activity, SHALL continue to gate its
Threads link on that list holding something — so a club whose only threads are introductions SHALL
NOT be offered a link to an empty list. The foot SHALL still name at least one destination, which
the members list guarantees.

#### Scenario: Only introductions means an empty Threads list
- **WHEN** a member opens the Threads list of a club whose every thread is a current member's
  introduction
- **THEN** the empty state SHALL be drawn
- **AND** the "start a thread" affordance SHALL be present

#### Scenario: The foot does not point at an empty list
- **WHEN** the timeline is cut and names where older activity lives
- **THEN** the Threads link SHALL be omitted if the filtered list is empty
- **AND** at least one destination SHALL still be named

#### Scenario: Empty is not permission-denied
- **WHEN** a member sees that empty state
- **THEN** it SHALL read as "nothing here yet", never as a refusal
- **AND** a non-member of a public club SHALL continue to see the join prompt instead, chosen from
  the club's own viewer role and never from the row count
