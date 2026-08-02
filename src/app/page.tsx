import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * `/` is a resolver, not a screen (Q7/Q18). The Figma splash is a timed
 * loading frame for a client app with a boot window; an SSR app has none, so
 * rendering that markup here would only add an artificial delay. The brand
 * mark it would have shown belongs to the PWA launch screen in a later epic —
 * `public/brand/logo-splash.png` is committed ready for that.
 */
export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  redirect(user ? '/dashboard' : '/auth/login')
}
