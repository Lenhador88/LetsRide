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
    // `085`, PD-325. Both resolve their club from the live subject like every
    // other arm here, so a reader who loses the club loses the string with it —
    // `036` §2's rule, and the reason none of this is stamped on the row.
    //
    // The first is read by a club's owner and admins and the second by the
    // rider who asked, so unlike `ride_joined` there is no reader-dependent
    // fork: each type has exactly one audience.
    case 'club_join_requested':
      return `asked to join ${row.club?.name ?? 'a club'}.`
    case 'club_join_request_approved':
      // "let you into" rather than "approved your request": the rider knows
      // what they asked, and what is new is that they are now in.
      return `let you into ${row.club?.name ?? 'a club'}.`
    // `089`, PD-335. **The only arm whose sentence follows the CLUB's name
    // rather than a rider's** — `NotificationsListItem` draws the club in the
    // actor slot for this type, because the stored actor is the reader
    // themselves and drawing it would read "you declined your request". A club
    // refuses as a club, and the actor being the recipient is what makes the
    // row name nobody.
    case 'club_join_request_declined':
      return 'declined your request to join.'
    // `093`, PD-360. Both resolve their club from the live subject like every
    // other arm here, so a reader who loses the club loses the string with
    // it — `036` §2's rule. `club_invited`'s actor is the inviter and
    // `club_invite_declined`'s is the invitee who declined; neither is a case
    // where the club stands in for the actor, unlike `club_join_request_declined`
    // above, because both types have a real rider on the other end who chose
    // to act.
    case 'club_invited':
      return `invited you to ${row.club?.name ?? 'a club'}.`
    case 'club_invite_declined':
      // Plainly, and without softening it — `ride_invite_declined`'s exact
      // reasoning: the inviter chose this rider by name and already knows who
      // they invited, so the identity is not new information.
      return `declined your invite to ${row.club?.name ?? 'a club'}.`
    // `092`, PD-356. A join wave alone reaches this switch — a thread wave
    // notifies nobody (`design.md` §Q2). "Wave" is the app's word for the
    // gesture (§D1); this SHALL NOT say "liked your join", which names
    // neither the gesture nor anything the reader did.
    case 'club_waved':
      return `waved you a welcome to ${row.club?.name ?? 'a club'}.`
  }

  // **The compile-time guard and the runtime fallback are BOTH needed, and the
  // fallback alone silently deletes the guard.** Before the `return` below
  // existed, a new member of `NotificationType` with no `case` produced TS2366
  // — "function lacks ending return statement" — under this function's `:
  // string` annotation. An unconditional trailing return makes that path
  // reachable, so the error can never fire again and the twelfth type ships
  // rendering this sentence with `href: null`, indefinitely, past `tsc` and
  // past `next build`.
  //
  // So the assignment stays: `row.type` narrows to `never` only while the
  // switch is exhaustive, and a new type makes THIS line the error instead.
  const exhaustive: never = row.type
  void exhaustive

  // **And the fallback is not defensive tidiness either.** A BUNDLE already
  // serving meets rows written by a migration it predates, and without this it
  // returns `undefined` where a string is expected. `089`'s header prices what
  // that costs and orders its own apply after the deploy because of it; this is
  // so the type after next has no such window.
  return 'did something on LetsRide.'
}
