import { cn } from '@/lib/utils'

/**
 * `v2 / Component / Notification` — the 16×16 unread mark (measured
 * 2026-08-07, `npm run figma -- tree "v2 / Component / Notification"`).
 * `cornerRadius: 100` (a circle), fill `Warning/100` `#D92140`, a 3px inside
 * ring `Grey/5` `#F2ECE6` so the mark reads as a cutout against the cream
 * background wherever it overlays a control — today that is the badge on one
 * of `Header`'s icon slots.
 *
 * **A dot, not a count badge.** The Figma component carries a `Notifications`
 * text property (default `"1"`), but no text layer renders it — the property
 * exists in the file without a use, which is why it is not reproduced here.
 * `v2 / Component / Counter` (the private `UnreadCounter` in `ClubCard.tsx`) is
 * the component that *does* draw a number; it is white text on `Warning/100`
 * at 24×24 and answers a different design question. The two are not variants
 * of one primitive — they render different things for different reasons, so
 * this file does not promote or merge with it.
 *
 * Not positioned or sized by a prop: Figma draws this as an overlay on
 * whatever it decorates rather than as a layout participant, so the caller
 * places it — e.g. `<span className="relative">{icon}<NotificationDot
 * className="absolute -top-0.5 -right-0.5" /></span>`.
 *
 * **Contrast, computed 2026-08-07 (not re-derived from the design doc's
 * figure): 4.22:1**, `Warning/100` `#D92140` on `Grey/5` `#F2ECE6`, against the
 * WCAG **3:1** non-text bar — this component has no text child, so the 4.5:1
 * text bar does not apply. Passes.
 */
export function NotificationDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block h-4 w-4 rounded-full border-[3px] border-background bg-danger', className)}
    />
  )
}
