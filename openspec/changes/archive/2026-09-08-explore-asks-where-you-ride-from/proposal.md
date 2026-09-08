# Explore asks where the rider rides from — one row, and no sheet that opens by itself

> **The one open parameter is SETTLED in this proposal and is not open.** PD-447 asked for the
> dismissal interval to be decided here; nobody was at the keyboard when this was written (a
> scheduled queue firing), and the issue says *"settle it in the proposal"*. It is settled below as
> **30 days, doubling on each consecutive dismissal, capped at 180, reset by the rider acting.** A
> later session changing it is making a new decision, not filling a blank.

## Why

`/rides` and `/clubs` stack two 56px rows in the same slot. Measured rather than assumed — the two
components are byte-comparable in geometry:

| | `ExploreRidesStrip` / `ExploreClubsStrip` | `UseMyLocationRow` (`refine`) |
|---|---|---|
| Box | `h-14 … rounded-lg bg-surface px-4 gap-3` | `h-14 … rounded-lg bg-surface px-4 gap-3` |
| Leading | `LocationFilledIcon h-6 w-6 text-accent` | `LocationFilledIcon h-6 w-6 text-accent` |
| Trailing | `ChevronRightIcon h-6 w-6 text-muted` | `ChevronRightIcon h-6 w-6 text-muted` |
| Label | `Explore rides near Hoorn` | `Near Hoorn · Use my location` |
| Element | `<Link>` | `<button aria-haspopup="dialog">` |

Product owner, 2026-09-08: *"2 labels on the top don't look great."* They are not near-identical by
accident — `UseMyLocationRow`'s own header says the geometry is `ExploreClubsStrip`'s *deliberately*,
because "the same row in the same place on two tabs should be the same row". That reasoning was
right about two tabs and wrong about two rows.

**The fix is not a merged component.** The strip is a door to a screen; the row is a question about
the rider. Merging them makes one control with two destinations. Instead the row **becomes a
question and moves to the screen it affects**, and the tab roots keep only their door.

## What changes

1. **The row asks instead of offering.** `Still in Hoorn?` where a town is what the distances are
   measured from; `Where do you ride from?` where nothing is. Tapping it is the invitation to share
   the device location; changing the town is the quieter secondary route.
2. **`/rides` and `/clubs` lose the row entirely** — two call sites deleted. The door strip already
   renders in every state (`ExploreRidesStrip.test.tsx` §the door pins all three).
3. **No sheet opens by itself.** `auto`, `AUTO_ASK_DELAY_MS` and the `riderOpenedSheet` latch are
   deleted; the latch is safe to delete only *because* the timer is (it exists solely to stop the
   timer landing on a sheet the rider opened).
4. **The once-ever boolean becomes a dismissal ladder.** A dismissal means *"yes, still here"* and
   keeps the row quiet for an interval that lengthens while the rider keeps dismissing.
5. **The profile-source + `denied` exclusion is lifted for the town half only.** That rider gets
   `Still in Hoorn?` opening the town question directly — never the device offer, which for them is
   a dead end iOS will not re-open for the life of the install.

## What is being REVERSED, on purpose

**PD-419's *"at Explore, once, automatically, ever"* is removed.** A later session reading a
component that no longer opens its own sheet must not read it as a regression and put the timer
back, so it is named here and in the delta spec.

- **What is reversed:** the automatic open on the two Explore screens, and the once-ever boolean in
  `ask-once.ts` that rationed it.
- **What is KEPT from PD-419, and must not be collected on the way past:** the town rung itself,
  `TownQuestionSheet`, the `blocked` sheet's *Set your town* primary (the route out that does not go
  through the Settings app), and `unavailable` → the town question rather than `hidden`.
- **The accepted cost is fewer device grants.** Some riders granted only because a sheet appeared;
  those grants are given up in exchange for an app that never raises a permission sheet unasked.
  The exchange is not free and is not being described as free.
- **The compensations, so the loss is bounded:** the row is now on the two screens where the reason
  is visible, in every state that has a question left; the `denied` + stale-town rider gains a route
  that works where they previously saw nothing at all; and the ladder means a rider who says *not
  now* is asked again eventually rather than never.

`openspec/specs/` carries **no** standing requirement for the automatic ask — PD-170 and PD-419 both
shipped without an OpenSpec change, and the only priming capability in the repo belongs to push:

```bash
grep -rln "locationPrimingState\|UseMyLocationRow\|ask-once" openspec/specs/   # 0
ls openspec/changes/deliver-push-notifications/specs/                          # push-permission-priming
```

So this change **adds** the capability that should have existed rather than modifying one, and there
is no standing scenario asserting the behaviour being removed.

## The settled parameter, in full

**Base 30 days. Each consecutive dismissal doubles it. Cap 180 days. The rider acting resets the
counter to zero and starts a fresh 30 days.** Ladder: 30 → 60 → 120 → 180 → 180 …

*Acting* means the rider **stored** a town or granted the device permission and got a fix.
`profiles.location` has **two** writers, not one — `setRiderTown` (the row's sheet and
`/profile`'s setting) and `setHomeTown` (the wizard's town step) — so each carries the reset
rather than one of them guaranteeing it for the other. **Clearing a town is not acting**: that
rider lands in the state the question exists to fix.

The counter-argument the issue records is why weekly was rejected: a town changes maybe twice in a
lifetime, and this row carries the permission offer alongside the question, so a weekly question is a
monthly permission nag wearing a different label. Thirty days is the shortest interval that is not
that. The reset is what stops the ladder punishing a rider who answers — otherwise the rider who
corrects their town in March is quiet until September for having engaged.

**A dismissal quiets every state, not only the town states.** The counter-case is real and is
recorded rather than hidden: a rider with no position at all sees degraded distances and a dismissal
buys them thirty days of that. It is still the right default — the alternative is asking a rider who
said no on every visit to Explore, which is exactly the nag this change exists to remove — and it is
not a dead end, because `/profile` → `LocationSetting` reaches the same question with no interval on
it. Recorded as Q1 below.

## The state table

Every reachable combination of the four inputs. `permission` is the Permissions API answer,
`position` is `resolveRiderLocation()`'s, `town` is raw `profiles.location`, `quiet` is the dismissal
record against the clock.

| # | permission | position | town | quiet | State | What the rider sees | Tap opens |
|---|---|---|---|---|---|---|---|
| 1 | `undefined` | any | any | any | `hidden` | nothing | — |
| 2 | any | `undefined` | any | any | `hidden` | nothing | — |
| 3 | any | settled | `undefined` | any | `hidden` | nothing | — |
| 4 | any visible state | | | **true** | `hidden` | nothing | — |
| 5 | `granted` | device fix | any | any | `hidden` | nothing | — |
| 6 | `granted` | `null` (fix failed) | any | any | `hidden` | nothing | — |
| 7 | `granted` | profile | any | any | `hidden` | nothing | — |
| 8 | `prompt` | `null` | none | false | `ask` | `Where do you ride from?` | priming sheet, `ask` |
| 9 | `prompt` | `null` | stored but ungeocodable | false | `ask` | `Where do you ride from?` | priming sheet, `ask` |
| 10 | `denied` | `null` | none | false | `blocked` | `Where do you ride from?` | priming sheet, `blocked` |
| 11 | `denied` | `null` | stored but ungeocodable | false | `blocked` | `Where do you ride from?` | priming sheet, `blocked` |
| 12 | `unavailable` | `null` | none | false | `town` | `Where do you ride from?` | town sheet |
| 13 | `unavailable` | `null` | stored but ungeocodable | false | `town` | `Where do you ride from?` | town sheet |
| 14 | `prompt` | profile | `Hoorn` | false | `refine` | `Still in Hoorn?` | priming sheet, `ask` |
| 15 | `denied` | profile | `Hoorn` | false | **`confirm`** | `Still in Hoorn?` | **town sheet** |
| 16 | `unavailable` | profile | `Hoorn` | false | **`confirm`** | `Still in Hoorn?` | **town sheet** |
| 17 | `prompt` / `denied` | device fix (stale memo) | any | any | `hidden` | nothing | — |

**Rows 15 and 16 are the lifted exclusion**, and `confirm` is the sixth state. Row 16 is lifted too,
by the same argument as row 15: a rider whose platform has no geolocation has no device route either,
and today reads `hidden` for having a position at all.

**Row 17 is reachable and is deliberately `hidden`.** `rider-location.ts` memoises a fix for five
minutes, so a rider who revokes the permission in Settings and returns keeps a device-sourced
position under a `denied` permission until the memo lapses. Drawing a question that disappears five
minutes later is worse than drawing none, and the state self-corrects.

**Rows 5–7 are the "granted rider is never interrupted" rule** and cost one honest concession: row 7
is a rider whose GPS failed and whose stale town is being used under a live grant, and this row says
nothing to them. `/profile` → `LocationSetting` is their route, `describeRiderLocation` already names
all three sources there, and the state is transient by construction.

**Row 3 is new and is why `town` stops being an optional prop.** Today it is optional and its
absence degrades to a bare offer. Under the new copy the town is the difference between two
*different questions*, so a row drawn before the town read settles asks the wrong one and then
changes its mind on screen. Both Explore screens already hold `queryKeys.profile.location()`.

**Rows 9, 11 and 13 are the trap in the copy.** A stored town that `getLocalityCentroid` cannot
place produces `position === null`, so the app is measuring from nowhere while a town sits in the
column. `Still in Hoorn?` there would confirm a town that leaves the screen exactly as broken. The
rule that falls out is `near-label.ts`'s, reused verbatim: **the question names a town only when that
town is what the number was measured from** — that is, only when `position.source === 'profile'`.

## The copy

| State | Visible label | Accessible name |
|---|---|---|
| `refine`, `confirm` | `Still in Hoorn?` | `Still in Hoorn? Change where your distances are measured from` |
| `ask`, `blocked`, `town` | `Where do you ride from?` | `Where do you ride from? Set where your distances are measured from` |

A bare question read aloud says nothing about what tapping does — the same rule the ride status chip
carries. The town is `localityOf(profiles.location)`, rendered verbatim, exactly as the `refine` row
already renders it.

**No sheet copy changes.** `LocationPrimingSheet`'s two modes and `TownQuestionSheet`'s measured
heading are untouched; only which of them a state opens moves.

## Negative cases — who must NOT see or do this

This change reads and writes nothing that is not the viewer's own, and adds no table, policy, grant
or RPC. The negatives are therefore stated as properties, each of which is checkable:

- **No other rider's town, position or dismissal state is reachable through this row, in any state.**
  Its only reads are `queryKeys.riderLocation()` (the device or the viewer's own
  `profiles.location`) and `queryKeys.profile.location()` (`getMyLocationText`, the viewer's own
  row). No embed, no list, no other rider's id enters the component.
- **No role gains reach.** Owner, admin, member, non-member and blocked rider all see exactly the
  same thing: their **own** question about their **own** town. There is no club or ride resource
  behind this control, so there is no per-role split to state beyond that identity.
- **A blocked rider is not detectable through it.** The row's inputs contain no other rider, so it
  cannot leak the existence, town or proximity of anyone — including someone who has blocked the
  viewer or been blocked by them.
- **A signed-out visitor SHALL NOT see this row anywhere.** Both screens that draw it are behind the
  route guard and behind RLS. In particular the row **SHALL NOT** be added to the one anonymous
  surface, `ride_invite_link_public_preview` / `/r/<token>`: that visitor has no profile row to
  name, no session to write one, and adding a question about "your town" there would either be dead
  or would invent a second anonymous read. Decision #1 is untouched by this change.
- **The device position SHALL NOT be shown to any other rider**, unchanged from PD-170: a fix leaves
  the device only as a ~1 km-rounded proximity bias on a `search-places` request.
- **The dismissal record SHALL NOT hold a town, a coordinate or a rider id** — only a timestamp and
  a small integer. A device-local copy of a profile field would outlive sign-out and be readable by
  the next rider on the phone.
- **The record SHALL NOT survive sign-out.** It survives today (`signOut` clears six things and this
  is not one of them), which under a boolean was nearly harmless and under a 30-to-180-day ladder is
  not: rider B inherits rider A's silence and is never asked about their own town. Clearing it fails
  open — B gets asked.
- **Nothing may derive a position from anything the rider did not type.** `TownQuestionSheet`'s
  standing decision: no IP lookup, no postcard locations, no club locations. This change adds no new
  inference and must not be read as licence for one.
- **No screen other than the two Explore screens may draw this row.** A third caller re-creates the
  duplication this change removes; the tab roots specifically must not get it back.
- **Nothing may open a sheet without a rider gesture** — no timer, no effect, no route transition,
  on any screen. This is the reversal, stated as a prohibition so it is testable.

## Retention, deletion, notifications, scale

- **Retention.** The dismissal record lives on one device, is superseded by each write, is cleared on
  sign-out, and never reaches the database. Longest life without a sign-out is until the rider acts.
- **Deletion.** Account deletion cannot reach device storage; `delete-account` is not involved. The
  record is cleared because deletion signs the rider out, and it identifies nobody in any case.
- **Notifications.** None. This change produces no notification and collapses none.
- **Ordering, pagination, counts.** None. The row renders one string from four inputs; it reads no
  list and no count.
- **Schema.** **No migration.** `profiles.location` is `text NULL` and already carries everything
  (verified against DEV, 2026-09-08); the ladder is `localStorage`. `supabase/` is untouched, so the
  config's migration/assertion pairing is satisfied by there being no migration.

## Open questions

**Q1 — does a dismissal quiet the no-position states too? (non-blocking; product owner)**
Default taken: **yes, uniformly.** Build against it. If the owner would rather a rider with no
position at all be asked on every visit, that is a one-line change to the gate and one test.

**Q2 — does closing the sheet by scrim or Escape count as a dismissal? (non-blocking; agent's call,
default taken)** Default: **yes — any close without a stored town and without a grant is a
dismissal.** One rule beats three, and the alternative asks again in the same second the rider
dismissed it, which is the nag. Includes the close that follows an OS `denied`: the town offer was on
screen in the same sheet.

**Q3 — is the strip's `Explore rides near Hoorn` still the right door label once the row below it
asks about Hoorn? (non-blocking; product owner)** Default: **unchanged**, out of scope.
`explore-label.ts` is read by four surfaces and PD-427 settled it two days ago.

**Q4 — should `confirm` also offer the device as a secondary route? (non-blocking; agent's call,
default taken)** Default: **no.** For `denied` the OS will not re-raise the dialog and for
`unavailable` there is no API; a secondary that cannot work is the dead end this change removes.
