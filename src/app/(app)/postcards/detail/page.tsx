'use client'

import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { CommentForm } from '@/components/postcards/CommentForm'
import { CommentList } from '@/components/postcards/CommentList'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonDetail } from '@/components/ui/Skeleton'
import { getPostcard } from '@/lib/data/postcards'
import { getPostcardComments } from '@/lib/data/comments'
import { getCurrentProfile } from '@/lib/data/profile'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM } from '@/lib/routes'
import { postcardIdSchema } from '@/lib/validation/postcards'
import { useSwipeBack } from '@/lib/actions/navigate'

/**
 * What the header says. A literal rather than the author's username or the
 * comment count — see the screen's docstring for which of the three was chosen
 * and why, and change it here if that answer changes.
 */
const THREAD_TITLE = 'Post'

/**
 * One postcard and its thread — the screen `addComment` has been invalidating
 * since 011 shipped, before any route answered to the path.
 *
 * A postcard the viewer may not see comes back as null rather than an error
 * (`getPostcard` uses maybeSingle for exactly that reason), and this renders it
 * as 404. That is deliberate: "this club's postcard exists but is not yours to
 * read" and "no such postcard" must look identical from outside, or the
 * response becomes an existence oracle for club-scoped photos.
 *
 * ## The frame is in the committed snapshot after all
 *
 * This screen was built on 2026-08-04 while `/v1/files/*` was 429, and the note
 * that stood here said its composition was inferred from a thread frame nobody
 * could open. `Home - Postcards - Postcard details` (`1883:22772`, flow
 * `Home / View postcard details`) reads offline today —
 * `npm run figma -- tree "Home - Postcards - Postcard details"`.
 *
 * Two things below are **measured** from it (PD-290): the 390×96
 * `v2 / Component / Header` with a back chevron at the left and a centred
 * Poppins/16/Semibold title — which is what this screen was missing and every
 * other detail screen already had — and the **16px inset** its comment list is
 * drawn at, which is the column padding here.
 *
 * Everything else stays the inferred composition registered in
 * docs/FIGMA-FIDELITY-TODO.md §Comments and is **not** what the frame draws: it
 * puts the card at an 8px inset, no heading over the comments, and a fixed 88px
 * reply bar at the foot of the viewport rather than a composer at the end of the
 * thread. Those are separate corrections with their own trades; this change is
 * the chrome and the column.
 *
 * **The title is measured, not chosen.** `THREAD_TITLE` is the frame's own title
 * text. What is worth carrying here is the premise rather than the alternatives:
 * this screen's frame is NOT one of the 29 the Figma rate limit kept shut,
 * however often that is repeated nearby. `npm run figma -- tree "Home -
 * Postcards - Postcard details"` (`1883:22772`) reads offline and says `Post`.
 *
 * ## The three-way answer this screen needs, and why `null` is not `undefined`
 *
 * A `useQuery` result carries both, and conflating them turns a 404 into a
 * flash of one on every load. `undefined` is "the effect has not answered yet";
 * `null` is "answered, and there is nothing here you may see". Only the second
 * is `notFound()`. The server version had no such distinction — it awaited the
 * read, so there was no state in which the answer had not arrived.
 */
export default function PostcardThreadPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per postcard — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <PostcardThread />
    </Suspense>
  )
}

function PostcardThread() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''

  // Before either read, not after: `id` reaches Postgres as a `uuid` and a
  // malformed segment comes back as 22P02 → 400 → a throw from `unwrap`, which
  // never reaches the `notFound()` below and renders the error boundary
  // instead — a "Try again" button on a URL that can never succeed.
  //
  // Expressed as `enabled` rather than an early `notFound()`, because hooks
  // cannot live behind a conditional return. A disabled query is exactly the
  // "must not fetch and must not throw" state `useQuery` documents for a null
  // key, so nothing is issued; the refusal happens below, past every hook.
  const valid = postcardIdSchema.safeParse(id).success

  const postcard = useQuery(valid ? queryKeys.postcards.detail(id) : null, () => getPostcard(id))
  // Issued alongside the postcard rather than after it, which means they are
  // issued even for a postcard that turns out to be invisible. That costs one
  // wasted query on a 404 and saves a round trip on every real load; RLS
  // returns an empty list in the wasted case, never someone else's thread.
  const comments = useQuery(
    valid ? queryKeys.postcards.comments(id) : null,
    () => getPostcardComments(id)
  )
  const profile = useQuery(queryKeys.profile.me(), getCurrentProfile)

  // PD-341, to the same place the arrow goes. The comment composer is a
  // textarea and `declinesSwipeBack` refuses a gesture that starts in one, so
  // the reply half of this screen is unaffected.
  //
  // Above the `notFound()` for the reason the comment fifteen lines up already
  // gives about the reads: hooks cannot live behind a conditional return, and
  // `notFound()` throws during render like any other one.
  useSwipeBack('/postcards')

  if (!valid) notFound()

  // Hoisted and rendered in every branch below, the way `/profile/detail` does
  // it: title and back are both constants here, so the chrome owes nothing to
  // the three reads and must not disappear while they are in flight or after
  // they have failed — an error state with no way back is a dead end.
  const header = <Header title={THREAD_TITLE} backHref="/postcards" />

  const gate = combineQueries(postcard, comments, profile)
  if (gate.error)
    return (
      <>
        {header}
        <div className="pt-4">
          <ErrorState onRetry={gate.refetch} />
        </div>
      </>
    )

  if (postcard.data === null) notFound()
  if (postcard.data === undefined || comments.data === undefined) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-4 px-4 py-4">
          <SkeletonDetail />
        </div>
      </>
    )
  }

  return (
    <>
      {header}

      {/* `px-4` and no `max-w`, replacing the `mx-auto max-w-lg px-4 py-6`
          column this screen was the only one to use. 16px is the inset the
          design draws its comment list at, and it is what `/profile` and
          `/profile/detail` already give this exact card — both render
          `PostcardCard` full-width in flow, so an uncapped column here is a
          shape that ships rather than one being tried out. The rest of the app
          has no width cap at all (`RideMap` says so in its own header), and
          capping only this screen is what made a tap from a profile grid into
          the thread change the card's width. */}
      <div className="flex flex-col gap-4 px-4 py-4 motion-safe:animate-fade-in">
        <PostcardCard postcard={postcard.data} linkToThread={false} />

        <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-base font-semibold text-foreground">
            {comments.data.length === 0
              ? 'Comments'
              : `${comments.data.length} ${comments.data.length === 1 ? 'comment' : 'comments'}`}
          </h2>

          {/* `profile` is in the error gate but not in the loading one. It only
              decides which comments show a delete control, so holding the whole
              thread behind the least important of the three reads would be the
              wrong trade — a momentarily absent control is smaller than a
              momentarily absent thread. */}
          <CommentList
            comments={comments.data}
            viewerId={profile.data?.id}
            postcardAuthorId={postcard.data.author_id}
          />

          <CommentForm postcardId={postcard.data.id} />
        </section>
      </div>
    </>
  )
}
