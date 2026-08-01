# Figma REST API

The Figma MCP server is quota-limited on our plan — it cut `spec` off after five
calls, and `design-system` needs roughly two orders of magnitude more than that
(~30 components with full variant matrices, ~40 icon exports). The REST API is
the way through: a personal access token, no per-session call ceiling, and
batching that lets one request do what a dozen MCP calls did.

This document is the configuration and the endpoint map. It is not a licence to
start the design-system work — read `docs/HANDOFF.md` for where that stands.

---

## Status: blocked on egress

**`api.figma.com` is not on this environment's outbound allowlist.** Every
request fails at the proxy before it reaches Figma:

```
curl: (56) CONNECT tunnel failed, response 403
```

`www.figma.com` is blocked too, so the whole domain is off the policy, not just
the API host. Nothing below has been exercised against the live API — the token
is unverified, and so are its scopes.

**To unblock:** add `api.figma.com` to the environment's network policy
(Claude Code → environment settings → network access;
https://code.claude.com/docs/en/claude-code-on-the-web). Then run
`scripts/figma.sh me`, which is the cheapest call that proves auth works.

Until that lands, use the MCP tools and spend the quota deliberately.

---

## Setup

`scripts/figma.sh` reads `FIGMA_ACCESS_TOKEN` from the environment first, and falls
back to `.env.local`. There are two places to put it, and they are not equivalent.

**Agent sessions — the Claude Code environment settings.** This is the one that
persists. Remote sessions run in an ephemeral container that clones the repo fresh
and is reclaimed after idle, so a token written to `.env.local` during a session is
gone by the next one.

There is no settings page or direct URL. At claude.ai/code, click the cloud icon
showing the environment's name in the row above the message box, hover the
environment, and click the gear. The dialog holds network access, environment
variables and the setup script. Add to **Environment variables**, `.env` format:

```
FIGMA_ACCESS_TOKEN=figd_…
```

Two things to know before doing that:

- **Values are readable by anyone who uses the environment, and there is no secrets
  store.** Anthropic's docs say plainly: "don't add API keys or other credentials."
  For a *personal* environment that audience is one person, and a read-scoped Figma
  token is a small blast radius — but scope it to read, and rotate it if the
  environment is ever shared. Do not put a Supabase service key here.
- **A running session copies the values once at startup and never re-reads them.**
  Setting the variable does nothing for the session you are in; start a new one.

And the network side, in the same dialog — set **Network access** to **Custom**, then
put `api.figma.com` in **Allowed domains**. **Tick "Also include default list of
common package managers."** Custom without that box replaces the Trusted list rather
than extending it, so `npm install` stops working. GitHub is unaffected either way;
it goes through a separate proxy.

**Local development — `.env.local`**, gitignored via `.env*.local`:

```
FIGMA_ACCESS_TOKEN=figd_…
FIGMA_FILE_KEY=gDoteM1ow1AZpSEGSNhpc7
```

`.env.local.example` carries the placeholders. Because the environment wins over the
file, a session with the variable set needs no `.env.local` at all.

Do **not** put the token in `.claude/settings.json` — that file is committed, so an
`env` block there puts the secret in git. `.claude/settings.local.json` is gitignored
for exactly this reason, but it lives in the same ephemeral container and so buys
nothing over `.env.local`.

**This is a tooling credential, not an application one.** The Next.js app never
reads it. Never prefix it `NEXT_PUBLIC_` — that ships it in the client bundle to
every visitor. It does not belong in Vercel's project env vars either; nothing at
runtime needs it.

Create tokens at Figma → Settings → Security → Personal access tokens. Scoped
tokens need at least:

| Scope | For |
|---|---|
| `file_content:read` | Files, nodes, components, styles, image exports |
| `file_dev_resources:read` | Dev-mode annotations, if we ever read them |
| `file_variables:read` | Variables — **Enterprise plans only**, see below |

---

## Usage

`scripts/figma.sh` wraps auth and turns Figma's error codes into messages that
say what to do. Raw JSON on stdout, diagnostics on stderr, so pipes stay clean.

```bash
scripts/figma.sh me                          # verify token + see which scopes it has
scripts/figma.sh file 2                      # document tree, depth 2
scripts/figma.sh nodes "1:23,4:56"           # subtree for specific nodes
scripts/figma.sh images "1:23,4:56" svg      # export URLs
scripts/figma.sh components                  # published components in the library
scripts/figma.sh get "/v1/files/$FIGMA_FILE_KEY?ids=1:23&geometry=paths"
```

`get` takes any path — the named subcommands are shorthand, not a boundary.

---

## MCP tool → REST equivalent

| MCP tool | REST |
|---|---|
| `get_metadata` | `GET /v1/files/:key?depth=2` — shallow tree, cheap. Raise `depth` per subtree rather than fetching the whole document deep. |
| `get_design_context` | `GET /v1/files/:key/nodes?ids=…` — full node properties: fills, strokes, `absoluteBoundingBox`, `layoutMode`, padding, `itemSpacing`, `cornerRadius`, typography. |
| `download_assets` | `GET /v1/images/:key?ids=…&format=svg` — returns time-limited URLs; fetch them in a second step. |
| `get_screenshot` | `GET /v1/images/:key?ids=…&format=png&scale=2` |
| `get_variable_defs` | `GET /v1/files/:key/variables/local` — **Enterprise only.** See below. |
| (no equivalent) | `GET /v1/files/:key/components`, `/component_sets`, `/styles` — enumerate the published library. Useful for finding every `v2 / Component / *` in one call. |

Image fills (photos placed inside frames) come from
`GET /v1/files/:key/images`, which is a different endpoint to `/v1/images/:key`.
Easy to confuse; they return different things.

### The variables catch

`GET /v1/files/:key/variables/local` is restricted to Enterprise organisations.
On Starter it returns 403 no matter how the token is scoped. The MCP
`get_variable_defs` has no such restriction — so for **design tokens specifically,
the MCP tool is not replaceable by REST on our plan.**

In practice this costs us little: the v2 colour and type tokens are already
recorded in `CLAUDE.md` and wired into `globals.css`. Budget a couple of MCP
calls for any token that isn't, and use REST for the bulk work — geometry,
variant matrices, icon exports — which is where the quota actually went.

*Unverified:* this follows Figma's documented plan restriction, not a live 403
from our token. Confirm with `scripts/figma.sh variables` once egress is open,
and correct this section if it turns out we have access.

---

## Working within the limits

Rate limits are per-endpoint and cost-based rather than a flat ceiling, and
`/v1/images` is by far the most expensive. Figma answers `429` with a
`Retry-After` header when you exceed one.

What actually keeps us under it:

- **Batch ids.** `ids=1:23,4:56,7:89` in one call, not a loop of three. This is
  the single biggest difference from how the MCP tools were being used.
- **Go shallow first.** `depth=2` to find the nodes you want, then one deep call
  on those ids. Fetching the whole document deep is the classic way to burn the
  budget on data you discard.
- **Cache to disk.** Node JSON does not change between agent runs. Write it under
  the scratchpad and re-read rather than re-fetching.
- **Export once.** Icon SVGs land in `src/components/icons/` and are then a repo
  concern, not an API one.

Honour `Retry-After` on a 429 rather than retrying tighter — Figma's limits
tighten under repeated violation.

---

## Rules

- The token never enters git, a commit message, a PR body, or a log line. If it
  leaks, rotate it at Figma → Settings → Security, which invalidates the old one
  immediately.
- Read-only. Nothing here writes to Figma — the design file is owned by a human
  designer, and REST access does not change that.
- The v1/v2 split still applies: `v2 / Component / *` is canonical, `Component / *`
  and anything `(OLD)` is superseded. The API returns both without distinguishing
  them; filter by name.
- A value read from the API is a known value. A value read off a screenshot is a
  guess and must be labelled as one — see the working principles in `CLAUDE.md`.
