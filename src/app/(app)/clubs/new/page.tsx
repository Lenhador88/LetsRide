'use client'

import { Header } from '@/components/layout/Header'
import { CreateClubForm } from '@/components/clubs/CreateClubForm'

/**
 * `Create club`.
 *
 * **This screen reads nothing**, so there is no `useQuery` here and no loading
 * treatment — it is `'use client'` because every page is, under the
 * client-rendered shell. The v1 version was also a client page, and the
 * difference that mattered then still matters now and is not about where the
 * render happens: it inserted into `clubs` and `club_members` itself, deciding
 * the owner and the role in the component with no length rule behind either
 * text column. The write now goes through `lib/actions/clubs.ts`, which parses
 * the form before it reaches Postgres. That boundary is the thing the migration
 * deliberately leaves still.
 *
 * **There is no v2 design for this screen.** Its epic reads To do and the frame
 * is drawn in the OLD stylesheet, so the composition is ours; see
 * `CreateClubForm` for what that means and what the v1 frame draws that is
 * deliberately not built.
 */
export default function NewClubPage() {
  return (
    <>
      <Header title="Create club" backHref="/clubs" />

      <div className="px-4 pt-4 pb-8">
        <CreateClubForm />
      </div>
    </>
  )
}
