import { createClient } from '@/lib/supabase/server'
import type { Club } from '@/types'

type ClubOption = Pick<Club, 'id' | 'name'>

/**
 * The clubs this rider belongs to, for the postcard audience selector.
 *
 * Filtering on `user_id` is business logic, not a re-filter of RLS: the
 * club_members SELECT policy scopes *visibility* (members of clubs you can
 * see), so "which of these memberships are mine" is a question the policy has
 * no opinion on — the same distinction attachLikeState draws in
 * lib/data/postcards.ts.
 *
 * Membership is still not the authority on whether a post lands: 009's
 * postcards INSERT policy decides that. This only shapes the menu.
 */
export async function getMyClubs(): Promise<ClubOption[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('club_members')
    .select('club:clubs(id, name)')
    .eq('user_id', user.id)

  // PostgREST types a to-one embed as possibly-array; a membership row whose
  // club is missing (deleted, or hidden by the clubs policy) is dropped rather
  // than rendered as an empty option.
  return (data ?? [])
    .flatMap((row) => {
      const club = row.club as unknown as ClubOption | ClubOption[] | null
      if (!club) return []
      return Array.isArray(club) ? club : [club]
    })
    .filter((club) => club?.id && club?.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}
