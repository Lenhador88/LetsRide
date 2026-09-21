# Add analytics consent — the opt-out stamp, and the replay link on feedback

> **PD-353**, the schema and consent half only. Read the issue body before this file; it was read
> on 2026-09-01 and **carries no comments at all**, so the body is the whole record and nothing has
> overtaken it. The product decisions in it — replay ON and unmasked for the pilot, autocapture off,
> heatmaps off, web vitals on, one PostHog project on Vercel's Production scope only, the four
> moments to instrument — are **settled** and are not reopened here.
>
> **What this change is NOT.** The SDK wiring, the `capture` seam, the four event call sites, the
> by-hand pageview firing on route change, the `/legal/privacy` copy and the toggle's visual design
> belong to the main thread. This proposal owns **two schema facts** and the rules around them.
>
> **The name is inherited from the dispatching brief and is slightly wrong.** PD-353 is explicit
> that this is an **opt-out**, not a consent gate — *"the opt-out is a separate stamp from the T&C
> consent `accept_terms()` writes. Bundling it in is specifically the pattern that does not
> count."* A future session reading `add-analytics-consent` will look for a consent stamp and a gate
> and find neither. `remember-an-analytics-opt-out` is the accurate name; the change was scaffolded
> under this one and renaming it is the caller's call.

## Why

**PostHog is a client-side SDK. Nothing in Postgres is in its path, so the only thing this schema
can do about a rider who says "no" is *remember* that they said it.** That is worth doing properly
and it is worth being honest about: an opt-out that nothing enforces still needs to be
unforgeable, unreadable by other riders, durable across devices and reinstalls, and available to
the client *before* the first event fires. None of those four is free, and three of them are
decided by grants rather than by code.

Two facts, and each has a trap that has already cost this repo a session.

**Fact 1 — a rider can opt out of analytics, and the preference is durable.** PD-353 settles that
session replay is ON and UNMASKED for the pilot with *"an opt-out in profile settings"*. The trap
is `025_profile_column_privileges.sql`: it issues an **absolute** `revoke select, insert, update on
public.profiles from authenticated` followed by three **absolute** column allowlists, and the
`profiles` SELECT policy admits every non-blocked rider who has a username —

```
Profiles are viewable by signed-in riders:
  (auth.uid() = id) OR (username IS NOT NULL AND NOT private.is_blocked(auth.uid(), id))
```

read from `pg_policies` on DEV 2026-09-01, not recalled. RLS is row-level, not column-level, so a
policy that admits the row admits every column of it. **Putting `analytics_opt_out_at` in `025`'s
`grant select (...)` list therefore publishes every rider's analytics preference to every other
rider** — in member lists, ride crews, postcard bylines, everywhere `PUBLIC_PROFILE_COLUMNS` is a
convention PostgREST does not enforce. `025`'s own footer names this as the permanent price of the
allowlist shape.

**Fact 2 — a feedback row can carry the PostHog session id.** PD-353: *"The postcard thing is
broken" is unactionable alone and completely actionable beside ninety seconds of footage.* The trap
here is smaller and sharper: `084`'s `feedback` table bounds every text column with a CHECK, and a
CHECK on a **best-effort** column converts a best-effort write into a hard failure. A tight ceiling
on an id whose format PostHog owns turns every feedback submission into `23514` the day that format
grows — breaking the shipped feature this column exists to improve.

**Why now rather than later.** PD-353 argues it and the argument is the schema's: every feedback
row collected before the column exists has no replay attached, permanently, and the pilot is
exactly the period whose feedback is worth the most.

## What Changes

One migration, `096`, wholly additive.

- **NEW** `profiles.analytics_opt_out_at timestamptz`, nullable. NULL means the rider has not opted
  out; a timestamp records when they did.
- **NEW** the column is added to **none** of `025`'s three grant lists, and the migration does not
  restate those lists in any form. `authenticated` holds no SELECT, no INSERT and no UPDATE on it —
  the same posture `030` gave `terms_version`, verified live on DEV 2026-09-01 (`sel/ins/upd` all
  false for `terms_version` today).
- **NEW** `public.my_analytics_opt_out() returns timestamptz` — `security definer`, own row, no
  arguments. The only read path.
- **NEW** `public.set_analytics_opt_out(p_opt_out boolean) returns timestamptz` — `security
  definer`, own row, no rider id. The only write path. Idempotent in the opt-out direction
  (`accept_terms()`'s shape: a second call keeps the first stamp).
- **NOT** an addition to `my_onboarding_state()`. See Impact and `design.md` §D3.
- **NEW** `feedback.posthog_session_id text`, nullable, with a deliberately generous length CHECK.
- **MODIFIED** `feedback`'s INSERT grant gains exactly one column, by a bare additive `grant insert
  (posthog_session_id)` that names only the new column and **does not restate `084`'s list**.
- **NEW** `private.strip_feedback_session_id()` and one `BEFORE INSERT` trigger on `feedback`,
  which normalises a blank id to NULL and **nulls the id outright for a rider who has opted out**.
  It never raises.
- **UNCHANGED** `feedback` still has no SELECT grant and no SELECT policy for any client role, so
  the session id is write-only like everything else on that table.
- **UNCHANGED** `enforce_participation_gate`. `feedback` already carries it (`084`, the fifteenth);
  it is `BEFORE INSERT FOR EACH ROW` and fires on the whole row regardless of which columns a
  statement names, so a new column needs nothing from it and **no trigger is added**. The gate
  count does not move.
- **UNCHANGED** `profiles` UPDATE stays ungated. The gate is not on `profiles` (measured: 22 tables
  on DEV, 17 on PROD, `profiles` on neither list), and it must not become so — see the negative
  cases.

**The client behaviour this migration exists to serve**, specified here and built by the main
thread: the analytics client boots **capture-off** and opts in only after
`my_analytics_opt_out()` has returned NULL for the current session.

## Capabilities

### New Capabilities

- `analytics-consent`: a rider's analytics opt-out — where it lives, who may read and write it,
  what the database can and cannot guarantee about it, the boot order that decides whether the
  first pageview of a session is captured, and the feedback→replay link that inherits the same
  posture.

### Modified Capabilities

- `database-enforced-integrity`: two ADDED requirements. A column added to a table whose grants are
  an absolute allowlist SHALL state its grant decision explicitly (`025`'s standing cost, promoted
  from a comment to a rule — this change is its third instance after `030` and `062`). And a
  rider's *preference* SHALL NOT become an authorization gate.
- `client-session-storage`: one ADDED requirement. An analytics identity SHALL NOT outlive the
  session that created it — sign-out resets it, and the next rider on the same device inherits
  neither the distinct id nor the opted-in posture.
- `client-render-shell`: one ADDED requirement. A privacy control SHALL NOT render a guessed
  position; the toggle has a defined state for every row of the state checklist, and "not read yet"
  is never drawn as "on".

## Impact

**Schema.** `096_analytics_opt_out.sql`. It is the **fifth** file awaiting promotion: DEV is at
`095` and PROD at `091`, so `092`–`095` are already queued and `096` joins the queue behind them,
in filename order (`docs/ENVIRONMENTS.md` §Migrations step 5). Measured with `list_migrations`
against both refs on 2026-09-01, not read off a sentence.

**Advisors.** `+2` `authenticated_security_definer_function_executable` (WARN), one per new
**public** `security definer` function. `private.strip_feedback_session_id` adds none — PostgREST
does not publish `private`, which is why `085`'s eight private functions added zero. Re-derive with
`get_advisors(security)` rather than reading a number here; `CLAUDE.md`'s cell has been stale
before.

**A trigger on a live write path, so `036`'s hand-exercise gate fires.** From the moment `096`
applies, every rider's feedback insert runs new code inside their own transaction, and a raise
there takes their submission down. `084` could call itself inert; this cannot. Exercise it by hand
on DEV and again on PROD, in a rolled-back transaction, as `authenticated` — `tasks.md` §7.

**Application.** `src/lib/data/analytics.ts` (the accessor read), `src/lib/actions/analytics.ts`
(the toggle write), one key in `src/lib/query/keys.ts` with its reconciliation note, one type in
`src/types/index.ts`, one column added to `sendFeedback`'s insert payload, and the sign-out path in
`guard-cache.ts` gaining an analytics reset beside `clearQueryCache`, `clearSessionStore` and
`clearRiderLocation`.

**Three column lists that must NOT gain this column**, because each would break a working screen
rather than leak anything: `PUBLIC_PROFILE_COLUMNS`, `VIEWED_PROFILE_COLUMNS` and — the
counter-intuitive one — `OWN_PROFILE_COLUMNS`. There is no SELECT grant, so adding it to the last
turns `/profile` into a `42501` on the error boundary. `025` §DEFECT 2d is the same failure at a
different column.

**Docs.** `docs/reference/schema.md` gains the `profiles` and `feedback` rows;
`docs/reference/migrations.md` §The ordering chain gains `profiles` and `feedback` to its
absolute-list table (see `design.md` §D2 — that table names six tables and its own re-derive query
returns **20** on DEV today). Main thread, not a subagent.

**Out of scope, named so it is not half-built.** The SDK dependency and its init options; the four
event call sites; the pageview-on-route-change wiring and its test; the `/legal/privacy` disclosure
and the toggle's copy and placement; the store privacy label (`native` owns anything gated on a
review guideline); and whether an opt-out or an account deletion must *erase* what PostHog already
holds — the last is `design.md` §Q1 and is the most dangerous thing this change does not settle.
