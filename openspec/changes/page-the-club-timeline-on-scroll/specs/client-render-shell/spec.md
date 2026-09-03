## ADDED Requirements

### Requirement: A screen that grows SHALL define a tail state, and the tail SHALL NOT displace what the rider is reading

A list that extends itself has three tails rather than the two a fixed list has, and each SHALL be
distinguishable to the rider:

- **more coming** — an indicator that a further page is on its way, drawn **below** the content;
- **cannot get more** — the read failed, the device is offline, or a stated ceiling was reached;
- **nothing more exists** — the end of the data, drawn as an ending rather than as an absence.

The tail SHALL be drawn below the rows and SHALL NOT replace them. A screen that is already
showing content SHALL NOT fall back to a skeleton, a spinner over the whole list, or an error
state covering the region the rider is reading, because a further page failed. This is the
standing "a repeat fetch does not blank the screen" rule applied to a fetch the rider triggered by
scrolling, where the temptation to reuse the whole-screen loading gate is strongest.

New rows SHALL be appended **below** the rider's viewport, so that extending the list never moves
what is already on screen.

#### Scenario: A failed extension costs the tail, not the list
- **WHEN** a request for a further page fails
- **THEN** the rows already drawn SHALL remain
- **AND** the tail SHALL offer a retry that re-runs only the failed page

#### Scenario: An offline rider is told so, and nothing retries in a loop
- **WHEN** the device has no connectivity and the rider reaches the end of the list
- **THEN** the tail SHALL say so specifically rather than showing the generic error state
- **AND** no automatic retry SHALL be issued while offline

#### Scenario: The end of the data reads as an ending
- **WHEN** there is genuinely nothing more to fetch
- **THEN** the tail SHALL say so in the screen's own terms
- **AND** SHALL NOT be an indicator that never resolves

#### Scenario: Extending does not move the reader
- **WHEN** a further page arrives
- **THEN** the entries already on screen SHALL keep their scroll position

### Requirement: A browser observer SHALL be created in an effect and torn down with its component

Any use of `IntersectionObserver`, `ResizeObserver`, `MutationObserver` or a `window` listener
SHALL be created inside an effect and disconnected in that effect's cleanup.

The reason is the standing one and it does not lift when the SSR shell is retired: a
`'use client'` component body still executes in a prerender pass — the same pass an
`output: 'export'` build runs at build time — where none of these globals exists. A component
that constructs one during render fails the build rather than the browser, and one that never
disconnects keeps a detached node observed for the life of the page.

An observer SHALL NOT be required for the component to render. Under `renderToStaticMarkup`, where
no effect runs, the observed element SHALL still render as ordinary markup, so a component test
needs no jsdom.

#### Scenario: The observer is never constructed during render
- **WHEN** a component that observes an element is rendered on the server or in a prerender pass
- **THEN** no observer SHALL be constructed
- **AND** the markup SHALL render without one

#### Scenario: The observer dies with its component
- **WHEN** the component unmounts
- **THEN** the observer SHALL be disconnected
- **AND** no callback SHALL fire afterwards
