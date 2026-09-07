'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { PlaceSearchField, type PlaceValue } from '@/components/ui/PlaceSearchField'
import { LocationFilledIcon } from '@/components/icons/generated'
import { setRiderTown } from '@/lib/actions/profile'
import { LOCATION_MAX_LENGTH } from '@/lib/validation/profile'

/**
 * *Where are you located?* — the question a rider is asked when precise
 * location is declined, unavailable, or simply never given (PD-419).
 *
 * ## Why a town and not a country
 *
 * Decided by the product owner, 2026-09-06, and the reasoning is worth keeping
 * because a country field is the cheaper-looking option: a country answers
 * nothing in a single-country launch, and the capital is a bad centre for this
 * one — Amsterdam is ~210 km from Maastricht and ~180 km from Groningen, so
 * seeding a rider there is confidently wrong for much of the Netherlands and
 * silently so, since they only ever said "Netherlands". A town is the same one
 * tap, resolves to a real coordinate through machinery that already exists, and
 * is exactly what `profiles.location` was always for. The country question
 * becomes the right one when there is more than one country.
 *
 * ## There is no IP lookup here, and that is a decision rather than an omission
 *
 * The same 2026-09-06 decision settled it harder than the story proposed: **no
 * IP geolocation at any point**, including for a rider who has not been asked
 * yet. Two reasons survive and are worth not re-litigating — the client-only
 * bundle never sees its own IP, so it would take an Edge Function; and in the
 * Netherlands mobile traffic geolocates to the carrier's gateway rather than to
 * the rider, so it would often be confidently wrong. **Nothing here may quietly
 * derive a position from anything the rider did not type** — not their IP, not
 * their postcards' locations, not the clubs they have joined.
 *
 * ## The picked town's NAME is what gets stored, not its coordinate
 *
 * `profiles.location` is free text and always has been, and
 * `resolveRiderLocation`'s profile source geocodes it through
 * `getLocalityCentroid` on read. Storing the coordinate instead would need a
 * migration (two columns and a CHECK pairing them), and would freeze a centroid
 * the geocoder may later place better. The cost is one geocode per resolve,
 * which the module already memoises for five minutes.
 *
 * **So this writes what the rider picked, and a pick is required** — `freeText`
 * is deliberately not passed. A typed string the geocoder cannot resolve stores
 * a town that produces no position, which is the one failure this sheet exists
 * to remove and would be indistinguishable on screen from having answered
 * nothing at all.
 *
 * ## The QUESTION is measured; the container is not
 *
 * **`Add your location` (`2074:5185`) and `Add your location - City focus`
 * (`2077:5320`) draw this question** — `npm run figma -- ls` returns both, and
 * `docs/specs/login-onboarding.md` records them by node id.
 *
 * **The heading STRING is measured and taken verbatim** — *"Where are you
 * located?"*. Its type token is not: the frame is Poppins/32/Semibold and this
 * renders at `text-lg`, which is the container's scale (`LocationPrimingSheet`
 * uses the same). Saying "measured" without that qualifier would invite a
 * designer to assume the scale transferred.
 *
 * **The field label deliberately does NOT follow the frame** — see its own
 * comment. What else does not transfer is the container and its chrome: those
 * frames are the onboarding wizard step `075` (PD-286) deleted, so they carry
 * pagination dots, a `Back` link and `Skip`/`Next`, none of which belongs on a
 * sheet opened from Explore.
 *
 * **The divergences are logged** in `docs/FIGMA-FIDELITY-TODO.md`, which is the
 * only reason it is acceptable to keep them.
 */
export function TownQuestionSheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** Fired once the town is stored. Separate from `onClose` so a caller can
   *  tell *the rider answered* from *the rider walked away* — the automatic
   *  ask spends itself on either, but only one of them should close a
   *  `blocked` sheet behind it. */
  onSaved: () => void
}) {
  const [place, setPlace] = useState<PlaceValue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    if (!place) return
    setError(null)
    startTransition(async () => {
      const result = await setRiderTown(place.name)
      if (result.error) {
        setError(result.error)
        return
      }
      setPlace(null)
      onSaved()
    })
  }

  // **`label` below is matched by `scripts/walk.mjs`'s `LOCATION_SHEETS` —
  // change the two together, or the walk goes red on a screen that works.**
  // That helper dismisses this sheet so the next click on Explore is
  // actionable; it asserts nothing, so a stale selector fails silently there
  // and surfaces as a red JOIN phase pointing at the wrong thing (PD-410's
  // shape). It deliberately does NOT track the visible heading, which is
  // measured from `2074:5185` and says something different.
  return (
    <ContextMenu open={open} onClose={pending ? () => {} : onClose} label="Where you ride from">
      <div className="flex flex-col gap-4 pb-2">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-background">
          <LocationFilledIcon className="h-6 w-6 text-accent" aria-hidden="true" />
        </span>

        <h2 className="text-lg font-semibold text-foreground">Where are you located?</h2>

        <p className="text-sm font-medium text-muted">
          Tell us your town and we will measure rides and clubs from there. You can change it or
          remove it at any time on your profile.
        </p>

        <PlaceSearchField
          // **`Town`, NOT the frame's `City`, and this is a deliberate logged
          // divergence rather than an oversight.** The frame predates the town
          // rung entirely — it is the onboarding step `075` deleted, built when
          // there was no `setRiderTown` — so it is not evidence about which
          // word this app uses. `town` is: the action, the row's own label, the
          // `Near {town}` string and the paragraph directly above this field.
          // Taking `City` here would put a fifth noun for one concept two lines
          // under body copy that says "town".
          label="Town"
          placeholder="Search for your town or city"
          value={place}
          onChange={setPlace}
          // The column's own bound, so what this writes can always be stored —
          // see `PlaceSearchField`'s `maxNameLength`. `018` is the CHECK behind
          // it and `setRiderTown` parses against the same constant.
          maxNameLength={LOCATION_MAX_LENGTH}
          disabled={pending}
          // No `names`: this is a controlled field with no form behind it, and
          // `setRiderTown` takes an argument rather than a `FormData`.
        />

        {/* The region has to exist before its content changes, or a screen
            reader announces nothing — the same rule `JoinClubButton` follows. */}
        <p role="status" aria-live="polite" className="text-sm text-danger empty:hidden">
          {error}
        </p>

        <div className="mt-2 flex flex-col gap-2">
          <Button size="lg" onClick={save} loading={pending} disabled={!place}>
            Save
          </Button>
          {/* Inert while the write is out, for `IntroductionPrompt`'s reason:
              `ContextMenu`'s scrim and Escape close through `onClose`, so a
              dismissal landing mid-write would close the sheet over a town that
              is about to be stored — and the caller would then never hear
              `onSaved`. The `onClose` passed above is neutered for the same
              window rather than only this button, because the button is the one
              path of three. */}
          <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>
            Not now
          </Button>
        </div>
      </div>
    </ContextMenu>
  )
}
