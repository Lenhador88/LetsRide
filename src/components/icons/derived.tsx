import type { IconProps } from '@/components/icons/generated'

/**
 * Icons that are not in the Figma set but are DERIVED from one that is.
 *
 * `generated.tsx` is generated and must never be hand-edited, so a variant the
 * design does not ship cannot live there. This file is the other half of that
 * rule: hand-authored, but only ever a transformation of an exported asset —
 * never new artwork. New artwork is `design-system`'s and goes through Figma.
 */

/**
 * The outer contour of `Element / Icon / wave`, filled — the wave as a solid
 * silhouette rather than as line art.
 *
 * **This is the same asset, not a second drawing.** The exported `wave` path
 * has exactly two subpaths: the outside of the hand, and the interior detail
 * that turns it into an outline. Dropping the second and filling the first is
 * what "filled" means for this glyph, and it is why no new licence question
 * comes with it. `__tests__/derived.test.tsx` re-derives this string from
 * `WaveIcon` on every run, so a regenerated icon set cannot leave the two
 * silently drawing different hands.
 *
 * **It costs the interior detail, and that was the argument against having
 * it.** `LikeButton`'s own header carried the case for one glyph in two
 * colours: a solid hand loses the folded fingers that make the gesture legible
 * at 24px. The product owner overruled it on 2026-08-20 — "the wave icon
 * should be filled when liked" — so the fill now carries the state alongside
 * the colour, which is strictly more signal than the colour alone had.
 */
export function WaveFilledIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable={false} {...props}>
      <path d="M13.2861 2.29429C14.8682 2.46093 16.0147 3.87929 15.8486 5.46031L15.3203 10.4886C15.3164 10.5265 15.3303 10.5645 15.3584 10.5902C15.3867 10.6158 15.4265 10.6262 15.4639 10.6185C15.6976 10.5706 15.9412 10.5523 16.1895 10.5697C16.9946 10.6261 17.6877 11.0332 18.1377 11.6293C18.1624 11.6618 18.2024 11.6803 18.2432 11.6771C18.4348 11.662 18.6306 11.6664 18.8271 11.6976C20.0956 11.8989 20.985 13.0297 20.915 14.2835L20.8887 14.5365L20.7324 15.5238C20.6399 16.1073 20.3485 16.6077 19.9434 16.973C19.9325 16.9828 19.9236 16.9944 19.917 17.0072L19.9043 17.0482C19.6033 19.6784 17.3707 21.721 14.6602 21.721H9.86035C7.38898 21.721 5.31701 20.0236 4.74121 17.7308C4.73738 17.7156 4.73078 17.7012 4.72168 17.6888L4.68652 17.6566L4.51074 17.5443C3.64937 16.955 3.08128 15.9679 3.08105 14.8421C3.08111 13.0313 4.54813 11.563 6.3584 11.5619L6.44922 11.5638C6.48836 11.5646 6.52572 11.5456 6.54883 11.514C6.5718 11.4824 6.57808 11.4416 6.56543 11.4046L4.99316 6.83824C4.47545 5.33448 5.27493 3.69515 6.77832 3.1771C8.01341 2.75185 9.3391 3.2159 10.0605 4.22886C10.0865 4.26519 10.1306 4.28482 10.1748 4.27867C10.2191 4.27243 10.2565 4.24168 10.2715 4.19956C10.7048 2.97094 11.9345 2.1523 13.2861 2.29429Z" fill="currentColor" />
    </svg>
  )
}
