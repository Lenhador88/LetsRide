# Handoff — where things stand

Branch: `claude/coding-session-setup-xyq8re` (everything committed and pushed)

Read `CLAUDE.md` first. It carries the stack, the v2 design tokens, the settled
architectural decisions, the working principles, and the canonical Supabase project.
This file is only the *current position* — the things that will be stale in a week.

---

## Do this first

**Enable the Supabase connector for the conversation.** It is authenticated at the account
level (`installState: connected`) but was toggled **off per-chat**, which is why nothing
could reach the database. The toggle is on the chat input's connector control, not in
account settings — account settings will show it connected, because it is.

Then, in order:

1. **`restore_project`** on `zwprydcyryvudhurbnye` — it is paused, so the deployed app is
   down.
2. **Apply `002_restrict_to_authenticated.sql` immediately.** Restoring re-opens an
   anonymous read hole on `profiles`, `club_members`, `ride_members`, and every public
   `clubs`/`rides` row. Nothing is exposed while paused; the gap between restore and apply
   should be seconds.
3. **Run the two verification queries** at the bottom of 002. Both must return zero rows.
4. **Upgrade to Pro.** The free tier auto-pauses after ~7 days idle and takes the
   deployment down with no alerting. This will recur otherwise.

Do **not** apply `003` yet — see below.

---

## State

| | |
|---|---|
| Migrations | `001` applied. `002`, `003` written, **not applied**. |
| Design | v2 tokens, Poppins and light theme landed. Only `components/ui/*` migrated. |
| Spec | `docs/specs/login-onboarding.md` — 23 questions, all with defaults; four settled. |
| Squad | Nine agents in `.claude/agents/`. |
| CI | Green (type check, lint, build on every PR). |

The app currently looks inconsistent on purpose: the cream v2 background is live, but
`app/auth/*` and `app/(app)/*` are still v1 `zinc-*`/`orange-500`. Those migrate with their
own epics.

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

Then `test`, then `reviewer`, then a PR.

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

**Unverified from the last session:** the four migrated primitives kept their v1 shapes
(padding, radius, focus treatment). Tokens are correct; geometry is inferred and flagged in
the commit. The Figma pass should verify them.

---

## Open questions for the product owner

1. **Terms & privacy pages must be publicly readable** — you legally have to show them
   before signup completes. This is a narrow, deliberate exception to "no anonymous access"
   (two static pages on a proxy allowlist, no data access). Not yet approved.
2. **Email confirmation is off.** Deliberate and recorded, but it means anyone can sign up
   with an address they do not control. Must be revisited before public launch.
3. **Branch protection on `main` is not enabled.** With agents opening PRs, this is what
   makes "CI is the safety net" actually true.
