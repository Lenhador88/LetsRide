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
 * sentence is reported as a loud SKIP — see `check.mjs`'s exit-code contract
 * — rather than silently checking nothing), and how to pull the stated
 * number out of what it matches.
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
    // The tail of this pattern tracks the DEV/PROD RELATIONSHIP, which changed
    // on 2026-08-09 when 041 was applied to DEV alone. It is deliberately NOT
    // relaxed to /Applied state: (\d+) files/: the numeric half is the only
    // thing this entry verifies, so pinning the prose is what forces the next
    // session to re-read the sentence when the relationship changes again
    // (i.e. when PROD catches up) rather than leaving a stale "AGREE" behind a
    // correct count. A pattern miss here is the check working, not breaking.
    pattern: /\*\*Applied state: (\d+) files, and DEV is ONE AHEAD of PROD/,
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
    file: 'CLAUDE.md',
    pattern: /the importer count is\s+`grep -rl "from 'lucide-react'" src\/ \| grep -v generated \| wc -l` and it is \*\*(\d+)\*\*/,
    extractStated: (m) => Number(m[1]),
    kind: 'shell',
    cmd: `grep -rl "from 'lucide-react'" src/ | grep -v generated | wc -l`,
    about: 'Design System §Icons: the real importer count (must be 0)',
  },
  {
    id: 'lucide-raw-comment-mentions',
    file: 'CLAUDE.md',
    pattern: /The (\w+) matches\s+`grep -rn lucide-react src\/` still returns are prose inside comments/,
    extractStated: extractWord(),
    kind: 'shell',
    cmd: `grep -rn lucide-react src/ | wc -l`,
    about: 'Design System §Icons: raw (unfiltered) grep — expected all-comments',
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
    file: 'CLAUDE.md',
    pattern: /The built app covers a fraction of the design\. \*\*(\w+) nav tabs — Home, Rides, Clubs,/,
    extractStated: extractWord(),
    kind: 'shell',
    cmd: `sed -n '/const navItems/,/] as const/p' src/components/layout/Navbar.tsx | grep -c "href:"`,
    about: '§Product Scope: "Four nav tabs" — the scoped grep on navItems',
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
    file: 'CLAUDE.md',
    pattern: /A bare `grep -c "href:"` on that file reads \*\*(\d+)\*\*: the four/,
    extractStated: (m) => Number(m[1]),
    kind: 'shell',
    cmd: `grep -c "href:" src/components/layout/Navbar.tsx`,
    about: '§Product Scope: the trap — unscoped grep -c "href:" on Navbar.tsx',
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
    id: 'dynamic-routes-count',
    file: 'docs/HANDOFF.md',
    pattern: /grep -cE '\^\[┌├└│ \]\*ƒ \/'\s+# dynamic routes — (\d+)/,
    extractStated: (m) => Number(m[1]),
    kind: 'build',
    parseMeasured: (stdout) => countLines(stdout, /^[┌├└│ ]*ƒ \//m),
    about: '§Technology Decisions verification block: dynamic route count',
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
