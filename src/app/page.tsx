'use client'

/**
 * `/` is a resolver, not a screen (Q7/Q18) — and it is now a resolver that
 * resolves nothing itself.
 *
 * It used to be a server page that read the session and `redirect()`ed. The
 * route guard makes the same decision for every path in the app, including this
 * one (`resolveDestination('/', …)` → `/postcards` for an onboarded rider,
 * `/auth/login` for a visitor, and the resume step for a rider mid-wizard —
 * which the old version got wrong, sending them to `/postcards` for `proxy.ts`
 * to bounce again). Duplicating that here would be a second copy of a rule with
 * its own opinion about the wizard.
 *
 * So this renders nothing, and nothing is ever seen: the guard shows the splash
 * until it has decided, and it has always decided to leave.
 *
 * **The splash frame the original comment ruled out now exists**, and this is
 * what changed. That comment's reasoning — "the Figma splash is a timed loading
 * frame for a client app with a boot window; an SSR app has none, so rendering
 * that markup here would only add an artificial delay" — was right for a server
 * render and is exactly wrong for this one. Reading a session out of local
 * storage and fetching the onboarding stamp is a real boot window. It is drawn
 * by `RouteGuard`, not here, because every route has it and not just this one.
 */
export default function Home() {
  return null
}
