import { createClient } from '@/lib/supabase/client'

/** The default half of `#supabase/data-client`. See `resolve.ts`. */
export async function resolveSupabase() {
  return createClient()
}
