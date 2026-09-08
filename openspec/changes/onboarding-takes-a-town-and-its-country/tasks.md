# Tasks — onboarding takes a town, and the country comes off the pick

Specs: `specs/client-render-shell/spec.md`, `specs/client-cache-invalidation/spec.md`,
`specs/database-enforced-integrity/spec.md`. Mechanism, rejected alternatives and the four open
questions (all non-blocking, each with a recommended default): `design.md`.

**There is no migration and no sequencing constraint.** `113` and `114` are applied on both projects
— confirm with `list_migrations` on both refs before starting, and stop if they are not. Everything
below is one bundle and can be done in any order.

**Nothing in this file writes to Linear.** The board is the main thread's (`CLAUDE.md` §The roadmap
lives in Linear); §7 names what it owes.

## 0. Before anything

- [ ] 0.1 `list_migrations` on both refs. Expect `113_home_country` and
      `114_a_completion_carries_a_country` on each. **`CLAUDE.md` said PROD was at `112` on
      2026-09-08 and that was already stale** — PROD carries `113`, `115`, `116` and `114`, promoted
      in that order with `113` before `114`, which is the un-collapsible gate. Report the drift to
      the main thread; do not edit `CLAUDE.md`.
- [ ] 0.2 Confirm `require-a-home-country-at-onboarding` is archived, or archive order is agreed.
      Two requirements this change MODIFIES live only in that change's delta. `ls openspec/changes`
      against `ls openspec/changes/archive`.
- [ ] 0.3 Re-measure the population rather than trusting `proposal.md`'s table — one signup
      invalidates it. `select count(*), count(location), count(home_country) from public.profiles;`
      on both refs.

## 1. The step

- [ ] 1.1 `git mv src/app/onboarding/country src/app/onboarding/town`, and the `__tests__`
      directory with it. Q2 can veto the rename; everything else in this file is unaffected either
      way.
- [ ] 1.2 **Preserve and update the page's header comment.** The PD-428 reasoning, the decision-#5
      no-Skip paragraph and the "a country is not a position" paragraph all stay. Update what is now
      false — the step asks for a town, the country is a fallback — and **strengthen** the Skip
      paragraph rather than weakening it: the drawn frame still has a Skip, it still must not be
      built, and after this the country only exists because the town was picked. Replace the wrong
      claims; do not narrate the change.
- [ ] 1.3 Swap `CountrySelect` for `PlaceSearchField` in **place mode** — `label="Town"`,
      `placeholder="Search for your town or city"`, `maxNameLength={LOCATION_MAX_LENGTH}`,
      **no `names`**, **no `freeText`**, **no `recents`**. `freeText` is the one prop that would
      convert a typed string into a stored town; its absence is the spec's scenario.
- [ ] 1.4 The page holds `useState<PlaceValue | null>` and renders its own two hidden inputs: the
      town, and `country` **only when `place.countryCode` is a non-empty string**. `design.md` §D4
      has why this is not a `names` widening.
- [ ] 1.5 The fallback: render `CountrySelect name="country"` beneath the field **only when a place
      is picked and its `countryCode` is `null` or absent**. Test both, not `=== null`.
- [ ] 1.6 `disabled={!place || (needsCountry && !country)}` on the submit. One field, one wizard step,
      no other control in the tab order — which is why a disabled submit is right here and **wrong**
      on `CreateClubForm` (PD-446 §2.4 carries that contrast).
- [ ] 1.7 Keep `Pagination total={2} current={1}`, the `back` link to `/onboarding/username`, and the
      heading *"Where are you located?"*. Replace the body copy per `design.md` §D7 / Q1.

## 2. The action

- [ ] 2.1 Rename `setHomeCountry` → `setHomeTown` in `src/lib/actions/onboarding.ts`. Update its
      header: the two-writes ordering paragraph stays and gains the town; the `PGRST203` paragraph
      stays verbatim, because it is the first thing the next author reaches for.
- [ ] 2.2 Parse both: `locationSchema` for the town, `countryCodeSchema` for the country, each off
      `String(formData.get(...) ?? '')` rather than the raw entry — `setUsername`'s reason, so a
      missing field does not surface Zod's own type message at a rider.
- [ ] 2.3 **One** `profiles` UPDATE writing `location` and `home_country` together, with
      `.select('id').maybeSingle()` so a zero-row update is distinguishable from a success. Then
      `complete_onboarding({ p_location: null })`. **In that order, and `p_location` stays `null`** —
      `design.md` §D3, and the deep-link re-run case depends on it.
- [ ] 2.4 Keep the `23514` → field message mapping for the UPDATE, the `23514` → *"Finish the earlier
      steps first."* mapping for the RPC, the zero-row → *"Your profile could not be found."*, the
      single `invalidateOnboardingState()` after both writes, and the `takeAnyStashedInviteToken()`
      handoff. **The stash consumption stays on the terminal step** — moving it is how an invite-link
      rider gets stranded one screen short.
- [ ] 2.5 Delete the now-false comment fragment *"this screen does not collect one"* beside the
      `p_location: null` call and replace it with what is true: the town is written by the statement
      above, and `null` here is a no-op rather than a clear.

## 3. The later-change path

- [ ] 3.1 `setRiderTown(town: string | null, countryCode?: string | null)` in
      `src/lib/actions/profile.ts`. When `town` is `null`, or `countryCode` is null/absent, **write
      no `home_country` key at all** — `design.md` §D6. Keep the `null`-bypasses-`locationSchema`
      branch and its comment exactly as they are; the `ZodString` type gate has not moved.
- [ ] 3.2 It keeps `clearRiderLocation()`, `invalidate(queryKeys.profile.all())` and
      `invalidate(queryKeys.riderLocation())`, and **does not gain `invalidateOnboardingState()`**.
      The spec has the argument; put a one-line WHY in the code, not the argument.
- [ ] 3.3 `TownQuestionSheet` — pass `place.countryCode` to `setRiderTown`. One line. **Do not touch
      `ContextMenu label="Where you ride from"`**: `scripts/walk.mjs`'s `LOCATION_SHEETS` matches it
      and a change there fails silently, surfacing as a red phase pointing at the wrong thing.
- [ ] 3.4 `LocationSetting`'s `Remove` still calls `setRiderTown(null)` and still works. PD-419's
      decision obliges it; verify by hand as well as in the unit test.

## 4. The guard, analytics and the walk

- [ ] 4.1 `src/lib/auth/guard.ts` — the resume target string only. Keep the `isOnboarding`
      catch-all; it is what makes the rename safe and it now catches `/onboarding/country` as a
      stale path.
- [ ] 4.2 `src/lib/auth/__tests__/guard.test.ts` — add a case asserting `/onboarding/country`
      redirects to `/onboarding/town` for a rider with a username and no stamp. The file holds 57
      cases; add to them rather than rewriting them.
- [ ] 4.3 `src/lib/analytics/events.ts` — `step: 'terms' | 'username' | 'town'`, and `reason` gains
      `'no_country'`. **Record beside the union why the rename was free**: `'country'` shipped hours
      earlier with no funnel history behind it, and once a step key has real history it is a position
      rather than a description and renaming it is not free. `docs/reference/analytics.md` gets the
      same note.
- [ ] 4.4 `scripts/walk.mjs` — the sign-up phase passes through a step that now needs a **network
      lookup and a pick**, not a local select. This is the highest-risk task in the file: without it
      the walk mints a rider who never completes onboarding and every subsequent phase fails. That is
      the loudest possible failure and therefore the safe one, but it still has to be fixed.
- [ ] 4.5 Run the walk against DEV through `scripts/supabase-relay.mjs`, per
      `docs/reference/running-locally.md` §The walk. A shrunken `N/N` is a skip, not a pass.

## 5. Tests

- [ ] 5.1 `src/app/onboarding/town/__tests__/page.test.tsx` — carried over and extended. Pin the two
      things a refactor reverses in silence: the submit stays disabled until a town is picked, and
      **exactly one field named `country` exists** in each of the two branches. `environment: 'node'`
      with `renderToStaticMarkup` unless a mounted effect, layout, event or portal is genuinely
      needed; state which in the header if jsdom is used.
- [ ] 5.2 `src/lib/actions/__tests__/set-rider-town.test.ts` — the country argument: written when
      present, key **absent** when the pick has none, key absent on a clear. Assert the absence of the
      key, not a `null` value.
- [ ] 5.3 `src/lib/actions/__tests__/writers-invalidate.test.ts` — verify **both ways** that the
      renamed terminal action is still caught: green now, red with `invalidateOnboardingState()`
      deleted. It is per exported function, so the rename must not slip through on a file-granular
      match.
- [ ] 5.4 `src/lib/validation/__tests__/profile.test.ts` — no schema changed, so this should stay
      green untouched. If it does not, something changed that this proposal says did not.
- [ ] 5.5 **The coercion, exercised by hand on DEV in a rolled-back transaction as `authenticated`**,
      because no automated gate in this repo covers it and the proposal's headline claim rests on it:
      set a country, then update `location` alone with `home_country` explicitly NULL, and assert the
      **stored value** is unchanged. Then the same for a rider with no country, and assert it stays
      NULL. Assert values, never SQLSTATEs.
- [ ] 5.6 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 5.7 **`npm test` is not required** — no migration, no policy, no constraint changed, so
      `openspec/config.yaml`'s migration/assertion pairing rule does not fire. Say so in the PR rather
      than leaving a reviewer to wonder why the RLS suite has no new assertion.

## 6. Documentation

- [ ] 6.1 `docs/reference/analytics.md` — the step rename and the new `reason`.
- [ ] 6.2 `npm run docs:check` — the full sweep locally, not CI's `--cheap` step.
- [ ] 6.3 `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` — `openspec/` is inside that
      sweep and these artifacts cite section pointers.
- [ ] 6.4 `docs/reference/schema.md` — `profiles.location` gains a second writer and
      `profiles.home_country` a second one too. Both are app facts about existing columns; no
      contract changes.

## 7. Review, and what the main thread owes the board

- [ ] 7.1 `reviewer` on **this proposal**, before any code — it is the one artifact with no automated
      gate, since `openspec/` is in CI's denylist.
- [ ] 7.2 `reviewer` on the final diff, immediately before the PR.
- [ ] 7.3 Archive this change at the wrap-up of the session that ships it (`/opsx:archive`), or say
      in the PR body why it stays open.
- [ ] 7.4 PD-428 — a comment noting that its open half is closed by this change, and that its
      optional profile-editor country field is now a second writer of a column the town owns
      (`design.md` Q4). **An out-of-scope section is not a board item.**
- [ ] 7.5 `design.md` Q3 — the rider whose town the geocoder cannot find — is the product owner's and
      needs no schema. If it is wanted it is a new story.
- [ ] 7.6 The `CLAUDE.md` migration-count drift found in 0.1 is the main thread's to write; agents do
      not edit that file.
