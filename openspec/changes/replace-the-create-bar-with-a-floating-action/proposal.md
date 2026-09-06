# The create affordance becomes a floating action instead of a full-width bar

> **The ride detail is DECIDED and buildable. The club detail is not, and is out of scope here.**
> The product owner answered the composition question on 2026-09-06 with a **fourth shape they
> designed themselves** — answering the RSVP *replaces* the bar with a status chip, and the floating
> action takes the bottom corner. That answer supersedes this proposal's earlier options A/B/C,
> which are gone rather than annotated. **Q1 — the club detail — is still unanswered**, so
> `src/components/clubs/ClubCreateBar.tsx` is **not touched** by this change and PD-404 stays open
> after the ride half ships.

## Why

Product owner, 2026-09-05, referencing the OutSystems *floating actions* pattern
(`PatternDetail?PatternId=507`): replace the always-drawn full-width create bar with a floating
action. Two screens own such a bar today:

| Component | Screen | Actions | Gate | Frame | In this change |
|---|---|---|---|---|---|
| `src/components/rides/RideCreateBar.tsx` | ride detail | 2 — Postcard, Thread, via `RideCreateSheet` | crew (`private.is_ride_crew`) | `Ride - Ride plan (Details)` `2375:8771` | **yes** |
| `src/components/clubs/ClubCreateBar.tsx` | club detail | 3 — Postcard, Ride, Thread, via `ContextMenu` | member (`private.is_club_member`) | `Private club - Timeline` `2043:10604` | **no — Q1 is open** |

The ride detail's own obstacle was never the component; it was that `RideAttendanceBar` already owns
the bottom edge for most riders on most rides. The owner's decision removes that collision instead
of arbitrating it.

## The decided composition

**The RSVP bar and the floating action are never both present, because answering the RSVP replaces
the bar.**

- A rider who has answered **Going** or **Maybe**: no RSVP bar; a **status chip** (`Going` /
  `Maybe`) on the ride's first content line; the **floating action** owns the bottom corner.
- Tapping the chip **brings the RSVP bar back**, so the answer stays changeable. While it is back,
  the floating action is withdrawn — the two are never on screen together.
- A rider who has answered **nothing**: RSVP bar, no floating action. Today's behaviour.
- A rider who taps **No**: the RSVP bar stays, and no chip is drawn.

### Why the `No` half is asymmetric, and why that is the accepted cost

`RideAttendance` is `'going' | 'maybe' | null`, and `RideAttendanceBar`'s own comment records the
truth: *"`No` has no stored status — it clears the row."* `setRideAttendance` **deletes** the
`ride_members` row for `null`. Measured on DEV (`fpmrimzxadewsaiwpsel`, 2026-09-06):

```sql
-- ride_members.status: is_nullable NO, default 'going'::text
-- ride_members_status_check: CHECK (status = ANY (ARRAY['going','maybe']))
```

So a rider who declined is byte-for-byte identical to one who never answered, and nothing can draw
them a `Not going` chip. Making it symmetric needs a real `no` status — a migration **and** a change
to `private.is_ride_crew`, which is `034`'s *"organizer, or holder of a `ride_members` row of either
status"* and now gates ride threads (`108`) as well as postcard tagging (`041`). **The owner chose
cheap: no migration, no helper change, `No` behaves exactly as it does today. This change does not
widen it.**

### The load-bearing property: the rider's rule and the database's rule are the same rule

`private.is_ride_crew` — read off DEV rather than quoted from a migration — is:

```sql
select exists (select 1 from public.rides r where r.id = ride and r.organizer_id = auth.uid())
    or exists (select 1 from public.ride_members m where m.ride_id = ride and m.user_id = auth.uid());
```

Going and Maybe both carry a `ride_members` row, so both may tag a postcard and open a thread; `No`
carries no row and may do neither. **The floating action therefore appears exactly when the write
would succeed**, which is the property PD-401 pinned — *a control the database refuses is worse than
no control*. Nothing in this change weakens it, and the chip inherits it: a rider who has a chip is
a rider who is crew.

## What changes

### Scope — the ride detail, one new primitive, no schema

- **`src/components/ui/FloatingAction.tsx`** — new, and the app's first *persistent* floating
  control. Presentational: it takes its gate, label, icon and action as props and decides nothing.
- **`RideCreateBar`** becomes that floating action. It keeps its two-row `RideCreateSheet` and its
  `Create` label — **arity is 2 since `108`/PD-402**, so the sheet is by the rule below rather than
  by an edit.
- **A status chip** on the ride detail's first content line, drawn only for a rider whose RSVP is
  live *and* answered, and tapping it reopens `RideAttendanceBar`.
- **`resolveRideDetailActions`** (`src/lib/rides/bottom-slot.ts`) keeps being the one place the
  bottom composition is decided, with new inputs and a new return — see below. `timelineAdd` is
  **removed**; the finding that makes it dead is stated and measured below.
- **One geometry token and one clearance class** in `globals.css` for the floating control.
  `--ride-rsvp-bar` is untouched — see *What happens to `--ride-rsvp-bar`*.

### What `resolveRideDetailActions` becomes

The old inputs cannot express the decision, because `canRsvp` no longer means *may answer*; it means
*may answer and has not*. Splitting that conjunct out is what makes the chip and the bar readable
from one decision:

```ts
resolveRideDetailActions({
  rideId,
  mayAnswer,   // is_upcoming && !is_organizer — the RSVP question is live for this rider
  answer,      // 'going' | 'maybe' | null — the STORED ride_members status
  canCreate,   // is_crew
  reopened,    // the rider tapped the chip
}) => {
  bottomSlot: 'rsvp' | 'create' | null,
  statusChip: 'going' | 'maybe' | null,
  createOptions: RideCreateOption[],
}
```

with

- `bottomSlot === 'rsvp'` iff `mayAnswer && (answer === null || reopened)`;
- `bottomSlot === 'create'` iff `canCreate` and the bar is not drawn — so the two can never share
  the screen, **by construction rather than by an offset**;
- `statusChip` non-null iff `mayAnswer && answer !== null`;
- `createOptions` non-empty **iff `canCreate`** — the invariant is re-proved below.

That reproduces the owner's table exactly:

| mayAnswer | answer | canCreate | bottomSlot | chip |
|---|---|---|---|---|
| true | `null` (unanswered) | false | `rsvp` | — |
| true | `going`/`maybe` | true | `create` | `Going` / `Maybe` |
| true | `going`/`maybe`, chip tapped | true | `rsvp` | `Going` / `Maybe` |
| false (organizer / past ride) | any | true | `create` | — |
| false | any | false | `null` | — |

**`mayAnswer` is what excludes the organizer, and the stored status is not.** Since `103` the
organizer holds a real `ride_members` row of status `going`, so a chip gated on the status alone
would draw for them and offer a bar that `103`'s `protect_ride_organizer_membership` refuses, over a
roster that `withOrganizer` renders `Going` whatever is stored (PD-391). This is the same trap
`isRideCrew`'s docstring names about `RideDetail.attendance` — that field folds the organizer in —
and the answer is the same: read the raw row, and gate on `mayAnswer`.

### `timelineAdd` is dead, and this is measured rather than assumed

Its case was *upcoming + crew + the RSVP bar owns the slot*, which under this design needs a crew
row **and** no stored answer. **No such rider exists**, because `ride_members.status` is `not null
default 'going'` with a two-value CHECK, so a crew row always carries an answer. Every writer of a
row agrees, and there are exactly four:

```bash
grep -rn "into public.ride_members" supabase/migrations/*.sql
# 083:534  private.join_ride_from_invite  → status 'going'
# 103:283  private.establish_ride_organizer_membership → 'going'
# 103:346  the organizer backfill → 'going'
grep -rn "from('ride_members')" src/lib/actions/rides.ts
# 351 delete (No) · 356 upsert with status: 'going' | 'maybe'
```

The client cannot see a stale disagreement either: `102`'s SELECT policy on `ride_members` leads with
`user_id = auth.uid()`, so a rider's **own** row is always returned, and `getRide` derives both
`attendance` and `is_crew` from that one row (`isRideCrew(isOrganizer, ownRow?.status ?? null)`).
For a non-organizer, therefore, `answer === null ⟺ !canCreate`, and the input combination
`mayAnswer && answer === null && canCreate` is **unreachable**.

**Consequences, all in scope:** `timelineAdd` goes; `RideTimeline`'s `canAdd` and `createOptions`
props go; the timeline heading's `(+)` goes with them — a **40×40 target with no hit-area
extension**, i.e. this change *removes* a sub-floor glove target rather than adding one; and
`SectionHeaderCreate`'s `onClick` union arm is left with **no caller in the tree**
(`grep -rn "create={" src --include=*.tsx -A 3 | grep onClick` → 1 line, `RideTimeline` only). The
arm stays — deleting a primitive's API is `design-system`'s call, not this change's — and its
now-caller-less state is recorded rather than discovered.

**The `createOptions` invariant is re-proved, not inherited.** It was *non-empty iff an entrance is
drawn*. It is now **non-empty iff `canCreate`**, and the entrance is drawn iff `canCreate && the bar
is not`. The one state where a non-empty list draws no control is the **reopened** one — the rider
tapped the chip and is answering — and it is transient, rider-initiated and rider-dismissable. A
sheet with no rows behind a live control, the failure the old invariant existed to pin, is still
impossible.

### Arity — the rule stays, and the ride is now on its other side

- **≥ 2 actions** → the control opens the sheet; its name is the category (*Create*).
- **exactly 1 action** → the control *is* the action; its name is the act (*Add a photo*).

`108` (PD-402) gave the ride a second destination, so `RideCreateBar` already says `Create` and
opens `RideCreateSheet`. The floating action inherits that state, not PD-401's single-destination
one — **the earlier revision of this proposal defaulted to preserving `Add a photo`, and that label
no longer exists in the tree.**

### Gating is unchanged, and stays an affordance rather than enforcement

| Destination | Policy predicate |
|---|---|
| postcard tagged to ride | `(ride_id is null or (exists(…rides…) and private.is_ride_crew(ride_id)))` (`041`) |
| ride thread | ride visibility `and private.is_ride_crew(ride_id)` (`108`) |
| RSVP write | `008`/`102` — own row only; `103` refuses the organizer's deletion |

## What does not change

- **`ClubCreateBar` and the club detail.** Q1 is open. Nothing under `src/components/clubs/` or
  `src/app/(app)/clubs/` is touched, and `.pb-navbar-action-extra` stays correct there.
- **`Navbar`'s `STICKY_ACTIONS`** and its four pathnames — `/postcards`, `/rides`, `/clubs`,
  `/clubs/explore` keep the full-width primary drawn inside the navigation bar.
- **`RideAttendanceBar`'s own markup, geometry and copy.** It gains one thing only: a way to tell
  the screen that an answer *succeeded*, so the screen can collapse it. Its border, its
  `.bottom-navbar` offset, its `z-40`, its optimistic rollback and its `role="status"` are unchanged.
- **`No` behaviour.** No migration, no new status, no change to `private.is_ride_crew`.
- **No migration, no policy, no grant, no RLS assertion.** This change writes nothing to
  `supabase/`. Every gate it reads already exists.
- **The empty-section create tiles and the club's section `(+)`** (PD-312, PD-318, PD-342). Only the
  **ride timeline's** `(+)`, which existed solely as PD-401's fallback, is removed.
- **Decisions #1, #2, #3, #4, #8.** No anonymous reach, blocking stays in RLS, no mapping SDK, no
  new backend, **no new dependency** — a floating action is a `div`, a `button` and a token.

## Three measurements that still govern the build

**1. A floating action that reserves its clearance gives back no vertical space.** With the tokens'
own `16 pad + control + 8` rule, a 56px control reserves **80px** and a 48px one **72px**, against
`--navbar-action`'s **64px**. **Nothing breaks even** — matching 64px needs a 40px control, below the
44×44 floor. **The honest value is horizontal**: the bar spans 358 of 390px and the control spans
~56–150, so most of the last visible row becomes readable. Do not write the issue body's
*"a rider gets the screen's content back"* into the change record.

**2. There is no elevation token in this design system.** `grep -in "shadow\|elevation"
design/TOKENS.md` is 0, and the two live `shadow-` uses in `src/` (`Banner`,
`NotificationsPanel`) are stock Tailwind on *transient* overlays, invented rather than measured. This
control is the app's first **persistent** one, so its elevation is a token this change must define
beside the existing geometry tokens and name as invented.

**3. The glove floor is 44×44, and it is not in `CLAUDE.md`.** It is in
`.claude/agents/rider-ux.md:14` and `.claude/agents/design-system.md:258`; `Button.tsx` and
`Checkbox.tsx` both cite `CLAUDE.md` for it, which does not contain it — so the obvious grep returns
the plausible wrong answer *there is no floor*. Today's bar is a 358×44 hit target
(`Button`'s `md` is 40px tall with an invisible `::before` extension); a 56×56 circle is **5×
smaller**, all of it horizontal. **The chip is a control and pays the same floor**, and an inline
chip on a title line is typically ~24px.

## What happens to `--ride-rsvp-bar`

**It stays exactly as it is, and this change adds no second use for it.** Measured:

```bash
grep -rn "ride-rsvp-bar\|pb-rsvp-bar-extra" src/
# globals.css:228  --ride-rsvp-bar: 6rem;  /* 16 pad + 20 prompt + 12 gap + 40 group + 8 */
# globals.css:293  .pb-rsvp-bar-extra { padding-bottom: var(--ride-rsvp-bar) }
# app/(app)/rides/detail/page.tsx:275  bottomSlot === 'rsvp' && 'pb-rsvp-bar-extra'
```

The RSVP bar still exists and still reserves its 96px whenever it is drawn — unanswered, or reopened
from the chip — so the token and the class keep their single caller and their single meaning. **What
goes away is the *offset* the previous revision of this proposal designed**: lifting the floating
action by `--ride-rsvp-bar` when `canRsvp`. The two controls are now mutually exclusive, so nothing
needs lifting clear of anything, and `.pb-rsvp-bar-extra` is applied on `bottomSlot === 'rsvp'`
exactly as it is today.

## The departure this ships as, and it is larger than the earlier reasoning assumed

**Route: a recorded departure**, logged in `docs/FIGMA-FIDELITY-TODO.md` §Ride detail, frame updated
afterwards. Figma-first is not available: `CLAUDE.md` §Design System requires an explicit owner ask
to write to Figma and none was given.

**Do not repeat this proposal's earlier zero-frame-cost line.** That reasoning held because
`2375:8771` draws no create control of any kind, so a floating action only *added* to the frame. But
the same frame draws `Content / Ride Details / Join Ride Selector 390×96` **permanently stacked** on
the 390×88 navigation bar, for every viewer — and **hiding that bar once a rider has answered
contradicts it.** So this screen now carries three departures, of two different classes:

| Departure | Class |
|---|---|
| The create control is a floating action | addition — the frame draws none |
| The status chip on the first content line | addition — the frame draws none |
| **The RSVP bar is conditional on being unanswered** | **contradiction of a drawn element** |

The third is new. The screen already hides that bar from the organizer and on past rides, which the
frame also does not express — so the divergence exists today and this widens it deliberately rather
than opening it.

## Negative cases — who must NOT see or reach this

Each row is a testable statement about a role and a resource. **None is a policy change**: every one
is already true in Postgres, and the requirement is that the control never offers what the policy
would refuse, and that where the control's test and the policy's differ it errs toward
**withholding**.

### The floating action — ride detail

| Role | May reach the control? | Why, and what must not happen |
|---|---|---|
| **Organizer** | **Yes** | `is_ride_crew`'s first arm, and since `103` they also hold a row. They get the control on every ride they organize, upcoming or past, and **never a chip and never the RSVP bar**. |
| **Crew — answered Going or Maybe** | **Yes** | The second arm. On an upcoming ride they also get the chip. |
| **Crew — while the chip has reopened the bar** | **NO, transiently** | The two are never both drawn. The rider dismisses it by answering; nothing else may withdraw the control. |
| **A rider who answered `No`** | **NO** | The row is deleted, so they are not crew: `041` and `108` both refuse. The control's absence is correct and is **not** a message about their answer. |
| **Invited, not joined** | **NO** | An invite is not a `ride_members` row. `083`'s live-invite arm widens ride *visibility* and grants no crew. |
| **A rider who can READ the ride but is not crew** | **NO** | The largest group and the one most likely to be got wrong: readability and crew membership are different predicates. |
| **Blocked rider** | **NO, and presented as an ordinary absence** | The block removes the crew relationship's reads. The screen MUST NOT indicate a block is the reason, in either direction. |
| **Signed-out visitor** | **NO — unreachable, not merely hidden** | `/rides/detail` is outside the guard's public denylist and `anon` holds zero grants. The visitor reaches `/auth/login` and no data. No `anon` grant is added. |

### The status chip — a control, and a disclosure surface

| Role | Sees a chip? | Why, and what must not happen |
|---|---|---|
| **Crew, upcoming, answered** | **Yes, and it is theirs alone** | It renders the viewer's own `ride_members.status` and nothing else. |
| **Organizer** | **NO** | `mayAnswer` is false. Their chip must not exist, because tapping it would open a bar whose `No` `103` refuses and whose `Maybe` every screen ignores (`withOrganizer`, PD-391). Gating on the stored status alone draws it — `103` gave them a real `going` row. |
| **Any rider on a past ride** | **NO** | The answer can no longer be changed; a chip that opens a bar nobody may use is a control with nothing behind it. |
| **Unanswered rider** | **NO** | They have the bar. |
| **Every other rider on the ride** | **NEVER, about anyone else** | The chip MUST NOT be derived from the crew roster or the `riders` embed, and MUST NOT show another rider's answer. Who else is going is `RideCrewRail`'s question and is block-filtered there. |
| **Blocked rider** | **Their own chip, unchanged** | `102`'s SELECT leads with `user_id = auth.uid()`, so a rider's own row survives every block arm. The chip is therefore never a block signal in either direction. |
| **Signed-out visitor** | **NO — unreachable** | As above. |

### Structural negatives — about the controls rather than a role

- **Neither control may be hoisted into `(app)/layout.tsx`, the root layout, or `Navbar`.** The most
  likely wrong turn, because "a floating action is global chrome" is true in most apps and false in
  this one: a layout knows the pathname, not the crew relationship, and a hoisted control lands on
  the two `BARLESS` screens — the ride threads and the club thread — whose fixed composers are
  bottom-anchored. `081` shipped that defect once and **only `npm run walk` can see it**.
- **Neither may render while its gate is `undefined`.** `ride.data` is `undefined` until the read
  lands. A control drawn on `undefined` and withdrawn on `false` is an affordance that flickers into
  existence for a rider who may not use it, and a chip drawn early would announce an answer the
  rider has not given.
- **Neither may render over the error or not-found state.** A floating create button on top of
  *We could not load this ride* offers an action into a screen whose subject failed to load.
- **The chip MUST NOT be smaller than 44×44 of hit area, and MUST carry a visible affordance** — a
  chevron or equivalent. Once the bar is hidden the chip is the **only** route back to the answer,
  and the cost of a rider not finding it is a stale headcount on a ride cancelled for rain.
- **The floating action MUST NOT permanently occlude an interactive element** — see Q4.
- **A failed answer MUST NOT collapse the bar.** `RideAttendanceBar` rolls back and shows why; if
  the screen collapsed on tap rather than on success, the rollback and its message would be
  destroyed by the collapse and the tap would read as having worked.
- **Neither control nor the sheet may name a ride or club the viewer cannot already see.**

## The state checklist

| State | Ride detail |
|---|---|
| **Empty** | An empty timeline still draws its own empty state; the floating action is unaffected — it is gated on crew, not on content. |
| **Loading** | `ride.data === undefined`: no bar, no chip, no floating action, and **no clearance reserved**. Never drawn-then-withdrawn. |
| **Error** | `ErrorState` with a retry, no control of any kind over it, no clearance. |
| **Offline** | Both controls still draw from cached data; the writes behind them own the refusal. An RSVP made offline fails visibly and rolls back, and **the bar stays open** so the message is readable. No queue. |
| **Permission denied** | Indistinguishable from empty at the client and must stay so: a non-crew reader gets the ride with no control and no explanation, never a permission message. |
| **Partial** | Ride loaded, crew rail or timeline read failed → the controls still draw; they are gated on the ride's own `is_crew`. Ride not loaded → nothing. |
| **Stale** | The rider's answer changed in another tab → the composition follows the cache: `setRideAttendance` invalidates `rides.all()`, so the chip, the bar and the control flip together on the next read. In the gap RLS refuses. Stated so it is not rediscovered as a bug. |
| **Transitional** | The moment an answer succeeds, the bar unmounts, the chip appears and the clearance changes from 96px to the control's. That is one deliberate layout change per answer, not a flicker. |

## Impact

- **Files** — new `src/components/ui/FloatingAction.tsx`; new or extended chip component under
  `src/components/rides/`; rewritten `RideCreateBar.tsx`, `src/lib/rides/bottom-slot.ts` and its
  test; `RideAttendanceBar.tsx` (a success callback only); `RideTimeline.tsx` (props removed);
  `src/app/(app)/rides/detail/page.tsx`; `src/app/globals.css` for the control's geometry and
  elevation tokens and one clearance class.
- **`docs/FIGMA-FIDELITY-TODO.md` §Ride detail** gains the three departures above, the third marked
  as a contradiction of a drawn element.
- **No `supabase/` change**, so the `RLS Policy Tests` job does not run and no assertion is owed —
  stated explicitly because `openspec/config.yaml`'s task rule pairs a migration with an assertion
  and there is no migration here.
- **Tests owed** — an exhaustive unit test for the reshaped `resolveRideDetailActions` over its
  whole input space; a component test pinning the `undefined` gate and the chip's absence for the
  organizer; and a **jsdom** test for the chip → bar → answer → chip cycle, because a static render
  cannot dispatch a tap (the reason all five existing jsdom tests exist).
- **`npm run walk`** renders this screen already and is the only gate that would catch a control
  painted under the navigation bar.
- **Sequencing** — none. No migration, so `CLAUDE.md`'s additive/destructive rule does not apply.

## Open questions

**Q1 blocks the club half only and nothing in this change waits on it. Q3–Q8 all have defaults a
build proceeds on.** Each is phrased as the rider's state: the screen, what the rider did, and what
they did not do.

---

### Q1 — BLOCKING on the club detail · product owner only · still open

> A rider opens a **private club they are a member of** and scrolls to the bottom of its timeline.
> They have not tapped anything. Today the navigation bar is 152px tall and carries a full-width
> `Create` above the tabs, which is what frame `2043:10604` draws. **What is drawn there after this
> change, and what does `design/` say it is?**

**A — Figma first.** `design-system` writes the floating action, its elevation token and the club
detail's 88px navigation variant into Figma; the next `figma:pull` bakes them in; the build follows.
**Requires an explicit owner ask**, so no unattended session can take it.

**B — A recorded departure**, frame updated afterwards.

**Recommended: A**, and the reason is specific rather than a preference for process: the club's
departure is not a screen's. `2043:10604` instances `v2 / Component / Navigation / Bar` at 390×152
with `Button Container 358×56` as a child *inside* that instance, and **27 frames instance that
component at 152** — so converting this screen changes a variant **26 other frames** share (nearer
23 if the club's own sub-pages convert with it), and a note recorded on one screen is invisible to
the rest. The ride detail had no such problem, which is why it could ship first.

**Nothing in this change is blocked on this.** The ride half ships and PD-404 stays open.

---

### Q3 — non-blocking · build, default stated · what the control opens

> A crew member taps the floating action on a ride and has not chosen an action yet. **What appears?**

**Default: `RideCreateSheet`, unchanged**, exactly as `RideCreateBar` opens it today. The reference
pattern expands the actions out of the button; the sheet already carries a portal to `document.body`,
a focus trap, Escape, a dismissing scrim, a body-scroll lock and focus restoration — six behaviours
an expand-in-place rewrite would reimplement to move an animation's origin.

**A floating action is exactly the case the portal exists for**: it is `position: fixed`, and any
transformed ancestor becomes its containing block. Mount it where no ancestor transform can reparent
it, and verify by rendering.

---

### Q4 — non-blocking · build, default stated · what the control covers while scrolling

> A crew member scrolls a **ride timeline with more rows than fit** to its last row. **Is any part of
> that row underneath the floating action?**

**Default: reserve the clearance — the last row is never underneath it.** Content ends above the
control, as `.pb-navbar-action-extra` does for the bar today, through a new class sized from the
control's own geometry. This costs the vertical saving (measurement 1) and keeps the horizontal one.

**Alternative: let content run under it**, the only way vertical space comes back. If taken, no
*interactive* element may be permanently occluded, which on a full-width timeline row it would be.

---

### Q5 — non-blocking · product owner · the shape changes between two screens one tap apart

> A rider on **`/rides`** taps a ride and lands on its detail. **Does the create affordance change
> shape between those two screens?**

Under this change's scope: **yes** — `/rides` keeps its full-width `Create ride` inside the
navigation bar, the ride detail gets a floating action, and the **club** detail keeps its full-width
bar until Q1 is answered. **Default: accept it and record it.** Converting the four `STICKY_ACTIONS`
screens means changing the shared navigation component and its frames, which is a separate story.

---

### Q6 — non-blocking · build, default stated · circle or pill

> A crew member opens a **past ride** they rode. **What does the control at the bottom-right say?**

**Default: an extended floating action — a pill carrying the icon and the word `Create`.** The arity
rule fixes the *name* (category, because the ride creates two things since `108`); the pill fixes the
*shape*, and it is chosen for hit area: a bare 56×56 circle is a 5× reduction against today's
358×44 bar, and a ~150×56 pill recovers most of it. A circle stays correct where a label would be
noise; it is not correct here.

---

### Q7 — non-blocking · build, default stated · which corner

> A rider holding the phone in their **left hand**, gloved, opens a ride detail. **Which thumb
> reaches the control?**

**Default: bottom-right**, matching the reference and platform convention, accepting that it favours
right-handed one-thumb use. No frame states it and a mirrored variant is not worth a setting.
Recorded so that *"the design said so"* is not later claimed for it.

---

### Q8 — non-blocking · build, default stated · where the chip sits

> A rider has answered **Going** on an upcoming ride and opens it again. **Where on the screen is the
> word `Going`?**

The owner's decision says *"the ride title line — the first line of the content"*. **The body has no
title line**: PD-393 deleted `<h2>{ride.title}</h2>` because `RideHeader` draws the title in the
fixed header 40px above.

**Default: the first line of the scrolling content** — a dedicated row above the club link and the
date/location lines, so the chip is the first thing under the header and is never in fixed chrome.

**Not the fixed header**, and this is the part worth stating: that row is 40px tall, already carries
back plus `RideThreadsButton` (x302) and `RideOptionsMenu`, and a 44px control added to it changes
`--header-height`, which **every screen in the app** derives its top padding from. A chip in the
header would also persist across the ride's crew and threads screens, where there is no bar to
reopen.

If the owner meant the header's title row, that is a one-line correction and only this question's
default moves.
