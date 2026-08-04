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

### Report a postcard — the reason list is a guess

- [ ] **The six report reasons are inferred, not read.** `spam`, `harassment`, `hate`,
      `nudity`, `violence`, `other` — the common denominator of other platforms' report
      sheets, not a transcription of the design's Report frame. They are a CHECK constraint
      in `011`, a Zod enum in `src/lib/validation/comments.ts`, and a union in `src/types`,
      kept in step by hand and by one unit test that diffs the enum against the migration.
      Verify with `npm run figma -- text "Report"` once the snapshot is captured. **Adding a
      value is a cheap drop-and-recreate of one constraint; removing one is not**, which is
      why the list was kept short rather than generous.
- [ ] Whether reporting and hiding are one affordance or two in the design. They are two
      rights and two tables in `011` on purpose — a rider may want either — but if the design
      shows a single "Report and hide" control, that is a `lib/actions` composition, not a
      schema change.

### Navigation

- [x] ~~**Tab bar**~~ — **measured**, and the guess was wrong in the way that mattered.
      `v2 / Component / Navigation / Bar`: **88px** for the bar alone, **152px** when a screen
      supplies the sticky primary action above the tabs (44 frames use the first, 27 the
      second). Background is `Grey/5` — the page colour, not `bg-surface` — with a **1px top
      border** only. Five tiles, 24px icons, Poppins/10/Semibold labels.
      **Active is `Grey/100` with no background, not the brand green this used to apply**;
      pressed is the only state with a fill (`Grey/10%`). Inbox renders inert — the design has
      five tabs and the route does not exist, and a tab that 404s is worse than a disabled one.
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
- [ ] **Retire the remaining `lucide-react` imports.** The v2 screens are clean; the v1 pages
      (`rides/*`, `clubs/*`, `profile`) and `SignOutButton` still import it, and they migrate
      with their own epics. The dependency comes out when the last import does —
      `grep -rl lucide-react src/ | grep -v generated` is the current count, not a number typed
      here.

## Rule for anyone building against this

**Read `design/` first — it is offline and cannot be rate limited.** An inferred composition
value is no longer defensible when `npm run figma -- tree "<screen>"` answers it in a second.

What still needs recording is the case the snapshot cannot settle: a value the design does not
specify, or one it specifies against data the schema does not have. For those, do **not**
invent one silently. Add it here as an unchecked box, pick the most defensible value, and
leave a comment at the call site pointing here. A guess that is written down is a task; a
guess that is not is a bug nobody will find.
