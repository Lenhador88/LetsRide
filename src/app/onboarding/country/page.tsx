'use client'

import { useActionState, useState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { Button } from '@/components/ui/Button'
import { CountrySelect } from '@/components/ui/CountrySelect'
import { Pagination } from '@/components/ui/Pagination'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import { setHomeCountry } from '@/lib/actions/onboarding'

/**
 * The wizard's second and last step (PD-428): the rider's home country.
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
 * ## No skip, and that is decision #5 rather than a preference
 *
 * The drawn frame (`Login / Onboarding › Add your location`, `2074:5185`) has a
 * `Skip` button. It is not built, here or anywhere: onboarding is required and
 * not skippable, no step carries a skip affordance, and `114` refuses to stamp
 * completion without a country — so a Skip would be a control that cannot
 * work. That frame is the pre-`075` container and the departure is logged in
 * `docs/FIGMA-FIDELITY-TODO.md`.
 *
 * **`Back` IS drawn and does work**, unlike Skip. The guard permits a rider to
 * stand on the username step once they have a username, which is what makes
 * this link live rather than a bounce — see `guard.ts`, and `075` §3 for why
 * that screen no longer calls their own name taken.
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
 * is what makes a *mandatory* country legitimate where a mandatory device
 * permission would not be. This must never become an argument for forcing that
 * prompt: PD-419's decline rule stands, including no IP lookup at any point.
 */
export default function OnboardingCountryPage() {
  const [country, setCountry] = useState<string | null>(null)
  const [state, formAction, pending] = useActionState(setHomeCountry, emptyActionState)
  useActionRedirect(state)

  return (
    <AuthScreen
      title="Where are you located?"
      body="We use this to show you rides and clubs in your part of the world. You can change it later in your profile."
      back={{ href: '/onboarding/username', label: 'Back' }}
      footer={<Pagination total={2} current={1} className="justify-center" />}
    >
      <form action={formAction} className="flex flex-col gap-6">
        {/* `name` makes `CountrySelect` render its own hidden input, which is
            how the code reaches `FormData`: the control is a combobox over a
            listbox rather than a native <select>, so nothing else on the form
            carries its value. The action re-parses whatever arrives with
            `countryCodeSchema` — the client's choice is never trusted — and
            `113`'s two CHECK constraints refuse an unassigned code regardless. */}
        <CountrySelect
          name="country"
          label="Country"
          value={country}
          onChange={setCountry}
          error={state.error ?? undefined}
        />

        {/* No `FormError` beside this. The action returns one `error` string
            for every failure, field-shaped or not, and `CountrySelect` already
            renders it AND wires it through `aria-describedby` — so a
            `FormError` here would draw the same sentence twice and announce it
            twice. The control is the better of the two homes for it. */}

        {/* Disabled until a country is chosen. The submit would be refused by
            `114` anyway — this is the affordance saying so before the round
            trip, not the guarantee. */}
        <Button type="submit" loading={pending} disabled={!country}>
          Continue
        </Button>
      </form>
    </AuthScreen>
  )
}
