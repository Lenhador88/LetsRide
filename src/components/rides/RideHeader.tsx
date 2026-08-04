import { Header } from '@/components/layout/Header'
import { RidePageMenu } from '@/components/rides/RidePageMenu'

/**
 * The chrome both ride sub-pages share — title, back, and the sub-page switcher.
 *
 * The design's header also carries two 40×40 controls on the right, and both are
 * **omitted rather than stubbed**:
 *
 * - **Chat** (`Element / Icon / Chat Bubble` with a `Warning/100` unread dot)
 *   has no tables at all. Its screens are specified — `Ride - Chat`,
 *   `- Options`, `- Text focus` — and it is a `realtime` epic, not a button.
 * - **Options** (`Element / Icon / Options`) opens a sheet this flow never
 *   draws. Ride overflow is presumably edit / cancel / leave, and "No edit or
 *   delete UI anywhere" is a standing known issue — inventing three rows for a
 *   destructive menu is the kind of guess that gets trusted later.
 *
 * A control that renders but does nothing is a worse artifact than an absent
 * one: it looks finished. Both are logged in docs/FIGMA-FIDELITY-TODO.md
 * §Ride detail.
 */
export function RideHeader({
  rideId,
  title,
  current,
}: {
  rideId: string
  title: string
  current: 'plan' | 'crew'
}) {
  return (
    <Header
      title={title}
      backHref="/rides"
      subRow={<RidePageMenu rideId={rideId} current={current} />}
    />
  )
}
