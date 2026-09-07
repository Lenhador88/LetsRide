'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRightIcon, LocationFilledIcon } from '@/components/icons/generated'
import { LocationPrimingSheet } from '@/components/location/LocationPrimingSheet'
import { TownQuestionSheet } from '@/components/location/TownQuestionSheet'
import { hasAskedForLocation, markAskedForLocation } from '@/lib/location/ask-once'
import { locationPrimingState } from '@/lib/location/priming'
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
 * The only control in this app that can reach the device's location permission
 * — PD-170 — and, since PD-419, the only one that asks a rider where they are
 * at all.
 *
 * ## Before this existed, no rider could grant it
 *
 * `resolveRiderLocation()` is deliberately silent: its device source returns
 * early unless the permission ALREADY reads `granted`, so it can be called
 * from an effect on every screen without ever raising a dialog.
 * `requestDeviceLocation()` is the one function that may prompt — and it had
 * no caller anywhere in `src/`. So the three features that measure distance
 * (`/rides`' near-you strip, `/clubs`' explore strip, the place field's search
 * bias) all ran permanently on the geocoded onboarding city, and a rider with
 * no geocodable city got nothing at all, with no affordance anywhere to fix
 * it. This row is that affordance, and the sheet behind it is what makes
 * spending the device's one-shot prompt a deliberate act.
 *
 * ## PD-419 — the ladder, and the hole that made it necessary
 *
 * `075` (PD-286) removed the location step from onboarding, so
 * `profiles.location` is NULL for every rider who has signed up since. Combined
 * with a device permission nobody had granted, the ordinary new rider had **no
 * position at all** — and three screens split their lists into *Nearby* and the
 * rest against it. The machinery was built and had no input.
 *
 * The ladder this row now walks, in order, is: **ask the device once, and if
 * that is declined or unavailable, ask for a town.** Both rungs end in
 * `profiles.location` or a device fix; there is no third rung, and in
 * particular there is no IP lookup — see `TownQuestionSheet`'s header, where
 * that decision is recorded.
 *
 * ## `auto` — asked once, automatically, EVER
 *
 * Product owner, 2026-09-06: the app asks *"at Explore, once, automatically,
 * ever"*. The flag lives in `ask-once.ts` and is per device rather than per
 * session, because what is being spent is the OS permission dialog, which on
 * iOS is one-way per install.
 *
 * **The automatic ask is spent on the sheet OPENING, not on the rider
 * answering.** Marking it on the answer would re-open the sheet on every cold
 * start until a rider tapped `Continue`, which is exactly the shape that
 * teaches riders to dismiss permission prompts reflexively.
 *
 * **Only screens that pass `auto` open it by themselves**, and today that is
 * the two Explore screens — the reason is visible on screen there, which is
 * where grants actually come from. `/rides` and `/clubs` draw the same row and
 * wait to be tapped.
 *
 * ## Geometry is `ExploreClubsStrip`'s, deliberately
 *
 * 56px on `White/100` at radius 8, 16px padding, 12px gap, a 24px `Location
 * Filled` in `Accent Brand/100`, the label at Poppins/14/Semibold, a chevron
 * trailing. It renders in the same slot as the near-you strip on `/rides` and
 * the explore strip on `/clubs`, and the same row in the same place on two
 * tabs should be the same row. A `<button>` rather than a `<Link>`, because it
 * opens a sheet rather than going anywhere — which is why it carries
 * `aria-haspopup="dialog"` and the chevron is the only thing it borrows from
 * the two links.
 *
 * ## When it draws, and when it must not
 *
 * `locationPrimingState` owns that decision and states each rule with the trap
 * it avoids. **`hidden` is the answer while either input is still undecided**,
 * so this never flashes onto a screen and then vanishes.
 *
 * ## Two things happen on a grant, and both are needed
 *
 * `requestDeviceLocation()` overwrites the module-level memo inside
 * `rider-location.ts`, which is what a LATER `resolveRiderLocation()` call
 * would read — but the screens above already hold a resolved `useQuery` entry
 * on `queryKeys.riderLocation()` and would never call it again. So the cache
 * entry is invalidated too, and the strips recompute against the device fix
 * without a navigation. (`setRiderTown` does the same pair for the town rung,
 * from inside the action.)
 */
/**
 * How long after the screen settles the automatic sheet goes up. Long enough
 * for both Explore screens' `motion-safe:animate-fade-in` to finish, so the
 * rider reads the list the permission is being asked FOR before the sheet
 * covers it; short enough that it is one interaction rather than an interruption
 * later. See the effect that uses it for the two other jobs the delay does.
 */
const AUTO_ASK_DELAY_MS = 700

export function UseMyLocationRow({
  position,
  town,
  auto,
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
   * The rider's own town, where the screen already reads it — used only by the
   * `refine` row, to say where the distances on screen are being measured from.
   *
   * **Optional, and its absence is not a defect.** A screen that does not read
   * `profiles.location` for its own purposes must not take a round trip to
   * render one word; the row falls back to the bare offer. Pass `localityOf`'s
   * output rather than the raw column — this renders it verbatim.
   */
  town?: string | null
  /**
   * Open the priming sheet by itself, once ever, when there is something to
   * ask. The Explore screens pass this; the tab roots do not. See the header.
   */
  auto?: boolean
  /**
   * Classes for the row's own padded WRAPPER, not the button. The wrapper is
   * this component's rather than the page's for `ExploreRidesStrip`'s reason:
   * the row draws nothing in most states, and padding out in the page would
   * leave 8px of empty space above whatever follows on every one of them.
   * `/clubs` passes `px-0` because its slot is already inside a padded block.
   */
  className?: string
}) {
  const [permission, setPermission] = useState<DeviceLocationPermission | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [askingTown, setAskingTown] = useState(false)
  const [pending, setPending] = useState(false)

  // In an effect, never during render: `deviceLocationPermission()` reads
  // `navigator`, and a `'use client'` component is still server-rendered by
  // Next on first load (see `src/lib/supabase/resolve.ts`'s header for why
  // that is permanent). The `cancelled` flag is the ordinary unmount guard —
  // the Permissions API is a promise and this row unmounts on every tab
  // change.
  useEffect(() => {
    let cancelled = false
    void deviceLocationPermission().then((state) => {
      if (!cancelled) setPermission(state)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const state = locationPrimingState({ permission, position })

  /**
   * **Has the rider opened a sheet themselves? One-way, and set synchronously.**
   *
   * Read by the automatic ask's timer, which cannot see `open`/`askingTown`
   * through its own closure — adding them to that effect's deps would re-arm the
   * timer on every open and close, which is the opposite of a once-ever ask.
   *
   * **It latches rather than mirroring `open || askingTown`, and the delta
   * review is why.** A mirror reads the *instantaneous* state, so a rider who
   * opened the sheet at 250ms and dismissed it at 600ms would have the timer
   * fire at 700ms against a `false` and **reopen the sheet they had just
   * closed** — an app that reopens a permission prompt 100ms after it is
   * dismissed is precisely the shape this component's header calls out as how
   * riders learn to dismiss prompts reflexively. Latched, the ask is spent by
   * the rider having engaged at all, which is what it was for.
   *
   * **Written in the click handlers rather than in an effect**, so it is true
   * before the timer can possibly see it. A passive effect is flushed after
   * paint, so a tap landing in the same frame as the timer deadline could
   * otherwise run the callback against a stale `false` and stack two sheets
   * after all — a sub-frame window that `act()` in a test flushes away and so
   * could never fail one.
   */
  const riderOpenedSheet = useRef(false)

  // **The automatic ask — see the header.** Gated on the resolved state rather
  // than on the raw inputs, so it fires for exactly the states a tap would open
  // something for, and never in `hidden` (where both inputs may simply not have
  // settled yet) or `refine` (a rider who HAS a position must not be
  // interrupted; the row is there if they want better).
  //
  // **The sheet arrives a beat after the screen, and the beat is doing three
  // jobs** — `PostcardDeck`'s swipe coach is the same shape for the same
  // reasons. It reads better: both Explore screens draw their list under
  // `motion-safe:animate-fade-in`, and a sheet thrown up during that fade
  // covers a screen the rider has not seen yet, which is a permission prompt
  // arriving with its reason still invisible. It keeps `setOpen` out of an
  // effect body, which `react-hooks/set-state-in-effect` rejects for the
  // cascading render it causes. And — the half that is a correctness property
  // rather than a preference — `markAskedForLocation()` is called INSIDE the
  // timer, so the flag is spent only if the sheet actually goes up. Claiming it
  // in the effect body would spend the device's one automatic ask on a rider
  // who tapped through Explore inside the beat, or on any of the remounts these
  // screens do routinely, and they would then never be asked again.
  useEffect(() => {
    if (!auto) return
    if (state !== 'ask' && state !== 'blocked' && state !== 'town') return
    if (hasAskedForLocation()) return

    const timer = setTimeout(() => {
      // **Never open a second sheet over one the rider already opened.** The
      // timer is armed when the row first renders and its deps are `[auto,
      // state]`, neither of which changes when a sheet opens — so a rider who
      // taps the row inside the beat would otherwise get the automatic open
      // landing on top of their own. Two `ContextMenu`s stack two scrims, and
      // each restores `document.body.style.overflow` to whatever it captured on
      // mount: close them in the wrong order and the screen is left
      // unscrollable until a reload, with nothing on it to explain why.
      //
      // The flag is still spent, and that is right rather than a concession —
      // the automatic ask exists to put this sheet in front of the rider once,
      // and it is in front of them.
      if (riderOpenedSheet.current) {
        markAskedForLocation()
        return
      }

      // Spent on the sheet OPENING, not on the rider answering — the header
      // says why that direction is the safe one.
      markAskedForLocation()
      if (state === 'town') setAskingTown(true)
      else setOpen(true)
    }, AUTO_ASK_DELAY_MS)

    return () => clearTimeout(timer)
  }, [auto, state])

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
        setOpen(false)
        return
      }

      // Denied: leave the sheet open and let it re-render as the `blocked`
      // copy, so the explanation of what was just lost lands in the same
      // breath as the refusal rather than on some later screen — and that copy
      // now carries the town question, which is the second rung of the ladder.
      //
      // **That holds for a rider who had NO position, and not for a `refine`
      // one.** A refine rider is `profile`-sourced with `permission: 'prompt'`;
      // once the denial lands, `locationPrimingState` answers `hidden`, the row
      // unmounts and takes the open sheet with it, so the `blocked` copy is
      // never read. Benign rather than a defect — that rider keeps a working
      // position and lost nothing — but the sentence above is not true of them,
      // and this comment is what the next session will trust.
      if (next !== 'denied') setOpen(false)
    } finally {
      setPending(false)
    }
  }, [])

  // **The hand-off between the two sheets, and it is one at a time.** Both are
  // `ContextMenu`s, which lock body scroll and portal a scrim to
  // `document.body`; two open at once would stack two scrims and leave the
  // lower one's cleanup to restore `overflow` after the upper one already did.
  const askTown = useCallback(() => {
    riderOpenedSheet.current = true
    setOpen(false)
    setAskingTown(true)
  }, [])

  if (state === 'hidden') return null

  const label =
    state === 'ask'
      ? 'Use my location'
      : state === 'blocked'
        ? 'Location is switched off'
        : state === 'town'
          ? 'Set where you ride from'
          : // `refine`. The town is what makes this worth drawing at all — it
            // answers *why do these distances look wrong* — so without one the
            // row is the bare offer instead.
            town
            ? `Near ${town} · Use my location`
            : 'Use my location'

  return (
    <>
      <div className={cn('px-4 pt-2', className)}>
        <button
          type="button"
          onClick={() => {
            // Latched here, synchronously — see `riderOpenedSheet`.
            riderOpenedSheet.current = true
            if (state === 'town') setAskingTown(true)
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
        // `town` is not a priming state — the row opens `TownQuestionSheet`
        // directly for it — so the sheet only ever sees the two it has copy for.
        open={open && state !== 'town'}
        mode={state === 'blocked' ? 'blocked' : 'ask'}
        pending={pending}
        onContinue={() => void onContinue()}
        onAskTown={askTown}
        onClose={() => setOpen(false)}
      />

      <TownQuestionSheet
        open={askingTown}
        onClose={() => setAskingTown(false)}
        onSaved={() => setAskingTown(false)}
      />
    </>
  )
}
