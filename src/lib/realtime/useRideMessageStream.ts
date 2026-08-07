'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * The app's first Realtime subscription, and therefore the shape the Inbox epic
 * will copy. `.claude/agents/realtime.md` §The subscription rules is the brief;
 * every rule it calls non-negotiable is a line below with the failure it
 * prevents.
 *
 * ## It signals, it does not deliver
 *
 * The callback fires on *any* insert into this ride's chat and the screen
 * refetches. It deliberately does **not** hand the new row to the cache, even
 * though the payload contains one, and the reason is not laziness:
 * `postgres_changes` delivers the table row and nothing else, so it carries
 * `author_id` and no `author` — the joined profile `getRideMessages` selects and
 * every other-rider bubble renders a name from. Appending it would draw a
 * message from nobody, then swap in the name on the next unrelated refetch.
 *
 * The cost is one round trip per message on an open thread. That is the right
 * trade at this scale — a ride crew, not a public channel — and the fix when it
 * stops being is a `select` on the row rather than a different subscription
 * shape. Named here so the next person does not have to work out why.
 *
 * ## The failure this whole file is guarding against
 *
 * A channel on a table outside the `supabase_realtime` publication **connects,
 * reports `SUBSCRIBED`, and silently never fires** — indistinguishable from a
 * chat nobody is writing in. `034` puts the table in the publication as part of
 * the migration chain rather than as a dashboard click for exactly that reason,
 * and `rls_test.sql` asserts the membership. If messages ever stop arriving
 * live, check `pg_publication_tables` before suspecting anything here.
 *
 * Realtime evaluates `034`'s SELECT policy per subscriber, so the crew and block
 * rules govern delivery with no second copy of them. That is a reason to keep
 * the rule in one place, not a reason to trust it untested.
 */
export function useRideMessageStream(rideId: string | undefined, onMessage: () => void): void {
  // The callback closes over component state and gets a new identity every
  // render; the effect below must re-run only for a different *ride*. Same
  // shape and same reasoning as `useQuery`'s `fetcherRef` — assigned inside a
  // dependency-less effect rather than during render, because writing a ref in
  // the render body breaks the "render has no side effects" assumption and
  // `eslint-plugin-react-hooks`'s `refs` rule rejects it outright.
  const onMessageRef = useRef(onMessage)
  useEffect(() => {
    onMessageRef.current = onMessage
  })

  useEffect(() => {
    if (!rideId) return

    const supabase = createClient()
    let cancelled = false
    let joinedBefore = false
    // Typed off the call rather than imported: pulling `RealtimeChannel` in
    // would be a direct `@supabase/supabase-js` import, which §What Not To Do
    // forbids outside `lib/supabase/`.
    let channel: ReturnType<typeof supabase.channel> | null = null

    void (async () => {
      // Explicit, though supabase-js also pushes the token on auth events. The
      // realtime socket authenticates with whatever token it holds *at connect
      // time*, and this app resolves its session from a custom store — secure
      // storage on device, `localStorage` otherwise — which can settle after the
      // client is constructed. Connecting with the publishable key instead of
      // the rider's JWT does not error: RLS simply matches no rows and the
      // channel goes quiet. That is the same silent-failure class as the
      // publication, so it is closed the same way, by being explicit.
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      await supabase.realtime.setAuth(data.session?.access_token)
      if (cancelled) return

      channel = supabase
        // Deterministic, one per logical stream. Two components mounting this
        // hook for the same ride share the name, so supabase-js hands back one
        // socket topic instead of stacking two and delivering everything twice.
        .channel(`ride:${rideId}:messages`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'ride_messages',
            // Server-side, so a rider on three rides does not receive the other
            // two chats' traffic and filter it out on the phone.
            filter: `ride_id=eq.${rideId}`,
          },
          () => onMessageRef.current()
        )
        .subscribe((status) => {
          if (status !== 'SUBSCRIBED') return
          // **Missed events are never replayed.** The first SUBSCRIBED lands
          // beside `useQuery`'s own mount fetch, so refetching on it would be a
          // duplicate request on every visit; every later one is a re-join
          // after a drop, and the gap it left is invisible from here. Refetching
          // is the only way to close it — a rider who rode through a tunnel must
          // not come back to a thread that silently stops at the moment they
          // lost signal.
          if (joinedBefore) onMessageRef.current()
          joinedBefore = true
        })
    })()

    return () => {
      cancelled = true
      // A channel that outlives its component is both a leak and a
      // duplicate-message bug: the next mount adds a second listener on the same
      // topic and every message arrives twice.
      if (channel) supabase.removeChannel(channel)
    }
  }, [rideId])
}
