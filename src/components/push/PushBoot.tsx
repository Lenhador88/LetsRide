'use client'

import { useEffect } from 'react'
import { registerOnBoot } from '@/lib/push/boot'

/**
 * Runs `registerOnBoot()` once, when a signed-in rider enters the app —
 * PD-431, child B task 2.7 of `deliver-push-notifications`.
 *
 * ## Why it lives in `(app)/layout.tsx` rather than at `/`
 *
 * `registerOnBoot()` calls `register_push_device`, which resolves its subject
 * from `auth.uid()` and therefore needs a session. `(app)/layout.tsx` is the
 * subtree the route guard only ever renders for a rider who has one, so
 * mounting here means the session exists by construction rather than by a
 * timing assumption.
 *
 * `/` is the other candidate and is wrong for exactly that reason: it is the
 * document Capacitor serves for **every** cold-start path
 * (`src/lib/native/boot-restore.ts` has the mechanism), so it renders before
 * the guard has decided anything and often for a rider who turns out to be
 * signed out.
 *
 * ## Renders nothing, and mounts unconditionally
 *
 * `MarkNotificationsRead`'s shape. It draws no markup and its effect returns
 * early on every non-native platform, so on the web this is one mounted
 * component and one `Capacitor.isNativePlatform()` read per app entry.
 *
 * **The empty dependency array is the "once per cold start" claim.** This
 * layout stays mounted across navigation between tabs — the splash overlays the
 * page rather than replacing it, precisely so this subtree is not torn down
 * (`CLAUDE.md` §Critical: the route guard) — so one mount really is one app
 * entry. A re-run would be harmless in any case: the RPC is an upsert keyed on
 * the installation, which is what makes a replayed registration idempotent.
 */
export function PushBoot() {
  useEffect(() => {
    void registerOnBoot()
  }, [])

  return null
}
