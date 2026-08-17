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
 * **The whole padding pair is conditional on the count, and a counted control
 * still measures exactly what Figma drew.** Every instance in the frame draws a
 * count — all eight variants, `Type=Share` included — so the 8/12 asymmetry is
 * the gap between the *number* and the box edge, not between controls. In the
 * app the count is hidden at zero and `ShareButton` has nothing to count at all,
 * so applied unconditionally that 12px is dead space beside a bare glyph, and
 * against the frame's own `itemSpacing 0` two icons sat 20px apart. So:
 *
 *   with a count     `pl-2 pr-3`   — 8/12, the measured box, unchanged at 54px
 *   without one      `px-1.5`      — 6/6, a 36px square around the 24px glyph
 *
 * **The uncounted padding is the product owner's number, not a derived one.**
 * The frame has no zero-count state to measure, so symmetric 8 was this file's
 * own inference; shown 16px and 12px side by side on 2026-08-17 the owner chose
 * 12px, which is 6 either side. Only the state the design never drew moved —
 * which is why a counted control's geometry is untouched rather than scaled to
 * match.
 *
 * **It costs tap-target width, and the trade is arithmetic rather than an
 * oversight.** An uncounted control is 36×44. The `::before` cannot buy the
 * width back: the row is `gap-0` and the boxes abut, so `-inset-x` would overlap
 * the neighbour and hand the later sibling taps meant for the earlier one —
 * worse than a narrow target, since it fires the wrong action rather than none.
 * The gap between two glyphs *is* the control width minus the 24px icon, so
 * there is one lever and not two: 12px apart means 36px wide, 16px means 40px,
 * and 44px — the glove floor — would mean 20px apart, which is the version that
 * prompted this. Revisit if riders report mis-taps here; the escape that keeps
 * both is a larger glyph, offered and not taken.
 * `docs/FIGMA-FIDELITY-TODO.md` §Home / Postcards feed carries it as a logged
 * deviation.
 */
const shape =
  'relative inline-flex min-w-0 items-center gap-1 rounded-lg py-2 text-sm font-semibold transition-colors ' +
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
      className={cn(shape, hasCount(count) ? 'pl-2 pr-3' : 'px-1.5', 'text-foreground active:bg-border', className)}
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
      className={cn(shape, hasCount(count) ? 'pl-2 pr-3' : 'px-1.5', 'text-foreground active:bg-border', className)}
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
      className={cn(shape, hasCount(count) ? 'pl-2 pr-3' : 'px-1.5', 'text-foreground', className)}
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
