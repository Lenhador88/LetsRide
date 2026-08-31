'use client'

import { useSyncExternalStore } from 'react'
import {
  getPendingInviteToken,
  getServerPendingInviteToken,
  subscribePendingInviteToken,
  type InviteTokenKind,
} from '@/lib/invites/pending-token'

/**
 * The invite token this page load resolved, for one kind — `091`, PD-330,
 * generalised by `093` (PD-360) to take which.
 *
 * A hook in its own file so `pending-token.ts` stays React-free: that module is
 * imported by `lib/actions/auth.ts` and by `lib/actions/onboarding.ts`, neither
 * of which should pull React into its graph.
 *
 * `undefined` means nothing has resolved it yet — the landing route's mount
 * effect has not run — and draws a skeleton. `null` is decided and draws the
 * invalid-link message. Same three-way answer, and same meanings, as every
 * `useQuery` on every other screen.
 */
export function usePendingInviteToken(kind: InviteTokenKind): string | null | undefined {
  return useSyncExternalStore(
    subscribePendingInviteToken,
    () => getPendingInviteToken(kind),
    getServerPendingInviteToken
  )
}
