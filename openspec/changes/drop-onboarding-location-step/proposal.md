# Drop the location step from onboarding — relax a completion invariant, then delete a screen

> Linear **PD-286**. This file is the specification; the issue points at it and must not restate
> it. `CLAUDE.md` §The roadmap lives in Linear: *"A Linear issue that grows a specification is a
> bug."* The issue carried no comments at proposal time (`list_comments` → `[]`), so its body is
> the whole brief.

## Why

`/onboarding/location` is **step 2 of 2**, and deleting the screen is the smallest part of the
work. The screen is where `onboarding_completed_at` is committed, so removing it moves a
**completion invariant** that is written down in three places at once:

| Where | What it says today | Verified |
|---|---|---|
| `public.complete_onboarding(p_location text)` | raises `check_violation` when `p_location` is NULL or blank (`059`, restating `003` §6a) | `prosrc` read off DEV `fpmrimzxadewsaiwpsel`, 2026-08-24 |
| `public.enforce_onboarding_completion()` | refuses the stamp when `new.location is null` — on **both** its INSERT arm and its UPDATE arm (`023`, superseding `003`/`012`) | same read; the INSERT arm is the one no prose in this repo mentions |
| `src/lib/auth/guard.ts` | resolves a resume step of `/onboarding/location` for any rider with a username and no stamp | `resolveDestination`, line 188 |

None of the three can be edited alone. A screen deleted without the first two strands every new
signup; the first two relaxed without the third leaves a resume target that no longer renders.

**Two mechanisms make this sharper than it looks, and each is a silent failure rather than a loud
one:**

- **`complete_onboarding` is `security definer`, so neither trigger applies to it.** Inside a
  `security definer` function `current_user` is the *owner*, and both
  `enforce_onboarding_completion` and `enforce_participation_gate` open with
  `if current_user <> 'authenticated' then return new` / a `WHEN (CURRENT_USER = 'authenticated')`
  clause. The RPC therefore carries its own copy of every rule, which `059`'s body says in as many
  words. **Relaxing the trigger changes nothing about what the app can do; relaxing the RPC is
  what changes behaviour.** A change that touched only the trigger would test green and ship
  nothing.
- **`complete_onboarding` writes `location = p_location` unconditionally, and it is re-runnable.**
  Today a NULL argument is refused before that line is reached. Relax the refusal without touching
  the write and the same call **silently overwrites a rider's stored location with NULL** — the
  refusal is the only thing standing between a re-run and data loss. This is the single most
  dangerous line in the change and §What Changes fixes it explicitly.

**The population, measured 2026-08-24** (`execute_sql`, both projects) — it is the reason the
mid-wizard hazard is a design question rather than an incident, and it is a *snapshot* that a
single signup between now and the deploy invalidates:

| | profiles | incomplete | incomplete **with** a username | completed with no location |
|---|---|---|---|---|
| DEV `fpmrimzxadewsaiwpsel` | 10 | 1 | **0** | 0 |
| PROD `zwprydcyryvudhurbnye` | 5 | 0 | **0** | 0 |

## What Changes

### 1. One migration, `075`, relaxing the location arm in both places

`075` is unclaimed — `074` is the highest file and no in-flight change under `openspec/changes/`
names it. Re-derive rather than inherit, per the tasks file.

**`public.complete_onboarding(p_location text)` — the signature does not change.** Three edits to
the body, reproduced whole with every comment carried verbatim, per `033`'s reconciliation rule:

1. The location arm of the `003` §6a guard is deleted. The `username is null` arm and `023` §1.13's
   consent arm both stay, word for word, with the same message and the same `check_violation`.
2. The write becomes `location = coalesce(p_location, p.location)` — **a NULL argument now means
   "leave it alone", never "clear it".** This is not tidiness; see §Why.
3. A blank-but-not-NULL argument (`'   '`) must resolve to the same thing as NULL rather than
   being stored, because `018`'s `profiles_location_length` CHECK refuses a trimmed-empty string
   and would turn a whitespace argument into a `23514` the rider cannot act on. Use
   `coalesce(nullif(btrim(p_location), ''), p.location)`.

**`public.enforce_onboarding_completion()` — the `new.location is null` conjunct comes out of both
arms**, INSERT and UPDATE, leaving `username` and `terms_accepted_at`. Reproduced whole from
`023`'s definition, comments verbatim.

Three things this migration deliberately does **not** do:

- **It does not drop `p_location`, and it does not add an overload or a DEFAULT.** Keeping the
  identity `complete_onboarding(text)` exactly as it is means `021`'s `revoke`/`grant` pair and
  `025`'s footer still name the right function, no PostgREST overload-resolution question is
  created (PGRST203 is a real failure mode when two candidates exist), and — the load-bearing part
  — **an old bundle calling it with a location keeps working unchanged**, which is what makes the
  ordering in §3 safe. The new caller passes `{ p_location: null }` explicitly, so nothing depends
  on PostgREST resolving a defaulted argument from an empty body.
- **It does not remove the `current_user` gate from the trigger, or make it `security definer`.**
  `033`'s footer requires that trigger to stay `security invoker`, and the standing requirement
  *A trigger that must run for every writer SHALL NOT be gated on `current_user`, and one that
  must skip privileged writers SHALL* puts this trigger squarely in the second category: it
  constrains what a **client** may write and must let the seed, the signup trigger and a support
  fix through. That gate is correct and stays.
- **It does not touch `018`'s `profiles_location_length` CHECK, the column, or its grants.**
  `location` remains a rider-editable free-text column, NULL-able exactly as it already is.

### 2. The username step becomes the last step and commits the stamp

`src/lib/actions/onboarding.ts`:

- `setUsername` keeps its `profiles` UPDATE and its whole `23505` → field-level "taken" handling
  (PD-146), then — only on success — calls `supabase.rpc('complete_onboarding', { p_location: null })`,
  maps `23514` to the existing *"Finish the earlier steps first."*, calls
  `invalidateOnboardingState()` **once, after both writes**, and returns `redirectTo: '/postcards'`.
- `setLocation` is deleted, with `/onboarding/location/page.tsx`.

**The order of the two writes is contract.** Username first, RPC second: the username write is the
one that can be refused for a reason the rider must act on, and a rider refused there must not
already be stamped complete with no username.

**The window between them is benign, and that is asserted rather than assumed.** If the RPC fails
after the username lands, the rider has a username and no stamp — the guard's resume step is the
screen they are already on, and resubmitting the same name updates their own row (no unique
violation against itself; `038` permits a rename and refuses only a removal) and re-runs the RPC.
The path is idempotent, which is why folding both writes into one RPC is **rejected**: it would
move username charset, reserved-name and 23505-to-field-message handling into SQL, making a second
copy of rules that already live in `checkUsername` and `003` §4.

### 3. The guard loses a resume target and gains a catch-all

`resolveDestination`'s resume becomes the constant `/onboarding/username`, and the `isOnboarding`
branch becomes: `/onboarding/terms` → resume; the resume path itself → `null`; **anything else
under `/onboarding` → resume.**

The catch-all is the fix for the worst reachable failure in this change. Today the branch returns
`null` — *stay here* — for `/onboarding/location` when `has_username` is true. Delete that route
and leave the branch alone and a rider who reloads that URL (a bookmark, a stale tab, a native
shell restoring its last path) gets a 404 body with the guard actively deciding they belong there.
`isOnboarding` is `pathname.startsWith('/onboarding')`, so the catch-all also covers any future
path under that prefix rather than only the one being deleted.

### 4. Everything the two above drag with them

`Pagination total={2} current={0}` on the username page: **remove the indicator entirely** rather
than rendering `total={1}` — a one-dot progress bar communicates nothing and the component's own
header calls it a wizard step indicator. The location page's `back` link, `retaining`/`seedRetained`
usage and `Pagination` import go with the file. Two `docs:check` claims and one CLAUDE.md sentence
move with the code; `tasks.md` §5 has the exact list and why CI will not catch two of them.

## Out of scope, deliberately — do not read this as an oversight

**The empty near-you strip is an accepted cost, and this proposal does not address it.** Product
owner, in the issue: *"That is a cost, not an objection — the field is one tap away in the
profile."* Every rider who onboards after this ships carries `profiles.location` NULL, so a rider
who also declines the GPS permission gets an empty near-you strip on Explore clubs, and on the
rides list once PD-260 lands.

What this proposal owes that cost is one verified fact and one pointer, not a design:

- **The degradation is quiet, not broken.** `resolveFromProfile` in `src/lib/location/rider-location.ts`
  returns `null` for an empty `getMyLocationText()` before it ever calls `getLocalityCentroid`, and
  the module header states that a rider with no onboarding location *"is an ordinary case here,
  not a fault"*. Read 2026-08-24; nothing in this change makes it throw.
- **The prompt the issue suggests ("tell us where you ride" on the empty strip) is a follow-up**,
  and PD-170 — *nothing explains why the app wants your location before the permission prompt
  fires* — is the issue it belongs with, since the two are the same missing explanation on two
  screens. Specifying it here would put a screen this change does not touch into a proposal whose
  whole subject is an invariant.

**Also out of scope:** dropping `p_location` from the signature (§What Changes 1 says why it stays
for good), any change to `profiles.location`'s CHECK, grants or editability, and any backfill —
there is nothing to backfill, since the relaxation only widens what is accepted.

## Impact

- **Affected specs:** `database-enforced-integrity` (MODIFIED — the completion invariant and its
  scenario), `client-render-shell` (MODIFIED — the route guard's resume contract),
  `client-cache-invalidation` (MODIFIED — the invalidator set drops from four writers to three).
- **Affected code:** `supabase/migrations/075_*.sql` (new), `src/lib/actions/onboarding.ts`,
  `src/lib/auth/guard.ts`, `src/app/onboarding/location/` (deleted),
  `src/app/onboarding/username/page.tsx`, `src/lib/auth/__tests__/guard.test.ts`,
  `supabase/tests/rls_test.sql`, `supabase/tests/seed.sql`, `scripts/walk.mjs`, `CLAUDE.md`.
- **Not affected:** `profiles` RLS policies, the participation gate, `058`'s welcome-club join,
  the ghost-row SELECT policy, blocking, and every read path. Each is asserted as a negative in
  `specs/database-enforced-integrity/spec.md` rather than left as silence.
