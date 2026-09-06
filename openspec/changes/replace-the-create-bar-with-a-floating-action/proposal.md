# The create affordance becomes a floating action instead of a full-width bar

> **This proposal does not pick the frame decision, and it must not be read as having picked it.**
> PD-404's body says *"the build must not pick one silently"*, and Q1 below is that decision put to
> the product owner with a recommendation attached. Everything else here is measurable today and is
> written so that **one answer to Q1 unblocks the build** rather than a design session.

## Why

Product owner, 2026-09-05, referencing the OutSystems *floating actions* pattern
(`PatternDetail?PatternId=507`): replace the always-drawn full-width create bar with a floating
action that expands into its actions.

Two screens own such a bar today. Both were built deliberately and both carry their reasoning in
their own docstrings, which this change reads rather than re-derives:

| Component | Screen | Actions | Gate | Frame |
|---|---|---|---|---|
| `src/components/clubs/ClubCreateBar.tsx` | club detail | 3 — Postcard, Ride, Thread, via `ContextMenu` | member (`private.is_club_member`) | `Private club - Timeline` `2043:10604` |
| `src/components/rides/RideCreateBar.tsx` | ride detail | 1 — `routes.newPostcardInRide`, no sheet | crew (`private.is_ride_crew`) | `Ride - Ride plan (Details)` `2375:8771` |

`PD-401` merged at 00:32Z on 2026-09-06, so the second bar now exists and this story can convert
both screens at once. The mechanical blocker named in the issue is gone.

### Five things were measured while writing this, and four of them change the story's shape

Every number below was measured on this tree on 2026-09-06, with the command beside it. They are
listed first because three of them contradict the framing the issue was written with.

---

#### 1. A floating action that reserves its own clearance gives back **no space at all** — it costs 8px more than the bar

This is the finding that most changes the story, because the issue's `Customer value` line is
*"a rider gets the screen's content back"*.

```bash
grep -n "navbar-action\|ride-rsvp-bar" src/app/globals.css
# --navbar-action: 4rem;    /* 16 pad + 40 button + 8 */   = 64px
# --ride-rsvp-bar: 6rem;    /* 16 + 20 + 12 + 40 + 8 */    = 96px
```

The create bar reserves **64px** of scroll clearance through `.pb-navbar-action-extra`. A
conventional floating action is 56×56; give it the same 16px gap above the navigation bar and its
own 16px breathing room and the clearance a page must reserve is **72px** — *more* than the bar it
replaced. Even a 48px circle with a 16px gap reserves 64px, exactly breaking even.

**The space only comes back if content is allowed to scroll underneath the floating action**, which
is the second negative case the issue lists. So the story's value proposition and its most dangerous
defect are the *same decision*, and it has to be made explicitly rather than falling out of the
implementation. Q4 is that decision, with a default.

What genuinely does come back is **horizontal**: the bar spans 358 of 390px and the floating action
spans ~56, so ~86% of the last visible row becomes readable rather than covered. That is a real gain
and it is the one worth writing on the issue — it is just not the gain the body claims.

---

#### 2. The two screens are two *different classes* of departure, and only one of them is a contradiction

This is the finding that narrows Q1 from "do we depart from v2" to "do we depart on **one** screen".

**The ride detail is an addition.** `Ride - Ride plan (Details)` (`2375:8771`) draws the navigation
bar at **390×88** — the plain variant, with no `Button Container` — plus a separate
`Content / Ride Details / Join Ride Selector 390×96` frame stacked on it:

```bash
npm run figma -- tree "Ride - Ride plan (Details)" | grep -i "navigation / bar\|join ride"
# INSTANCE · v2 / Component / Navigation / Bar 390×88
# FRAME · Content / Ride Details / Join Ride Selector 390×96
```

The frame draws **no create control of any kind**. `RideCreateBar` is therefore *already* a departure
— an addition to a frame, contradicting nothing drawn — and replacing it with a floating action
changes one undrawn thing into a different undrawn thing. **Nothing in `2375:8771` moves.**

**The club detail is a contradiction, and of a shared component rather than a screen.**
`Private club - Timeline` (`2043:10604`) instances `v2 / Component / Navigation / Bar` at
**390×152**, with `Button Container 358×56` as a child *inside that instance*:

```bash
npm run figma -- tree "Private club - Timeline" | grep -i "navigation / bar\|button container"
# INSTANCE · v2 / Component / Navigation / Bar 390×152
#   FRAME · Button Container 358×56
```

Converting this screen changes **which variant of a shared component the screen instances** (152 → 88)
and deletes a drawn child of that instance. `Navbar.tsx`'s own measurement says 27 frames draw the
152 variant against 44 drawing the 88. A departure on one screen is containable; a departure that
changes how a screen instances a component **27 other frames also instance** is not, because the next
person reading any of those 27 frames has no way to know this screen stopped agreeing with them.

**That asymmetry is the whole of the recommendation in Q1.**

---

#### 3. There is no elevation token in this design system, and a floating action cannot be built without one

```bash
grep -in "shadow\|elevation" design/TOKENS.md        # 0
grep -rn "shadow-" src --include=*.tsx               # 3 lines, 2 live + 1 comment
```

The generated token set carries colour and type and **no elevation of any kind**. The two live uses
of `shadow-` in the tree are `Banner` and `NotificationsPanel` — both transient floating overlays,
both using stock Tailwind `shadow-lg`, both invented rather than measured (`NotificationsPanel`'s
docstring says so in as many words: *"`shadow-lg` per `Banner`"*).

A floating action needs separation from the content beneath it — a shadow, a ring or a hard border —
or it reads as a sticker. **Building it as a departure therefore means inventing the app's first
persistent elevation value**, on a control that sits on screen permanently rather than for the two
seconds a banner does. Inventing a token is `design-system`'s work under decision #4, not a build's.
This is the second half of the Q1 recommendation and it applies to **both** screens, including the
ride detail where nothing is contradicted.

---

#### 4. `/clubs`' `Create club` is not a bar this change can convert, and that creates a consistency problem the issue does not name

The issue and this task both describe *"`/clubs`' own `Create club` bottom bar"*. It is not a bar and
it is not a sibling of these two — it is `Navbar`'s own action slot:

```bash
grep -n "STICKY_ACTIONS" -A 10 src/components/layout/Navbar.tsx
# '/postcards': Create postcard · '/rides': Create ride
# '/clubs': Create club  · '/clubs/explore': Create club
```

It renders **inside** the `<nav>`, above the tabs and under the bar's single top border — it *is* the
152px variant the frames draw, correctly, on four pathnames. `ClubCreateBar` exists as a separate
component only because that map is keyed on pathname alone and cannot answer *is this rider a member*.

**Consequence the issue does not state: converting only the two screen-owned bars makes the app less
consistent, not more.** Today a rider taps `Create club` on a full-width bar at `/clubs` and, one tap
later on the club detail, gets an identical full-width bar. After this change they would get a
floating action on the detail and a full-width bar on the list — one tap apart, same visual slot.
Converting all six surfaces instead means changing the shared navigation component itself, which is
a much larger story and squarely `design-system`'s.

**This change converts the two screen-owned bars only** (see *What Does NOT Change*), and records the
inconsistency as Q5 rather than hiding it.

---

#### 5. A side finding, recorded because this change touches exactly this geometry

`/rides/explore` applies `.pb-navbar-action-extra` — 64px of reserved clearance — with a comment
saying *"the Navbar carries a sticky `Create ride` on this route too"*. It does not:
`STICKY_ACTIONS` holds `/clubs/explore` and **not** `/rides/explore`.

```bash
grep -n "explore" src/components/layout/Navbar.tsx    # '/clubs/explore' only
grep -n "pb-navbar-action-extra" "src/app/(app)/rides/explore/page.tsx"   # present
```

So that screen reserves 64px at the bottom for a button nobody draws. **Out of scope for this change
and left untouched** — it is a one-line fix on `src/`, which this proposal-only branch may not write
— but it must not be "fixed" accidentally by a build that rewrites the clearance classes, and it is
one more reason the clearance question (Q4) deserves a written rule rather than a per-screen habit.

## What Changes

### Scope: two screen-owned bars, one new primitive, no schema

- **`src/components/ui/FloatingAction.tsx`** — new, and the app's first floating control. It is a
  primitive, so it belongs to `design-system` under the standard order and this proposal does not
  design it beyond the requirements in `specs/create-affordance/spec.md`.
- **`ClubCreateBar`** becomes a floating action whose tap opens the **existing `ContextMenu`** with
  the same three rows, unchanged, each still carrying the club so the composer opens scoped.
- **`RideCreateBar`** becomes a floating action that **navigates directly** — one action, no sheet,
  the non-generalisation PD-401 recorded and this change keeps.
- **The ride detail's bottom-slot decision changes shape rather than retiring** — see *The
  `resolveRideDetailActions` question* below. It stays a pure function with an exhaustive test.
- **One new geometry token and one new clearance class** in `globals.css`, so the offset rule is one
  decision rather than two screens' habits.

### The trigger keeps `ContextMenu`, and that is the default rather than an omission

The OutSystems reference *expands* the actions out of the button. `ContextMenu` is a bottom sheet.
Both are "a labelled action list"; the difference is where the animation starts, not what the rider
gets. What `ContextMenu` already has, measured in `src/components/ui/ContextMenu.tsx`, is six
behaviours an expand-in-place rewrite would have to reimplement:

1. a portal to `document.body` — required, because a transformed ancestor becomes the containing
   block for `position: fixed` descendants and silently reparents the whole overlay;
2. a focus trap on Tab and Shift-Tab;
3. Escape to close;
4. a `Grey/70%` scrim that closes on tap;
5. `document.body.style.overflow = 'hidden'` while open;
6. focus restoration to the trigger on close.

It also has a jsdom test behind it (`PostcardMenu.test.tsx` exercises a real click through the
portal, and `PrivacySheet.dom.test.tsx` exists because a static render of a portalled sheet returns
nothing to assert against). **Reimplementing six behaviours to move an animation's origin is not
what the owner asked for**, so the default is: the floating action is a *trigger*, the sheet is
unchanged. Q3 offers the alternative with what it costs.

### Arity — a one-action floating action navigates, it does not expand

`RideCreateBar`'s docstring states the rule already: *"a sheet holding a single row is a tap that
asks a question with one answer"*. A floating action inherits it. So:

- **≥ 2 actions** → the control opens the sheet, and its accessible name is the category (*Create*).
- **exactly 1 action** → the control **is** the action, navigates directly, and its accessible name
  is the act (*Add a photo*), never a bare `+`.

PD-402 (ride threads) makes the ride's arity 2, at which point the ride's control crosses this rule
and starts opening a sheet **by the rule rather than by an edit**. That is the point of writing it
as a rule.

### Gating is unchanged, and stays an affordance rather than enforcement

Verified against DEV (`fpmrimzxadewsaiwpsel`) on 2026-09-06 rather than assumed:

| Destination | Policy predicate |
|---|---|
| postcard in club | `(club_id is null or private.is_club_member(club_id))` |
| ride in club | `(club_id is null or private.is_club_member(club_id))` |
| club thread | `private.is_club_member(club_id)` |
| postcard tagged to ride | `(ride_id is null or (exists(…rides…) and private.is_ride_crew(ride_id)))` |

`private.is_ride_crew(ride)` is `organizer_id = auth.uid()` **or** a `ride_members` row — so the
organizer is crew without a membership row. `private.is_club_member` delegates to
`is_club_member_for(auth.uid(), …)` and **does not look at `club_members.role`**, so `admin` and
`member` are indistinguishable to it. Both facts are load-bearing for the negative-case table below.

## What Does NOT Change

- **`Navbar`'s `STICKY_ACTIONS`** and its four pathnames. `/postcards`, `/rides`, `/clubs` and
  `/clubs/explore` keep the full-width primary drawn inside the navigation bar, exactly as 27 frames
  draw it. See finding 4 and Q5.
- **No migration, no policy, no grant, no RLS assertion.** This change writes nothing to
  `supabase/`. Every gate it reads already exists and is unchanged; the control is an affordance and
  a rider who defeats it is still refused by the policy.
- **The section `(+)` on the club detail (PD-342) and the empty-section create tiles (PD-312 /
  PD-318) stay.** They answer a different question — *add to this section* and *this section exists*
  — and PD-404 explicitly does not reopen them. Only the **ride timeline's** `(+)`, which exists
  solely as PD-401's fallback, is in scope, and only under Q2's answer A.
- **`RideAttendanceBar` and frame `2375:8771` are untouched.** PD-401's option D — moving the RSVP
  into the page body — is **not** taken here and is not needed here; see below.
- **Decisions #1, #2, #3 and #8.** No anonymous reach, blocking stays in RLS, no mapping SDK, no new
  backend. **No new dependency**: a floating action is a `div`, a `button` and a token, and the
  twelve-dependency rule forbids reaching for a library for it.

## The `resolveRideDetailActions` question, answered

**The task asks whether a floating action dissolves the collision `src/lib/rides/bottom-slot.ts`
exists to resolve, and therefore retires it. The measured answer is: it retires the *fallback*, not
the *function*, and only under one of Q2's three answers.**

The collision is real and is exactly one of five cases. With `canRsvp = is_upcoming && !is_organizer`
and `canCreate = is_crew` (both read off `src/app/(app)/rides/detail/page.tsx`):

| Ride | Viewer | `canRsvp` | `canCreate` | Today |
|---|---|---|---|---|
| upcoming | organizer | false | true | create bar |
| **upcoming** | **crew, not organizer** | **true** | **true** | **RSVP bar + timeline `(+)`** ← the collision |
| upcoming | not crew | true | false | RSVP bar |
| past | crew | false | true | create bar |
| past | not crew | false | false | nothing |

**A floating action does not occupy the full-width slot, so it can coexist with the RSVP bar — but
the collision does not dissolve, it changes from a slot question into an offset question.**
`.bottom-navbar` anchors a bar at `calc(var(--safe-bottom) + var(--navbar-tabs))`. A floating action
anchored at the same offset lands squarely on the RSVP bar's `ButtonGroup`, which is 358 wide and
therefore reaches the bottom-right corner — the floating action would sit on top of the `No` pill.
So the control must be lifted by `--ride-rsvp-bar` exactly when the RSVP bar is present, and *that
condition is `canRsvp`* — the same input the function takes today.

So the function survives, with a different return:

```
{ bottomSlot: 'rsvp' | 'create' | null, timelineAdd: boolean }
  →  { rsvpBar: boolean, floatingAction: boolean, clearance: 'navbar' | 'rsvp' }
```

**What genuinely retires is the `(+)` fallback and the complementary-entrance invariant it protects
— under answer A only.** That invariant is *"exactly one entrance to the composer, never two and
never none"*, and it needed a two-branch function because the create bar could not always have the
slot. A floating action can always be drawn, so the entrance becomes `isCrew` and nothing else:
one condition, one control, invariant satisfied by construction rather than by a decision table.
`timelineAdd` becomes constant `false` and `RideTimeline`'s `canAdd` prop can go.

**And a floating action makes PD-401's option D unnecessary rather than reopening it.** D was
proposed to *free the sticky slot*, because two full-width bars cannot share it. A floating action
does not want the slot, so D's entire motivation evaporates — the two coexist with the RSVP bar
staying exactly where frame `2375:8771` draws it. That is the better outcome and it is worth
stating plainly to the owner, because the 01:48Z comment on PD-404 offers D as answer **C** and it
is the only one of the three that contradicts a frame. **Answer A costs no frame at all on this
screen.** (Answer B — RSVP bar alone, composer stays on the `(+)` — keeps `resolveRideDetailActions`
exactly as it is today and makes this change club-only on the ride screen's terms.)

## Negative cases — who must NOT see or reach this

Each row is a testable statement about a role and a resource. **None of them is a policy change**:
every one is already true in Postgres, and the requirement is that the control agrees with the policy
so that no rider is offered an action the database will refuse.

### Club detail — the three-action floating action

| Role | May reach the control? | Why, and what must not happen |
|---|---|---|
| **Owner** | **Yes** | `054` makes the owner a member; `is_club_member` is true. |
| **Admin** (`club_members.role = 'admin'`) | **Yes** | `is_club_member` ignores `role` entirely. **The control MUST NOT gate on `role`** — doing so invents a hierarchy `001`'s CHECK allows and nothing writes. |
| **Member** | **Yes** | All three destinations admit them. |
| **Non-member, public club** | **NO** | All three policies refuse. The screen renders the club and **no** control. It MUST NOT render a disabled one — a disabled control still announces the action exists. |
| **Non-member, private club** | **NO — and the screen must not exist** | `ClubPreviewScreen` is what a non-member gets, and it issues no query that could return zero rows. The floating action MUST NOT be rendered anywhere on that branch, and its absence MUST NOT be a clue about the club's contents. |
| **Blocked rider who is still a member** | **YES, deliberately** | Blocking is symmetric and removes *visibility*, not *membership*. A member blocked by another member still creates in the club. **Nobody may "fix" this by adding a block predicate to the control** — the negative case is that the control does NOT change, and every blocking effect stays where decision #2 puts it, in RLS. |
| **Signed-out visitor** | **NO — unreachable, not merely hidden** | `/clubs/detail` is outside the guard's public denylist and `anon` holds zero grants. Asserting the negative: the visitor reaches `/auth/login` and no data. No `anon` grant is added by this change. |

### Ride detail — the one-action floating action

| Role | May reach the control? | Why, and what must not happen |
|---|---|---|
| **Organizer** | **Yes** | `is_ride_crew` returns true on `organizer_id` without a `ride_members` row. |
| **Crew (`ride_members` row)** | **Yes** | The second arm of `is_ride_crew`. |
| **Invited, not joined** | **NO** | An invite is not a `ride_members` row. `041` refuses the tagged insert, so the control must not appear. |
| **A rider who can READ the ride but is not crew** | **NO** | This is the largest group and the one most likely to be got wrong: ride *readability* and crew membership are different predicates, and the control follows the second. |
| **Blocked rider** | **NO, and presented as an ordinary absence** | The block removes them from the crew relationship's reads. The screen MUST NOT indicate a block is the reason, in either direction. |
| **Signed-out visitor** | **NO — unreachable** | As above. |

### Structural negatives — the ones that are about the control rather than a role

- **The floating action MUST NOT be hoisted into `(app)/layout.tsx`, the root layout, or `Navbar`.**
  This is the single most likely wrong turn, because "a floating action is global chrome" is true in
  most apps and false in this one. Hoisting it puts an uncallable control on every screen for every
  rider, breaks the membership gate the way `STICKY_ACTIONS` already cannot answer, and drops it on
  top of the two `BARLESS` screens — the ride chat and the club thread — whose own fixed composers
  are bottom-anchored and which PD-081 already shipped broken once for exactly this class of
  mistake.
- **It MUST NOT render while its gate is `undefined`.** `isMember` and `isCrew` are `undefined`
  until the read lands. A control drawn on `undefined` and withdrawn on `false` is an affordance
  that flickers into existence for a rider who may not use it.
- **It MUST NOT render over an error or a not-found state.** A floating create button on top of
  *We could not load this club* offers an action into a screen whose subject failed to load.
- **It MUST NOT permanently occlude an interactive element.** See Q4.
- **It MUST NOT be smaller than 44×44 CSS px of hit area.** See below.
- **Neither the control nor its sheet may name a club or ride the viewer cannot already see** — no
  new string is introduced that leaks a private club's name, and none is needed.

### The glove floor, measured — and today's fallback already fails it

The floor is **44×44pt**, and it is written in `.claude/agents/rider-ux.md` line 14 and
`.claude/agents/design-system.md` line 258. It is **not** in `CLAUDE.md`, though `Button.tsx` and
`Checkbox.tsx` both cite it as *"CLAUDE.md's accessibility floor"* — a misattribution worth knowing
about before someone greps `CLAUDE.md` for it, finds nothing, and concludes there is no floor.

```bash
grep -rn "44×44\|44x44" CLAUDE.md docs/ .claude/ src/
# .claude/agents/rider-ux.md:14  ·  .claude/agents/design-system.md:258
# src/components/ui/Button.tsx:64  ·  src/components/ui/Checkbox.tsx:26   (both cite CLAUDE.md)
```

`Button`'s `md` size is 40px tall and already clears the floor **by hit area rather than by pixels**:
an invisible `::before` extends the touch target to 44 without moving a rendered pixel. So today's
bar is a 358×44 hit target. A 56×56 circle is 3,136px² against 15,752px² — **a 5× reduction**, all
of it horizontal. That is the real glove cost, and it is not fixed by clearing 44×44; it is fixed by
choosing an **extended** floating action (a pill: icon + label) over a plain circle, which also
preserves `RideCreateBar`'s deliberately-chosen *Add a photo* label. Q6.

And a fact that cuts the other way: `SectionHeader`'s `(+)` — today's fallback entrance on the ride
timeline — is **40×40 with no hit-area extension**, so it is already *below* the floor. If Q2's
answer A retires it, this change removes a sub-floor target rather than adding one.

## The state checklist

| State | Club detail | Ride detail |
|---|---|---|
| **Empty** | Empty timeline still draws its per-section create tiles (PD-318) — the floating action does not replace them, because a floating icon teaches nothing about what a section is for. Both are present and that is intended. | Empty timeline, same rule. |
| **Loading** | Gate is `undefined`; **no control**. Never drawn-then-withdrawn. | Same. Also: `bottomSlot`/`clearance` must not flip after first paint. |
| **Error** | Club read failed → `ErrorState`, **no control**, and the page reserves no clearance for one. | Same. |
| **Offline** | The control still draws (membership is cached) and the composer owns the refusal — unchanged from the bar, and `client-render-shell`'s standing rule already governs it. No queue. | Same. |
| **Permission denied** | Indistinguishable from empty at the client and must stay so: a private club's non-member gets `ClubPreviewScreen`, never an empty timeline with no create button. | A non-crew reader gets the ride with no control; that is not a permission message. |
| **Partial** | Club loaded, rides strip failed → control still draws; it is gated on membership alone. | Ride loaded, crew read failed (`undefined`) → **no control**, per the `undefined` rule. |
| **Stale** | Rider leaves the club in another tab → the control persists until the cache invalidates, then goes. RLS refuses in the gap. Acceptable, unchanged, and stated so it is not rediscovered as a bug. | Rider leaves the crew → same. |

## Impact

- **Files** — new `src/components/ui/FloatingAction.tsx`; rewritten `ClubCreateBar.tsx`,
  `RideCreateBar.tsx`, `src/lib/rides/bottom-slot.ts` (+ its test);
  `src/app/(app)/clubs/detail/page.tsx` and `src/app/(app)/rides/detail/page.tsx` for clearance;
  `src/app/globals.css` for the new token and class; `RideTimeline.tsx` only under Q2-A.
- **No `supabase/` change**, so the RLS suite job does not run and no assertion is owed. Stated
  explicitly because `openspec/config.yaml`'s task rule pairs migrations with assertions and there is
  no migration here.
- **Tests owed** — an exhaustive unit test for the reshaped `resolveRideDetailActions`; a component
  test pinning the `undefined` gate; and, if Q3 goes to expand-in-place, a **jsdom** test, because a
  scrim, an Escape key and a portal are unreachable from `renderToStaticMarkup` (the reason all five
  existing jsdom tests exist).
- **`npm run walk`** renders both screens already and is the only gate that would catch a floating
  action painted under the navigation bar.
- **`docs/FIGMA-FIDELITY-TODO.md`** gains an entry under whichever route Q1 takes — a *departure to
  be drawn* under option 2, or nothing at all under option 1. Written by the build, not by this
  proposal-only branch.
- **Sequencing** — none. No migration, so `CLAUDE.md`'s additive/destructive rule does not apply, and
  there is no ordering against a deploy.

## Open Questions

**Q1 is blocking on everything. Q2 is blocking on the ride detail only. Q3–Q7 all have defaults a
build can proceed on.** Each is phrased as the rider's state per the standing instruction: the
screen, what the rider did, and what they did not do.

---

### Q1 — BLOCKING · product owner only · the frame decision

> A rider opens a **private club they are a member of** and scrolls to the bottom of its timeline.
> They have not tapped anything. Today the navigation bar is 152px tall and carries a full-width
> `Create` above the tabs, which is what frame `2043:10604` draws. **What is drawn there after this
> change, and what does `design/` say it is?**

**A — Figma first.** `design-system` writes the floating action, its elevation token and the club
detail's 88px navigation variant into Figma; the next `figma:pull` bakes them into the snapshot; the
build follows. `design/` stays the source of truth and decision #4 is untouched.
**Requires an explicit owner ask** — `CLAUDE.md` §Design System — so **no unattended session can take
this path**, which is why the queue has now dropped this story twice.

**B — Build it as a recorded departure**, with the frame updated afterwards and the deviation logged
in `docs/FIGMA-FIDELITY-TODO.md`.

**Recommended: A, and the reasoning is finding 2 plus finding 3, not a general preference for
process.** Two specifics:

1. The club detail's departure is not a screen's — it changes which **variant of a shared component**
   the screen instances, and 27 other frames instance that component at 152. A departure recorded on
   one screen is invisible to the next person reading any of the other 27.
2. A floating action needs an **elevation value this design system does not have**. Under B the
   build invents the app's first persistent shadow token, which is precisely the invention
   decision #4 exists to prevent. `Banner` and `NotificationsPanel` already invented one each, for
   transient overlays, and neither is measured against anything.

**A narrowing worth offering, because it may be the cheapest correct answer:** the ride detail can be
converted under **B** today at no frame cost at all — `2375:8771` draws no create control, so nothing
is contradicted, only added — while the club detail waits for **A**. That splits the story rather
than blocking it, at the price of the two screens disagreeing for the length of the wait.

---

### Q2 — BLOCKING on the ride detail · product owner only · the composition

> A rider opens an **upcoming ride they are crew on but did not organize**, has tapped neither
> *Going* nor *Not going*, and scrolls to the bottom of the timeline to add a photo of it. **What is
> drawn there?**

**A — The RSVP bar, with the floating action lifted above it.** Both reachable at once.
`resolveRideDetailActions` keeps its inputs and changes its output to a clearance; the timeline `(+)`
retires; the complementary-entrance invariant becomes trivial. **Costs no frame** — the RSVP bar
stays exactly where `2375:8771` draws it. **This is the recommended default.**

**B — The RSVP bar alone**, composer stays on the timeline `(+)`. Today's behaviour, survives the
rewrite unchanged, keeps a 40×40 sub-floor target as the only entrance for this rider.

**C — The floating action alone**, RSVP moved into the page body. PD-401's option **D**. Frees the
slot properly and **contradicts frame `2375:8771`**, which draws that bar stacked on the navigation
bar.

**Default if unanswered: A** — it is the only one that both preserves the invariant and costs no
frame, and it is the answer the floating-action pattern was asked for in order to make possible.

---

### Q3 — non-blocking · build, default stated · expand in place, or the existing sheet

> A member taps the floating action on a **club they belong to** and has not chosen an action yet.
> **What appears?**

**Default: the existing `ContextMenu` bottom sheet, unchanged.** It already has the portal, the focus
trap, Escape, the scrim, the body-scroll lock and focus restoration — six behaviours an
expand-in-place rewrite must reproduce, plus a jsdom test the new one would not have. The reference
pattern expands; the semantic result is the same labelled action list.

**Alternative: expand in place.** If taken, the expanded list SHALL keep all six behaviours and SHALL
be tested under jsdom, because a static render cannot dispatch a scrim tap or an Escape.

---

### Q4 — non-blocking · build, default stated · what the control covers while scrolling

> A member scrolls a **club timeline with more rows than fit** all the way to the last row.
> **Is any part of that row underneath the floating action?**

**Default: reserve the clearance — the last row is never underneath it.** Content ends above the
control, exactly as `.pb-navbar-action-extra` does today for the bar; the class is renamed and
re-sized for the control's geometry. This costs the vertical saving (finding 1) and keeps the
horizontal one, which is where the real gain is anyway.

**Alternative: let content run under it**, which is the only way the vertical space comes back. If
taken, the requirement is narrower rather than absent: no *interactive* element may be permanently
occluded, so the last row's tap target must still be reachable — which on a full-width timeline row
it is not, because the control sits inside it.

---

### Q5 — non-blocking · product owner · the four `STICKY_ACTIONS` screens

> A rider on **`/clubs`** taps a club and lands on its detail. **Does the create affordance change
> shape between those two screens?**

Under this change's scope: **yes** — `/clubs` keeps its full-width `Create club` in the navigation
bar and the detail gets a floating action. **Default: accept it for now and record it**, because
converting the other four means changing the shared navigation component and its four frames, which
is a separate story. **If the answer is that they must match, this story is larger than it looks and
should be re-scoped before any code is written**, not extended mid-build.

---

### Q6 — non-blocking · build, default stated · circle or pill

> A crew member opens a **past ride** they rode. **What does the control at the bottom-right say?**

**Default: an extended floating action — a pill carrying the icon and the label.** It preserves
`RideCreateBar`'s deliberately-chosen *Add a photo* (which "names the act rather than the category"),
and it recovers most of the 5× hit-area loss a bare circle costs a gloved hand. A plain circle is
correct only for the club's multi-action control, where the label would be the meaningless *Create*.

**Consequence if the default holds:** the two screens' controls are different shapes, and that is
right — one is an action and one is a menu.

---

### Q7 — non-blocking · build, default stated · which corner

> A rider holding the phone in their **left hand**, gloved, opens a club detail. **Which thumb
> reaches the control?**

**Default: bottom-right**, matching the reference and every platform convention, accepting that it
favours right-handed one-thumb use. No frame states it, nothing in `design/` draws it, and a
mirrored variant is not worth a setting. Recorded so that "the design said so" is not later claimed
for it.
