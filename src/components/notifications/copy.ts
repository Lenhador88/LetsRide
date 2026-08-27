import type { NotificationRow } from '@/types'

/**
 * The second line of a notification row — the sentence that follows the actor's
 * name.
 *
 * A plain module rather than a helper inside `NotificationsListItem.tsx`, for
 * the reason `postcards/deck.ts` gives for its own: it can then be tested
 * without mounting React or pulling `next/link` into a node test. The row's
 * `href` and its trailing thumbnail stay in the component, which is where the
 * JSX and the routes are.
 *
 * ## Why `ride_joined` takes the reader
 *
 * That fan-out addresses the whole crew — everyone Going or Maybe, plus the
 * organizer — so one row is read by two kinds of rider and no single sentence
 * is true for both. A fellow attendee joined the ride alongside the actor; the
 * organizer did not join it at all, they created it. So the type stays one type
 * and the sentence resolves here, against `rides.organizer_id` read fresh under
 * the reader's own RLS on every render. Never a column stamped onto the
 * notification: `036` §2 requires every string this app draws from a
 * notification to come from the live subject, so that losing access to the
 * subject loses the string with it.
 *
 * `viewerId` is tested for presence rather than compared straight, because an
 * unresolvable ride leaves `organizer_id` undefined and `undefined === undefined`
 * would tell a reader with no session that the ride is theirs. Same guard, and
 * the same reason, as `CommentList`'s `canDelete`.
 *
 * Both unknowns — no reader, or a ride that did not resolve — fall to the drawn
 * string, which is the weaker of the two claims and the one the frame actually
 * shows. That matches how `ride_created_in_club` and `club_joined` degrade to
 * "a club" when their own subject does not resolve.
 *
 * ## The three invite types say what happened, never what can be done about it
 *
 * `ride_invited` reads "invited you to <ride>" and stops there. Whether Accept
 * and Decline are offered is a different question with a different source —
 * `RideInviteActions` reads the live invite row, because the notification is a
 * record of an event and the invite may since have been answered on another
 * device, withdrawn, or hidden by a block. Putting the affordance in the
 * sentence would make the row promise something the database may refuse.
 */
export function notificationCopy(row: NotificationRow, viewerId: string | undefined): string {
  switch (row.type) {
    case 'postcard_liked':
      return 'liked your postcard.'
    case 'postcard_commented':
      return 'commented on your postcard.'
    case 'ride_joined':
      return !!viewerId && row.ride?.organizer_id === viewerId
        ? 'joined your ride.'
        : 'joined a ride you also joined.'
    case 'ride_created_in_club':
      // Q2's default: the issue's own string, verbatim, in the same shape as
      // the drawn rows. The club is context the copy names rather than the
      // row's destination — see the `href` this pairs with.
      return `created a ride in ${row.club?.name ?? 'a club'}.`
    case 'club_joined':
      return `joined club ${row.club?.name ?? 'a club'}.`
    // `083`, PD-329. All three resolve their ride from the live subject like
    // every other arm here — a rider who loses the ride loses the string with
    // it, which is `036` §2's rule and the reason none of this is stamped on
    // the notification.
    case 'ride_invited':
      return `invited you to ${row.ride?.title ?? 'a ride'}.`
    case 'ride_invite_accepted':
      return `accepted your invite to ${row.ride?.title ?? 'a ride'}.`
    case 'ride_invite_declined':
      // Plainly, and without softening it. The organizer chose this rider by
      // name and already sees their whole crew, so the identity is not new
      // information — and a count instead of a name would make the list
      // unactionable, which is the decision `design.md` §Questions Closed Q5
      // records.
      return `declined your invite to ${row.ride?.title ?? 'a ride'}.`
  }
}
