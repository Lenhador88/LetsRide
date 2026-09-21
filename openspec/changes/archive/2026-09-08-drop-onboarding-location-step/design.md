# Design — dropping the location step

Mechanism, the alternatives that were rejected and why, the ordering decision, and the open
questions. `proposal.md` is what changes; this is how, and what it costs.

Everything measured here was read on **2026-08-24** against DEV `fpmrimzxadewsaiwpsel` and PROD
`zwprydcyryvudhurbnye` unless it says otherwise. Nothing was written to either project.

## D1. Which copy of the invariant is load-bearing

The location rule is written down three times and **only one of them decides what the app can do.**

`complete_onboarding` is `security definer`. Inside it `current_user` is the *owner*, so
`enforce_onboarding_completion`'s opening `if current_user <> 'authenticated' then return new`
short-circuits and the trigger never evaluates its location arm for the RPC's own UPDATE. `059`'s
body says this in a comment, and `033`'s footer records that the trigger must **stay**
`security invoker` for it to remain true.

Two consequences that decide the shape of `075`:

- **Relaxing only the trigger would ship nothing.** The RPC would still raise. A change written
  that way passes `tsc`, passes the RLS suite (which runs as the table owner, for whom neither
  barrier exists — `031`'s lesson), and fails for the first real rider.
- **Relaxing only the RPC would work, and would still be wrong.** The trigger's arm is unreachable
  today by grant — `025` leaves `authenticated` with UPDATE on `avatar_path`, `bike_model`, `bio`,
  `cover_image_path`, `location` and `username`, and on **neither** stamp (verified against
  `information_schema.column_privileges`) — so it is defence in depth over a door that is already
  locked. But it is defence in depth that states a rule the schema no longer has. Left behind, it
  is what the next reader finds when they ask what completion requires, and it would refuse a
  legitimate support-path write for a rider who has no location. Both arms come out.

**The `current_user` gate itself stays.** The standing requirement *A trigger that must run for
every writer SHALL NOT be gated on `current_user`, and one that must skip privileged writers SHALL*
puts this trigger in the second category by construction: it constrains what a **client** may write,
and the seed, `handle_new_user` and a dashboard fix must all pass through it. Removing that gate to
"make the rule apply everywhere" would break the seed and `033`'s constraint in one edit.

## D2. Rejected — one RPC that takes the username too

`complete_onboarding(p_username text, p_location text)` would close the two-round-trip window in
§D3 outright. It is rejected because it puts a **second copy** of the username rules in SQL:

- `checkUsername` normalises and validates charset, length and the reserved list before the write.
- `003` §4 carries the same rules as CHECK constraints and a unique index on `lower(username)`.
- `setUsername` maps `23505` to a *field-level* message carrying the refused value, which is
  PD-146's fix for the availability check being block-aware while the index is global.

An RPC that also took the username would have to reproduce the refusal mapping to keep that
behaviour, or drop it and regress PD-146. The window it closes is benign (§D3); the duplication it
creates is the failure mode `CLAUDE.md` calls out for two specification systems and two permission
mechanisms — the copy that goes stale is always the one you did not read.

## D3. The two-round-trip window, and why it is benign

`setUsername` writes the username, then calls the RPC. Between them the rider has a username and no
stamp. That is not a new state — it is exactly the state every rider occupied for the length of the
location step until today, and the guard already has an answer for it.

What makes it safe is that **the recovery is the screen they are already on.** The resume target for
`has_username && !completed` becomes `/onboarding/username`; resubmitting the same name is an UPDATE
of their own row, which raises no unique violation against itself, and `038` refuses only a username
*removal*, never a rename. So the sequence retries cleanly and idempotently.

What it costs is one screen of friction for a rider whose RPC call failed: they retype a name they
already chose, because the field has no `defaultValue` and the guard state carries only
`has_username`, not the name itself. §Q1 is that question.

**"Cleanly" is true only with §D7's one-line fix, and was not true as first written.** The live
availability check has no exclusion for the caller, so retyping your own name draws the *taken*
error in red on the field. Submit is not blocked — the check is advisory and the Button carries no
`disabled` — so a rider who pushes through still completes; but a recovery path that opens by
telling a rider their own name is taken is not the clean retry this section's safety argument
leans on. `075` adds the exclusion.

One thing this section does **not** cover, and §D8 does: `location` also stops being mandatory on
the profile editor in this change. That is not a courtesy — it is what makes the near-you deferral
in `proposal.md` §Out of scope honest rather than a trap.

## D4. The line that turns a refusal into data loss

Stated in `proposal.md` §Why and specified as its own requirement, repeated here because it is the
single most dangerous edit in the change:

```sql
-- 059, as deployed
update public.profiles p
   set location                = p_location,
       onboarding_completed_at = coalesce(p.onboarding_completed_at, pg_catalog.now())
```

The assignment is unconditional. It is safe **only** because the raise several lines above refuses a
NULL or blank `p_location` before control reaches it. Delete the raise and the first call the new
client makes — `rpc('complete_onboarding', { p_location: null })` — writes NULL over whatever was
there, and `059`'s own comment establishes the function is re-runnable: *"re-running this updates
the location and returns the ORIGINAL stamp."*

It becomes `location = coalesce(nullif(btrim(p_location), ''), p.location)`.

- `nullif(btrim(...), '')` because `018`'s `profiles_location_length` CHECK refuses a trimmed-empty
  string; storing `'   '` would raise `23514` where doing nothing is the correct answer, and the
  suite already asserts that CHECK fires from inside a `security definer` function.
- `coalesce` deliberately **not** schema-qualified, matching every other `coalesce`, `nullif`,
  `greatest`, `least` and `case` in these functions. `059`'s comment records why: they are SQL
  constructs, `pg_catalog.coalesce` does not exist, and writing it raises `42883` **on the happy
  path** — a failure no amount of reading catches and one this repo has already shipped once.

## D5. Ordering — additive first, then deploy. It is not a `021`/`025` deadlock

**The decision: apply `075` first, deploy the code second.** On PROD, apply it *before* the
promotion build serves, which is `069`'s precedent — not "after the merge", since `070`'s header is
explicit that merged is not deployed.

The argument is that the two orders are not symmetric, and one of them is unrecoverable:

| Order | Old bundle, new database | New bundle, old database |
|---|---|---|
| **Migration first** (chosen) | `complete_onboarding('Utrecht')` — the location arm is gone but the argument is still accepted and still stored. **Behaviour identical.** | n/a |
| Deploy first | n/a | `complete_onboarding(null)` raises `23514` on **every** signup. The action maps it to *"Finish the earlier steps first."* — and there are no earlier steps, and no location screen to fall back to, because the deploy deleted it. Every new rider is permanently stuck on the username screen. |

So the ordering is forced by the failure mode rather than chosen for tidiness. The `021`/`025`
deadlock — a single file holding both an accessor and the revoke that makes it necessary, which must
apply at different times relative to the deploy — **does not arise here, and it is worth saying why
rather than just asserting it.** That deadlock exists when a change has a *destructive* half: a
revoke, a drop, a narrowing that breaks the currently-deployed code. This change has none.
Everything in `075` **widens** what is accepted, so:

- it is a no-op for the deployed bundle, which never sends a NULL location;
- it can sit applied for any length of time before the deploy, which is exactly what DEV-ahead-of-PROD
  already looks like between a merge and a promotion;
- **it survives a rollback of the code.** Revert the bundle and the location step comes back, sends
  a location, and the relaxed function stores it. There is no state to unwind.

The one destructive act in this change is deleting `/onboarding/location`, and that is code rather
than schema — it lands with the deploy, and §D6 is what stops it stranding anybody.

**There is deliberately no follow-up migration.** Dropping `p_location` from the signature later
would cost `021`'s and `025`'s grant statements a rewrite, would create a window where the deployed
bundle names a function that no longer exists, and buys nothing — the argument still does real work
for the profile-edit path's benefit and for any future caller that has a location to offer.

## D6. The guard's catch-all, and the failure it prevents

`resolveDestination` currently answers `null` — *stay here* — for `/onboarding/location` when
`has_username` is true. That is correct today and becomes the worst reachable defect in this change
the moment the route is deleted: the rider gets a 404 body while the guard actively decides they
belong there. No gate in this repo sees it. The walk renders every screen it knows about, and it
will not know about a route that was deleted.

The branch becomes: `/onboarding/terms` → resume; the resume path itself → `null`; **anything else
under `/onboarding` → resume.** Written as a catch-all rather than as a redirect for one path,
because `isOnboarding` is a prefix test and the rule should hold for the next step this wizard gains
or loses.

The special case it replaces — *step 2 cannot be reached before step 1* — disappears with step 2.
Its comment should not be deleted silently; the migration from two steps to one is what makes it
moot, and the replacement comment should say so.

**The catch-all only works if `RouteGuard` mounts for an unmatched URL, and that was measured
rather than reasoned about.** The doubt is real and specific: `not-found.tsx` sits at `(app)/`,
`/onboarding/*` is outside that route group, and if Next served a bare 404 without rendering the
root layout then `RouteGuard` — which is mounted in the **root** layout — would never run, leaving
the rider on a dead page with no way back and the redirect above never firing. That is a framework
behaviour, not a repo one, so it is the kind of thing the next session re-derives or, worse,
assumes:

```bash
npm run build && npx next start &
curl -si localhost:3000/onboarding/location | head -40   # compare against /auth/login
```

**Measured: HTTP 404, and the response body carries the root layout and the guard.** The markup
holds `<body class="min-h-full bg-background text-foreground font-sans antialiased">` and
`RouteGuard`'s `logo-splash` image, byte-identical in that region to `/auth/login`, with no visible
404 text anywhere. So the root layout renders, the guard mounts, the splash paints and the redirect
fires — the rider sees the ordinary boot, not a 404. **The status code stays 404 and that is
correct**: it is a real unmatched URL, and the redirect is a client-side decision layered on top of
an honest status rather than a rewrite of it.

Two consequences worth keeping. The `(app)/not-found.tsx` boundary is **not** what saves this, so
moving or deleting it changes nothing here — do not read this measurement as depending on it. And
because the guard's answer arrives after hydration, this is a redirect rather than a render: a
rider on a slow connection sees the splash first, which is the same first paint every cold load
already produces.

## D7. The availability check tells a rider their own name is taken

`056`'s `public.username_exists(p_username text)` is

```sql
select exists (select 1 from public.profiles
                where lower(profiles.username) = lower(p_username));
```

with **no exclusion for the caller**. `security invoker`, and its own comment says so: it answers
"is this name reachable" under the block-aware SELECT policy. A rider's own row is one the caller
can see, so retyping the name they already chose returns `true` and the field draws
`USERNAME_TAKEN_MESSAGE` in red.

**This is a shipped defect, not one this change pre-empts** — an earlier revision of this section
said the opposite ("unreachable today; the only screen calling it is the username step, and a rider
reaches it once, before they have a name") and that was wrong in a way worth naming, because the
same reasoning is what makes it invisible. `/onboarding/location` carries
`back={{ href: '/onboarding/username', label: 'Back' }}`, and the guard **permits** the move: its
own comment says *"Going backwards stays allowed — step 2 has a Back link, and editing a username
you already chose is fine"*, and `guard.test.ts` carried a case named *"may still go backwards to
step 1 once step 2 is reachable"* proving it. So on `main` today, a rider who picks a name,
advances, taps Back and retypes the name they just chose is told in red that it is taken.

What this change does is make that path **ordinary** rather than merely available: §D3's recovery
after a partially-failed completion, and §Q1's mid-wizard rider at the deploy, both consist of
arriving at that screen with a username already set, and neither requires anyone to press Back.

The correction matters beyond the sentence. "Unreachable today" is the reasoning that would have
made this a follow-up ticket, and it survives review easily because it is *nearly* true — the
screen is reached once in the happy path. A defect reachable only by a Back button is still
reachable by every rider who presses one.

**Decision: fix the function, in `075`, rather than documenting what the rider sees.** One
predicate — `and profiles.id <> (select auth.uid())`. Three reasons, and the first is the one that
settles it — note that the first two now argue for fixing a live defect rather than for
forestalling a new one:

- **§D3 is a safety argument, and it is only sound if the retry is clean.** The two-round-trip
  window is defended in this proposal on the grounds that the recovery is the screen the rider is
  already on; a recovery screen that opens by telling the rider their name is taken is not the
  clean retry that argument claims. Documenting it would leave the argument standing on prose.
- **The exclusion is what the function's own contract already says.** It answers availability *to
  the caller*, and a rider's own current name **is** available to them — updating a row to the value
  it already holds raises nothing, and `038` permits a rename. Without the arm the function answers
  a question nobody asked ("does any visible row hold this string", including yours).
- **It is the same widening shape as the rest of `075`**, so it inherits §D5's ordering safety
  wholesale: it can only turn a `true` into a `false` for exactly one row, the caller's own, and the
  unique index is still what decides. No call site changes; `isUsernameTaken` and
  `checkUsernameAvailability` are untouched.

It does **not** fix PD-146 and must not be described as doing so. A name held by a rider who has
blocked the caller still reads free, because that is the SELECT policy rather than this predicate,
and `usernameVerdict` is still what reconciles the two on screen.

## D8. The profile editor requires a location, and the walk depends on it doing so

**The gate this change would otherwise create one screen past the wizard.** `profileEditSchema`
carries `location: locationSchema`, and `locationSchema` is
`.trim().min(1, 'Tell us where you ride from.')`. `updateProfile` parses the whole form through it,
so a rider with NULL `location` cannot save a bio, a bike, or anything else until they fill it in.
`EditProfileForm` also renders the Input `required` — which is **not** what refuses the submit, and
the distinction matters for anyone testing the fix: the form carries `noValidate`, so the browser
never enforces it and the refusal comes from Zod at the action boundary. Both come off.

`location` takes the `optionalText` shape `bio` and `bike_model` already use: trim, a `max(100)`
message, and `transform((value) => value || null)`. Empty means **clear it**, and it stores NULL
rather than `''` — which is the only value `018`'s `profiles_location_length` permits for "no
location", since that CHECK refuses a trimmed-empty string. One ordering detail for the
implementer: `optionalText` is declared *below* `locationSchema` in the file today, so the
definition has to move rather than being edited in place.

**And this breaks a walk phase, which is the part no reviewer pass would find by reading the
schema.** `checkEditProfileRetention` (`scripts/walk.mjs`) fills `location` with `'   '` **as its
refusal trigger** — its header says so: *"`noValidate` lets a whitespace-only `location` reach
`updateProfile`, and `profileEditSchema`'s `.trim().min(1)` refuses it before any query runs."*
Make the field optional and that submit **succeeds**, with three consequences:

1. `the refusal is reported` fails — there is no alert to find.
2. `location survives it` fails — nothing was refused, so there was nothing to retain.
3. **The phase clears the walk account's stored location on DEV**, which poisons its own first
   assertion (`location loads from the stored profile`) on every subsequent run. A fixture that
   destroys its own premise is worse than a red phase, because the second run's failure points at
   the wrong thing.

The phase must keep testing PD-203's `??` chain and the retention, so the fix is a **different
refusal on the same field**: a 101-character location, which `optionalText`'s `max(100)` still
refuses. The phase's header also asserts that `023`'s trigger guarantees the walk account a
non-NULL location — true for that account and no longer true as a *rule*, so it is rewritten rather
than left.

## D9. Rejected — completing a mid-wizard rider automatically

Tempting, because after `075` a rider with a username and a consent stamp needs nothing further:
the app could call `complete_onboarding(null)` for them and skip the screen entirely. Rejected on
two grounds:

- **The only place with the state to make that decision is the route guard**, and a routing decision
  that performs a write is a side effect in a read path that fires on every page load. `guard-cache`
  has one writer for the session half on purpose.
- **It would complete onboarding for a rider who never saw the last screen finish**, which is a
  product decision about consent-adjacent state that nobody has asked for.

The measured population makes this cheap to decline: **zero** riders on either project are currently
mid-wizard with a username (DEV has one incomplete rider who has not chosen a name and therefore
starts at the surviving step anyway). That is a snapshot — one signup before the deploy creates such
a rider — and §Q1 is the question about what they see.

## D10. What drags along

- **`Pagination` comes off the username page rather than becoming `total={1}`.** A one-dot progress
  indicator says nothing, and the component's header calls it a wizard step indicator. The location
  page takes its own `Pagination`, its `back` link and its `retaining`/`seedRetained` usage with it.
- **`setUsername` returns `redirectTo: '/postcards'`.** It must not name a wizard step; `acceptTerms`
  already sets the precedent of leaving the real destination to the guard.
- **The seed's `halfway` fixture** (`supabase/tests/seed.sql`, id `…000d`: username, consent, no
  location, no completion) stays and becomes *more* useful, not less — it is now the exact shape of
  the mid-wizard rider §Q1 is about. Its comment ("Mid-onboarding, step 2") is the part that goes
  stale.
- **Two RLS assertions invert rather than being deleted.** `complete_onboarding() refuses a NULL
  location` and `... refuses a location of nothing but spaces` become assertions that the call
  **succeeds** and leaves the stored location alone. `CLAUDE.md` §Supabase Rules: compare label sets
  rather than counts when reconciling two runs, because a count cannot tell a rename from a loss —
  which is exactly what `038` did to one of `036`'s assertions. Rewriting these two in place, with
  new labels naming the new behaviour, is the shape that survives that comparison honestly.
- **Two comments in `guard-cache.ts` enumerate the writer list in prose** — its §Writers header
  and `invalidateOnboardingState`'s own doc block both name `setUsername`, `acceptTerms` and
  `setLocation`. The `guard-cache-invalidators` registry claim greps **call sites**, filtering
  comment lines out by design, so both of these would read green for ever while naming a function
  that no longer exists. This is the comment trap in its other direction: not a grep counting
  obituaries, but a claim that cannot see the prose it is supposed to be keeping honest.
- **Three raise messages name a rule that will not exist** — `complete_onboarding`'s username arm
  and both arms of `enforce_onboarding_completion` all raise *"onboarding cannot be completed
  before username and location are set"*. `rls_test.sql:3100,3102` assert SQLSTATE `23514` only, so
  nothing goes red, and the message is what a support session reads first.
- **The walk's profile-edit phase loses its refusal trigger** — §D8. A whitespace-only location
  stops being refused, so the phase needs a 101-character one instead, and its header comment needs
  the `023` justification rewritten.
- **Two `docs:check` claims count guard test cases by running vitest** (`guard-cases-claude`,
  `guard-cases-claude-table`), so editing `guard.test.ts` moves a number in two places in
  `CLAUDE.md`. Both are `kind: 'vitest-file'` and therefore **excluded from CI's cheap set** —
  `npm run docs:check` locally is the only thing that catches them. The third claim,
  `guard-cache-invalidators`, is a shell grep and **does** run in CI.

## Open questions

Each carries a recommended default so the build is never blocked on an answer, per
`CLAUDE.md`'s standing instruction that a stated assumption is cheap to correct.

### Q1 — What does a rider mid-wizard at the moment of the deploy see? *(non-blocking; product owner)*

They have a username and no stamp. The guard sends them to `/onboarding/username`, where the field
is **empty** — the page seeds from an empty action state and the guard carries only `has_username`,
never the name. They retype the name they already chose (or a different one; a rename is permitted)
and land on `/postcards`.

**With §D7 applied, what they see is an empty field and no error.** Without it they would see their
own name reported as taken, in red, on a screen they must push through — which is why §D7 is in
this change rather than in a follow-up.

**Recommended default: ship it as described, and do not prefill.** The measured population is zero
on both projects, the retype is one field on a screen the rider has seen before, and the alternative
costs a new data read (`getMyUsername()` in `lib/data/profile.ts`, through `useQuery`, in an effect)
on the one screen in the app that currently has no query at all — which is also the screen where a
failed read would have to degrade to exactly the behaviour being replaced.

The alternative, if the owner prefers it: prefill from a one-column read and let the rider press
Finish. It is a small, safe addition and it becomes worth more the longer the gap between this
proposal and the deploy.

### Q2 — Does the username screen's copy still fit as the last step? *(non-blocking; product owner)*

Its primary is the design's "Next" today, with the location screen's reading "Finish" precisely
because it was last. The button that now completes onboarding says "Next" and promises a screen that
does not exist — the same reasoning the location page's own header used, inherited by whichever step
is terminal.

**Recommended default: the username step's primary becomes "Finish".** Read the frame from the
committed snapshot rather than the Figma API before writing the copy —
`npm run figma -- text "<flow> / <screen>"`, with `--all`, since a component instance carries
variant slots it does not use.

### Q3 — Should the profile editor prompt for a location at all now? *(non-blocking; product owner)*

Out of scope for this change, and named here only so the omission is not read as an oversight.
`EditProfileForm` edits `profiles.location`, and after §D8 it does so **without demanding one**, so
the field is genuinely one tap away rather than nominally so; what nobody has is a reason to go
there.

**Recommended default: leave it alone in this change**, and take it up with PD-170 (*nothing explains
why the app wants your location before the permission prompt fires*), which is the same missing
explanation on a different screen. PD-260's near-you strip on the rides list is the second place it
will matter.

### Q4 — Is `075` still the free number when the work starts? *(non-blocking; whoever implements)*

`074` is the highest file today and no in-flight change under `openspec/changes/` names `075`
(`grep -rln "075_" openspec/changes/ | grep -v archive` → nothing). Migrations are append-only and
another session may merge one first.

**Recommended default: re-derive at implementation time** — `ls supabase/migrations/` against
`list_migrations` on **both** projects, per `CLAUDE.md`; do not inherit the number from this file.

### Q5 — Does anything still want a location at signup for a *reason*, rather than by habit? *(non-blocking; product owner, and it is the one that would reopen the change)*

Asked once and then dropped, per one-hold-per-issue. The field's only current consumer is
`resolveFromProfile`'s fallback in the rider-location chain, which degrades to `null` cleanly. No
policy, no fan-out, no notification and no visibility rule reads `profiles.location` — verified by
reading the applied policy set rather than inferred.

**Recommended default: proceed.** If the answer is ever "yes, and it must be present", the shape to
reach for is a prompt on the surface that needs it, not a gate at signup.
