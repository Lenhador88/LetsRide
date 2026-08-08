# A username cannot be removed once it is set

> Linear **PD-127**. This file is the specification; the issue points at it and must not restate
> it. `CLAUDE.md` §The roadmap lives in Linear: *"A Linear issue that grows a specification is a
> bug."*

## Why

**A rider can delete themselves from every other rider's view in one request, and it is live in
production today.** `PATCH /rest/v1/profiles?id=eq.<me>` with `{"username": null}` succeeds. The
`profiles` SELECT policy reads

```
(auth.uid() = id) OR (username IS NOT NULL AND NOT private.is_blocked(auth.uid(), id))
```

so a NULL username removes the row from every other rider's read — bylines, comment authors,
member lists, ride crews, the availability check that tells the next rider a name is free. The
rider still sees their own row, so from inside the app nothing looks broken.

**Reproduced end-to-end, not inferred from grants.** Run on `letsride-dev`
(`fpmrimzxadewsaiwpsel`) 2026-08-08 inside a transaction that was rolled back, as `authenticated`
with `request.jwt.claims.sub` set to the row's own id:

```
PROBE before=devrider093453 after=<NULL> own_delete_rows=0
```

Four facts hold on production (`zwprydcyryvudhurbnye`), each measured:

| Fact | Value |
|---|---|
| `has_column_privilege('authenticated','public.profiles','username','UPDATE')` | `true` — `025` re-granted it per column |
| `profiles_username_format` | `username IS NULL OR username ~ '^[a-z0-9_]{3,20}$'` — **NULL passes** |
| `profiles_username_not_reserved` | `username IS NULL OR username <> ALL (…)` — **NULL passes** |
| `enforce_onboarding_completion` | guards `terms_accepted_at` and `onboarding_completed_at` only |

The trigger is the one that reads like cover and is not. For a rider who has already onboarded
its UPDATE arm reaches

```
if old.onboarding_completed_at is not null then
  new.onboarding_completed_at := old.onboarding_completed_at;
  return new;
end if;
```

and **returns early**, so it never reaches any username logic — and there is none to reach
anywhere in the function.

**Why it is worse than a self-inflicted foot-gun.** `003` treats completion as one-way and
requires a username to reach it, so this puts the row into a state onboarding declares
impossible — and leaves no repair path inside the app. `onboarding_completed_at` stays set, so
`my_onboarding_state()` returns `has_username: false` alongside a completion stamp, and
`resolveDestination` sends the rider to `/postcards` rather than back through
`/onboarding/username`. There is no profile screen that writes `username` (it is deliberately
absent from `profileEditSchema`). The rider is invisible, and the only way back is an operator
with database access.

Decision #7 makes the username *the* display name — there is no `full_name` to fall back to — so
this is not a cosmetic gap in one list. It is every rendering of that person, everywhere.

**`location` is the other half of `003`'s completion invariant and is deliberately left
writable-to-NULL.** It is reachable by the identical route — `authenticated` holds UPDATE on it,
`profiles_location_length` admits NULL, and the same early return means an onboarded rider's
`{"location": null}` lands. The difference is the harm: clearing a stated location is a privacy
affordance a rider might legitimately want, and no policy keys on its nullness, so it hides
nobody from anything. Stated here so the asymmetry is a decision rather than an oversight.

**Why now:** it is live, the fix is additive, and pre-flight is clean on both databases (0 rows
violate the invariant today — measured below). The window in which this costs one trigger branch
and nothing else is open now.

## What Changes

- **`038_username_is_not_removable.sql`** — one migration, one edit to
  `public.enforce_onboarding_completion()`, adding a `username` arm to the UPDATE path:

  ```sql
  if old.username is not null then
    new.username := coalesce(new.username, old.username);
  end if;
  ```

  It sits **above** the `old.onboarding_completed_at is not null … return new` early return.
  Placed below it, the branch is dead code for exactly the population it protects — which is the
  whole reason the defect exists.

- **The rule is "once set, never unset", not "once onboarded, never unset".** Keying on
  `old.username` rather than on `old.onboarding_completed_at` is one word shorter and strictly
  stronger: it also covers a rider who chose a name at step 1 and is sitting on step 2, a state
  the completion-keyed reading leaves open. Nothing in the app has ever offered to clear a
  username, at either point in the wizard.

- **Removal is silently coerced, not raised.** The write succeeds and the stored value is
  unchanged, matching `012`'s treatment of `terms_accepted_at` one branch above it in the same
  function. The alternative — raising `check_violation` — is argued and rejected in `design.md`
  §D2. The **new rule** must therefore be asserted as stored state rather than as a rejection;
  assertions that do check an error code are pinning refusals that predate this change.

- **No application code changes.** `setUsername` keeps its direct
  `.from('profiles').update({ username })`, its `23505` and `23514` branches, and its column
  grant. **This is not a `025`-shaped change and deliberately not** — see §Deployment ordering.

- **No new grant, no new function, no new security advisor.** The change is confined to one
  trigger function body.

**Explicitly not in this change:**

- **Whether a rider may *change* their username to another valid one** — see §Open questions Q1.
  The proposal is written to work either way: the guard above blocks removal only, so under
  today's behaviour a rename still succeeds, and forbidding renames later is one further `if` in
  the same branch. Nothing here decides it.
- **Revoking the `username` column grant** and routing writes through a `set_username()` RPC.
  Rejected for this change with reasons in `design.md` §D1; recorded as the follow-up that
  becomes correct the day a rename flow ships.
- **Revoking the unused `DELETE` grant on `profiles`.** `authenticated` holds table-level DELETE
  (measured `true`) and **no DELETE policy exists**, so a rider deleting their own row affects 0
  rows — proved in the probe above. Deleting the row is the other way to vanish, and today it is
  blocked by the *absence of a policy* rather than by the absence of a grant. That is exactly the
  unstated-negative shape `openspec/config.yaml` warns about, so this change **asserts** it in
  the suite and leaves the revoke to its own change (`design.md` §Follow-ups).

## Capabilities

### New Capabilities

None. Adding a capability for a single write rule would fragment the one place that already
owns write rules.

### Modified Capabilities

- `database-enforced-integrity`: gains **"A username SHALL NOT be removable once set"**. The
  standing spec states that onboarding completion is one-way and that a username is required to
  reach it, and states the `profiles` SELECT policy's dependence on username-nullness — but
  never states that the username itself is durable, so the invariant the other two requirements
  assume has nothing holding it up. This is the requirement that was missing rather than wrong.
  Read against `openspec/specs/database-enforced-integrity/spec.md`, which was checked before
  this line was written.

The other three standing specs (`client-render-shell`, `client-cache-invalidation`,
`client-session-storage`) are unaffected: no screen, cache key or session behaviour changes.

## Impact

**Database.** One migration, `supabase/migrations/038_username_is_not_removable.sql`. It
`CREATE OR REPLACE`s `public.enforce_onboarding_completion()`; both triggers
(`enforce_onboarding_completion` BEFORE UPDATE, `enforce_onboarding_completion_insert` BEFORE
INSERT) already point at it and are not recreated. No policy, grant, column or constraint moves.

**Pre-flight, measured 2026-08-08, both databases.** Zero rows violate the invariant, so nothing
needs repairing and no data migration is implied:

| Database | profiles | `username IS NULL` | those also onboarded |
|---|---|---|---|
| `letsride` (PROD) | 4 | 1 | **0** |
| `letsride-dev` (DEV) | 4 | 1 | **0** |

The single NULL-username row on each is a rider mid-wizard with `onboarding_completed_at` NULL —
the legitimate state, and the reason the guard keys on `old.username` rather than forbidding NULL
outright.

**Code.** None. `src/lib/actions/onboarding.ts`, `src/lib/actions/profile.ts`,
`src/lib/validation/profile.ts`, `src/lib/auth/guard.ts` and `guard-cache.ts` are all unchanged.
Confirmed by grep: `username` is written in exactly one place in `src/`
(`src/lib/actions/onboarding.ts:37`), and never with a NULL.

**Tests.** New assertions in `supabase/tests/rls_test.sql`, listed as tasks. Two existing
assertions must stay green unmodified and are worth naming because they are what a wrong fix
breaks: `rls_test.sql:378` (`username is still writable — onboarding step 2 is an ordinary
UPDATE`) and `rls_test.sql:145` (`a rider who has chosen a username is visible before onboarding
completes`).

## Deployment ordering

**This change carries no ordering constraint, and that is the argument for its shape.**
`CLAUDE.md` §Supabase Rules records that `021` had to be split because it held both an accessor
and the revoke that made it necessary, which must apply at different times relative to the code
deploy; and that `025` applied before its code deployed is an instant outage. **Option 1 (revoke
the column grant) is that shape exactly** — `setUsername` writes the column directly today, so a
revoke landing before the replacement code deploys breaks onboarding step 1 for every new rider,
with a `42501` and no retry path. It would have to be split into an additive `038` and a
destructive `039` with a deploy between them, for a rule the trigger can carry in one file.

**The sequencing question this change *does* raise is PROD's queue, and it is the owner's.**
Measured 2026-08-08 with `list_migrations` against `ls supabase/migrations/`:

- **DEV is at `037`** (`20260808075952 places_index`).
- **PROD is at `035`** (`035_comment_whitespace_floor`). Both `036` and `037` are unapplied there.
- **They are unapplied for opposite reasons, and `docs/HANDOFF.md` §Two migrations says so in
  terms: "conflating them is how the wrong one gets applied".** `036_notifications` is held back
  **deliberately** — its header hangs six triggers off five already-shipped write paths, so from
  the moment it applies every like, comment, RSVP, ride creation and club join runs new code
  inside the rider's transaction; PROD goes only after those five paths have been exercised by
  hand on DEV *and* the code has deployed. **`037_places_index` is merely unshipped** — purely
  additive, in `034`'s class, and HANDOFF states it *could* go to PROD ahead of its code, needing
  only its own data load there.

So there are **three** orders available, not two, and the middle one is the recommendation:

| Order | Deviation from filename order | Cost |
|---|---|---|
| `036`, `037`, `038` | none | the live hole waits on the notifications rollout |
| **`037`, `038`** | **one file, and that file is not gated** | `037` reaches PROD with an empty `places` table until the owner's `\copy` |
| `038` alone | two files, one of them the gated `036` | smallest apply, largest gap between file order and hosted order |

Two properties make any of them safe, stated so the owner is deciding rather than discovering
this at apply time:

1. `038` touches `public.profiles` only, and `036`/`037` touch neither `profiles` nor
   `enforce_onboarding_completion`. They are independent files in every direction.
2. `supabase/tests/run.sh` applies by filename, so the local suite always runs the full chain in
   order and proves nothing about the hosted apply order either way.

**Recommended default (Q3): apply `037` then `038`, leaving only the deliberately-gated `036`
behind.** It closes the live hole while deviating from filename order by a single file that
nothing is holding back — strictly less drift than skipping both, and it does not require the
notifications rollout to finish first. `037` arriving with an empty `places` table is the state
DEV is already in and is not a regression. Record the
deviation in the migration header, in `docs/ENVIRONMENTS.md` and in `docs/HANDOFF.md`. **The owner
may prefer either of the other two rows**; both are legitimate, and the cost of each is in the
table.

## Open questions

Each carries a recommended default so the build is not stalled by an unanswered one. Blocking
means the migration cannot be written without the answer.

**Q1 — May a rider change their username to a different valid one? (non-blocking; product owner)**
The defect report says only that *removal* must be impossible and does not answer this. Renames
are possible today by accident rather than by design: `profileEditSchema` deliberately omits
`username`, so no screen offers it, but the column grant permits the write. A rename has real
consequences nothing currently handles — no history, no redirect, and every rider who learned the
name loses it silently.
**Default: leave renames possible.** The guard proposed here is NULL-only, so this default is
what falls out of writing no extra code, and forbidding renames later is one further `if` in the
same branch with no ordering cost. **Do not read this as a decision that renames are a feature** —
they are unbuilt and unsurfaced, and shipping one is its own change with a conflict path, a
rate limit and a cache story.

**Q2 — Should a removal attempt raise, or be silently coerced? (non-blocking; agent-decidable,
decided)** Decided as coerce, matching `012`. Full argument in `design.md` §D2. Recorded as a
question because it changes what the suite asserts, and a reviewer expecting `23514` would
otherwise read the assertions as wrong.

**Q3 — PROD apply order: which of the three rows in §Deployment ordering's table. (BLOCKING for
the PROD apply only; product owner)** Recommended default is `037` then `038`. It does not block
writing the migration, the tests, or the DEV apply.

**Q4 — Is there a rider on PROD already in the impossible state? (non-blocking; answered)**
Measured: no. 0 rows have `onboarding_completed_at` set with a NULL username on either database.
Re-run it immediately before applying rather than trusting this line — if the answer has changed,
the row needs an operator-set username *before* anything else, and the migration does not and
must not invent one.
