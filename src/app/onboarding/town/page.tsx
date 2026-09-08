'use client'

import { useActionState, useCallback, useState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { Button } from '@/components/ui/Button'
import { CountrySelect } from '@/components/ui/CountrySelect'
import { Pagination } from '@/components/ui/Pagination'
import { PlaceSearchField, type PlaceValue } from '@/components/ui/PlaceSearchField'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import { setHomeTown } from '@/lib/actions/onboarding'
import { LOCATION_MAX_LENGTH } from '@/lib/validation/profile'

/**
 * The wizard's second and last step: where the rider rides from.
 *
 * ## Why this step exists at all
 *
 * PD-419 shipped device-or-town and both are refusable, so a rider could finish
 * onboarding with no position at all. `075` had removed the location step on
 * the reasoning that it was *a profile field, not an onboarding gate* — correct
 * while the Netherlands is the only market, and answered rather than ignored by
 * the ten-market case: a rider with no position there gets an undifferentiated
 * global list, which is Explore failing at its one job. `113`'s header carries
 * the same reversal-with-a-reason note so the next reader does not read this as
 * a loop.
 *
 * ## It asks for a TOWN, and the country comes off the pick — PD-445
 *
 * PD-428 built this step as a country select, and no query in the app is scoped
 * to a country: `getExploreRides` filters on `is_public` and orders by
 * `departure_at`. So the step's own copy — *"rides and clubs in your part of
 * the world"* — was a promise nothing kept, while `profiles.location`, the
 * town and the app's only non-device position, was NULL for every rider who
 * signed up after `075`.
 *
 * A picked place already carries its country: `PlaceSearchResult.countryCode`
 * is ISO-3166-1 alpha-2 and `toPlaceValue` sets it from every fresh lookup. So
 * one pick answers both columns, at no extra vendor credit, and the country is
 * never asked for in the common case.
 *
 * **The country control did not go away — it became a fallback with two
 * triggers**, and neither is the rider choosing to use it:
 *
 *  1. The picked place came back with no `countryCode`. `114` refuses to stamp
 *     completion while `home_country` is NULL, so without this branch a town
 *     with no country strands the rider on the last step with no way forward.
 *  2. **The lookup itself is unavailable.** See below — this is the one that is
 *     easy to leave out and expensive to leave out.
 *
 * ## No skip, and that is decision #5 rather than a preference
 *
 * The drawn frame (`Login / Onboarding › Add your location`, `2074:5185`) has a
 * `Skip` button. It is not built, here or anywhere: onboarding is required and
 * not skippable, no step carries a skip affordance, and `114` refuses to stamp
 * completion without a country — so a Skip would be a control that cannot
 * work. That frame is the pre-`075` container and the departure is logged in
 * `docs/FIGMA-FIDELITY-TODO.md`.
 *
 * **PD-445 makes that rule harder rather than softer.** The country select
 * below is now reachable, and it must never become the Skip by another name:
 * it appears on a *failure*, never on the rider declining to answer. A rider
 * who simply has not picked a town sees no country select and a disabled
 * submit — which is why the fallback is keyed on a lookup error and on a pick
 * that carried no country, and on nothing a working rider can operate at will.
 *
 * **`Back` IS drawn and does work**, unlike Skip. The guard permits a rider to
 * stand on the username step once they have a username, which is what makes
 * this link live rather than a bounce — see `guard.ts`, and `075` §3 for why
 * that screen no longer calls their own name taken.
 *
 * ## Onboarding must not be completable ONLY through a third party
 *
 * A country select reads a local constant and is always answerable. A town is
 * answered by `search-places`, which carries an **application-wide** ceiling —
 * `APP_DAILY_SEARCH`, 2000 per 24 hours across every rider rather than per
 * rider — in front of a vendor with its own global rate limit. Decision #5
 * forbids a skip and `114` refuses the stamp without a country, so a step that
 * only ever accepted a picked town would have a state in which **no new rider
 * anywhere can finish onboarding**, for as long as the outage lasts.
 *
 * So a lookup failure reveals the country select on its own, and a rider who
 * takes that route completes with a country and no town — which is exactly the
 * rider every completion produced before PD-445, not a new population. The town
 * rung outside the wizard (`TownQuestionSheet`, from Explore) stays their route
 * to a town, because completion is a one-way stamp and nobody returns here.
 *
 * **The promise this change can honestly make is therefore *every rider who can
 * reach the geocoder gets a town*, not *every rider gets a town*.**
 *
 * ## The country is not a position
 *
 * It has no centroid and it is not a `RiderLocationSource`. Nothing here or
 * downstream may turn it into a proximity claim: `near <country>` is wrong
 * because a country is a filter and not a distance, and no query in this app is
 * scoped to one yet. `lib/location/explore-label.ts` is where that line is
 * held and it has a test pinning the absence.
 *
 * A form field answered is consent; an OS prompt with no escape is not — which
 * is what makes a *mandatory* town legitimate where a mandatory device
 * permission would not be. This must never become an argument for forcing that
 * prompt: PD-419's decline rule stands, including no IP lookup at any point.
 */
export default function OnboardingTownPage() {
  const [place, setPlace] = useState<PlaceValue | null>(null)
  const [country, setCountry] = useState<string | null>(null)
  // Set by a lookup failure and never cleared by this screen: once a rider has
  // been shown the escape, taking it away because a later retry happened to
  // answer would move the control they were reaching for.
  const [lookupFailed, setLookupFailed] = useState(false)
  const [state, formAction, pending] = useActionState(setHomeTown, emptyActionState)
  useActionRedirect(state)

  // Stable, so `PlaceSearchField`'s notify-once effect is not re-armed on every
  // keystroke's re-render.
  const onLookupFailure = useCallback(() => setLookupFailed(true), [])

  // A pick with no country is the first fallback trigger. `countryCode` is
  // OPTIONAL on `PlaceValue` — seeded values omit it entirely — so this tests
  // for absence as well as for null, which `!place.countryCode` does and
  // `place.countryCode === null` does not.
  const pickedWithoutCountry = place !== null && !place.countryCode
  const needsCountry = pickedWithoutCountry || lookupFailed

  // The town alone when the pick carried a country; the country alone when the
  // lookup died; both when a pick came back without one.
  const canSubmit = needsCountry ? country !== null && (lookupFailed || place !== null) : place !== null

  return (
    <AuthScreen
      title="Where are you located?"
      body="Tell us your town and we will measure rides and clubs from there. You can change it later in your profile."
      back={{ href: '/onboarding/username', label: 'Back' }}
      footer={<Pagination total={2} current={1} className="justify-center" />}
    >
      <form action={formAction} className="flex flex-col gap-6">
        <PlaceSearchField
          // `Town`, not the frame's `City` — the same logged divergence
          // `TownQuestionSheet` carries, and for the same reason: the action,
          // the row, the `Near {town}` string and this screen's own body copy
          // all say town.
          label="Town"
          placeholder="Search for your town or city"
          value={place}
          onChange={setPlace}
          // The column's own bound (`018`), so what this writes can always be
          // stored.
          maxNameLength={LOCATION_MAX_LENGTH}
          // **No `names`.** This step writes its own hidden inputs below,
          // because it submits the town's NAME and its COUNTRY rather than the
          // four place columns `names` exists to write — the shapes are
          // different, not a widening of the same one.
          //
          // **No `freeText`.** That is the one prop that would turn typed text
          // into a stored town, and a town the geocoder cannot resolve produces
          // no position at all — which is the failure this step exists to
          // remove, and would be indistinguishable on screen from answering
          // properly.
          //
          // **No `recents`.** A rider on this screen has no history to offer.
          disabled={pending}
          onLookupFailure={onLookupFailure}
        />

        {/* The town's name, and the country ONLY when the pick carried one.
            Rendered conditionally rather than always-with-an-empty-value:
            `CountrySelect` below renders its own hidden input from `name`, so
            two live fields called `country` would make `formData.get('country')`
            return whichever came first — silently shadowing the rider's answer
            with nothing wrong on screen. They are mutually exclusive by
            construction here, never by ordering. */}
        {place && <input type="hidden" name="town" value={place.name} />}
        {place?.countryCode && !lookupFailed && (
          <input type="hidden" name="country" value={place.countryCode} />
        )}

        {needsCountry && (
          <CountrySelect
            name="country"
            label="Country"
            value={country}
            onChange={setCountry}
            error={state.error ?? undefined}
          />
        )}

        {/* No `FormError` beside this. The action returns one `error` string
            for every failure, field-shaped or not. When the country select is
            on screen it renders that string AND wires it through
            `aria-describedby`, so a `FormError` would draw the same sentence
            twice; when it is not, the error belongs to the town field. */}
        {!needsCountry && state.error && (
          <p role="status" aria-live="polite" className="text-sm text-danger">
            {state.error}
          </p>
        )}

        {/* Disabled until the step has an answer it can actually submit. The
            submit would be refused by `114` anyway — this is the affordance
            saying so before the round trip, not the guarantee.

            **Right here and WRONG on `CreateClubForm`** (PD-446), which
            deliberately leaves its submit live: one question and nothing after
            it in the tab order here, six controls there, where a greyed-out
            submit reads as the resting state of an untouched form. Two forms,
            two answers, one reason — do not "fix" either to match. */}
        <Button type="submit" loading={pending} disabled={!canSubmit}>
          Continue
        </Button>
      </form>
    </AuthScreen>
  )
}
