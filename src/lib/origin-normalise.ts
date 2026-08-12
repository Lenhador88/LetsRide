/**
 * The single definition of what a *configured* canonical origin is, shared by
 * the code that reads it and the build guards that require or refuse it.
 *
 * **It exists because those disagreeing is a shipped bug, twice measured.**
 * `next.config.ts` fails a `CAPACITOR_BUILD=1` build when the origin is unset,
 * and that guard is only fail-closed if "unset" means the same thing to it as
 * to `canonicalOrigin()`. Two rounds of review found it did not:
 *
 * - raw truthiness vs `.trim()` — `" "` built a bundle whose links were
 *   `https://localhost`;
 * - `.trim()` vs `.trim().replace(/\/+$/, '')` — `"/"` did the same, because it
 *   trims to something and normalises to nothing.
 *
 * Both were the *same* defect at a narrower value, which is the signal that the
 * fix is one definition rather than a third hand-matched expression. A guard
 * that disagrees with its consumer about what "set" means is not a guard.
 *
 * **No browser globals here, deliberately.** `next.config.ts` imports this
 * module in Node during `next build`, so anything touching `window` would take
 * the build down — which is why the fallback to `window.location.origin` stays
 * in `canonicalOrigin()` and only the normalisation lives here.
 */
export function normaliseConfiguredOrigin(raw: string | undefined): string {
  // Trailing slashes go because every caller appends a rooted path, so
  // `https://app.letsride.social/` would emit a doubled slash. GoTrue's `/**`
  // allowlist match still honours that, so it would not fail — it would just
  // send riders to a URL nobody notices until one of them reports it.
  return raw?.trim().replace(/\/+$/, '') ?? ''
}
