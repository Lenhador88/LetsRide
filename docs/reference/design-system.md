<!-- Moved out of CLAUDE.md so it is not auto-loaded into every session.
     CLAUDE.md keeps the heading as a signpost; this file is the content. -->

## Design System

> **⚠️ The code currently does NOT match the design.** The app was built against the
> **v1 (dark)** designs. Figma has since moved to **v2 (light)** — a different theme,
> palette, and typeface. The tokens below are the **target**. Anything in the codebase
> using `zinc-*` or `orange-500` is legacy v1 and is being migrated. Do not add more of it.
>
> Figma: `gDoteM1ow1AZpSEGSNhpc7` — the `v2 / Component / *` library is canonical.
> Ignore `Component / *` (v1, has `Theme=Dark` variants) and anything named `(OLD)`.

**Read the design from `design/`, not from the Figma API.** The snapshot committed there is
generated from the same file and answers layout, geometry, copy and token questions offline —
`npm run figma -- tree "<screen>"`. The API rate limit is per-endpoint, inherited across
sessions, and has blocked work for hours at a time; the snapshot exists so that stops
mattering. Refresh it monthly with `npm run figma:pull`, and if a 429 comes back, stop rather
than poll. Full rationale in `design/README.md`.

The tables below and `design/TOKENS.md` describe the same thing. **When they disagree,
`design/TOKENS.md` is right** — it is generated, these are transcribed.

**These tokens are Figma *paint and text styles*, not variables** — which is the only reason
they are readable at all, and why converting them would be catastrophic. `design/README.md`
explains it; *What Not To Do* carries the rule.

Extracted from the file and verified 2026-08-01. `n` is how often the style is used on the
Components page — a good proxy for how central it is.

**Colors:**

| Token | Value | n | Use |
|---|---|---|---|
| `Grey/100` | `#1A1A1A` | 275 | Primary text, primary buttons |
| `White/100` | `#FFFFFF` | 222 | Cards, surfaces, text on dark |
| `Grey/80` | `#666666` | 101 | Secondary / muted text, icons |
| `Grey/5` | `#F2ECE6` | 54 | App background (warm cream) — but see the gradient note below |
| `Warning/100` | `#D92140` | 39 | Destructive / error — `<Button variant="danger">` |
| `Grey/10%` | `#0000001A` | 16 | Dividers, subtle borders |
| `Accent Brand/100` | `#3D996B` | 14 | Brand green — accents, success, splash |
| `White/10%` | `#FFFFFF1A` | 7 | Overlay on imagery |
| `Accent Brand/110` | `#338059` | 5 | Brand green, darker — pressed / hover |
| `Grey/20%` | `#00000033` | 3 | Stronger borders |
| `White/5%` | `#FFFFFF0D` | 3 | Subtle overlay on imagery |
| `Accent Brand/50%` | `#3D996B80` | 2 | Muted brand |
| `Warning/90` | `#FF3355` | 2 | Error, lighter |
| `Pink/100` | `#F23071` | 2 | **The liked state of the like control, and only that** — `Button / Postcard Action` Type=Like Toggled=True. Since PD-228 it tints `Element / Icon / Wave`, which has no filled twin, so this colour is the whole visual difference between liked and not. `--color-like` |
| `Grey/60` | `#808080` | 1 | Near-unused; may be a stray |
| `Grey/70%` | `#000000B3` | 1 | Scrim / overlay |
| `Warning/110` | `#99001A` | 1 | Error, darker |

Note: primary buttons are **near-black (`Grey/100`)**, not green. Green is an accent, used
sparingly — it is not the button colour.

**The app background is a gradient, not a flat fill.** `v2 / Component / App Background` is a
135° linear gradient from `#F2ECE6` (`Grey/5`) to `#CCB8A3`. Every screen in the login epic
instances it except the splash, which is flat `Accent Brand/100` `#3D996B`. `--color-background`
in `globals.css` holds only the flat top colour, which is right for surfaces and wrong for the
page. Measured 2026-08-02.

Twelve `Grey (OLD)/*` and `Accent (OLD)/*` styles are still live *inside* v2 components —
`#808080` (93 uses), `#E6E6E6` (84), `#262626` (59), `#36B289` (31) and others. They are v1.
Do not port them; resolve to the v2 token nearest in intent.

**Type — Poppins** (there is no other family):

| Token | Size / LH | Weight | n |
|---|---|---|---|
| `Poppins/14/Medium` | 14 / 20 | 500 | 102 |
| `Poppins/16/Regular` | 16 / 24 | 400 | 77 |
| `Poppins/14/Semibold` | 14 / 20 | 600 | 69 |
| `Poppins/12/Semibold` | 12 / 18 | 600 | 60 |
| `Poppins/14/Regular` | 14 / 20 | 400 | 57 |
| `Poppins/16/Medium` | 16 / 24 | 500 | 47 |
| `Poppins/10/Medium` | 10 / 16 | 500 | 31 |
| `Poppins/16/Semibold` | 16 / 24 | 600 | 26 |
| `Poppins/12/Regular` | 12 / 18 | 400 | 25 |
| `Poppins/10/Semibold` | 10 / 16 | 600 | 23 |
| `Poppins/12/Medium` | 12 / 18 | 500 | 14 |
| `Poppins/20/Semibold` | 20 / 30 | 600 | 6 |
| `Poppins/18/Semibold` | 18 / 26 | 600 | 5 |
| `Poppins/24/Semibold` | 24 / 36 | 600 | 2 |
| `Poppins/20/Medium` | 20 / 30 | 500 | 1 |
| `Poppins/40/Semibold` | 40 / 60 | 600 | 1 |

**`Poppins/32/Semibold` (32/48, w600) exists** — style `503:6020`, and it is what every screen
title in the login epic uses. It is absent from the table above because **a style can exist in
the library without appearing on the Components page**, which is where those counts come from;
never read that table as the full style list. `--text-display` in `globals.css` is correct. The
other display sizes are 24/36 and 40/60.

**Layout:** 390px mobile frame, single column, mobile-first. Fixed top header + fixed
bottom tab bar. Use `.pb-safe` for notch devices.

**Geometry** (most-used values on the Components page — use these rather than inventing):
corner radius `4` (147), `100` (110, i.e. pill), `8` (85), `5` (52), `12` (15);
padding-left `16` (99), `8` (43), `24` (21); item spacing `8` (86), `4` (66), `16` (40).

**Icons: 54 exported**, under `Element / Icon / *`. They are in `design/icons/` as SVG and,
more usefully, as typed React components:

```bash
npm run figma -- icons        # list them
npm run figma:components      # regenerate src/components/icons/generated.tsx
```

**Import from `@/components/icons/generated`; never hand-edit it.** The generator rewrites
every literal fill to `currentColor`, so an icon takes the colour of the text around it and
the stray legacy `#808080` a few were drawn with disappears at the door. Size with
`className` — `h-6 w-6` is the design's 24px default.

The set includes the motorcycle-specific ones `lucide-react` cannot supply — Bike, Garage,
Wrench, Coordinates, Store — plus Arrow Left/Right/Up, Avatar, Block Account, Calendar, Chat
Bubble, Check, Chevron Down/Right, Clock, Close, Clubs, Delete, Edit, Flag, Globe, Heart
Filled/Outline, Hide, Home, Image, Location Filled/Outline, Lock, Log Out, Mailbox, Menu,
Mute, Options, Paper Plane, Pin, Plus, Plus Circle, Preferences, Profile, Report, Search,
Share, and Wave — the two-finger motorcycle wave the like control uses (PD-228). **Figma ships no
filled twin for it and the app no longer has one**: `LikeButton` toggles `text-like` on the single
outline, which is what the product owner settled on 2026-08-24 (PD-287) after four days of the
other answer. `docs/reference/design-system.md` §The wave icon carries the legibility argument and both round
trips.

**If a variant Figma does not ship is ever needed again, `src/components/icons/derived.tsx` is
where it goes** — hand-authored but only ever a transformation of an exported asset, never new
artwork, because `generated.tsx` is rewritten wholesale by `npm run figma:components`. The file
is deleted rather than kept empty; recreate it with a test that re-derives the variant from its
source glyph on every run, as `WaveFilledIcon`'s did, or a redraw leaves the two silently
drawing different hands.

**`lucide-react` is gone** — uninstalled 2026-08-05 with the last v1 page. Don't re-add it and
don't substitute lookalikes. The three matches
`grep -rn lucide-react src/` still returns are prose inside comments (see *the comment trap*);
the importer count is
`grep -rl "from 'lucide-react'" src/ | grep -v generated | wc -l` and it is **0**.

### The ⋯ options menu

**Every main screen answers "what can I do here" with the same control** — `OptionsIcon` in the
header's action slot, opening `ContextMenu` with one `ContextMenuItem` per row, icon plus label,
destructive rows `variant="warning"` in their own group behind a hairline. It is the app standard
as of PD-280, at the product owner's request, and it exists as a written rule because each new
detail screen had been re-deciding it: the club merge put Edit behind the dots while the ride kept
a bare pencil, no Delete and no Share at all. Re-derive the set rather than trusting a list here:

```bash
grep -rln "OptionsIcon" src/components/ | grep -v icons/   # 6: account, rider, postcard, club, ride, club thread
```

**It read 7 until 2026-09-01 and the seventh was the club timeline's join row.** PD-365 deleted it
— its only row was PD-356's `Say welcome`, and that gesture was replaced by a comment glyph opening
the rider's introduction. So this number can go DOWN as well as up, which the note above does not
say: a screen losing its last row loses the control, and that is a correct outcome rather than a
regression to restore.

Three rules the surfaces already agree on, and one exception:

- **A row is a display hint, never an authorization.** Gate rows on the viewer so the sheet does
  not offer what the database will refuse; RLS decides what happens. A forged state reaches the
  same refusal.
- **A destructive row confirms, and how depends on what it destroys.** A second tap in place
  (`PostcardMenu`'s `Tap again to delete`) is enough when the row can say the whole consequence.
  When the confirmation has to *name the collateral* — a ride's crew and chat history, a club's
  members and their postcards, an account — the row opens a second `ContextMenu` instead
  (`DeleteRideSheet`, `DeleteClubSheet`, `DeleteAccountSheet`). **Close the first before opening
  the second**: both render through one fixed z-index stack and `ContextMenu`'s focus trap assumes
  it is the only one open.
- **A control that also lives elsewhere stays there.** `DeleteRideControl` and
  `DeleteClubControl` keep their place at the foot of the edit screens. Two routes to one
  confirmation is fine; two implementations of it is the defect the sheets exist to avoid.
- **The exception is the postcard's `ShareButton`**, a peer icon beside the dots rather than a row
  inside them — decided 2026-08-24. A postcard's action row is a scrolling feed row, not a detail
  header, and share is worth one tap there. It is recorded here so the next reader does not
  "fix" it.

**The library scale**, for planning: 52 component sets covering 213 variants, plus 89
standalone components, 2,449 nodes on the Components page.

## Which design to build from

**The file annotates every epic with a status, and it is the best planning signal in it.**

```bash
npm run figma -- ls "Annotation / Epic Cover"     # then tree one for its status
```

Two traps, both live:

- **The 🟠-prefixed sections are the OLD stylesheet, not a newer iteration.** Their "In
  progress" status makes them look newer than the `Done` v2 flows. They are not.
- **Status does not track what is built.** Treat `Done` as "the designer considers this
  settled" — which is what you want before spending a day on it — not as a build log.

`CLAUDE.md` §Development Workflow has the commands and the refresh rules; the two traps above
are the ones that only matter when choosing *what* to build.

### A `figma:pull` USED to lose Chevron Down — fixed by PD-261, and still check the export

**Measured 2026-08-17, on the pull PD-248 ran.** `npm run figma:icons` came back
`Exported 53/54` with `Missing: Chevron Down`, and `chevron-right.svg` changed its `fill` from
`#1A1A1A` to `#666666`. Neither had anything to do with the wave.

The cause is the dedupe `.claude/agents/design-system.md` already warns about, sprung by content
rather than by an authoring mistake: `extract.mjs` takes **every** node whose name starts with
`Element / Icon / ` and keys them by name, last one walked wins. Two frame sets authored into the
file that day — `AI / Clubs one screen / 2026-08-17` and `AI / Ride detail merged / 2026-08-17` —
contain icon *instances* under those exact names, and they walk after the real components. So
`Chevron Down` re-resolved to `I4166:7033;2067:10645`, which **did not** export — read that as a
fact about that node, not about instances, because eleven icons in the set are instances and
export fine (below) — and `Chevron Right` to a grey instance inside a note frame.

**`ChevronDownIcon` has two importers** — `ClubDetailPageMenu` and `RideCrewRail`; `ClubPageMenu`
was the third until `PD-258` deleted it — so regenerating on that pull drops an export those still
import. That fails loudly at `tsc`
rather than shipping, which is the one piece of luck here. `chevron-right` is the quiet half: only
its `fill` moved, and `components.mjs` rewrites every literal fill to `currentColor`, so
`generated.tsx` is **byte-identical** and the wrong node is now canonical in `design/` with nothing
to notice it.

PD-248 kept its own diff to `design/icons/wave.svg` and `design/components/element-icon-wave.json`
and reverted the rest of the pull, so the committed snapshot still points both chevrons at their
real components. **That was a hold; `PD-261` is the fix, landed 2026-08-24.** `extract.mjs` now
ranks a COMPONENT/COMPONENT_SET above an INSTANCE on a name collision regardless of walk order,
and prints every collision it resolved — so a full pull no longer loses Chevron Down, and no
longer re-points Chevron Right silently. **The second route is still open and still needs the
owner**: renaming the icon layers inside those two frame sets in Figma, which fixes today's
instance rather than the class.

**Read the collision print, not the diffstat.** The new rank covers every non-component type, not
only instances, so a pull can now legitimately re-point an icon that had resolved to a scratch
node — the eleven instance-resolved icons below are the population where that could happen. The
print is the only thing that says so; `generated.tsx` can still come out byte-identical.

**So `design/manifest.json` deliberately lags what `design/` contains.** It was reverted with the
rest of the pull, and the wave came from a later Figma version, which nothing in `design/` records.
`figma:check` decides staleness on `manifest.latestVersionId` alone, so it prints a flat `STALE`
and cannot tell you that is on purpose. The `figma:pull` it invites is now safe for the chevrons —
`PD-261` landed — so read a `STALE` here as ordinary staleness, and read the collision report the
pull prints.

**Check `git diff` before you spend a network call — it is free and it catches both halves.**

```bash
git diff --stat design/icons/           # after a pull, BEFORE figma:icons
git diff design/icons/index.json        # an id that moved under a name you did not touch
```

That is the whole alarm for the quiet half **before the render call is spent**: `chevron-right`
produced a **byte-identical** `generated.tsx`, so until `figma:icons` runs and rewrites the SVG —
where the moved fill does show — its id in `index.json` is the only place it is visible.

```bash
npm run figma:icons          # must print 54/54; a "Missing:" line is the alarm
```

**That one is the confirming check, not the first one, and the difference matters when the API is
shut.** `figma:icons` calls `/v1/images` — the rate-limited bucket that has blocked this repo for
days at a time — so a session under a 429 cannot run it, and would have no alarm at all if the
`git diff` above were not written down. It also only fires *after* the pull has been spent.

**The obvious cheap alarm is a third thing, and it does not work.** Filtering
`icons/index.json` for instance-shaped ids (`I<id>;<id>`) looks like it would catch this and does
not: **eleven** icons in the set — `arrow-right`, `avatar`, `block-account`, `coordinates`,
`delete`, `edit`, `hide`, `image`, `lock-2`, `options`, `report` — already resolve to instance ids
and export perfectly well. Re-derive that rather than trusting the list; the point is that the
count is far from zero, so "resolved to an instance" is the *normal* state and cannot be the
alarm. What broke Chevron Down was that particular instance, not instances as a class.

### The wave icon — authored into Figma 2026-08-16, redrawn 2026-08-17, thinned to 2.20 the same day

The like control is the motorcycle wave (PD-228) needed a glyph the set did not have, so it was
authored **into** Figma rather than drawn in the repo — the first time anything here has written
to the design file. `CLAUDE.md` §Design System's fourth rule and
`.claude/agents/design-system.md` §Writing to Figma carry the standing rules that came out of it.

**What ships now is the second glyph.** The first was traced from an emoji font and read as noise
at 24px, so the product owner reviewed eleven redraws and picked one drawn from primitives
(PD-242).

**It is `Element / Icon / Wave` (`4127:6925`), one component, and one is the whole point.** The
heart it replaced was a filled/outline pair; a hand cannot be one. A solid silhouette loses the
folded fingers and thumb that make the glyph legible at 24px, and a merely bolder copy is
indistinguishable from the outline on a phone — so the liked state is carried by `text-like`
alone, which is what the product owner chose. A second component was authored and then deleted;
do not reintroduce one.

**That has now happened twice, and the second time this section did not notice.** PD-266 built a
filled variant on 2026-08-20 at the owner's request — not in Figma, but as `WaveFilledIcon` in
`src/components/icons/derived.tsx`, the same exported path with its interior subpath dropped —
and amended neither this section nor `.claude/agents/design-system.md`, so both read "no filled
twin" for four days while one shipped. PD-287 reverted it on 2026-08-24 and deleted the file, so
the paragraph above is true again. It is recorded because "authored and then deleted" now names
two different attempts, and because the way it went wrong is the ordinary one: the code changed
and the two documents asserting the opposite were not in the diff.

**That is a legibility argument, not a tooling one, and the difference matters if you generalise
it.** `Heart Filled`/`Heart Outline` and `Location Filled`/`Location Outline` both ship happily —
`currentColor` rewriting collapses a pair only when the two are the *same* outline duplicated,
which is what the wave's twin was.

The consequence in code is that `aria-pressed` on `PostcardActionButton` is now the whole of the
non-visual signal. So the accessible name was made **constant** in the same commit: it used to
flip to "Unlike, N likes", and a toggle that reports `pressed` *and* renames itself to the undo
action announces "Unlike, 5 likes, pressed" — named for undoing, reported as done. If a future
screen draws a like without `aria-pressed`, its state is invisible to a screen reader; the colour
is measured at 4.51:1 between states, which clears the 3:1 for a colour-only distinction but is
not a substitute for the attribute.

The full chain ran, so `design/` and `generated.tsx` are current — 54 icons, not 53:

```bash
node -p "require('./design/manifest.json').pulledAt"   # 2026-08-17
npm run figma -- icons | grep -i wave                  # wave  Wave  4127:6925
grep -c WaveIcon src/components/icons/generated.tsx    # 1
```

**The glyph shipping today carries NO third-party licence position, because it is drawn from
primitives rather than traced.** There is nothing to attribute and nothing to record. That
absence is worth stating rather than leaving implied: silence reads identically to a licence read
that is still pending, which is the state the traced glyph was in for a day. It is written into
the Figma component's `description` as well, where the next person to open the file will see it.

**The OFL analysis below is kept as the worked example, not as this icon's position** —
`.claude/agents/design-system.md` §Writing to Figma points here for it, and it generalises to any
OFL font, which is the next traced glyph anyone is tempted by. It applied to the *first* wave,
traced from `Noto Emoji` U+270C, and it is what cleared that one to ship.

`Noto Emoji` is SIL OFL 1.1, `Copyright 2013 Google LLC`, **no Reserved Font Name declared**
(`raw.githubusercontent.com/google/fonts/main/ofl/notoemoji/OFL.txt`). What settles it is the
licence's own DEFINITIONS, quoted from the primary text:

> "Font Software" refers to the set of **files** released by the Copyright Holder(s) under this
> license and clearly marked as such. This may include source files, build scripts and
> documentation.

Every obligation hangs off that noun. Clause 1 forbids selling the Font Software or its components
by itself; clause 2 is what attaches the copyright-notice-and-licence requirement, and it governs
bundling or **redistributing the Font Software**. We redistribute no file from it — what ships is
a `<path d="…">` in `generated.tsx`, derived from one glyph's outline — so neither clause has a
subject in our bundle. The definition is file-scoped, which is also why "components" does not
reach a single glyph.

SIL's own OFL-FAQ says the same thing directly: artwork created from font outlines is not subject
to the OFL, and it lists logos, signage, t-shirts and 3D-printed shapes as needing no further
licensing. **Flagged as second-hand** — `openfontlicense.org`, `scripts.sil.org`, the CTAN mirrors
and `choosealicense.com` are all egress-blocked from this container, so the FAQ reached me through
a search summary rather than its primary text. The licence text above is verbatim and is the part
the conclusion rests on.

So no attribution is required and none is legally load-bearing. Crediting Google in a `NOTICE` is
free courtesy and still worth doing. **What would change the answer is shipping the font file
itself** — bundling `NotoEmoji-Regular.ttf` puts clause 2 back in play immediately.

**That walk looked at the TRACED glyph, and the one shipping now has not been looked at in a
browser.** Said plainly because the paragraph below otherwise reads as cover for the current icon:
the run was 2026-08-16, 19/19 screens clean, 48/48 guard, navigation and sign-out checks correct,
the postcards feed screenshotted at 3x with the like control toggled both ways, `aria-label`
`Like, 0 likes` and `aria-pressed` returning to `false`. Everything there that is about the
*screen* still holds — the action row, the toggle and the accessible name are untouched by PD-242.
Everything about the *glyph* — that it reads at 24px, that its weight sits with Chat Bubble and
Paper Plane — was measured on the outline that has since been deleted. Re-running the walk is the
outstanding verification on this icon.

**No credential needed to be requested, and an earlier draft of this section wrongly said one did.**
`WALK_EMAIL` / `WALK_PASSWORD` are not in the environment and are not meant to be — §Test accounts
above already prescribes the route, and it takes about ten seconds: a session holds `execute_sql`
on DEV under the standing grant, so it sets a generated password on
`rider-1786033088990@letsride.dev`, walks, and rotates it back to a value nobody holds. That is
what happened here, and the password was rotated afterwards precisely because it had passed
through a transcript.

**Stroke weight is measured, not eyeballed, and it took three rounds to learn that.** The traced
glyph shipped light twice — once by an agent's judgement and once by a correction that was still
guessed after the product owner said it looked thin. Measured, it was **1.4px** against Chat
Bubble's 2.2, and was then tuned to 2.2 to match.

**The redraw did not inherit that match; PD-248 restored it.** The redraw came in at 2.45, above
the neighbour the traced glyph had been tuned against, and the product owner chose to re-match
rather than accept it — *"Lets do B straight away"*, 2026-08-17, option B of that issue's table.

```bash
npm run figma:measure -- wave chat-bubble paper-plane
# wave 2.2 · chat-bubble 2.2 · paper-plane 2.5     (was: wave 2.45, redrawn; 2.2, traced)
```

**Weight on this glyph is geometry, not a property, so "thinning" it is a redraw.** The
`strokes` array is empty — see the trap below — so there was no number to turn down. What PD-248
did instead, and the recipe to reuse, is a uniform **erosion**: re-strike the filled outline with a
CENTER stroke of weight `2d`, `outlineStroke()` it, and subtract that band from the glyph. Every
boundary moves inward by `d`, so the band loses `2d` of width and every *gap* — the notch between
the fingers — gains it. `d = 0.12` took 2.45 to 2.20.

**Two silent failures sit in that recipe and both were hit before it worked.** Neither errors,
and both leave a plausible-looking glyph, which is why they are written down rather than left to
be rediscovered:

- **An `outlineStroke()` node is inert in a boolean.** `figma.subtract([glyph, band])` returns the
  glyph *unchanged* — measured at erosion radii from 0.12 up to 2, where the result should have
  been visibly destroyed. `figma.subtract` itself is fine: a plain rectangle cuts the same glyph in
  half correctly. The fix is to round-trip the band through a fresh node —
  `figma.createVector()`, assign `band.vectorPaths`, then subtract that.
- **That fresh vector arrives carrying a default 1px CENTER stroke**, and the boolean bakes it in,
  eroding a further **0.5px per side** on top of whatever you asked for. It reads as a working
  erosion with the wrong constant: per-side shrink came out at `0.5 + d` and barely moved as `d`
  swept. Set `strokes = []` on it. With that cleared, per-side shrink tracks `d` to four decimals.

**Calibrate before writing to Figma, not after.** The two pipeline calls that carry a Figma edge
back into the repo — `figma:pull` and `figma:icons` — are the rate-limited ones. `d` was picked by
simulating the erosion locally first: rasterise `design/icons/wave.svg`, take an exact euclidean
distance transform, keep pixels further than `d` from the background, and run
`measure-icons.mjs`'s own median-run measurement over the result. That predicted 2.20 at
`d = 0.12`, and the real pipeline returned 2.20.

**Do NOT reach for `strokeWeight` in the snapshot to settle it — it is vestigial on this icon and
the trap is that it reads perfectly plausible.** The obvious command is the one to avoid:

```bash
node -e "const d=require('./design/components/element-icon-wave.json');
         console.log(d.children[0].strokeWeight)"   # 1 — and it draws nothing
```

That number sits beside a `strokes: []` array: the glyph is a **filled path**, so nothing applies
a stroke and the number is a leftover property. It read 2.2 before PD-248 and reads 1 after —
**it moved without the drawing's weight moving with it**, which is the cleanest possible
demonstration that it measures nothing. It is invisible in `design/`, because `extract.mjs` records
`strokeWeight` and not `strokes` — so a count across the set reads 40 of 46 at "2" and looks like
a row this icon is breaking. Both readings were published in this repo before the raw file was
checked. The REST node is where the answer is:

```bash
# strokes: []  ->  strokeWeight is decoration, use figma:measure instead
node -e "…figmaFetch('files/\$KEY?ids=<node>')…"   # scripts/figma/lib.mjs
```

`scripts/figma/measure-icons.mjs` rasterises an exported SVG in Chromium and takes the median run
of ink across rows, which is the stroke width for a line icon. **Read it only for outline icons** —
a solid glyph reports its own width — and compare against the icons a glyph will actually sit
beside, never a global average.

**`inkPct` is not interchangeable with stroke weight, and the wave is the case that proves it.** It
carries **22.4%** ink against Chat Bubble's 21.8%, because it is a hand rather than a simple round
shape, and its bbox is **17.8x19.4** against their ~21x21 for the same reason. So the row is not
identical in mass whatever the stroke does — that is the glyph, not a defect.

**The redraw moved the two numbers in opposite directions, which is the whole point of measuring
both.** Ink fell from the traced glyph's 34.9% to 25.1% while the stroke rose from 2.2 to 2.45. The
drop *is* the fix the product owner asked for — the detail crossing the fingers that read as noise
at 24px — and a single "is it heavier" question cannot express it. A screenshot answers neither
number, which is why both gates exist.

**PD-248's thinning then moved them together, and that is the expected shape rather than a second
finding.** Ink went 25.1% -> 22.4% as the stroke went 2.45 -> 2.20: a 10.7% drop against a 10.2%
thinning, which is what removing a uniform 0.12 from each side of a band *is*. **Read a large ink
drop as a defect only when the notch closed with it** — that pairing is detail being eaten, and it
is the one this glyph has actually suffered. Here the notch went the other way: erosion widens
every gap, so it is 0.24 wider at 24px than before.

**Look at it as well as measuring it, and look at the raster rather than the vector** — render
the committed SVG at **true 24px** and magnify that with nearest-neighbour, which is what a phone
draws; a 4x vector render is a different picture and hides exactly the rasterisation faults worth
catching. All three icons in the `/postcards` action row are `h-6 w-6`, so 24px is the real size
rather than a proxy. Neither check substitutes for the other: a number cannot see a notch close,
and a screenshot cannot see a 0.25px drift. Done that way on the committed `wave.svg` on
2026-08-17, and it passed: notch open, no line across the two raised fingers. Recorded because
this glyph shipped wrong twice on a guess, so "was the shipping file actually looked at" is a
question the next session would otherwise have to answer by redoing it.

**Three drafts were reviewed as `H`, `H2` and `H3`, and the shipped one is `H`.** Worth naming
because the first pass shipped `H2` — one letter apart, and the visible difference is a line
crossing the two raised fingers, which `H` does not have. `inkPct` is the number that separates
them: 25.1 for `H` against 30.5 for `H2`.

**All three drafts are deleted from the file and all three are still recoverable**, which is worth
knowing before anyone redraws one. Figma keeps version history and the REST API takes a `version`
parameter, so the pre-deletion file is readable — the drafts lived only between
`2388594355669001856` (2026-08-17T07:29Z) and the delete, so no committed snapshot ever held them
and `git` cannot help:

```bash
node -e "…figmaFetch('files/\$KEY/versions')…"                       # list versions
node -e "…figmaFetch('images/\$KEY?ids=<node>&format=svg&version=<id>')…"   # export one
```

`createNodeFromSvg` then reimports it faithfully. Figma flattens a fill-only glyph's export to a
single path, which costs nothing here because these are filled paths already — see the vestigial
`strokeWeight` above.

---
