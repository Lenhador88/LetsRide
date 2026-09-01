'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { CreateThreadForm } from '@/components/clubs/CreateThreadForm'
import { Header } from '@/components/layout/Header'
import { DETAIL_ID_PARAM, SAY_WELCOME_TITLE_PARAM, routes } from '@/lib/routes'

/**
 * `Start a thread` in a club (`081`, PD-307).
 *
 * **This screen reads nothing.** It needs the club id and nothing else, so there
 * is no `useQuery` here and no loading treatment — and deliberately no
 * membership check either: `081`'s INSERT policy is what decides, and a client
 * copy of it would be a second rule free to drift and weaker than the one behind
 * it. A non-member who reaches this URL gets the form and a refusal, which is
 * the same answer every other create screen in this app gives.
 *
 * The composition is ours — there is no v2 frame for it; see
 * `CreateThreadForm`.
 */
export default function NewClubThreadPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per club — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <NewClubThreadScreen />
    </Suspense>
  )
}

function NewClubThreadScreen() {
  const params = useSearchParams()
  const id = params.get(DETAIL_ID_PARAM) ?? ''
  // "Say welcome" (`092`, PD-356) — a join row's overflow reaches this same
  // screen with a title already chosen. Absent for every other entrance
  // (`ClubCreateBar`), which is exactly the empty string `CreateThreadForm`
  // already defaults to.
  const prefillTitle = params.get(SAY_WELCOME_TITLE_PARAM) ?? ''

  return (
    <>
      {/* Back to the club's Threads list rather than to the club: this
          screen is only ever reached from there or from the club's section, and
          the list is where the new thread's siblings are. A malformed id falls
          back to the tab root, matching `backFromCreateScreen`'s rule. */}
      <Header
        title="Start a thread"
        backHref={id ? routes.clubThreads(id) : '/clubs'}
      />

      <div className="px-4 pt-4 pb-8">
        <CreateThreadForm clubId={id} initialTitle={prefillTitle} />
      </div>
    </>
  )
}
