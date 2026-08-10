# The Figma snapshot

Everything in this directory is **generated** from Figma file `gDoteM1ow1AZpSEGSNhpc7`
(`LR - Mobile App`) and **committed on purpose**. Read it instead of calling the Figma API.

Do not hand-edit anything here except this README. Regenerate it.

## Why this exists

The Figma REST API rate limit is the single most expensive obstacle this project has hit —
it has cost multiple sessions in hours-long blocks, and `docs/FIGMA-FIDELITY-TODO.md` exists
entirely to register the design values it forced people to guess.

Three properties of the limit make it worse than it looks:

- **It is per endpoint family.** `/nodes` can refuse while `/versions` answers. One 429 is
  never evidence about another route.
- **The budget is inherited across sessions.** A brand-new container can 429 on its first
  ever call, having spent nothing.
- **Windows are measured in days, not hours** — and the 429 tells you exactly how many.

**Read `Retry-After`. It is real, and it is in seconds.** Verified 2026-08-03 by sampling it
61 seconds apart and watching it fall by 64: a true countdown, not a fixed constant, and
repeated requests neither reset nor shorten it. That measurement replaced a guess — the same
day, this file said windows "last hours"; the live header said **69 hours**.

Figma exposes it deliberately, along with two more signals, on every 429:

| Header | Example | Meaning |
|---|---|---|
| `retry-after` | `248933` | Seconds until this endpoint family clears |
| `x-figma-plan-tier` | `starter` | The plan the limit is being applied under |
| `x-figma-rate-limit-type` | `high` | Which limit was tripped |

`npm run figma:check -- --probe` prints the wait per endpoint and the clearing time, so
"when can I pull?" is one command with an exact answer. There is never a reason to guess it
again, and never a reason to poll: the countdown runs on wall-clock time whether you ask or
not.

The design file changes about once a month. So the fix is not a better retry strategy — it
is to stop asking. One pull produces a snapshot; everything downstream reads the snapshot.

**The previous attempt cached to `.figma-cache.json`, which is gitignored.** This container
is ephemeral and rebuilt per session, so that cache was empty every single time anyone
needed it — a cache that cannot survive is a cache that is never used. Committing the
derived artifacts is the whole point of this directory.

## The pipeline

| Command | Network? | What it does |
|---|---|---|
| `npm run figma:pull` | **yes** | One request for the whole file → `.figma-raw/` (gitignored, ~30 MB), then runs extract |
| `npm run figma:extract` | no | `.figma-raw/` → this directory. Pure, deterministic, re-runnable |
| `npm run figma:icons` | **yes** | Renders `Element / Icon / *` as SVG into `icons/` |
| `npm run figma:check` | one cheap call | Is the snapshot stale? Add `--probe` to sweep every endpoint |
| `npm run figma -- …` | no | Query the snapshot from disk |

Only `pull` and `icons` can be rate limited, and they are the only two you ever need to
retry. Everything else works offline forever.

They are separate commands because `/v1/images` and `/v1/files` are different buckets —
either can be open while the other is shut. Run whichever one works.

### Refreshing (monthly, or when `figma:check` says so)

```bash
npm run figma:check     # cheap — tells you whether a pull is even needed
npm run figma:pull      # the expensive call; extracts automatically
npm run figma:icons     # only if icons changed or are missing
npm run test:unit       # the extractor is covered
git add design && git commit -m "design: refresh the Figma snapshot"
```

If `figma:pull` returns 429 it now prints the exact wait and the clearing time. **Come back
then** — not sooner, and there is no point polling in between. The committed snapshot stays
usable throughout.

## Querying it

```bash
npm run figma -- ls                       # every frame and component
npm run figma -- ls postcard              # filtered
npm run figma -- tree "Home / Feed"       # structure, one line per node
npm run figma -- text "Home / Feed"       # every string, with its type token
npm run figma -- show 10:1                # the full pruned JSON
npm run figma -- tokens Grey              # token tables
npm run figma -- icons                    # exported icon list
```

`tree` is usually the one you want when building a screen: it gives names, sizes, and the
resolved token on every node in one screenful.

## What is in here

| Path | Contents |
|---|---|
| `manifest.json` | Provenance and counts — when it was pulled, which Figma version, how much it holds |
| `index.json` | Name → file map for every frame and component. What `query.mjs` resolves against |
| `tokens.json` | Colour and type tokens with usage counts, plus a geometry census |
| `TOKENS.md` | The same tokens as markdown tables, shaped like `docs/reference/design-system.md` so drift is a `diff` |
| `frames/*.json` | One pruned tree per top-level frame — the screens |
| `components/*.json` | One pruned tree per component set or standalone component |
| `icons/index.json` | The 44 `Element / Icon / *` names and node ids |
| `icons/*.svg` | Exported icons |

### What "pruned" drops

Vector path data (`fillGeometry`, `strokeGeometry`, `absoluteRenderBounds`) and properties
sitting at their defaults. Path data is the overwhelming bulk of a Figma file and is
worthless once a shape is rendered — dropping it is what makes the snapshot small enough
to commit.

What is kept: identity, bounding box, auto-layout, padding, spacing, corner radius, fills
(solid resolved to hex, gradients resolved to a CSS angle and stops), strokes, effects,
text content, resolved type, and **style names**.

Style names matter more than anything else here. The Variables REST API is Enterprise-only
and 403s permanently on this plan, but 87% of fills reference a *named paint style*, and
style names ship in the `styles` map of any node response. That is the entire reason this
project can read its own design system.

**Never convert these styles to Figma variables.** It would move the token layer from 87%
machine-readable to 0%, behind a 403 no credential can open.

## Privacy

The Figma file's image fills include personal photographs, among them a WhatsApp screenshot
with a real person's name and private conversation. They are content placed into the file,
not design layout.

This pipeline **references image fills by `imageRef` and never downloads them**, and nothing
here calls `/v1/files/:key/images`. Keep it that way. The icon export uses `/v1/images`, the
render endpoint, which returns only rendered vectors from node ids we chose.

## Limits worth knowing

- `/v1/files/:key/components` and `/styles` return 200 but **empty** — the library is
  unpublished. This pipeline does not need them; it reads styles off the node tree instead.
- `/v1/me` returning 200 means nothing. It has stayed green through every outage while
  every design-reading route refused.
- Icon render URLs point at `s3-alpha-sig.figma.com`. A 403 there is this environment's
  network policy, not Figma. That host was allowlisted on 2026-08-03.
- The Figma MCP server is a **separate monthly quota** — 6 tool calls/month on Starter,
  exhausted. The REST path is the one this project uses.
- **"The REST API is free and uncapped" is doubtful, and was never verified.** A 429 reports
  `x-figma-plan-tier: starter` and `x-figma-rate-limit-type: high`, and Figma exposes an
  `X-Figma-Upgrade-Link` header on these responses — all three point at REST limits being
  plan-tiered, not flat. What is *observed* is the tier being named in the refusal; what is
  **not** established is that a paid plan raises the ceiling, or by how much. Do not buy a
  plan on the strength of this, and do not repeat the old claim either. If it ever matters,
  the question to answer first is what the starter limit actually is.
- **The Variables API (`/v1/files/:key/variables/local`) is a permanent 403.** It needs the
  `file_variables:read` scope, which is not grantable outside an Enterprise org and errors
  during OAuth on lower tiers. This is a plan gate, not a credential problem — do not spend
  time regenerating tokens with different scopes ticked.
- `FIGMA_ACCESS_TOKEN` lives **only in the session environment**, never in the repo and not in
  `.env.local.example`. This container is ephemeral, so if the token is not in the environment
  config it dies with the session — and only the two network commands need it.
