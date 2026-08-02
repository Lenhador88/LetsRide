import Link from 'next/link'
import { AppBackground } from '@/components/ui/AppBackground'

/**
 * The shell every auth and onboarding screen shares, measured from Figma:
 * a 390px frame with 40px horizontal padding (so a 310px content column),
 * the form block starting at y=120, 24px between blocks and 8px within a
 * group.
 *
 * `max-w-[390px]` centres the frame on wider viewports rather than stretching
 * it — these are mobile designs and a 310px column spread across a desktop
 * would not be the same screen.
 */
export function AuthScreen({
  title,
  body,
  back,
  children,
  footer,
}: {
  title: string
  body?: string
  back?: { href: string; label: string }
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <AppBackground className="flex min-h-dvh justify-center">
      <div className="flex w-full max-w-[390px] flex-col px-10 pb-8 pt-[120px]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            {back && (
              <Link
                href={back.href}
                className="-mx-1 inline-flex h-8 w-fit items-center rounded px-1 text-base font-medium text-foreground transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {back.label}
              </Link>
            )}
            <h1 className="text-display font-semibold text-foreground">{title}</h1>
            {body && <p className="text-sm text-muted">{body}</p>}
          </div>
          {children}
        </div>
        {footer && <div className="mt-auto pt-6">{footer}</div>}
      </div>
    </AppBackground>
  )
}
