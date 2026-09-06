# Design — the create affordance becomes a floating action

Decisions this change makes, and the measurements behind them. `proposal.md` states *what*; this
states *why*, and is the file to read before writing any code.

Everything numbered below was measured on this tree on **2026-09-06**, against the committed Figma
snapshot (`npm run figma`, offline) and against DEV (`fpmrimzxadewsaiwpsel`). Nothing here was read
from the Figma API.

---

## D1 — Two screens, two classes of departure, and only one is a contradiction

The issue treats *the frame problem* as one decision. It is two, and they have different costs.

| | Club detail | Ride detail |
|---|---|---|
| Frame | `Private club - Timeline` `2043:10604` | `Ride - Ride plan (Details)` `2375:8771` |
| Navigation bar drawn | `v2 / Component / Navigation / Bar` **390×152** | the same component, **390×88** |
| Create control drawn | `Button Container 358×56`, **inside** the bar instance | **none** |
| Other bottom chrome | none | `Content / Ride Details / Join Ride Selector 390×96`, stacked |
| What this change does to it | changes the instanced **variant** and deletes a drawn child | adds a control the frame never drew |
| Class | **contradiction of a shared component** | **addition to a screen** |

`Navbar.tsx`'s own docstring measures the split across the snapshot: *"88px for the bar alone, 152px
when a screen supplies the sticky primary action … (44 frames use the first, 27 the second)"*.

**The asymmetry is the whole recommendation.** A departure recorded on one screen is containable:
someone reading that screen's frame finds the note. A departure that changes how a screen instances
`v2 / Component / Navigation / Bar` is not, because the note lives on the screen and the
contradiction lives in the component that **27 frames** share. The next person reading any of the
other 26 has no signal at all.

`RideCreateBar` is already a departure of the second class — it was shipped on 2026-09-06 against a
frame that draws no create control — and nobody thinks that was wrong, which is the point: the
classes really are different, and the app already ships one of them.

**Corollary the build may act on**: the ride detail can convert without any Figma work. If the owner
wants motion before a design session, that half is free.

---

## D2 — A floating action gives back horizontal space, not vertical, and this is arithmetic rather than opinion

```
--navbar-action:  4rem = 64px   (16 pad + 40 button + 8)  ← what .pb-navbar-action-extra reserves
--ride-rsvp-bar:  6rem = 96px   (16 + 20 prompt + 12 gap + 40 group + 8)
```

A conventional floating action is 56×56. With a 16px gap above the navigation bar and 16px of
breathing room above it, a page reserving its clearance reserves **72px** — 8px *more* than the bar
it replaces. At 48×48 it is 64px, exactly break-even.

So the issue's *"a rider gets the screen's content back"* is true only if content is allowed to run
**underneath** the control, which is the occlusion defect the issue itself lists as owed. The value
and the defect are the same decision, which is why Q4 exists with a stated default rather than being
left to whoever writes the CSS.

**What does come back is horizontal.** The bar is 358 of 390px wide. The control is ~56 (circle) or
~150 (pill). The last visible row goes from fully covered to ~86% (circle) or ~62% (pill) readable.
That is the honest customer-value sentence and it should replace the issue's.

**Consequence for the CSS**: the clearance is not `.pb-navbar-action-extra` renamed. It is a new
token, because it is a different number and because the old class is still correct for the four
`STICKY_ACTIONS` screens this change does not touch. Two classes, one per pattern; do not make one
serve both, or converting the remaining four screens later becomes a search-and-replace across
five files that all read the same.

---

## D3 — `resolveRideDetailActions` is reshaped, not retired, and the fallback is what actually goes

The task asked whether a floating action dissolves the collision the function exists for. It
dissolves **half** of it.

**What dissolves.** The slot contest does. `RideAttendanceBar` wants a full-width fixed bar in the
sticky slot; the old create control wanted the same slot; a floating action wants no slot. So
`bottomSlot: 'rsvp' | 'create' | null` — a three-way answer to *who gets the slot* — collapses to
`rsvpBar: boolean`, which is just `canRsvp`.

**What does not.** The two controls still contend for the same **pixels**. `.bottom-navbar` anchors
a bar at `calc(var(--safe-bottom) + var(--navbar-tabs))`, and `RideAttendanceBar`'s `ButtonGroup` is
358 wide inside `max-w-lg mx-auto` — so it reaches the bottom-right corner. A floating action
anchored at the same offset lands on the `No` pill. It has to be lifted by `--ride-rsvp-bar` exactly
when the RSVP bar is drawn, and that condition is `canRsvp` again. The collision moves from *which
control* to *how far up*; it does not go away, and writing it as an inline `canRsvp && 'bottom-…'`
in the JSX re-opens the drift the function's docstring warns about in as many words.

**What genuinely retires — under Q2 answer A only.** The complementary-entrance invariant, *"exactly
one entrance to the composer, never two and never none"*, needed a decision table because the create
control could not always be drawn. A floating action always can. So the entrance becomes `isCrew`,
full stop:

- `timelineAdd` becomes constant `false`;
- `RideTimeline`'s `canAdd` prop goes;
- `SectionHeader`'s `create` slot loses its ride-detail caller (it keeps its club-detail ones —
  PD-342 is not reopened);
- the invariant holds **by construction** — one control, one condition — rather than by a function
  with an exhaustive test.

That is the significant simplification, and it is worth saying that it is *smaller* than "the
function retires": the function keeps existing, keeps its test, and keeps being the single place the
ride detail's bottom composition is decided. Deleting it would put the clearance condition back in
the JSX, which is what it was written to prevent.

**Proposed shape:**

```ts
export type RideDetailActions = {
  rsvpBar: boolean          // RideAttendanceBar draws
  floatingAction: boolean   // the create control draws
  clearance: 'navbar' | 'rsvp'   // which bottom offset both the control and the page use
}
```

Still `(canRsvp, canCreate) → ...`, still exhaustive over four inputs, still one test file.

### PD-401's option D is made **unnecessary**, not reopened

D — move the RSVP into the page body — existed to free the sticky slot, because two full-width bars
cannot share it. A floating action does not want the slot. So D's motivation is gone and the RSVP
bar stays exactly where `2375:8771` draws it.

This matters because PD-404's 01:48Z comment offers D as answer **C** to the composition question,
and **C is the only one of the three answers that contradicts a frame**. Answer A costs no frame on
this screen at all. A build reading the comment alone might conclude the floating action *requires*
resolving the RSVP's position; it does not, and that inversion is the most useful thing this design
file records.

---

## D4 — The control is a trigger; `ContextMenu` stays the sheet

The reference expands the actions out of the button. `ContextMenu` slides a sheet up from the bottom.
Both present a labelled action list; the difference is the animation's origin.

What `ContextMenu` already carries, all measured in `src/components/ui/ContextMenu.tsx`:

1. **A portal to `document.body`** — and its docstring records *why* it is required rather than tidy:
   `PostcardDeck` gives each card a `transform`, and any transform other than `none` makes that
   element the containing block for every `position: fixed` descendant. Rendered in place, the scrim
   covered a 342px card instead of the screen and the sheet painted under the nav bar.
2. A focus trap on Tab / Shift-Tab, over `a[href], button:not([disabled])`.
3. Escape to close, on a `document` listener.
4. A `Grey/70%` scrim, `aria-hidden`, closing on tap.
5. `document.body.style.overflow = 'hidden'` while open, restored on close.
6. Focus restoration to the trigger, because the sheet unmounts with focus inside it.

**A floating action is exactly the case item 1 warns about.** It is `position: fixed`, and if it is
ever rendered inside a transformed ancestor — a card, an animated list, anything with
`motion-safe:animate-*` that compiles to a transform — it reparents silently. So the control itself
should be portalled or mounted at the page root, and an expand-in-place list inherits the same
hazard without inheriting the fix.

**Decision: keep the sheet.** Reimplementing six behaviours to move an animation's origin is not what
was asked for, and the app's only two portalled-sheet tests (`PostcardMenu.test.tsx`,
`PrivacySheet.dom.test.tsx`) exist because a static render of a portalled overlay returns nothing to
assert against — so the rewrite starts with no coverage. Q3 records the alternative and what it owes.

---

## D5 — The glove floor is real, it is not in `CLAUDE.md`, and the bar already clears it by hit area

```bash
grep -rn "44×44\|44x44" CLAUDE.md docs/ .claude/ src/
# .claude/agents/rider-ux.md:14      "no target smaller than 44×44pt"
# .claude/agents/design-system.md:258 "keep interactive targets at 44×44pt minimum"
# src/components/ui/Button.tsx:64     cites "CLAUDE.md's accessibility floor"
# src/components/ui/Checkbox.tsx:26   cites "CLAUDE.md's accessibility floor"
```

**`CLAUDE.md` returns zero hits.** Two primitives cite it as the source and it is not there; the
floor lives in two agent briefs. Recorded because the obvious first command — grep `CLAUDE.md` —
returns a plausible wrong answer (*there is no floor*), which is the test `CLAUDE.md` §Working
Principles sets for keeping a correction rather than deleting it.

**Today's bar already clears the floor, and by hit area rather than pixels.** `Button`'s `md` is
`h-10` (40px) with `before:absolute before:inset-x-0 before:-inset-y-0.5` — an invisible 44px touch
target over a 40px rendered box, exactly so the design's measured height survives the floor.

So the comparison is:

| | Rendered | Hit area | Area |
|---|---|---|---|
| Today's bar | 358×40 | **358×44** | 15,752px² |
| Circle FAB, 56 | 56×56 | 56×56 | 3,136px² — **5.0× smaller** |
| Pill FAB, ~150×56 | 150×56 | 150×56 | 8,400px² — 1.9× smaller |

Clearing 44×44 is necessary and nowhere near sufficient: the loss is horizontal, and only the pill
recovers a useful share of it. That is D6's argument.

**And the fallback this change may retire is already under the floor.** `SectionHeader`'s `create`
`(+)` is `h-10 w-10` — 40×40 — with **no** `::before` extension, unlike `Button`. Under Q2 answer A
this change deletes a sub-floor target from the ride detail rather than adding one. Under answer B it
leaves it as the only entrance for the collision case, which is a reason to prefer A that has
nothing to do with frames.

---

## D6 — Arity decides the control's behaviour, and the rule is written rather than per-screen

`RideCreateBar`'s docstring already states the principle: *"A sheet holding a single row is a tap
that asks a question with one answer."* The label follows from the same place: *"The label names the
act rather than the category. The club's says `Create` because it opens a menu of three; with one
destination, `Create` would make the rider tap to find out what it creates."*

A bare circular icon destroys that label. So:

| Actions | Behaviour | Accessible name | Shape |
|---|---|---|---|
| 1 | navigate directly | the **act** — *Add a photo* | **extended** (icon + label) |
| ≥ 2 | open `ContextMenu` | the **category** — *Create* | plain circle |

PD-402 gives the ride a second action, at which point the ride's control crosses the rule and starts
opening a sheet **by the rule** rather than by an edit. That is why it is a rule and not two
components.

The cost is that the two screens' controls look different. That is correct: one *is* an action and
one is a menu, and drawing them identically would be the misleading option.

---

## D7 — `STICKY_ACTIONS` is a different construction and stays out of scope

```bash
grep -n "STICKY_ACTIONS" -A 10 src/components/layout/Navbar.tsx
```

`/postcards`, `/rides`, `/clubs`, `/clubs/explore`. The action renders **inside** the `<nav>`, above
the tabs and beneath the bar's single top border — it is literally the 152px variant the frames
draw, and the bar owns it because *"a page cannot supply it as a sibling without breaking that
border"*.

`ClubCreateBar` and `RideCreateBar` exist as separate components for one reason, recorded in
`ClubCreateBar`'s docstring: the map is **keyed on pathname alone** and cannot answer *is this rider
a member of this club*. All three club destinations require `private.is_club_member`, and *"a control
that always fails RLS is worse than none"*.

Converting the four `STICKY_ACTIONS` screens therefore means changing the shared navigation
component, four screens' frames and the `--navbar-action` geometry that `.pb-navbar`,
`.pb-navbar-action` and `.pb-navbar-action-extra` are all derived from — including on
`/rides/explore`, which reserves that clearance for an action that **is not in the map at all**
(finding 5 in `proposal.md`; a pre-existing 64px of dead space, left untouched here).

**Out of scope, and the resulting inconsistency is named rather than hidden** (Q5): after this
change, `/clubs` has a full-width bar and the club detail one tap away has a floating action.

---

## D8 — The control is screen-owned, and hoisting it is the failure mode to design against

The tempting simplification is *a floating action is app chrome, put it in `(app)/layout.tsx`*. It is
wrong here in four separate ways, and each has a precedent in this repo:

1. **It cannot be gated.** A layout knows the pathname, not the membership — the exact reason
   `ClubCreateBar` is not in `STICKY_ACTIONS`.
2. **It lands on the two `BARLESS` screens.** The ride chat and the club thread have bottom-anchored
   fixed composers and deliberately render no navigation bar. `081` shipped the club thread with a
   navigation bar over its composer for one walk, because a list entry was missed;
   `elementFromPoint` over both the input and Send returned the `nav`. A hoisted floating action
   reproduces that defect exactly, and **nothing but `npm run walk` can see it** — `tsc`, ESLint,
   Vitest, `next build` and the RLS suite are all green on a screen nobody can type in.
3. **It would draw on every screen for every rider**, including the ones with no create action at
   all, which is a control that fails or navigates nowhere.
4. **The `undefined` window becomes global.** A gate read per screen is `undefined` on first paint;
   a hoisted control would flicker on every navigation.

So: **the screen owns its control**, the same way it owns its bar today, and the primitive under
`src/components/ui/` is presentational only — it takes its gate as a prop and decides nothing.

---

## D9 — What this change does not build

Named so they are decisions rather than omissions:

- **No scroll-responsive behaviour.** No hide-on-scroll-down, no shrink-on-scroll. Nothing in the
  app does this, no frame draws it, and it would be the app's first scroll-driven animation. If Q4
  goes the "content runs underneath" way, that is where this would be revisited.
- **No elevation token invented by this change.** It is `design-system`'s, and under Q1 answer A it
  arrives with the frame. Under answer B it is the first thing the build must ask for rather than
  copy from `Banner`'s stock `shadow-lg`.
- **No second entrance anywhere.** The `(+)` beside a section title (PD-342) and the empty-section
  create tiles (PD-312, PD-318) are unchanged on the club detail; only the ride timeline's `(+)`,
  which exists solely as PD-401's fallback, is in scope.
- **No migration, no policy, no grant.** Every gate already exists.
- **No new dependency.** Twelve is the count and a floating action does not move it.
