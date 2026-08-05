import { Header } from '@/components/layout/Header'
import { CreateClubForm } from '@/components/clubs/CreateClubForm'

/**
 * `Create club`.
 *
 * A server page now — the v1 version was `'use client'` and inserted into
 * `clubs` and `club_members` from the browser, deciding the owner and the role
 * client-side with no length rule behind either text column. The form is the
 * only client part, and the write is a Server Action.
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

      <div className="px-4 pb-8">
        <CreateClubForm />
      </div>
    </>
  )
}
