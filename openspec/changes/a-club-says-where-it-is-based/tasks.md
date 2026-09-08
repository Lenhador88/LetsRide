# Tasks — a club says where it is based

Specs: `specs/database-enforced-integrity/spec.md`, `specs/client-render-shell/spec.md`,
`specs/ride-start-location/spec.md`. Mechanism, rejected alternatives and the three open questions
(all non-blocking, each with a recommended default): `design.md`.

**There is no migration and no sequencing constraint.** No `NOT NULL`, no backfill, no CHECK change,
no policy change. One bundle, any order. Stated here as well as in the proposal so a later reader
does not go looking for a SQL file.

**Nothing in this file writes to Linear.** The board is the main thread's (`CLAUDE.md` §The roadmap
lives in Linear); §6 names what it owes.

## 0. Before anything

- [ ] 0.1 Re-measure rather than quoting the proposal — the issue is explicit about this and the
      numbers moved once already:
      `select count(*) as clubs, count(location_name) as with_location from public.clubs;` on both
      refs. At proposal time: DEV 15/15, PROD 2/2, and **0 partial rows** (`066` holding).
- [ ] 0.2 Confirm the population this must not break: every club that carries NULL. Today that is
      zero on both projects, which means **the edit-path scenario has no live row behind it** and
      exists purely as permanent contract. Say so in the PR; a reviewer will otherwise assume it was
      tested against real data.

## 1. Validation — the split

- [ ] 1.1 `src/lib/validation/clubs.ts` — extract the five shared field definitions into one object
      literal, and build `clubSchema` (location nullable, unchanged) and `clubCreateSchema` (location
      required) from it. **One body, two wrappers**; do not copy the fields.
- [ ] 1.2 The required form carries its own message — `design.md` §D1 — because the inner object's
      `safeParse(null)` answers Zod's raw type error, which is a sentence about JavaScript shown to a
      rider. Default copy: **"Pick where your club is based."** (Q1).
- [ ] 1.3 **Update `clubSchema.location`'s comment rather than deleting it.** It records the
      deliberate optionality and why — *"Create club is the app's shortest creation flow and a
      required field is a new wall in front of it"* — and that reasoning is now *answered* rather
      than wrong: the wall is what the pre-fill removes, and the column stays optional for edits and
      for every existing club. Replace the wrong half; keep the argument.
- [ ] 1.4 `readClubLocation`, `CLUB_LOCATION_FIELD_NAMES` and `clubLocationSchema`'s four inner
      messages are **unchanged**. Do not touch the string-emptiness test; its comment explains why
      `Number('')` is `0` and it is load-bearing.

## 2. The actions and the form

- [ ] 2.1 `createClub` parses `clubCreateSchema`. `updateClub` keeps `clubSchema`. Nothing else in
      either action changes — `locationColumns()` and the destructure-`location`-out step both stay,
      including the comment about `PGRST204`.
- [ ] 2.2 `CreateClubForm`'s focus effect parses **`clubCreateSchema`**, not `clubSchema` — the whole
      reason it parses a schema is that the form and the action must not disagree about which field
      was rejected.
- [ ] 2.3 Label drops `(optional)`. The helper text is unchanged and already correct.
- [ ] 2.4 **The submit stays `disabled={busy}`.** Do not gate it on the location. `design.md` §D2 has
      the table; the file's own header records the disabled-submit approach as tried and reverted on
      this form. **PD-445's onboarding step does the opposite and is also right** — put a one-line
      pointer in each so a later session finding them different does not "fix" one.
- [ ] 2.5 Fix the focus move: `path[0] === 'location'` must reach the **visible** search input, not
      the hidden `location_name`. Default is an optional `inputRef` on the primitive (`design.md`
      §D4); the wrapper-`querySelector` fallback ships the same behaviour. **Verify it both ways** —
      that focus lands now, and that removing the branch leaves it silently not moving, which is
      today's behaviour.

## 3. The pre-fill

- [ ] 3.1 `src/components/ui/PlaceSearchField.tsx` — one optional prop carrying an initial query.
      Applied **once, on first focus**, and only when there is no `value`, no `draft`, and the prop
      is a non-empty string. Never on mount. Set the draft **and** the search term together, or the
      list does not open and the prop buys nothing.
- [ ] 3.2 Comment it with the three reasons the mount-time version is wrong (`design.md` §D3) —
      the blur that erases the seed, the field that looks answered, and the metered credit spent for
      a rider who never touched the field. The next author will reach for `useState(initialQuery)`.
- [ ] 3.3 `CreateClubForm` reads `getMyLocationText()` through `useQuery` under
      **`queryKeys.profile.location()`** — a key that already exists and that `setRiderTown` already
      invalidates. **No new key, no new invalidation claim, no inline key.**
- [ ] 3.4 Gate on the data, never on `isLoading`: `undefined` means the read has not settled and the
      seed is simply absent, which is a supported state rather than a wait.
- [ ] 3.5 Assert the ride callers are untouched — both ride forms, the postcard composer,
      `TownQuestionSheet` and `EditClubForm` all omit the prop and must behave identically.

## 4. Tests

- [ ] 4.1 Validation unit tests: `clubCreateSchema` refuses `null` with the chosen message; accepts a
      complete object; **`clubSchema` still accepts `null`** — that last one is the trap and needs its
      own named test.
- [ ] 4.2 `createClub` refuses with no location and writes nothing. `updateClub` succeeds on a club
      with no location and writes all four columns NULL. Both against the action, not the schema.
- [ ] 4.3 A component test for `CreateClubForm` pinning the one thing a refactor reverses in silence:
      **the submit is not disabled by a missing location**. `environment: 'node'` with
      `renderToStaticMarkup` unless a mounted effect, layout, event or portal is genuinely needed;
      state which in the header if jsdom is used — the focus move and the first-focus seed are both
      jsdom cases if they are tested at that level.
- [ ] 4.4 Pin the `0`-coordinate case explicitly: a pick at `latitude: 0` or `longitude: 0` is
      accepted by the gate. Verify the test fails if the gate is rewritten as a truthiness check.
- [ ] 4.5 Pin the partial case: three of four hidden fields → `readClubLocation` returns `null` → the
      create gate refuses.
- [ ] 4.6 The seed: present on first focus when a town exists; **absent on mount**; absent entirely
      when there is no town; and gone after a blur with no pick.
- [ ] 4.7 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 4.8 **`npm test` is not required and the RLS suite gains no assertion** — no policy, constraint
      or migration moved, so `openspec/config.yaml`'s pairing rule does not fire. Say so in the PR
      rather than leaving a reviewer to read the absence as an omission.
- [ ] 4.9 The walk touches `/clubs/new`. Run it against DEV per `docs/reference/running-locally.md`
      §The walk and confirm the create phase still passes — a newly-required field is exactly the
      shape that turns a green walk red.

## 5. Documentation

- [ ] 5.1 `docs/reference/schema.md` — the `clubs` contract gains one sentence: the location is
      required by the **create form** and by nothing in the database, the column is permanently
      nullable, and every read tolerates NULL. Write it so it cannot be misread as an invariant.
- [ ] 5.2 `npm run docs:check` — the full sweep locally, not CI's `--cheap` step.
- [ ] 5.3 `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` — `openspec/` is in that sweep
      and these artifacts cite section pointers.

## 6. Review, and what the main thread owes the board

- [ ] 6.1 `reviewer` on **this proposal**, before any code — the one artifact with no automated gate.
- [ ] 6.2 `reviewer` on the final diff, immediately before the PR. It touches a shared `ui/`
      primitive, so the scope includes every caller of `PlaceSearchField`.
- [ ] 6.3 Archive this change at the wrap-up of the session that ships it (`/opsx:archive`), or say
      in the PR body why it stays open.
- [ ] 6.4 `design.md` Q3 — prompting existing club owners — is the product owner's and is not a
      follow-up to be created by reflex. **An out-of-scope section is not a board item.**
- [ ] 6.5 PD-259 — a comment noting that its premise now has rows behind it, and that the near-you
      surfaces still must tolerate NULL for ever.
