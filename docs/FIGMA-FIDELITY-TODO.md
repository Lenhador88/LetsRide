# Figma fidelity — what is inferred and must be verified

The Postcards/Home screens were built **without access to the Figma file**. This file is the
register of what that cost. Every entry is a value that was inferred rather than read, and
each one is a thing a later pass must check against the design.

Per `CLAUDE.md` §Working Principles, a workaround that produces a lower-fidelity artifact is
**debt**, and the rule is to mark exactly what was inferred so it never passes silently as a
known value. That is what this file is for. Delete an entry only when it has been checked
against Figma — not when it merely looks right.

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
| `s3-alpha-sig.figma.com` | **403 at CONNECT** | This environment's **network policy**, not Figma. |

**The last row is the one that does not fix itself.** The 418 image fills are real and the API
hands back their URLs, but every URL points at Figma's S3 host, which the agent proxy refuses
before the request leaves the container. Since `/v1/images` returns render URLs on that same
host, **icon SVG export is expected to fail even once the 429 clears.**

Fix, in order of leverage:

1. **Allow `s3-alpha-sig.figma.com` and `figma-alpha-api.s3.us-west-2.amazonaws.com`** in the
   environment's network policy. Without this, no image or icon ever leaves Figma, regardless
   of rate limits or plan.
2. Wait out the 429 on `/v1/files/*`. This is free and needs no upgrade — do **not** buy a
   Figma plan to solve it, which fixes only the MCP path.
3. Publishing the library would make `/components` and `/styles` useful, but is not required:
   87% of fills reference a named style and those names ship in the `styles` map of any
   `/nodes` response.

Verify all of the above with the probe sweep in `docs/HANDOFF.md` before assuming any of it
is still true.

## What is NOT inferred

These came from the file and are already verified — do not re-derive or second-guess them:

- All 20 v2 colour tokens, all 16 Poppins type tokens (`CLAUDE.md` §Design System).
- The app background: 135° gradient `#F2ECE6` → `#CCB8A3`.
- Most-used geometry: radii `4`, `8`, `12`, `100`; padding `16`, `8`, `24`; spacing `8`, `4`, `16`.

Anything built from that list is correct by construction. The debt below is **composition**,
not styling.

## TODO — verify against Figma

Sections are filled in as screens are built. An unchecked box is a known unknown.

### Home / Postcards feed — the 29 frames

- [ ] Postcard card composition: image aspect ratio, corner radius, whether the image is
      edge-to-edge or inset within the card.
- [ ] Byline placement and content — avatar size, username position, timestamp format and
      whether a club name appears when the postcard is club-scoped.
- [ ] The like affordance: icon, its filled/outline states, whether a count sits beside it,
      and where the row sits relative to the image and caption.
- [ ] Caption treatment — truncation, line clamp, "more" affordance.
- [ ] Vertical rhythm between cards, and the feed's outer padding.
- [ ] Empty state — copy and illustration for a feed with no postcards.
- [ ] Loading state — skeleton vs spinner.
- [ ] Header: title, and whether the feed has a club filter or tab control.

### Create postcard

- [ ] The whole flow — entry point, image picker, crop/preview step, caption entry, club
      selector, and the submit affordance.
- [ ] Upload progress and failure states.

### Icons — blocked on the S3 host above

- [ ] Export all 44 from `Element / Icon / *` and retire `lucide-react` (12 files).
      Decision #4 forbids lookalike substitutes, so **no icon should be guessed** — a screen
      needing an unavailable icon should ship without it rather than with a wrong one.

## Rule for anyone building against this

If you need a value that is not in the verified list above, do **not** invent one silently.
Add it to this file as an unchecked box, pick the most defensible value, and leave a comment
at the call site pointing here. A guess that is written down is a task; a guess that is not
is a bug nobody will find.
