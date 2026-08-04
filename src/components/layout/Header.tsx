import Link from 'next/link'
import { ArrowLeftIcon } from '@/components/icons/generated'
import { cn } from '@/lib/utils'

type HeaderProps = {
  /** Centred regardless of whether a back button is present, as in the design. */
  title: string
  /** Renders the 40×40 back control at the left of the title row. */
  backHref?: string
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
 * chat and an overflow menu. Neither is built and neither is stubbed here: an
 * action row with nothing behind it is a worse artifact than an absent one, and
 * the slot is three lines to add once Chat has a route. See
 * `RideHeader` for the full reasoning and docs/FIGMA-FIDELITY-TODO.md §Ride
 * detail for the log.
 *
 * The design's 48px top padding is the iOS status bar, which the OS draws over the
 * frame. A browser has no status bar there, so reproducing 48px literally would
 * leave a dead band under the URL bar. `pt-safe` resolves to the real inset when
 * the app is installed and to the design's 8px content padding otherwise, which
 * is the same 48px visible header height on device.
 *
 * The avatar-and-name title of `Type=User` / `Type=Club` is still not built —
 * the profile and club screens are the ones that need it.
 */
export function Header({ title, backHref, subRow, className }: HeaderProps) {
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
        {backHref && (
          <Link
            href={backHref}
            aria-label="Back"
            className="absolute left-0 flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
          >
            <ArrowLeftIcon className="h-6 w-6" />
          </Link>
        )}
        {/* Symmetric so the title stays centred on the header rather than on the
            space left beside the back button. Asymmetric padding would shift it
            off-centre, which the design does not do. */}
        <h1 className="truncate px-12 text-base font-semibold text-foreground">{title}</h1>
      </div>
      {subRow && <div className="flex h-5 items-center justify-center">{subRow}</div>}
    </header>
  )
}
