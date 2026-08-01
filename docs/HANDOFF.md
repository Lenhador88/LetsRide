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

**Figma is quota-limited.** The Starter plan cut off `spec` after 5 calls. That was enough
for structural metadata but *not* for the label text on button and input instances — roughly
eleven strings in the spec are marked `[inferred]` and need one verification pass.

This matters more for the next design task than the last one: `design-system` needs ~30
components with full variant matrices plus ~40 icon exports, an order of magnitude more
calls. **Check the Figma plan before starting it.** Running it against an exhausted quota
produces a half-built library with guessed padding and radii, which is worse than not
starting — see the working principles in `CLAUDE.md`.

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
