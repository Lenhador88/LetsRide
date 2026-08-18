/**
 * The vertical chrome the club detail screens share.
 *
 * **No `.pt-header-sub-extra` any more.** It used to top up the shell's
 * `.pt-header` by the 24px every sub-page's shared switcher row owed —
 * `ClubDetailPageMenu` is deleted (the club detail merge, 2026-08-18) and
 * every screen under this layout, `/clubs/detail/edit` included, now renders
 * the plain 96px `Header`, which the shell's own `.pt-header` already
 * reserves in full. Each page owns its own top gap under that (`pt-4`) rather
 * than this layout supplying one unconditionally — the ride screens made the
 * identical call when their own switcher went (PD-254).
 *
 * Horizontal padding stays deliberately **not** here, for the same reason it
 * never was: it belongs to the content, because the placeholder that stands
 * in for the content is built at its own padding (`SkeletonList` at the
 * list's `px-4`, `SkeletonDetail` at the detail column's `px-6`) — shared
 * here, every loading state would draw one inset narrower than the thing
 * replacing it.
 *
 * No `'use client'`: this holds no state and reads nothing, so it is inert in
 * either graph and the directive would claim otherwise.
 */
export default function ClubDetailLayout({ children }: { children: React.ReactNode }) {
  return <div className="pb-8">{children}</div>
}
