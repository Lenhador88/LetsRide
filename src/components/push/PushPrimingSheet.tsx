'use client'

import { MailboxIcon } from '@/components/icons/generated'
import { Button } from '@/components/ui/Button'
import { ContextMenu } from '@/components/ui/ContextMenu'

/**
 * The rationale a rider reads **before** the OS notification dialog — PD-431,
 * child B task 2.8 of `deliver-push-notifications`.
 *
 * ## Why a sheet exists at all rather than a bare button
 *
 * iOS grants an app exactly one notification-permission dialog for the life of
 * the install. A rider who declines it cannot be asked again from inside the
 * app — only through the Settings app, which almost nobody does. So the ask is
 * a one-shot resource, and the sheet is what makes spending it deliberate:
 * every rider who reaches the OS dialog has already read what it is for and
 * tapped a button that says so.
 *
 * **Apple reads the in-app rationale**, so the copy below is a review surface
 * as well as a product one. Two claims are made and both must stay true of what
 * the app actually does, exactly as `LocationPrimingSheet` lists its two:
 *
 * 1. *"when a ride you are going on is about to leave"* — the ride reminder.
 * 2. *"when someone invites you, joins your ride, or replies to you"* — the
 *    sixteen existing `notifications` types, delivered to the lock screen.
 *
 * **Neither is true yet**, and that is the ordering rule this component sits
 * inside rather than a defect in the copy: the sender is child C, and until it
 * exists nothing here can prompt anyway, because `pushPrimingState` returns
 * `hidden` on every non-native platform and no native build has ever been
 * compiled. `registration.ts`'s header carries that argument in full. **If
 * child C's scope changes, this copy changes with it** — a rationale that
 * promises something the sender does not send is the kind of claim an App
 * Store review rejects and a rider uninstalls over.
 *
 * ## The `blocked` branch offers no control, on purpose
 *
 * There is no route from inside a webview to the OS notification settings —
 * the Capacitor plugin that opens the settings app is not installed, and
 * `CLAUDE.md`'s dependency rule is that a plugin is a permission prompt, a
 * review question and a supply-chain surface. `LocationPrimingSheet` reached
 * the same conclusion for the same reason and its comment says so. Offering a
 * button that does nothing is worse than telling the rider where to go.
 *
 * Unlike that sheet, this one has **no second rung**: there is no equivalent of
 * the town question, because a device that refuses notifications cannot be
 * substituted for. So `blocked` is genuinely informational and its only action
 * is dismissal.
 */
export function PushPrimingSheet({
  open,
  mode,
  pending,
  onContinue,
  onClose,
}: {
  open: boolean
  /**
   * `ask` — the OS will show its dialog. `blocked` — it already refused, so
   * there is nothing left to ask for. See `pushPrimingState`, which is the only
   * thing that should decide this.
   */
  mode: 'ask' | 'blocked'
  /** True while the OS dialog is up and the registration is being requested. */
  pending?: boolean
  /**
   * **The only path to `requestPushPermission()`**, and therefore the only path
   * to the one dialog. A caller that reaches that function from anywhere else
   * has spent the ask without a rider reading why.
   */
  onContinue: () => void
  onClose: () => void
}) {
  const heading = mode === 'ask' ? 'Never miss a ride' : 'Notifications are switched off'

  return (
    <ContextMenu open={open} onClose={onClose} label={heading}>
      <div className="flex flex-col gap-4 pb-2">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-background">
          <MailboxIcon className="h-6 w-6 text-accent" aria-hidden="true" />
        </span>

        <h2 className="text-lg font-semibold text-foreground">{heading}</h2>

        {mode === 'ask' ? (
          <div className="flex flex-col gap-3 text-sm font-medium text-muted">
            <p>
              We will let you know when a ride you are going on is about to leave, and when someone
              invites you, joins your ride, or replies to you.
            </p>
            <p>Nothing else. No marketing, and nothing about riders you have blocked.</p>
            <p className="text-foreground">Your device will ask you next.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm font-medium text-muted">
            <p>
              You will still see everything in the app — the mailbox at the top of the screen keeps
              working exactly as it does now. What you lose is knowing about it while the app is
              closed.
            </p>
            {/* Deliberately not a link or a button — see the header. */}
            <p>
              Your device only asks once. To switch notifications back on, open your device
              settings, find LetsRide, and allow notifications.
            </p>
          </div>
        )}

        <div className="mt-2 flex flex-col gap-2">
          {mode === 'ask' ? (
            <Button onClick={onContinue} loading={pending}>
              Turn on notifications
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {mode === 'ask' ? 'Not now' : 'Close'}
          </Button>
        </div>
      </div>
    </ContextMenu>
  )
}
