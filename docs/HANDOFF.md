# Handoff — where things stand

Branch: `claude/login-flow-architecture-fz2zxu` — the login epic, **half landed**. The data,
auth and validation layers are built and tested; the five screens are not.

Read `CLAUDE.md` first. It carries the stack, the v2 design tokens, the settled
architectural decisions, the working principles, and the canonical Supabase project.
This file is only the *current position* — the things that will be stale in a week.

---

## Do this first

**The login epic is shipped.** PR #8 merged to `main` as `0e30556` on 2026-08-02, migration
`003` applied to the hosted project, and the production deployment is `READY` on
`letsrideapp.vercel.app` with no runtime errors. Nothing is outstanding from it.

Verified on the live database after applying, not just in CI: completion is refused while
`location` is NULL and is one-way once set; reserved, too-short and uppercase usernames are
all rejected with `23514`; 22 policies exist and every one is `to authenticated`; `anon`
holds zero table grants. Security advisors show nothing new — only the pre-existing
leaked-password toggle.

Two things to expect rather than debug:

- **The one existing rider (`pedrousername`) has `onboarding_completed_at` NULL**, so their
  next visit routes them to `/onboarding/location` to supply a city before they reach the
  app. That is decision #5 working as designed. A one-row backfill would skip it if that is
  not wanted.
- **`terms_accepted_at` is still client-writable.** `enforce_onboarding_completion()` pins
  the onboarding stamp but not the consent stamp, so a rider can clear or back-date their
  own. The action checks its write now; the schema guard is an unwritten migration and a
  product decision. `CLAUDE.md` names T&C acceptance as an integrity rule the client must
  not own, so this is a real gap, not a nitpick.

Nothing is on fire. The database is `ACTIVE_HEALTHY`, the deployment is live, and
the anonymous read hole is closed.

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
| Tests | `supabase/tests/` — RLS policy suite, 69 assertions, `npm test`. Gates every PR. |
| Workflow | OpenSpec adopted: `/opsx:propose` → `apply` → `archive`. Rules in `openspec/config.yaml`. |
| Design | v2 tokens, Poppins and light theme landed. Only `components/ui/*` migrated — and `--text-display` is built on a Figma style that does not exist, see above. |
| Spec | `docs/specs/login-onboarding.md` — 25 questions, all with defaults. The data-layer build took the defaults for Q1–Q9, Q11, Q13, Q14, Q23. |
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

**`003_onboarding` is written and tested but still not applied to the hosted project.**
`supabase/tests/run.sh` no longer skips it — `SKIP_MIGRATIONS` is empty and CI applies the
whole chain, with 69 assertions covering what `003` introduces. 24 of the 29 `full_name`
references are fixed; the remaining 5 are all in `src/app/auth/signup/page.tsx`, which the
login epic replaces wholesale rather than editing twice.

---

## Figma rate limits are PER-ENDPOINT — this cost hours, don't repeat it

`/v1/files/:key/nodes` returned `429` for over three hours on 2026-08-02. The wrong
conclusion — the one drawn here for most of that time — was "Figma is unreachable". It was
not. Measured in the same minute, with the same token:

| Endpoint | State |
|---|---|
| `/v1/files/:key/nodes` | **429** |
| `/v1/files/:key` (whole file, `depth` optional) | **200** |
| `/v1/images/:key` | **200** |
| `/v1/files/:key/styles`, `/components` | 200 but empty (library unpublished) |
| `/v1/me` | 200 |

**Always probe the whole-file endpoint before declaring Figma blocked.** It is also the
better call: one request returned the entire document *and* the `styles` map — everything
`/nodes` would have given, for every page at once. ~30 MB in about 7 seconds. Cache it to
disk and query it offline; never hold it in context.

The MCP server is a separate, monthly quota and is genuinely exhausted: one `get_metadata`
succeeded, `get_design_context` never did. Do not spend time there — the REST whole-file
route makes it unnecessary.

Everything extracted from that pull is written up under *Verified measurements* in
`docs/specs/login-onboarding.md`: every string verbatim, component geometry, fills, and the
screen layout. **That section supersedes §Screens wherever they disagree.**

## Next piece of work: the Login epic

All five flows are marked **Done** in Figma, so the design is settled. The spec is written.
`003` is written. What remains is the application code.

**The non-visual half is built, reviewed and pushed.** Branch
`claude/login-flow-architecture-fz2zxu`, six commits, all suites green: 69 RLS assertions,
72 unit tests, `tsc` clean, `next build` passing at 16 routes.

Landed:

| | |
|---|---|
| Schema | `003` verified against the spec; no longer in `SKIP_MIGRATIONS`, so CI applies the whole chain |
| Call sites | 24 of 29 `full_name` references fixed; `Profile.username` now nullable |
| Proxy | Rewritten as a public-path denylist, plus the onboarding gate |
| Auth | `/auth/callback` with an open-redirect guard, placeholder `/legal/*` |
| Writes | Server Actions in `src/lib/actions/` — the first in this codebase |
| Reads | `src/lib/data/`, and `PUBLIC_PROFILE_COLUMNS` for other riders' rows |
| Validation | Zod schemas in `src/lib/validation/`, shared client and server |
| Tests | Vitest as `npm run test:unit`, wired into CI |

**Still to build — all of it blocked on Figma:** the five screens (splash, login, sign up,
forgot/create password, the two onboarding steps) and the primitives they need (Checkbox,
pagination dots, logo, avatar picker), plus verifying `Button` and `Input` against the
measured 310×56 / 310×40 / 310×72 geometry.

Three decisions were taken on defaults rather than sign-off, and are cheap to reverse now and
expensive later:

- **Server Actions** for all writes. There were zero `'use server'` files before; the legacy
  `supabase.from()` + `router.refresh()` pattern survives only in `JoinRideButton` and
  `JoinClubButton`.
- **Zod** as the one new runtime dependency.
- **The profile-picture step is deferred** to a `media` follow-up, per the spec's own
  recommendation, so onboarding is two steps and the wizard shows two dots, not three.

### Open, needing a decision

- **`terms_accepted_at` is not protected.** `enforce_onboarding_completion()` makes the
  onboarding stamp one-way but leaves the consent stamp writable, so a rider can clear or
  back-date their own. Worse: `CLAUDE.md` names T&C acceptance as an integrity rule the
  client must not own, and if email confirmation is ever switched on (decision #6 says
  revisit before launch), `signUp` loses its live session and the consent write is refused
  entirely. The action now checks the result; the schema guard is still a migration nobody
  has written.
- **`src/app/auth/signup/page.tsx` still writes `full_name`** — the last of the ten files.
  Left alone deliberately: the Sign up screen replaces it wholesale. Harmless only while the
  branch stays unmerged.

---

## Building to the design — read before starting

Figma access is solved (see Known constraints) and `CLAUDE.md`'s token tables are now correct
and complete. What follows is the shape of the work, measured on 2026-08-01 rather than
estimated.

**"Applying the design" is roughly one fifth restyling and four fifths building product that
does not exist.** The code is 12 routes and 11 components with 139 v1 token occurrences
across 17 files. The design is 6 sections — Login, Home, Rides, Clubs, Inbox, Profile —
backed by 52 component sets, 213 variants, 88 components and 44 icons. The gap is structural,
not cosmetic:

- **The design has no Friends tab.** The five tabs are Home, Rides, Clubs, Inbox, Profile.
  `/friends` is not restyled, it is **deleted**, and `friendships` is a v1 leftover. This is a
  product decision that has not been explicitly signed off — confirm before deleting.
- **The design's home is Postcards**, a photo feed. The app's home is `/dashboard`. The
  central screen of the product is not built.
- **Inbox, Garage and trust & safety have no routes and no tables.** The schema is
  `profiles`, `rides`, `ride_members`, `clubs`, `club_members`, `friendships` — nothing behind
  postcards, messages, garage or blocks. Most of this is `data` → `feature`, not CSS.

**Suggested order.** The ratings are impact on shipping a product that matches the design.

| # | Work | Impact | Notes |
|---|---|---|---|
| 1 | `design-system` — v2 library + 44 icons, retire `lucide-react` | 8/10 | Gates all screen work |
| 2 | Login epic — **screens only**, the rest is built | 7/10 | Blocked on Figma, see above |
| 3 | Restyle the 12 existing routes v1 → v2 | 4/10 | Days, but only *after* 1 |
| 4 | **Postcards / Home** | 10/10 | New tables + Storage + EXIF; the core loop |
| 5 | Inbox — DMs, ride chat, notifications | 8/10 | New tables + `realtime` |
| 6 | Trust & safety — block, report, hide | 7/10 | RLS-level; needed before real users |
| 7 | Garage | 5/10 | Self-contained, lowest urgency |

**Do not restyle screen-by-screen before `design-system` lands.** Twelve routes each
re-deriving tokens is how drift gets baked in. This was a live risk until today: the token
table omitted `Warning/100` `#D92140`, so every `<Button variant="danger">` built against the
old docs would have used the wrong colour.

**One number is still missing: how many screens sit inside each design section.** Figma
started returning `429` and four backoff retries over ~80s did not clear it, so this was left
unmeasured rather than guessed. It is the difference between weeks and months on Postcards.
One call once the window resets:

```
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/gDoteM1ow1AZpSEGSNhpc7/nodes?ids=0:1&depth=3"
```

Get this before committing to any timeline.

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

The **REST API on a personal access token has no monthly cap**, but it throttles harder than
it first appears. After pulling the full Components page (2.3 MB) plus a handful of smaller
requests, everything returned `429 Rate limit exceeded` and **stayed 429 for over ten
minutes** across repeated backoff. Treat it as a real budget, not a per-minute hiccup.

Practical consequences for `design-system`, which needs the most calls of any task here:

- **Batch.** `/v1/images` takes comma-separated ids — fetch all 44 icons in one or two calls,
  never 44 separate ones.
- **Cache to disk.** One `/nodes` pull of the Components page (node `50:559`) contains every
  component, variant, fill, style reference and geometry value. Save the JSON and query it
  locally instead of re-fetching. That single response answered nearly every design question
  in this session.
- **Budget the big pull first**, then work offline from it.

`FIGMA_ACCESS_TOKEN` is set in the environment (`figd_…`, 14 read/write scopes) and persists
across sessions. Verified working:

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
must not be used — `CLAUDE.md` already says to ignore it, and the file confirms twelve such
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

**`CLAUDE.md`'s Design System tables were incomplete — now corrected, 2026-08-02.** It listed
7 colours against 20 live v2 tokens (missing `Warning/100` `#D92140`, which is what
`<Button variant="danger">` uses) and 8 type tokens against 16. Both tables are now full.

**One claim in the list above was itself wrong and is retracted:** it said
`Poppins/32/Semibold` does not exist. **It does** — style `503:6020`, and it is what every
screen title in the login epic uses; the Login title node resolves to `fontSize 32,
lineHeight 48, weight 600`. The likeliest origin of the error is that the counts were taken
from the Components page, where that style happens to be unused — a style can exist in the
library without appearing there. `--text-display` in `globals.css` was correct all along.

Also corrected: the app background is a 135° gradient `#F2ECE6` → `#CCB8A3`, not a flat
`Grey/5`, and the splash is flat `Accent Brand/100`.

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
