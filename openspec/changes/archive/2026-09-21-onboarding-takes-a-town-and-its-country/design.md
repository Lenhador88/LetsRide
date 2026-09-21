# Design — onboarding takes a town, and the country comes off the pick

Mechanism, the rejected alternatives, and the open questions. `proposal.md` is what changes;
this is why it is shaped that way.

## D1 — The route is renamed to `/onboarding/town`

**Decision: rename, in this change.**

The step's directory is currently `country` and after this it asks for a town, with a country as a
fallback branch that most riders never see. The argument against renaming is real — it touches
`guard.ts`, its test file and `scripts/walk.mjs`, for zero rider-visible benefit — and the argument
for it wins on two counts.

The first is that the stranding risk is already specified away. `client-render-shell`'s standing
requirement is *"The wizard SHALL have exactly one resume target, and every path under `/onboarding`
SHALL resolve to it"*, and its own prose says why it is stated that way: *"`isOnboarding` is
`pathname.startsWith('/onboarding')`, so the rule covers the next step this wizard gains or loses
without anyone remembering to come back here."* A bookmark, a stale tab or a native shell restoring
`/onboarding/country` after the deploy resolves to the resume target. There is a scenario asserting
exactly that, for exactly this case, written when `/onboarding/location` was deleted.

The second is cost of delay. Renaming later is a separate change touching the same guard string and
the same walk for no benefit at all; renaming inside a change that is already rewriting the screen
costs a directory move. It is the cheapest moment it will ever be.

**Non-blocking, reviewer-vetoable.** If the reviewer prefers to keep the path, everything else in
this change is unaffected — the fallback is `/onboarding/country` with its directory name recorded
as stale.

## D2 — A mandatory *town* is a heavier ask than a mandatory country, and the argument has to be made

Decision #5 is that onboarding is required and carries no skip. That makes every field on it a
decision about what a rider must hand over before they can use the app at all, and a town is more
personal than a country. This is not assumed away; it is argued.

**What keeps it reasonable is that the pick is a locality, not an address.** The control is
`PlaceSearchField` in place mode against the same geocoder `TownQuestionSheet` already uses, and
`profiles.location` is bounded at 100 characters of free text with no coordinate stored. A rider
picks *Utrecht*, not a street. The app already asks exactly this question of exactly these riders,
from Explore, and 25 of the 30 profiles across both projects have answered it voluntarily.

**And it is a form field rather than a permission**, which is the distinction PD-419 settled and
this change inherits without weakening: a field answered is consent, an OS prompt with no escape is
not. A mandatory town SHALL NOT become an argument for a mandatory device fix, and SHALL NOT become
an argument for an IP lookup. That negative is in the spec because it is exactly the inference the
next reader makes.

**What the rider gets in return, stated so the trade is legible:** Explore is sorted by distance
from somewhere real on their first screen, rather than being a global list. That is the whole
benefit and it is worth one tap.

**The counter-argument, recorded rather than dismissed:** a rider in a place the geocoder does not
resolve well has no escape, because there is no skip. The mitigation is that the fallback branch
(§3) already handles the near-miss — a place found with no country still completes — and the
remaining failure is a place not found at all. That is a real dead end for a real rider, and it is
Q3 below rather than a solved problem.

## D3 — Both columns in one UPDATE; the town does NOT travel through `p_location`

**Decision: one `profiles` UPDATE writing `location` and `home_country`, then
`complete_onboarding({ p_location: null })` — unchanged from today except for the added column.**

`complete_onboarding` *can* store a town: its UPDATE is
`set location = coalesce(nullif(btrim(p_location), ''), p.location)`, so a non-blank argument is
stored in the same statement as the stamp. So there are genuinely two routes and the choice needs a
reason.

**The column write cannot be avoided.** `114`'s guard reads the **stored** `home_country`
— `select p.username, p.terms_accepted_at, p.onboarding_completed_at, p.home_country ... for update`
— so the country must be in the row before the RPC is called, whatever happens to the town. Given
that statement has to exist, the question is only whether the town rides along.

**It should, for three reasons.** One pick produced both values, so writing them in one statement
makes them atomic — the split version can store a country for a town the rider never got, if the
second write fails. The profile trigger fires once instead of twice. And `p_location: null` stays
byte-identical to what ships today, which keeps §The negative cases 6 true for free: the re-run path
a pre-`113` rider can reach by deep link continues to coalesce to their stored town rather than
overwriting it.

**Rejected: town via `p_location`, country via the UPDATE.** It splits one pick across two round
trips for no gain, and it makes the deep-link re-run path start overwriting stored towns.

**Rejected: a second parameter on `complete_onboarding`.** `create or replace` cannot add one; the
overload it creates answers `PGRST203` on the one-argument call every signup makes. `114`'s own
header says so. This is recorded here because it is the first thing the next author reaches for.

## D4 — The country reaches `FormData` through the step's own hidden input, not through the primitive

`PlaceSearchField`'s `names` prop writes four hidden inputs — `name`, `placeId`, `lat`, `lon` — and
no country. Three ways to get the picked `countryCode` into the action:

| Option | Verdict |
|---|---|
| Widen `names` with a fifth `countryCode` field | **Rejected.** A shared `ui/` primitive changed for one caller, when two of its three existing callers have no country to write and the third ignores it. `ride-start-location`'s "One picker SHALL exist" requires the extension to leave other callers unchanged; this passes that bar but fails the cheaper one. |
| The action stops taking `FormData` | **Rejected.** `useActionState` + `<form action>` is the repo's mutation pattern and the screen needs its pending and error states. |
| The step holds the `PlaceValue` and renders its own hidden inputs | **Chosen.** Exactly what `TownQuestionSheet` does today, minus the sheet: no `names`, controlled state, and the step owns what it submits. |

So the step renders two hidden inputs it owns: the town name, and the country **only when the pick
carries one**. That last clause is not tidiness — it is what makes §The negative cases 11 unreachable
rather than merely unlikely.

**This is the one place the `primitive: Y` marker on the Linear territory comment does *not* get
spent.** It is spent in PD-446 instead, and saying so here stops a future reader assuming the
primitive was already widened.

## D5 — `setRiderTown` gains an optional second argument rather than a new action

`setRiderTown(town: string | null, countryCode?: string | null)`. It stays
`profiles.location`'s only writer and becomes a second writer of `home_country` beside the wizard's.

**It does NOT owe `invalidateOnboardingState()`**, and that needs stating because
`writers-invalidate.test.ts` is per exported function and a reviewer will ask. The guard's decision
reads three fields — `terms_accepted_at`, `onboarding_completed_at`, `has_username` — and
`home_country` is none of them; PD-428 made that the load-bearing choice of the whole change, and
widening it here by accident would be the expensive mistake. `setRiderTown` writes no stamp, so it
keeps exactly the invalidations it has: `clearRiderLocation()`, `queryKeys.profile.all()` and
`queryKeys.riderLocation()`.

**`null` clears the town and writes no country key at all.** The clear path must not send
`home_country: null` even though the trigger would coerce it back — see D6.

## D6 — Depending on a coercion that is currently dead

The issue's claim is right: `enforce_onboarding_completion` coerces a NULL `home_country` back to
the stored value. Read from the deployed `prosrc` on both projects, 2026-09-08:

```
if old.home_country is not null then
  new.home_country := coalesce(new.home_country, old.home_country);
end if;
```

`038`'s exact shape, above the `old.onboarding_completed_at` early return, with `113`'s comment
explaining why that position is not negotiable.

**Two conditions make it narrower than the sentence suggests.** It is keyed on
`old.home_country is not null` — so for a rider with no country it does nothing, and today that is
every rider on both projects. And the trigger's first line is
`if current_user <> 'authenticated' then return new; end if;` — so it is a rule about what the
*client* may write, and a support path or a future definer function is not covered by it.

**Therefore the client also does not write the key.** Both mechanisms produce the same stored value
today; the difference is that one of them is a rule the app states about itself and the other is a
guarantee that happens to be dead for the current population. The spec states both, and neither
substitutes for the other. **No migration is proposed** — the coercion is correct as it stands, and
changing a trigger on an already-shipped write path would owe `112`'s hand-exercise gate for a
problem that does not exist.

## D7 — Copy

The heading *"Where are you located?"* is measured from `Login / Onboarding › Add your location`
(`2074:5185`) and stays. The **body** changes, because the current sentence — *"We use this to show
you rides and clubs in your part of the world"* — is a promise about a country that nothing keeps,
and the whole point of this change is that it becomes true about a town.

Recommended, and Q1 can overrule it: *"Tell us your town and we will measure rides and clubs from
there. You can change it later in your profile."* — which is `TownQuestionSheet`'s own paragraph,
already written for this exact question and already approved on that screen. Reusing it means one
sentence for one concept in both places rather than a fifth noun.

The field label is `Town`, matching `TownQuestionSheet`'s logged divergence from the frame's `City`
and for the same reason: the action, the row, the `Near {town}` string and the body copy all say
town.

The fallback select keeps `CountrySelect`'s existing `label="Country"`, with no new explanatory
paragraph — it appears only for a rider whose pick came back without one, and a sentence explaining
why would be a sentence about the geocoder.

## Open questions

Four. **All non-blocking**, each with a recommended default the build can proceed on.

**Q1 — The body copy.** *Non-blocking. Product owner's, but the default is safe.* Default: reuse
`TownQuestionSheet`'s paragraph verbatim (D7). Anything else is a copy edit that changes no
behaviour and can land after.

**Q2 — Does the route rename happen in this change?** *Non-blocking. The reviewer's.* Default:
yes (D1). If vetoed, keep `/onboarding/country` and record the name as stale in the page header.

**Q3 — A rider whose town the geocoder cannot find at all.** *Non-blocking, and the only one with a
rider stranded behind it. The product owner's.* Today there is no answer: no skip, no free text, and
`PlaceSearchField` in place mode refuses typed-but-unpicked text by design. Default: **ship without
a special case and watch `onboarding_step` for `status: 'rejected'` volume at this step** — the
population is small, the geocoder covers localities well, and inventing an escape hatch now
(free-text fallback, a "my town is not listed" branch) would be building a rollout for a rider
nobody has met. If the funnel shows it, the answer is most likely to let the country select stand
alone as the escape, which this change's fallback branch already builds.

**Q4 — Whether the profile editor keeps any country control.** *Non-blocking. The reviewer's.*
PD-428 added an optional country field to `EditProfileForm`. After this change a town change writes
the country, so the field is a second writer of a column the town now owns. Default: **leave it
alone in this change** and let PD-428 archive first — removing it is a one-line follow-up, and
removing it *here* couples two changes that have no reason to be coupled. The negative that matters
is already covered: it cannot clear a stored country, because the coercion refuses.
