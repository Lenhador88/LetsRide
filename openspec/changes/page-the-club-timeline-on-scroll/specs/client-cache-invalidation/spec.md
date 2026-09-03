## ADDED Requirements

### Requirement: A paged screen SHALL keep its first page in the shared cache and its later pages in session-local state

The first page of a paged list SHALL live under its ordinary cache key, so that a screen sharing
that key with another screen keeps sharing the request and the answer. Pages beyond the first
SHALL live in component state for the life of the mount, and SHALL be re-read on the next visit.

Moving the first page into local state to make paging simpler SHALL NOT be done: the club
timeline's first window shares three of its keys with the Postcards list, the Threads list and the
club's threads entrance, and two screens holding different answers to the same key is the
collision `keys.ts` exists to prevent.

An invalidation therefore refetches the **first page only**. The refetched page SHALL be absorbed
into the pages already held rather than replacing them, so that a rider who has paged is not
returned to the first page by an unrelated write.

#### Scenario: A new row does not return a paged rider to the top
- **WHEN** a mutation invalidates the first page's key while the rider has paged further down
- **THEN** the first page SHALL be refetched and merged
- **AND** the rider's position and the pages below SHALL survive

#### Scenario: The first page keeps sharing its key
- **WHEN** a paged screen and a list screen read the same rows
- **THEN** they SHALL continue to resolve to the same cache entry
- **AND** paging SHALL NOT introduce a second entry holding a different answer for that key

#### Scenario: Depth does not survive the mount
- **WHEN** the rider navigates away and returns
- **THEN** the screen SHALL start at its first page
- **AND** the later pages SHALL be re-read rather than restored from a stale copy

### Requirement: A refetch that REMOVES a row SHALL discard the later pages; one that only adds or updates SHALL NOT

The two kinds of refetch are indistinguishable to a cache and must be told apart by the screen: a
refetched first page that fails to return a row it previously held, **inside the interval that
page covers**, has had that row removed — blocked, hidden, deleted, or a membership ended.

- **A removal SHALL discard the pages below the first**, which are then re-read from a clean
  first page.
- **An addition or an update SHALL leave them alone.**

The removal branch is what keeps the standing blocking rule true on a paged screen. A block
reaches every cached view through `invalidate(EVERYTHING)`, but pages held outside the cache are
not cached views, and blocking is reachable without leaving the screen — a postcard's own menu
carries Hide and Block. Without this rule a blocked rider's content would remain on screen, below
the fold, until the rider navigated away.

Snapping the rider back is acceptable **only** on this branch: they have just acted on the content
themselves, so a stream that reshuffles is expected, where a stream that reshuffles because
somebody else posted a photo is the defect the requirement above forbids.

#### Scenario: Blocking removes the blocked rider from the whole stream
- **WHEN** a rider blocks another from a row on a paged screen
- **THEN** the blocked rider's content SHALL disappear from the pages already drawn, not only from
  the next fetch
- **AND** the later pages SHALL be discarded and re-read

#### Scenario: Hiding a row does not merely hide it above the fold
- **WHEN** a rider hides a postcard that also appears in a later page
- **THEN** it SHALL disappear from every page the screen is holding

#### Scenario: A wave, a like or a new postcard is not a removal
- **WHEN** the first page is refetched and returns every row it previously held
- **THEN** the later pages SHALL be kept
- **AND** the rider SHALL NOT be moved

### Requirement: A decoration read on a paged screen SHALL be keyed by depth and SHALL cover the whole accumulated subject set

A read that decorates rows — a wave count, an introduction door — is scoped to the subject ids the
screen's own sources are holding, and is enabled only once those ids exist, because this cache
refetches on a changed **key** and not on a changed argument.

On a paged screen the id set grows per fetched page, so the key SHALL carry the page depth and the
read SHALL cover the **whole** accumulated set rather than the newest page's delta. A delta merged
in component state would be left stale by exactly the invalidation that exists to refresh it.

The key SHALL be a child of the existing decoration key, so that the mutations which invalidate it
today reach every depth through the cache's prefix match, with no edit to any action.

A decoration read SHALL NOT gate the rows it decorates, at any depth, and a display step that
fetched no new rows SHALL trigger no decoration read.

#### Scenario: A newly paged row gets its decoration
- **WHEN** a further page brings in rows that carry a decoration
- **THEN** the decoration read SHALL re-run under a key naming the new depth
- **AND** it SHALL return the state for every accumulated subject, not only the new ones

#### Scenario: A wave placed on the first page still refreshes after paging
- **WHEN** a rider waves and the action invalidates the decoration's key with no depth
- **THEN** the depth-suffixed entry SHALL be invalidated by the prefix match
- **AND** no action SHALL need to know how deep the screen has paged

#### Scenario: A free display step costs no decoration read
- **WHEN** a step raises the display cap without fetching rows
- **THEN** the decoration key SHALL NOT change and no read SHALL be issued

#### Scenario: A failed decoration read costs decorations only
- **WHEN** the decoration read fails at any depth
- **THEN** the rows SHALL render undecorated
- **AND** no error state SHALL replace the list
