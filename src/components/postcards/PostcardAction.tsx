import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * `v2 / Component / Button / Postcard Action` — the shared shape behind the
 * like, comment and share controls on a card. Measured: row, 4px gap, padding
 * 8/12/8/8, 8px radius, 24px icon, count in Poppins/14/Semibold.
 *
 * The set's eight variants are Like × (Toggled, State), Comment × State and
 * Share × State. `State=Down` is the only one with a fill — Grey/10% — which is
 * `active:bg-border` here; the design draws no hover, these being mobile frames.
 *
 * The measured box is 40px tall, under the 44px glove-friendly floor in
 * CLAUDE.md. Rather than grow past what Figma drew, an invisible `::before`
 * stretches the hit area vertically, the same trick `Button`'s `sm`/`md` use.
 */
const shape =
  'relative inline-flex min-w-0 items-center gap-1 rounded-lg py-2 pr-3 pl-2 text-sm font-semibold transition-colors ' +
  'before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-[""] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

type BaseProps = {
  icon: React.ReactNode
  /** Hidden when zero, as the design shows no zero counts. */
  count?: number
  label: string
  className?: string
}

export function PostcardActionLink({ href, icon, count, label, className }: BaseProps & { href: string }) {
  return (
    <Link href={href} aria-label={label} className={cn(shape, 'text-foreground active:bg-border', className)}>
      {icon}
      <Count value={count} />
    </Link>
  )
}

export function PostcardActionButton({
  icon,
  count,
  label,
  className,
  pressed,
  ...props
}: BaseProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={cn(shape, 'text-foreground active:bg-border', className)}
      {...props}
    >
      {icon}
      <Count value={count} />
    </button>
  )
}

/** Static variant for the thread screen, where the comment control is not a link. */
export function PostcardActionStatic({ icon, count, label, className }: BaseProps) {
  return (
    <span aria-label={label} className={cn(shape, 'text-foreground', className)}>
      {icon}
      <Count value={count} />
    </span>
  )
}

function Count({ value }: { value?: number }) {
  if (!value) return null
  return <span className="tabular-nums">{value}</span>
}
