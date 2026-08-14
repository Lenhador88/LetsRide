# Tasks — view another rider's profile

No migration is required (design.md §D1), so no task here changes `supabase/migrations/`. One
hardening assertion is added anyway, because this change makes a previously incidental reach
load-bearing.

## 1. Data layer

- [x] 1.1 Add `VIEWED_PROFILE_COLUMNS` to `src/lib/data/columns.ts` —
  `id, username, avatar_path, cover_image_path, bio, location, created_at` — with a header saying
  it is a **projection** decision rather than a permission one, that `025` already grants every
  column in it, and that it is used by exactly one screen.
- [x] 1.2 Add `getProfile(userId: string): Promise<ViewedProfile | null>` to
  `src/lib/data/profile.ts`, resolving its client through `resolveSupabase`, selecting
  `VIEWED_PROFILE_COLUMNS`, and signing `avatar_path`/`cover_image_path` through
  `resolveAvatarUrls`. It returns `null` for zero rows — every audience case collapses to that.
- [x] 1.3 Add `ViewedProfile` to `src/types/index.ts`. Do not inline it.
- [x] 1.4 `getProfileCountries(userId: string)` already takes an arbitrary rider id — verified,
  no change needed. Its `profile_countries` SELECT policy delegates to `profiles`, so the block
  and NULL-username terms apply without restating them (design.md §D1).

## 2. Routing and keys

- [x] 2.1 Add `detailPaths.profile = '/profile/detail'` and `routes.profile(id)` to
  `src/lib/routes.ts`, built through the existing `detail()` helper so the id is encoded.
- [x] 2.2 Add `profile.detail: (userId: string) => ['profile', 'detail', userId]` to
  `src/lib/query/keys.ts`, under the existing `profile` prefix so `invalidate(profile.all())`
  still reaches it.
- [x] 2.3 Add `profileIdSchema` to `src/lib/validation/`, matching `rideIdSchema`/`clubIdSchema`,
  so a malformed id becomes not-found rather than a `22P02`.

## 3. The screen

- [x] 3.1 Create `src/app/(app)/profile/detail/page.tsx` as a client page reading
  `useSearchParams().get(DETAIL_ID_PARAM) ?? ''` inside a `<Suspense>` boundary, matching the
  other ten detail routes.
- [x] 3.2 Redirect to `/profile` when the id equals the session rider's id, decided before the
  profile read is issued (§D3). Implemented via a gated `useQuery` on `profile.me()` rather than
  the guard cache directly — `guard-cache.ts` deliberately never exposes the session id to a
  component ("the user id never leaves this module"), so the id used for the comparison comes
  from the same own-profile read `/profile` and `/notifications` already share.
- [x] 3.3 Read the profile through `useQuery(queryKeys.profile.detail(id), () => getProfile(id))`.
  `null` → `notFound()`; `undefined` → skeleton. Gate on the data, never on `isLoading`.
- [x] 3.4 Build the header from `Profile / View someone else's profile / Profile - Prescoll header`
  (`2084:9006`), reading it with `npm run figma -- tree` and **not** the Figma API: cover banner,
  120×120 avatar, username at Poppins/24/Semibold, country flags, bio. **Composition deviation,
  logged in `docs/FIGMA-FIDELITY-TODO.md`**: the frame floats back/options over the banner and
  draws one flag beside the name; this instead matches the already-shipped `/profile`'s header
  shape (fixed `Header` bar, a banner that scrolls with the content) and its plural "Countries"
  section, since `/profile` already deviates from the frame the same way and nothing else in the
  app draws the frame's floating-button composition.
- [x] 3.5 Render the country flags **read-only**. `ProfileCountries` is an *editor* — it holds
  selection state, a search box and a write transition — so it MUST NOT be reused here: it would
  draw an editing affordance over another rider's countries. Extract the flag-rendering half into
  a presentational component and have the editor use it too, rather than forking the markup.
  Done as `src/components/profile/CountryFlags.tsx` (`CountryBadge` + `CountryFlags`);
  `ProfileCountries` now renders `CountryBadge` instead of its own inline flag/name markup.
- [x] 3.6 Render the timeline with `getFeed({ kind: 'rider', id })`, keyed by
  `postcards.feed(filterSegment(...))`, reusing `PostcardCard`.
- [x] 3.7 Implement every state the spec names: skeleton, not-found, error-with-retry, offline,
  partial (header renders, timeline section fails alone), and an empty timeline that does not
  claim the rider has posted nothing.
- [x] 3.8 Do **not** render Follow, a followers count, a motorcycles count, or the
  Timeline/Garage switcher (§D7). Do not render a clubs list (spec §The subject's clubs SHALL NOT
  be listed). Render the app's four nav tabs, not the frame's five — the global `Navbar` already
  renders four and this screen adds nothing of its own.

## 4. The links

- [x] 4.1 In `src/components/postcards/PostcardCard.tsx`, wrap the avatar and username in a single
  link to `routes.profile(postcard.author.id)`, gated on `postcard.author` resolving — mirroring
  how the club link is gated on `postcard.club?.name`.
- [x] 4.2 Keep the byline's drawn appearance unchanged: no underline, no colour of its own.
- [ ] 4.3 Verify the link is swipe-safe inside `PostcardDeck` — a tap navigates, a swipe starting
  on the byline does not — on the mechanism already documented in `PostcardCard` for the club link
  and `CommentsLink`. **Not independently verified** — the byline link reuses the exact `<Link>`
  shape and position the club link already has (same swim lane, same `onClickCapture` mechanism
  in `PostcardDeck`), so it is inferred safe by construction rather than measured. PD-222 stands:
  Chromium in this container cannot reach Supabase, so `/postcards` cannot be driven for real here.

## 5. Tests

- [x] 5.1 Extend `src/lib/data/__tests__/columns.test.ts`: `VIEWED_PROFILE_COLUMNS` is a **subset**
  of `025`'s `grant select (...)` list, and contains none of `terms_accepted_at`,
  `onboarding_completed_at`, `terms_version`. Leave the existing
  `expect(constant).toEqual(granted)` assertion on `OWN_PROFILE_COLUMNS` untouched.
- [ ] 5.2 Add an assertion to `supabase/tests/rls_test.sql` that a rider sharing **no club** with
  the subject can still read the subject's profile row. **Not done by this pass** — no policy
  changed, and writing and running the RLS suite is `data`'s tooling; left for a `data` follow-up
  rather than attempted without it.
- [ ] 5.3 Confirm the existing assertions still cover the rest, and add nothing that duplicates
  them: NULL-username invisibility (`rls_test.sql:135`), symmetric blocking (`:592`–`:600`), the
  two stamps being unreadable (`:264`+). **Not re-run** — see 5.2; the suite was not executed by
  this pass.
- [ ] 5.4 Run `PGPASSWORD=postgres npm test` and compare **label sets**, not counts, against the
  pre-change run. **Not run** — no schema or policy change in this pass; left to the `data`
  follow-up that does 5.2.
- [x] 5.5 Run `npm run test:unit`, `npx tsc --noEmit`, `npm run lint` — all green (see the PR/report
  for the verbatim output). Also added `profileIdSchema` cases to
  `src/lib/validation/__tests__/profile.test.ts`.

## 6. Verification

- [x] 6.1 Add the new route to `npm run walk` so it is rendered by the only gate that renders
  anything. A detail route discovered from a list is the walk's existing pattern. Discovers a
  rider id from a postcard byline link on `/postcards`, the same shape as the ride/club/postcard
  discovery already there.
- [ ] 6.2 Manually verify the self-view redirect, a blocked subject in **both** directions, and a
  well-formed id for a nonexistent rider — all three land on the same not-found state. **Not
  done** — this pass has no DEV database credentials or a live browser session; verified only that
  the code compiles, type-checks and builds. Loading the route against a real database (`npm run
  walk` with `WALK_FIXTURES=1`, or by hand) is outstanding.
- [x] 6.3 Re-run `npm run docs:check` if any numeric claim in `CLAUDE.md` or `docs/` moved
  (route count, page count). It had moved — `docs/HANDOFF.md`'s unit-test count, static-route
  count and `Generating static pages` near-miss all shifted by the new route and its tests — and
  is now corrected; `npm run docs:check` is 34/34 green.
