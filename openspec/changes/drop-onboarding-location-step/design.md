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

## D7. Rejected — completing a mid-wizard rider automatically

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

## D8. What drags along

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
`EditProfileForm` already edits `profiles.location`, so the field is reachable; what nobody has is a
reason to go there.

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
