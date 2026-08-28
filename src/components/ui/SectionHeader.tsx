import Link from 'next/link'
import { PlusCircleIcon } from '@/components/icons/generated'
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
 *
 * ## `create` is the section's own add, and it is NOT `action` (PD-342)
 *
 * Product owner, 2026-08-28: *"'Add buttons' on postcards, rides and threads
 * are too big. When there's more than 0, should we make the add an icon right
 * next the title eg. Postcards (+)?"* — so a section that already has content
 * moves its create affordance up here, and the full-size tile or row stays for
 * the **empty** section, where it is what teaches the action exists at all
 * (PD-318, and `RideJournalEmpty`'s own note: "a section nobody has seen is a
 * feature nobody knows exists").
 *
 * **Two props rather than one, because a section routinely wants both.** Every
 * call site here draws `See all` the moment it has rows — which is the same
 * moment it wants the `(+)` — so collapsing them into one slot would force each
 * caller to choose between the entrance to its list and the way to add to it.
 * `action` is the text link, `create` is the icon; `create` is drawn last so
 * the tap target sits at the row's trailing edge where a thumb reaches it.
 *
 * **`self-center` is on the `(+)` alone, never on a wrapper around both.** The
 * title, its count and `See all` are baseline-aligned deliberately; a 40px icon
 * control has no baseline worth aligning to, and centring the pair together
 * lifts every existing `See all` off the baseline it was drawn on.
 */
export function SectionHeader({
  title,
  meta,
  action,
  create,
  className,
}: {
  title: string
  meta?: string
  action?: { label: string; href: string }
  /**
   * The section's add, drawn as a `(+)` beside the title. `label` is the
   * accessible name — the icon carries no text, so it must say what is being
   * added ("Plan a ride"), never bare "Add".
   */
  create?: { label: string; href: string }
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
      {create && (
        // 40px, matching every other icon button in the app — `-my-1.5` keeps
        // it from growing the row, whose own content is 28px inside `py-1.5`,
        // so a section would otherwise sit 12px further from its neighbours.
        // `ml-auto` only when it is alone: with `See all` beside it, that link
        // has already taken the gap and a second one would split them apart.
        <Link
          href={create.href}
          aria-label={create.label}
          className={cn(
            '-my-1.5 flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-lg text-foreground transition-colors active:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            !action && 'ml-auto'
          )}
        >
          <PlusCircleIcon className="h-6 w-6" aria-hidden="true" />
        </Link>
      )}
    </div>
  )
}
