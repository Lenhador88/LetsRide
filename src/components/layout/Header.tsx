import Link from 'next/link'
import { ArrowLeftIcon } from '@/components/icons/generated'
import { cn } from '@/lib/utils'

type HeaderProps = {
  /** Centred regardless of whether a back button is present, as in the design. */
  title: string
  /** Renders the 40×40 back control at the left of the title row. */
  backHref?: string
  className?: string
}

/**
 * `v2 / Component / Header`, variant `Type=Regular` — measured from the committed
 * snapshot (`npm run figma -- tree "v2 / Component / Header"`), not inferred.
 *
 * The design's 48px top padding is the iOS status bar, which the OS draws over the
 * frame. A browser has no status bar there, so reproducing 48px literally would
 * leave a dead band under the URL bar. `pt-safe` resolves to the real inset when
 * the app is installed and to the design's 8px content padding otherwise, which
 * is the same 48px visible header height on device.
 *
 * The `Type=User` and `Type=Club` variants (avatar + name, options button) are not
 * built — no screen using them exists yet.
 */
export function Header({ title, backHref, className }: HeaderProps) {
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
        <h1 className="truncate px-12 text-base font-semibold text-foreground">{title}</h1>
      </div>
    </header>
  )
}
