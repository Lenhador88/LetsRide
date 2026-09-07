'use client'

import { ContextMenu } from '@/components/ui/ContextMenu'
import { Button } from '@/components/ui/Button'
import { LocationFilledIcon } from '@/components/icons/generated'

/**
 * The explainer a rider reads BEFORE the device's own permission dialog —
 * PD-170, proposals 1 and 2 built as one change.
 *
 * ## Why the sheet exists at all
 *
 * `requestDeviceLocation()` calls `navigator.geolocation.getCurrentPosition`,
 * and until this component there was no screen between that call and the OS
 * dialog. On the web that is merely rude: a browser prompt can be re-asked.
 * **In the native shell it is one-way** — iOS shows its alert once per install,
 * and after a decline the only route back is the Settings app, which riders do
 * not find. So a prompt fired cold both converts worse and cannot be retried,
 * and every location feature this app ever ships is disabled by that one tap.
 *
 * Hence the shape: **only `Continue` reaches the geolocation API.** `Not now`
 * closes the sheet having spent nothing, and the row that opened it is still
 * there tomorrow.
 *
 * ## Built on `ContextMenu`, not on a new primitive
 *
 * `ContextMenu` is `v2 / Component / Context Menu` — measured geometry, a
 * scrim, a portal to `document.body`, a focus trap and Escape, all of which
 * this needs and none of which is worth writing twice. What is NOT reused is
 * `ContextMenuItem`: its rows are 56px menu entries, and this sheet is a
 * heading, a paragraph and two buttons.
 *
 * **There is no Figma frame for this sheet.** `npm run figma -- ls` has no
 * permission, priming or explainer frame of any kind, so the copy and the
 * layout here are written rather than measured — flagged per `CLAUDE.md`
 * §Working Principles' rule about never letting an inferred value pass as a
 * known one. Everything it is built FROM is measured: `ContextMenu`'s sheet,
 * `Button`'s `lg` size, and the tokens in `design/TOKENS.md`.
 *
 * ## The copy is a store-review surface
 *
 * Apple reads the in-app rationale alongside `NSLocationWhenInUseUsageDescription`,
 * and a vague one is a routine flag. Two claims here are load-bearing and must
 * stay true of the code: **while the app is open** (there is no `watchPosition`
 * and no background mode anywhere in `src/`), and **never shared with other
 * riders** (a device fix leaves the device only as a proximity bias on a
 * `search-places` request, rounded to ~1 km first — see
 * `LOCATION_PRECISION_DP`). If either stops being true, this copy is the first
 * thing that has to change.
 */
export function LocationPrimingSheet({
  open,
  mode,
  pending,
  onContinue,
  onAskTown,
  onClose,
}: {
  open: boolean
  /**
   * `ask` — the device will show its dialog. `blocked` — it already refused,
   * so there is nothing left to ask for and the sheet offers the town instead.
   * See `locationPrimingState`.
   */
  mode: 'ask' | 'blocked'
  /** True while the device dialog is up and the fix is being acquired. */
  pending?: boolean
  onContinue: () => void
  /**
   * Hand off to the town question — PD-419, and the `blocked` branch's primary
   * action.
   *
   * **Required, because it carries the entire second rung.** Before PD-419 this
   * branch's button was a link to `/profile`, which asked a rider who had just
   * declined a permission to navigate away, find a free-text field among three,
   * and type a town that may or may not geocode. Making it required means a
   * caller cannot render this sheet with a dead end where the answer is.
   */
  onAskTown: () => void
  onClose: () => void
}) {
  const heading = mode === 'ask' ? 'Find rides near you' : 'Location is switched off'

  return (
    <ContextMenu open={open} onClose={onClose} label={heading}>
      <div className="flex flex-col gap-4 pb-2">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-background">
          <LocationFilledIcon className="h-6 w-6 text-accent" aria-hidden="true" />
        </span>

        <h2 className="text-lg font-semibold text-foreground">{heading}</h2>

        {mode === 'ask' ? (
          <div className="flex flex-col gap-3 text-sm font-medium text-muted">
            <p>
              LetsRide uses your location to show which rides and clubs are happening around you,
              and to start a meeting-point search where you are.
            </p>
            <p>
              Only while the app is open — we never track you in the background, and we never show
              other riders where you are.
            </p>
            <p className="text-foreground">Your device will ask you next.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm font-medium text-muted">
            <p>
              Without it we cannot tell you which rides and clubs are near you, or start a
              meeting-point search where you are. Everything else works as normal.
            </p>
            {/* Deliberately not a link or a button: no web API opens a browser's
                site settings, and the Capacitor plugin that opens the OS
                settings app is not installed — offering a control that does
                nothing is worse than telling the rider where to go. */}
            <p>
              Your device only asks once. To switch it back on, open your device settings, find
              LetsRide, and allow location while using the app.
            </p>
            {/* **The route out that does not go through Settings**, and the
                reason this branch has a primary button at all. A rider reading
                this has no position of any kind — `locationPrimingState` draws
                `refine` rather than `blocked` for anyone who has one — so
                without this the sheet's only advice is the one thing it has
                just called one-way, and a rider whose browser or MDM blocks
                location has no in-app route to a working near-you strip at all.

                **PD-419 moved the answer INTO this sheet.** It used to point at
                `/profile`, which asked a rider who had just declined a
                permission to navigate away, find a free-text field among three,
                and type a town that may or may not geocode — three chances to
                give up, at the exact moment they had already said no once. The
                question is now one tap away and answered here. */}
            <p>
              You do not have to, though. Tell us the town you ride from and we will measure from
              there instead.
            </p>
          </div>
        )}

        <div className="mt-2 flex flex-col gap-2">
          {mode === 'ask' ? (
            <Button size="lg" onClick={onContinue} loading={pending}>
              Continue
            </Button>
          ) : (
            // A button rather than the `href="/profile"` anchor this was until
            // PD-419: it hands off to `TownQuestionSheet` in place. The caller
            // owns closing this sheet before opening that one — two
            // `ContextMenu`s must never be open at once, since each locks body
            // scroll and restores it on unmount.
            <Button size="lg" onClick={onAskTown}>
              Set your town
            </Button>
          )}
          <Button variant="ghost" size="lg" onClick={onClose}>
            {mode === 'ask' ? 'Not now' : 'Close'}
          </Button>
        </div>
      </div>
    </ContextMenu>
  )
}
