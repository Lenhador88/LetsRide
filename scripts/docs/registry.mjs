/**
 * The declared registry of numeric doc claims, plus the pure functions that
 * locate and extract them.
 *
 * ## Why declared, not discovered
 *
 * Linear PD-155 is explicit: *"Not a prose linter. Only claims with a single
 * unambiguous ground truth in the repo."* A parser that goes hunting through
 * prose for numbers produces false positives the moment two different facts
 * share a digit, and a checker that cries wolf gets ignored — which is the
 * exact failure this replaces. So every claim below is hand-written: the file,
 * a regex that must match **exactly once** (so a later edit that removes the
 * sentence FAILS the run — see `check.mjs`'s exit-code contract; it was a skip
 * until 2026-08-10 — rather than silently checking nothing), and how to pull
 * the stated number out of what it matches.
 *
 * ## The comment trap
 *
 * `CLAUDE.md` calls this the repo's most-repeated measurement error: a
 * sentence describing what code *used to do* contains the same string as the
 * thing being counted, so an unfiltered grep counts its own obituary.
 * `lucide-react` and `supabase.from(` each get TWO entries for it — the
 * unfiltered count (which the docs themselves predict will be nonzero, all
 * comments) and the filtered one (which must be zero) — so the filter is
 * asserted in both directions rather than trusted. `text-white` gets only
 * the filtered entry: its raw, unfiltered count is also 0 (no comment ever
 * mentions it), so there is no "counts its own obituary" case to guard
 * against and no unfiltered companion to write.
 *
 * ## What "shell" claims run, and why some are cached
 *
 * Several claims are re-stated in more than one file — the `rls-count-*`
 * trio and the `unit-tests-*` quartet below — because that repetition is
 * exactly what went stale unnoticed (this file's own history has already
 * proven the point: an earlier revision of this very paragraph cited the
 * literal numbers, and one of them went stale before the citation did).
 * Each location is its own registry entry so an edit to just one of them is
 * still caught, but the *measurement* backing them (the RLS suite, `vitest`,
 * `next build`) is expensive, so `check.mjs` runs each distinct command once
 * and reuses the result across every claim that cites it.
 */

/** Thrown when a claim's anchor text can't be found exactly once. */
export class ClaimLocateError extends Error {}

/**
 * Finds `pattern` in `content` and returns the single match.
 *
 * Throws if it matches zero times (the sentence moved or was reworded — the
 * claim can no longer be verified) or more than once (the anchor was not
 * specific enough to name one location, which is the same ambiguity the issue
 * asks the registry to avoid). Both are real failures, not corner cases: a
 * registry entry that silently stops matching is a check that has quietly
 * gone blind, which is the second trap this whole tool exists to avoid.
 */
export function findOnce(content, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'
  const re = new RegExp(pattern.source, flags)
  const matches = [...content.matchAll(re)]
  if (matches.length === 0) {
    throw new ClaimLocateError(`pattern not found in file (expected exactly 1 match): ${pattern}`)
  }
  if (matches.length > 1) {
    throw new ClaimLocateError(
      `pattern matched ${matches.length} times, expected exactly 1 — the anchor is ambiguous: ${pattern}`
    )
  }
  return matches[0]
}

/** Rounds to `decimals` places as a number, not a string — so `1.10 === 1.1` compares correctly. */
export function roundTo(n, decimals) {
  const f = 10 ** decimals
  return Math.round((n + Number.EPSILON) * f) / f
}

/**
 * WCAG 2.x relative-luminance contrast ratio between two sRGB hex colours.
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 *
 * This is the "single unambiguous ground truth" case the issue calls out
 * explicitly: two hex values have exactly one correct ratio, computed the
 * same way every time. PR #35 shipped a claim of 3.0:1 against a measured
 * 2.54:1 — arithmetic, not opinion, and exactly the kind of thing a reviewer
 * re-derives by hand and a script never forgets to.
 */
export function contrastRatio(hexA, hexB) {
  const luminance = (hex) => {
    const clean = hex.replace('#', '')
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255)
    const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
  }
  const [l1, l2] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** Thrown when a matched claim's stated value cannot be turned into a number. */
export class ClaimExtractError extends Error {}

// Number words these claims spell out in prose rather than digits.
const NUMBER_WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

/**
 * Reads a spelled-out number word ("Nine", "zero", "four") — case-insensitive
 * — or a bare numeral ("9", "10"), and returns `null` if it is neither.
 *
 * The numeral branch matters even though every claim using this anchors on
 * `\w+` (which already matches digits): without it, an edit from `**Nine**`
 * to `**10**` — the single most likely real-world edit, a careless author
 * "fixing" a word to a digit — read as an unrecognized word and produced a
 * SKIP rather than a FAIL. Narrower than the original defect (loud rather
 * than silent, and only this one edit shape), but still a wrong doc shipping
 * green, which is the one outcome this whole tool exists to prevent.
 */
export function wordToNumber(word) {
  if (/^\d+$/.test(word)) return Number(word)
  return Object.hasOwn(NUMBER_WORDS, word.toLowerCase()) ? NUMBER_WORDS[word.toLowerCase()] : null
}

/**
 * `extractStated` for a claim whose anchor captures a spelled-out number word
 * (group `index`, default 1) rather than a digit.
 *
 * This is deliberately NOT the same shape as `literal(n) = () => n`, which
 * every one of these seven claims used before PD-155's review: `literal`
 * hardcoded the expected word *inside the anchor regex itself*, so editing
 * `**Nine**` to `**Ten**` in the doc made the anchor stop matching — a SKIP,
 * not a FAIL, because nothing ever read what the doc actually says. Capturing
 * the word and converting it here means the anchor matches ANY word in that
 * position, so a doc edited to a new (wrong) number is read, converted, and
 * compared against measurement like every digit-based claim already is.
 *
 * Throws `ClaimExtractError` — caught by `check.mjs` and turned into a loud
 * SKIP, never a silent one — when the matched word isn't in `NUMBER_WORDS`,
 * which is the one way this can still legitimately fail to read a value.
 */
export function extractWord(index = 1) {
  return (match) => {
    const word = match[index]
    const n = wordToNumber(word)
    if (n === null) {
      throw new ClaimExtractError(`stated value is spelled "${word}", which is not a recognized number word`)
    }
    return n
  }
}

/**
 * The registry. Each claim:
 *   - id: stable name, used in output and by tests
 *   - file: repo-relative path the claim is read from
 *   - pattern: RegExp that must match the surrounding prose exactly once
 *   - extractStated(match): pulls the number the doc asserts, from the match
 *   - kind: which measurement path check.mjs uses to find the truth
 *   - ...kind-specific fields (cmd / hexA+hexB / parseMeasured)
 *   - about: one line, for the report
 */
export const claims = [
  // ---- Runtime dependency count -----------------------------------------
  {
    id: 'deps-count-claude',
    file: 'CLAUDE.md',
    pattern: /\*\*Dependencies are added deliberately\.\*\* \*\*(\w+)\*\* runtime dependencies today/,
    extractStated: extractWord(),
    kind: 'shell',
    cmd: `node -p "Object.keys(require('./package.json').dependencies).length"`,
    about: '§Technology Decisions: "Nine runtime dependencies today"',
  },

  // ---- Migration file count ----------------------------------------------
  {
    id: 'migrations-count-claude',
    file: 'CLAUDE.md',
    // The tail of this pattern pins the DEV/PROD RELATIONSHIP prose, and it is
    // deliberately NOT relaxed to /Applied state: (\d+) files/. The numeric half
    // is the only thing this entry verifies, so pinning the prose is what forces
    // the next session to re-read the sentence when the relationship changes
    // rather than leaving a stale "AGREE" behind a correct count. Relaxing the
    // regex is the obvious repair and it is the wrong one.
    //
    // ** A pattern miss here FAILS, and this comment said "skipped" until
    // 2026-08-11. ** check.mjs was changed on 2026-08-10 to make an unmatched
    // anchor a ClaimLocateError with status 'fail' — see its own comment saying
    // both "read as a skip until 2026-08-10". This entry is kind: 'shell', so it
    // is in CHEAP_KINDS and runs under `docs:check --cheap` in CI on every PR
    // that touches code. So the day 051 lands on DEV alone — the ordinary state
    // of a migration between its merge and its promotion — this claim goes RED
    // on every unrelated PR until someone edits the prose and this pattern
    // together. That is the tripwire working, but budget for it: the fix is two
    // edits in one commit, never a relaxed regex.
    //
    // The flip-by-flip history of this pin lives in `git log -p` and is not
    // recopied here; it grew a paragraph every time PROD caught up.
    // 2026-08-12: 051 and 052 landed on DEV alone, which is the exact case the
    // paragraph above predicted. Prose and pattern edited together, as it says.
    // Later the same day PD-201 applied 051-054 to PROD and this went red on cue
    // — the mechanism working, not failing. 2026-08-13: 056 was DEV-only for a
    // few hours and this was pinned to DEV AHEAD; applying 056 to PROD ahead of
    // the promotion turned it red on cue, and it is pinned back to LEVEL. The
    // pin is on the RELATIONSHIP in both directions; do not relax it to the
    // count just because the two projects agree today.
    pattern: /\*\*Applied state: (\d+) files\. DEV is at `\d+`, PROD at `\d+` — LEVEL/,
    extractStated: (m) => Number(m[1]),
    kind: 'shell',
    cmd: `ls supabase/migrations/*.sql | wc -l`,
    about: '§Supabase Rules: "Applied state: N files" + the DEV/PROD relationship',
  },
  {
    id: 'migrations-count-handoff',
    file: 'docs/HANDOFF.md',
    pattern: /ls supabase\/migrations\/ \| wc -l\s+# (\d+)/,
    extractStated: (m) => Number(m[1]),
    kind: 'shell',
    cmd: `ls supabase/migrations/*.sql | wc -l`,
    about: 'DEV/PROD agreement section, the verification one-liner',
  },

  // ---- lucide-react retirement (comment trap, both directions) -----------
  {
    id: 'lucide-importers-filtered',
    file: 'docs/reference/design-system.md',
    pattern: /the importer count is\s+`grep -rl "from 'lucide-react'" src\/ \| grep -v generated \| wc -l` and it is \*\*(\d+)\*\*/,
    extractStated: (m) => Number(m[1]),
    kind: 'shell',
    cmd: `grep -rl "from 'lucide-react'" src/ | grep -v generated | wc -l`,
    about: 'docs/reference/design-system.md §Icons: the real importer count (must be 0)',
  },
  {
    id: 'lucide-raw-comment-mentions',
    file: 'docs/reference/design-system.md',
    pattern: /The (\w+) matches\s+`grep -rn lucide-react src\/` still returns are prose inside comments/,
    extractStated: extractWord(),
    kind: 'shell',
    cmd: `grep -rn lucide-react src/ | wc -l`,
    about: 'docs/reference/design-system.md §Icons: raw (unfiltered) grep — expected all-comments',
  },

  // ---- supabase.from() retirement (comment trap, both directions) --------
  {
    id: 'supabase-from-raw',
    file: 'CLAUDE.md',
    pattern: /Keep the second half of the pipe; the bare grep\s+prints (\d+), all comments/,
    extractStated: (m) => Number(m[1]),
    kind: 'shell',
    cmd: `grep -rn "supabase\\.from(" src/app/ src/components/ | wc -l`,
    about: '§Technology Decisions: raw supabase.from() mentions in app/components',
  },
  {
    id: 'supabase-from-filtered',
    file: 'CLAUDE.md',
    pattern: /(\w+) client-side `supabase\.from\(\)` writes, and the dependency uninstalled/,
    extractStated: extractWord(),
    kind: 'shell',
    cmd: `grep -rn "supabase\\.from(" src/app/ src/components/ | grep -vE ':[0-9]+:\\s*(\\*|//|/\\*)' | wc -l`,
    about: 'Decision #4: filtered supabase.from() writes (must be 0)',
  },

  // ---- text-white retirement -----------------------------------------------
  {
    id: 'text-white-filtered',
    file: 'CLAUDE.md',
    pattern: /(\w+) `text-white` in `src\/app\/`, zero `lucide-react` importers/,
    extractStated: extractWord(),
    kind: 'shell',
    cmd: `grep -rn "text-white" src/app/ | grep -vE ':[0-9]+:\\s*(\\*|//|/\\*)' | wc -l`,
    about: 'Decision #4: filtered text-white occurrences in src/app/ (must be 0)',
  },

  // ---- Server-rendered page count -----------------------------------------
  {
    id: 'server-rendered-pages-claude',
    file: 'CLAUDE.md',
    pattern: /git grep -L "\^'use client'" -- 'src\/app\/\*\*\/page\.tsx' \| wc -l\s+# \.\.\. server-rendered: (\d+)/,
    extractStated: (m) => Number(m[1]),
    kind: 'shell',
    cmd: `git grep -L "^'use client'" -- 'src/app/**/page.tsx' | wc -l`,
    about: '§Technology Decisions: server-rendered page count via the ^-anchored grep',
  },
  {
    id: 'server-rendered-pages-handoff',
    file: 'docs/HANDOFF.md',
    pattern: /git grep -L "\^'use client'" -- 'src\/app\/\*\*\/page\.tsx' {3}# (\w+) server pages — prints nothing/,
    extractStated: extractWord(),
    kind: 'shell',
    cmd: `git grep -L "^'use client'" -- 'src/app/**/page.tsx' | wc -l`,
    about: 'Client-render migration section: "zero server pages — prints nothing"',
  },

  // ---- Nav item count ------------------------------------------------------
  {
    id: 'nav-items-scoped-claude',
    file: 'docs/reference/product-scope.md',
    pattern: /The built app covers a fraction of the design\. \*\*(\w+) nav tabs — Home, Rides, Clubs,/,
    extractStated: extractWord(),
    kind: 'shell',
    cmd: `sed -n '/const navItems/,/] as const/p' src/components/layout/Navbar.tsx | grep -c "href:"`,
    about: 'docs/reference/product-scope.md: "Four nav tabs" — the scoped grep on navItems',
  },
  {
    id: 'nav-items-scoped-handoff',
    file: 'docs/HANDOFF.md',
    pattern: /`Navbar\.tsx` draws (\w+) tabs and the `UNBUILT` machinery is deleted/,
    extractStated: extractWord(),
    kind: 'shell',
    cmd: `sed -n '/const navItems/,/] as const/p' src/components/layout/Navbar.tsx | grep -c "href:"`,
    about: 'Store readiness table, row 3: Navbar scoped grep',
  },
  {
    id: 'nav-items-raw-claude',
    file: 'docs/reference/product-scope.md',
    pattern: /A bare `grep -c "href:"` on that file reads \*\*(\d+)\*\*: the four/,
    extractStated: (m) => Number(m[1]),
    kind: 'shell',
    cmd: `grep -c "href:" src/components/layout/Navbar.tsx`,
    about: 'docs/reference/product-scope.md: the trap — unscoped grep -c "href:" on Navbar.tsx',
  },

  // ---- Icon count (prose vs the generator's committed source) --------------
  //
  // The one piece of the 2026-08-16 generated-artifact alarms that IS a doc
  // claim, and it belongs here rather than in the tests that landed with it.
  // Those two —
  // `scripts/figma/__tests__/generated-artifacts.test.mjs` and
  // `src/__tests__/openspec-artifacts.test.ts` — compare an ARTIFACT against
  // its GENERATOR, which is not this registry's shape (no prose anchor, no
  // single integer). This sentence is prose stating a number with one
  // unambiguous ground truth, which is exactly this registry's shape.
  //
  // Measured against `design/icons/`, not against
  // `src/components/icons/generated.tsx`: the SVG export is the SOURCE, the
  // module is downstream of it, and the byte-identical rebuild in
  // generated-artifacts.test.mjs already ties the two together. Pointing this
  // claim at the module instead would check the doc against something the doc
  // does not describe — it says "exported", and what is exported is the SVGs.
  {
    id: 'icons-exported-design-system',
    file: 'docs/reference/design-system.md',
    pattern: /\*\*Icons: (\d+) exported\*\*, under `Element \/ Icon \/ \*`/,
    extractStated: (m) => Number(m[1]),
    kind: 'shell',
    cmd: `ls design/icons/*.svg | wc -l`,
    about: 'docs/reference/design-system.md §Icons: "Icons: 53 exported" vs design/icons/',
  },

  // ---- RLS assertion count (needs Postgres — see check.mjs's gate) -------
  {
    id: 'rls-count-claude',
    file: 'CLAUDE.md',
    pattern: /Suite \*\*(\d+)\*\* assertions — re-derive rather than trust it/,
    extractStated: (m) => Number(m[1]),
    kind: 'rls',
    about: '§Supabase Rules: "Suite N assertions"',
  },
  {
    id: 'rls-count-handoff-inline',
    file: 'docs/HANDOFF.md',
    pattern: /PGPASSWORD=postgres npm test\s+# (\d+) assertions, 0 failures/,
    extractStated: (m) => Number(m[1]),
    kind: 'rls',
    about: 'Hand-gate block: "N assertions, 0 failures"',
  },
  {
    id: 'rls-count-handoff-table',
    file: 'docs/HANDOFF.md',
    pattern: /`PGPASSWORD=postgres npm test 2>&1 \\\| grep -c "NOTICE: {2}ok"` — \*\*(\d+)\*\*, measured/,
    extractStated: (m) => Number(m[1]),
    kind: 'rls',
    about: '§Running things table, "Assertion count" row',
  },

  // ---- Unit test count + file count (two locations each) -----------------
  {
    id: 'unit-tests-count-inline',
    file: 'docs/HANDOFF.md',
    pattern: /npm run test:unit\s+# (\d+)\/\d+ across (\d+) files/,
    extractStated: (m) => Number(m[1]),
    kind: 'vitest',
    parseMeasured: parseVitestTests,
    about: 'Hand-gate block: "N/N across M files" — test count',
  },
  {
    id: 'unit-tests-files-inline',
    file: 'docs/HANDOFF.md',
    pattern: /npm run test:unit\s+# (\d+)\/\d+ across (\d+) files/,
    extractStated: (m) => Number(m[2]),
    kind: 'vitest',
    parseMeasured: parseVitestFiles,
    about: 'Hand-gate block: "N/N across M files" — file count',
  },
  {
    id: 'unit-tests-count-table',
    file: 'docs/HANDOFF.md',
    pattern: /`npm run test:unit` — \*\*(\d+) across (\d+) files on a clean tree\*\*/,
    extractStated: (m) => Number(m[1]),
    kind: 'vitest',
    parseMeasured: parseVitestTests,
    about: '§Running things table, "Unit tests" row — test count',
  },
  {
    id: 'unit-tests-files-table',
    file: 'docs/HANDOFF.md',
    pattern: /`npm run test:unit` — \*\*(\d+) across (\d+) files on a clean tree\*\*/,
    extractStated: (m) => Number(m[2]),
    kind: 'vitest',
    parseMeasured: parseVitestFiles,
    about: '§Running things table, "Unit tests" row — file count',
  },

  // ---- next build route counts --------------------------------------------
  {
    // `●` as well as `ƒ`, because PD-142 left `ƒ` alone measuring the wrong
    // thing. There is no dynamic segment in the app any more, so `ƒ` is 0 —
    // and it would still be 0 if a resurrected `[id]` segment declared a
    // `generateStaticParams()`, which reclassifies the route to `●` without
    // removing the segment. The quantity the native epic needs is "routes
    // `output: 'export'` refuses to emit a document for", and only the pair
    // measures it.
    id: 'dynamic-routes-count',
    file: 'docs/HANDOFF.md',
    pattern: /grep -cE '\^\[┌├└│ \]\*\[ƒ●\] \/'\s+# routes the export cannot emit — (\d+)/,
    extractStated: (m) => Number(m[1]),
    kind: 'build',
    parseMeasured: (stdout) => countLines(stdout, /^[┌├└│ ]*[ƒ●] \//m),
    about: '§Technology Decisions verification block: unexportable route count',
  },
  {
    id: 'static-routes-count',
    file: 'docs/HANDOFF.md',
    pattern: /`next build` reports\s+\*\*(\d+) static\*\* and \*\*\d+ dynamic\*\*/,
    extractStated: (m) => Number(m[1]),
    kind: 'build',
    parseMeasured: (stdout) => countLines(stdout, /^[┌├└│ ]*○ \//m),
    about: 'Native shell section: "next build reports N static and M dynamic"',
  },
  {
    // The paragraph right below `static-routes-count` warns against confusing
    // the two numbers — "Generating static pages (N/N)" counts something
    // other than routes (it includes non-route build output Next also
    // prerenders). Both halves of that warning are themselves numbers, so
    // both are worth checking: this is the one review found stale
    // (21/21 against a real 23/23) that `static-routes-count` cannot see,
    // because its anchor stops at the headline sentence above.
    id: 'generating-static-pages-total',
    file: 'docs/HANDOFF.md',
    pattern: /`Generating static pages \((\d+)\/\d+\)` line as the static route count/,
    extractStated: (m) => Number(m[1]),
    kind: 'build',
    parseMeasured: parseGeneratingStaticPagesTotal,
    about: 'Native shell section: the "Generating static pages (N/N)" near-miss warning',
  },

  // ---- Contrast ratios (pure arithmetic — see contrastRatio above) -------
  {
    id: 'contrast-maybe-pill',
    file: '.claude/agents/design-system.md',
    pattern: /the Maybe pill at (\d+\.\d+):1/,
    extractStated: (m) => Number(m[1]),
    kind: 'contrast',
    hexA: '#E58F17',
    hexB: '#FFFFFF',
    about: 'Design System §Accessibility floor: Maybe pill (amber) on White/100',
  },
  {
    id: 'contrast-going-pill',
    file: '.claude/agents/design-system.md',
    pattern: /`Accent Brand\/100` with white at (\d+\.\d+):1/,
    extractStated: (m) => Number(m[1]),
    kind: 'contrast',
    hexA: '#3D996B',
    hexB: '#FFFFFF',
    about: 'Design System §Accessibility floor: Going pill (green) on White/100',
  },
  {
    id: 'contrast-ride-host-label',
    file: '.claude/agents/design-system.md',
    pattern: /the ride-host label\s+at (\d+\.\d+):1/,
    extractStated: (m) => Number(m[1]),
    kind: 'contrast',
    hexA: '#F2ECE6', // Grey/5
    hexB: '#338059', // Accent Brand/110
    about: 'Design System §Accessibility floor: "Ride host" label, Grey/5 on Accent Brand/110',
  },
  {
    id: 'contrast-rsvp-label',
    file: '.claude/agents/design-system.md',
    pattern: /the unselected RSVP label at (\d+\.\d+):1/,
    extractStated: (m) => Number(m[1]),
    kind: 'contrast',
    hexA: '#E5DACF', // Grey/10
    hexB: '#666666', // Grey/80
    about: 'Design System §Accessibility floor: unselected RSVP label, Grey/10 on Grey/80',
  },
  {
    id: 'contrast-notification-dot',
    file: 'docs/FIGMA-FIDELITY-TODO.md',
    pattern: /`#D92140` on\s+`#F2ECE6` is \*\*(\d+\.\d+):1\*\*/,
    extractStated: (m) => Number(m[1]),
    kind: 'contrast',
    hexA: '#D92140', // Warning/100
    hexB: '#F2ECE6', // Grey/5
    about: 'FIGMA-FIDELITY-TODO §Notifications: NotificationDot, Warning/100 on Grey/5',
  },

  // ---- Route guard case count (two locations) ------------------------------
  //
  // The measurement runs vitest on the one file rather than counting `it(`
  // lines, and that is not fastidiousness: `guard.test.ts` uses `it.each`, so
  // the literal call count is 26 and the real case count is 36. A `grep -c`
  // here would have "verified" the docs against a number ten short and read
  // as measured — the static-count version of the comment trap.
  //
  // The `&&` gates the parse on a clean exit. A failing run still prints
  // `Tests  30 passed | 6 failed`, and grepping that yields a confident 30
  // that FAILs the claim, pointing at the docs when the fault is a broken
  // test. No output at all is a SKIP, which is the honest outcome: the case
  // count could not be measured. `npm run test:unit` is CI's gate for the
  // suite being green, not this.
  {
    id: 'guard-cases-claude',
    file: 'CLAUDE.md',
    pattern: /`null` means stay; a string is where to go\. (\d+) cases in `__tests__\/guard\.test\.ts`/,
    extractStated: (m) => Number(m[1]),
    kind: 'vitest-file',
    cmd: `out=$(./node_modules/.bin/vitest run src/lib/auth/__tests__/guard.test.ts 2>&1); rc=$?; if [ $rc -ne 0 ]; then echo "$out" | tail -5 >&2; exit $rc; fi; echo "$out" | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+'`,
    // These two claims share one vitest process (check.mjs caches by cmd), and
    // it is the only real process any cheap claim spawns. 1s warm here, but a
    // cold two-core CI runner with no vite transform cache is plausibly 25s,
    // and runShell's 60s default was picked for greps. Under --cheap a
    // timeout is a red build rather than a green skip, so the ceiling has to
    // clear the slow case by a wide margin instead of by a little.
    //
    // Two things about the command's shape, both learned from a red CI run
    // that was green locally. It calls ./node_modules/.bin/vitest rather than
    // `npx vitest`: npx failed on the runner in under a second while the same
    // line worked here, and the local bin needs no resolution step at all.
    // And it re-emits the captured output on a non-zero exit instead of
    // relying on `&&`, because `2>&1` INSIDE a command substitution swallows
    // the diagnostic — the first version reported `command failed: no output`
    // for what was really a resolution error, which is unactionable from a CI
    // log and cost a round trip to diagnose.
    timeoutMs: 180_000,
    about: '§Critical: the route guard — "36 cases in __tests__/guard.test.ts"',
  },
  {
    id: 'guard-cases-claude-table',
    file: 'CLAUDE.md',
    pattern: /`src\/lib\/auth\/guard\.ts` \((\d+) cases, replacing the untestable/,
    extractStated: (m) => Number(m[1]),
    kind: 'vitest-file',
    cmd: `out=$(./node_modules/.bin/vitest run src/lib/auth/__tests__/guard.test.ts 2>&1); rc=$?; if [ $rc -ne 0 ]; then echo "$out" | tail -5 >&2; exit $rc; fi; echo "$out" | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+'`,
    // Same ceiling as the claim above, which shares this command.
    timeoutMs: 180_000,
    about: '§Technology Decisions, Tests table: the same count, restated in the Units row',
  },

  // ---- Guard-cache invalidators --------------------------------------------
  //
  // CLAUDE.md: "Miss one and the rider finishes a step and is sent straight
  // back into it." The failure mode is a FIFTH writer added without the call,
  // which this cannot see — it counts calls, not writers. What it does catch
  // is the opposite and commoner drift: a call deleted in a refactor while
  // the prose still says four.
  //
  // Three filters, each load-bearing. `__tests__` because guard-cache's own
  // tests call it four more times; the comment filter because this file's
  // header explains why a doc comment naming the function must not count
  // (guard-cache.ts has two, and they survive today only by lacking the
  // parens); and the definition line, because
  // `export function invalidateOnboardingState(): void` contains
  // `invalidateOnboardingState()` as a substring of its own signature.
  //
  // That last filter names the whole declaration, NOT a bare `export
  // function`. The bare version was written first and passed its own
  // both-ways check — until the check was run with a call site added on a
  // one-line exported wrapper, which it silently swallowed. A filter that
  // drops a real call whenever it shares a line with any export is a check
  // that reads 4 for ever.
  {
    id: 'guard-cache-invalidators',
    file: 'CLAUDE.md',
    pattern: /\*\*Any new writer of a stamp the decision reads must invalidate the cache\.\*\* There are (\w+)/,
    extractStated: extractWord(),
    kind: 'shell',
    cmd: `grep -rn "invalidateOnboardingState()" src/ --include=*.ts | grep -v __tests__ | grep -vE ':[0-9]+:\\s*(\\*|//|/\\*)' | grep -v "export function invalidateOnboardingState" | wc -l`,
    about: '§Critical: the route guard — the four writers that invalidate the onboarding cache',
  },

  // ---- Hardcoded origin (must stay 0) --------------------------------------
  //
  // The claim exists because the domain move (2026-08-07) needs NO code
  // change: ShareButton, signUp and requestPasswordReset all build their URLs
  // from an origin resolved at runtime. A hardcoded origin would surface only
  // in an email a rider receives, which no other gate in this repo reads.
  {
    id: 'hardcoded-origin-src',
    file: 'CLAUDE.md',
    // The anchor wildcards the middle of the grep deliberately. The sentence
    // quotes a shell command containing `\|` and `\.`, so pinning it
    // character-for-character needs a regex whose every escape is itself
    // escaped — the one shape in this file most likely to be "corrected" into
    // silently matching nothing. Both ends are pinned and the pair is unique.
    pattern: /`grep -rn "letsrideapp.+localhost:3000" src\/` is (\d+), and/,
    extractStated: (m) => Number(m[1]),
    kind: 'shell',
    cmd: `grep -rn "letsrideapp\\|vercel\\.app\\|localhost:3000" src/ | wc -l`,
    about: '§Branching & CI: no hardcoded origin anywhere in src/ (must be 0)',
  },

  // ---- The runtime origin has exactly one reader (must stay 1) -------------
  //
  // The claim above cannot do this one's job, and PD-188 exists because the
  // two were conflated: a URL built from `window.location.origin` carries no
  // hostname to grep for, so the hardcoded-origin check reads a clean 0 while
  // every emailed link from the native bundle points at `https://localhost`.
  // What is countable is the *reader*: `canonicalOrigin()` in
  // `src/lib/origin.ts` is the only code in `src/` that touches it, and a new
  // one is how a URL that leaves the app quietly goes back to the webview's
  // origin.
  //
  // Comment lines are excluded, and this claim is why: `origin.ts`'s own doc
  // block explains what the app moved away from, so the unfiltered count reads
  // 2 against a real 1 — CLAUDE.md's comment trap, in the file that closed it.
  // (Measured 2026-08-12: 3 raw hits, in `origin.ts` ×2 and
  // `origin-normalise.ts` ×1 — two doc blocks and the one real read. Do not
  // restate that split; it moves whenever a comment is reworded, and this
  // sentence has already been wrong twice by trying. The three call sites name
  // `canonicalOrigin()` and do not match.) No unfiltered companion entry: the raw
  // count moves with every comment reworded, which would make the claim a
  // maintenance tax rather than a check.
  {
    id: 'runtime-origin-readers',
    file: 'CLAUDE.md',
    pattern: /is 1 — the definition inside `canonicalOrigin\(\)`, nowhere else\./,
    extractStated: () => 1,
    kind: 'shell',
    cmd: `grep -rn "window.location.origin" src/ --include=*.ts --include=*.tsx | grep -vE ':[0-9]+:\\s*(\\*|//|/\\*)' | wc -l`,
    about: '§Branching & CI: only canonicalOrigin() reads window.location.origin',
  },

  // ---- hard_deny entry count -----------------------------------------------
  //
  // `reviewer.md` calls a diff touching this "the most serious thing in this
  // brief". This claim is the only automated thing that reads
  // `.claude/settings.json` at all, which is why `ci.yml`'s `changes` job has
  // a carve-out putting a settings-only PR through the app job — without it
  // the claim would be re-evaluated on somebody else's unrelated PR. Note the
  // narrowness: what CI checks there is this cardinality, never the
  // permission semantics. For those, the review pass is still the whole gate.
  //
  // `$defaults` is filtered out because it is the harness's own placeholder,
  // not an authored rule: a bare `| length` reads 2 against a correct file,
  // so the check would fail on day one and get "fixed" by editing the doc to
  // a number that no longer means what the sentence says. The measurement is
  // rules-this-repo-wrote, which is what "has one entry" is counting.
  //
  // Two failure shapes, and it took two review passes to keep both. Counting
  // alone is satisfied by ONE entry rather than by the RIGHT one, so swapping
  // the rule's text for anything at all kept the check green. Filtering to
  // entries that name service-role and counting THOSE fixes the swap and
  // breaks the other direction: a second, unrelated rule appended to the list
  // no longer moves the number, so the doc goes on asserting "one entry"
  // while the deny surface has two, and a reviewer reads it and under-counts.
  //
  // So: count the authored entries, and collapse to 0 when none of them names
  // the rule. An addition reads 2, a swap reads 0, a deletion reads 0
  // honestly, and only the correct file reads 1.
  //
  // 0 rather than -1 as the sentinel because `parseCountOutput` is
  // digits-only on purpose — a negative would land as an unparseable SKIP
  // instead of a FAIL, which is a weaker signal wearing a confusing message.
  // 0 is safe here for a reason specific to this claim: the prose asserts a
  // cardinality of one, so zero can never be its correct value, and the one
  // state that legitimately measures 0 (the entry deleted outright) is
  // exactly the state that should fail.
  //
  // It pins the subject, never the wording: a reworded rule that still says
  // service-role passes, which is the intended latitude.
  {
    id: 'hard-deny-entries',
    file: '.claude/agents/reviewer.md',
    pattern: /\*\*`hard_deny` has (\w+) entry\*\*/,
    extractStated: extractWord(),
    kind: 'shell',
    cmd: `jq '[.permissions.autoMode.hard_deny[] | select(. != "$defaults")] as $e | if ($e | map(select(test("service-role"))) | length) == 0 then 0 else ($e | length) end' .claude/settings.json`,
    about: 'reviewer.md §never-skipped four: hard_deny\'s one entry, and that it still names the service-role rule',
  },
]

// ---- Shared measured-value parsers (exported so tests can pin them) -------

/** `vitest run`'s summary line: " Tests  839 passed (839)". */
export function parseVitestTests(output) {
  const m = output.match(/Tests\s+(\d+)\s+passed/)
  return m ? Number(m[1]) : null
}

/** `vitest run`'s summary line: " Test Files  35 passed (35)". */
export function parseVitestFiles(output) {
  const m = output.match(/Test Files\s+(\d+)\s+passed/)
  return m ? Number(m[1]) : null
}

/** Counts lines matching `pattern` (no /g needed — this adds it). */
export function countLines(output, pattern) {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
  return [...output.matchAll(re)].length
}

/**
 * `next build`'s progress line prints `(0/23) ... (5/23) ... (23/23)` — the
 * total is only trustworthy once the two halves match (the completion line),
 * so this deliberately does not just grab the first or last `(a/b)` it sees.
 */
export function parseGeneratingStaticPagesTotal(output) {
  const complete = [...output.matchAll(/\((\d+)\/(\d+)\)/g)].find((m) => m[1] === m[2])
  return complete ? Number(complete[2]) : null
}
