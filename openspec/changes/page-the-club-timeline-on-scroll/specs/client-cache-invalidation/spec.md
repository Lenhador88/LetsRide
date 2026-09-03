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

### Requirement: A removal SHALL discard the later pages, and a control that can remove a row SHALL say so rather than be inferred

The two kinds of refetch are indistinguishable to a cache and must be told apart by the screen:

- **A removal SHALL discard the pages below the first**, which are then re-read from a clean
  first page.
- **An addition or an update SHALL leave them alone.**

A refetched first page that fails to return a row it previously held, **inside the interval that
page covers**, has had that row removed — blocked, hidden, deleted, or a membership ended — and
SHALL discard the later pages.

**That signal alone is NOT sufficient, and treating it as sufficient reintroduces the defect this
requirement exists to close.** It can only see the interval the first page covers. A rider who has
paged four pages down and blocks the author of a row that appears **only on page three** gets a
first-page refetch that returns everything it held, reports no removal, and leaves the blocked
rider's content on screen — which is exactly what the standing blocking rule forbids, and it is
reachable without leaving the screen, because a postcard's own menu carries Hide and Block.

So: **any control a paged screen renders whose action can remove rows SHALL discard the later
pages itself, unconditionally, without waiting to observe whether the removed row was on the first
page.** The signal SHALL be explicit — the component owning the control telling the screen — and
SHALL NOT be inferred from a burst of refetches, which cannot be told apart from any other
cache-wide invalidation.

A screen adopting paging SHALL enumerate the removal-capable controls it renders, and a control
added later either reports its removals or reopens this hole.

Snapping the rider back is acceptable **only** on these branches: they have just acted on the
content themselves, so a stream that reshuffles is expected, where a stream that reshuffles because
somebody else posted a photo is the defect the requirement above forbids.

#### Scenario: Blocking removes the blocked rider from the whole stream
- **WHEN** a rider blocks another from a row on a paged screen
- **THEN** the blocked rider's content SHALL disappear from the pages already drawn, not only from
  the next fetch
- **AND** the later pages SHALL be discarded and re-read

#### Scenario: A block acting on a deep page still clears the deep pages
- **WHEN** the removed row appears only on a page below the first
- **THEN** the later pages SHALL still be discarded
- **AND** the screen SHALL NOT depend on the first page's refetch to notice, because it cannot

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

**No single request's subject list SHALL grow with paging depth.** A decoration read covering the
accumulated set SHALL issue it in chunks of a named bound and merge the results. The reason is the
interaction between two rules that are individually correct: a decoration must not gate its rows,
so its failure is silent by design — and a request whose id list grows without bound eventually
crosses a URI limit and fails. Silent plus unbounded means a decoration that simply stops
appearing at depth, with nothing red anywhere. A ceiling on paging depth SHALL NOT be offered as
the mitigation unless the limit it defends against has been measured.

#### Scenario: A decoration request does not grow with depth
- **WHEN** the accumulated subject set exceeds the chunk bound
- **THEN** the read SHALL be issued as several bounded requests and merged
- **AND** no request's subject list SHALL be a function of how deep the rider has paged

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
