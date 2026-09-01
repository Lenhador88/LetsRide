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
other answer. `docs/HANDOFF.md` §The wave icon carries the legibility argument and both round
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
grep -rln "OptionsIcon" src/components/ | grep -v icons/   # 7: account, rider, postcard, club, ride, club thread, club timeline join row
```

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
