# Design — the create affordance becomes a floating action

Decisions this change makes, and the measurements behind them. `proposal.md` states *what*; this
states *why*, and is the file to read before writing any code.

Everything numbered below was measured on this tree on **2026-09-06**, against the committed Figma
snapshot (`npm run figma`, offline) and against DEV (`fpmrimzxadewsaiwpsel`). Nothing here was read
from the Figma API.

**The composition was decided by the product owner on 2026-09-06**, with a shape none of this
proposal's earlier options carried: answering the RSVP *replaces* the bar with a chip. The
options A/B/C this file used to weigh are gone rather than annotated — `proposal.md` §The decided
composition is the answer, and D3 below is what it does to the code.

---

## D1 — The ride detail's departure is larger than it was scoped as, and the club's is a different class

The frame problem is two decisions with different costs. Only one of them is answered.

| | Ride detail — **in scope** | Club detail — **Q1, open** |
|---|---|---|
| Frame | `Ride - Ride plan (Details)` `2375:8771` | `Private club - Timeline` `2043:10604` |
| Navigation bar drawn | `v2 / Component / Navigation / Bar` **390×88** | the same component, **390×152** |
| Create control drawn | **none** | `Button Container 358×56`, **inside** the bar instance |
| Other bottom chrome | `Content / Ride Details / Join Ride Selector 390×96`, stacked, **unconditional** | none |
| What this change does | adds two undrawn controls **and makes a drawn one conditional** | nothing |
| Class | **two additions + one contradiction of a drawn element** | **contradiction of a shared component** |

**The zero-frame-cost line this file used to carry is withdrawn.** It held while the change only
*added* to `2375:8771`. The decided composition hides the Join Ride Selector once a rider has
answered, and that frame draws it for every viewer, permanently. Recorded as a contradiction in
`docs/FIGMA-FIDELITY-TODO.md` §Ride detail rather than as an addition.

**It is still a smaller departure than the club's, and that asymmetry is why the ride ships first.**
A departure recorded on one screen is containable: someone reading that screen's frame finds the
note. The club's changes which **variant of a shared component** the screen instances —
`Navbar.tsx`'s own measurement is *"44 frames use the first, 27 the second"* — so the note lives on
the screen while the contradiction lives in a component **27 frames** share, and the next person
reading any of the other 26 has no signal at all.

**And the screen already diverges from that frame in the same direction**, which is worth knowing
before treating the contradiction as new: the RSVP bar is already hidden from the organizer and on
past rides, neither of which the frame expresses. This change widens an existing divergence
deliberately; it does not open one.

---

## D2 — A floating action gives back horizontal space, not vertical, and this is arithmetic

```
--navbar-action:  4rem = 64px   (16 pad + 40 button + 8)  ← what .pb-navbar-action-extra reserves
--ride-rsvp-bar:  6rem = 96px   (16 + 20 prompt + 12 gap + 40 group + 8)
```

**Derive the control's clearance with the token's own rule, `16 pad + control + 8`, rather than a
second rule invented for it.** A 56×56 control reserves **80px**, 16px *more* than the bar it
replaces; a 48×48 one reserves **72px**, still 8px more. **Nothing breaks even** — matching 64px
needs a 40px control, below the 44×44 floor.

So the issue's *"a rider gets the screen's content back"* is true only if content runs **underneath**
the control, which is the occlusion defect the issue itself lists as owed. The value and the defect
are the same decision, which is why Q4 exists with a stated default.

**What does come back is horizontal.** The bar is 358 of 390px wide; the control is ~56 (circle) or
~150 (pill). That is the honest customer-value sentence and it replaces the issue's.

**Consequence for the CSS**: the clearance is a **new** class, not `.pb-navbar-action-extra` renamed.
The old class stays correct for the four `STICKY_ACTIONS` screens *and* for the club detail, which
this change does not touch. One class serving two patterns makes the later club conversion a
search-and-replace across files that all read the same.

**`--ride-rsvp-bar` is untouched, and the offset this file used to design is deleted.** An earlier
revision lifted the floating action by that token whenever the RSVP bar was drawn. The two controls
are now mutually exclusive, so there is nothing to lift clear of anything; the token keeps its one
consumer (`.pb-rsvp-bar-extra`) and its one call site (`bottomSlot === 'rsvp'`).

---

## D3 — The collision is removed rather than arbitrated, and `resolveRideDetailActions` is reshaped around that

`RideAttendanceBar` owns the sticky bottom slot on every upcoming ride the viewer does not organize,
which is most riders on most rides. Every option previously on the table shared one premise: that
both controls could want the screen at once, and something had to arbitrate. **The owner's answer
denies the premise** — a rider who has answered has no RSVP bar, so there is nothing to arbitrate.

### The function keeps existing, and its inputs change

Deleting it would put the composition back into the JSX, which is what it was written to prevent —
and there is *more* to decide now than before, not less: two controls, one chip, one clearance, and
a transient reopened state. But its old inputs cannot express the decision, because `canRsvp` has
stopped meaning *may answer* and started meaning *may answer and has not*:

```ts
export type RideDetailActions = {
  /** Which control owns the bottom edge. Never two. */
  bottomSlot: 'rsvp' | 'create' | null
  /** The chip on the ride's first content line — the viewer's OWN stored answer. */
  statusChip: 'going' | 'maybe' | null
  /** What the create sheet holds. Non-empty iff the rider may create. */
  createOptions: RideCreateOption[]
}

resolveRideDetailActions({
  rideId,
  mayAnswer,   // is_upcoming && !is_organizer
  answer,      // 'going' | 'maybe' | null — the STORED ride_members status
  canCreate,   // is_crew
  reopened,    // the rider tapped the chip
})
```

- `rsvp` iff `mayAnswer && (answer === null || reopened)`
- `create` iff `canCreate` **and** the bar is not drawn — mutual exclusion by construction, which is
  the property the owner's design rests on and the one a later tidy-up would break first
- `statusChip` non-null iff `mayAnswer && answer !== null`
- `createOptions` non-empty iff `canCreate`

**`mayAnswer` is a single input rather than `isUpcoming` and `isOrganizer` separately** because the
chip and the bar are the two halves of one condition: *the RSVP question is live for this rider*.
Passing the halves would let a future edit answer one half for the chip and the other for the bar.

### The organizer trap, which is the one thing here that fails silently

Since `103` the organizer holds a **real** `ride_members` row with status `going`
(`private.establish_ride_organizer_membership`, and the same file's backfill). So:

- a chip gated on `answer !== null` alone **draws for the organizer**;
- tapping it would open a bar whose `No` `103`'s `protect_ride_organizer_membership` refuses, and
  whose `Maybe` every screen discards, because `withOrganizer` prepends the organizer to `going`
  whatever the row says (PD-391, and `setRideAttendance`'s own comment on why the copy does not
  offer that remedy).

`mayAnswer` is what excludes them, and it must not be re-derived from `RideDetail.attendance`, which
folds the organizer in (`ownRow?.status ?? (isOrganizer ? 'going' : null)`). `isRideCrew`'s docstring
already warns about that field for the same reason: *"reading the folded field would make one arm
redundant by coincidence."*

### `timelineAdd` is dead — measured

Its case was `canRsvp && canCreate`: an upcoming ride, a crew member who does not organize it, and
the RSVP bar owning the slot. Under this design that needs a crew row **and no stored answer**, and
no such rider can exist:

```sql
-- DEV, information_schema: ride_members.status  is_nullable NO  default 'going'::text
-- ride_members_status_check: CHECK (status = ANY (ARRAY['going','maybe']))
```

Four writers, all explicit: `083`'s `private.join_ride_from_invite` (`'going'`, `on conflict do
nothing`), `103`'s organizer trigger and its backfill (`'going'`), and `setRideAttendance`'s upsert
(`'going' | 'maybe'`) / delete. And the **client** cannot see a disagreement either: `102`'s SELECT
policy on `ride_members` leads with `user_id = auth.uid()`, so a rider's own row is always returned,
and `getRide` derives `attendance` and `is_crew` from that same row. For a non-organizer,
`answer === null ⟺ !canCreate`.

So `mayAnswer && answer === null && canCreate` is **unreachable**, and the `(+)` fallback it fed is
unreachable with it. It goes, and with it `RideTimeline`'s `canAdd` and `createOptions` props and
the timeline heading's `SectionHeaderCreate`. **That heading's `(+)` is `h-10 w-10` — 40×40 with no
`::before` extension, unlike `Button` — so this change removes a sub-floor glove target rather than
adding one.**

**`SectionHeaderCreate`'s `onClick` union arm loses its only caller**, and the arm stays: deleting a
primitive's API is `design-system`'s call. Recorded here so the next reader does not conclude it was
never used.

### The `createOptions` invariant is re-proved, not inherited

It was *non-empty iff an entrance is drawn*, and that pinned a real failure — a sheet with no rows
behind a live control, invisible to `tsc`, to ESLint and to every render test, visible only to a
rider's tap. It is now **non-empty iff `canCreate`**, with the entrance drawn iff `canCreate` and the
bar is not. The gap between the two is exactly the **reopened** state: a rider who may create, is
answering, and therefore has no control drawn for the duration. That state is transient,
rider-initiated and dismissed by answering. The original failure remains impossible; the property
just needs stating in the form above rather than the old one, and the test asserts both halves.

### PD-401's option D is superseded for the answered rider, on both of its reasons

D — move the RSVP out of the sticky slot into the page body — carried two: *"Frees the slot
properly; **the RSVP is a question answered once, not a standing control**"*. An earlier revision of
this file said a floating action dissolves the first and leaves the second untouched. **That is no
longer the honest reading of this design**, and the correction matters because a build could
otherwise carry a stale sentence into `src/`:

- the **slot** reason is dissolved by mutual exclusion, not by an offset;
- the **answered-once** reason is *taken up*, by hiding the bar rather than relocating it. A rider
  who has answered no longer sees a standing control asking what they already answered — which is
  precisely what D wanted — and the chip is the affordance that keeps the answer changeable.

What is left of D is the **unanswered** rider, who still gets a standing bar in the sticky slot. For
them the answered-once argument does not apply, because they have not answered. D is therefore not
"still open with one reason"; it is spent on this screen, and moving the bar into the body is a
separate question about an unanswered rider's layout, not about this composition.

---

## D4 — The control is a trigger; `RideCreateSheet` stays the sheet

The reference expands the actions out of the button. The sheet slides up from the bottom. Both
present a labelled action list; the difference is the animation's origin.

What `ContextMenu` — which `RideCreateSheet` is built on — already carries, all measured in
`src/components/ui/ContextMenu.tsx`:

1. **A portal to `document.body`**, and its docstring records *why* it is required rather than tidy:
   any ancestor `transform` other than `none` becomes the containing block for every
   `position: fixed` descendant. Rendered in place, the scrim covered a 342px card instead of the
   screen and the sheet painted under the nav bar.
2. A focus trap on Tab / Shift-Tab.
3. Escape to close.
4. A `Grey/70%` scrim, `aria-hidden`, closing on tap.
5. `document.body.style.overflow = 'hidden'` while open, restored on close.
6. Focus restoration to the trigger.

**A floating action is exactly the case item 1 warns about.** It is `position: fixed`, so if it is
ever rendered inside a transformed ancestor — a card, or anything with `motion-safe:animate-*` that
compiles to a transform — it reparents silently. The ride detail's own `RidePlan` wrapper carries
`motion-safe:animate-fade-in`, so this is not hypothetical on this screen: mount the control outside
that subtree, and verify by rendering rather than by reading the markup.

**Decision: keep the sheet.** Reimplementing six behaviours to move an animation's origin is not what
was asked for, and the app's two portalled-sheet tests exist because a static render of a portalled
overlay returns nothing to assert against — so a rewrite starts with no coverage.

---

## D5 — The glove floor is real, it is not in `CLAUDE.md`, and the chip pays it too

```bash
grep -rn "44×44\|44x44" CLAUDE.md docs/ .claude/ src/
# .claude/agents/rider-ux.md:14      "no target smaller than 44×44pt"
# .claude/agents/design-system.md:258 "keep interactive targets at 44×44pt minimum"
# src/components/ui/Button.tsx:64     cites "CLAUDE.md's accessibility floor"
# src/components/ui/Checkbox.tsx:26   cites "CLAUDE.md's accessibility floor"
```

**`CLAUDE.md` returns zero hits.** Two primitives cite it as the source and it is not there.
Recorded because the obvious first command returns a plausible wrong answer — *there is no floor* —
which is the test `CLAUDE.md` sets for keeping a correction rather than deleting it.

**Today's bar already clears the floor by hit area rather than pixels.** `Button`'s `md` is `h-10`
(40px) with `before:absolute before:inset-x-0 before:-inset-y-0.5`.

| | Rendered | Hit area | Area |
|---|---|---|---|
| Today's bar | 358×40 | **358×44** | 15,752px² |
| Circle FAB, 56 | 56×56 | 56×56 | 3,136px² — **5.0× smaller** |
| Pill FAB, ~150×56 | 150×56 | 150×56 | 8,400px² — 1.9× smaller |

Clearing 44×44 is necessary and nowhere near sufficient: the loss is horizontal, and only the pill
recovers a useful share of it. That is D6's argument.

**The chip is a control, not a badge, and this is the sharper half.** An inline chip on a title line
is typically ~24px, and the design system has no chip primitive at 44. It needs a pill with a
visible affordance — a chevron or equivalent — for a reason that is not compliance: **once the bar
is hidden the chip is the only route back to the answer.** A rider who cannot find it cannot change
their mind, and the cost of that is a stale headcount on a ride cancelled for rain — a wrong number
in front of the organizer, which is the thing the RSVP exists to get right.

---

## D6 — Arity decides behaviour and name; hit area decides shape

`RideCreateBar`'s docstring states the principle: *"A sheet holding a single row is a tap that asks a
question with one answer."* The label follows: *"The label names the act rather than the category."*

| Actions | Behaviour | Accessible name |
|---|---|---|
| 1 | navigate directly | the **act** — *Add a photo* |
| ≥ 2 | open the sheet | the **category** — *Create* |

**The ride is on the second row today.** `108` (PD-402) gave it threads, so `RideCreateBar` already
renders `Create` and opens a two-row sheet. An earlier revision of this file defaulted the ride's
floating control to an extended pill *preserving `Add a photo`* — that label is no longer in the
tree, and a build following it would reintroduce a name that is wrong half the time.

**Shape is a separate axis from name, and it is decided on hit area (D5), not on arity.** The
default is the **extended** shape — a pill carrying the icon and the word — for both the one-action
and the many-action cases, because a bare circle costs 5× the target. A circle is correct only where
a visible label would be noise, which is not this screen.

---

## D7 — `STICKY_ACTIONS` is a different construction and stays out of scope

```bash
grep -n "STICKY_ACTIONS" -A 10 src/components/layout/Navbar.tsx
```

`/postcards`, `/rides`, `/clubs`, `/clubs/explore`. The action renders **inside** the `<nav>`, above
the tabs and beneath the bar's single top border — it *is* the 152px variant the frames draw, and the
bar owns it because *"a page cannot supply it as a sibling without breaking that border"*.

`ClubCreateBar` and `RideCreateBar` exist as separate components for one reason, recorded in
`ClubCreateBar`'s docstring: the map is **keyed on pathname alone** and cannot answer *is this rider
a member of this club* or *on this ride*. And *"a control that always fails RLS is worse than none"*.

Converting those four means changing the shared navigation component, four frames and the
`--navbar-action` geometry `.pb-navbar`, `.pb-navbar-action` and `.pb-navbar-action-extra` all derive
from — including `/rides/explore`, which reserves that clearance for an action **not in the map at
all** (PD-407 is filed; untouched here).

**Out of scope, and the resulting inconsistency is named rather than hidden** (Q5): after this
change `/rides` has a full-width bar, the ride detail one tap away has a floating action, and the
club detail keeps its bar until Q1 is answered.

---

## D8 — Both controls are screen-owned, and hoisting is the failure mode to design against

The tempting simplification is *a floating action is app chrome, put it in `(app)/layout.tsx`*. It is
wrong here in four ways, each with a precedent in this repo:

1. **It cannot be gated.** A layout knows the pathname, not the crew relationship — the exact reason
   `RideCreateBar` is not in `STICKY_ACTIONS`.
2. **It lands on the two `BARLESS` screens.** The ride threads and the club thread have
   bottom-anchored fixed composers and deliberately render no navigation bar. `081` shipped the club
   thread with a navigation bar over its composer for one walk; `elementFromPoint` over both the
   input and Send returned the `nav`. A hoisted control reproduces that exactly, and **nothing but
   `npm run walk` can see it**.
3. **It would draw on every screen for every rider**, including those with no create action.
4. **The `undefined` window becomes global.** A gate read per screen is `undefined` on first paint;
   a hoisted control would flicker on every navigation.

The same argument covers the chip, with one addition: in the fixed header it would persist onto the
ride's crew and threads screens, where there is no bar to reopen and no answer to change.

---

## D9 — The chip's state machine, and the one thing it must not do

`reopened` is component state, and the screen owns it — not `RideAttendanceBar`, and not the
resolver, which stays pure and takes it as an input.

| Event | `reopened` | Why |
|---|---|---|
| Chip tapped | `true` | The whole point of the chip. |
| Answer **succeeds** with `going`/`maybe` | `false` | The bar collapses back to the chip, now showing the new answer. |
| Answer **succeeds** with `No` | irrelevant | The row is deleted, so `answer` is `null` and the resolver draws the bar anyway — and the chip, the floating action and the thread row all go, because the rider is no longer crew. |
| Answer **fails** | `true` — unchanged | **The load-bearing one.** `RideAttendanceBar` rolls the pill back and renders why in its `role="status"` line. Collapsing on the *tap* would destroy the message and make the failed write read as having worked. Collapse on success only. |
| Navigation away and back | `false` | Nothing persists it. The chip is the resting state for an answered rider. |

Two further notes for the build:

- **The screen learns about success from the bar**, so `RideAttendanceBar` gains one optional
  callback fired only when the action returned no error. Nothing else about that component changes —
  not its markup, not its optimistic rollback, not its border, not its offset.
- **The composition follows the server, not the optimistic pill.** `setRideAttendance` invalidates
  `rides.all()`, so `answer` changes only when the read lands. That is what makes the failure case
  safe by construction: a failed write never moves the composition at all.

---

## D10 — What this change does not build

Named so they are decisions rather than omissions:

- **No `no` status, no migration, no change to `private.is_ride_crew`.** The `No`/never-answered
  conflation is the accepted cost of the owner's cheap route. Making it symmetric would touch a
  helper that now gates ride threads (`108`) as well as postcard tagging (`041`), so it is a
  database story and not this one.
- **No chip on a past ride**, even though the answer is a fact about it. The chip is a control, and
  a control that opens a bar nobody may use is worse than the crew rail already saying who rode.
- **No club detail.** Q1 is open; `ClubCreateBar` is not touched.
- **No scroll-responsive behaviour.** No hide-on-scroll-down, no shrink-on-scroll. Nothing in the app
  does this and no frame draws it.
- **One elevation value, defined here and named as invented.** The design system has none
  (`grep -in "shadow\|elevation" design/TOKENS.md` → 0) and this is the app's first *persistent*
  floating control, so it cannot be built without one. It goes in `globals.css` beside the geometry
  tokens with the same auditable comment, and `design-system` owns replacing it when the frame
  catches up. Copying `Banner`'s stock `shadow-lg` — invented for a transient overlay, measured
  against nothing — is not the same as deciding it.
- **No second entrance anywhere.** The club's section `(+)` (PD-342) and the empty-section create
  tiles (PD-312, PD-318) are untouched; only the ride timeline's `(+)` goes.
- **No new dependency.** Twelve is the count and a floating action does not move it.
