import Link from 'next/link'
import { ArrowLeftIcon } from '@/components/icons/generated'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'

type HeaderProps = {
  /**
   * Centred regardless of whether a back button is present, as in the design.
   *
   * **`undefined` means "not known yet", and draws a placeholder bar** — not an
   * empty title. Every detail screen reads its title now, so between mount and
   * the read landing there is a real state the server render never had. The
   * alternatives were both worse: an empty header reserves its space behind
   * nothing and reads as a broken screen, and a guessed string ("Ride") is
   * replaced in front of the rider a moment later. Everything else the header
   * carries — back, the sub-page switcher, the overflow control — comes from the
   * URL, so it is live immediately and only the title waits.
   */
  title: string | undefined
  /** Renders the 40×40 back control at the left of the title row, as a link. */
  backHref?: string
  /**
   * The same 40×40 back control, as a button — for a screen whose way back is
   * not a fixed URL. `/notifications` is the only one so far and the reason this
   * slot exists (PD-209): it is reached from the mailbox on all four tab roots,
   * so `backHref` would have to name one of them and be wrong from the other
   * three. `useBack` in `@/lib/actions/navigate` is the handler to pass.
   *
   * Ignored when `backHref` is also given — one control, and a caller supplying
   * both has not decided which it wants. Everything else about the two is
   * identical by construction: they share `BACK_CONTROL` rather than repeating a
   * class list that would drift the moment one of them was restyled.
   */
  onBack?: () => void
  /**
   * The 20px sub-page row beneath the title, centred. The ride detail puts its
   * `Ride plan ⌄` switcher here.
   *
   * A page rendering this must add `.pt-header-sub-extra` **on top of** the
   * shell's `.pt-header` — it is a 24px top-up, not a replacement, following
   * `.pb-navbar-action-extra`. Omitting it leaves 24px of content under the
   * fixed header.
   */
  subRow?: React.ReactNode
  /**
   * The right-hand 40×40 control in the title row — the design's overflow menu
   * at x342.
   *
   * This slot was deliberately absent until now. The reasoning was that an
   * action row with nothing behind it is a worse artifact than an absent one,
   * and it held while the only candidates were Chat (no route) and the ride's
   * Options sheet (no specified contents). The profile is the first screen with
   * something real to put here: `Profile / Delete account / Account options`
   * spells the sheet out, and one of its two rows — Sign out — is built.
   */
  action?: React.ReactNode
  /**
   * A second 40×40 control, immediately to the left of `action` at x302 —
   * `design.md` §D9's decision, taken for `add-notifications` (PD-118) and
   * implemented here rather than left to a per-screen workaround, because
   * `Header` is a primitive every screen renders and `action` already has two
   * call sites. **A second named slot, not `action` accepting a fragment**:
   * the rejected alternative made position implicit in child order, so the
   * notification icon would land at x342 and the menu at x302 with nothing to
   * catch the swap, and it silently changes what every existing `action`
   * caller means without touching their code. `secondaryAction` costs one prop
   * and leaves both of today's `action` callers (`/profile`'s `<ProfileMenu
   * />`, `RideHeader`'s chat button) untouched.
   *
   * Fixed at x302 regardless of whether `action` is present — measured off
   * `Ride - Ride plan - Sub pages` (`2375:9114`), where Chat sits at x302 and
   * Options at x342, two adjacent 40px buttons with no gap between them. The
   * two slots are absolutely positioned, like `action` and `backHref`, and
   * deliberately do not renegotiate around each other: on `/profile`, where
   * both are passed at once, the notification control lands at x302 whether
   * or not `ProfileMenu` is there. Nothing in the design draws this exact
   * pairing on a tab-root screen — the four tab roots (`/postcards`, `/rides`,
   * `/clubs`, `/profile`) get a notifications entry point only because PD-118
   * added one on top of a v2 design that still had its own Inbox tab; logged
   * as inferred-by-extension in `docs/FIGMA-FIDELITY-TODO.md` rather than
   * claimed as measured for that composition.
   */
  secondaryAction?: React.ReactNode
  /**
   * Rendered immediately before the title, inside the same centred group — the
   * 28px avatar `v2 / Component / Header` draws in its `Type=Club` and
   * `Type=User` shapes. This file used to say that title was "still not built";
   * the club detail is the first screen that needs it.
   *
   * It shares the title's flex row rather than sitting absolute like `backHref`
   * and `action`, because it is part of the title: avatar and name centre
   * together, which is what the design draws.
   */
  titleLeading?: React.ReactNode
  className?: string
}

/**
 * `v2 / Component / Header` — measured from the committed snapshot
 * (`npm run figma -- tree "v2 / Component / Header"`), not inferred.
 *
 * `Type=Regular` is the bare title (390×96). Passing `subRow` produces the
 * 390×120 shape that `Type=User` and `Type=Club` share and that
 * `Ride - Ride plan (Details)` (`2375:8771`) uses: back at x8, title centred at
 * y56, switcher row centred at y88.
 *
 * The design also puts two 40×40 icon controls at x302/x342 of that header —
 * on the ride screen, chat and an overflow menu. **Chat is built as of `034`**
 * and uses the `action` slot (x342); the ride's overflow menu is still absent,
 * because the flow never draws what its sheet contains and an action row with
 * nothing behind it is a worse artifact than an absent one. See `RideHeader`
 * for the full reasoning and docs/FIGMA-FIDELITY-TODO.md §Ride detail for the
 * log. **The x302 slot itself is now a named prop, `secondaryAction`** — see
 * its own docstring above for why it is a second slot rather than `action`
 * taking a fragment, and note `RideHeader` does not use it: its one button
 * still renders through `action`, at x342, unchanged.
 *
 * The design's 48px top padding is the iOS status bar, which the OS draws over the
 * frame. A browser has no status bar there, so reproducing 48px literally would
 * leave a dead band under the URL bar. `pt-safe` resolves to the real inset when
 * the app is installed and to the design's 8px content padding otherwise, which
 * is the same 48px visible header height on device.
 *
 * The avatar-and-name title of `Type=User` / `Type=Club` is `titleLeading`,
 * built for the club detail. The profile screen does not use it yet.
 */
/**
 * `v2 / Component / Button / Icon` at 40×40 — the design's own size for this
 * control, and the tap target on every screen that draws one. Shared by the link
 * and button forms so the two cannot drift apart.
 */
const BACK_CONTROL =
  'absolute left-0 flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border'

export function Header({
  title,
  backHref,
  onBack,
  subRow,
  action,
  secondaryAction,
  titleLeading,
  className,
}: HeaderProps) {
  return (
    <header
      className={cn(
        'pt-safe fixed top-0 right-0 left-0 z-50 border-b border-border bg-background px-2 pb-2',
        className
      )}
    >
      {/* The title centres on the header, not on the space left over beside the
          back button — so it must not share a flex row with it. */}
      <div className="relative flex h-10 items-center justify-center">
        {backHref ? (
          <Link href={backHref} aria-label="Back" className={BACK_CONTROL}>
            <ArrowLeftIcon className="h-6 w-6" />
          </Link>
        ) : onBack ? (
          <button type="button" onClick={onBack} aria-label="Back" className={BACK_CONTROL}>
            <ArrowLeftIcon className="h-6 w-6" />
          </button>
        ) : null}
        {/* Symmetric so the title stays centred on the header rather than on the
            space left beside the back button. Asymmetric padding would shift it
            off-centre, which the design does not do. */}
        <div className="flex min-w-0 items-center gap-2 px-12">
          {titleLeading}
          {title === undefined ? (
            // Sized to the title's own line box (`text-base`/24px) so the header
            // does not change height when the real one arrives, and narrower
            // than a plausible title so it does not read as one.
            <Skeleton className="h-4 w-32" />
          ) : (
            <h1 className="truncate text-base font-semibold text-foreground">{title}</h1>
          )}
        </div>
        {/* Absolute for the same reason the back button is: the title centres on
            the header, so neither control may take part in its flex row.

            `secondaryAction` sits one button-width left of `action` only when
            `action` is actually there. x302 exists in the design *because*
            x342 is occupied — `Ride - Ride plan - Sub pages` draws both — so
            reserving the gap unconditionally put the lone mailbox 40px inboard
            on `/postcards`, `/rides` and `/clubs`, with dead space to its
            right and out of line with every other single-control header in the
            app. One control belongs at x342, which is where `RideHeader` puts
            its lone chat button. */}
        {secondaryAction && (
          <div className={cn('absolute', action ? 'right-10' : 'right-0')}>{secondaryAction}</div>
        )}
        {action && <div className="absolute right-0">{action}</div>}
      </div>
      {subRow && <div className="flex h-5 items-center justify-center">{subRow}</div>}
    </header>
  )
}
