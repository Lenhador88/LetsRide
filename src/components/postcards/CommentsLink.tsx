import Link from 'next/link'

type CommentsLinkProps = {
  postcardId: string
  count: number
  /**
   * False on the thread screen itself, where the same control would link to the
   * page it is already on. It renders as plain text there instead.
   *
   * Deliberately not called `href`: `Button` uses `href: string` as its
   * anchor/button discriminant, so a boolean of that name here would read like
   * the DOM attribute and mislead anyone writing one by analogy with the other.
   */
  linkToThread?: boolean
}

/**
 * The feed card's way into a thread, shaped to match `LikeButton` so the two
 * sit as one row of controls.
 *
 * There is no icon, for the same reason the like control has none: the design's
 * affordance is `Element / Icon / Chat Bubble`, which cannot be exported while
 * the Figma render endpoint is rate limited, and decision #4 forbids
 * substituting a `lucide-react` lookalike. A text label is the honest fallback
 * and swapping the icon in later touches only this file.
 */
export function CommentsLink({ postcardId, count, linkToThread = true }: CommentsLinkProps) {
  const label = count > 1 ? 'Comments' : 'Comment'
  const description = count === 0 ? 'Add a comment' : `${count} ${count === 1 ? 'comment' : 'comments'}`

  // 44px minimum touch target — the glove-friendly floor from CLAUDE.md.
  const className =
    'inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

  const body = (
    <>
      <span>{label}</span>
      {count > 0 && <span className="tabular-nums">{count}</span>}
    </>
  )

  if (!linkToThread) {
    return (
      <span className={className} aria-label={description}>
        {body}
      </span>
    )
  }

  return (
    <Link href={`/postcards/${postcardId}`} className={`${className} hover:text-foreground`} aria-label={description}>
      {body}
    </Link>
  )
}
