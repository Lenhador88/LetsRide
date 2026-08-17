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
 *
 * **The 12px trailing padding follows the count, and that is the one measured
 * value here that is deliberately conditional.** Every Figma instance draws a
 * count, so its 8/12 asymmetry is the gap between the number and the box edge.
 * In the app the count is hidden at zero and `ShareButton` has nothing to count
 * at all, so applied unconditionally that 12px is dead space to the right of a
 * bare icon — and with `gap-0` between the controls it reads as 20px of drift
 * between icons that the design does not have. Without a count the box is
 * symmetric `px-2`: a 40px square around a 24px glyph, which is what the frame
 * would have hugged to had it drawn this state.
 */
const shape =
  'relative inline-flex min-w-0 items-center gap-1 rounded-lg py-2 pl-2 text-sm font-semibold transition-colors ' +
  'before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-[""] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

/** One source of truth with `Count`, which renders nothing at zero or undefined. */
function hasCount(value?: number) {
  return Boolean(value)
}

type BaseProps = {
  icon: React.ReactNode
  /** Hidden when zero, as the design shows no zero counts. */
  count?: number
  label: string
  className?: string
}

export function PostcardActionLink({ href, icon, count, label, className }: BaseProps & { href: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(shape, hasCount(count) ? 'pr-3' : 'pr-2', 'text-foreground active:bg-border', className)}
    >
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
      className={cn(shape, hasCount(count) ? 'pr-3' : 'pr-2', 'text-foreground active:bg-border', className)}
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
    <span
      aria-label={label}
      className={cn(shape, hasCount(count) ? 'pr-3' : 'pr-2', 'text-foreground', className)}
    >
      {icon}
      <Count value={count} />
    </span>
  )
}

function Count({ value }: { value?: number }) {
  if (!value) return null
  return <span className="tabular-nums">{value}</span>
}
