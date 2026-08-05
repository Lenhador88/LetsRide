import { createClient } from '@/lib/supabase/server'

/** The `react-server` half of `#supabase/data-client`. See `resolve.ts`. */
export async function resolveSupabase() {
  return createClient()
}
