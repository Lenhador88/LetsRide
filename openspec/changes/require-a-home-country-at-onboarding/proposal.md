# Require a home country at onboarding — a new completion invariant, armed after the deploy

> Linear **PD-428**. This file is the specification; the issue points at it and must not restate
> it (`CLAUDE.md` §The roadmap lives in Linear).
>
> **The issue's own comments were read, and the settled decision comes from the `Queued
> 2026-09-07` comment, not from the body.** Body and comment agree here; the comment is what
> closed the backfill question and it is quoted where it decides something. Nothing in this
> proposal reopens it.

## Why

Onboarding today has one field — the username — and `075` deliberately removed the location step
because it was *"a profile field, not an onboarding gate"*. That was correct for one market. At ten
markets a rider with no position gets an undifferentiated global list, which is Explore failing at
its one job rather than degrading. **`075`'s reasoning is not being ignored; it is being answered
by the case it was never asked about.** That reversal-with-a-reason goes in the migration header,
so the next reader sees an argument rather than a loop.

**Country is a floor, not a position.** It is always answerable, cannot be subtly wrong the way
free text can, and is exactly the discriminator that matters at ten markets. The town
(`profiles.location`) stays optional free text and the device fix still beats both — PD-419's chain
is unchanged and this change adds no source to it (`design.md` §D6).

### What is already decided, and is restated here only so nothing re-derives it

| Decision | Source |
|---|---|
| A **new nullable column** on `profiles`, ISO 3166-1 alpha-2 | Queued comment — *"the only shape a live table admits"* |
| The requirement is enforced **inside `complete_onboarding`**, not by NOT NULL and not by a trigger alone | Queued comment; `075`'s header is the worked example of getting it wrong |
| **Existing riders keep NULL permanently and are never re-prompted**, and every read tolerates NULL for ever | Queued comment — and it goes in the **column comment**, not in folklore |
| `profile_countries` is **not** this — `014`'s own comment calls it *"Countries a rider says they have ridden in"* | issue body |
| `profiles.location` is the **town** and stays optional | issue body |
| Whether to ever prompt the **existing** population is left open and is a separate deliverable | Queued comment — *"Do not fold it in"* |

### The population this lands on, measured 2026-09-07

`execute_sql`, both projects. It is a snapshot; one signup between now and the deploy invalidates
it, which is why nothing in this change is conditioned on it.

| | profiles | incomplete | completed | with a `location` | with a home country |
|---|---|---|---|---|---|
| DEV `fpmrimzxadewsaiwpsel` | 25 | 1 | 24 | 20 | **0 — the column does not exist** |
| PROD `zwprydcyryvudhurbnye` | 5 | 0 | 5 | 5 | **0** |

So the NULL-tolerating read path is not a corner: on the day this ships it is **100% of the
population**, and it stays the majority until new signups outnumber them.

## What Changes

### 1. `113` — additive, and it arms nothing

- **`profiles.home_country text`**, nullable, with a CHECK restricting it to the 249 assigned ISO
  3166-1 alpha-2 codes — the same list `020` put on `profile_countries.country_code`, generated
  from `src/lib/countries.ts` by script rather than transcribed, exactly as `020` did. Two
  constraints as `020` chose: the `^[A-Z]{2}$` shape check names *case and shape* as the rule
  (which is what a client sending `nl`, `NLD`, `` or `' NL '` actually violates), the membership
  check names *assignment*. `design.md` §D3 has why this is a third hand-kept copy and not a
  `countries` table.
- **A column comment carrying the NULL contract**, in as many words: NULL means this rider
  completed onboarding before the requirement existed, it is never backfilled, it is never
  re-prompted by this change, and **every read tolerates it permanently**.
- **Column grants** to `authenticated`: SELECT, INSERT, UPDATE — the same posture `location`
  already holds, and deliberately **not** the server-owned posture `025` gave the two stamps.
  `design.md` §D4 argues the difference; §Negative cases 4 and 5 state what it admits.
- **`enforce_onboarding_completion()` gains one arm**: `if old.home_country is not null then
  new.home_country := coalesce(new.home_country, old.home_country)`. **A coercion, not a raise** —
  `038`'s exact shape, one line above the `old.onboarding_completed_at` early return for `038`'s
  exact reason. Once set, a home country can be *changed* and cannot be *removed*.
- **`complete_onboarding` gains `p_country text default null`** and *stores* it —
  `home_country = coalesce(nullif(btrim(upper(p_country)), ''), p.home_country)`, `075`'s own
  never-clear shape. **It does not yet refuse a call without one.** That is `114`.

### 2. The deploy — a third onboarding screen, `/onboarding/country`

- **`/onboarding/country`** is the new terminal step. `setUsername` **stops** calling
  `complete_onboarding`; the country screen's action calls
  `complete_onboarding({ p_location: null, p_country })` and that call is what stamps completion.
- **`resolveDestination` gains one branch and no new state.** The resume order becomes
  terms → username → country, and it is expressible from what `my_onboarding_state()` already
  returns: `!terms_accepted_at` → `/onboarding/terms`; `!onboarding_completed_at &&
  !has_username` → `/onboarding/username`; `!onboarding_completed_at && has_username` →
  `/onboarding/country`. **The accessor's return shape does not change and the country never
  becomes a stamp the guard reads** — `design.md` §D2, and it is the single most load-bearing
  decision in this change.
- **The new action invalidates the guard cache**, because it writes `onboarding_completed_at`,
  which the decision does read. `setUsername` keeps its own invalidation.
- **The profile editor gains the field** — a rider who picks the wrong country out of 249 must not
  be stuck with it for ever. It is the `075` §4 argument one story later: a change that creates a
  value cannot leave it uneditable on the first screen the rider visits afterwards.

### 3. `114` — arm the refusal, applied only once the new bundle is confirmed serving

One `create or replace` of `complete_onboarding`, adding a fourth guard beside the consent arm and
the username arm, same `check_violation` errcode:

> a completion with no home country — neither in the argument nor already stored — is refused.

**It reads the stored value as well as the argument**, so a re-run by an already-onboarded rider
(the function is re-runnable by design, `003` §6b) is never refused for a country they already
have. It is the arm that makes the requirement real, and it is a separate file because it is an
outage against any bundle that does not pass a country. §Sequencing.

## Sequencing — migration-first, then deploy, then the arming file

**The verdict: `113` goes migration-first, `114` goes last, and they cannot be one file.** This is
`108`/`109`'s shape exactly — *"one file cannot be both sides of a deploy, which is why there are
two"*.

The rule asks which side fails safe:

| Order | What breaks |
|---|---|
| **`113` before the deploy** (chosen) | Nothing. The old bundle calls `complete_onboarding({p_location: null})`, PostgREST resolves it against the defaulted parameter, `p_country` is NULL, the coalesce leaves the column alone. New signups keep completing throughout the window. |
| Deploy before `113` | The new country screen writes a column that does not exist (`PGRST204`) and calls a signature that does not exist (`PGRST202`). **Nobody can finish onboarding for the length of the window.** `096` is the precedent, verbatim: *a column a shipped client WRITES goes migration-first*. |
| `114` before the deploy, or folded into `113` | The serving bundle's `setUsername` passes no country, so the new guard refuses **every completion by every rider mid-signup** until the deploy lands. An outage against the bundle that is serving — the side deploy-first exists to protect, and the reason this is two files. |
| `114` before the bundle is confirmed **serving** | Not merged — *serving*. `READY` on the merge sha with `aliasError` null. DEV has already applied a file 102 seconds after a merge, out from under a Preview still calling what it dropped. |

**PROD is five files behind (`108`–`112`) and the same split survives the promotion.** `113` and
`114` are promoted in filename order with the same deploy between them; collapsing them at
promotion time reintroduces exactly the outage above, one project over.

**`113` changes a trigger function on an already-shipped write path** (`enforce_onboarding_completion`
fires on every profile edit), so it owes the hand-exercise gate `112` owes: every affected write
exercised by hand on DEV, in a rolled-back transaction, as `authenticated`. **The gate is cheap
here because the new arm is a coercion and a coercion cannot raise** — which is the reason it is a
coercion. `tasks.md` §1.9 carries it.

## The negative cases

Eight, each written as a testable statement about a role and a resource so it maps onto an
assertion. The full scenarios are in `specs/`; this is the index.

1. **A rider abandons onboarding at the country step and returns.** They hold a username, no
   completion stamp, and no country. The guard SHALL send them to `/onboarding/country` and
   nowhere else — including from a bookmarked `/onboarding/username`, a deleted step's URL, a
   stale tab or a native shell restoring its last path, all of which the existing `isOnboarding`
   catch-all already routes to the resume target. They SHALL NOT reach any app route, and the
   refusal SHALL NOT be the guard's: `023`'s participation gate refuses their content writes
   independently.
2. **The guard cache.** The country **is not** a stamp the decision reads and
   `my_onboarding_state()` does not change shape. The new action is still a stamp writer — it
   writes `onboarding_completed_at` — so it SHALL call `invalidateOnboardingState()`, and
   `writers-invalidate.test.ts` SHALL refuse it if it does not. An invalidation cannot reach a
   round trip already in flight; `guard-cache.ts`'s generation counter is what covers that, and
   this change adds nothing to it.
3. **A malformed code.** `` (empty), `nl`, `NLD`, `' NL '`, `ZZ`, `1`, `null`, a 249-character
   string. The **database** refuses each one — two CHECK constraints, `23514` — and Zod is the
   message, never the guarantee. A rider who never runs the client's validation gets the same
   answer.
4. **Who may READ another rider's country.** Exactly the audience the `profiles` SELECT policy
   already admits — `auth.uid() = id OR (username is not null AND NOT is_blocked(...))` — and no
   role gains anything. A **blocked** rider reads zero rows in both directions; a signed-out
   visitor reads zero rows because `anon` holds no grant on `profiles`; club **owner**, **admin**,
   **member** and **non-member** all read the same columns they already do and write nothing.
   It follows the ordinary profile-column pattern and **not** `025`'s server-owned posture, and
   §D4 says why: it is a shown fact about a rider, not consent evidence.
5. **Who may WRITE it, and when.** The rider, on their own row, for ever — through
   `complete_onboarding` during the wizard and through the profile editor afterwards. **No other
   rider, in any club role, may set, change or clear it** (the UPDATE policy is `auth.uid() = id`).
   **Nobody, including the owner, may return a set country to NULL**: the trigger coerces the
   removal away, `038`'s shape, so a rider cannot walk out of the requirement one screen later.
6. **An existing rider with NULL.** Every read tolerates it permanently. No screen crashes, and —
   the sharper half — **no screen claims a proximity it cannot support**: a country is a *filter*,
   never a position, so it SHALL NOT be turned into a centroid, SHALL NOT become a third
   `RiderLocationSource`, and SHALL NOT render as `near <country>`.
7. **The participation gate.** `enforce_participation_gate` is not on `profiles` UPDATE, so an
   account that never called `accept_terms()` can write `home_country` directly, exactly as it can
   already write a username and an avatar. **That is correct and this change does not alter it**:
   writing a country confers no participation, and `complete_onboarding` refuses to stamp without
   the consent stamp regardless.
8. **A new raise inside `complete_onboarding`.** `114`'s guard is placed **above** the `058`
   welcome-club block and outside its `when others`, alongside the two guards already there, so it
   refuses *before* the stamp is written and never after. It SHALL NOT be added inside that block,
   where a raise rolls the completion stamp back and decision #5 leaves the rider with no way out
   of the wizard.

## Out of scope, deliberately

- **Prompting the existing population.** *"That is a product call with no deadline and no correct
  default… Do not fold it in."* Nothing here writes a country for a rider who already completed.
- **PD-427's copy.** The country gives Explore a fourth label state and `near <country>` reads
  wrong — the honest form is `Explore rides in the Netherlands`. That story owns the words; this
  one owes it a value and the negative in §6.
- **One welcome club per country**, and any use of `home_country` as a filter on any list. This
  change stores it and shows it back to its owner. **A `home_country` with no reader is the
  accepted state on the day it ships**, and it is stated rather than left to be discovered.
- **Forcing the device prompt.** PD-419's decline rule stands and there is **no IP lookup at any
  point**. A required form field is consent; an OS prompt with no escape is not.
- **A `countries` reference table** — `014` declined one deliberately and `020` restated the
  decision. Nothing joins against one.

## Impact

- **Affected specs:** `database-enforced-integrity` (MODIFIED ×3, ADDED ×1),
  `client-render-shell` (MODIFIED ×1), `client-cache-invalidation` (MODIFIED ×1).
- **Affected code:** `supabase/migrations/113_*.sql` and `114_*.sql` (new),
  `supabase/tests/rls_test.sql`, `supabase/tests/seed.sql`, `src/lib/countries.ts` (a
  single-select helper), `src/app/onboarding/country/page.tsx` (new),
  `src/app/onboarding/username/page.tsx`, `src/components/ui/` (a select primitive — §D7),
  `src/lib/actions/onboarding.ts`, `src/lib/auth/guard.ts`, `src/lib/auth/guard-cache.ts`
  (comments), `src/lib/validation/profile.ts`, `src/lib/data/profile.ts`,
  `src/components/profile/EditProfileForm.tsx`, `src/types/index.ts`,
  `src/lib/auth/__tests__/guard.test.ts`, `scripts/walk.mjs`, `CLAUDE.md`,
  `docs/reference/schema.md`.
- **Not affected, asserted as negatives rather than left as silence:** `profile_countries` and
  every travel-log surface, `profiles.location` and its CHECK, the `profiles` RLS policies, the
  participation gate's table set, blocking, `058`'s welcome-club join, `my_onboarding_state()`'s
  return shape, the guard cache's generation counter, and PD-419's device-position chain.
