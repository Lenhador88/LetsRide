# Onboarding takes a town, and the country comes off the pick

> Linear **PD-445**. This file is the specification; the issue points at it and must not restate it
> (`CLAUDE.md` §The roadmap lives in Linear).
>
> **The issue body AND its comments were read.** The only comment is the territory marker
> (`slot: 1`, `migration: N`, `primitive: Y`) — it adds no correction to the body, and its
> `primitive: Y` is honoured: §5 touches `src/components/ui/`.
>
> **One claim in the issue body was checked against the database rather than taken.** *"A later town
> change that yields no country cannot clear the stored one: `enforce_onboarding_completion` coerces
> the NULL back to the stored value, exactly as `038` does for `username`."* **It holds** — verified
> in the deployed `prosrc` on both projects, 2026-09-08. §The negative cases 7 has the arm, and the
> one condition under which it is silent.

## Why

The wizard's last step asks for a **country** (PD-428) and no query in the app is scoped to one.
`getExploreRides` filters on `is_public` and orders by `departure_at`; the near-you split on
`/clubs/explore` and `ExploreClubsStrip` both measure from `resolveRiderLocation()`, whose profile
rung is `profiles.location` — the **town**. So the step's own copy, *"We use this to show you rides
and clubs in your part of the world"*, is a promise nothing keeps, and the column that would keep it
is NULL for every rider who signs up.

**The country does not have to be asked for.** `PlaceSearchField` in place mode returns a
`PlaceValue` that already carries `countryCode` as ISO 3166-1 alpha-2, set by `search-places`'
`toPlaceResult` from the same lookup the rider already paid a credit for. `TownQuestionSheet` calls
`setRiderTown(place.name)` and throws that country away. One pick can write both columns, in one
statement, at no extra vendor credit.

**This closes the open half of PD-428.** That change shipped a country a rider can set at onboarding
and left "how does a rider change their country afterwards" undesigned. After this, changing your
town changes your country, so there is no separate control left to design — the profile's existing
`LocationSetting` is it.

### The population this lands on, measured 2026-09-08

`execute_sql`, both projects. A snapshot; one signup invalidates it, which is why nothing here is
conditioned on it.

| | profiles | with a town (`location`) | with a `home_country` | completed with NULL country |
|---|---|---|---|---|
| DEV `fpmrimzxadewsaiwpsel` | 25 | 20 | **0** | 24 |
| PROD `zwprydcyryvudhurbnye` | 5 | 5 | **0** | 5 |

Two things follow and both change the build. **No rider anywhere has a `home_country`** — the
country step shipped hours before this proposal was written — so §7's coercion arm is currently
dead for the entire population, and §10's analytics rename costs no funnel history. And **the town
is the column riders already carry**, 25 of 30 across both projects, which is the opposite of what
the wizard asks for.

## What is already true, and is restated only so nothing re-derives it

| Fact | Where it is |
|---|---|
| `113`/`114` are applied on **both** projects — `home_country`, its two CHECKs, the coercion arm, and the completion guard | `list_migrations` on both refs, 2026-09-08 |
| `complete_onboarding` takes **one** argument and gaining a second is `PGRST203` | `114`'s own header; PD-428 §D9 |
| `p_location: null` is a no-op against a stored town, never a clear | `075`'s `coalesce(nullif(btrim(p_location),''), p.location)` |
| `114`'s country guard is gated on `not v_was_complete` — the transition **into** completion | `complete_onboarding`'s `prosrc`, read 2026-09-08 |
| `profiles.location` has no coercion arm; a town **can** be cleared | the same `prosrc`; §The negative cases 8 |
| `setRiderTown` is `profiles.location`'s only writer since PD-425 | `src/lib/actions/profile.ts` |

## What changes

**No migration. Nothing in this change adds, edits or applies a SQL file, and a later reader
looking for one should stop looking.** Both columns exist, both CHECKs exist, the coercion exists
and the completion guard exists — all four landed with PD-428's `113`/`114`. What changes is which
control the rider sees and which columns one action writes.

### 1. The step asks for a town

`/onboarding/country` becomes **`/onboarding/town`** and renders `PlaceSearchField` in place mode —
the same control, the same label (`Town`) and the same placeholder `TownQuestionSheet` already uses.
`Pagination total={2} current={1}`, the `Back` link to `/onboarding/username`, and the heading
*"Where are you located?"* are unchanged. The body copy changes, because it is currently a promise
about a country and becomes a true one about a town.

**The rename is decided rather than deferred** (§D1). The guard's own standing requirement —
*every* path under `/onboarding` resolves to the resume target, stated that way precisely so a
renamed step cannot strand anybody — is what makes it free, and there is a scenario asserting it.
A directory called `country` that asks for a town is the stale name this repo replaces rather than
narrates, and this change is the cheapest moment it will ever be renamed.

**The header comment carrying the PD-428, decision-#5 and no-Skip reasoning is preserved and
updated, never deleted.** The Skip paragraph in particular stays: the drawn frame still has a Skip
button, it still must not be built, and the reason is now *stronger* than it was — `114` refuses the
stamp without a country, and after this the country only exists if the town was picked.

### 2. The country select is a fallback, and only a fallback

When the picked place carries a `countryCode`, **no country control is rendered at all** — not
pre-filled, not disabled, not shown as a confirmation. When it does not, a `CountrySelect` appears
**under** the town field, on the same step, and the submit stays disabled until both are answered.

`PlaceValue.countryCode` is **optional** on the type, so the branch tests for both `null` and
`undefined` — `toPlaceValue` always sets it from a fresh lookup, but seeded values
(`RecentRideStart`, the two edit forms) omit the property entirely, and a truthiness test that
happened to be written as `=== null` would miss half the cases.

### 3. One `profiles` UPDATE, then the RPC

`setHomeCountry` becomes `setHomeTown` and writes **both columns in one statement**:

```
update profiles set location = <town>, home_country = <code> where id = auth.uid()
   → complete_onboarding({ p_location: null })
```

**The ordering contract is unchanged and is why the town joins the UPDATE rather than the RPC.**
`114` reads the *stored* `home_country`, so the column write has to come first regardless; putting
the town in the same statement makes the pair that came from one pick atomic, fires the profile
trigger once instead of twice, and leaves `p_location: null` exactly as it is today — a no-op
against a stored town. The rejected alternative (town via `p_location`, country via the UPDATE) is
§D3: it splits one pick across two round trips, so a failure between them stores a country for a
town the rider never got.

### 4. `setRiderTown` carries the country too

`setRiderTown(town, countryCode?)`. A later town change through `TownQuestionSheet` or
`LocationSetting` writes the new country alongside the new town — which is what closes PD-428's open
half. `null` still clears the town, and a clear writes **no** country key at all (§7, §8).

### 5. `TownQuestionSheet` stops discarding the country

One line: it passes `place.countryCode` to `setRiderTown` instead of dropping it. Its
`ContextMenu label="Where you ride from"` is matched by `scripts/walk.mjs`'s `LOCATION_SHEETS` and
**does not change**.

### 6. The primitive

The onboarding step needs the picked country in `FormData`, and `PlaceSearchField`'s `names` prop
writes four hidden inputs — name, placeId, lat, lon — and **no country**. Rather than widen a shared
primitive for one caller, the step holds the `PlaceValue` in its own state (as `TownQuestionSheet`
already does, with no `names`) and renders its own two hidden inputs. §D4 has why, and §The negative
cases 11 has the collision that shape must not have.

## Sequencing — there is none, and that is worth stating

`113` and `114` are applied on both projects, so this change has no migration, no arming file, no
deploy-order constraint and no promotion gate of its own. It is one bundle. The only ordering that
exists is an **artifact** one: `require-a-home-country-at-onboarding` is still unarchived, and two of
the requirements this change modifies live in *its* delta rather than in `openspec/specs/` yet
(§Impact, and the coordination note at the top of the `client-render-shell` delta).

## The negative cases

Eleven. The full scenarios are in `specs/`; this is the index.

1. **No pick, and submit.** The submit SHALL be disabled while `place` is null, so the round trip is
   not made — and the action SHALL refuse independently, because a disabled button is an affordance
   and not a guarantee. A rider who defeats it reaches `114`'s `check_violation` and stays
   un-onboarded.
2. **A town typed and never picked.** SHALL NOT store a town, SHALL NOT be submitted, and SHALL NOT
   be shown as answered. This is `PlaceSearchField`'s standing rule for place mode rather than a new
   one — the visible input carries no `name`, the draft reverts on blur, and the hidden inputs read
   through `value`, which is the pick. It holds here **because the step passes no `freeText`**, and
   passing one would silently convert a typed string into a stored town.
3. **A pick with no country.** `countryCode` `null` **or absent**. The `CountrySelect` appears under
   the town, on the same step, only then, and never pre-filled as a confirmation in the common case.
   Completion SHALL be refused until both are answered — not by the form's courtesy but by `114`,
   which reads the stored column.
4. **A pick with a country.** No country control is rendered. One `profiles` UPDATE writes
   `location` and `home_country` together; `complete_onboarding` is called second, with
   `p_location: null`. A rider SHALL NOT be able to reach a state where the stamp is set and either
   column is empty.
5. **Backing out to `/onboarding/username` mid-step.** Nothing has been written — the step performs
   no write before submit — so there is nothing to undo, and re-entering is idempotent: the guard's
   resume target for *username, no stamp* is this step, and re-submitting the same pick rewrites the
   rider's own row with the same values. A rider whose UPDATE landed and whose RPC then failed
   returns to this step with the town and country already stored and one tap from finishing.
6. **A pre-`113` rider re-runs `complete_onboarding` by deep link.** They are **not** refused and
   their town is **not** cleared. `114`'s guard is gated on `not v_was_complete`, so an
   already-stamped caller skips it entirely and gets their **original** stamp back; `p_location:
   null` coalesces to their stored `location`. Both are properties of the deployed function, read
   rather than assumed. **The one thing this change must not do is start passing a real
   `p_location`** — that path *does* overwrite a stored town on a re-run.
7. **A later town change that yields no country.** It SHALL NOT clear a stored `home_country`.
   **Verified, and the claim holds**: `enforce_onboarding_completion`'s UPDATE arm carries
   `if old.home_country is not null then new.home_country := coalesce(new.home_country,
   old.home_country); end if;` — `038`'s exact shape, above the `old.onboarding_completed_at` early
   return, in the deployed `prosrc` on both projects. **Two conditions on that guarantee, and both
   are load-bearing.** It is keyed on `old.home_country is not null`, so it does nothing for a rider
   who has no country — today, every rider — and the trigger's first line returns early for any
   `current_user` other than `authenticated`. So the client SHALL ALSO simply **not write the
   `home_country` key** when the pick carries no country, and that is the rule the spec states: the
   coercion is the guarantee, the omission is what keeps the app correct without depending on it.
   No migration is needed either way.
8. **Clearing the town after onboarding.** Still permitted, and that is decided rather than left
   open. PD-419's decision obliges withdrawal in as many words — *"clearing back to none works"* —
   and `profiles.location` has **no** coercion arm, unlike `username` and `home_country`. So
   `setRiderTown(null)` continues to write SQL NULL, `LocationSetting`'s `Remove` continues to work,
   and the rider keeps their stored country. **The asymmetry is deliberate and SHALL be stated on
   screen's terms**: a town can be removed, a country cannot. A required field at onboarding is not
   a promise that the value is permanent; `023` and `114` gate *becoming* onboarded, and completion
   is a one-way stamp, so a rider who clears their town is not thrown back into the wizard.
9. **An over-long town, and an unknown country code.** The town is truncated by the picker's
   `maxNameLength={LOCATION_MAX_LENGTH}` before it can be submitted, `locationSchema` is the message,
   and `018`'s CHECK is the guarantee. An unassigned or malformed code is refused by `113`'s two
   CHECKs with `23514`, which the action already maps to a field message; `countryCodeSchema` is the
   message and never the guarantee. A rider who never runs the client's validation gets the same
   answer.
10. **Analytics.** The step key becomes `'town'`, and that is a **measured** decision rather than a
    principled one. Renaming a funnel key normally splits every insight built on it at the deploy —
    but `step: 'country'` shipped hours before this proposal, to 5 PROD riders none of whom carry a
    country, so there is no history to split. `'terms'` and `'username'` are untouched. A new
    `reason` value, `'no_town'`, rides on `status: 'completed'` rather than on a rejection — it marks
    the escape the step opens when the lookup is unavailable, so the rider finished carrying a
    country and no town. It is NOT a refusal, and it is not `'no_country'`: `114` makes completing
    without a country impossible, so that name would record an unreachable state. The one rejection
    this change adds. **The general rule stands and SHALL be recorded where the union is declared:
    once a step key has real history behind it, it is a position rather than a description and
    renaming it is not free.**
11. **Two inputs named `country`.** The fallback `CountrySelect` renders a hidden input named
    `country`; a pick that carries a country would render another under the same name, and
    `formData.get('country')` returns the **first** — so the rider's explicit fallback answer could
    be shadowed by a stale one, or vice versa, with nothing on screen wrong. The two SHALL be
    mutually exclusive by construction: the pick's hidden input exists only when the pick has a
    country, the select exists only when it does not.

## Out of scope, deliberately

- **Any migration.** Stated twice on purpose; see §What changes.
- **Backfilling or re-prompting the population with a NULL country.** PD-428's Queued comment settled
  that — *"Do not fold it in"* — and this change does not reach it. After this ships, a rider in that
  population acquires a country the first time they change their town, and never otherwise.
- **Scoping any query to `home_country`.** It still has no reader. The change that gives it one owns
  that decision; **a `home_country` with no query behind it remains the accepted state**.
- **`near <country>`.** A country is a filter and not a proximity. PD-428's negative stands
  unchanged and `explore-label.ts` holds the line with a test pinning the absence.
- **Forcing the device prompt, and any IP lookup.** PD-419's decline rule stands. A form field
  answered is consent; an OS prompt with no escape is not — which is exactly what makes a *mandatory
  town pick* legitimate where a mandatory device permission would not be (§D2).
- **Storing the town's coordinate.** `profiles.location` is free text and `resolveRiderLocation`
  geocodes it on read through `getLocalityCentroid`. Storing lat/lon would need two columns and a
  CHECK pairing them — a migration, which this change does not have.

## Impact

- **Affected specs:** `client-render-shell` (MODIFIED ×2, ADDED ×1), `client-cache-invalidation`
  (ADDED ×1), `database-enforced-integrity` (ADDED ×1).
- **Artifact ordering:** the two MODIFIED requirements were **added by
  `require-a-home-country-at-onboarding`, which is still unarchived**, so they are not in
  `openspec/specs/client-render-shell/spec.md` yet. That change SHALL be archived before this one.
  The delta file carries the same note at its head.
- **Affected code:** `src/app/onboarding/country/` → `src/app/onboarding/town/` (page and its test),
  `src/lib/actions/onboarding.ts`, `src/lib/actions/profile.ts`,
  `src/components/location/TownQuestionSheet.tsx`, `src/lib/auth/guard.ts` and its tests,
  `src/lib/analytics/events.ts`, `src/lib/validation/profile.ts` (comments only — no schema changes),
  `scripts/walk.mjs`, `docs/reference/analytics.md`.
- **Not affected, asserted as negatives rather than left as silence:** every SQL file;
  `complete_onboarding`'s signature and body; `enforce_onboarding_completion`'s body;
  `my_onboarding_state()`'s return shape; the guard cache's generation counter; the four
  `invalidateOnboardingState()` call sites (a rename is not a fifth writer); `CountrySelect` itself;
  `COUNTRY_CODES`; `LOCATION_MAX_LENGTH` and `018`'s CHECK; `PlaceSearchField`'s props and
  behaviour; `LOCATION_SHEETS` in `scripts/walk.mjs`; and PD-419's device-position chain.
