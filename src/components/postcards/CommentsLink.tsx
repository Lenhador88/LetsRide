'use client'

import { ChatBubbleIcon } from '@/components/icons/generated'
import {
  PostcardActionButton,
  PostcardActionLink,
  PostcardActionStatic,
} from '@/components/postcards/PostcardAction'
import { usePostcardViewer } from '@/components/postcards/viewerContext'
import { routes } from '@/lib/routes'

type CommentsLinkProps = {
  postcardId: string
  count: number
  /**
   * False on the thread screen and inside the popup, where the same control
   * would open the thread it is already showing. It renders as static text
   * there instead.
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
 * **It opens the thread as a popup where one is available** (2026-08-27) —
 * `usePostcardViewer()`, mounted for every screen under `(app)`. The name is
 * now half wrong and is kept anyway: renaming it touches five call sites to say
 * the same thing, and it still *is* a link wherever no viewer is mounted.
 *
 * That fallback is not decoration. `PostcardActionLink` is what renders in a
 * unit test that mounts a card on its own, and it is what would render if the
 * provider were ever lifted out of the app shell — a control that silently did
 * nothing would be the alternative.
 *
 * The text label this used to carry is retired: `Element / Icon / Chat Bubble`
 * is in the snapshot now, so the reason for the fallback (an unexportable icon
 * plus decision #4's ban on lookalikes) no longer holds.
 */
export function CommentsLink({ postcardId, count, linkToThread = true }: CommentsLinkProps) {
  const openPostcard = usePostcardViewer()
  const label = count === 0 ? 'Add a comment' : `${count} ${count === 1 ? 'comment' : 'comments'}`
  const icon = <ChatBubbleIcon className="h-6 w-6" />

  if (!linkToThread) return <PostcardActionStatic icon={icon} count={count} label={label} />

  if (openPostcard)
    return (
      <PostcardActionButton
        onClick={() => openPostcard(postcardId)}
        icon={icon}
        count={count}
        label={label}
      />
    )

  return (
    <PostcardActionLink href={routes.postcard(postcardId)} icon={icon} count={count} label={label} />
  )
}
