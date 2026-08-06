import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * `v2 / Component / Section / Header` — the title above a list section.
 *
 * The component is 390×84 because it carries a 40px `Spacer` above the content;
 * the Crew frame's instances are 390×44 with that spacer toggled off, which is
 * the shape built here. A caller wanting the gap should space its sections
 * rather than reach for a hidden sub-frame.
 *
 * `meta` is the count beside the title — the design writes it parenthesised
 * ("Going" / "(7)") as two separate text nodes, so the parentheses belong to
 * the caller's string, not to this component.
 */
export function SectionHeader({
  title,
  meta,
  action,
  className,
}: {
  title: string
  meta?: string
  action?: { label: string; href: string }
  className?: string
}) {
  return (
    <div className={cn('flex items-baseline gap-2 px-6 py-1.5', className)}>
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      {meta && <span className="text-sm font-medium text-muted">{meta}</span>}
      {action && (
        <Link
          href={action.href}
          className="ml-auto rounded text-sm font-semibold text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}
