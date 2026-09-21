'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronRightIcon, LocationFilledIcon } from '@/components/icons/generated'
import { LocationPrimingSheet } from '@/components/location/LocationPrimingSheet'
import { TownQuestionSheet } from '@/components/location/TownQuestionSheet'
import { clearDismissal, isQuestionQuiet, recordDismissal } from '@/lib/location/dismissal'
import { locationPrimingState, locationQuestionLabel } from '@/lib/location/priming'
import {
  deviceLocationPermission,
  requestDeviceLocation,
  type DeviceLocationPermission,
  type RiderLocation,
} from '@/lib/location/rider-location'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { cn } from '@/lib/utils'

/**
 * The question at the top of the two Explore screens: *Still in Hoorn?* —
 * PD-447, and `UseMyLocationRow` before it (PD-170, PD-419).
 *
 * ## It asks; it does not offer
 *
 * The row used to read *Use my location*, which made it an offer — and an offer
 * sitting directly under `Explore rides near Hoorn` on the tab roots was two
 * 56px rows with the same icon, the same chevron and the same town name in the
 * same slot. Product owner, 2026-09-08: *"2 labels on the top don't look
 * great."* So the tab roots keep the door strip and lose this row entirely, and
 * this row moved to the screens it actually affects and became a question about
 * **where the distances on this screen are measured from**. Tapping it is the
 * invite to share the device location; changing the town is the quieter
 * secondary route inside the sheet.
 *
 * ## Nothing here opens by itself
 *
 * **PD-419's automatic ask is gone on purpose** — `auto`, the 700ms timer, the
 * once-ever flag and the latch that kept the timer from stacking a second sheet
 * are all deleted, and `priming.ts`'s header carries the reversal and its
 * accepted cost. What replaces the flag is `dismissal.ts`: closing the question
 * without answering means *yes, still here*, and keeps the row quiet for a
 * month, doubling on each consecutive dismissal.
 *
 * ## Before this row existed, no rider could grant the permission
 *
 * `resolveRiderLocation()` is deliberately silent: its device source returns
 * early unless the permission ALREADY reads `granted`, so it can be called from
 * an effect on every screen without ever raising a dialog.
 * `requestDeviceLocation()` is the one function that may prompt, and this row is
 * still its only caller anywhere in `src/`. The sheet behind it is what makes
 * spending the device's one-shot prompt a deliberate act.
 *
 * ## Geometry is `ExploreClubsStrip`'s, deliberately
 *
 * 56px on `White/100` at radius 8, 16px padding, 12px gap, a 24px `Location
 * Filled` in `Accent Brand/100`, the label at Poppins/14/Semibold, a chevron
 * trailing. It sits in the same slot as the Explore list's own heading on both
 * screens, and the same row on two tabs should be the same row. A `<button>`
 * rather than a `<Link>`, because it opens a sheet rather than going anywhere —
 * which is why it carries `aria-haspopup="dialog"`.
 *
 * ## Two things happen on a grant, and now three
 *
 * `requestDeviceLocation()` overwrites the module-level memo inside
 * `rider-location.ts`, which is what a LATER `resolveRiderLocation()` call would
 * read — but the screens above already hold a resolved `useQuery` entry on
 * `queryKeys.riderLocation()` and would never call it again, so the cache entry
 * is invalidated too and the lists recompute without a navigation. PD-447 adds
 * the third: the dismissal record is cleared, because a rider who just granted
 * the permission has answered the question outright. (`setRiderTown` does the
 * town rung's equivalent from inside the action.)
 */
export function LocationQuestionRow({
  position,
  town,
  className,
}: {
  /**
   * The screen's own `useQuery(queryKeys.riderLocation(), …)` data.
   * **`undefined` is "not settled" and `null` is a decided "nowhere"** — see
   * `locationPrimingState`, which draws nothing for the first and everything
   * for the second.
   */
  position: RiderLocation | null | undefined
  /**
   * `profiles.location`, **raw and required** — `undefined` until the read
   * lands, which draws nothing.
   *
   * **The column, never `nearLabel(...)?.name`.** That function answers the
   * literal `you` for a device fix and for a city `localityOf` will not
   * shorten, which renders as `Still in you?`; the reduction happens inside
   * `locationQuestionLabel`. It is required rather than optional because the
   * question cannot be asked without it — a screen that does not already read
   * the column has to read it, where the old row could fall back to a bare
   * offer.
   */
  town: string | null | undefined
  /**
   * Classes for the row's own padded WRAPPER, not the button. The wrapper is
   * this component's rather than the page's for `ExploreRidesStrip`'s reason:
   * the row draws nothing in most states, and padding out in the page would
   * leave 8px of empty space above whatever follows on every one of them.
   */
  className?: string
}) {
  const [permission, setPermission] = useState<DeviceLocationPermission | undefined>(undefined)
  const [quiet, setQuiet] = useState<boolean | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [askingTown, setAskingTown] = useState(false)
  const [pending, setPending] = useState(false)

  // In an effect, never during render: `deviceLocationPermission()` reads
  // `navigator` and `isQuestionQuiet()` reads `localStorage`, and a
  // `'use client'` component is still server-rendered by Next on first load
  // (see `src/lib/supabase/resolve.ts`'s header for why that is permanent). The
  // `cancelled` flag is the ordinary unmount guard — the Permissions API is a
  // promise and this row unmounts on every tab change.
  //
  // **Both reads land in the same callback, and that is not just tidiness.**
  // `isQuestionQuiet()` is synchronous, so calling it in the effect body would
  // be a `setState` directly in an effect — which `react-hooks/set-state-in-effect`
  // rejects for the cascading render it causes, and which the permission read
  // already avoids by being a promise. Riding along costs nothing: the row
  // draws nothing until BOTH have answered, so a store read that landed a tick
  // earlier would change no frame.
  useEffect(() => {
    let cancelled = false
    void deviceLocationPermission().then((state) => {
      if (cancelled) return
      setPermission(state)
      setQuiet(isQuestionQuiet())
    })
    return () => {
      cancelled = true
    }
  }, [])

  const state = locationPrimingState({ permission, position, town, quiet })

  /**
   * **The rider closed the question without answering it.**
   *
   * The record is written AND `quiet` is set in the same handler, so the row
   * leaves in the same render rather than on the next mount — a row that is
   * still sitting there after the sheet closes reads as a dismissal that did
   * not take, and the rider taps it again.
   */
  const dismiss = useCallback(() => {
    recordDismissal()
    setQuiet(true)
    setOpen(false)
    setAskingTown(false)
  }, [])

  const onContinue = useCallback(async () => {
    setPending(true)
    try {
      const fix = await requestDeviceLocation()

      // Re-read rather than infer. A `null` fix is a denial, a timeout, or a
      // device that simply could not get one, and only the first of those is a
      // permission problem — inferring `denied` from the null would show a
      // rider who is standing in a car park the "you refused us" copy.
      const next = await deviceLocationPermission()
      setPermission(next)

      if (fix) {
        // The screens above hold a resolved cache entry on this key and will
        // never call the resolver again on their own. See the header.
        invalidate(queryKeys.riderLocation())
        clearDismissal()
        setQuiet(false)
        setOpen(false)
        return
      }

      // Denied: leave the sheet open and let it re-render as the `blocked`
      // copy, so the explanation of what was just lost lands in the same breath
      // as the refusal rather than on some later screen — and that copy carries
      // the town question, which is the second rung of the ladder.
      //
      // **Since PD-447 this holds for a `refine` rider too.** It used not to:
      // that rider became `hidden` on the denial, so the row unmounted and took
      // the open sheet with it. The lifted exclusion turns them into `confirm`
      // instead, so the row stays, the sheet re-renders as `blocked`, and the
      // rider reads the same explanation as everyone else.
      if (next !== 'denied') setOpen(false)
    } finally {
      setPending(false)
    }
  }, [])

  // **The hand-off between the two sheets, and it is one at a time.** Both are
  // `ContextMenu`s, which lock body scroll and portal a scrim to
  // `document.body`; two open at once would stack two scrims and leave the
  // lower one's cleanup to restore `overflow` after the upper one already did.
  //
  // Not a dismissal: the rider is moving towards answering, not away.
  const askTown = useCallback(() => {
    setOpen(false)
    setAskingTown(true)
  }, [])

  if (state === 'hidden') return null

  const label = locationQuestionLabel(state, town)

  return (
    <>
      <div className={cn('px-4 pt-2', className)}>
        <button
          type="button"
          onClick={() => {
            // `town` and `confirm` have no device to offer, so they skip the
            // priming sheet entirely — `locationPrimingState` owns which is
            // which, and the component must not re-derive it from the
            // permission.
            if (state === 'town' || state === 'confirm') setAskingTown(true)
            else setOpen(true)
          }}
          aria-haspopup="dialog"
          className="flex h-14 w-full items-center gap-3 rounded-lg bg-surface px-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none active:bg-background"
        >
          <LocationFilledIcon className="h-6 w-6 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {label}
          </span>
          <ChevronRightIcon className="h-6 w-6 shrink-0 text-muted" />
        </button>
      </div>

      <LocationPrimingSheet
        // The tap handler never sets `open` for `town` or `confirm` — both go
        // straight to the town sheet — so the only way this is open in
        // `confirm` is the `refine` rider who denied inside it, who must keep
        // reading rather than have the sheet vanish mid-sentence. `town` is
        // guarded anyway: it is the one visible state this sheet has no copy
        // for.
        open={open && state !== 'town'}
        mode={state === 'blocked' || state === 'confirm' ? 'blocked' : 'ask'}
        pending={pending}
        onContinue={() => void onContinue()}
        onAskTown={askTown}
        onClose={dismiss}
      />

      <TownQuestionSheet
        open={askingTown}
        // **A save that came back refused is not a dismissal.** That rider
        // answered the question and the write did not land — offline is the
        // ordinary cause — so recording a dismissal would take the question away
        // for a month from the one rider who just tried to answer it. The sheet
        // closes; the row stays.
        onClose={({ saveFailed }) => (saveFailed ? setAskingTown(false) : dismiss())}
        // **Answered.** `setRiderTown` writes `{at, n: 0}` from inside the
        // action, so nothing is recorded here — but the local `quiet` must be
        // synced anyway, and forgetting it was a real defect the pre-merge
        // review caught. `isQuestionQuiet()` is read once, in the mount effect;
        // without this line the store says quiet and the component does not, so
        // the row redraws `Still in {the town they just picked}?` until the
        // rider navigates away. Same rule as `dismiss()` at the other two exits.
        onSaved={() => {
          setAskingTown(false)
          setQuiet(true)
        }}
      />
    </>
  )
}
