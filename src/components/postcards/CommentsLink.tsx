import { ChatBubbleIcon } from '@/components/icons/generated'
import { PostcardActionLink, PostcardActionStatic } from '@/components/postcards/PostcardAction'

type CommentsLinkProps = {
  postcardId: string
  count: number
  /**
   * False on the thread screen itself, where the same control would link to the
   * page it is already on. It renders as static text there instead.
   *
   * Deliberately not called `href`: `Button` uses `href: string` as its
   * anchor/button discriminant, so a boolean of that name here would read like
   * the DOM attribute and mislead anyone writing one by analogy with the other.
   */
  linkToThread?: boolean
}

/**
 * The card's way into a thread, built on the shared `Button / Postcard Action`
 * shape so it sits flush with the like and share controls.
 *
 * The text label this used to carry is retired: `Element / Icon / Chat Bubble`
 * is in the snapshot now, so the reason for the fallback (an unexportable icon
 * plus decision #4's ban on lookalikes) no longer holds.
 */
export function CommentsLink({ postcardId, count, linkToThread = true }: CommentsLinkProps) {
  const label = count === 0 ? 'Add a comment' : `${count} ${count === 1 ? 'comment' : 'comments'}`
  const icon = <ChatBubbleIcon className="h-6 w-6" />

  if (!linkToThread) return <PostcardActionStatic icon={icon} count={count} label={label} />

  return (
    <PostcardActionLink href={`/postcards/${postcardId}`} icon={icon} count={count} label={label} />
  )
}
