/**
 * The one answer the three `[id]` layouts give to `generateStaticParams()`.
 *
 * ## Why a placeholder and not a real list
 *
 * `output: 'export'` has no server, so Next must know every dynamic path at
 * build time. This app cannot supply them: a club id, ride id or postcard id
 * belongs to a rider's database row, the bundle is built once and installed on
 * thousands of devices, and RLS means the build machine could not enumerate
 * them even if the ids were stable. Baking real ids into an app bundle would
 * also leak which rows existed on build day to anyone who unzipped the IPA.
 *
 * So the export emits exactly one directory per dynamic segment —
 * `out/postcards/placeholder/index.html` and friends. **The HTML is the
 * deliverable, not the id.** Every one of these pages is `'use client'`, reads
 * its id from `useParams()` and fetches through `useQuery` in an effect, so the
 * emitted document is identical for every id; only the URL differs.
 *
 * ## What this does not solve, stated plainly
 *
 * A **cold start directly at** `/rides/<a-real-id>` — a deep link, or a webview
 * reload on a detail screen — asks the asset handler for a directory that is not
 * in the bundle. That is a separate problem with a separate fix (an SPA fallback
 * in `capacitor.config.ts`), and it is *not* fixed by this file.
 *
 * **Unmeasured, and deliberately labelled as such**: there is no
 * `capacitor.config.ts` in this repo yet and no platform has ever run, so the
 * sentence above is reasoning about how Capacitor's asset handler behaves, not
 * an observation of it. Verify it against a real device before relying on it —
 * and before writing it down anywhere as settled.
 *
 * ## Why it is empty on Vercel
 *
 * `main` and `development` both auto-deploy from this repo and neither sets
 * `CAPACITOR_BUILD`. An unconditional placeholder would prerender
 * `/postcards/placeholder` into the production deployment — a real, reachable,
 * permanently-404ing URL that nothing asked for. Returning `[]` prevents that,
 * and **that part is measured**: a clean `npm run build` with `CAPACITOR_BUILD`
 * unset emits zero `placeholder*.html`, 2026-08-06.
 *
 * ## But the web build is NOT left untouched, and a first draft of this comment
 * ## claimed it was
 *
 * Merely *declaring* `generateStaticParams` reclassifies the segment, whatever
 * it returns. Measured on a clean tree, same day:
 *
 * | | before | after |
 * |---|---|---|
 * | `ƒ (Dynamic)` | 7 | **0** |
 * | `● (SSG)` | 0 | **7** |
 * | `○ (Static)` | 20 | 21 |
 *
 * The seven are SSG with **zero** prerendered paths. Next's `dynamicParams`
 * defaults to `true`, so an id that is not in the list is still generated on
 * demand at request time — which is every id, so every real URL still works, and
 * the emitted document is the same client-rendered shell either way. No rider
 * sees a difference. **It is still a change to how Vercel builds and caches
 * those seven routes**, made as a side effect of a flag whose whole premise is
 * being inert on the web, and it is stated here rather than discovered later.
 *
 * Two consequences worth carrying:
 *
 * - **`docs/HANDOFF.md`'s dynamic-route check now reads 0, not 7.**
 *   `npm run build 2>&1 | grep -cE '^[┌├└│ ]*ƒ /'` was the documented one-liner
 *   for "the client-render migration is intact". It is no longer measuring that.
 *   Count `●` and `ƒ` together, or count `●` alone, but do not read the 0 as a
 *   regression.
 * - If the reclassification is ever unwanted, the fix is not a different return
 *   value — it is not having the export present at all in a web build, which
 *   means a build-time file swap rather than a runtime branch.
 */
export const NATIVE_SHELL_PLACEHOLDER_ID = 'placeholder'

export function staticParamsForNativeShell(): { id: string }[] {
  if (process.env.CAPACITOR_BUILD !== '1') return []
  return [{ id: NATIVE_SHELL_PLACEHOLDER_ID }]
}
