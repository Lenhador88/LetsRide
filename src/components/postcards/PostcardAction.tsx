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
 * The measured box is 40px tall, under the 44px glove-friendly floor
 * (`docs/FIGMA-FIDELITY-TODO.md` §Create postcard, where the same floor already
 * justifies a deviation; `.claude/agents/rider-ux.md` owns the rule). Rather
 * than grow past what Figma drew, an invisible `::before` stretches the hit
 * area vertically, the same trick `Button`'s `sm`/`md` use.
 *
 * **The 12px trailing padding follows the count, and that is the one measured
 * value here that is deliberately conditional.** Every Figma instance draws a
 * count — all eight variants, `Type=Share` included — so its 8/12 asymmetry is
 * the gap between the number and the box edge. In the app the count is hidden
 * at zero and `ShareButton` has nothing to count at all, so applied
 * unconditionally that 12px is dead space to the right of a bare icon — and
 * with `gap-0` between the controls it reads as 20px of drift between icons
 * that the design does not have. Without a count the box is symmetric `px-2`:
 * a 40px square around a 24px glyph, which is what the frame would have hugged
 * to had it drawn this state.
 *
 * **That costs 4px of horizontal tap target and the trade is unavoidable, not
 * an oversight.** An uncounted control is now 40×44 rather than 44×44, and the
 * `::before` cannot buy the width back: the row is `gap-0` and the boxes abut,
 * so `-inset-x` would overlap the neighbour's hit area and hand the later
 * sibling taps meant for the earlier one — worse than a narrow target, because
 * it fires the wrong action rather than none. Three abutting 44px targets need
 * 132px of row and three 40px boxes give 120px, so icon spacing and target
 * width are the same lever: 16px gaps with 40px targets, or 20px gaps with
 * 44px. The product owner has seen the 20px version and asked for it tighter,
 * which is the decision this encodes. Logged as a deviation in
 * `docs/FIGMA-FIDELITY-TODO.md` rather than only here.
 */
const shape =
  'relative inline-flex min-w-0 items-center gap-1 rounded-lg py-2 pl-2 text-sm font-semibold transition-colors ' +
  'before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-[""] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

/**
 * The single expression of "is there a number to draw" — `Count` calls it too,
 * so the padding cannot start disagreeing with what is actually rendered. A
 * second copy of `Boolean(value)` would agree today and drift the first time
 * one of them learns to draw a zero.
 */
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
  if (!hasCount(value)) return null
  return <span className="tabular-nums">{value}</span>
}
