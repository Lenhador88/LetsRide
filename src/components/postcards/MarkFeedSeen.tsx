'use client'

import { useEffect } from 'react'
import { markFeedSeen } from '@/lib/actions/clubs'

/**
 * Advances the app-wide read watermark when the deck runs out.
 *
 * Renders nothing, and exists as its own component for a mechanical reason: the
 * deck's exhausted state is an early `return`, and a hook cannot live behind
 * one. Mounting this in that branch is what makes "the deck was finished" an
 * event with a place to hang from.
 *
 * It deliberately does **not** fire when the deck was empty to begin with —
 * there is nothing to mark seen, and writing a watermark there would be a
 * request per render of an empty screen.
 *
 * Lives in `postcards/` while the action lives in `actions/clubs.ts`, because
 * `feed_reads` is one table with one writer per audience and splitting the
 * upsert across two action files would be two places to get `nulls not
 * distinct` wrong.
 */
export function MarkFeedSeen() {
  useEffect(() => {
    void markFeedSeen()
  }, [])

  return null
}
