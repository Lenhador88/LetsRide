# Figma fidelity — what is inferred and must be verified

The Postcards/Home screens are being built **without access to the Figma file**. This file is
the register of what that costs. Every entry is a value that would have to be inferred rather
than read, and each one is a thing a later pass must check against the design.

**The first Postcards screens were built on 2026-08-03 while the file was still 429** — the
feed, the card, the like control and the create flow. Every composition value in them is a
guess, and each one is now recorded below as *chose:* so verification is a diff against the
design rather than a re-derivation. The boxes stay unchecked until someone has actually
compared them.

The tokens those screens use are **not** guesses — colours, type and the background gradient
all come from the verified set. The debt is composition only.

Per `CLAUDE.md` §Working Principles, a workaround that produces a lower-fidelity artifact is
**debt**, and the rule is to mark exactly what was inferred so it never passes silently as a
known value. That is what this file is for. Delete an entry only when it has been checked
against Figma — not when it merely looks right.

## There is now a way out — `design/`

**Added 2026-08-03.** `scripts/figma/` builds a committed, offline snapshot of the design
file. One successful `npm run figma:pull` populates `design/` and answers most of the boxes
below without another API call, permanently. The pipeline is built and tested; it is waiting
on a rate-limit window, not on more work.

So before inferring anything on this list:

```bash
npm run figma:check          # is a snapshot even needed?
npm run figma:pull           # if this succeeds, most of this file is obsolete
npm run figma -- tree "Home / Feed"
```

If it 429s, the rules below still apply — but check first, because the cost of guessing is
now one command instead of an outage.

## Why the design was unreadable — measured 2026-08-03

Two independent blocks, and they need different fixes:

| Route | State | Nature |
|---|---|---|
| `/v1/files/:key`, `?depth=1`, `/nodes` | **429** | Rate limit. Free, uncapped, recovers on its own. |
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
control, and the create screen (`/postcards/new`). Every value below marked *chose* is in the
code right now and unverified.

### Home / Postcards feed — the 29 frames

- [ ] **Card composition** — *chose:* `rounded-xl` (12, a verified radius), `border-border`,
      `bg-surface`, image **inset within** the card and edge-to-edge horizontally, aspect
      **4:5 portrait**. Unread: the real ratio, and whether the card is bordered at all.
      → `src/components/postcards/PostcardCard.tsx`
- [ ] **Byline** — *chose:* avatar `md` (40px) + username Semibold 14 + a second line of
      `formatRelativeTime` and, for a club-scoped postcard, `· <club name>`; all above the
      image. Unread: placement (above vs overlaid), avatar size, timestamp format.
- [ ] **Like affordance** — *chose:* a **text-labelled** control ("Like"/"Liked") with the
      count beside it, below the image and above the caption, tinted `Accent Brand/100` when
      liked. The design uses `Element / Icon / Heart Filled` / `Heart Outline`, which cannot
      be exported yet; per the icon rule below, no lookalike was substituted. Swapping the
      icon in touches only `LikeButton.tsx`.
- [ ] **Caption treatment** — *chose:* **no** truncation or line clamp, `whitespace-pre-line`.
      A clamp would silently hide a rider's words; showing it in full is the reversible
      choice. Unread: the real clamp and any "more" affordance.
- [ ] **Vertical rhythm** — *chose:* `gap-4` (16) between cards, `px-4 py-6` feed padding,
      `max-w-lg` column. 16 is a verified spacing value; the rhythm is not.
- [ ] **Empty state** — *chose:* bordered panel, "No postcards yet" + one line of copy + a
      primary CTA. Unread: copy and whether an illustration belongs there.
- [ ] **Loading state** — **not built.** Skeleton vs spinner is unread, and the page is a
      server component with no client loading boundary yet.
- [ ] **Header** — *chose:* "Postcards" title + a "New postcard" button on the same row. No
      club filter or tab control was built. Unread: whether the design has one.
- [ ] **Pagination** — **not built.** `getFeed` is bounded and takes a `before` cursor, but
      paging vs infinite scroll is unread, so only the first page renders.

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

### Navigation

- [ ] **Tab bar** — *chose:* five tabs (Home, Rides, Clubs, Friends, Profile) on `bg-surface`
      with `Accent Brand/100` for the active tab. The design's five are Home, Rides, Clubs,
      **Inbox**, Profile — Inbox has no route or schema, and Friends is signed off for
      deletion but still routed, so this renders what exists. Unread: bar height, icon size,
      and whether "active" is a tint, an underline, or a filled icon.
      → `src/components/layout/Navbar.tsx`

### Icons — blocked on the render endpoint

- [ ] Export all 44 from `Element / Icon / *` and retire `lucide-react`.
      Decision #4 forbids lookalike substitutes, so **no icon should be guessed** — a screen
      needing an unavailable icon should ship without it rather than with a wrong one. That
      rule is why the like control is text-labelled.
      `npm run figma:icons` does the export in one command once `/v1/images` stops 429-ing.
      The one exception taken so far: `Navbar` swapped lucide `LayoutDashboard` → `Home`,
      because the former named a screen that no longer exists. All five nav icons are v1 and
      due for replacement regardless — that is one task, not five.
      (`git grep -l lucide-react -- 'src/*' | wc -l` for the current count.)

## Rule for anyone building against this

If you need a value that is not in the verified list above, do **not** invent one silently.
Add it to this file as an unchecked box, pick the most defensible value, and leave a comment
at the call site pointing here. A guess that is written down is a task; a guess that is not
is a bug nobody will find.
