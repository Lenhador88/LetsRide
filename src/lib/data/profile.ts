import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/types'

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
  return data
}

/**
 * Stored usernames are always lowercase — 003's CHECK constraint enforces the
 * charset — so an exact match against the normalised input is equivalent to the
 * case-insensitive uniqueness the unique index provides.
 *
 * This is advisory only. Two riders can pass the check on the same name in the
 * same instant; the unique index is what actually decides, and the action that
 * writes must handle the conflict.
 */
export async function isUsernameTaken(username: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle()
  return data !== null
}
