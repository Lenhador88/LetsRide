'use client'

import { useEffect } from 'react'
import { markClubSeen } from '@/lib/actions/clubs'

/**
 * Advances this rider's read watermark for a club when they open it.
 *
 * Renders nothing. It exists because a Server Component may not write — opening
 * the club is the event that means "seen", and the only place to observe it is
 * the client.
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
