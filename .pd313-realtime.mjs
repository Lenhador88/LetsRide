// Realtime check: two Node clients straight to Supabase (no relay).
import { createClient } from '@supabase/supabase-js'

const URL = 'https://fpmrimzxadewsaiwpsel.supabase.co'
const KEY = 'sb_publishable_h55EF8GAyFxaugVq7dBfDg_Mc64xI8D'
const THREAD = '06eef10c-c9d2-423c-92a7-4b568ba9efa1'

const listener = createClient(URL, KEY)
const writer = createClient(URL, KEY)

const la = await listener.auth.signInWithPassword({ email: 'pd313-a@letsride.dev', password: 'Pd313-walk-Aa1!' })
const wb = await writer.auth.signInWithPassword({ email: 'pd313-b@letsride.dev', password: 'Pd313-walk-Aa1!' })
console.log('signed in A:', !!la.data.session, 'B:', !!wb.data.session)

await listener.realtime.setAuth(la.data.session.access_token)

let delivered = null
const channel = listener
  .channel(`club-thread:${THREAD}:messages`)
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'club_messages', filter: `thread_id=eq.${THREAD}` },
    (payload) => { delivered = payload.new; console.log('DELIVERED:', JSON.stringify(payload.new)) })

const status = await new Promise((resolve) => {
  channel.subscribe((s, err) => { console.log('status:', s, err ?? ''); if (s !== 'SUBSCRIBED') return; resolve(s) })
  setTimeout(() => resolve('TIMEOUT'), 20000)
})
console.log('subscribe result:', status)

if (status === 'SUBSCRIBED') {
  const body = `PD-313 realtime probe ${Date.now()}`
  const ins = await writer.from('club_messages').insert({ thread_id: THREAD, author_id: wb.data.session.user.id, body })
  console.log('insert error:', ins.error?.message ?? 'none')
  await new Promise((r) => setTimeout(r, 8000))
  console.log('RESULT delivered:', delivered ? (delivered.body === body ? 'YES, matching body' : 'YES, other row') : 'NO')
}
process.exit(0)
