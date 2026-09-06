'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * One ride thread's messages, live — `108`, PD-402.
 *
 * **`useClubThreadStream` with the table swapped**, and that is the whole of the
 * difference. It replaces `useRideMessageStream` (`034`), which subscribed to a
 * ride's single chat; the ride now has threads, so the channel is scoped to the
 * **thread** rather than to the ride. Every rule below is the club hook's, and
 * they are stated here rather than cross-referenced because a silent stream is
 * diagnosed by reading the file that owns it.
 *
 * ## It signals, it does not deliver
 *
 * The callback fires on any insert into this thread and the screen refetches. It
 * deliberately does **not** hand the payload row to the cache even though the
 * payload contains one: `postgres_changes` delivers the table row and nothing
 * else, so it carries `author_id` and no `author` — the joined profile
 * `getRideThreadMessages` selects and every other rider's bubble renders a name
 * from. Appending it would draw a message from nobody, then swap in the name on
 * the next unrelated refetch.
 *
 * The cost is one round trip per message on an open thread. That is the right
 * trade at this scale — a ride's crew, not a public channel — and the fix when
 * it stops being is a `select` on the row rather than a different subscription
 * shape.
 *
 * ## The failure this whole file is guarding against
 *
 * A channel on a table outside the `supabase_realtime` publication **connects,
 * reports `SUBSCRIBED`, and silently never fires** — indistinguishable from a
 * thread nobody is writing in. `108` adds `ride_thread_messages` to the
 * publication in the migration and deliberately leaves `ride_threads` out,
 * saying so in the file: a new *thread* appearing live is not required, and the
 * list revalidates by key. If messages ever stop arriving live, check
 * `pg_publication_tables` before suspecting anything here.
 *
 * Realtime evaluates `108`'s SELECT policy per subscriber, so the crew
 * conjunction and the block arm govern delivery with no second copy of them —
 * which is a reason to keep the rule in one place, not a reason to trust it
 * untested. It is the one assertion the RLS suite cannot make (plain Postgres
 * has no Realtime), so it is confirmed by observation against DEV.
 *
 * ## The channel name carries the KIND as well as the id
 *
 * `ride:${rideId}:messages` was `034`'s and is retired with it. `ride-thread:
 * ${threadId}:messages` names both the kind and the id, so it cannot collide
 * with `club-thread:` — and two components mounting this hook for the same
 * thread share one socket topic instead of stacking two and delivering
 * everything twice.
 */
export function useRideThreadStream(
  threadId: string | undefined,
  onMessage: () => void
): void {
  // The callback closes over component state and gets a new identity every
  // render; the effect below must re-run only for a different *thread*. Assigned
  // inside a dependency-less effect rather than during render, because writing a
  // ref in the render body breaks the "render has no side effects" assumption
  // and `eslint-plugin-react-hooks`'s `refs` rule rejects it outright.
  const onMessageRef = useRef(onMessage)
  useEffect(() => {
    onMessageRef.current = onMessage
  })

  useEffect(() => {
    if (!threadId) return

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
        .channel(`ride-thread:${threadId}:messages`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'ride_thread_messages',
            // Server-side, so a rider on a ride with ten threads does not
            // receive the other nine's traffic and filter it out on the phone.
            filter: `thread_id=eq.${threadId}`,
          },
          () => onMessageRef.current()
        )
        .subscribe((status) => {
          if (status !== 'SUBSCRIBED') return
          // **Missed events are never replayed.** The first SUBSCRIBED lands
          // beside `useQuery`'s own mount fetch, so refetching on it would be a
          // duplicate request on every visit; every later one is a re-join after
          // a drop, and the gap it left is invisible from here. Refetching is
          // the only way to close it — a rider who rode through a tunnel must
          // not come back to a thread that silently stops at the moment they
          // lost signal.
          if (joinedBefore) onMessageRef.current()
          joinedBefore = true
        })
    })()

    // A phone that sleeps with a thread open suspends the socket; the re-join
    // that follows fires the `joinedBefore` branch above *only if* the channel
    // actually dropped, and a socket that was merely paused can come back
    // believing it missed nothing. Refetching when the tab becomes visible
    // closes that without depending on which of the two happened — the same
    // "assume the gap, do not assume the stream filled it" rule the reconnect
    // branch follows.
    const onForeground = () => {
      if (document.visibilityState === 'visible') onMessageRef.current()
    }
    document.addEventListener('visibilitychange', onForeground)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onForeground)
      // A channel that outlives its component is both a leak and a
      // duplicate-message bug: the next mount adds a second listener on the same
      // topic and every message arrives twice.
      if (channel) supabase.removeChannel(channel)
    }
  }, [threadId])
}
