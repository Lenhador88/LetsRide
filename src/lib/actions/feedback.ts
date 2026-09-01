import { analyticsSessionId } from '@/lib/analytics/client'
import { resolveSupabase } from '@/lib/supabase/resolve'
import { feedbackBodySchema } from '@/lib/validation/feedback'
import { APP_VERSION } from '@/lib/version'
import type { ActionState } from '@/lib/actions/state'

/**
 * Files one piece of rider feedback — `084`, PD-321.
 *
 * ## Nothing is invalidated, and that is the whole shape of this write
 *
 * Every other action in this directory ends with an `invalidate(...)` naming
 * the cache key its write made stale. There is none here because **nothing in
 * the app reads this table**: `084` grants `authenticated` INSERT on four
 * columns and no SELECT at all, and writes no SELECT policy either. There is no
 * key in `src/lib/query/keys.ts` for feedback, so adding one to invalidate
 * would be a claim about a read that does not exist.
 *
 * **No `.select()` chained onto the insert, for the same reason and not as a
 * style choice.** PostgREST needs the SELECT grant to return the inserted row,
 * and `authenticated` does not hold one — so a chained `.select()` would turn
 * every successful submission into a `42501`. `createClubThread` chains one
 * because that rider can read their own thread back; this rider cannot read
 * anything, by design.
 *
 * ## The two context columns
 *
 * `app_version` is the constant the native update gate reads, so a report can
 * be placed against a build. `route` is `window.location.pathname` **without
 * the search**, because every detail route in this app carries its subject's id
 * in `?id=` and `084` refuses to hold one — the path says which screen, which
 * is the whole of what a bug report needs.
 *
 * It is read here rather than passed from the sheet so that the value is
 * whatever screen the rider actually had open, and it is guarded because this
 * module is imported into a graph Next still server-renders on first load,
 * where there is no `window` (CLAUDE.md §Technology Decisions).
 *
 * ## Where it goes afterwards
 *
 * Nowhere, yet. The rows are write-only and reaching a human is a separate,
 * undecided story — PD-322 — stated here as well as in `084` because a reader
 * of this function is the one most likely to assume a mailbox exists.
 */
export async function sendFeedback(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = feedbackBodySchema.safeParse(formData.get('body') ?? '')
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to send feedback.' }

  const { error } = await supabase.from('feedback').insert({
    // From the session, never the form: a parameter is something a caller can
    // get wrong, and `084`'s policy pins this column to `auth.uid()` anyway.
    user_id: user.id,
    body: parsed.data,
    app_version: APP_VERSION,
    route: typeof window === 'undefined' ? null : window.location.pathname,
    // PD-353. "The postcard thing is broken" is unactionable alone and
    // completely actionable beside ninety seconds of footage, which is the
    // pairing the Notion page was reaching for when it picked PostHog for
    // replay. PD-322 is still where these rows go so somebody reads them; this
    // is what a reader will have when it lands.
    //
    // **Now rather than later, because it cannot be backfilled.** Every
    // feedback row written before this column existed has no replay attached,
    // permanently — and the pilot is exactly the period whose feedback is worth
    // the most.
    //
    // Three rules, all of them load-bearing:
    //
    // - **Nullable and best-effort.** `analyticsSessionId()` returns null for a
    //   rider who opted out, for a build with no key (every environment except
    //   PROD), and for a session where replay never started. Feedback failing
    //   because analytics did not load would be a worse defect than the one
    //   this fixes. `096` also nulls it in a trigger for an opted-out rider, so
    //   the guarantee does not depend on this line being right.
    // - **The session id, never a replay URL.** The URL is constructible from
    //   the id and changes with PostHog's routing; a stored URL is a dead link
    //   waiting to happen.
    // - **A stored id whose recording has expired is a NULL RESULT, not a
    //   broken one** — which is the correct behaviour when the pilot posture is
    //   re-scoped and most of these recordings stop existing.
    posthog_session_id: analyticsSessionId(),
  })

  if (error) {
    // `23514` is the participation gate (`023`) or the body CHECK (`084`). The
    // length is already refused above by a schema mirroring that constraint, so
    // a 23514 reaching here is the gate — a rider who has not accepted the
    // terms, which the route guard should have made unreachable.
    return {
      error:
        error.code === '23514'
          ? 'Finish setting up your account before sending feedback.'
          : 'Could not send your feedback. Try again.',
    }
  }

  return { error: null, sent: true }
}
