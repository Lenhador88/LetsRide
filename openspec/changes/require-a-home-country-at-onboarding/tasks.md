# Tasks — require a home country at onboarding

Specs: `specs/database-enforced-integrity/spec.md`, `specs/client-render-shell/spec.md`,
`specs/client-cache-invalidation/spec.md`. Mechanism, rejected alternatives and the four open
questions (all non-blocking, each with a recommended default): `design.md`.

**Order is not negotiable in one place.** §1 (`113`) applies **before** §3 (the deploy); §5 (`114`)
applies **after** the deployed bundle is confirmed *serving*. `proposal.md` §Sequencing has the
table showing what each wrong order breaks — both wrong orders stop every rider from finishing
onboarding for the length of the window. Everything else here can be done in any order.

**Nothing in this file writes to Linear.** The board is the main thread's (`CLAUDE.md` §The roadmap
lives in Linear); §8 names what it owes.

## 1. `113` — the additive migration

- [ ] 1.1 Re-derive the number rather than inherit it: `ls supabase/migrations/*.sql | wc -l`
      against `list_migrations` on **both** refs, in both directions — a hosted row with no file is
      the drift that cannot be fixed by applying anything. At proposal time: 112 files, DEV at
      `112`, PROD at `107`, so `113` and `114` are free.
- [ ] 1.2 Header: state that this **re-adds a step `075` removed, deliberately**, and why —
      `075` was correct for one market and this is the ten-market case answering it, not ignoring
      it. The next reader must see a reversal with a reason rather than a loop.
- [ ] 1.3 `alter table public.profiles add column home_country text` — nullable. No NOT NULL, no
      DEFAULT, no backfill.
- [ ] 1.4 Two CHECK constraints, `020`'s pattern: `profiles_home_country_shape`
      (`home_country is null or home_country ~ '^[A-Z]{2}$'`) and
      `profiles_home_country_is_assigned` (membership of the 249 assigned codes). **Generate the
      literal from `src/lib/countries.ts` by script**, do not transcribe; `020`'s header carries
      the one-liner and the verification (249 codes, no duplicates, every one matching the shape).
      Both are added VALIDATED — there are no rows to violate them.
- [ ] 1.5 `comment on column public.profiles.home_country` carrying the NULL contract in as many
      words: what NULL means, that it is never backfilled, that these riders are never
      re-prompted, and that **every read tolerates it permanently**.
- [ ] 1.6 Grants: `grant select, insert, update (home_country) on public.profiles to authenticated`.
      No `anon` grant, ever. Say in the body why this is **not** `025`'s server-owned posture —
      `design.md` §D4.
- [ ] 1.7 `create or replace function public.enforce_onboarding_completion()` — reproduce the whole
      body from the deployed `prosrc` with every comment verbatim (`033`'s reconciliation rule),
      adding exactly one line to the UPDATE arm:
      `if old.home_country is not null then new.home_country := coalesce(new.home_country, old.home_country); end if;`
      **Placed beside `038`'s username coercion, above the `old.onboarding_completed_at` early
      return**, and carrying `038`'s comment about why that position is not negotiable.
- [ ] 1.8 **`complete_onboarding` is not touched by this file, and its signature never changes.**
      Do not add `p_country`: `create or replace` cannot add a parameter, so it would create an
      overload and the every-signup call becomes `PGRST203` (`design.md` §D9). Say so in the header
      — the next author will reach for it.
- [ ] 1.9 **The hand-exercise gate, before applying.** `113` hangs new code inside every profile
      edit's transaction. On DEV, in a rolled-back transaction, as `authenticated`: a profile edit
      that changes only the bio; one that changes the location; one that sets `home_country` from
      NULL; one that changes it to another code; one that tries to clear it (assert the **stored
      value**, not a SQLSTATE); a mid-wizard rider's username UPDATE; and `complete_onboarding`
      with and without a country. Count the rows rather than assuming them.
- [ ] 1.10 Apply to DEV, then re-read `prosrc` for `enforce_onboarding_completion` and diff against
      the file — §Applying a large file's object-diff rule, not a text comparison. Confirm
      `complete_onboarding`'s `prosrc` is **unchanged**.
- [ ] 1.11 `get_advisors(security)` on DEV afterwards. **Expect zero new advisors**: this file
      creates no function in `public` that did not already exist — the only function it touches is
      a `create or replace` of an existing trigger function — so the
      `authenticated_security_definer_function_executable` count SHALL NOT move. Anything else is
      unexpected; record it against `docs/reference/migrations.md` §Security advisors.

## 2. Assertions for `113` — `supabase/tests/rls_test.sql`

Per `openspec/config.yaml`: a policy or constraint change with no new assertion is not finished.

- [ ] 2.1 The unassigned code (`ZZ`) is refused, and by the **membership** constraint.
- [ ] 2.2 Each malformed value is refused by the **shape** constraint: `''`, `'nl'`, `'NLD'`,
      `' NL '`, `'1'`. Two error identities, per the spec's scenario.
- [ ] 2.3 A rider sets `home_country` from NULL on their own row — permitted.
- [ ] 2.4 A rider changes `home_country` to another assigned code — permitted.
- [ ] 2.5 A rider sets `home_country` to NULL when it was set — **the stored value is unchanged**
      and nothing raised. Assert the value; a `raises` assertion here passes for the wrong reason.
- [ ] 2.6 Another signed-in rider updating someone else's `home_country` affects **zero rows**.
- [ ] 2.7 A blocked rider reads **zero rows** for the other's profile, in both directions.
- [ ] 2.8 A club `owner`, an `admin`, a `member` and a non-member each read the column exactly as
      the SELECT policy admits, and write nothing.
- [ ] 2.9 `anon` holds no privilege — grantee-scoped, `has_table_privilege('anon', ...)`, never a
      table-wide count (`postgres` and `service_role` hold everything by default).
- [ ] 2.10 `authenticated` holds SELECT, INSERT and UPDATE on `home_country` — scoped to the
      grantee, via `information_schema.column_privileges` or `has_column_privilege`.
- [ ] 2.11 `complete_onboarding` still stamps completion for a rider with a NULL `home_country`
      under `113` — the pre-`114` behaviour, asserted so that `114` has something to flip.
- [ ] 2.12 The participation gate's trigger count is unchanged, via the counting query rather than
      an enumeration.
- [ ] 2.13 Run the suite and compare **label sets**, not counts, against the previous run — a count
      cannot tell a rename from a loss. `PGPASSWORD=postgres npm test`.
- [ ] 2.14 `supabase/tests/seed.sql` — give the fixtures a `home_country` where they need one, and
      **keep at least one fixture with NULL**, because that is the permanent population and every
      read has to be tested against it.

## 3. The deploy — the country step

- [ ] 3.1 `src/lib/countries.ts` — a single-select helper over `COUNTRY_CODES` if one is needed;
      names from `Intl.DisplayNames`, flags from regional indicators, exactly as
      `ProfileCountries` already does. No new asset, no new dependency.
- [ ] 3.2 **A single-select country control in `src/components/ui/`** — a shared primitive, not a
      screen-local component. There is no Select/dropdown primitive today; `design.md` §D7 has the
      census and the reason this is `design-system`'s work rather than the screen author's.
- [ ] 3.3 `src/app/onboarding/country/page.tsx` — `'use client'`, `useActionState`, gated on data
      and never on `isLoading`. Every state in `specs/client-render-shell/spec.md`'s second
      requirement. **No skip affordance** (decision #5). A `Back` link is legitimate here, unlike
      on the username screen.
- [ ] 3.4 Copy: Q4's default is the drawn title *"Where are you located?"* with the control
      labelled `Country`. **Do not carry the drawn footer** — the frame's `Skip` button and its
      3-dot `Pagination` are the pre-`075` container (`design.md` §D7). Q3 decides whether
      `Pagination` returns.
- [ ] 3.5 `src/lib/validation/profile.ts` — a `homeCountrySchema` parsing an assigned code. Zod
      owns the **message**; `113` owns the guarantee.
- [ ] 3.6 `src/lib/actions/onboarding.ts` — a new action that (a) UPDATEs
      `profiles.home_country` on the rider's own row with `.select('id').maybeSingle()`, so a
      zero-row update is distinguishable from a success, then (b) calls
      `complete_onboarding({ p_location: null })`. **In that order.** Maps `23514` to a field
      message, maps a zero-row answer to *"Your profile could not be found. Sign in again."*, calls
      `invalidateOnboardingState()` **after** the RPC succeeds, and moves `setUsername`'s
      `takeAnyStashedInviteToken()` handoff here — it belongs to the **terminal** step, and leaving
      it on the username step strands an invite-link rider one screen short.
- [ ] 3.7 `setUsername` — remove the `complete_onboarding` call and its `23514` mapping, **keep
      `invalidateOnboardingState()`** (`specs/client-cache-invalidation`), and redirect to
      `/onboarding/country`. Update its header, which currently states it is the terminal step.
- [ ] 3.8 `src/lib/auth/guard.ts` — the resume branch of `design.md` §D2's table. Keep the
      `isOnboarding` catch-all: it is what stops a deleted step's URL dead-ending, and it now has a
      third step to catch for.
- [ ] 3.9 `src/lib/auth/guard-cache.ts` — **comments only.** Its §Writers header and
      `invalidateOnboardingState`'s doc block both name `setUsername` as *"the terminal one"*;
      the `guard-cache-invalidators` claim greps call sites rather than comments, so both would
      read green for ever. `docs:check` will not catch this — a human must.
- [ ] 3.10 `src/lib/auth/__tests__/guard.test.ts` — cases for each row of the resume table, for the
      abandon-and-return path, for `/onboarding/username` and `/onboarding/terms` redirecting
      **on** to the country step, and for an already-onboarded rider never reaching it. The file
      holds 54 cases today; this adds to them rather than rewriting them.
- [ ] 3.11 `src/lib/actions/__tests__/writers-invalidate.test.ts` — confirm it refuses the new
      action if the invalidation is removed. **Verify the filter both ways**: that it is green now,
      and that deleting the call turns it red.
- [ ] 3.12 `src/types/index.ts` — the profile types gain `home_country`. `OnboardingState` does
      **not** change (§D2).
- [ ] 3.13 `src/lib/data/profile.ts` and the profile column sets — add the column where the
      profile row is already read; do not add a second key for it.
- [ ] 3.14 `src/components/profile/EditProfileForm.tsx` — an **optional** country field. Optional
      is the decision, not an oversight: required would re-prompt the population the issue says to
      leave alone, through the back door, on a screen that is not the wizard (`design.md` §D5).
- [ ] 3.15 A component test for the new step, pinning the one thing a refactor reverses in
      silence — the submit staying disabled until a country is chosen. `environment: 'node'` and
      `renderToStaticMarkup` unless it needs a mounted effect, a layout, an event or a portal; the
      picker's open/close is a portal-and-event case if it goes through `ContextMenu`.
- [ ] 3.16 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.

## 4. The walk

- [ ] 4.1 `scripts/walk.mjs` — the sign-up phase now passes through a third screen. Without this
      the walk mints a rider who never completes onboarding and **every subsequent phase fails**,
      which is the loudest possible failure and therefore the safe one; it still has to be fixed.
- [ ] 4.2 Run it against DEV per `docs/reference/running-locally.md` §The walk, through
      `scripts/supabase-relay.mjs`. `WALK_EMAIL`/`WALK_PASSWORD` are **not** required — unset, it
      mints its own rider. A shrunken `N/N` is a skip, not a pass.

## 5. `114` — arm the refusal, after the bundle is serving

- [ ] 5.1 **Gate:** confirm the merge sha is `READY` with `aliasError` null on `development`'s
      Vercel deployment. Merged is not serving.
- [ ] 5.2 `create or replace function public.complete_onboarding(p_location text)` — **the
      signature is unchanged.** Whole body verbatim again, adding one guard beside the consent and
      username arms, **above** `058`'s welcome-club block and outside its `when others`: raise
      `check_violation` when the stored `home_country` is NULL. Select it in the same `for update`
      read that already fetches the username and the consent stamp — no second round trip.
- [ ] 5.3 Header: state that this file is the requirement, that it is separate from `113` because
      one file cannot be both sides of a deploy, and that a re-run by an already-onboarded rider is
      never refused because the guard reads the stored column, which they already have.
- [ ] 5.4 Apply to DEV, object-diff `prosrc`, re-run `get_advisors(security)`. Zero new advisors
      expected, same reasoning as 1.11.
- [ ] 5.5 Assertions: a completion with no country raises `check_violation` and leaves
      `onboarding_completed_at` NULL; a re-run by a rider who already has a country succeeds and
      returns the original stamp; a rider with no consent stamp is still refused by the consent arm
      first.

## 6. Documentation

- [ ] 6.1 `docs/reference/schema.md` — the `profiles` contract gains `home_country`: its grants,
      its CHECKs, its coercion rule and the permanent-NULL contract.
- [ ] 6.2 `CLAUDE.md` — the applied-migration counts, and the sentence describing the wizard as one
      step. Both are claims about state; write each beside the command that checks it.
- [ ] 6.3 `docs/reference/migrations.md` §Applied state — the per-file ordering for `113` and
      `114`, recorded as it is applied, on each project.
- [ ] 6.4 `npm run docs:check` — the full sweep locally, not just CI's `--cheap` step.
- [ ] 6.5 `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` — this proposal cites
      section pointers into other documents, and `openspec/` is inside that sweep.
      (Do **not** write the pointer syntax out as an example here: the sweep parses this file
      too, reads the example as a real citation, and fails on a document that does not exist.
      It did, on the first draft.)

## 7. Review

- [ ] 7.1 `reviewer` on **this proposal**, before any code — it is the one artifact in the pipeline
      with no automated gate, since `openspec/` is in CI's denylist.
- [ ] 7.2 `reviewer` on the final diff, immediately before the PR. It touches `src/` and
      `supabase/`, so the RLS and data-exposure passes both run.

## 8. What the main thread owes the board

- [ ] 8.1 PD-427 — a comment naming the fourth label state this change creates and the constraint
      on its words: `near <country>` is wrong because a country is a filter, not a proximity.
      **An out-of-scope section is not a board item.**
- [ ] 8.2 PD-428 stays open until the thing it names exists on DEV. `Deployed to DEV` is the
      status once `114` has applied — not once `113` has.
- [ ] 8.3 The deliberately-open question — whether to ever prompt the existing population — is the
      product owner's and needs no schema. It is recorded here and nowhere else; if it is wanted it
      is a new story, never a comment on a closed one.
