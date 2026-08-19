## Context

See `proposal.md` for motivation. What shapes the approach:

- **One primitive, four callers.** `src/components/ui/PlaceSearchField.tsx` holds the field, the
  sheet (`PlaceSearchSheet`), the credit (`PlaceDataCredit`), the state machine (`SheetBody`), the
  debounce, the abort, the generation guard and the shared-cache read. Only the sheet is being
  removed; everything else moves onto the field.
- **The lookup itself is untouched.** `searchPlaces()` still calls the `search-places` Edge Function,
  which still writes `069`'s ledger row *before* the vendor call, so abort saves flicker and never a
  credit. `PLACE_SEARCH_MIN_CHARS` (4), `PLACE_SEARCH_MAX_CHARS` (200), `PLACE_SEARCH_CACHE_MS`
  (5 min), `DEBOUNCE_MS` (250) and the three error classes all survive unchanged.
- **The client is the whole render model.** No server step exists to pre-fill recents, and reads
  happen in effects and event handlers, never during render (`resolve.browser.ts` throws in the
  prerender pass by design).
- **No new runtime dependency, and no UI library.** Nine runtime dependencies; a combobox is built
  from `src/components/ui/*` and about eighty lines of keyboard handling, not from Radix.
- **`position: fixed` is a trap in this tree.** Both `ContextMenu` and the sheet being deleted carry
  the same comment: an ancestor with a transform becomes the containing block for a fixed element,
  and these forms sit under animated wrappers. That is why the sheet went through a portal, and it is
  the first thing that would bite a naive dropdown.
- **The Capacitor shell has no keyboard plugin.** Four Capacitor packages are installed and
  `@capacitor/keyboard` is not one of them; `capacitor.config.ts` is written-and-unverified, and no
  native project has ever been generated. So keyboard behaviour is the WebView's default and cannot
  be verified in this container.
- **Measured, not assumed** (DEV `fpmrimzxadewsaiwpsel`, 2026-08-19): `rides`' SELECT policy leads
  with `organizer_id = auth.uid()`; `authenticated` holds column SELECT on `meeting_point`,
  `start_place_id`, `latitude`, `longitude`; `rides_organizer_id_idx` exists;
  `rides_location_coupling` makes `start_place_id IS NOT NULL` imply a complete coordinate;
  `clubs_location_coupling` refuses a `location_name` with no coordinate.

## Goals / Non-Goals

**Goals**

- One control, one shape, no second screen, on all four callers.
- The seven lookup states, all distinguishable, in a list a few hundred pixels tall.
- Three recent starts on focus, costing no credit and no schema.
- A combobox a rider can drive with a keyboard and a screen reader can describe.
- Everything typed survives a refused submit, an opened list, a closed list and a failed lookup.

**Non-Goals**

- Ghost-text completion. Still deferred, and moving the list onto the field is exactly when it gets
  built by accident.
- Any change to the proxy, the ledger, the ceilings, the vendor or the attributions page's content.
- Recents anywhere but the ride's start field.
- A native keyboard plugin. If occlusion cannot be solved without one, that is a separate decision
  and `native`'s to make.

## Decisions

### D1 — The list renders in flow, inside the field's own container

Three options were considered:

- **A portal plus `position: fixed`**, measuring the input's rect. This is what the sheet did, and it
  needs the portal *because* of the transform trap. For a dropdown it also needs re-measuring on
  every scroll and resize, and the mobile keyboard resizes the viewport under it. Rejected: most
  machinery, most ways to be wrong.
- **`position: absolute` inside a `relative` wrapper.** No transform trap, no measurement — but it is
  clipped by any ancestor with `overflow: hidden`, and it overlays the fields below, which under a
  raised keyboard is precisely the area with no room.
- **In flow, as a sibling under the input, expanding the field's container.** Chosen. It cannot be
  clipped, needs no measurement, no portal and no re-layout on scroll, and the page's own scroll
  container does the work. Its cost is that the fields below move down while the list is open, which
  on a form the rider is actively typing into is acceptable and arguably informative.

The list is capped at four rows plus the credit and scrolls internally beyond that, so the form never
grows without bound.

### D2 — The field scrolls itself into view on focus; no keyboard plugin

On open, the field calls `scrollIntoView({ block: 'nearest' })` so the input and the first rows sit
above the keyboard. `window.visualViewport` is read-only and free (no dependency) if a measurement is
needed to decide how many rows fit; it is not needed for a fixed cap.

The design frame is the reference for the geometry: `Rides / Add starting location - Filled`
(`1918:15967`) draws a 390×844 screen with a 349px keyboard — 41% of the viewport — and a 311px scroll
area for the list. Inline, the field is the third control on `/rides/new`, so without the scroll the
list opens straight into the keyboard.

**This is the requirement most likely to be satisfied on the web and broken in the shell.** iOS and
Android resize the WebView differently, and the Android manifest that decides it is generated by
`cap add`, which has never been run here. The task list carries a device-verification task assigned to
the native shell rather than a claim that it works.

### D3 — The recents read: `lib/data/rides.ts`, bounded, deduped in TypeScript

One new function, alongside the other named reads:

- Select `meeting_point`, `start_place_id`, `latitude`, `longitude` from `rides`.
- **Filter `organizer_id` to the caller explicitly.** RLS admits more than this — every ride the
  rider may read — so the filter is the *rule*, not a redundant belt: without it the list would
  quietly include rides the rider merely joined, which is a stated negative.
- `start_place_id is not null`, `order by created_at desc`, `limit` a named scan bound (20).
- Dedupe by `start_place_id` in TypeScript, take 3.

**Why not `DISTINCT ON` in SQL:** PostgREST cannot express it, so it would take an RPC — a migration,
which is the one thing this change is worth avoiding.

**What the index actually buys, stated precisely.** `rides_organizer_id_idx` is `btree (organizer_id)`
alone — no `created_at`, no partial predicate. So the index confines the work to *this rider's* rides,
and the `limit` caps what crosses the wire, but the ordering is still applied across that rider's own
rows. It is a per-rider cost, not a table scan, and the artifacts say exactly that rather than
"bounded". Making it constant would need a composite or partial index — a migration, and this change
adds none.

**Why `created_at` rather than `departure_at`:** `created_at` is when the rider *chose* that place;
`departure_at` is when the ride happens and can be a year out, so ordering by it would float a ride
planned for next summer above the one created this morning. The accepted cost is that editing an old
ride's start does not move it to the top of the list — the row is old even though the choice is
fresh. Recorded as a limitation, not a bug to fix later by adding a column.

### D4 — The cache key is `rides.recentStarts()`, nested under `rides`

`['rides', 'recentStarts']`, declared in `keys.ts` under the `rides` block. `createRide`,
`updateRide` and `deleteRide` already call `invalidate(queryKeys.rides.all())`, and `rides.all()` is
the `['rides']` prefix, so all three move it with **no new call site**. `setRideAttendance` also
invalidates that prefix and will refetch the list for no reason; that is the safe direction, and the
read is three rows.

No rider id in the key: no key in this file carries one, because the cache is destroyed at sign-out
rather than partitioned per rider.

### D5 — The club field becomes an input whose text is never submitted, and typing does not delete a pick

This is the sharp edge of collapsing the two modes. Today a club's location is a value *button*, so
there is no way to type text that is not a pick. As an input there is.

- The visible club input carries **no `name` attribute**. It is a search box.
- The four hidden inputs stay exactly as they are — `location_name` continues to carry the *picked*
  name, and `readClubLocation` continues to return `null` unless all four are present.
- **Typing does NOT drop the pick in place mode.** The pick stands until the rider picks another or
  taps Clear. This is the opposite of free-text mode, and the asymmetry is not an inconsistency: in
  free-text mode the visible text **is** the stored value, so a pin that disagrees with it must go; in
  place mode the text is stored nowhere, so there is nothing for the pin to disagree with.
- **On blur with unpicked text, the input reverts** to the picked name, or to empty if there is no
  pick, so what the rider sees is what a submit would store.
- **Clear is the only removal.** It drops the pick and empties the text together, which is the rider
  asking for exactly that.

**Why the alternative was rejected outright.** Clearing the pick on the first keystroke, the way
free-text mode does, means an owner who types one character into an existing club's location field and
taps away has silently deleted the club's location: the revert resolves to empty, `readClubLocation`
returns `null`, the submit stores nothing, and the field being optional means nothing is reported. A
stray keystroke that deletes stored data with no error is worse than a transient disagreement between
text and pin while the field is focused.

**Blur is not the only exit, and this is the case that hides.** A rider can submit from *inside* the
focused field — Enter with the list open and no option active — and no blur ever happens. So the
reconciliation is bound to that path too: Enter with no active option reverts the text to the held pick
and closes the list, **without** preventing the submit, because the rider asked to save. What gets
written is what the field was showing.

The database is the backstop rather than the mechanism: `clubs_location_coupling` refuses a
`location_name` with no coordinate, so even a hand-crafted request cannot store a typed club
location. The revert exists so a rider is never *told* a location was saved when it was not.

The ride field keeps the opposite arrangement, unchanged: its visible input **is** `meeting_point`,
typed text is the stored value, and typing throws the pin away.

### D6 — Combobox mechanics

`role="combobox"` on the input with `aria-expanded`, `aria-controls` and `aria-activedescendant`;
`role="listbox"` on the list and `role="option"` on each row; `autoComplete="off"`. Behaviour:

- Arrow up/down move the active option; Home/End are not bound (three to five rows).
- **Enter with an active option calls `preventDefault()`** and selects. Without this the form submits
  — on `CreateRideForm` that means a half-filled ride is refused and the rider blames the field.
- **Escape closes only.** It does not clear the input, does not drop the pick, and does not bubble to
  anything that would submit or navigate.
- Rows use `onMouseDown` with `preventDefault()` so a tap registers before the input's blur tears the
  list down — the classic dropdown defect, and the one most likely to survive a code review.
- Closing on blur, not on outside-click bookkeeping: the field owns focus and there is no dialog.

**Composition, because `role="listbox"` may contain only options.** The `Recent starts` heading and
`PlaceDataCredit` are siblings of the `ul[role="listbox"]` inside the visual panel, never children of
it; every message state — the hint, searching, no matches, an error, a ceiling — renders *instead of*
the list rather than inside it; and `aria-expanded` is true only when there are actually options to
move through, so the combobox never claims an expanded list of nothing.

**The `preventDefault()` on mousedown belongs to the whole panel, not to the rows.** The credit link
and the Retry button live in that panel too, and a rows-only fix would leave the licence obligation
discharged by a link that disappears under the tap aimed at it. One handler on the panel covers rows,
credit and retry together, which is why the spec states the guarantee — every control in the panel is
operable — rather than the mechanism.

`type="text"`, not `type="search"` — a search input renders a native clear affordance that duplicates
the field's own clear button.

### D6a — Recents visibility is keyed on the input's value, not on a keystroke

"Clear the recents on the first keystroke" is the rider-visible rule and the wrong quantity to
implement it on: paste, cut, undo, an IME commit and the field's own Clear control all change the value
without producing one. The condition is therefore `value === ''` — recents render exactly while the
input is empty. This also subsumes the late-answer problem for free: a recents response that lands
after the rider has typed simply has nowhere to render, so no generation counter is needed for it. The
lookup keeps its own generation counter, which exists for a different reason (out-of-order vendor
responses).

### D6b — The debounce is 400ms, not the sheet's 250

The sheet had its own dedicated search input, so every keystroke in it was meant as a lookup. The
field is not that: in free-text mode the rider is typing a **meeting point**, and a long typed answer
that was never meant as a lookup settles several times on its way through — each settle a metering row
and a vendor credit, because `069`'s ledger is written before the vendor is called. 400ms is the cost
of that difference, and it is a spend control rather than a politeness.

### D7 — The bias moves from "the sheet opened" to "the field was focused"

`resolveRiderLocation()` is memoised, never prompts, and was deliberately resolved when the sheet
opened rather than on mount so that a rider who never searches is never located. With no sheet, the
equivalent moment is the **first focus of the field**. Resolving it on form mount would silently
locate every rider who opens the create-ride screen, which is a regression nothing would flag.

### D8 — Recents and results are visibly different lists

The spec requires a rider to be able to tell which list they are looking at. Mechanism: recents are
introduced by a small heading row (`Recent starts`) and use a distinct icon from the location pin the
lookup rows use. Recents rows show the stored meeting point on one line and no meta line, because
there is no second field stored for them.

### D9 — The credit renders as the list's last row when there are rows

`PlaceDataCredit` keeps its own component and its own test; only its placement changes. It renders
inside the list, after the last row, whenever the list has rows — recents included, because a
recent's label is provider-derived text stored verbatim.

## Risks / Trade-offs

- **Keyboard occlusion on a real phone** → the biggest one, and the only one this container cannot
  test at all. Mitigated by D1 + D2 and by a device-verification task; if it fails, the fallback is a
  smaller cap and a stronger scroll, and a native keyboard plugin is a *separate* decision.
- **Enter submitting the form mid-search** → D6's `preventDefault`, plus a test asserting Enter with
  an active option does not submit.
- **A tap lost to blur** → D6's `onMouseDown`/`preventDefault`. Silent, and it reads as "the app
  ignored my tap".
- **A late recents answer landing over typed text** → not a separate mechanism: recents render only
  while the value is empty (D6a), so a late answer has nowhere to land. The lookup keeps its own
  generation counter for out-of-order vendor responses.
- **The form growing under the rider** → capped at four rows plus the credit, scrolling internally.
- **Interactive behaviour is barely testable here.** The unit environment is `node` and both existing
  component tests render through `renderToStaticMarkup`, which reaches roles and attributes but no
  events. Keyboard behaviour therefore has no gate unless one is added — see Open Questions.
- **Typing a meeting point now spends the lookup ceiling.** `069`'s per-rider ceilings are **20 an
  hour and 60 a day**, and they were sized against a sheet a rider deliberately opened. The same input
  is now the meeting-point field, so a rider who types their starts and never wants a lookup spends
  credits anyway — three typed rides in an hour is plausibly 9–24 of the 20. Mitigations, in the order
  they bite: the 400ms debounce (D6b), the five-minute result cache, and recents, which remove the
  reason to type at all for a repeat start. **Raising the cap is a separate decision and a migration**
  — the ceiling lives in the ledger's INSERT policy — and is deliberately not part of this change; if
  riders start hitting it, that is the evidence for reopening it, and the ceiling states already tell
  them apart from an outage.
- **A rider's recents are addresses on screen at focus time.** Accepted: they are that rider's own
  rows, on their own device, shown to them. Nothing new is stored, and the cache dies at sign-out.

## Open Questions

Each has a default so the build is never blocked by an unanswered one.

**Q1 — Does the credit render when the list shows only a message?** *Non-blocking; product owner (a
licence-adjacent call).* Default: no — a hint or an error renders no provider-derived content. Both
readings are compliant; the spec permits either.

**Q2 — `created_at` or `departure_at` for "newest first"?** *Non-blocking; product owner.* Default:
`created_at` (D3), accepting that editing an old ride's start does not float it to the top.

**Q3 — Is `@capacitor/keyboard` acceptable if CSS and scrolling cannot satisfy the occlusion
requirement?** *Blocking, but only for the native shell — the web build ships either way; product
owner, on `native`'s advice.* Default: no plugin in this change; ship the CSS answer, verify on
device, and raise it as its own decision if it fails.

**Q4 — Add `jsdom` as a devDependency for one keyboard test?** *Non-blocking; `test` agent's call
with the owner.* Default: yes, one test file with a jsdom environment for the combobox keys, because
the alternative is that Escape-does-not-submit has no gate at all. It is a devDependency, so it does
not touch the nine runtime dependencies or the bundle.

**Q5 — Should the walk gain a phase for this?** *Non-blocking; `test` agent.* Default: no. The walk's
remit is one question per route plus six named phases, and a new phase needs a defect no other gate
can see. The nearest candidate is "the list opens and a row is tappable", which a jsdom test covers
more cheaply.

*(The empty-input-with-no-recents case was listed here as a question and is not one: the seven-states
requirement decides it with a SHALL — the minimum-characters hint — and the task list implements it.)*
