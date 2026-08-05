import { Header } from '@/components/layout/Header'
import { CreateRideForm } from '@/components/rides/CreateRideForm'
import { getMyClubs } from '@/lib/data/clubs'

/**
 * `Create ride`.
 *
 * A server page now — and with it the **last** `'use client'` screen writing
 * through `supabase.from()`, and the last `lucide-react` import outside the
 * generated icon file, both leave the codebase. v1 is gone.
 *
 * **There is no v2 design for this screen**: its epic reads To do and the frame
 * is OLD-stylesheet throughout. See `CreateRideForm` for what that means and for
 * the five things the v1 frame draws that the schema cannot support.
 *
 * `getMyClubs()` already existed for the postcard composer, so offering a club
 * needed no new read — the fifth time reusing beat rebuilding here.
 */
export default async function NewRidePage() {
  const clubs = await getMyClubs()

  return (
    <>
      <Header title="Create ride" backHref="/rides" />

      <div className="px-4 pb-8">
        <CreateRideForm clubs={clubs} />
      </div>
    </>
  )
}
