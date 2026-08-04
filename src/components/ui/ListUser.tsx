import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'

/**
 * `v2 / Component / List / User` — one rider in a roster. 358×48, avatar then
 * name, with an optional trailing note.
 *
 * The two variants differ only in the avatar ring: `is Host=False` draws the
 * standard `Grey/20%` border, `is Host=True` swaps it for `Accent Brand/100`.
 * `<Avatar size="md">` is a 40px box with a 2px inside border, which is exactly
 * the host variant's 40px outer / 36px photo — so the ring is a colour override
 * and not a second avatar size.
 *
 * One deliberate deviation, small but worth naming: the design draws the
 * non-host avatar at 36px against the host's 40px. Both render at 40 here, so
 * rows in a mixed list share a left edge. A 4px difference that only appears on
 * one row of a roster reads as a rendering bug rather than as emphasis.
 */
export function ListUser({
  name,
  avatarUrl,
  isHost,
  note,
  className,
}: {
  name: string
  avatarUrl?: string | null
  isHost?: boolean
  /** The trailing label — "Ride host" in the Crew frame. */
  note?: string
  className?: string
}) {
  return (
    <div className={cn('flex h-12 items-center gap-3 px-4', className)}>
      <Avatar
        src={avatarUrl}
        name={name}
        size="md"
        className={cn(isHost && 'border-accent')}
      />
      <span className="min-w-0 flex-1 truncate text-base text-foreground">{name}</span>
      {note && (
        <span className="shrink-0 text-xs font-medium text-accent-strong">{note}</span>
      )}
    </div>
  )
}
