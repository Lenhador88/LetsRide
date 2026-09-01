# analytics-consent (delta)

## ADDED Requirements

### Requirement: A rider SHALL be able to opt out of analytics, and the preference SHALL be durable

A signed-in rider SHALL be able to switch analytics off for themselves, and that answer SHALL
survive a sign-out, a reinstall, a new device and a native build. It SHALL be recorded as
`profiles.analytics_opt_out_at`, a nullable `timestamptz`: NULL means the rider has not opted out,
and a value records the instant they did.

**The default is opted IN, and that is PD-353's decision, not this spec's.** Session replay is ON
and unmasked for the pilot with an opt-out in profile settings; an opt-in gate during onboarding
was considered and rejected there because it costs a screen on a wizard decision #5 already makes
unskippable, and depresses coverage far enough that the funnel stops describing the population.

**It is a separate stamp from T&C consent and SHALL NOT be folded into `accept_terms()`.** PD-353:
*"Bundling it in is specifically the pattern that does not count."* A preference the rider has to
accept the terms to express is not a preference.

#### Scenario: The preference outlives the device that set it
- **WHEN** a rider opts out on one device, signs out, and signs in on a second device
- **THEN** `my_analytics_opt_out()` SHALL return their stamp on the second device
- **AND** the analytics client on the second device SHALL NOT capture, and SHALL NOT record

#### Scenario: Opting out is idempotent and does not move the stamp
- **WHEN** a rider who has already opted out opts out again
- **THEN** the stored instant SHALL be the FIRST call's, unchanged
- **AND** the call SHALL succeed rather than raise

#### Scenario: Opting back in clears the stamp rather than recording a second one
- **WHEN** an opted-out rider switches analytics back on
- **THEN** `analytics_opt_out_at` SHALL be NULL
- **AND** no column SHALL record when they opted back in — the schema holds the current preference
  and when it started, never a history

### Requirement: A rider's analytics preference SHALL be readable and writable by that rider alone

`analytics_opt_out_at` SHALL be reachable only through two own-row `security definer` functions,
and by no column projection, join, embed or filter available to any client role.

- `public.my_analytics_opt_out() returns timestamptz` — no arguments, reads `auth.uid()`.
- `public.set_analytics_opt_out(p_opt_out boolean) returns timestamptz` — no rider id, writes
  `auth.uid()`.

The column SHALL be absent from all three of `025`'s grant lists, so `authenticated` holds no
SELECT, no INSERT and no UPDATE on it. Neither function SHALL take a subject, so a back-dated,
foreign or forged preference is **unrepresentable** rather than merely refused — `accept_terms()`'s
property, for the same reason.

**Why a grant is not enough on its own, and why the grant is the whole of it here.** The `profiles`
SELECT policy is `(auth.uid() = id) OR (username IS NOT NULL AND NOT
private.is_blocked(auth.uid(), id))`, so every non-blocked rider with a username can see every
other such rider's ROW. RLS is row-level; the column grant is the only thing that can narrow it.

#### Scenario: Rider A cannot learn whether rider B opted out
- **GIVEN** riders A and B, in any relationship the schema can express — club owner and member,
  club admin and member, two members of one club, two riders in one ride's crew, strangers, or a
  pair where either has blocked the other
- **WHEN** A reads B's profile by any means available to `authenticated`: `select('*')`,
  `select('analytics_opt_out_at')`, an embedded `profiles(...)` on a member list, a ride crew, a
  postcard byline, a comment author, a chat participant, or a PostgREST `order`/`filter` on the
  column
- **THEN** every one of those SHALL fail with `42501` or return no such field
- **AND** A SHALL learn nothing about B's preference from the SHAPE of the failure either — the
  refusal is identical for a rider who opted out, a rider who did not, and a rider who does not
  exist

#### Scenario: A rider cannot write another rider's preference
- **WHEN** a rider calls `set_analytics_opt_out` while intending it for somebody else
- **THEN** there SHALL be no parameter through which to name them
- **AND** an UPDATE naming the column directly SHALL be refused with `42501` before any policy is
  evaluated, because `authenticated` holds no UPDATE grant on it

#### Scenario: A signed-out visitor reaches neither function
- **WHEN** a request arrives with no session, as `anon`
- **THEN** both functions SHALL be un-executable — EXECUTE is granted to `authenticated` only
- **AND** `anon` SHALL hold no grant on `profiles` of any kind, which is decision #1 and predates
  this change

#### Scenario: The preference is not readable by a role this change adds
- **WHEN** the roles reaching `public.profiles` are enumerated after `096`
- **THEN** the set SHALL be unchanged: `authenticated` (narrowed by `025`'s allowlist, which this
  column is not in), `postgres` and `service_role` (Supabase defaults, untouched)
- **AND** the fact that `service_role` and the table owner can read the column SHALL be stated
  rather than implied away — the dashboard reader sees it, exactly as they see every `feedback`
  row, and `delete-account` is the only service-role caller in this project and does not read it

### Requirement: The opt-out SHALL NOT be described as a guarantee the database can give

PostHog is a client-side SDK posting to `eu.i.posthog.com`. No RLS policy, CHECK or trigger is in
that path. `analytics_opt_out_at` is therefore a **remembered preference the client must honour**,
and nothing in this schema can make it true.

`CLAUDE.md` §Technology Decisions' rule — *RLS enforces authorization, never validity* — cuts the
other way here and the point is easy to invert. This is neither authorization nor validity: it is a
statement about what a **third party** may be told, and no constraint can reach it. Any spec, PR
body, privacy page or column comment implying otherwise is wrong and SHALL be corrected.

Exactly two things the database DOES guarantee, and the spec SHALL claim no third:

1. Nobody but the rider can read or write their own preference.
2. A feedback row written by an opted-out rider carries no session id.

#### Scenario: A defeated client still captures
- **GIVEN** a rider who has opted out
- **WHEN** a modified or stale client ignores the preference and calls `capture`
- **THEN** the event SHALL reach PostHog, and no database object SHALL have prevented it
- **AND** this SHALL be stated in the migration header and the column comment, so a later session
  does not read the column as an enforcement point

### Requirement: The analytics client SHALL boot opted-out and SHALL opt in only on a read preference

The preference lives behind a round trip. Between page load and that round trip resolving, the SDK
either captures or does not, and that window is a decision rather than an accident.

The client SHALL initialise in a **capture-off** posture — no events, no pageviews, no session
replay, no web vitals — and SHALL opt in only after `my_analytics_opt_out()` has returned NULL for
the current session. The failure mode is therefore **missing data**, never **data from a rider who
said no**.

The client SHALL remain capture-off when: there is no session; the accessor errors; the accessor
has not yet answered; or the accessor answers with a non-NULL stamp.

PostHog's own client-side opt-out persistence is a convenience and SHALL NOT be treated as the
guarantee — it is per-device and a fresh install or a new native device has none.

**The stated cost:** pre-session screens produce no analytics at all, so `/auth/login`,
`/auth/signup` and `/legal/*` pageviews are lost. Accepted, because every question PD-353 names is
post-session — including question 3, the onboarding wizard, which runs after signup establishes a
session — and the alternative captures a rider who has said no every time they sign out.

#### Scenario: The first paint of a session captures nothing
- **WHEN** the app boots and the preference has not yet been read
- **THEN** no event, pageview, replay or web-vital SHALL be sent
- **AND** any `capture` call made in that window SHALL be a no-op rather than a queued event that
  flushes when the SDK opts in

#### Scenario: The preference read fails
- **WHEN** `my_analytics_opt_out()` returns an error, or does not resolve
- **THEN** the client SHALL stay capture-off for the rest of that page load
- **AND** it SHALL NOT retry into an opted-in state on a subsequent success without the preference
  actually reading NULL

#### Scenario: Toggling takes effect without a reload
- **WHEN** a rider opts out during a session in which the client was capturing
- **THEN** capture and session replay SHALL stop before the call returns to the screen
- **AND** opting back in SHALL start them again in the same session

#### Scenario: The seam is unit-testable without a network
- **GIVEN** `NEXT_PUBLIC_POSTHOG_KEY` is unset, which is DEV's and every preview's normal state
- **WHEN** the analytics module is exercised
- **THEN** every call SHALL no-op cleanly rather than throw
- **AND** the boot order above SHALL be assertable in Vitest against the module alone, because
  `npm run walk` runs against DEV and can never exercise this path

### Requirement: An opt-out SHALL be a preference and SHALL NEVER be an authorization gate

An opted-out rider SHALL be able to do everything an opted-in rider can. No policy, CHECK,
grant, trigger or client guard SHALL test `analytics_opt_out_at` for any purpose other than
deciding whether to capture — with exactly one exception, `private.strip_feedback_session_id`,
which nulls a column and never refuses a row.

The reverse also holds: **opting out SHALL NOT itself require consent**. `enforce_participation_gate`
is not on `profiles` and SHALL NOT be added to it, and `set_analytics_opt_out` is `security
definer`, inside which `current_user` is the owner so the gate could never fire anyway (`078`'s
lesson). A rider who has not accepted the terms can still say no to analytics.

#### Scenario: An opted-out rider is not a degraded rider
- **GIVEN** a rider with a non-NULL `analytics_opt_out_at`
- **WHEN** they create a ride, join a ride, join a club, post a postcard, comment, like, send a
  ride message, send a club message, edit their profile, upload an avatar or send feedback
- **THEN** every one SHALL succeed exactly as it does for an opted-in rider
- **AND** no error, banner, nag or reduced affordance SHALL distinguish them

#### Scenario: A rider who has not accepted the terms can still opt out
- **GIVEN** a rider whose `terms_accepted_at` is NULL
- **WHEN** they call `set_analytics_opt_out(true)`
- **THEN** it SHALL succeed
- **AND** the participation gate SHALL NOT be extended to `profiles` or to either function in order
  to "close" this, because it is the correct behaviour and not a gap

### Requirement: A feedback row SHALL be able to carry the PostHog session id, and SHALL NOT depend on it

`feedback` SHALL gain a nullable `posthog_session_id text`, written at submit, so a report reaches
its reader beside the footage of what the rider was doing.

**Three rules from PD-353, all binding:**

1. **Nullable and best-effort.** A rider who opted out, or whose PostHog never loaded, or who is
   on a build where the key is unset, SHALL still be able to send feedback. Feedback failing
   because analytics did not load would be a worse defect than the one this fixes.
2. **The session id, never a replay URL.** The URL is constructible from the id and changes with
   PostHog's routing; a stored URL is a dead link waiting to happen.
3. **A stored id pointing at an expired recording is a null result, not a broken one.** The column
   inherits the pilot posture and its retirement condition, and the recording's lifetime is
   PostHog's, not this schema's.

The column SHALL carry a length CHECK in `084`'s style, and **the ceiling SHALL be generous rather
than tight**: a CHECK on a best-effort column converts a best-effort write into a hard failure, so
a ceiling that expresses PostHog's current 36-character format would turn every feedback submission
into `23514` the day that format grows. `route`'s 200 is the precedent and the number.

`feedback` remains write-only: no SELECT grant and no SELECT policy for any client role, so no
rider — including the author — can read the id back.

#### Scenario: Feedback sends when PostHog never loaded
- **GIVEN** a build with no PostHog key, or an SDK that failed to initialise
- **WHEN** a rider submits feedback
- **THEN** the insert SHALL succeed with `posthog_session_id` NULL
- **AND** the action SHALL NOT wait on, or await, anything analytics-related before inserting

#### Scenario: An opted-out rider's feedback carries no session id
- **GIVEN** a rider whose `analytics_opt_out_at` is not NULL
- **WHEN** they submit feedback, whatever value the client sends for `posthog_session_id` —
  including a forged one sent by a hand-rolled request against the publishable key
- **THEN** the stored row SHALL have `posthog_session_id` NULL
- **AND** the insert SHALL SUCCEED — the rule is enforced by nulling, never by raising, because
  rule 1 above outranks it

#### Scenario: A blank id is stored as NULL rather than as an id
- **WHEN** a client sends an empty or whitespace-only `posthog_session_id`
- **THEN** the stored value SHALL be NULL
- **AND** the insert SHALL succeed, so a client bug becomes missing data rather than a rider who
  cannot file

#### Scenario: Nobody can read the session id back
- **WHEN** any client role attempts to select, update or delete `feedback` by any path
- **THEN** it SHALL be refused, because `084` grants no SELECT and writes no SELECT policy and
  this change adds neither
- **AND** therefore no rider SHALL be able to learn from a feedback row whether any rider opted out

#### Scenario: The stored id outlives its recording
- **WHEN** a reader opens a feedback row whose session id points at a recording PostHog has
  expired, or which a re-scoped replay policy never captured
- **THEN** the result SHALL be an empty lookup, not an error, and not a broken reader
- **AND** the row's text SHALL still be readable on its own

### Requirement: Both new columns SHALL have a stated retention at creation

`CLAUDE.md` requires a stated window for anything holding personal data, and an absence is a
decision rather than an omission.

- `profiles.analytics_opt_out_at` lives exactly as long as its profile row — the cascade from
  `auth.users`. Nothing else deletes it, and there is no time-based sweep, because this project
  has no `pg_cron` and no scheduled Edge Function and a number nothing implements becomes a fact
  nobody rechecks (`036`'s reasoning, `084`'s wording).
- `feedback.posthog_session_id` lives exactly as long as its feedback row, which lives exactly as
  long as its author (`084` §0b, `on delete cascade`).
- **The recording the id points at is NOT covered by either**, and this SHALL be said plainly. Its
  retention is a PostHog project setting the owner sets, PD-353 owes the pilot *"the shortest
  replay retention the plan allows"*, and no migration here can assert it.

#### Scenario: Deleting an account takes the preference and the id
- **WHEN** a rider deletes their account through `delete-account`
- **THEN** their `profiles` row goes, taking `analytics_opt_out_at` with it
- **AND** their `feedback` rows go on `084`'s cascade, taking every stored session id with them
- **AND** whether that erasure must also reach PostHog's own store is **explicitly not settled by
  this change** — it is `design.md` §Q1, it is the owner's, and it SHALL NOT be silently assumed
  in either direction by the privacy page

### Requirement: The stored session id SHALL be understood as a key into a system with a different access model

A PostHog session id is inert in this database — unreadable by every client role, meaningless to
anyone without PostHog access. It is not inert in PostHog: while the pilot posture holds, it
resolves to an **unmasked** recording of that rider's screen, which necessarily includes other
riders' postcards, captions, bylines, photos, club names and messages that happened to be on it.

Those other riders opted into nothing and cannot reach the settings toggle to change it. PD-353
names this as the reason the pilot has a retirement condition — *"the pilot ends when signup reaches
riders nobody personally invited"*, with a numeric backstop of 50 completed profiles — and the
column inherits that condition rather than restating it.

**The toggle's copy SHALL NOT promise more than the toggle does.** A rider opting out stops their
own screen being recorded; it does nothing about their content appearing on somebody else's
recording, and no schema change could.

#### Scenario: The retirement condition is checkable
- **WHEN** anyone asks whether the pilot posture still holds
- **THEN** `select count(*) from profiles where onboarding_completed_at is not null` SHALL be the
  backstop, and the qualitative line — signup reaching riders nobody personally invited — SHALL be
  the one that governs
- **AND** re-scoping replay SHALL require no schema change: the column, the functions and the
  feedback link are all unchanged by it
