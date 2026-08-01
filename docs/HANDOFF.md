# Handoff — where things stand

Branch: `main`. PR #3 merged; nothing outstanding on a feature branch.

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

## Open decision

**Vercel SSO protection is on** (`all_except_custom_domains`), so every `*.vercel.app` URL
sits behind a Vercel login — including production at `letsrideapp.vercel.app`. It opens for
the account owner and prompts everyone else, so the link is not currently shareable.
Turning it off is one setting and low risk: `proxy.ts` gates every route behind a session
and `anon` holds no database privileges. Left on pending a decision.

---

## Known constraints

**Figma MCP is quota-limited; REST is configured but blocked.** The Starter plan cut off
`spec` after 5 calls — enough for structural metadata but *not* for the label text on
button and input instances, so roughly eleven strings in the spec are marked `[inferred]`
and need one verification pass.

The fix is in place rather than worked around: a personal access token now lives in
`.env.local`, `scripts/figma.sh` wraps the REST API, and `docs/figma-api.md` maps every
MCP tool to its REST equivalent. REST has no per-session ceiling and batches ids, which is
what `design-system` needs for ~30 components and ~40 icon exports.

**It does not work yet, and needs two settings changed on the environment itself** —
neither is a code change, and no agent tool can make them:

1. **Egress.** `api.figma.com` is not on the outbound allowlist, so every request dies at
   the proxy with `CONNECT tunnel failed, response 403`. `www.figma.com` is blocked too,
   so the whole domain is off the policy. Add it under network access.
2. **The token.** Set `FIGMA_ACCESS_TOKEN` as an environment variable on the environment,
   not in a file. Sessions run in an ephemeral container, so a token written to
   `.env.local` mid-session does not survive to the next one. `scripts/figma.sh` reads the
   environment in preference to the file, so this needs no code change either.

Then run `scripts/figma.sh me` to confirm. The token and its scopes are **unverified**
until that call returns.

One thing REST cannot replace on our plan: `get_variable_defs`. The REST variables
endpoint is Enterprise-only, so design tokens still cost MCP calls. That is cheap — the v2
tokens are already in `CLAUDE.md` — but it is why the MCP tools stay on the agents.

**Do not start `design-system` until `scripts/figma.sh me` succeeds.** Running it against
a blocked API produces a half-built library with guessed padding and radii, which is worse
than not starting — see the working principles in `CLAUDE.md`.

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
3. **Branch protection on `main` is not enabled.** With agents opening PRs, this is what
   makes "CI is the safety net" actually true. Now that CI runs the RLS suite, this is worth
   more than it was.
