# Handoff — where things stand

Last shipped: the **Postcards/Home backend** (PR #15, merged `dd72c96`) — migrations `009`
and `010`, the feed data layer and actions, and client-side EXIF stripping. Before that, the
**login & onboarding epic** (PR #8, merged `0e30556`). No branch is in flight — start new
work from `main`.

**The Postcards UI is the next thing to build, and it is blocked on Figma.** Everything
behind it is done and on `main`; nothing has been drawn. See *Do this first*.

Read `CLAUDE.md` first. It carries the stack, the v2 design tokens, the settled
architectural decisions, the working principles, and the canonical Supabase project.
This file is only the *current position* — the things that will be stale in a week.

## Before you trust this file

Everything below is a claim about state that moves without this file moving with it. Two
commands settle whether it is current, and they cost seconds:

```bash
git log --oneline -3 origin/main                  # what actually shipped
git diff --stat origin/main -- docs/HANDOFF.md    # is this file itself unmerged?
```

If the second prints anything, someone edited the handoff and it never reached `main` —
which has happened, and is why a `Stop` hook now warns about exactly that
(`.claude/hooks/handoff-landed-check.sh`).

**Database and deployment state cannot be checked from the shell.** `api.github.com` is
refused by the proxy ("GitHub access is not enabled for this session") and `supabase.co` is
blocked, so any `curl`-based check here fails silently and tells you nothing. Use the GitHub,
Supabase and Vercel MCP tools instead — a silent `curl` loop looks identical to a passing one.

---

## Do this first

**The Home/Postcards backend is SHIPPED** — PR #15, merged to `main` as `dd72c96` on
2026-08-03, CI green on both jobs. Nothing is in flight.

**What is left is the UI, and only the UI.** No page, component or screen exists: the whole
epic so far is schema, policies, Storage, reads, actions and image processing. The next
session's job is the feed screen, the postcard card, the create flow, the icon set, and the
`/dashboard` + `/friends` deletions — all of which need the design.

**Try `npm run figma:pull` before anything else.** As of 2026-08-03 the node routes were
still 429, but the snapshot pipeline is now in place: one successful pull populates `design/`
and the design stops being a blocker permanently. See *The Figma snapshot* below. If it 429s,
do not poll it — build what does not need the design, and keep registering inferred values in
`docs/FIGMA-FIDELITY-TODO.md`.

Migration `009_postcards_and_blocks.sql` is **applied to the hosted project and verified
live** (2026-08-02). No drift: the repo chain and the database agree.

It creates `postcards`, `postcard_likes` and `blocks`, plus `private.is_blocked()`, and
applies the block predicate to `profiles`, `club_members`, `rides`, `ride_members` and
`friendships` so decision #2 holds everywhere the moment blocking exists. Verified by
applying the full `001`–`009` chain to a scratch Postgres and running the suite green.

**It drops SELECT policies on those five tables by catalog lookup before recreating them.**
It applied cleanly, but note the shape for any future rerun: an abort partway leaves those
tables with no select policy — deny-all. That fails *closed*, unlike `002`, so the damage
mode is "riders see nothing" rather than a leak.

Verified on the live database, not asserted — these are the environment-specific things the
RLS suite runs on plain Postgres and structurally cannot see:

| Check | Result |
|---|---|
| `postcards`, `postcard_likes`, `blocks` exist, RLS enabled | ✅ all three |
| Policies not `to authenticated` | 0 |
| `anon` table privileges | 0 |
| `is_blocked` in `public` / in `private` | 0 / 1 — off the PostgREST surface |
| `authenticated` USAGE on `private` | false |
| `authenticated` UPDATE on `postcard_likes` / `blocks` | false / false |
| SELECT policies per table | **exactly 1 each** — no leftover from the drop loop |
| Total policies | 22 → 32 |
| Security advisors | only the pre-existing leaked-password toggle |

The "exactly 1 SELECT policy per table" row is the load-bearing one: policies for a command
are OR'd, so a single leftover would silently undo the whole block predicate.

Reproduce the whole set with the queries in §Verification at the foot of the migration file.

Finally, impersonated as the one real rider (`set local role authenticated` +
`request.jwt.claims`), profiles, clubs, club_members, rides and ride_members all still
return their rows — the policy replacement caused no regression for the live user.

Product owner sign-offs taken this session, both previously listed here as unconfirmed:

- **`/dashboard` is to be deleted**, and Postcards becomes the home screen.
- **`/friends` is to be deleted** along with the `friendships` v1 leftover.

Neither deletion has happened yet, and **the order matters**: `proxy.ts` redirects a
signed-in rider to `/dashboard`, so deleting it before the feed route exists leaves login
landing on a 404. Delete it *with* the feed, not before.

The approved first UI slice is **view + like + create**. Comments and shares stay out of
scope, and `009` deliberately creates no table for them. Create was added after it became
clear that view + like alone renders an empty feed forever — nothing can put a postcard in it.

**Migration `010_postcard_storage.sql` is applied and verified live** (2026-08-03). No drift:
`001`–`010` are all applied. It creates the private `media` bucket and the `storage.objects`
policies, and drops and recreates two of `009`'s postcards policies to bind `image_path` to
the author's own Storage folder.

Verified on the hosted project after applying:

| Check | Result |
|---|---|
| `media` bucket | `public=false`, 5242880, `{image/jpeg}` |
| `storage.objects` RLS | enabled |
| Storage policies | 3 — INSERT / SELECT / DELETE, no UPDATE, all `to authenticated` |
| `public` policies | 32, unchanged (the two recreated replaced their originals) |
| `postcards_image_path_key` unique index | present |
| `anon` table privileges | 0 |
| Security advisors | only the pre-existing leaked-password toggle |

And the hole itself, probed against production as the real rider: a cross-folder
`image_path` is **refused 42501**, an upload into another rider's folder is **refused 42501**,
and the rider's own folder is still **accepted** — so it is closed without being
over-tightened.

Still unexercised: **a real upload through storage-api has never run.** The INSERT policy
reads `metadata`, which storage-api populates, and it is written null-tolerantly so a
null-metadata pre-check cannot refuse every upload — but nothing has proven that end to end,
and the RLS suite cannot, because `harness.sql` stubs `storage.objects`. The first session
that builds the create screen should treat "does one real upload succeed" as its first test,
not its last.

That binding is not cosmetic. Without it there is a **live data-exposure hole**: the storage
read policy delegates to `postcards` via `EXISTS`, which inherits RLS from *whatever row
matches the path* rather than from the object's owner — so a rider could write another
rider's image path into their own app-wide postcard and make a private club's photo readable
by every signed-in rider, blocked or not. `image_path` reaches the browser, so the paths are
known. It was found by review, reproduced against the scratch database, fixed before `010`
was ever applied, and is now covered by assertions in
`# A rider cannot read an image by claiming its path (migration 010)`.

No `media` bucket existed beforehand (checked before applying), so the `on conflict do update`
guard did not have to correct anything on this run — it is there for reruns and for anyone
who creates one through the dashboard, where "public" is a checkbox.

The UI itself is unbuilt — see `docs/FIGMA-FIDELITY-TODO.md` for why, and for the register of
what a later pass must verify against the design.

---

**The login epic is shipped.** PR #8 merged to `main` as `0e30556` on 2026-08-02, migration
`003` applied to the hosted project, and the production deployment is `READY` on
`letsrideapp.vercel.app` with no runtime errors. Nothing is outstanding from it.

Verified on the live database after applying, not just in CI: completion is refused while
`location` is NULL and is one-way once set; reserved, too-short and uppercase usernames are
all rejected with `23514`; 22 policies exist and every one is `to authenticated`; `anon`
holds zero table grants. Security advisors show nothing new — only the pre-existing
leaked-password toggle.

Two things to expect rather than debug:

- ~~**The one existing rider (`pedrousername`) has `onboarding_completed_at` NULL**~~ — **no
  longer true.** Checked 2026-08-02: the stamp is set, so they land in the app directly and
  no backfill is needed. Verify with
  `select username, onboarding_completed_at from profiles;` rather than trusting this line.
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
| Migrations | `001`–`010` all applied to the hosted project. See the ordering note below. |
| Tests | RLS suite 186 assertions (`npm test`) + Vitest 117 tests (`npm run test:unit`). Both gate every PR. Count with `npm test 2>&1 \| grep -c "NOTICE:  ok"` — it read 69 for as long as anyone can tell, and the real number on `main` was 37. |
| Workflow | OpenSpec adopted: `/opsx:propose` → `apply` → `archive`. Rules in `openspec/config.yaml`. |
| Design | v2 tokens, Poppins, light theme, and the login primitives landed. `--text-display` is correct — the style it maps to does exist; see the correction below. |
| Spec | `docs/specs/login-onboarding.md` — 25 questions, all with defaults. The data-layer build took the defaults for Q1–Q9, Q11, Q13, Q14, Q23. |
| Squad | Nine agents in `.claude/agents/`. |
| CI | Green: type check, lint, build, RLS suite against Postgres 17. |
| Data | 1 rider, 1 club, 1 ride — all real, created through the deployed app. |

The app looks inconsistent on purpose: `/`, `app/auth/*`, `app/onboarding/*` and
`app/legal/*` are v2, while everything under `app/(app)/*` — dashboard, rides, clubs,
friends, profile — is still v1 `zinc-*`/`orange-500`. Those migrate with their own epics.

**Migration ordering is not file order.** Two chains were written in parallel and each
recreated the policies the other did. `004`–`007` reached the database before `002` did;
`008` reconciles them by taking `to authenticated` from `002` and the visibility predicates
from `004`. Verified by diffing the live policy set against a database built from the
chain — 22 policies, identical. Do not try to "tidy" the numbering; the end state is
correct and the divergence is recorded deliberately.

**`003_onboarding` is applied** (2026-08-02) and `supabase/tests/run.sh` no longer skips
it — `SKIP_MIGRATIONS` is empty, so CI applies the whole chain. All 29 `full_name`
references are gone; `grep -rn full_name src/` returns nothing.

---

## The Figma snapshot — read `design/`, don't call the API

**Built 2026-08-03.** Everything under this heading and the next one describes a problem that
now has a standing answer: a committed, offline snapshot of the design file under `design/`,
generated by `scripts/figma/`. Read it with `npm run figma -- tree "<screen>"`.

The root cause of the repeated blocks was not only the rate limit. The previous cache wrote
to `.figma-cache.json`, which is **gitignored**, and this container is rebuilt every session —
so the cache was empty every single time anyone needed it, and every session paid full price
for a file that changes about once a month. The snapshot is committed for exactly that reason.

| Command | Network | Purpose |
|---|---|---|
| `npm run figma -- ls / tree / text / show / tokens / icons` | no | Query the snapshot |
| `npm run figma:check` | one cheap call | Is it stale? Compares `/versions` against `design/manifest.json` |
| `npm run figma:pull` | **yes** | Refresh — the expensive call. Monthly |
| `npm run figma:icons` | **yes** | Export `Element / Icon / *` as SVG |
| `npm run figma:check -- --probe` | 7 cheap calls | Endpoint sweep — replaces the ad-hoc curl sweeps below |

`figma:check` works even when `figma:pull` cannot, because `/versions` sits in a different
bucket from the node routes. So "is my snapshot stale?" is always answerable.

**The snapshot is not populated yet.** The pipeline is built, tested (158 unit tests, 14 of
them running the real extractor end-to-end against a fixture) and committed, but
`/v1/files/:key` and `/v1/files/:key/nodes` were still 429 at 13:29 on 2026-08-03 — on the
first call of a fresh session, budget nobody here spent. `design/` therefore holds only its
README. **The first session that finds the window open should run `npm run figma:pull &&
npm run figma:icons`, then commit `design/`.** That single act retires this whole section
and most of `docs/FIGMA-FIDELITY-TODO.md`.

Measured 2026-08-03 13:29 with `npm run figma:check -- --probe`:

| Endpoint | State |
|---|---|
| `/v1/me` | 200 — proves nothing |
| `/v1/files/:key/versions` | 200 |
| `/v1/files/:key`, `/nodes` | **429** — gates `figma:pull` |
| `/v1/images/:key` | **429** — gates `figma:icons` |
| `/v1/files/:key/styles`, `/components` | 200 but empty (library unpublished) |

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

**Update, 2026-08-02 evening: the per-endpoint escape hatch did not hold a second time.**
The whole-file route was 429 on the *first* call of a fresh session — inherited budget, not
something that session spent — and stayed 429 across **40 polls at 3-minute intervals over
two hours**. Measured at both ends of that window:

| Endpoint | Session start | Two hours later |
|---|---|---|
| `/v1/files/:key`, `?depth=1`, `/nodes` | 429 | 429 |
| `/v1/images/:key` | **200** | **429** — degraded during the session |
| `/v1/me` | 200 | 200 |

Two things to carry forward. **`/v1/images` is not a reliable fallback** — it was the one
file-reading route still alive at the start and it died too, so "icon export works" is not
a standing fact. And **`/v1/me` returning 200 means nothing**; it stayed green throughout
while every route that reads design data was refused.

**The rate limit is not the blocker that matters.** Measured 2026-08-03: six endpoint
families (`/versions`, `/comments`, `/files/:key/images`, `/teams/:t/projects`, `/styles`,
`/components`) all returned 200 while the node-reading routes stayed 429. `/components` and `/styles`
are **empty** — the library is unpublished — and `/files/:key/images` returns 418 real image
fills whose URLs all point at **`s3-alpha-sig.figma.com`, which this environment's network
policy refuses at CONNECT with 403**, before the request leaves the container.

That was a *network policy* denial, not a Figma limit. **It has since been fixed** — the
product owner allowed `s3-alpha-sig.figma.com` and
`figma-alpha-api.s3.us-west-2.amazonaws.com` on 2026-08-03, and a 2.2 MB image fill
downloaded successfully straight afterwards. So one of the two blockers is gone: when
`/v1/images` stops returning 429, **icon export should now actually work end to end**.

Two things learned while confirming that, worth not repeating:

- **The 418 image fills are not screen designs.** They are content placed into the file —
  photos, and at least one **personal WhatsApp screenshot** showing a real person's name and
  private conversation. There is no design layout in them. Do not bulk-download them looking
  for screens; sample one at most, and treat what is there as private rather than as an asset.
- **Layout still needs the node tree**, i.e. `/v1/files/:key` or `/nodes`, which was still
  429 as of 2026-08-03. The allowlist does not change that.

`docs/FIGMA-FIDELITY-TODO.md` remains the register of everything the outage forces to be
inferred.

**Do not buy a Figma plan to solve this.** The REST API on a personal token is free and
uncapped; only the MCP server is plan-gated (Starter = 6 tool calls/month, exhausted), and
the MCP path is not the one this project uses.

The MCP server was probed once as a last resort and returned the Starter-plan quota error,
confirming the note below rather than contradicting it. Both routes to design data can be
shut at the same time, and when they are, the honest move is to stop and say so — not to
eyeball values off a screenshot.

The MCP server is a separate, monthly quota and is genuinely exhausted: one `get_metadata`
succeeded, `get_design_context` never did. Do not spend time there — the REST whole-file
route makes it unnecessary.

Everything extracted from that pull is written up under *Verified measurements* in
`docs/specs/login-onboarding.md`: every string verbatim, component geometry, fills, and the
screen layout. **That section supersedes §Screens wherever they disagree.**

## The login epic — shipped, and what it left behind

Merged and live. All seven routes exist (`/`, the four `auth/*` screens, the two
`onboarding/*` steps), `003` is applied, and every `full_name` reference is gone.

Three decisions were taken on **defaults rather than sign-off**. They are cheap to revisit
now and expensive later, so they are recorded rather than buried:

- **Server Actions for all writes.** There were zero `'use server'` files before this. The
  legacy `supabase.from()` + `router.refresh()` pattern survives only in `JoinRideButton` and
  `JoinClubButton` — migrate those on contact.
- **Zod**, the one new runtime dependency, for schemas shared by client and server.
- **The profile-photo step is deferred** to a `media` follow-up, so onboarding is two steps
  and the wizard shows two dots, not the three drawn.

**Three deliberate deviations from a Done design**, tabulated in the spec for the designer:
`Skip` removed from onboarding (decision #5), step 1 asks for a **username** rather than a
name (decision #7 changed what the field collects after it was drawn — "Name" would invite
input that fails the charset rule), and two dots instead of three.

### Open, needing a decision

- **`terms_accepted_at` is not protected.** `enforce_onboarding_completion()` pins the
  onboarding stamp but leaves the consent stamp writable, so a rider can clear or back-date
  their own. `CLAUDE.md` names T&C acceptance as an integrity rule the client must not own.
  Worse: if email confirmation is ever switched on (decision #6 says revisit before launch),
  `signUp` loses its live session and the consent write is refused outright. The action
  checks its result now; the schema guard is an unwritten migration.
- **`/onboarding/photo` is unbuilt** and needs the `media` agent — Storage bucket, RLS,
  client-side compression, EXIF stripping. When it lands it must **not** re-gate riders who
  already completed onboarding; surface it as a dismissible nudge on the profile screen.

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
  `/friends` is not restyled, it is **deleted**, and `friendships` is a v1 leftover.
  **Signed off by the product owner on 2026-08-02**, along with deleting `/dashboard`.
  Not yet carried out — see *Do this first* for why the order matters.
- **The design's home is Postcards**, a photo feed. The app's home is `/dashboard`. The
  central screen of the product is not built.
- **Inbox and Garage have no routes and no tables.** The schema is `profiles`, `rides`,
  `ride_members`, `clubs`, `club_members`, `friendships`, plus `postcards`, `postcard_likes`
  and `blocks` from `009` — so postcards and blocking now have tables, while messages and
  garage still have nothing. Most of what is left is `data` → `feature`, not CSS.
  (This bullet claimed "nothing behind postcards … or blocks" for a while after `009` landed
  and contradicted §Do this first twenty lines above it. Re-read both before trusting either.)

**Suggested order.** The ratings are impact on shipping a product that matches the design.

| # | Work | Impact | Notes |
|---|---|---|---|
| ~~1~~ | ~~`design-system` — login primitives~~ | — | **Done** for the login set: Button, Input, Checkbox, Pagination, AppBackground. The 44 icons and retiring `lucide-react` are still outstanding |
| ~~2~~ | ~~Login epic~~ | — | **Shipped** — PR #8 |
| 3 | Restyle the 12 existing routes v1 → v2 | 4/10 | Only `app/(app)/*` remains v1 now |
| 4 | **Postcards / Home** | 10/10 | New tables + Storage + EXIF; the core loop |
| 5 | Inbox — DMs, ride chat, notifications | 8/10 | New tables + `realtime` |
| 6 | Trust & safety — block, report, hide | 7/10 | RLS-level; needed before real users |
| 7 | Garage | 5/10 | Self-contained, lowest urgency |
| 8 | `/onboarding/photo` | 3/10 | `media` follow-up deferred out of the login epic |

**Do not restyle screen-by-screen before `design-system` lands.** Twelve routes each
re-deriving tokens is how drift gets baked in. This was a live risk until today: the token
table omitted `Warning/100` `#D92140`, so every `<Button variant="danger">` built against the
old docs would have used the wrong colour.

**Screens per section — measured 2026-08-02**, from the whole-file REST pull. This was
previously listed as the one missing number, "the difference between weeks and months".

| Section | 390px frames |
|---|---|
| Clubs | 65 |
| Rides | 45 |
| Home (Postcards) | 29 |
| Profile | 25 |
| Login | 18 |
| Inbox | 17 |
| **Total** | **199** |

**Read that as frames, not routes.** It counts focus, filled and empty-state variants of the
same screen. The login epic is the calibration: **18 frames became 7 routes**, roughly 2.5:1.
Applying that ratio to the remaining 181 frames suggests something like 70 routes left — so
Clubs and Rides are each a larger build than the entire login epic, and Postcards is not the
biggest section by frame count even though it is the highest-impact one.

---

## Known issues, roughly by cost to fix

- ~~**Duplicate usernames break signup.**~~ **Fixed and deployed** — `handle_new_user` no
  longer guesses a username from the email local part, so two `dave@…` addresses no longer
  collide. Username moved into onboarding.
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

**`git log %G?` lies about signatures here — do not "fix" commits based on it.** Commit
signing works: `commit.gpgsign` is true and the signer is `/tmp/code-sign`. But
`gpg.ssh.allowedSignersFile` is not configured, so git cannot attempt SSH verification and
reports `%G? = N` — the same value it uses for *unsigned*. Every correctly signed commit
looks unsigned.

Check the header instead, which is the ground truth:

```bash
git cat-file commit <sha> | grep -q '^gpgsig' && echo signed || echo unsigned
```

This cost a pointless `git rebase --exec ... --reset-author` across a whole branch to
"re-sign" commits that already carried valid signatures. The user-global
`~/.claude/stop-hook-git-check.sh` had the same bug baked into it — it has since been fixed
to grep the header, to stop treating `noreply@github.com` (GitHub's signed web-flow identity
on merge commits) as a fault, and to ignore commits already on the default branch. That hook
is outside this repo, so a fresh environment may still carry the old version.

**`origin/HEAD` is not set in this clone.** It is a symbolic ref only `git clone` or an
explicit `set-head` creates. Any script that references it here resolves to nothing and
becomes a silent no-op — which is exactly how two "fixes" to that hook passed review and did
nothing. Fall back to `origin/main` explicitly.

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
