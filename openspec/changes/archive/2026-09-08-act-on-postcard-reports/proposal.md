# Act on postcard reports

## Why

**A rider can file a report and nobody can read it.** `src/lib/actions/moderation.ts` writes
`postcard_reports`; nothing anywhere reads it. `011`'s own header calls this a KNOWN GAP and
says so in the table comment, which still reads *"Write-only in practice"*. Measured on DEV
2026-08-24, the table carries exactly two policies — a SELECT scoped to `reporter_id =
auth.uid()` and an INSERT — so the only rider who can read a report is the one who filed it.

**And the app now promises otherwise, in production copy.** `f329089` (already on this branch)
published a "Reporting content, and how to reach us" section on `/legal/privacy` that tells
riders *"Reports are read by us"*, *"We aim to review each report within 24 hours"* and
*"Removing a postcard removes its photo, its comments and its likes with it."* The first is
false today. The third is false in a way no amount of SQL fixes — see the Storage decision
below. `main` auto-deploys that page. This change is what makes the first two true and what
makes the third executable.

**App Store Review Guideline 1.2** asks a user-generated-content app for four things. Report,
block and hide are built. The fourth — acting on what is reported, plus a published route to a
human — is the store-risk item with nothing behind it. The contact half landed in `f329089`;
this change is the acting half.

## What Changes

The shape is set by the product owner in PD-297 and is deliberately **not** a moderation
product: no admin role, no moderator JWT claim, no in-app admin screen. Everything below is
reachable only by the project owner's own dashboard connection.

- **A triage read surface**, as a view — but in the **`private` schema, not `public`**. This is
  the single most important decision in the change and it is measured rather than argued; see
  `design.md` D1. In one sentence: a view created in `public` by a migration is **born granted
  to `authenticated` and `service_role`**, and PostgREST publishes `public`, so the naive
  reading of "a SQL view queried from the dashboard" hands every signed-in rider every report
  and every reported postcard.
- **A runbook step for the photo**, because SQL cannot delete a Storage object. *(This bullet
  originally specified a second view listing take-downs whose object still exists. It needs the
  ledger below to have anything to list, so it went with it — `tasks.md` group 7.)*
- **A narrow take-down** — one function, one postcard, by id, reachable by nobody but the table
  owner. `public.moderate_comment` (`011` §1b) is the precedent for the *narrowness*; this
  change deviates from it on `security definer` and says why (D4).
- **The take-down returns the evidence it destroys.** The `ON DELETE CASCADE` on
  `postcard_reports.postcard_id` is **kept** — a decision, not an inheritance (D5). *(This
  bullet originally specified an append-only ledger. NOT BUILT: it would hold a caption, an
  image path encoding a rider's uuid and an author id, surviving the account deletion `029`
  performs and `/legal/account-deletion` promises erases all three — a retention decision with a
  window and a lawful basis behind it, which Q3 and Q4 below are asking the owner for. The
  reasoning is in `076`'s header and `tasks.md` group 7.)*
- **A revoke of `service_role`'s standing privileges on `postcard_reports`** (D9), because the
  owner's stated constraint — never reachable by `service_role` — is already false for the base
  table today and this change is where that gets noticed.
- **A runbook** for the two-step take-down, because step two is not SQL. It shipped as `076`'s
  §Operating it footer rather than a file under `docs/`, so it sits beside the objects it drives.
- **No application code.** The client half of this story shipped in `f329089`. This change adds
  nothing to `src/` and no new Zod rule; every rule it states is a grant, a schema placement, a
  CHECK or a policy.

## What Does NOT Change

- **No admin role, no `club_members.role = 'moderator'`, no JWT claim.** Explicitly out of
  scope per the issue.
- **The reporter's own read stays exactly as `011` wrote it.** `"Riders see only the reports
  they filed"` is not widened, not narrowed and not replaced.
- **No new grant to `anon`.** Decision #1. `anon` holds no USAGE on `private` and gains none.
- **No UPDATE or DELETE grant on `postcard_reports` for any client role.** `011`'s "a report is
  a statement of fact at a moment in time" survives this change intact.
- **No service-role key anywhere in `src/`.** Nothing here needs one; the reader is a human at
  a dashboard.

## Impact

- **Affected specs:** `content-moderation` (new capability) and `database-enforced-integrity`
  (ADDED requirements only — see below). **The delta was trimmed to what shipped before this
  change was committed**: its ledger, pending-photo and retention requirements are gone, because
  archiving folds these deltas into the canonical spec and `content-moderation` is a new
  capability — it would have become the only written record of how moderation works here, and it
  would have asserted a ledger nothing writes.
- **Affected code, as shipped:** `supabase/migrations/076_reports_have_a_reader.sql`,
  `supabase/tests/rls_test.sql`, `docs/reference/schema.md`, `CLAUDE.md` and `docs/HANDOFF.md`.
  `seed.sql` needed nothing — it already carries a report row. **Nothing under `src/`** was in this change; the two `src/` edits on the branch belong to `f329089` and to the review fix
  that followed it.
- **Deliberately ADDED-only against `database-enforced-integrity`.** Two active changes already
  collide on that spec's `Club membership role SHALL NOT be self-assignable` and each carries a
  coordination banner about it. Archiving replaces a requirement wholesale, so a MODIFIED delta
  here would join that pile-up. Every requirement this change contributes is new, so it adds and
  modifies nothing.
- **Security advisors: this change is expected to add ZERO.** Reasoned, not measured — no
  advisor tool is on this agent's allowlist, so the build session must confirm with
  `get_advisors(security)` after applying and treat any new WARN as unexpected. The reasoning:
  `authenticated_security_definer_function_executable` fires on a `security definer` function
  **executable by `authenticated`**, and the take-down is neither `security definer` nor
  executable by `authenticated`; the `security_definer_view` advisor targets views in *exposed*
  schemas, and `private` is not one; `rls_disabled_in_public` names `public`, and the ledger is
  not there. The baseline is ten (eight + two), of which one — leaked-password protection — is
  outstanding and owner-only.

## The negative cases

These are the contract. Each is stated as a role against a resource so it lands as an assertion
in `supabase/tests/rls_test.sql`, and each is spelled out in the delta specs.

**On the triage view and the take-down's objects:**

1. `anon` SHALL NOT read the triage view — by three independent barriers: no USAGE on
   `private`, no privilege on the object, and PostgREST does not route to `private`.
2. `authenticated` SHALL NOT read it, by the same three barriers. **This is the one that fails
   silently if the object is built in `public`.**
3. `service_role` SHALL NOT read it. It *does* hold USAGE on `private` (`031` granted it), so
   here the object-level privilege is the barrier that does the work, and it is the one the
   local suite cannot assert (D8).
4. The triage view SHALL NOT become a second way to read postcards. It runs as the table owner
   and therefore bypasses every block, club-membership and hide predicate in the system — that
   is what it is *for*, and it is exactly why no PostgREST role may reach it.
5. The triage view SHALL NOT expose `auth.users`. No email address, no sign-in metadata, no
   password state. The reported rider is identified by `profiles.username` and uuid.
6. The triage view SHALL NOT expose the reporter's username, email or profile. The reporter's
   uuid is enough to spot a pattern; a name is not needed to triage a photo.
7. Neither view SHALL be a write surface. No `INSERT`/`UPDATE`/`DELETE` privilege on either,
   for any role, including the ones that arrive by default.

**On the take-down:**

8. Nobody reachable from the client SHALL be able to call the take-down — not `anon`, not
   `authenticated`, not `service_role`. Enforced by **both** grant and schema placement, so
   neither one alone is load-bearing.
9. The take-down SHALL delete **exactly one** postcard, named by id, and SHALL NOT be usable as
   a general delete. It takes one `uuid`, it names one table, and it returns what it did.
10. The take-down SHALL NOT delete a rider, a club, a ride, a comment or a report **directly**.
    Rows that go with the postcard go by the existing cascades `011` already documents, so the
    blast radius is a property of the schema and not of this function's body.
11. A rider SHALL NOT gain any new delete right over another rider's postcard. `009`'s
    `"Authors can delete their own postcards"` policy is untouched, and the assertion that a
    rider cannot delete a stranger's postcard already exists and must still pass.

**On reports themselves:**

12. A reporter SHALL still read only their own report rows, and SHALL still be unable to edit
    or withdraw one. The four existing assertions covering this must still pass unchanged.
13. The reported postcard's author SHALL still NOT be able to read reports filed against them.
    That assertion exists at `rls_test.sql:1501` and is load-bearing: a take-down that let the
    author see who reported them would put the reporter at risk.
14. Nothing in this change SHALL widen `postcard_reports` for any client role. The only grant
    change to that table is a **removal** (D9).

**On evidence and retention:**

15. Removing a postcard SHALL NOT leave the take-down unaccounted for. The reports themselves
    cascade away with the postcard — kept deliberately (D5) — and what survives is whatever the
    operator keeps from the take-down's return value, read before the delete. **As built, that
    is the only artefact**: nothing in the database records that a take-down happened.
16. Anything that DOES retain this data SHALL carry a stated window from the day it is
    created, because a caption, an image path and an author id are personal data (D6). As built
    nothing retains it, which is the strongest form of that requirement and the reason Q3 is
    open rather than answered.

**On the client:**

17. No rule in this change SHALL live only in a Zod schema. There is no client code in this
    change at all, which is the strongest form of that guarantee.

## Open questions

Every one carries a recommended default so the build is not blocked. Blocking status is stated
per question; **only Q1 is blocking, and it is blocking on submission rather than on this
build.**

- **Q1 — product owner, blocking before store submission, not before merge. Who looks, and how
  often?** A dashboard view nobody opens honours "we aim to review each report within 24 hours"
  no better than the current table. The read path is the *ability* to comply; the compliance is
  a person. **Default: the owner checks the triage view daily, and the runbook this change adds
  is what a reviewer is shown.** See the objection at the top of the report — this is the part
  of PD-297 that no migration can close.
- **Q2 — product owner. Is `hello@letsride.app` a real mailbox?** Already recorded in
  `src/lib/support.ts` by `f329089` and repeated here because it is a 1.2 item: the domain is
  `letsride.app` and this project's domain is `letsride.social`. If it is not owned and
  monitored, the published contact route reaches nobody and a reviewer is the first to write to
  it. **Default: none — this one genuinely cannot be defaulted, only asked.** One line changes
  when it is answered.
- **Q3 — product owner. If a take-down ledger is ever built, how long is it kept?**
  **Default: 24 months**, long enough to establish a repeat offender and short enough to be
  defensible. Nothing schedules the deletion (this repo has taken no decision on `pg_cron`), so
  it would be a documented window until it has a mechanism. **Unanswered is why the ledger is
  not in this change.**
- **Q4 — product owner. If it is built, does the ledger keep the caption text?**
  **Default: yes.** It is the evidence of what was removed and it is the rider's own words;
  without it the ledger records that something was removed and not what. Same status as Q3.
- **Q5 — build session, non-blocking. Revoke `service_role` on `postcard_reports`?**
  **Default: yes** (D9). It is two lines and it makes the owner's stated constraint true. It is
  isolated in its own task group and can be dropped without touching anything else.
