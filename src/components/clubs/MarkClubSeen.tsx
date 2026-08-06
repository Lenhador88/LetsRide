'use client'

import { useEffect } from 'react'
import { markClubSeen } from '@/lib/actions/clubs'

/**
 * Advances this rider's read watermark for a club when they open it.
 *
 * Renders nothing. It was originally a component because a Server Component may
 * not write, and the Timeline that mounts it is now a client component that
 * could run this effect itself — but the shape it forced is the right one and
 * survives on its own merits. The Timeline mounts it **conditionally, on
 * membership**, so "only a member marks a club seen" is expressed by whether it
 * is on the page at all rather than by a condition inside an effect that runs
 * regardless; and keying the effect on `clubId` alone is what stops a re-render
 * of the page around it from re-firing the write.
 *
 * **Opening the club is the mark point, not rendering the list.** Advancing on
 * the list would clear every badge on the screen the rider is using to decide
 * which club to open, which is the one moment the badges are load-bearing.
 *
 * The effect depends on `clubId` alone, so a re-render does not re-fire it and
 * navigating between two clubs marks both. The write is idempotent regardless —
 * it is an upsert of a timestamp — so a double fire costs one request and
 * changes nothing.
 */
export function MarkClubSeen({ clubId }: { clubId: string }) {
  useEffect(() => {
    void markClubSeen(clubId)
  }, [clubId])

  return null
}
