# Handoff — where things stand

Branch: `claude/figma-token-access-yz21em` — docs only, no code change. PR #3 and #5 merged.

Read `CLAUDE.md` first. It carries the stack, the v2 design tokens, the settled
architectural decisions, the working principles, and the canonical Supabase project.
This file is only the *current position* — the things that will be stale in a week.

---

## Do this first

Nothing is on fire. The database is `ACTIVE_HEALTHY`, the deployment is live, and the
anonymous read hole is closed.

**Do not re-apply `002_restrict_to_authenticated`.** It is already applied, and it is not
idempotent — it was written to run once against the `001` schema.

Re-running it **fails partway and leaves the database worse than when it started.** Its
`profiles` block drops three policies and then creates `"Profiles are viewable by signed-in
riders"`, which already exists, so the script aborts there. `psql` autocommits, so the drops
have already stuck: `profiles` is left with a select policy and **no insert or update
policy**, which breaks profile editing for every user. It never reaches `club_members`,
`rides` or `ride_members`, so `008` survives intact and nothing leaks — the damage is
narrower than a leak, and easier to miss, because the tables you would think to check are
fine.

Verified by applying the full chain to a scratch database and re-running `002` over it.

To change any of those four tables, add a new migration. `008` is the current definition.

---

## State

| | |
|---|---|
| Migrations | All applied except `003_onboarding`. See the ordering note below. |
| Tests | `supabase/tests/` — RLS policy suite, 40 assertions, `npm test`. Gates every PR. |
| Workflow | OpenSpec adopted: `/opsx:propose` → `apply` → `archive`. Rules in `openspec/config.yaml`. |
| Design | v2 tokens, Poppins and light theme landed. Only `components/ui/*` migrated. |
| Spec | `docs/specs/login-onboarding.md` — 23 questions, all with defaults; four settled. |
| Squad | Nine agents in `.claude/agents/`. |
| CI | Green: type check, lint, build, RLS suite against Postgres 17. |
| Data | 1 rider, 1 club, 1 ride — all real, created through the deployed app. |

The app looks inconsistent on purpose: the cream v2 background is live, but `app/auth/*`
and `app/(app)/*` are still v1 `zinc-*`/`orange-500`. Those migrate with their own epics.

**Migration ordering is not file order.** Two chains were written in parallel and each
recreated the policies the other did. `004`–`007` reached the database before `002` did;
`008` reconciles them by taking `to authenticated` from `002` and the visibility predicates
from `004`. Verified by diffing the live policy set against a database built from the
chain — 22 policies, identical. Do not try to "tidy" the numbering; the end state is
correct and the divergence is recorded deliberately.

**`003_onboarding` is written but not applied**, and `supabase/tests/run.sh` skips it via
`SKIP_MIGRATIONS`. It drops `profiles.full_name` while 29 references across 10 files still
use it. Remove the skip entry in the same change that deploys it.

---

## Next piece of work: the Login epic

All five flows are marked **Done** in Figma, so the design is settled. The spec is written.
`003` is written. What remains is the application code.

Run `feature` on it. In the same change it must fix the **29 `full_name` references across
10 files** — `src/types/index.ts`, `EditProfileForm.tsx`, `SearchRiders.tsx`,
`auth/signup/page.tsx`, and the dashboard, profile, friends, `clubs/[id]`, `rides/[id]` and
rides pages.

**`003` and those call-site fixes are one coordinated change.** `003` drops `full_name`, and
`SearchRiders.tsx` filters on `full_name.ilike.%…%`, which becomes a hard Postgres error the
moment the column is gone. Applying `003` against `main` as it stands breaks the running app.

Then `test`, then `reviewer`, then a PR. Any migration in that change must add assertions to
`supabase/tests/rls_test.sql` — a policy change with no new assertion is not finished.

---

## Known issues, roughly by cost to fix

- **Duplicate usernames break signup.** `handle_new_user` falls back to the email local
  part, which is `UNIQUE`, so a second `dave@…` gets a raw "Database error saving new
  user" and no account. Fixed by the login epic, where username moves into onboarding.
- **Private clubs are unreachable from `/clubs`.** The page filters `is_public`, so a member
  of a private club has no way to navigate to it. Direct links work.
- **No edit or delete UI anywhere.** The `update`/`delete` RLS policies exist and are
  tested, but nothing calls them — you can create a ride and never fix a typo or cancel it.
- **Leaked password protection is disabled.** Supabase advisor flags it; a dashboard toggle
  that checks signups against HaveIBeenPwned.
- **Free tier auto-pauses after ~7 days idle**, taking the deployment down with no alerting.
  This already happened once, and restoring it is what reopened the anon hole. Pro before
  anything resembling launch.

---

## Deployment protection — settled

**Vercel SSO now applies to previews only.** Production at `letsrideapp.vercel.app` is
publicly reachable and the link is shareable; preview deployments still sit behind a Vercel
login, so unreleased work is not exposed.

Public production is safe here because access control does not depend on the URL being
secret: `proxy.ts` gates every route outside `/auth/*` behind a session, and `anon` holds no
table privileges at all. A signed-out visitor can reach the landing and auth pages and
nothing else.

---

## Known constraints

**Figma: use the REST API with a PAT, not the MCP server.** This is settled and it unblocks
`design-system`, which the previous handoff listed as quota-blocked. It no longer is.

The **MCP server is effectively dead on this plan**: Starter allows *6 tool calls per month*
total, regardless of seat. `whoami` is exempt from that quota, so it succeeds and tells you
nothing about whether reads will work — do not treat it as a green light. Every tool that
reads design data is metered, and the quota is currently exhausted.

The **REST API on a personal access token has no such ceiling.** `FIGMA_ACCESS_TOKEN` is set
in the environment (`figd_…`, 14 read/write scopes). Verified working:

| Endpoint | |
|---|---|
| `/v1/me` | ✅ authenticates as `pedro88email@gmail.com` |
| `/v1/files/:key`, `/v1/files/:key/nodes` | ✅ full node tree, all depths |
| `/v1/images/:key?format=svg` | ✅ returns render URLs — icon export works |
| `/v1/files/:key/variables/local` | ❌ **403, permanently** |
| `/v1/files/:key/components`, `/styles` | ⚠️ 200 but empty — library is unpublished |

**The Variables API is Enterprise-only and no token will ever fix it.** The 403 says
`This endpoint requires the file_variables:read scope`; that scope is not grantable outside
an Enterprise org and errors during OAuth on lower tiers. Do not spend time regenerating
tokens with different scopes ticked — this is a plan gate, not a credential problem.

**It does not matter, because this design system is built on styles, not variables.** Of
1,289 solid fills on the Components page, **87.4% reference a named paint style**, 10.8% are
raw hex, and only 1.8% are bound to a variable. Style *names* come back in the `styles` map
on any `/nodes` response — so `Grey/100`, `Poppins/14/Medium` and the rest are fully
readable without Enterprise. Token extraction is a solved problem; see the table below.

**Do not "modernise" the Figma file by converting styles to variables.** It would take the
token layer from 87% machine-readable to 0% — every one of those fills would move behind the
403. This is the rare case where the older Figma feature is the one that works for us.

The file is `LR - Mobile App` (`gDoteM1ow1AZpSEGSNhpc7`), last modified 2026-06-04, three
pages: `Design`, **`Components`** (node `50:559`), `Archive`. The Components page holds 2,447
nodes — 52 component sets covering 213 variants, 88 standalone components, and **44 icons**
under `Element / Icon / *`, including the motorcycle-specific Bike, Garage, Wrench,
Coordinates and Store that `lucide-react` cannot supply.

### Extracted tokens — verified against the file, 2026-08-01

Names are Figma style names; values are the resolved fills. Anything marked `(OLD)` is v1 and
must not be used — `CLAUDE.md` already says to ignore it, and the file confirms nine such
styles still in active use inside v2 components.

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `Grey/5` | `#F2ECE6` | | `Accent Brand/100` | `#3D996B` |
| `Grey/80` | `#666666` | | `Accent Brand/110` | `#338059` |
| `Grey/100` | `#1A1A1A` | | `Accent Brand/50%` | `#3D996B` @50% |
| `Grey/60` | `#808080` | | `Warning/100` | `#D92140` |
| `Grey/10%` | `#000000` @10% | | `Warning/90` | `#FF3355` |
| `Grey/20%` | `#000000` @20% | | `Warning/110` | `#99001A` |
| `Grey/70%` | `#000000` @70% | | `Pink/100` | `#F23071` |
| `White/100` | `#FFFFFF` | | `White/10%` | `#FFFFFF` @10% |
| `White/5%` | `#FFFFFF` @5% | | | |

Type — all Poppins, `size/line-height weight`:
`10/16 500` · `10/16 600` · `12/18 400` · `12/18 500` · `12/18 600` · `14/20 400` ·
`14/20 500` · `14/20 600` · `16/24 400` · `16/24 500` · `16/24 600` · `18/26 600` ·
`20/30 500` · `20/30 600` · `24/36 600` · `40/60 600`

Most-used geometry, for the primitives that still carry inferred v1 shapes: corner radii
`4` (x147), `100` (x110), `8` (x85), `5` (x52); spacing `paddingLeft 16` (x99),
`itemSpacing 8` (x86), `itemSpacing 4` (x66), `itemSpacing 16` (x40).

**`CLAUDE.md`'s Design System tables are incomplete and one entry is wrong** — not yet
corrected, because that file is durable context and this was a read-only session:

- It lists 7 colours; there are **20 live v2 tokens**. Missing most notably `Warning/100`
  `#D92140`, which is what `<Button variant="danger">` should be using.
- It lists 8 type tokens; there are **16**.
- It lists `Poppins/32/Semibold` (32/48, w600). **No such style exists in the file.** The
  large sizes are `24/36 w600` and `40/60 w600`. Whoever picks up `design-system` should fix
  this before building against it.

Reproduce any of the above with:
`curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" "https://api.figma.com/v1/files/gDoteM1ow1AZpSEGSNhpc7/nodes?ids=50:559"`
— the `styles` map on the response gives name → id, and node `styles.fill` / `styles.text`
give id → usage.

**`FIGMA_ACCESS_TOKEN` lives only in the session environment.** This container is ephemeral;
if the token is not in the environment config it dies with the session. It is not in
`.env.local.example` and must not be committed.

**Eleven `[inferred]` strings remain in `docs/specs/login-onboarding.md`** — button and input
label text the old quota cut off. These are now cheaply verifiable via the REST API and
should be resolved in the login epic rather than carried further.

**Unverified from an earlier session:** the four migrated primitives kept their v1 shapes
(padding, radius, focus treatment). Tokens are correct; geometry is inferred and flagged in
the commit. The Figma pass should verify them.

**The agent proxy blocks outbound HTTPS to `supabase.co` and `vercel.app`.** Verify database
state through the Supabase MCP tools and the deployment through the Vercel MCP tools rather
than `curl`. Note that Vercel's fetch tool authenticates as the account owner, so a 200 from
it is not evidence that a URL is publicly reachable.

---

## Open questions for the product owner

1. **Terms & privacy pages must be publicly readable** — you legally have to show them
   before signup completes. This is a narrow, deliberate exception to "no anonymous access"
   (two static pages on a proxy allowlist, no data access). Not yet approved.
2. **Email confirmation is off.** Deliberate and recorded, but it means anyone can sign up
   with an address they do not control. Must be revisited before public launch.
3. **Branch protection on `main` is not enabled**, and **an agent session cannot enable it** —
   the GitHub MCP server has no branch-protection tool, and the REST endpoint returns 403
   because repo settings are outside what the session's GitHub access grants. It needs a
   human in the repo settings.

   With agents pushing, this is what makes "CI is the safety net" true rather than
   aspirational. Recommended for `main`:

   - Require a pull request before merging (0 approvals is fine for a solo maintainer)
   - Require status checks: **`Type Check, Lint & Build`** and **`RLS Policy Tests`** —
     these are the job `name:` values in `ci.yml`, and a check is only selectable in the UI
     after it has run at least once
   - Require branches to be up to date before merging — this is the one that would have
     caught today's semantic conflict, where two branches each rewrote the same policies
   - Do not allow bypassing the above. Agents push with an owner-level token, so without
     this the rules do not bind the thing they exist to constrain
   - Leave force pushes and deletions disallowed

   If CI ever breaks and blocks an urgent fix, the rule can be toggled off in settings —
   enabling it is not a lock-out.
