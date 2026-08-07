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

- All 20 v2 colour tokens, all 16 Poppins type tokens (`CLAUDE.md` §Design System).
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
(`/postcards/[id]`), the composer and the card's comment control. Every value below marked
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
      8), Heart Outline → **Heart Filled in Pink/100 `#F23071`** when liked. That settles the
      "Pink/100 — purpose not established" note in `CLAUDE.md`: it is the liked heart, and
      nothing else uses it.
- [x] ~~**Empty state**~~ — **measured copy:** "There are no new postcards, yet!",
      Poppins/14/Medium in Grey/80, centred, no panel, no illustration, no CTA.
- [x] ~~**Header**~~ — **measured.** `v2 / Component / Header` Type=Regular: 96 tall, centred
      "Home", no back button and no sub-page on this screen (both are toggled off in the
      instance). The "New postcard" button guessed here is real but belongs to the *nav bar*
      as a sticky action, not the header.
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

### Club detail and Create club — built 2026-08-05

`/clubs/[id]` is four sub-pages behind the header's dropdown — Timeline, Rides, Members,
About — built from the **private club** frames, which are the ones marked Done.

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

- [ ] **Upcoming rides render as list cards, not the drawn chip.** The design uses
      `Collection / Ride` — a 200×56 horizontal-scroll chip with a date block. `List / Ride`
      is already measured and shows the same three facts, so it is reused. A second card
      component for one strip is the trade; registered so it is a choice rather than a
      mistake.

- [ ] **The header's `Options` control is omitted, not stubbed.** Same reasoning as
      `RideHeader`: the flow never draws the sheet's contents, and club overflow is presumably
      edit / delete / leave. Leave lives on the About page instead, as one labelled control.
      **Edit club has no v2 design either** — its frame is OLD-stylesheet and shares the
      `Create club` epic, which is To do.

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

### Clubs list — built from the measurements 2026-08-05

Every geometry value was **read** from `v2 / Component / List / Club` (the 3-variant set,
`1918:7252`) and the four frames `Clubs - Your clubs`, `- No clubs`, `Clubs - Explore`,
`- No clubs`. What follows is what the design asks for and the schema has not got, plus the
deliberate deviations and one settled ambiguity.

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
- [ ] **The 80×148 image strip has no data behind it.** The design fills it with a photo
      carrying a `Location Filled` pin — almost certainly the static map thumbnail decision #3
      calls for. `rides` has **no image column and no coordinates**, and `meeting_point` is
      free text. *Chose:* render the design's container and the pin, and nothing else. Needs a
      migration **and** a static-tile provider, so it is two decisions, not a styling task. It
      is the most visually obvious gap on the screen — a 80×148 grey block on every card.
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
- [ ] **The list is upcoming-only, and ride history has no screen.** All four frames draw
      upcoming rides, and the empty state says "no *upcoming* rides". But the component set
      carries two past variants (`Went`), which nothing in this flow can reach. Either a past
      section belongs on "Your rides" or history lives on the profile — the design does not
      say.
- [x] ~~**Timezone.**~~ **Fixed 2026-08-05** — see §Ride detail, where the same bug was found
      from a real device and fixed once for both screens. `RideCard` calls
      `formatRideDate`/`formatRideTime`, which are now pinned to `APP_TIME_ZONE`. The `en-US`
      half of this item resolved itself: `formatDate` and `formatDateTime` were **deleted**,
      having ended up with one caller between them, so the app no longer renders dates in two
      locales. `formatRelativeTime` keeps `en-US` deliberately — it emits English prose, not a
      date. What remains open is only the model, not the defect: wall-clock at the meeting
      point needs a zone column on `rides`.

### Ride detail — built from the measurements 2026-08-04

`/rides/[id]` and `/rides/[id]/crew`, from `Ride - Ride plan (Details)` (`2375:8771`),
`Ride - Ride plan - Sub pages` (`2375:9114`) and `Ride - Crew (Riders)` (`2375:9212`).

Every geometry value was read with `npm run figma -- show`, not estimated: banner 390×200,
club chip at y344, title 24/36 at y364, blurb clamped to 60px (exactly three 20px lines),
`Show more` link, two 64px rows with `Grey/10` hairlines inset to the text edge, map 358×160
radius 8 with its button inset 4px bottom-right, and the RSVP bar 390×96 with padding
16/16/8 and a 358×40 button group. What follows is the design asking for **data the schema
has not got**, plus deliberate deviations.

**Three sub-pages of four are built** as of 2026-08-07. The switcher lists Ride plan and Crew;
Chat is the header's chat-bubble button, which is where the design puts it. The remaining
deviation is first:

- [ ] **Journal is drawn and not built.** `Ride - Journal (Postcards/Timeline)` (`2226:4865`)
      is postcards attached to a ride, and `postcards` has **no `ride_id`**. It needs a
      migration *and* an audience decision, because `club_id` currently **is** the audience
      and a ride-scoped postcard would be a second axis. Omitted from the menu rather than
      offered as a dead row.
- [x] **Chat is built — 2026-08-07** (`034`, Linear PD-115). `Ride - Chat` (`2226:4999`) and
      `Ride - Chat - Text focus` (`2242:11086`) at `/rides/[id]/chat`. **It did not need the
      Inbox epic**, which this entry asserted: a per-ride chat needs a ride and a crew, both of
      which existed. Five deviations, each a decision rather than a miss:
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
      fifth of the screen above the fold is worse than a shorter page. *Chose:* omit. Needs
      the same migration + Storage work as the list card's strip; do both together.
- [ ] **The map tile has no coordinates.** `rides` has no lat/lng, only free-text
      `meeting_point`, so there is no tile to draw. *Chose:* render the panel as what it
      actually is — the address, legibly, and one tap that opens directions. Filling it is a
      migration **and** a keyed static-tile provider (Google Static Maps, Mapbox and the rest
      all require a key and a billing account); that is two product decisions, not a styling
      task. **Do not** substitute an `output=embed` iframe: it is an interactive map where
      decision #3 specifies a static thumbnail, it swallows touch gestures inside a scrolling
      page, and Safari's tracking prevention blanks third-party frames — which would
      reproduce the exact bug reported below.
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
      currently unbuildable: `rides` has no country, no coordinates, only a free-text
      `meeting_point`.

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
      Function that owns the auth delete. **The function is not deployed and has never run**,
      so no row points at it — `openspec/changes/add-account-deletion/` group 3 is the flow
      itself, and group 4 the four screens where "gone" and "forbidden" currently look
      identical. `Preferences` is still undesigned as a destination and is a separate question.

Deviations that are ours, not the design's:

- [ ] **The design has no edit screen at all.** `View your profile` draws the profile;
      `Login / Onboarding` draws the fields being filled in for the *first* time; nothing
      draws changing them afterwards. So the edit form's placement — under the profile, on the
      same route — is invented. It is the smallest guess available (the fields and their
      validation already exist), but it is a guess, and a designed settings screen may well
      move it.
- [ ] **The nav bar in this frame shows three tabs**, not five: Home, Clubs, Profile. Rides
      and Inbox are absent. Counted across frames rather than assumed —
      `Home - Postcards - All new` draws **5** tiles, this frame **3**, and
      `Rides - All rides` **0** (it has no bar at all). A value that takes three different
      shapes in three frames is not a spec, so the built five-tab `Navbar` stands and this is
      treated as the outlier. Worth confirming with the designer: if the three are deliberate
      it is a navigation change, not a profile one.
- [ ] **The timeline is unpaginated.** It reuses `getFeed`'s rider filter, so it is bounded at
      `FEED_PAGE_SIZE` (30) — a rider with more postcards than that silently sees their 30
      newest. The design draws no pagination for this list, so the honest fix needs a design
      before it needs code. Same trade as the crew roster's 200.


### Create postcard

- [ ] **Flow order** — *chose:* preview → choose-photo button → caption → audience → submit,
      one screen, no crop step. Upload starts on file selection, not on submit, so progress
      is real and the path is ready when the form posts. Unread: whether the design has a
      crop/preview step or splits this across screens.
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

- [ ] **Where a thread lives** — *chose:* a dedicated route, `/postcards/[id]`, holding the
      card and its comments; the feed card carries a comment control that links to it. The
      alternative — comments inline on the feed card, with a "view all N" expander — is what
      several photo feeds do, and it is unread which one this design uses. Two things pushed
      this way: `addComment` has revalidated `/postcards/${postcardId}` since `011` shipped,
      before any route answered to that path, and `getPostcard()` existed unused. Inline
      expansion would also have meant inventing a truncation rule, which is the same trap the
      caption clamp is being avoided for.
      → `src/app/(app)/postcards/[id]/page.tsx`
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

## Rule for anyone building against this

**Read `design/` first — it is offline and cannot be rate limited.** An inferred composition
value is no longer defensible when `npm run figma -- tree "<screen>"` answers it in a second.

What still needs recording is the case the snapshot cannot settle: a value the design does not
specify, or one it specifies against data the schema does not have. For those, do **not**
invent one silently. Add it here as an unchecked box, pick the most defensible value, and
leave a comment at the call site pointing here. A guess that is written down is a task; a
guess that is not is a bug nobody will find.
