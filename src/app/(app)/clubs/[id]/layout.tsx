/**
 * The vertical chrome the four club sub-pages share.
 *
 * `pt-header-sub-extra` is the 24px top-up the shell's `pt-header` needs when a
 * page draws the header's sub-page row, and it is applied unconditionally —
 * every sub-page renders `ClubDetailHeader` in all three of its states, loading
 * included, so there is no state in which this reserves space for nothing.
 *
 * Horizontal padding is deliberately **not** here. It belongs to the content,
 * because the placeholder that stands in for the content is built at its own
 * padding (`SkeletonList` at the list's `px-4`, `SkeletonDetail` at the detail
 * column's `px-6`) — shared here, every loading state would draw one inset
 * narrower than the thing replacing it.
 *
 * No `'use client'`: this holds no state and reads nothing, so it is inert in
 * either graph and the directive would claim otherwise.
 */
export default function ClubDetailLayout({ children }: { children: React.ReactNode }) {
  return <div className="pt-header-sub-extra pb-8">{children}</div>
}
