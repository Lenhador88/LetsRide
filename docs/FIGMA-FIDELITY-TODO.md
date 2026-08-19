# Figma fidelity — what is inferred and must be verified

This file registers design values the code had to **infer** rather than read, so that a guess
never passes silently as a known one (`CLAUDE.md` §Working Principles).

## The snapshot landed — 2026-08-04

**`design/` is populated.** The product owner upgraded the Figma plan, all seven endpoint
families probed 200, and one whole-file pull captured 195 frames (298 addressable screens),
140 components and all 53 icons. The premise most of this file was written under — "the design
is unreadable" — **no longer holds**.

```bash
npm run figma -- ls [pattern]                    # every frame and component
npm run figma -- tree "View all new postcards / Home - Postcards - All new"
npm run figma -- text "v2 / Component / Postcard"
```

None of those touch the network, so none can be rate limited. **A composition question is now
a file read, and inferring one is no longer defensible.**

Two traps the snapshot itself had, both fixed in the same change — worth knowing because they
silently produce wrong values:

- **Figma keeps toggled-off layers.** A Home header still *contains* the back button it hides.
  `tree` now omits hidden subtrees by default (`--all` shows them marked `[hidden]`). Reading
  the unfiltered tree is how you end up building a back button onto the home screen.
- **Rotation is not in the bounding box.** A rotated node reports a *larger* box, so the fanned
  card stack read as three differently-sized cards. `rotation` is now carried, in degrees and
  clockwise-positive for CSS.

## Resolved by the pull — 2026-08-04

The home screen was rebuilt against the measured design in the same change. What follows in
§Home, §Navigation and §Icons is **struck through where it was resolved**; the entries that
remain are real gaps, and three of them are schema gaps rather than design ones.

**The gaps that outlived the pull, because the design needs data the schema has not got:**

| Gap | What the design shows | What is missing |
|---|---|---|
| **Unread counts** | Filter tiles carry a badge; the deck is "all *new*"; the empty state is "no *new* postcards, yet!" | No seen/unseen model anywhere. The badge currently counts postcards in the feed window, which is the same number while nothing is marked seen. Needs a `postcard_views` table or a last-seen stamp — a migration, and `012`/`013` are still unapplied ahead of it. |
| **Photo location** | Every card overlays `flag · City, Country` | `postcards` has no location columns. The date renders; the location does not. The author's `profiles.location` is where they live, not where the photo was taken, so it is not a substitute. |
| **Share count** | The share action shows a count | Nothing is recorded to count. The button shares a link (Web Share API, clipboard fallback) and shows no number. |

## Why the design was unreadable — historical, resolved 2026-08-04

Kept because it explains why the guesses above exist and how the block was diagnosed. **Every
row below is now 200.** Re-run `npm run figma:check -- --probe` rather than reading this table
as current state.

Two independent blocks, and they need different fixes:

| Route | State | Nature |
|---|---|---|
| `/v1/files/:key`, `?depth=1`, `/nodes` | **429** | Rate limit. Recovers on its own, but on a **multi-day** clock — `Retry-After` read 69 hours on 2026-08-03, not the "hours" this table used to claim. "Free and uncapped" is unverified and doubtful; the 429 names `x-figma-plan-tier: starter`. |
| `/v1/images/:key` | **429** | Same. Was 200 earlier the same day, then degraded. |
| `/v1/files/:key/components`, `/styles` | 200 but **empty** | The library is unpublished — not a permissions problem. |
| `/v1/files/:key/images` | 200, **418 fills** | Reachable, but see below. |
| `/v1/files/:key/versions`, `/comments`, `/v1/teams/:t/projects` | 200 | No design structure in them. |
| Figma MCP server | **quota exhausted** | Starter = 6 tool calls/month. Plan gate. |
| `s3-alpha-sig.figma.com` | **fixed 2026-08-03** | Was a 403 at CONNECT from this environment's network policy; now allowed, and a 2.2 MB fill downloaded cleanly. |

**The S3 block is fixed; the rate limit is not.** Allowing the two Figma S3 hosts removed the
blocker that would never have cleared on its own, so icon export should work as soon as
`/v1/images` stops 429-ing. What remains:

1. Wait out the 429 on `/v1/files/*` and `/v1/images`. Free, and needs no upgrade — do **not**
   buy a Figma plan to solve it, which fixes only the MCP path.
2. Publishing the library would make `/components` and `/styles` useful, but is not required:
   87% of fills reference a named style and those names ship in the `styles` map of any
   `/nodes` response.

**Do not go looking for screens in `/v1/files/:key/images`.** Those 418 fills are content
placed into the file, not frames — photos, and at least one personal WhatsApp screenshot with
a real name and private conversation in it. There is no layout there, and it is not ours to
mine.

Verify all of the above with `npm run figma:check -- --probe` before assuming any of it is
still true — it sweeps every endpoint in one command.

## What is NOT inferred

These came from the file and are already verified — do not re-derive or second-guess them:

- All 20 v2 colour tokens, all 16 Poppins type tokens (`docs/reference/design-system.md`).
- The app background: 135° gradient `#F2ECE6` → `#CCB8A3`.
- Most-used geometry: radii `4`, `8`, `12`, `100`; padding `16`, `8`, `24`; spacing `8`, `4`, `16`.

Anything built from that list is correct by construction. The debt below is **composition**,
not styling.

## TODO — verify against Figma

Sections are filled in as screens are built. An unchecked box is a known unknown; where a
screen has now been built, the box records **what was chosen** so verification is a diff
rather than a re-derivation.

**Built 2026-08-03 against this register:** the feed (`/postcards`), the card, the like
control, and the create screen (`/postcards/new`). **Built 2026-08-04:** the comment thread
(`/postcards/detail`), the composer and the card's comment control. Every value below marked
*chose* is in the code right now and unverified.

### Home / Postcards feed — rebuilt from the measurements 2026-08-04

Source: `Home - Postcards - All new` (`1883:15456`), `v2 / Component / Postcard` Type=Home,
`v2 / Component / Filter Bar / Postcards`. Screenshotted at a real 390×844 viewport before
being called done.

- [x] ~~**Card composition**~~ — **measured.** 342×448, radius **8**, 4px padding, 8px gaps,
      fill `#FAFAFA` under a White/100 style (`bg-surface` keeps the token; the 1.5% gap is
      invisible). Photo **334×200 — 5:3, not the 4:5 that was guessed**, radius 4. Three
      stacked drop shadows, tinted: `0 4px 8px #00000014`, `-4px -2px 16px #00AAFF14`,
      `4px 2px 16px #FF005514`. → `src/components/postcards/PostcardCard.tsx`
- [x] ~~**Byline**~~ — **measured.** *Below* the photo, not above: avatar 24px (`Avatar`
      Size=Small, 2px Grey/20% ring) + `username in Club name`, all Poppins/12/Semibold
      Grey/100, 12px side padding. The relative timestamp guessed here is not in the design at
      all — the date lives on the photo instead.
- [x] ~~**Like affordance**~~ — **measured**, and the text-label fallback is retired. Icon
      control on the shared `Button / Postcard Action` shape (gap 4, padding 8/12/8/8, radius
      8 — **the 12px is conditional as shipped; see the entry below**), Heart Outline →
      **Heart Filled in Pink/100 `#F23071`** when liked. That settles the
      "Pink/100 — purpose not established" note in `CLAUDE.md`: it is the liked heart, and
      nothing else uses it.
- [ ] **An uncounted action control is the owner's 6/6 box, 8px under the glove floor —
      deviation, adopted 2026-08-17.** Same status as the photo-box entry under §Create
      postcard: a design question on record, not drift. All eight
      `Button / Postcard Action` variants — `Type=Share` included — draw a count, so the
      frame's `padding 8/12/8/8` measures the gap between the **number** and the box edge and
      has no ground truth for the zero-count state. The app has that state constantly: `Count`
      renders nothing at zero, and `ShareButton` passes no count at all because nothing is
      recorded to count. Applied unconditionally the 12px is dead space beside a bare glyph,
      and with the frame's own `itemSpacing 0` two adjacent icons sat 20px apart.
      - **A counted control is still the measured box, and deliberately so.** Shipped as
        `pl-2 pr-3` with a count — 8/12, 54px, exactly the frame — and `px-1.5` without.
        Only the state the design never drew moved; scaling the counted box to match was
        built and rejected, because it would depart from a measured value in a state the
        frame *does* draw. Measured in Chromium at 390px: uncounted controls **36px** wide
        with **12px** icon gaps, counted ones unchanged at 61/56px.
      - **The 6px is the owner's number, not an inference.** The first pass shipped symmetric
        8 (40px, 16px gaps) as this file's own reading of what the frame would have hugged
        to. Shown 16px, 12px, a 12px-with-28px-glyph variant and 8px rendered side by side on
        2026-08-17, the owner chose 12px. So this line records a decision, and the only thing
        to re-derive is whether it still holds.
      - **The cost is horizontal tap target, and it cannot be bought back.** An uncounted
        control is 36×44. The `::before` that lifts the height to 44 cannot widen it: the row
        is `gap-0` and the boxes abut, so `-inset-x` would overlap the neighbour and hand the
        later sibling taps meant for the earlier one — firing the wrong action, which is worse
        than a narrow one. The gap between two glyphs **is** the control width minus the 24px
        icon, so there is one lever and not two: 12px apart means 36px wide, 16px means 40px,
        and the 44px floor would mean 20px apart — the version that prompted all of this. The
        escape is a larger glyph, and **32px is the one that actually clears the floor**
        (32+6+6 = 44 with the gaps still 12). The variant offered to the owner and declined was
        **28px, which reaches only 40** — it buys back the width this entry gave up and does
        not reach the floor, so a later session reaching for "the logged escape" must not read
        it as clearing 44.
      - **The second tap after a like clears its neighbour by under a pixel.** `LikeButton` is
        optimistic, so a tap on a zero-like card grows that control from 36px to 53.1px in the
        same frame — and a rider tapping comment where it was a moment earlier is 0.9px inside
        the new comment box. Measured in Chromium at 390px, both states rendered: the old
        centre still resolves to the right control, so this is a **thin margin, not a defect**
        — but 0.9px is inside font-rendering variance, and at 16px spacing the same margin was
        6.9px. A shift larger than half the neighbour's width lands the tap on the *previous*
        control, which un-likes instead of opening the thread. So "revisit if a rider reports
        mis-taps" points here as much as at the static width, and the fix if it is ever needed
        is to stop the control resizing on the optimistic write rather than to widen it back.
      - **The rule is gated; the pixels are not.**
        `src/components/postcards/__tests__/PostcardAction.test.tsx` renders all three
        variants plus the composed card and asserts the class list — the conditional padding,
        that a zero count reads as no count, that a caller can still override it, and that the
        row keeps `gap-0`. Each was proved to fail against a reintroduced regression before it
        was committed — including the counted-box departure named above, which fails 4. What
        it does **not** assert is any width above: the suite is `environment: 'node'`, so
        6+24+6 = 36px is the browser's arithmetic, measured in a scratch route that no longer
        exists.
- [x] ~~**Empty state**~~ — **measured copy:** "There are no new postcards, yet!",
      Poppins/14/Medium in Grey/80, centred, no panel, no illustration, no CTA.
- [x] ~~**Header**~~ — **measured.** `v2 / Component / Header` Type=Regular: 96 tall, centred
      "Home", no back button and no sub-page on this screen (both are toggled off in the
      instance). The "New postcard" button guessed here is real but belongs to the *nav bar*
      as a sticky action, not the header.

      **Only the geometry is the component's — the string is not, and the obvious command says
      so in a way that reads as this entry being stale.** `v2 / Component / Header` is a
      `COMPONENT_SET` whose title layer is the placeholder `Page Name`, so
      `npm run figma -- text "v2 / Component / Header"` prints
      `Page Name`/`User Name`/`Sub Page Name`/`Club Name` and never "Home". Every screen's
      header string is an *instance override* living in that screen's own frame, so query the
      frame instead — `npm run figma -- text "View all new postcards / Home - Postcards - All
      new"` shows "Home" as `Page Name · 16/24 w600`. This holds for any screen's header, not
      just this one.
- [x] ~~**Pagination**~~ — **the design does not page.** The screen is a swipeable stack: you
      advance one card at a time and the deck ends. `getFeed` stays bounded.
- [ ] **Caption treatment** — still open. The design's caption box is a fixed 140px and the
      mock text overflows it, so *something* clips — but no clamp count or "more" affordance is
      drawn. *chose:* scroll inside the card, so no words are hidden and the action row cannot
      be pushed off. Ask the designer whether it should clamp instead.
- [ ] **Swipe direction** — *chose:* a swipe in **either** direction advances, per the product
      owner's description, so the deck only moves forward and "Start over" is the only way
      back. If the intent was a carousel (left = next, right = previous) this is one change in
      `PostcardDeck.tsx`. Prototype wiring was not read.
- [ ] **Options menu** — the card's fourth control opens `Hide postcard for me` / `Block
      account` / `Report post` (Poppins/16/Medium), with confirmation banners
      ("Postcard hidden"). `hidePostcard`, `reportPostcard`, `blockRider` and `deletePostcard`
      all exist and are called by nothing. **Not built** — the slot is left empty rather than
      shipping a dead button. Frames: `Postcard options` (`2302:5395`), `Postcard hidden
      banner` (`2303:6009`).
- [ ] **Loading state** — **not built.** Skeleton vs spinner is not drawn in any Home frame.

### Filter bar

- [x] ~~**Shape language**~~ — **measured.** Riders are 64px circles; clubs are 60px rounded
      squares at radius 8. The club tile is deliberately the smaller of the two so both read
      as the same optical size. Selected is a 2px `Accent Brand/100` ring sitting 4px outside
      the image (72 for a circle, 68 at radius 12 for a square) plus an accent-filled badge.
      "All new" is a 2×2 collage of the four newest photos.
- [ ] **Shape is the only differentiator** — the design gives riders and clubs no label,
      grouping or badge to tell them apart, only a 4px difference in corner radius at 60px.
      Built as drawn. Worth a second look on a real device before it ships to riders; the
      product owner has already flagged it as a possible readability problem.
- [ ] **Badge semantics** — see the unread-count gap above. The tile currently badges how many
      postcards in the feed window come from that rider or club.

### Create ride — built 2026-08-05

`/rides/new` is the last v1 page, retired. Its epic reads **To do** and the frame
(`1918:15850`) is OLD-stylesheet throughout — 58 `Grey (OLD)/*` references — so the
composition is the v2 primitives applied to the columns `001` has, not a measured layout.
Expect to move things when the designer draws it.

- [ ] **Five drawn fields have no column**, and none is built: an **end time** (the frame draws
      a second date and time; `rides` has only `departure_at`), **distance in km**, **"Includes
      offroad"**, **"Public seats"** as a number separate from `max_riders`, and a **cover
      photo**. The last is the same missing column that leaves the rides list's 80-wide image
      strip empty.

- [ ] **Rider invitations with an Admin role** are drawn here as well as on Create club. Same
      unbuilt feature, same reason: `club_members.role` has had `admin` since `001` and nothing
      writes it, and `ride_members` has no invite concept at all.

- [x] ~~**A ride could not be attached to a club**~~ — **fixed.** `rides.club_id` has existed
      since `001` and no screen ever set it, so a club's Rides sub-page could only ever be
      empty. The form now offers the rider's own clubs via `getMyClubs()`, which already
      existed for the postcard composer.

- [ ] **The club select is a bare `<select>`.** There is no v2 select in the component library
      and the design does not draw one, so it borrows the `Input` treatment rather than
      inventing a component. Replace it when a real one is designed.

- [x] ~~**`max_riders` is unenforced**~~ — still true, and still not this form's job. The
      schema has carried the column since `001` with no policy, trigger or check behind it.
      The form bounds what can be *typed*, which is not the same thing.

### Create club, and the original club detail — built 2026-08-05

`/clubs/detail` is four sub-pages behind the header's dropdown — Timeline, Rides, Members,
About — built from the **private club** frames, which are the ones marked Done.

**The four-way switcher this section describes is gone — 2026-08-18, see §Club detail
below.** Read that section before treating anything here as the current shape of the screen;
this one is kept as the record of the original build and the two bullets it resolved. Renamed
from "Club detail and Create club" so the two sections' headings do not share a leading
"Club detail" — `crossrefs.mjs`'s two-word match would otherwise call every "§Club detail"
citation ambiguous between them.

- [x] ~~**Which club design to build**~~ — **settled by the epic covers, and it is a product
      statement, not a styling one.** `View private club` is **Done**. Both public-club epics
      are **On hold**, and `View not joined public club` carries the note: *"Public clubs are
      Post-MVP. Until then we only have private clubs."*

      **Answered by the product owner: public clubs are in scope**, so that note is out of
      date rather than binding — which `/clubs/explore` being marked Done already implied. The
      create form defaults to **public**, matching `001`'s column default. This entry said
      "defaults to private" for one commit after the code said otherwise; the default now lives
      in exactly two places, `defaultChecked` and the column, and `clubSchema` carries no
      third.

- [ ] **The Timeline's activity feed is not built.** The design interleaves postcards with
      event rows — "Ron Wilson joined the club.", with a time-since — and there is no table
      behind any of them. Joins, leaves and ride creation would need an `events` table written
      by triggers, or a union of derived queries with no shared ordering key. Omitted rather
      than approximated: a plausible-looking audit log that is missing half its events is
      worse than none.

- [x] ~~**Upcoming rides render as list cards, not the drawn chip.**~~ **Resolved
      2026-08-18**, by the club detail merge: `RideChip` now builds `Collection / Ride`
      (`2059:5732`) for real, and the club page's Upcoming rides strip scrolls it
      horizontally rather than stacking `RideCard`. See §Club detail below.

- [x] ~~**The header's `Options` control is omitted, not stubbed.**~~ **Built 2026-08-18**,
      by the club detail merge — `ClubOptionsMenu`. Leave no longer lives on the About page;
      that page is deleted and Leave moves into this menu, member/admin-only. **Edit club
      still has no v2 design** — its frame is OLD-stylesheet and shares the `Create club`
      epic, which is To do — but the *header control* that opens it is now built and drawn
      from the approved merged mock rather than the OLD-stylesheet frame. See §Club detail
      below for the one row of that mock left deliberately unbuilt (`Delete club`).

- [ ] **No remove-member control**, though the v1 Create club frame draws one. `001` grants a
      rider DELETE on their own `club_members` row only, so the button would always fail. It
      needs a policy and an admin model, not a button.

- [ ] **`club_members.role = 'admin'` has never been written by anything.** The Members page
      labels it if it ever appears, and nothing can produce it. The v1 frame draws an Admin
      role and an invite flow with a `(Pending)` state; neither is built.

- [x] ~~**Create club composition**~~ — **ours, and flagged as such.** The `Create club` frame
      is drawn entirely in the OLD stylesheet (37 `Grey (OLD)/*` references, zero
      `v2 / Component / *` instances) and its epic reads **To do**. What shipped is the v2
      primitives applied to the fields that already exist — not a measured layout. When the
      designer draws it, expect to move things.

- [ ] **`clubs.name` and `description` have no CHECK constraint.** `001` declares both as bare
      `text`; the 60/500 limits live only in `lib/validation/clubs.ts`, which is why no client
      may write the table directly. Same gap `bio`, `bike_model` and `location` carry.

### Club detail — merged 2026-08-18

`/clubs/detail`, `/clubs/detail/members` and `/clubs/detail/rides`, from `Private club -
Timeline` (`2043:10604`), `- Rides` (`2059:6390`), `- Members` (`2059:6545`), `- About`
(`2059:6700`) and `- Sub Pages` (`2059:5931`). This is the club counterpart of the ride
detail's own merge — read §Ride detail's identical entry above for the pattern; this one
states only what differs.

**The sub-page switcher is gone.** The frames' four-way split (Timeline / Rides / Members /
About, behind `ClubDetailPageMenu`'s bottom sheet) is one screen now: Members and Upcoming
rides are sections with their own `See all`, the header drops to 96px, and
`/clubs/detail/about` is deleted outright — its type line, created-at and description move
onto the merged screen, and its one action (leaving) moves into the header's new dots menu.
Approved by the product owner as `AI / Club detail merged / 2026-08-17` — `4176:12575`
(member view), `4181:6897` (owner Options open), `4181:6930` (member Options open) and
`4181:13068` (members expanded in place); **that page, not the five frames above, is the
current specification for this screen.** Consequences worth stating separately, because each
is a drawn value this repo no longer builds:

- [ ] **The dedicated About sub-page is gone**, its type/created-at row and description
      absorbed into the merged screen as a muted line and an `ExpandableText`, no `bg-surface`
      card around either — the ride plan's blurb has no card either, and this screen now
      matches it rather than keeping the About page's boxed treatment.
- [ ] **`Collection / Ride` (`2059:5732`) is finally built**, closing the fidelity gap the
      original Club detail entry logged in 2026-08-05 ("Upcoming rides render as list cards,
      not the drawn chip"). `RideChip` is the 200×56 dark chip; see its own docstring for the
      token choices. **Its time is a single instant** — `14:00`, not the drawn `14:00 -
      18:00` — the same `rides` has-no-end-time gap already logged against the ride detail's
      own date row; not repeated in full here.
- [ ] **The header's `Options` control is built, and one row the mock draws is not.** Both
      Options frames (`4181:6897` owner, `4181:6930` member) draw three rows under a
      hairline: `Edit club` (owner) or nothing (member) above the line, then `Delete club`
      below it for the owner. `ClubOptionsMenu` builds `Edit club` and `Leave club` and
      **deliberately omits `Delete club`** — `ClubDetailHeader`'s own docstring and
      `openspec/changes/add-ride-club-edit-delete/design.md` §D4 (PD-101) already put
      deletion at the foot of the edit screen behind a second tap, in `DeleteClubControl`,
      and siting the same destructive control in two places is how it gets tapped by
      accident. The product owner settles which frame is right; until then
      `DeleteClubControl` stays the one place it lives.
- [ ] **Join is not in the menu either**, though neither approved frame draws a non-member's
      Options sheet to compare against. `ClubMembershipButton` stays inline on the page
      instead, visible only to a non-member — a constructive action stays visible, only the
      destructive one (Leave) is tucked away.
- [ ] **`ClubMemberRail`'s avatar stack draws no admin distinction.** The members page marks
      `role = 'admin'` with a trailing label and no ring; the rail's collapsed state shows
      only the host ring, on the owner, matching what `RideCrewRail` draws for the ride
      organizer. Opening the rail shows the same labels the members page does.
- [ ] **`See all` adds four more `text-accent`-on-cream instances to the count already logged
      against the ride detail.** That entry measured `#3D996B` on `--color-background`
      `#F2ECE6` at **3.00:1** against a 4.5:1 bar, and put it at three instances on that
      screen (`Directions`, `See all`, the crew rail's error fallback). **Count this screen's
      in two places, not one** — the first pass of this entry said two and missed the third,
      because two of them come through `SectionHeader`'s `action` prop and the third is the
      rail's own `See all` inside its expanded panel, where a grep of the page file cannot
      see either kind. **Raised to four 2026-08-18**, when the reorder below gave `Postcards`
      its own `See all` too:

      ```bash
      grep -c "label: 'See all'" 'src/app/(app)/clubs/detail/page.tsx'   # 3, via SectionHeader
      grep -c "text-accent" src/components/clubs/ClubMemberRail.tsx      # 1, the panel's own
      ```

      Not a new failure mode — the same pairing, four times on one screen now; raised on the
      same PD-176 designer question rather than logged again as new.

      **PD-259 DEVIATED rather than adding a fifth, and that is the precedent worth having.**
      `PlaceSearchField`'s sheet header has a `Cancel` text button, which
      `Rides / Add starting location - Filled` (`1918:15967`) draws in `Accent (OLD)/100` —
      the same pairing at the same 3.00:1. It ships as `text-foreground` instead. The reason
      to break the tie this way rather than wait: this control is new, so nothing regresses,
      and a fifth instance would have made the eventual fix five edits instead of four. The
      **existing four are untouched** — changing those is the designer's call, not a
      side effect of an unrelated story.

- [ ] **A SECOND failing pairing arrived with the same commit and is a different one:
      `text-muted` on `bg-track`.** `#666666` on `#E5DACF` measures **4.17:1** against a 4.5:1
      bar, and both new instances are 12px — so neither is WCAG large text and neither passes.
      They are `ClubCreateRideRow`'s second line and the carousel's `Add` label; the same
      pairing already ships unlogged on `RideJournalEmpty`'s `Add`, and this entry's own
      unselected-RSVP-button line logs it at the same ratio. Recorded because the commit that
      added them re-counted the *accent* pairing carefully and said nothing about this one,
      which left this file asserting a complete contrast sweep it had not done.

      **A same-line grep finds one of the two, not both**, which is the trap worth recording:
      the carousel's `Add` label is a bare `text-xs font-semibold` span that **inherits**
      `text-muted` from the `Link` wrapping it, so the pairing is spread across two lines and
      only the row's own second line matches. List the token and read the sizes off the hits:

      ```bash
      grep -n "text-muted\|text-xs" src/components/clubs/ClubCreateRideRow.tsx \
        src/components/clubs/ClubPostcardCarousel.tsx
      ```

      `text-foreground` on `bg-track` is fine at **12.65:1** and is what the row's title uses;
      the failure is confined to the muted supporting lines. Same PD-176 designer question.

- [ ] **The section order and the Postcards section itself deviate further from the approved
      mock, 2026-08-18 (`club-details-dropdown-removal`, PD-262).** The product owner settled a
      new top-to-bottom order in conversation rather than in a redrawn frame: Upcoming rides,
      Postcards, Members, the `Private club · Started …` line, then the description — Upcoming
      rides moved to lead the screen (with a `Plan a ride` create affordance, `ClubCreateRideRow`,
      when the club has none and the viewer can create one), and Members and Postcards swapped
      from what an earlier revision of this same conversation had settled. **Postcards is a
      horizontally-scrolling strip of square tiles** (`ClubPostcardCarousel`), not the stacked
      `PostcardCard` list `AI / Club detail merged / 2026-08-17` draws and this section drew
      until today — modelled on the ride detail's `RideJournal`, whose own tiles are still
      unbuilt (PD-257), so this is the first *real* tile carousel in the app rather than a copy
      of an existing one. The trade is deliberate and product-owner-approved: a tile shows only
      the photo, not the byline, caption, likes or comment count `PostcardCard` drew in place —
      a rider taps through to the postcard's own thread for those. No frame draws this shape at
      all, so there is nothing in `design/` to diff it against; the geometry (112px tiles, 8px
      gap) is read off `RideJournalEmpty`'s own tokens rather than measured from Figma.

Blocked on schema, same as the ride detail: `formatRideTime` on `RideChip` renders one
instant because `rides` has no end-time column — see that entry rather than repeating it.

### Clubs list — built from the measurements 2026-08-05

Every geometry value was **read** from `v2 / Component / List / Club` (the 3-variant set,
`1918:7252`) and the four frames `Clubs - Your clubs`, `- No clubs`, `Clubs - Explore`,
`- No clubs`. What follows is what the design asks for and the schema has not got, plus the
deliberate deviations and one settled ambiguity.

- **The sub-page dropdown is gone, and the four v2 frames draw it.** `PD-258`, product owner
      2026-08-17: *"I want to stop using that top dropdown"* — the same objection `PD-254` acted
      on for the ride detail. So `Clubs - Your clubs` (`1914:6862`) and `Clubs - Explore`
      (`1918:9610`) are no longer built as drawn: no `subRow`, a 96px header instead of 120, an
      `Explore N clubs` strip between the header and the list, and `/clubs/explore` titled for
      itself with a back control. **`Clubs - Your clubs - No clubs` (`1918:9439`) is deliberately
      not built at all** — a rider with no clubs gets the explore list on the same route, so the
      empty state has no state left to occupy.

      The approved composition is its own Figma section, `AI / Clubs one screen / 2026-08-17`
      (`4166:7017`), built from this file's own `List / Club` instances and paint styles and
      sitting beside `PD-254`'s. Read that rather than the four originals; the originals are kept
      because the rows, the cards and every token on them are still what ships.

      **That section post-dates the last `figma:pull`, so it is not in `design/`** — `npm run
      figma -- tree "Clubs - One screen - Your clubs"` finds nothing until the snapshot is
      refreshed, and the geometry in `ExploreClubsStrip`'s docstring is therefore read from the
      live file rather than from the committed one. `PD-254`'s section is in the same state; the
      label is here so neither reads as measured-from-`design/` when it is not.

- [x] ~~**Which Explore design is canonical**~~ — **settled, and it is not the newer-looking
      one.** The flow holds two frames named `Clubs - Explore`: a `List / Club` row list
      (`1918:9610`) and a two-column grid of 175×190 tiles (`1918:10353`), the grid sitting
      further right, which reads as "later". Their epic covers decide it — `Explore clubs`
      is **Done**, `Explore clubs v2` is **On hold** — and the grid composes a local unnamed
      frame while the row list instances the published component. Built the row list. Same
      trap as the 🟠 sections: position and apparent freshness are not status.

- [x] ~~**The club cover image and the club avatar have no data behind them**~~ — **built by
      `016`, together with the Create club upload that fills them.** They landed as one change
      for the reason this entry originally gave: columns without an upload screen draw the
      identical empty container while planting the dead column `014` had to clean up.

      One thing worth carrying: the paths are keyed on the **uploader**, not the club —
      `club-avatars/<owner uid>/<uuid>.jpg`. A club-scoped folder reads better and cannot be
      written, because the object has to land before the club row exists. A CHECK ties the
      path back to `owner_id`, which is what a folder name alone could not.

- [ ] **The empty state cannot tell "no public clubs" from "you joined them all".** The
      design draws one string, `There are no public clubs, yet!`, and Explore excludes clubs
      the rider is in — so a rider who has joined every public club sees copy that says the
      opposite of the truth. Unreachable at two clubs, wrong at twelve. **A question for the
      designer**: a second empty string, or drop the exclusion and show joined clubs greyed.

- [x] ~~**What the red counter counts**~~ — **answered by the product owner: any activity.**
      New postcards plus new rides in that club since the rider's watermark (`015`).
      Comments are excluded — a comment has no audience of its own, and the club sub-pages
      the badge points at are Timeline and Rides.

- [x] ~~**Card composition**~~ — **measured.** 358×112, White/100, radius 8, padding left 4 /
      top 4 / **right 16** / bottom 4. Media block 96×104: image container 80 wide at x4,
      avatar 72 at x28 — they overlap by 56, which is the design, not a mistake. Content
      column from x108: name at y12 (Poppins/16/Semibold), type row at y36
      (24px `Lock 2` / `Globe 2` + Poppins/14/Medium Grey/80), riders at y70 (28px avatars
      overlapping by 4, then a 4 gap to `+N` at Poppins/12/Semibold). Trailing slot at x318.

- [x] ~~**The cover placeholder carried an icon**~~ — **removed after looking at the rendered
      page.** A `Clubs` glyph centred in the 80-wide container sits under the avatar, which
      starts at x24, so it rendered and could not be seen. `List / Ride` keeps its location
      pin only because nothing covers it. Second defect of this class this repo has found by
      opening the page rather than reading the diff.

- [x] ~~**The initials avatar was translucent**~~ — **fixed.** `Avatar`'s fallback is
      `bg-foreground/10`, which is fine over a card and shows the container straight through
      over this one. The design fills that frame `White/100`.

- [ ] **Ordering is invented.** Both sub-pages sort alphabetically. The design shows a list
      and specifies no order. Most-recent-activity would be better on Your clubs and is not
      cheap to read; flagged rather than guessed at.

### Rides list — built from the measurements 2026-08-04

Every geometry value on this screen was **read** from `v2 / Component / List / Ride` (the
5-variant set, `1908:3102`) and `v2 / Component / Filter Bar / Rides` (`1914:4791`), and the
four frames `Home - Rides - All / No rides / Your rides / No upcoming rides / Rides from club`.
Every *geometry* value is read. What is listed here is the design asking for **data the schema
has not got**, plus the deliberate deviations — and one **semantic** inference, the club chip,
which this section originally hid under a blanket "nothing about the layout is inferred". A
heading that claims nothing was guessed is exactly where a guess goes unnoticed.

- [x] ~~**Card composition**~~ — **measured.** 358×156 (128 without the club chip), White/100,
      radius 8, padding left 4 / top 4 / **right 16** / bottom 4, gap 16 (`npm run figma --
      show 1908:3102`; written out because the "4/4/4/16" shorthand this line used to carry
      put the 16 on the wrong edge). Image strip 80 wide at radius 4. Content column
      8-padded top and bottom, gap 4. Club chip `Grey/5` at radius 4, padding 8/3,
      Poppins/12/Semibold `Grey/80`. Avatars 28px overlapping by 4, organizer first inside a
      36px `Accent Brand/100` ring. Divider between date and time is a 3×3 dot.
      → `src/components/rides/RideCard.tsx`
- [x] ~~**The five variants**~~ — **measured.** They are the product of `is Upcoming` and
      `Are you going?`. `No` draws **no pill at all**; `Yes` is `Going` upcoming and **`Went`**
      past; `Maybe` keeps its label in both. Both are derived (departure time, and the viewer's
      `ride_members` row), so the component takes data rather than a variant name.
- [x] ~~**The 80×148 image strip has no data behind it.**~~ **Schema landed 2026-08-12**
      (`051`, PD-104): `rides` now carries `map_card_path` beside a coordinate, and the strip
      draws that tile with the `Location Filled` pin over it — the design's
      photo-carrying-a-pin, with the static map thumbnail decision #3 calls for as the photo.
      The pin gains a `White/100` disc **only** over a tile: bare `Grey/100` is 13.82:1 on the
      `Grey/10%` container — `#0000001A` is 10.196% black, which over the card's own opaque
      `bg-surface` composites to `#E5E5E5`, not the ~6% fill 15.3:1 would imply — and unknowable
      on an arbitrary map, and the disc makes it 17.4:1 whatever is behind it.

      **What has not landed is anything that writes the column**, so the honest state of the
      screen is unchanged: every ride in both databases has a NULL path and every card draws
      the container and the pin, exactly as before. The renderer is the Edge Function in
      `add-ride-map-tiles` §4, which is written-not-deployed work and needs an owner action
      (`8.3`). A tile that fails to load falls back to the same container, so the grey block
      stays the design's own no-tile state rather than becoming a broken image.
- [ ] **`10:00 - 15:00` is a range; the schema has one timestamp.** `rides.departure_at` has no
      `ends_at` beside it, so the card renders a single departure time. Adding an end time is a
      small migration and would complete the design as drawn.
- [ ] **The "All rides" tile's 2×2 collage has no ride photos to show.** *Chose:* the
      organizers' avatars — real data in the right shape. The design's own empty frame draws
      four `Grey/10%` quadrants, which is the fallback when there are no avatars either.
- [ ] **The filter bar draws a rider tile ("itchyboots") among the clubs.** It would mean
      "rides organised by that rider". **Not built** — the product owner specified three tiles
      for this screen: yours, all, and one per club. One question for the designer: is the
      rider tile intended here, or carried over from the Postcards bar it shares a component
      set with?
- [ ] **The `Maybe` pill is `#E58F17`, and it is an unnamed fill.** Every other colour in
      `globals.css` inherits a Figma paint style name; this one has none, so `--color-maybe` is
      ours. Worth asking whether it should join the palette properly.
- [ ] **Both RSVP pills fail WCAG AA, and this is a design question, not a bug to patch.**
      Measured, not estimated — an earlier revision of this file claimed 3.0:1 for the amber
      and excused it as "acceptable because the pill is 12/Semibold". Both halves were wrong:
      the real number is 2.54:1, and **12px semibold is not WCAG large text** (that is 24px, or
      18.66px bold), so the threshold is 4.5:1 rather than 3:1.

      | Pill | Fill | Label | Ratio | 4.5:1? |
      |---|---|---|---|---|
      | Maybe | `#E58F17` | White/100 | **2.54:1** | ✗ |
      | Going / Went | `Accent Brand/100` `#3D996B` | White/100 | **3.52:1** | ✗ |
      | Maybe, dark label | `#E58F17` | Grey/100 | 6.86:1 | ✓ |

      **The green one is the bigger finding**: `Accent Brand/100` with white text is used well
      beyond this screen, so it is a pre-existing palette issue that the rides list merely
      surfaced — not something this epic introduced. Two remedies, both the designer's call:
      swap the labels to `Grey/100` (keeps every fill exactly as drawn, and is why the third
      row is in the table), or darken the fills — white needs about `#A8630F` for the amber.
      Left as drawn in the meantime; a silent unilateral change to a design token is the thing
      decision #4 exists to prevent.
- [ ] **The chip above the title is rendered as the club name — a semantic inference.** The
      Figma layer is called `Organizer`, with component properties `Organizer#1908:9` and
      `has Organizer#2475:5`. The club reading is well supported: `Home - Rides - Rides from
      club` (`1908:1573`) drops the chip and the card shortens to 128, which only makes sense
      if the chip names the club the filter already names. But it is still an inference, and
      it has a live consequence — a ride with `club_id IS NULL`, the common case today,
      renders with no chip at all. Confirm with the designer whether the chip is the club or
      the organizing rider.
- [ ] **The counter is hidden at zero; the design draws `"0"`.** `Home - Rides - No rides`
      (`1914:6533`) gives the selected "All rides" tile a `0` badge. The shared `FilterTile`
      renders a badge only above zero, which is the behaviour the shipped postcards bar
      already had — kept consistent across the two bars rather than split. Registered because
      it is a deviation, not because it is obviously wrong.
- [ ] **Club tiles are derived from the rides in the window, not from membership.** That is
      what `Home - Rides - No rides` draws — no club tiles at all when there are no rides — but
      it means a club you belong to that has scheduled nothing has no tile. Consistent with
      the design; flagged because it is a rule nobody stated in words.
- [x] ~~**The list is upcoming-only, and ride history has no screen.**~~ **Closed 2026-08-19**
      — the product owner answered the question the design left open: a past section, on the
      list, under every filter. `getRides` returns two windows and `/rides` draws a
      **Previous rides** header between them, so the component set's `Went` variants are
      reachable at last.
      **Two deviations registered rather than hidden, both deliberate.** The four frames draw
      no such section at all, so the header is borrowed from `Private club - Rides`, which
      draws exactly this pair of `Section / Header` instances. And its wording is the owner's:
      they chose "Previous rides" over the design's "Past rides" — the v1 string, on
      OLD-stylesheet frames — and both screens use the one word rather than differing.
      The boundary is **midnight in `APP_TIME_ZONE`**, not the departure instant, which is a
      product rule the design does not speak to either: a ride at 15:00 is still today's ride
      at 23:00.
- [x] ~~**Timezone.**~~ **Fixed 2026-08-05** — see §Ride detail, where the same bug was found
      from a real device and fixed once for both screens. `RideCard` calls
      `formatRideDate`/`formatRideTime`, which are now pinned to `APP_TIME_ZONE`. The `en-US`
      half of this item resolved itself: `formatDate` and `formatDateTime` were **deleted**,
      having ended up with one caller between them, so the app no longer renders dates in two
      locales. `formatRelativeTime` keeps `en-US` deliberately — it emits English prose, not a
      date. What remains open is only the model, not the defect: wall-clock at the meeting
      point needs a zone column on `rides`.

### Ride detail — built from the measurements 2026-08-04

`/rides/detail` and `/rides/detail/crew`, from `Ride - Ride plan (Details)` (`2375:8771`),
`Ride - Ride plan - Sub pages` (`2375:9114`) and `Ride - Crew (Riders)` (`2375:9212`).

Every geometry value was read with `npm run figma -- show`, not estimated: banner 390×200,
club chip at y344, title 24/36 at y364, blurb clamped to 60px (exactly three 20px lines),
`Show more` link, two 64px rows with `Grey/10` hairlines inset to the text edge, map 358×160
radius 8 with its button inset 4px bottom-right, and the RSVP bar 390×96 with padding
16/16/8 and a 358×40 button group. What follows is the design asking for **data the schema
has not got**, plus deliberate deviations.

**The sub-page switcher is gone — 2026-08-17, PD-254.** The frames' four-way split is one screen
now, and the deviation below is the largest in this file: read it before treating any `2375:9114`
measurement as current.

- [ ] **The whole sub-page model is REPLACED, and the frames still draw it.**
      `Ride - Ride plan - Sub pages` (`2375:9114`) is a bottom sheet listing Ride plan, Journal and
      Crew, entered from a `Ride plan ⌄` control under the title. It is **deleted**. Crew is a rail
      on the ride plan that opens in place, Chat is a labelled row, Journal is a section, and the
      header is the plain 96px variant on the plan and crew screens. Why: a sheet hides its own
      options, which is exactly what the Chat row four bullets down was patched onto this sheet to
      work around, and the patch left the underlying screen unchanged. Approved by the product
      owner over seven revisions on 2026-08-17 and carried in Figma as
      `AI / Ride detail merged / 2026-08-17`; **that section, not `2375:9114`, is the current
      specification for this screen.** Consequences worth stating separately, because each is a
      drawn value this repo no longer builds:
  - [ ] The body's 24/36 title at y364 is **not drawn** — `RideHeader` already renders the title,
        and the frame predates the header having one.
  - [ ] The two 64px rows with their `Grey/10` hairlines are **two 20px lines**, and the date line
        carries a relative marker (`· in 6 days`) the frame has no equivalent for.
  - [ ] `Directions` on the meeting-point line is **not drawn on a past ride**, which the approved
        mock expresses by omission rather than by a rule.
  - [ ] The `Route` heading is gone; description and route render as one paragraph under the map.
  - [ ] **Three `text-accent` strings now sit on this one screen, and green-on-cream fails AA.**
        `#3D996B` on `--color-background` `#F2ECE6` measures **3.00:1** against a 4.5:1 bar, and
        **1.84:1** against the background gradient's far end `#CCB8A3`. Not a regression — the
        `See who's riding` link this screen replaced was the same pairing at the same ratio, and
        12px vs 14px does not change the threshold since neither is WCAG large text — but it went
        from one instance to three (`Directions`, `See all`, and the rail's error fallback). It is
        **not** among the four failures already logged elsewhere in this file, so it is recorded
        here and raised on PD-176 as a designer question rather than fixed silently: darkening to
        `accent-strong` `#338059` still only reaches **4.10:1** — the same ratio already logged as
        a failure for the ride-host label, which is that token — so this needs a palette answer
        rather than a nudge.
- [ ] **Journal is drawn, and as of 2026-08-17 only its EMPTY STATE is built.**
      `Ride - Journal (Postcards/Timeline)` (`2226:4865`) is postcards attached to a ride.
      `041` added `postcards.ride_id` and settled the audience question this entry used to say was
      open — the tag is not a second audience — but **nothing writes the column**, so every
      journal is empty and the section renders the approved mock's `Nothing yet · Prep shots
      count` tile beside `Add`, crew only. That is a deliberate reversal of the old entry's
      "omitted rather than offered as a dead row": a section nobody has seen is a feature nobody
      knows exists, and empty is the state every ride starts in. **`Add` posts a postcard and does
      not yet tag it to the ride** (PD-256), so a photo added from here does not appear in the
      journal it was added from. The tiles, the sequence line and the journal route are PD-257's.
- [x] **Chat is built — 2026-08-07** (`034`, Linear PD-115). `Ride - Chat` (`2226:4999`) and
      `Ride - Chat - Text focus` (`2242:11086`) at `/rides/detail/chat`. **It did not need the
      Inbox epic**, which this entry asserted: a per-ride chat needs a ride and a crew, both of
      which existed. Every sub-item below is a deviation, and each is a decision rather than a
      miss. **Count them rather than read a number here** — this line said "Five" while the list
      held eight, and was then edited to "Six" while it held nine, which is CLAUDE.md's
      hand-typed-count trap inside the file that logs traps:
      `sed -n '/Chat is built/,/^- \[/p' docs/FIGMA-FIDELITY-TODO.md | grep -c '^  - \['`
      (9 today. Note both anchors: an unanchored range end matches prose mid-paragraph and
      returns 0, and ending at `^### ` instead of `^- \[` counts every other bullet's
      sub-items in §Ride detail too — it happens to agree today, which is the worse failure.)
  - [ ] **A `Chat` row was ADDED to the sub-page switcher, which the design does not list
        there.** `Ride - Ride plan - Sub pages` (`2375:9114`) draws exactly three rows — Ride
        plan, Journal, Crew — and puts chat in the header's action row as a bare 24×24 chat
        bubble instead. Built as drawn on 2026-08-07, and **measured against a real rider the
        same day: the product owner, organizer and `going` on all five rides in the database,
        could not reach the chat at all and opened this sheet looking for it.** So the icon
        stays (it is drawn, and it is one tap) and a labelled row is added beside it, gated on
        the same crew predicate so the two entry points cannot disagree. **A question for the
        designer**: an unlabelled icon is the design's only route to a whole screen, and it did
        not survive first contact. **The sheet this row was added to no longer exists (PD-254) and
        the row does** — it is on the ride plan itself now, on the same predicate. The deviation is
        therefore unchanged in substance and larger in kind: the design's own route to the chat is
        still one unlabelled icon, and this app still draws a labelled row beside it.
  - [ ] **A day separator was ADDED that the design does not draw.** Every bubble carries
        `HH:mm` and nothing else, which is unambiguous for the single-day conversation the
        frame mocks and silently wrong for a ride planned three weeks out — "08:18" on a
        message from last Tuesday reads as this morning. `formatRideMessageDay` draws `TODAY` /
        `YESTERDAY` / `SAT, 16 NOV`, uppercased to match `formatRideDate`. **A question for the
        designer**, and the one thing here that is an addition rather than an omission.
  - [ ] **The bubble tail is not drawn.** Each `Text Balloon` carries an 8×12 `Corner` vector.
        Reproducing it needs an SVG per bubble per side, and at 8px it reads as a rounding
        artifact. Dropped deliberately.
  - [ ] **Per-rider author-name colours are not drawn, and this one is a designer question.**
        The frame gives each rider their own **untokenised** fill — `Pedro Abreu` is `#CC4429`,
        `Julia Windfield` is `#1A804D` — which is a group-chat name-colouring feature rather
        than a stray. Built in `Grey/100` instead, because `#CC4429` on `Grey/10` measures
        **3.45:1** and fails AA at 14px semibold, so building it as drawn would ship an
        unreadable name. Needs either an accessible palette or a decision to drop it.
  - [ ] **The reply bar is 72px and 60px, not the drawn 80 and 56.** The design's flat 8px
        bottom padding is replaced by `.pb-safe` (floor `0.75rem`, the real inset on a notched
        device) because this screen hides the nav bar, so the composer sits at the true bottom
        of the viewport and owes the home-indicator inset `Navbar` would otherwise have paid.
        The 20px→8px top padding change on focus IS reproduced.
  - [ ] **Others' bubble timestamps read `Grey/100`, and the frame's raw value is `#000000`.**
        Recorded because the *first* build used `Grey/80` from a tree dump — which prints the
        style name, not the literal fill — and that pairing is 4.17:1 on `Grey/10`, an AA
        failure this screen would have *added*. `design/frames/rides-view-ride-ride-chat.json`
        shows no fill style attached at all on those nodes. Read the frame JSON for a colour,
        not `npm run figma -- tree`.
  - [ ] **The `Warning/100` unread dot on the chat button is not drawn.** There is no unread
        model — Linear PD-120 extends `015`'s watermark — and a badge that is always absent is
        indistinguishable from one that is broken.
  - [ ] **`Ride - Chat - Options` (`2370:7346`) is not built at all**, so the chat header has no
        Options button. Its sheet is exactly two rows, `Pin chat` and `Mute chat`, and neither
        means anything yet: pin orders a chat list that does not exist since PD-100 removed the
        Inbox tab, and mute suppresses notifications that do not exist. Linear PD-121.
  - [ ] **The chat button is shown to the crew only**, which is narrower than the frames draw —
        a mock has no viewer, so it shows one header for everybody. `034` gives the chat to the
        crew, so a rider who has not RSVP'd would tap through to a screen that can only tell
        them to join.

      Reproduced faithfully and worth recording because they are easy to get backwards: the
      **sender's** bubble is `Grey/100` with `White/100` text and everyone else's is `Grey/10`
      with `Grey/100` — the opposite way round from several popular messaging apps. The author
      name is `Poppins/14/Semibold` on other riders' bubbles only and only on the first of a
      run; the time is `Poppins/12/Medium` inside every bubble, `White/50%` on your own. The
      reply bar collapses on focus with the field going `Grey/5` → `White/100` (heights above).
      **The frame draws no navigation bar** (120 + 644 + 80 = 844), so `Navbar` returns null on
      this route — note that is *replacing* the bar, where `RideAttendanceBar` on the ride plan
      *stacks on top of* it. Which of the two a screen does is a per-screen fact the design
      states, not a rule about bars.
- [ ] **The header's Options button is omitted, and this one is a question, not a task.**
      The flow never draws what the sheet contains. Ride overflow is presumably
      edit / cancel / leave, and "No edit or delete UI anywhere" is a standing known issue —
      inventing three rows for a destructive menu is the kind of guess that gets trusted
      later. **Ask the designer what belongs in it.**
- [ ] **Crew's sticky "Bring a rider" action is omitted.** Inviting is its own flow
      (`Invite riders`, `Invite riders - Filled`) with no schema behind it.

Blocked on schema, in the same shape as the rides list's image strip:

- [ ] **The 390×200 banner has no image column.** Unlike the map it carries no affordance at
      all, so it is omitted entirely rather than rendered as a 200px grey slab — an empty
      fifth of the screen above the fold is worse than a shorter page. *Chose:* omit. Still
      needs a migration + Storage work of its own: `051` gave `rides` map tiles, not a rider's
      own photo of the ride, so the entry below resolved without resolving this one.
- [x] ~~**The map tile has no coordinates.**~~ **Schema landed 2026-08-12** (`051`, PD-104):
      `rides` carries `latitude`, `longitude` and `map_detail_path`, and over a tile the panel
      draws **what the Figma draws** — the map and the `Get directions` chip, and nothing else.
      Decision #3 is a static thumbnail *plus* a deeplink, and the whole 358×160 stays the
      anchor, which was the iPad fix recorded below.

      *Chose:* **no address and no pin over the tile.** Product owner, 2026-08-12. An earlier
      version of this entry chose the opposite — `bg-scrim` (`Grey/70%`) between tile and text
      with the address and pin in `White/100` — and the reasoning was correct as far as it went:
      Grey/100 is 12.65:1 on `bg-track` only because that fill is known, so text over an
      arbitrary map does need a bounded composite. **The error was upstream of the contrast
      question.** The address did not need to be over the tile at all: the Figma panel carries
      neither it nor the pin, and the page already renders `meeting_point` in the `DetailRow`
      immediately above the panel. So a full-panel 70% scrim was darkening the whole map to hold
      a **duplicate of the line directly above it** legible.

      The pin and address are now the **no-tile** rendering exclusively, and that rendering is
      unchanged. `bg-scrim` survives as a small pill behind `Powered by Geoapify`, the only text
      still over unknown imagery — **8.59:1 at worst**, over a `#4C4C4C` composite. *(The
      `#4D4D4D`/8.0:1 pair this entry used to state was wrong in both halves and had spread to
      three files; `--color-scrim` is `#000000B3`, 70.196% black, so the composite over white is
      `#4C4C4C`.)*

      **Nothing writes the column yet**, so the panel renders today exactly what it rendered
      before — the address, legibly, and one tap that opens directions. The renderer is
      `add-ride-map-tiles` §4 and needs an owner action to deploy (`8.3`).

      **Do not** substitute an `output=embed` iframe if this is ever revisited: it is an
      interactive map where decision #3 specifies a static thumbnail, it swallows touch
      gestures inside a scrolling page, and Safari's tracking prevention blanks third-party
      frames — which would reproduce the exact bug reported below.
- [x] ~~**The map panel read as blank, and its link only dropped a pin.**~~ **Fixed
      2026-08-05**, all three reported from a real iPad:
      **(a)** the fill was `bg-border/40`, which compiles to `#0000000a` — 4% black,
      `#e9e3dd` over the cream background, **1.09:1 against the page itself**. It was blank
      on every device; the iPad is just where someone noticed. Now the opaque `Grey/10`
      (`bg-track`) this screen already uses elsewhere, at 1.17:1 — still a quiet surface, so
      what actually makes the panel read is the address inside it at 12.65:1.

      *Worth recording how this one nearly shipped wrong:* the first version of the fix
      blamed Safari's `color-mix()` support, since Tailwind v4 compiles opacity modifiers to
      `color-mix(in oklab, …)`. Checking the built CSS instead of asserting it showed the
      production output emits a static `#0000000a` **outside** the `@supports` guard, so a
      browser without `color-mix()` still gets the fill and the bug was never
      browser-specific. Same lesson as the contrast ratios above, in a new costume: the
      plausible mechanism and the real one were different, and only the build output knew.
      **(b)** the link was `maps/search/?api=1&query=`, which highlights a location and stops;
      it is now `maps/dir/?api=1&destination=…&travelmode=driving`, which routes from wherever
      the rider is. **(c)** only the 100×20 chip was tappable though the whole 358×160 panel
      looked like the target — the panel is the link now. `googleMapsDirectionsUrl` is in
      `lib/utils.ts` with tests, including that an `&` in an address cannot truncate the query.
- [ ] **`14:00 - 18:00` is a range; the schema has one timestamp.** Same `ends_at` gap the
      rides list logged. The detail row renders a single departure time.
- [ ] **The location row draws a place name over a street address.** `meeting_point` is one
      free-text column, so the primary line carries it and the secondary stays empty. Two
      columns, or a parse nobody should write.
- [ ] **`max_riders` is not enforced anywhere.** The column has existed since `001` and
      nothing has ever checked it — not the RSVP action, not a policy, not a trigger — so a
      ride can be over-subscribed. Out of scope here because the ride plan does not draw
      capacity at all, and because the correct fix is a constraint the database owns rather
      than a check-then-insert that races.

Accessibility — **measured, and both fail**. This is the same palette-wide problem the rides
list surfaced with its two RSVP pills, arriving on a second screen:

| Element | Fill | Label | Ratio | 4.5:1? |
|---|---|---|---|---|
| "Ride host" on a crew row | `Grey/5` `#F2ECE6` | `Accent Brand/110` `#338059` | **4.10:1** | ✗ |
| Unselected RSVP button | `Grey/10` `#E5DACF` | `Grey/80` `#666666` | **4.17:1** | ✗ |
| "Ride host", dark label | `Grey/5` | `Grey/100` `#1A1A1A` | 14.85:1 | ✓ |
| Unselected RSVP, dark label | `Grey/10` | `Grey/100` `#1A1A1A` | 12.65:1 | ✓ |

Neither label is WCAG large text (12px medium and 14px medium; large is 24px, or 18.66px
bold), so 4.5:1 is the bar in both rows. Both are **left exactly as drawn** — the fills and
type colours are the designer's, and a silent unilateral change to a token is what decision
#4 exists to prevent. The cheap remedy in both cases is the dark label, which keeps every
fill; darkening `Accent Brand/110` to about `#2A6B49` reaches 5.43:1 if the green is wanted.
Against the app background's far end (`#CCB8A3`) the two measure 2.50:1 and 2.99:1, so the
gradient makes both worse further down the page — that is a pre-existing app-wide issue,
not this screen's.

Deviations that are ours, not the design's:

- [x] ~~**Dates on this screen are `en-GB`; `formatDate`/`formatDateTime` are still `en-US`.**~~
      **Resolved 2026-08-05, by deletion.** The design draws `Saturday, 12 Nov` and `14:00`,
      which `en-US` cannot produce. The two `en-US` functions were left alone at the time
      because changing them would have restyled every date on the postcards feed — but the
      timezone fix showed `formatDateTime` had **one** caller and `formatDate` none, and that
      one caller was a ride time that should have used the ride helpers anyway. Removing them
      cost nothing and ended the two-locale split; the feed was never affected, because
      `formatPostcardDate` was always separate. The "one locale constant" fix this item asked
      for turned out to be unnecessary — there was no second locale worth keeping.
- [x] ~~**Times render in the server's timezone.**~~ **Fixed 2026-08-05.** A ride departing
      20:00 in Amsterdam was drawn as `18:00` — UTC, because Vercel runs UTC and the three
      `formatRide*` helpers run in server components. `APP_TIME_ZONE` in `lib/utils.ts` now
      pins them to `Europe/Amsterdam`. The unit tests had missed it because
      `vitest.config.ts` pins `TZ=UTC`, so the environment asserting the behaviour was the
      one hiding the bug; the new assertions check the CET *and* CEST offsets and that the
      date rolls with the clock, none of which UTC formatting can fake.

      **The client-render migration did not make the pin unnecessary — do not remove it.**
      The helpers no longer run in server components, but Next still server-renders them on
      first load, so an unpinned formatter would put Vercel's UTC in the HTML and the rider's
      zone on hydration. Same bug, now wearing a hydration mismatch.

      **Still open, and it is the interesting half:** a fixed zone is right for the current
      user base and wrong in principle. The correct model is wall-clock **at the meeting
      point** — a ride in Lisbon reads 10:00 to everyone, wherever they look from — which
      needs a zone column on `rides` beside the timestamp. The viewer's own zone was
      rejected rather than overlooked: it renders a different string on server and client,
      which is a hydration mismatch on every ride card. Deleting `APP_TIME_ZONE` is a
      one-line change once the column exists.
- [ ] **`ListUser` renders both avatars at 40px** where the design draws the host at 40 and
      everyone else at 36. A 4px difference on one row of a roster reads as a rendering bug
      rather than as emphasis, so the rows share a left edge instead.
- [x] ~~**`text-xl` and `text-2xl` rendered Tailwind's stock line heights.**~~ **Fixed
      2026-08-04**, and it was never a ride-detail problem: neither size was in the `@theme`
      scale, so `text-xl` rendered 20/28 and `text-2xl` 24/32 against a design asking for
      20/30 and 24/36 — on every screen using them, since before this epic. `Poppins/20/*` is
      used 167 times in the file and `Poppins/24/Semibold` 49, so both are now tokens. Found
      by `reviewer` catching a comment that claimed "24/36, measured" over a `text-2xl` that
      was not.
- [ ] **The crew list is bounded at 200 and does not paginate.** `RIDE_CREW_LIMIT` exists
      because nothing caps `ride_members` — see `max_riders` above — not because 200 is a
      real crew. Beyond it the roster truncates silently. The design has no pagination for
      this list, so the honest fix needs a design before it needs code.

### Profile — built from the measurements 2026-08-05

`/profile`, from `Profile / View your profile / Profile` (`1883:12248`), with its options
sheet read from `Profile / Delete account / Account options` (`2303:8097`). Replaces the v1
screen entirely — `zinc-*`, `orange-*`, `lucide-react`, and a client component that wrote to
`profiles` with no validation.

Measured, not estimated: avatar 128×128 holding a 120px image (so a 4px ring, and it is
`White/100` here where every other avatar in the library carries 2px `Grey/20%`), location at
Poppins/14/Medium, the name at Poppins/24/Semibold, and the bio clamped to 60px against a
20px line height — three lines, the same clamp the ride blurb uses, which is why that control
is now `ui/ExpandableText` rather than two copies.

**The name is the username.** Decision #7. The design's "Pedro Abreu" is a `full_name` that
`003` dropped, so it renders as `@username` everywhere a person is named.

**Four whole sections are drawn and not built.** Each needs its own table, and none is a
styling task:

- [ ] **Badges** (`7/42`, a horizontal scroller of 200×144 tiles with 72px medallions). No
      table, and the *interesting* half is not the table — it is what earns a badge, which is
      a rules engine nothing in this app has.
- [x] ~~**Countries** (`22/195`, rows of 32×24 flags).~~ **Built 2026-08-05 (`014`).** The
      open question — manual or derived from rides — was **answered by the product owner:
      manual.** Worth recording that the derived reading was not merely unbuilt but
      currently unbuildable: `rides` has no country and, when that was written, no
      coordinates either — only a free-text `meeting_point`. **`051` added
      `latitude`/`longitude`** (see the resolved entry above), so the derived reading is
      no longer blocked on coordinates; it is still blocked on a country, and the
      owner's answer stands regardless.

      Two deviations, both ours:

      **Flags are emoji, not SVG assets.** `NL` → `🇳🇱` is two regional-indicator code
      points computed from the code, so ~40 flag assets and a sprite pipeline become one
      arithmetic function. The cost is real and stated rather than buried: **Windows renders
      the two letters instead of a flag.** For a mobile-first app whose riders are on iOS and
      Android that costs nothing on the screens that matter, and swapping in real assets
      later touches `lib/countries.ts` and nothing else.

      **The picker is invented.** The design shows the *result* and no way to change it —
      every profile frame in the file is a view. A search field over the ISO list is ours.

      **The denominator is not 195.** The design's `22/195` counts UN member states; the
      picker offers the full ISO 3166-1 set (~250, including territories). The number shown
      is the list's own length, because a denominator smaller than what can be selected would
      let a rider reach `200/195`.
- [ ] **Motorcycles** (256×276 cards with years, mileage, and their own like/comment/share
      counts). This is the Garage epic. `bike_model` is **one text column**, not an
      implementation of it — the page renders it as the single fact it is rather than dressing
      it as this section.
- [ ] **Gear** (390×360). Same shape as Motorcycles and blocked the same way.

*Chose:* omit all four rather than render empty section headers reading `0/42`. An empty
header states a fact about the rider ("you have earned nothing") where the truth is a fact
about the app ("this does not exist yet"), and the first one is worse.

Blocked on schema, same shape as the ride detail's banner:

- [x] ~~**The 390×200 cover image has no column.**~~ **Built 2026-08-05 (`014`).**
      `profiles.cover_image_path`, a Storage path under `covers/<uid>/`. It is drawn now
      because it has *both* halves the ride banner still lacks — a column and an affordance:
      the empty state is a tappable "Add a cover photo", not dead space. The ride banner
      stays omitted for exactly that reason.
- [x] ~~**Avatar upload is not built.**~~ **Built 2026-08-05 (`014`).**
      `profiles.avatar_path` under `avatars/<uid>/`, compressed to 512px in the browser
      (which strips EXIF) and uploaded straight to Storage. `avatar_url` was kept as a
      fallback by `014`; `024` drops it, and `resolveAvatarUrls` no longer falls back —
      the field now only ever holds the signed URL that function writes.

      The signing fan-out is the part worth knowing about: **nine components render an
      avatar and all nine read `avatar_url`**, so `resolveAvatarUrls` writes the signed URL
      *into that field* rather than adding a second one. **Nine call sites**, counted with
      `git grep -c "await resolveAvatarUrls(" -- src/` rather than by hand — the first draft
      of this line said "five", and the two it overlooked (`collageAvatars` on the rides
      filter bar, and the v1 club page) were precisely the two that had been left unsigned.
      Miss one and avatars fall back to initials on that screen alone, which reads as a
      design choice rather than a bug.
- [ ] **Renaming is not built.** `username` is deliberately absent from `profileEditSchema`.
      It is unique, reserved-word checked, and is every rider's identity across postcards,
      crews and member lists, so changing it is a flow with a conflict path rather than a
      field on a form. Onboarding owns it today.
- [ ] **`bio` and `bike_model` have no CHECK constraints.** `001` declares both as bare
      `text`. The 500/60 limits live in `profileEditSchema` and are enforced by the action
      that parses `FormData` — but a direct PostgREST call with a 10 MB bio would be accepted,
      because RLS grants the write and no constraint bounds it. Unlike `username`, whose rules
      are enforced twice. Worth a migration if it ever matters; stated rather than implied.
- [ ] **Delete account is drawn and half built.** `Account options` has **three** rows —
      `Preferences`, `Sign out` and `Delete account` — and `Confirm account deletion`
      (`2303:9370`) draws the confirmation. This entry said "exactly two rows" until
      2026-08-06; so did `ProfileMenu.tsx`, which also claimed to have read it from the frame.
      Both were wrong. Re-derive rather than trust either:
      `npm run figma -- tree "Profile / Delete account / Account options" --all` — none of the
      three list items is hidden.

      What now exists: `029` transfers a departing rider's clubs instead of cascading them
      (which would destroy other riders' postcards), `030` versions the consent record, `031`
      makes the transfer callable, and `supabase/functions/delete-account/` holds the Edge
      Function that owns the auth delete. **The function is deployed to both projects and
      `ACTIVE` (2026-08-11)**, but nothing in `src/` calls it yet — so
      `openspec/changes/add-account-deletion/` group 3 is the flow
      itself, and group 4 the four screens where "gone" and "forbidden" currently look
      identical. `Preferences` is still undesigned as a destination and is a separate question.

Deviations that are ours, not the design's:

- [ ] **The design has no edit screen at all.** `View your profile` draws the profile;
      `Login / Onboarding` draws the fields being filled in for the *first* time; nothing
      draws changing them afterwards. So the edit form's placement — under the profile, on the
      same route — is invented. It is the smallest guess available (the fields and their
      validation already exist), but it is a guess, and a designed settings screen may well
      move it.
- [ ] **The nav bar in this frame shows three tabs**: Home, Clubs, Profile. Rides and Inbox are
      absent. Counted across frames rather than assumed — `Home - Postcards - All new` draws
      **5** tiles, this frame **3**, and `Rides - All rides` **0** (it has no bar at all). A
      value that takes three different shapes in three frames is not a spec, so this stays an
      outlier to confirm with the designer rather than a change to make: if the three are
      deliberate it is a navigation change, not a profile one.

      **The old reasoning here was "the built five-tab `Navbar` stands", and that no longer
      resolves anything** — Inbox was removed on 2026-08-07 (PD-100), so the built nav is
      **four** and now matches *none* of the three frames. The conclusion survives, its
      premise does not: don't chase the 3-tab frame because a contradicted value is not a
      spec, not because the code agrees with the majority frame. It doesn't.
- [ ] **The timeline is unpaginated.** It reuses `getFeed`'s rider filter, so it is bounded at
      `FEED_PAGE_SIZE` (30) — a rider with more postcards than that silently sees their 30
      newest. The design draws no pagination for this list, so the honest fix needs a design
      before it needs code. Same trade as the crew roster's 200.

### View someone else's profile — built 2026-08-14

`/profile/detail?id=<uuid>`, from `Profile / View someone else's profile / Profile - Prescoll
header` (`2084:9006`) — `openspec/changes/view-rider-profile/`. Reached from a postcard byline
today (`PostcardCard`); the other four reach paths (comments, ride crew, club rosters, chat) are
a deliberate follow-up, not this change.

**Three things the frame draws and this does not render, per the proposal's spec rather than by
omission:**

- [ ] **Follow, and the followers count.** `013` dropped `friendships` on 2026-08-04 — there is
      no follower graph in this app, manual or derived, and this frame is exactly the "prose that
      still names it" CLAUDE.md warns a dropped table returns through. No table, column or action
      implementing it exists, and none should be added without reopening that decision.
- [ ] **The motorcycles count and the Timeline/Garage switcher.** Same gap `/profile` already
      logs above: the Garage epic is unbuilt, `bike_model` is one text column standing in for it,
      and there is nothing here for a switcher to switch to.

**The header composition is the shipped `/profile`'s, not the isolated frame's.** The frame
floats a back button and an Options control over a 200px banner with the avatar overlapping it;
`/profile` already deviates from that shape (a standard fixed `Header` bar, then a banner that
scrolls with the content) and this screen matches that shipped precedent instead of inventing a
second header composition nothing else in the app uses.

**Countries render as the own-profile screen's "Countries" section, not the frame's single flag
beside the name.** `profile_countries` is a list, the frame's "Name + Country" slot holds exactly
one flag instance, and `/profile` itself already draws the plural read as a section below the
bio rather than inline with the name — this screen reuses that treatment read-only (`CountryFlags`,
extracted out of `ProfileCountries` so the editor and the viewer draw one markup rather than two
that can drift), per design.md Q1's "if the own-profile screen's treatment transfers cleanly".

**No stats row at all** — design.md Q2. Followers and motorcycles are unbuildable and a lone
postcards count in a three-slot row reads as broken layout; `/profile` already omits its own
Badges count for the same reason.

**Options is block only** — design.md Q3, reusing `blockRider` rather than a second write path.
No report row: `009`/`011` build reporting for a postcard, and there is no analogue of it for a
rider's identity in this change.


### Create postcard

- [x] ~~**Photo picker composition**~~ — **measured, 2026-08-08 (PD-112).**
      `v2 / Component / Input / Image` (`1918:17004`) is one box, `State=Empty` /
      `State=Filled`, with no separate button beside it — `Empty` holds `Element / Icon /
      Image` at 24×24 above the label "Add photo" (`Poppins/12/Regular`); `Filled` is the same
      box with the photo as its fill. The standalone "Choose a photo" button was removed and
      the box itself (both states) now opens the picker, matching that.
- [ ] **The composer's own frame is readable, and the earlier claim that "the component set
      only covers the box, not the composer frame" was wrong — corrected 2026-08-08 after
      `reviewer` found it.** `Home / Create postcard` → `Home - Postcards - All new`
      [`1918:16843`] (390×844,
      `design/frames/home-create-postcard-home-postcards-all-new.json`) was missed on the
      first pass only because this exact screen name repeats across six frames total, two of
      them inside this same flow — `CLAUDE.md` §Development Workflow's screen-name trap;
      qualify with the flow to find it. It is one screen, no crop step: the photo box (358×224,
      radius 8, `White/100`, 1px solid `Grey/20%` stroke, "Add photo" as an
      `Accent Brand/100` 14/Semibold link button — see the deviation below) is followed by
      a `Club` field, then `What's on your mind?`, with `Post` a small primary button in the
      header beside `Cancel` rather than inline at the bottom. Order, header-button placement,
      and both field labels ("Club" / "What's on your mind?" vs. the shipped "Who can see
      this" / "Caption") all differ from what ships. **Filed as separate follow-up — not
      changed by this fix**, which only touches the box's own tap behaviour and focus/retry
      handling.

      The other frame sharing this name, [`1918:17056`]
      (`design/frames/home-create-postcard-home-postcards-all-new-2.json`), is a rougher
      variant, not a second source for the measurements above: same 390×844 canvas and
      `Cancel` placement, but **no `Club` field at all**, the placeholder `"What's up?"`
      instead of a labelled field, and `Post` drawn in its **disabled** variant. Not cited for
      anything above.
- [ ] **The whole box is the tap target; the frame only shows a small button inside it —
      found 2026-08-08.** The frame's tappable element is `1918:17042`
      (`v2 / Component / Button / Link / Primary`, "Add photo"), 75×32, sitting inside the
      358×224 box — not the box itself. The named `v2 / Component / Input / Image` set draws
      no Filled-state control either: `1918:17013` / `1918:17014` (`State=Filled`) have no
      children at all, just the photo as the fill. Making the whole box tappable is ours —
      defensible on the 44px glove-target floor, and the owner asked for it — but it is a
      deviation, not a measured match, and belongs here rather than only in the docstring.
- [ ] **Photo box styling deviates from the frame on six counts — found 2026-08-08,
      deliberately not adopted.** Same status as §Rides list's RSVP-pill contrast finding: a
      design question on record, not a bug to silently patch. The frame's box is a 358×224
      landscape rectangle (~1.6:1) at radius 8, 1px solid `Grey/20%`, with a `Grey/60` icon and
      "Add photo" set as an `Accent Brand/100` 14/Semibold link button. The shipped box
      (`aspect-4/5`, `rounded-xl`, `border-2 border-dashed border-border-strong`, icon and
      label both `text-muted` via `currentColor`, label `text-xs`) deviates on all six, and
      none are adopted here:
      - **Aspect ratio** — `aspect-4/5` (0.8:1, portrait) vs. the frame's ~1.6:1 landscape box.
        PD-112 specified `aspect-4/5` directly; silently reversing an explicit instruction
        would be worse than logging the gap.
      - **Radius** — `rounded-xl` (12px) vs. the frame's 8px (`rounded-lg`). No product reason
        is on record for the difference; logged rather than guessed at.
      - **Stroke** — `border-2 border-dashed` vs. the frame's 1px solid. The colour already
        matches (`border-border-strong` **is** `Grey/20%`); only weight and dash differ.
      - **Icon colour** — `Grey/80` (via `currentColor`) vs. the frame's `Grey/60`. `CLAUDE.md`
        §Design System already flags `Grey/60` as "near-unused; may be a stray", which is
        reason enough not to chase it.
      - **Label size and weight** — `text-xs` (12px, regular) vs. the frame's 14/Semibold.
        Untouched for the same reason as the colour below.
      - **Label colour** — `text-xs text-muted` (`Grey/80`) vs. the frame's `Accent Brand/100`
        14/Semibold link style. Kept on purpose: the frame's green measures **3.52:1** on
        `White/100`, under the 4.5:1 bar for 14px text, while `text-muted` measures **5.74:1**.
        Adopting the design's colour here would trade a passing label for a failing one.
- [ ] **Upload progress** — *chose:* a 6px `Accent Brand/100` bar plus "Uploading… N%".
      Unread entirely.
- [ ] **Failure states** — *chose:* upload failure inline under the picker; the insert's own
      error above the submit button. Unread.
- [ ] **Audience selector** — *chose:* a native `<select>` styled like `Input / Text`,
      defaulting to "Everyone on LetsRide" (the app-wide feed, `club_id` null). Unread:
      whether the design uses a sheet, chips, or a select.
- [ ] **Caption field** — *chose:* a `Textarea` primitive copying `Input / Text`'s verified
      box treatment, 4 rows, counter only within 100 characters of the limit. There is no
      textarea component in the read set. → `src/components/ui/Textarea.tsx`
- [ ] **Known leak, not a design question:** picking a second photo orphans the first upload
      in Storage. `createPostcard` cleans up only when the *insert* fails, and Storage has no
      cross-system cascade. Costs storage, never correctness.
      Sweep them with `npm run storage:sweep` (dry run) then `-- --delete`. It signs in as
      the rider and works through the Storage API, because `delete from storage.objects` is
      refused by Supabase's own guard — the row is metadata and deleting it alone would
      strand the bytes. No service-role key: 010 already grants each rider DELETE on their
      own folder, so the blast radius is a property of the policy rather than of the script.

### Comments — built 2026-08-04, every composition value inferred

The probe that morning read **429 with 2d 4h left** on `/v1/files/*` and `/v1/images`, clearing
around **2026-08-06T12:32Z** — so the thread screen was built the same way the feed was, and
the register below is what that cost. The *behaviour* is not a guess: `011` owns who may read,
write and delete a comment, and the UI adds no rule of its own.

- [ ] **Where a thread lives** — *chose:* a dedicated route, `/postcards/detail`, holding the
      card and its comments; the feed card carries a comment control that links to it. The
      alternative — comments inline on the feed card, with a "view all N" expander — is what
      several photo feeds do, and it is unread which one this design uses. Two things pushed
      this way: `addComment` has revalidated `/postcards/${postcardId}` since `011` shipped,
      before any route answered to that path, and `getPostcard()` existed unused. Inline
      expansion would also have meant inventing a truncation rule, which is the same trap the
      caption clamp is being avoided for.
      → `src/app/(app)/postcards/detail/page.tsx`
- [ ] **Comment affordance on the card** — *chose:* a **text-labelled** link ("Comment" /
      "Comments N") sitting beside the like control in one row below the image. The design
      uses `Element / Icon / Chat Bubble`, which cannot be exported while the render endpoint
      is 429; per the icon rule, no `lucide-react` lookalike was substituted. Swapping the
      icon in touches only `CommentsLink.tsx`. Unread: whether the count sits beside the label
      or under the image as "View all 12 comments".
- [ ] **Thread composition** — *chose:* comments **oldest first** (which `getPostcardComments`
      already ordered for, and which its own comment argues for), avatar `sm` (32px) + username
      Semibold 14 + relative timestamp on one line, body beneath, `gap-5` between comments,
      the whole thread in a bordered `bg-surface` panel under the card. Unread: all of it.
- [ ] **Composer** — *chose:* a `Textarea` (3 rows) labelled "Add a comment" with a full-width
      "Post comment" button under it, pinned to the **bottom of the thread** rather than
      floating above the keyboard. A sticky composer is what a phone-first design usually
      draws and is the most likely correction here. Unread: placement, whether it is a single
      line that grows, and whether the avatar of the signed-in rider appears beside it.
      → `src/components/postcards/CommentForm.tsx`
- [ ] **Delete affordance** — *chose:* a text "Delete" under the rider's own comment, which
      arms an inline "Confirm delete" / "Cancel" pair. Editing is deliberately impossible
      (`011` has no UPDATE policy and no UPDATE grant), so deleting is the only way to take
      words back and it is irreversible — an immediate one-tap delete on a phone is the worse
      guess. Unread: whether the design uses a swipe, a long-press, an overflow menu
      (`Element / Icon / Options`) or a sheet.
- [ ] **Empty and heading copy** — *chose:* "No comments yet. Be the first to say something."
      and a heading that counts ("3 comments" / "Comments" when empty). Unread.
- [ ] **Not built:** pagination of a long thread. `getPostcardComments` is deliberately
      unbounded — a thread is bounded by one postcard rather than by the whole app — so a very
      popular photo renders every comment. Worth a cursor when a real thread gets long; the
      page size is not inventable without the design.

### Postcard overflow menu — built 2026-08-05, and one standing TODO resolved

Source: the component `Content / Context Menu / Postcard` (`2303:5963`) — **not** `2303:5676`,
which is the *frame* `Postcard options` that instances it — and the three confirmation frames
`Postcard hidden banner` (`2303:6009`), `Account blocked banner` (`2303:6169`),
`Post reported banner` (`2303:6300`).

Measured, not inferred: sheet 390×240 flush to the bottom, `rr[16,16,0,0]`, padding
16/24/32/24; three items 342×56 radius 4, each with a **visible** 24px icon (`Hide`,
`Block Account`, `Report`) and a Poppins/16/Medium `Grey/100` label — **no destructive
tone on any row**, including Block. Banner 358×64 at 16px inset, radius 8, `White/100`,
16px padding, 12px gap, 32px `Accent Brand/100` circle with a white check, label
Poppins/16/Semibold.

- [x] ~~**The six report reasons are inferred, not read.**~~ **Resolved 2026-08-05, and not
      the way this entry expected.** The instruction was "verify with `npm run figma -- text`
      once the snapshot is captured". It is captured, and **there is nothing to verify
      against**: `Home / Report post` is marked **Done** and contains four frames — feed,
      options sheet, confirmation banner — with **no reason step anywhere**. The design
      reports in one tap. So the six reasons were never a transcription that drifted; they
      answer a question the design does not ask. The enum, the CHECK constraint in `011` and
      the union in `src/types` all stay (removing a value is the expensive direction), and
      the unit test that diffs enum against migration still earns its place.
- [ ] **Every report therefore lands as `other`, and the reason column carries no signal.**
      `REPORT_REASON_WHEN_UNDRAWN` in `src/lib/validation/comments.ts` is the one caller's
      value, chosen because it is the only member that asserts nothing the rider did not say
      — `spam` or `harassment` would put words into a moderation record. **This is a question
      for the designer, not a task:** should reporting collect a reason? If yes it needs a
      frame; if no, `011`'s `reason` column is decoration and should be dropped rather than
      left looking meaningful. Note `postcard_reports` is already write-only in practice —
      no admin role exists to triage it — so this compounds an existing gap rather than
      creating one.
- [ ] **The Delete row is not in the design.** The sheet is drawn for *someone else's*
      postcard, where Hide/Block/Report all make sense; on your own they do not, and the
      design has no own-postcard sheet at all. Added on the product owner's explicit call
      (2026-08-05). It uses the component set's real `Type=Warning` variant so the tone is
      the design's, but **the two-tap confirm is ours** — `deletePostcard` is irreversible
      and takes the Storage object with it, and the design offers no confirmation pattern to
      copy. Worth a frame.
- [ ] **The banner has no dismiss control and no drawn duration.** All three frames show it
      in one state with nothing to close it. It auto-dismisses after **4 seconds**, which is
      ours. A dismiss affordance or a documented duration would settle it.
- [ ] **The banner's error tone is ours.** The design draws only the success form (green
      circle, check). A failed hide/block/report reuses the same geometry with `Warning/100`
      and a cross, because reporting a refusal under a green tick is worse than an undrawn
      state. No error frame exists for this flow.
- [ ] Whether reporting and hiding are one affordance or two in the design. **Two, confirmed**
      — the sheet lists them as separate rows, matching the two rights and two tables `011`
      created. Kept here only because the answer is now evidence rather than assumption.
- [x] ~~**Blocking a rider can skip unseen cards in the deck.**~~ **Fixed 2026-08-05**, in the
      session after the one that surfaced it. `PostcardDeck` windowed with
      `postcards.slice(index)`, which is only correct while the list is append-only — a block
      removes *every* card by that author, including ones before the current index, so the
      window jumped forward by that many and the skipped cards were never shown. Hiding and
      deleting had the same shape one card at a time.

      The fix was not index arithmetic but a change of model: the deck now holds **the set of
      ids the rider has swiped past** and filters, so a card removed server-side stops
      appearing and nothing shifts. That makes the whole class unrepresentable rather than
      patched. `remainingPostcards` in `src/components/postcards/deck.ts`, seven assertions in
      its `__tests__`.

      Worth keeping the ordering straight: the defect was **latent and unreachable** until the
      overflow menu shipped block/hide/delete — nothing in the UI could shrink the list from
      the middle before that. It was fixed in the next session precisely because that change
      is what activated it.
- [ ] **`unhidePostcard` and `unblockRider` still have no caller**, so hiding and blocking are
      **one-way from the UI**. There is no "hidden postcards" or "blocked accounts" screen in
      the design to undo them from, so this needs a frame before it needs code — but a rider
      who blocks someone by mistake currently cannot reverse it in the app.

### Notifications — design-system pieces built 2026-08-07 (PD-118 §4)

Source: `Inbox - Notifications` (`2322:8395`) and `v2 / Component / Notification` (`2370:7297`),
both measured (`npm run figma -- tree "Inbox - Notifications"` /
`npm run figma -- text "Inbox - Notifications"`). Scope was exactly `openspec/changes/
add-notifications/tasks.md` §4.1–§4.7 — the row, the dot, `Header`'s second slot and
`MailboxIcon`; the route, page, data functions and actions are a separate pass.

- [x] **`NotificationRow`** (`src/components/ui/NotificationRow.tsx`) — 72px, two-line text
      block (`Poppins/16/Semibold` name + `Poppins/14/Regular` stamp on line one,
      `Poppins/14/Regular` copy on line two), optional trailing 56×56 thumbnail. A new
      component, not a `ListUser` prop, per
      `openspec/changes/archive/2026-08-08-add-notifications/design.md` §D9.
- [ ] **The composite double-avatar leading treatment is not reproduced.** Two of the drawn
      types (`ride_joined`, `ride_created_in_club`) show two overlapping 36px avatars inside
      the 56px leading frame rather than one — the mock does not name whose second avatar it
      is (the organizer's? the viewer's own?), and guessing would be exactly the kind of
      unlabelled inference `CLAUDE.md` §Working Principles forbids. `NotificationRow` renders
      a single leading avatar for every type. Needs a designer answer before it is built.
- [ ] **The trailing thumbnail's corner radius is applied uniformly (`radius 4`, clipped),
      not per subject.** The drawn frame actually varies it — square for a postcard photo,
      `radius 4` for a ride's map thumbnail with its `Location Filled` pin overlay, and an
      `Avatar`-shaped (more rounded) trailing image for `club_joined`. `NotificationRow`
      exposes `trailing` as a plain `ReactNode` in a single fixed 56×56 rounded, clipped
      container; a caller wanting the postcard's square treatment or the pin overlay composes
      it inside that slot, or this component grows a `trailingVariant` prop once a real screen
      needs the distinction to be different in practice, not just in the mock.
- [x] **`NotificationDot`** (`src/components/ui/NotificationDot.tsx`) — `v2 / Component /
      Notification`, 16×16, `Warning/100` fill with a 3px `Grey/5` inside ring, no text child.
      **Contrast independently computed** (not copied from `design.md`): `#D92140` on
      `#F2ECE6` is **4.22:1**, against the WCAG **3:1** non-text bar (no text child, so 4.5:1
      does not apply). Passes.
- [ ] **No per-row unread state.** The drawn frame shows every row identically — there is no
      read/unread visual difference on an individual row anywhere in the design, only on the
      header control that opens the screen. `NotificationRow` therefore carries no `unread`
      prop. If the product wants a per-row treatment later, it needs a design decision first,
      not an invented one here.
- [x] **`Header` gains `secondaryAction`** (`src/components/layout/Header.tsx`) — a second
      40×40 slot at `right-10` (x302), alongside the existing `action` at `right-0` (x342).
      Per `openspec/changes/archive/2026-08-08-add-notifications/design.md` §D9, taken as an
      architecture decision rather than reopened here. Both
      existing `action` callers (`/profile`'s `<ProfileMenu />`, `RideHeader`'s chat button)
      are unchanged — verified by `next build` still producing the same route list and by
      `npx tsc --noEmit` / `npm run lint` / `npm run test:unit` staying green.
- [ ] **The x302/x342 geometry is measured off `Ride - Ride plan - Sub pages` (`2375:9114`),
      not off a tab-root header carrying a mailbox icon.** No frame in the snapshot draws the
      notifications entry point on `/postcards`, `/rides`, `/clubs` or `/profile`'s header,
      because the v2 design still has its own Inbox tab — PD-118 adds the header control on
      top of that, in code the design never drew. The two-adjacent-40px-buttons geometry
      itself is real and reused correctly; its application to these four specific headers is
      inferred by extension, not read from a matching frame.
- [x] **`MailboxIcon`** — already in `src/components/icons/generated.tsx` (`Element / Icon /
      Mailbox`, used today by `Navbar`'s Inbox tile). No new icon generated; settled by the
      product owner this session that there is no bell in the 53-icon set and none should be
      substituted or hand-drawn.
- [ ] **Section titles (`Today` / `Yesterday` / `This week` / `All time`) and the loading
      skeleton are §6's (the screen), not §4's** — `SectionHeader` needs no change
      (`text-xl font-semibold` is already `Poppins/20/Semibold`, checked in its own source).
- [ ] **The compact per-row stamp formatter, `formatNotificationStamp`
      (`src/lib/utils.ts`), extends past what the frame draws.** `2m` through `2w` are
      measured; the `mo`/`y` branches beyond that are inferred from the same one-unit-per-
      magnitude pattern the frame establishes, because nothing in "All time"'s mocked data is
      older than two weeks. Not `formatRelativeTime`, which produces prose for a different
      screen's byline — see that function's own docstring.

### Notifications — screen and header entry point, built 2026-08-07 (PD-118 §5–§6)

`/notifications` (`src/app/(app)/notifications/page.tsx`), `src/lib/data/notifications.ts`,
`src/lib/actions/notifications.ts` and `src/components/notifications/`. The frame draws the
row and the section shape only — every interaction affordance on the screen itself is either
absent from the mock or a product decision this pass had to make without one:

- [ ] **The "This week" section boundary is a 7-day rolling window, not a calendar week.**
      `Inbox - Notifications` draws no boundary at all, only four labelled sections whose mocked
      rows happen to span `2m`–`2w`. `notificationSection` (`src/lib/utils.ts`) picks the rolling
      window because a calendar-week boundary would move a notification into `All time` on
      Tuesday with nothing about it having changed.
- [ ] **There is no "Load more" affordance in the design, and one is built anyway.** `036`'s
      retention window is "as long as the subject exists", i.e. unbounded, so the list needed a
      real second page — `getNotificationsPage`'s keyset cursor — and the screen needed some
      control to reach it. A plain secondary `Button` labelled "Load more" is invented rather
      than an infinite-scroll trigger, matching this app's other bounded-list screens, none of
      which auto-load either.
- [ ] **Opening the screen marks everything read, and nothing in the design draws that
      either.** `Inbox - Notifications` has no per-row dismiss and no "mark all read" control
      anywhere on it, so `MarkNotificationsRead` fires on mount, the same shape
      `MarkClubSeen`/`MarkFeedSeen` already use for their own watermarks. If the product wants a
      manual affordance instead, that needs a frame before it needs a different mechanism.
- [ ] **The empty-state copy ("You have no notifications yet.") is invented**, matching the
      voice of the other three tab-root empty states (`"You have no clubs, yet!"`, `"There are
      no rides, yet!"`) rather than read from a frame — the design draws no empty variant of this
      screen at all.
- [ ] **`ride_joined` and `ride_created_in_club` rows render no trailing thumbnail.** The frame
      shows a 56×56 "Image Container" with a `Location Filled` pin overlay for both. The tile
      itself is sourceable — `051` added `rides.map_card_path` and `rides.map_detail_path`
      (`git grep -n "map_card_path" -- supabase/migrations/051*.sql`), and
      `resolveRideMapUrls` already signs both — so what is open is the **pin overlay**, which is
      the per-subject trailing treatment logged three bullets above and needs the same designer
      answer. `NotificationsListItem` omits the slot rather than drawing a placeholder, and
      `NOTIFICATION_SELECT` does not select either path until it does.
- [x] ~~**The `ride_joined` copy is rewritten from the drawn string.**~~ — **both strings ship
      now (PD-129).** `Inbox - Notifications` draws "joined a ride you also joined.", written
      for an attendee, and that is what a fellow crew member reads, verbatim. The organizer
      reads "joined your ride." instead, because they created the ride rather than joining it
      and the frame draws no row for that reader. One `ride_joined` type either way: the
      sentence branches on `rides.organizer_id`, read live under the reader's own RLS, in
      `src/components/notifications/copy.ts`.
- [ ] **The header title reads "Notifications", not the design's two-tier "Inbox" ›
      "Notifications".** The frame nests this screen inside the dropped Inbox tab, with "Inbox"
      as the page name and "Notifications" as the sub-page. With no Inbox wrapper to nest under,
      the single collapsed title is this pass's own composition rather than a measured value.
- [ ] **A back button is drawn where the frame hides one (PD-209, 2026-08-12), and the hidden
      layer is not evidence against it.** `tree "Inbox - Notifications" -- --all` marks the
      header's `v2 / Component / Button / Icon` and its `Arrow Left` `[hidden]`, so the design
      specifies no back control — *because it draws Inbox as the fifth nav tab, selected*. A tab
      root leaves through the other tabs. With that tab dropped (PD-100) `/notifications` matches
      none of `Navbar`'s four, so the screen had no back control and no lit tab, and the hidden
      layer stopped meaning what it meant the day it was toggled off. Same 40×40 `Button / Icon`
      and `Arrow Left` the frame holds, so only its *visibility* deviates. It goes back to
      measured, unchanged, if the Inbox epic restores the tab — and this bullet is the reason not
      to "fix" it against the snapshot before then.

### Navigation

- [x] ~~**Tab bar**~~ — **measured**, and the guess was wrong in the way that mattered.
      `v2 / Component / Navigation / Bar`: **88px** for the bar alone, **152px** when a screen
      supplies the sticky primary action above the tabs (44 frames use the first, 27 the
      second). Background is `Grey/5` — the page colour, not `bg-surface` — with a **1px top
      border** only. Five tiles, 24px icons, Poppins/10/Semibold labels.
      **Active is `Grey/100` with no background, not the brand green this used to apply**;
      pressed is the only state with a fill (`Grey/10%`). **The design's five tiles are four in
      code** — Inbox was dropped 2026-08-07 (PD-100) rather than shipped inert, so this is a
      deliberate divergence from the frame, not an outstanding fidelity gap. It closes when the
      Inbox epic restores the route.
      → `src/components/layout/Navbar.tsx`
- [x] ~~**Header placement**~~ — the header is **per screen**, not part of the shell: each
      design frame gives it its own title, back affordance and variant.
      → `src/components/layout/Header.tsx`
- [ ] **Header Type=User / Type=Club** — 120px variants with an avatar, name and options
      button. Not built; no screen needs them yet.

### Icons — resolved 2026-08-04

- [x] ~~Export all 44 and retire `lucide-react`~~ — **53 exported** (the set is larger than the
      44 counted from the Components page). `npm run figma:components` generates
      `src/components/icons/generated.tsx` from them, rewriting every literal fill to
      `currentColor` — which also erases the stray legacy `#808080` a few were drawn with.
      Regenerate rather than hand-edit.
- [ ] **Retire the remaining `lucide-react` imports.** The v2 screens are clean. `profile` and
      `SignOutButton` came off the list on 2026-08-05 — the profile screen is v2 and the button
      is deleted — leaving `clubs/*`, `rides/new`, `Navbar` and `LikeButton`, which migrate with
      their own epics. The dependency comes out when the last import does.

      **Count it with `grep -rl "from 'lucide-react'" src/ | grep -v generated`.** The looser
      `grep -rl lucide-react` this item used to specify counts *prose* too: a file whose only
      match is a comment saying it no longer uses the library reads as an importer, so the
      number could never reach 0 while any such comment existed. It over-counted by one the day
      the profile page landed, which is how it was noticed.

### Sign up — one line of body copy the design does not have, added 2026-08-16

`npm run figma -- text "Sign up"` returns six strings and **none of them is body copy**;
`text "Login"` returns six and the same is true. Both frames go straight from the `32/48 w600`
title to the first field, and `--all` changes neither output, so no toggled-off variant slot is
being missed. `/auth/signup` carries a `body` line anyway:

> Motorcycle rides are better with company. Find a club, join a ride, share the photos.

**This is a deviation, not a measurement gap** — the design settles the question and the answer
is being overridden, which is the one case the rule below does not cover. Recorded here because a
later pass reading the frame will find code the design does not justify and needs to know it was
a decision rather than an oversight.

**No composition was invented, and the weight is the part worth getting right.** `AuthScreen`
renders `body` as `<p className="text-sm text-muted">` for `/auth/forgot-password` and
`/onboarding/terms`. That is **`Poppins/14/Regular`, w400** — `text-sm` is the 14/20 size and
carries no weight class, and `globals.css` says so explicitly: *"weight is applied separately via
font-normal/font-medium/font-semibold"*. It matches the one frame that has this slot:
`npm run figma -- text "1857:17166"` gives the Forgot password body as `14/20 w400 ·
Poppins/14/Regular`.

**Do not "correct" it to `font-medium`.** `Label · 14/20 w500` is the *field-label* token —
"Email", "Password" — a different slot at the same size, and adopting it here would push all
three screens off the design's actual weight. (`/onboarding/terms` has no v2 frame at all:
`npm run figma -- ls terms` returns `0 of 438`.)

- [ ] If a v2 frame for `Sign up` ever gains a body slot, take its string and its token over this
      one.

**`/auth/login` is deliberately bare, and that is a decision rather than an open task** — hence
no box. It is the screen a cold arrival actually lands on: the guard sends an un-authed request
for any *non-public* path there, and no `next` param survives the redirect, so a tapped postcard
link loses both the pitch and the postcard. Login is also what every returning rider sees, so the
cost of a tagline there is paid on every sign-in. If shared links ever become a real acquisition
channel the fix is more likely routing than copy — send an un-authed deep link to `/auth/signup`,
and carry the target — which is a change to `src/lib/auth/guard.ts` and its suite, not a fidelity
item.

## Rule for anyone building against this

**Read `design/` first — it is offline and cannot be rate limited.** An inferred composition
value is no longer defensible when `npm run figma -- tree "<screen>"` answers it in a second.

What still needs recording is the case the snapshot cannot settle: a value the design does not
specify, or one it specifies against data the schema does not have. For those, do **not**
invent one silently. Add it here as an unchecked box, pick the most defensible value, and
leave a comment at the call site pointing here. A guess that is written down is a task; a
guess that is not is a bug nobody will find.
