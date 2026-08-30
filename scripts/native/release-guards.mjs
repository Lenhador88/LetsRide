/**
 * The two things a release bundle bakes in permanently, as pure functions so
 * both a CLI script and a unit test can use them.
 *
 * ## Why this is separate from `check-export.mjs`
 *
 * That one runs on **every** `npm run build:native`, including the local and
 * on-device test builds `design.md` §D7 explicitly allows to point wherever
 * they like — "as long as it never reaches a store". This is the pre-submission
 * gate, so it asserts the opposite: that the bundle in `out/` is the one a
 * rider may install. Folding the two together would either block every test
 * build or check nothing on a real one.
 *
 * ## What is unfixable, and why a grep is the right shape
 *
 * `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
 * `NEXT_PUBLIC_CANONICAL_ORIGIN` are inlined at build time, so a `.ipa` or
 * `.aab` carries whichever values it was built with for ever. There is no
 * promote, no redeploy and no dashboard toggle — the fix is a new binary
 * through a store review, which is days, and in the meantime:
 *
 * - a bundle built from `development` points **every install** at
 *   `letsride-dev`, which runs `mailer_autoconfirm: true`, so anyone can sign up
 *   with an address they do not control;
 * - a bundle with the wrong canonical origin emails riders a confirmation link
 *   GoTrue discards, landing them on the app root with the error in a fragment
 *   nothing reads.
 *
 * Both values are *visible* in the bundle, which is fine and always was — the
 * publishable key ships by design — and it is what makes the check cheap.
 *
 * ## Failing when it finds nothing
 *
 * The refusal below is the load-bearing part. A scan of an empty, stale or
 * unbuilt `out/` finds no DEV ref and no wrong origin, and would report clean —
 * the same skip-is-not-a-pass failure `scripts/docs/check.mjs` and
 * `src/__tests__/no-service-role-key.test.ts` each close. So a run that saw no
 * project ref at all is a **failure**, not a pass.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { walkFiles } from './export-guards.mjs'

/** `letsride` — the production project. Not a secret; it ships in the bundle. */
export const PROD_PROJECT_REF = 'zwprydcyryvudhurbnye'

/** `letsride-dev`. Named separately so its message can say what it costs. */
export const DEV_PROJECT_REF = 'fpmrimzxadewsaiwpsel'

/**
 * The host a release bundle emails links to. `app.letsride.social` is the
 * production app, serving since 2026-08-11 (PD-105), and
 * `https://app.letsride.social/**` is on PROD's GoTrue redirect allowlist
 * (PD-106, re-confirmed live 2026-08-12) — so this needs no dashboard action.
 *
 * A confirmation link from a bundle therefore opens the **web** app rather than
 * deep-linking back into the shell. That is acceptable and deliberate: universal
 * links and app links are their own work, and a link that lands somewhere real
 * beats one GoTrue throws away.
 */
export const RELEASE_ORIGIN = 'https://app.letsride.social'

/**
 * Any Supabase project URL in the bundle, whichever project it names.
 *
 * Matching *any* ref rather than the two known ones is what makes the "found
 * nothing" case detectable at all, and it also catches a third project nobody
 * declared — `LetsRide` (`ylxnicopnaroltebvfnc`) existed for a while and would
 * have read as clean against a two-name list.
 *
 * A ref is 20 lowercase letters. The `https://` prefix is part of the pattern
 * because it is the inlined `NEXT_PUBLIC_SUPABASE_URL` that matters, not the
 * word appearing in a comment.
 */
export const PROJECT_REF_PATTERN = /https:\/\/([a-z]{20})\.supabase\.co/g

/**
 * Origins that mean "this bundle was not built for release".
 *
 * `https://localhost` is the webview's own origin under
 * `androidScheme: 'https'`, `capacitor://localhost` is the iOS scheme, and
 * `http://localhost:<port>` is a dev server. Any of them baked into a shipped
 * binary is a dead link in a rider's messages or an email GoTrue discards.
 *
 * **Measured against a real export rather than reasoned about**, and the
 * measurement is why `BENIGN_ORIGINS` below exists: a clean bundle built with
 * the release origin matches this once, in a library constant, and nowhere
 * else. `https://localhost` and `capacitor://localhost` — the two a shell
 * actually produces — appear zero times.
 */
export const DEAD_ORIGIN_PATTERN = /(?:capacitor:\/\/localhost|https?:\/\/localhost(?::\d+)?)/g

/**
 * Origins that are in **every** build and mean nothing, so reporting them would
 * make this guard unusable — the same shape as `BUNDLE_PATTERNS`' note that
 * `object/sign` matches supabase-js building the path.
 *
 * Measured 2026-08-12 against a clean `out/` (383 files): exactly one
 * `localhost` hit in the whole bundle,
 * `rF={url:"http://localhost:9999",storageKey:"supabase.auth.token",…}` — the
 * auth client's default options object, which is overwritten by the URL the app
 * constructs its client with and is never requested.
 *
 * Excluding it costs nothing that matters: nobody configures a canonical origin
 * of `http://localhost:9999`, and if somebody did, the far stronger check —
 * that the release origin is present — still fails.
 */
export const BENIGN_ORIGINS = new Set(['http://localhost:9999'])

/**
 * A floor, so a walk of nothing cannot report clean. Same reasoning and same
 * number as `check-export.mjs`: the export is around 380 files and a build that
 * produced a tenth of that is a failed build rather than a tidy one.
 */
export const MIN_FILES = 100

/**
 * Is the bundle about to be submitted allowed to run under the minimum it will
 * itself be measured against?
 *
 * **The failure this closes is the update gate eating its own fix.** Ship a
 * broken bundle reporting `0.1.0`, raise the published minimum to `0.1.1` to
 * stop it, then build the fix — and if `package.json`'s `version` was not
 * bumped, the fix reports `0.1.0` too and is blocked by the gate that was
 * raised to stop the break. Every rider taps "update", installs a build that is
 * also blocked, and there is no way out from inside the app: `app-version.json`
 * says so in its own first line. Nothing else in the repo requires a bump —
 * no CI job, no release step — so the one place that can catch it is here,
 * immediately before the submission that makes it permanent.
 *
 * **Fails CLOSED, which is the opposite of the runtime gate and deliberate.**
 * `src/lib/version.ts` treats anything it cannot parse as "do not block",
 * because there the cost of being wrong is a rider locked out of a working app.
 * Here the cost of being wrong is a store binary that cannot be recalled, so an
 * unreadable version is a refusal.
 *
 * Kept as its own small comparison rather than importing `src/lib/version.ts`:
 * this is a `.mjs` build script and that is TypeScript compiled into the client
 * bundle. `__tests__/release-version.test.mjs` runs both over one table and
 * asserts they agree, so the duplication cannot drift silently.
 */
export function compareReleaseVersions(a, b) {
  const parse = (value) => {
    if (typeof value !== 'string') return null
    const parts = value.split('.')
    if (parts.length === 0) return null
    const numbers = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : NaN))
    return numbers.some((n) => !Number.isSafeInteger(n)) ? null : numbers
  }
  const left = parse(a)
  const right = parse(b)
  if (!left || !right) return null
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

/** The problems, if any, with submitting `bundleVersion` while
 * `publishedMinimum` is what the deployed `app-version.json` carries. */
export function releaseVersionProblems(bundleVersion, publishedMinimum) {
  const comparison = compareReleaseVersions(bundleVersion, publishedMinimum)
  if (comparison === null) {
    return [
      `cannot compare this bundle's version (${JSON.stringify(bundleVersion)}) against the ` +
        `published minimum (${JSON.stringify(publishedMinimum)}). Both must be dot-separated ` +
        'integers, e.g. 0.2.0. The runtime gate treats an unreadable version as "do not block"; ' +
        'a submission cannot afford the same benefit of the doubt.',
    ]
  }
  if (comparison < 0) {
    return [
      `this bundle reports version ${bundleVersion}, which is BELOW the published minimum ` +
        `${publishedMinimum} — so the update gate would block the very build you are about to ` +
        'submit, and every rider who installs it. Bump "version" in package.json (src/lib/' +
        'version.ts follows it, and its test enforces that), or lower "minimum" in ' +
        'public/app-version.json if it was raised in error.',
    ]
  }
  return []
}

/**
 * Walks every emitted file and reports what the bundle would ship with.
 *
 * Every file, not a glob of one extension: the inlined values land in a JS
 * chunk, and the RSC payloads carry them too. A check scoped to `**\/*.html`
 * would read the documents and miss the value it is looking for.
 *
 * Returns the raw findings as well as the problems, so a caller can print what
 * the bundle *does* carry — the useful line when the answer is "not what you
 * think".
 */
export function scanReleaseBundle(dir, { expectedRef = PROD_PROJECT_REF, expectedOrigin = RELEASE_ORIGIN } = {}) {
  const files = walkFiles(dir)
  /** ref -> the first file it was seen in */
  const refs = new Map()
  /** origin -> the first file it was seen in */
  const deadOrigins = new Map()
  let originFiles = 0

  for (const relative of files) {
    const contents = readFileSync(path.join(dir, relative), 'utf8')

    for (const match of contents.matchAll(PROJECT_REF_PATTERN)) {
      if (!refs.has(match[1])) refs.set(match[1], relative)
    }
    for (const match of contents.matchAll(DEAD_ORIGIN_PATTERN)) {
      if (BENIGN_ORIGINS.has(match[0])) continue
      if (!deadOrigins.has(match[0])) deadOrigins.set(match[0], relative)
    }
    if (contents.includes(expectedOrigin)) originFiles += 1
  }

  return {
    files,
    refs,
    deadOrigins,
    originFiles,
    problems: releaseProblems({ files, refs, deadOrigins, originFiles }, { expectedRef, expectedOrigin }),
  }
}

/** The verdict, separated from the walk so both halves are testable alone. */
export function releaseProblems(
  { files, refs, deadOrigins, originFiles },
  { expectedRef = PROD_PROJECT_REF, expectedOrigin = RELEASE_ORIGIN } = {}
) {
  const problems = []

  if (files.length < MIN_FILES) {
    problems.push(
      `${files.length} files walked, expected at least ${MIN_FILES} — an empty or partial ` +
        'bundle is a failed build, never a clean one'
    )
  }

  // Before anything else: a scan that found no ref has not verified the thing
  // it exists to verify, whatever else it saw.
  if (refs.size === 0) {
    problems.push(
      'no Supabase project ref found anywhere in the bundle. Every build inlines ' +
        'NEXT_PUBLIC_SUPABASE_URL, so zero refs means this walk read nothing that matters — ' +
        'a stale, empty or wrongly-pointed out/. It is a failure, not a pass.'
    )
  }

  if (refs.size > 0 && !refs.has(expectedRef)) {
    problems.push(
      `the production ref ${expectedRef} (letsride) is absent — this bundle talks to ` +
        `${[...refs.keys()].join(', ')} instead, permanently, for every install`
    )
  }

  for (const [ref, file] of refs) {
    if (ref === expectedRef) continue
    const which =
      ref === DEV_PROJECT_REF
        ? 'letsride-dev — which runs mailer_autoconfirm: true, so anyone could sign up with an ' +
          'address they do not control'
        : 'an undeclared Supabase project'
    problems.push(`${file}: the ref ${ref} is in the bundle — ${which}`)
  }

  if (originFiles === 0) {
    problems.push(
      `the canonical origin ${expectedOrigin} appears in no file. NEXT_PUBLIC_CANONICAL_ORIGIN ` +
        'was unset or set to something else, so every shared link and every confirmation and ' +
        'recovery email this bundle sends points somewhere else.'
    )
  }

  for (const [origin, file] of deadOrigins) {
    problems.push(
      `${file}: ${origin} is baked into the bundle — it resolves to nothing off the device, ` +
        'and GoTrue discards it silently rather than refusing it'
    )
  }

  return problems
}
