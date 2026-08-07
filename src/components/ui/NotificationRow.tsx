import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'

/**
 * `v2 / Component / List / User` as instanced inside `Inbox - Notifications`
 * (measured 2026-08-07, `npm run figma -- tree "Inbox - Notifications"`) —
 * a **different shape from `ListUser`**, not a variant of it. `ListUser` is a
 * 48px single-line row (avatar, name, optional trailing note); this is 72px
 * with a two-line text block — actor name and a relative stamp on line one,
 * the notification's copy on line two — and an optional trailing 56×56
 * thumbnail. `design.md` §D9 rejected building this as a `ListUser` prop for
 * exactly this reason: three conditional branches on a 48px row to reach a
 * 72px, two-line shape, for a component with a real precedent already sharing
 * its name that every diff would then have to disambiguate.
 *
 * Text tokens, measured from the same tree rather than assumed from a
 * neighbouring component — line one is a full step heavier *and* larger than
 * line two, not the same token twice:
 *
 * | Element | Token | Class |
 * |---|---|---|
 * | actor name | `Poppins/16/Semibold` (16/24, w600) | `text-base font-semibold` |
 * | stamp | `Poppins/14/Regular` (14/20, w400), `Grey/80` | `text-sm text-muted` |
 * | copy | `Poppins/14/Regular` (14/20, w400), `Grey/100` | `text-sm text-foreground` |
 *
 * `stamp` is a pre-formatted compact string — pass
 * `formatNotificationStamp(createdAt)`, **not** `formatRelativeTime`, which
 * produces prose ("2 minutes ago") for a different screen's byline.
 *
 * **No unread treatment on the row itself.** Every row in the drawn frame is
 * identical; there is no read/unread visual difference anywhere in the
 * design except the header control that opens this screen
 * (`NotificationDot`). Adding one here would be inventing a state nothing
 * draws — logged in `docs/FIGMA-FIDELITY-TODO.md` rather than guessed.
 *
 * **Purely presentational, like `ListUser`**: no navigation, no read-state
 * write, no per-`type` branching. The caller supplies already-resolved
 * strings and wraps the row (a `Link` to the subject) if it should navigate —
 * this component does not know what a notification `type` is.
 *
 * **One deliberate simplification, logged rather than guessed.** The design
 * draws a second, composite leading treatment for two of the five types —
 * two overlapping 36px avatars inside the 56px frame, on `ride_joined` and
 * `ride_created_in_club` — whose second subject the static mock does not
 * name. Only the single-avatar leading shape is built here; the composite is
 * not reproduced. Likewise, the trailing thumbnail's corner radius varies in
 * the drawn frame (square for a postcard photo, `radius 4` clipped for a
 * ride's map thumbnail with its pin overlay) — this component applies `radius
 * 4` uniformly rather than branching on subject type, which is a design-system
 * primitive's job to leave to its caller only if the difference turns out to
 * matter.
 */
export function NotificationRow({
  actorName,
  avatarUrl,
  stamp,
  copy,
  trailing,
  className,
}: {
  actorName: string
  avatarUrl?: string | null
  /** Compact relative stamp — `formatNotificationStamp(createdAt)`. */
  stamp: string
  /**
   * The second line. Wraps up to two lines rather than truncating to one —
   * the design's own `created a ride in ‹club›.` row is two lines for a long
   * club name, not one line that grew wider.
   */
  copy: string
  /**
   * The optional 56×56 trailing thumbnail — a postcard photo, a club avatar,
   * a ride's map thumbnail. Sized and clipped here; pass only the image or
   * icon content, not a positioned container.
   */
  trailing?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-h-18 items-center gap-3 px-4', className)}>
      <Avatar src={avatarUrl} name={actorName} size="lg" className="h-14 w-14 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1">
          <span className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
            {actorName}
          </span>
          <span className="shrink-0 text-sm text-muted">{stamp}</span>
        </div>
        <p className="line-clamp-2 text-sm text-foreground">{copy}</p>
      </div>
      {trailing && (
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded bg-border">{trailing}</div>
      )}
    </div>
  )
}
