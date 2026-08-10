import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import {
  claims,
  findOnce,
  ClaimLocateError,
  ClaimExtractError,
  contrastRatio,
  roundTo,
  countLines,
  parseVitestTests,
  parseVitestFiles,
  parseGeneratingStaticPagesTotal,
  wordToNumber,
  extractWord,
} from '../registry.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('findOnce', () => {
  it('returns the single match when the pattern occurs exactly once', () => {
    const m = findOnce('the count is 42 today', /count is (\d+)/)
    expect(m[1]).toBe('42')
  })

  it('throws ClaimLocateError when the pattern is not found', () => {
    // This is the case that matters most: a doc edit that reworded or
    // deleted the sentence must make the claim unverifiable, not silently
    // pass by matching nothing.
    expect(() => findOnce('nothing relevant here', /count is (\d+)/)).toThrow(ClaimLocateError)
  })

  it('throws ClaimLocateError when the pattern matches more than once', () => {
    // An ambiguous anchor is exactly the shape PD-155 warns a prose linter
    // would produce — this is what stops a registry entry from silently
    // reading whichever occurrence comes first.
    expect(() => findOnce('count is 1 and count is 2', /count is (\d+)/)).toThrow(ClaimLocateError)
  })

  it('adds the /g flag internally without requiring the caller to', () => {
    // matchAll requires a global regex; callers write claims without one
    // (a claim's pattern reads naturally without /g), so this is the seam
    // that would silently break every claim in the registry if it regressed.
    expect(() => findOnce('x 1 x', /x (\d+) x/)).not.toThrow()
  })
})

describe('contrastRatio', () => {
  it('is 21:1 for black on white — the WCAG maximum', () => {
    expect(roundTo(contrastRatio('#000000', '#FFFFFF'), 2)).toBe(21)
  })

  it('is 1:1 for a colour against itself', () => {
    expect(roundTo(contrastRatio('#3D996B', '#3D996B'), 2)).toBe(1)
  })

  it('is order-independent — contrast has no "foreground" or "background"', () => {
    expect(contrastRatio('#D92140', '#F2ECE6')).toBeCloseTo(contrastRatio('#F2ECE6', '#D92140'), 10)
  })

  // Pins every pair the registry's contrast claims use, so a regression in
  // the WCAG formula itself is caught here rather than only showing up as a
  // mysterious disagreement in `docs:check`'s own output.
  it.each([
    ['#E58F17', '#FFFFFF', 2.54], // Maybe pill
    ['#3D996B', '#FFFFFF', 3.52], // Going pill
    ['#F2ECE6', '#338059', 4.1], // ride-host label
    ['#E5DACF', '#666666', 4.17], // unselected RSVP label
    ['#D92140', '#F2ECE6', 4.22], // NotificationDot
  ])('%s on %s is %s:1', (a, b, expected) => {
    expect(roundTo(contrastRatio(a, b), 2)).toBe(expected)
  })

  it('goes red when a claimed ratio is wrong — PR #35 shipped exactly this', () => {
    // The documented incident: an earlier revision of the amber RSVP pill's
    // contrast claimed 3.0:1. The real number is 2.54:1. A checker that
    // cannot tell those two apart is decorative.
    const claimed = 3.0
    const measured = roundTo(contrastRatio('#E58F17', '#FFFFFF'), 2)
    expect(measured).not.toBe(claimed)
  })
})

describe('roundTo', () => {
  it('rounds to the given number of decimal places', () => {
    expect(roundTo(4.104999, 2)).toBe(4.1)
    expect(roundTo(4.105001, 2)).toBe(4.11)
  })

  it('is not fooled by binary floating-point representation', () => {
    // The classic trap: 1.005 rounds down with naive `Math.round(n*100)/100`
    // because 1.005 is actually stored as 1.00499999...
    expect(roundTo(1.005, 2)).toBe(1.01)
  })
})

describe('countLines', () => {
  it('counts every matching line, not just whether one exists', () => {
    const out = 'NOTICE: ok one\nNOTICE: ok two\nsomething else\nNOTICE: ok three'
    expect(countLines(out, /NOTICE: ok/)).toBe(3)
  })

  it('is 0 when nothing matches, not an error', () => {
    expect(countLines('nothing here', /NOTICE: ok/)).toBe(0)
  })

  it('adds /g without requiring the caller to supply it', () => {
    expect(countLines('a a a', /a/)).toBe(3)
  })
})

describe('parseVitestTests / parseVitestFiles', () => {
  const summary = [
    ' RUN  v4.1.10 /home/user/LetsRide',
    '',
    ' Test Files  35 passed (35)',
    '      Tests  839 passed (839)',
    '   Start at  00:24:26',
  ].join('\n')

  it('reads the test count from a real vitest summary', () => {
    expect(parseVitestTests(summary)).toBe(839)
  })

  it('reads the file count from a real vitest summary', () => {
    expect(parseVitestFiles(summary)).toBe(35)
  })

  it('returns null rather than a wrong number when the summary is absent', () => {
    // A build failure or a crashed test run must SKIP, not report "0 tests" —
    // that would look like every doc claiming a positive count is wrong.
    expect(parseVitestTests('some unrelated crash output')).toBeNull()
    expect(parseVitestFiles('some unrelated crash output')).toBeNull()
  })

  it('goes red when the count in the summary changes', () => {
    // The concrete case this repo has already hit: a new file under
    // SCANNED_DIRS nudges the test count without changing the file count.
    const mutated = summary.replace('839 passed (839)', '841 passed (841)')
    expect(parseVitestTests(mutated)).not.toBe(parseVitestTests(summary))
    expect(parseVitestFiles(mutated)).toBe(parseVitestFiles(summary)) // files unaffected
  })
})

describe('parseGeneratingStaticPagesTotal', () => {
  const progress = [
    '  Generating static pages using 3 workers (0/23) ...',
    '  Generating static pages using 3 workers (5/23) ',
    '  Generating static pages using 3 workers (11/23) ',
    '  Generating static pages using 3 workers (17/23) ',
    '✓ Generating static pages using 3 workers (23/23) in 645ms',
  ].join('\n')

  it('reads the total from the completion line, not an in-progress one', () => {
    // The trap this exists to avoid: naively grabbing the FIRST "(a/b)" match
    // would read (0/23) as the total, and the LAST captured group of the
    // first match would read 0 rather than 23.
    expect(parseGeneratingStaticPagesTotal(progress)).toBe(23)
  })

  it('is null when no line has matching numerator and denominator', () => {
    expect(parseGeneratingStaticPagesTotal('Generating static pages using 3 workers (5/23)')).toBeNull()
  })

  it('goes red when the real total changes — this is what PD-155 review caught', () => {
    // docs/HANDOFF.md said 21/21 against a real 23/23. This is the parser
    // that would have caught it, had the claim existed at the time.
    const mutated = progress.replace('(23/23)', '(21/21)')
    expect(parseGeneratingStaticPagesTotal(mutated)).toBe(21)
    expect(parseGeneratingStaticPagesTotal(mutated)).not.toBe(parseGeneratingStaticPagesTotal(progress))
  })
})

describe('wordToNumber', () => {
  it.each([
    ['zero', 0],
    ['Nine', 9],
    ['FOUR', 4],
    ['ten', 10],
  ])('reads %s as %d, case-insensitively', (word, expected) => {
    expect(wordToNumber(word)).toBe(expected)
  })

  it('is null for a word it does not recognize', () => {
    expect(wordToNumber('dozen')).toBeNull()
    expect(wordToNumber('Ten9')).toBeNull()
  })

  it.each([
    ['9', 9],
    ['10', 10],
    ['0', 0],
    ['123', 123],
  ])('also reads a bare numeral %s as %d', (numeral, expected) => {
    // PD-155's second review: every one of these claims' anchors captures
    // `\w+`, which already matches digits — so editing `**Nine**` to `**10**`
    // (the single most likely real edit: an author "fixing" a word to a
    // digit) reached this function with the numeral as the word. Without
    // this branch that read as unrecognized and produced a SKIP, not a FAIL.
    expect(wordToNumber(numeral)).toBe(expected)
  })
})

describe('extractWord', () => {
  it('reads the captured word as a number', () => {
    const m = /count is (\w+)/.exec('the count is nine today')
    expect(extractWord()(m)).toBe(9)
  })

  it('reads a non-default capture group index', () => {
    const m = /(\w+) is (\w+)/.exec('nine is nine')
    expect(extractWord(2)(m)).toBe(9)
  })

  it('throws ClaimExtractError — a loud skip, not a silent one — for an unrecognized word', () => {
    // This is PD-155 review's own escape hatch: "if any genuinely cannot [be
    // read], say which and why, and make the skip loud rather than silent."
    // A doc edited to a word this table doesn't know (a typo, "a dozen")
    // must not crash the whole run and must not silently read as 0.
    const m = /count is (\w+)/.exec('the count is eleventy today')
    expect(() => extractWord()(m)).toThrow(ClaimExtractError)
    expect(() => extractWord()(m)).toThrow(/eleventy/)
  })

  it('goes red when the doc is edited to a new (wrong) word — the actual PD-155 defect', () => {
    // Before this fix, every one of these seven claims embedded its expected
    // word literally IN the anchor regex and returned a hardcoded value —
    // so editing `**Nine**` to `**Twelve**` made the anchor stop matching
    // (a SKIP) rather than reading 12 and disagreeing with a measurement (a
    // FAIL). This proves the new shape actually reads the edited word.
    const claim = claims.find((c) => c.id === 'deps-count-claude')
    const real = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8')

    const correctStated = claim.extractStated(findOnce(real, claim.pattern))
    const mutated = real.replace('**Nine** runtime dependencies today', '**Twelve** runtime dependencies today')
    expect(mutated).not.toBe(real)

    // The anchor still locates — this is the fix. Before it, this line threw.
    const mutatedMatch = findOnce(mutated, claim.pattern)
    const mutatedStated = claim.extractStated(mutatedMatch)

    expect(mutatedStated).toBe(12)
    expect(mutatedStated).not.toBe(correctStated)
  })

  it('goes red when the doc is edited to a bare numeral — the second-round PD-155 finding', () => {
    // The anchor's `\w+` already matches digits, so this reached
    // `wordToNumber('10')` before the numeral branch existed — and got
    // `null`, a SKIP, not a FAIL. This is the single most likely real edit:
    // an author "fixing" a spelled-out word to a digit.
    const claim = claims.find((c) => c.id === 'deps-count-claude')
    const real = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8')

    const mutated = real.replace('**Nine** runtime dependencies today', '**10** runtime dependencies today')
    const mutatedMatch = findOnce(mutated, claim.pattern) // still locates
    expect(claim.extractStated(mutatedMatch)).toBe(10)
  })
})

describe('the three "must be zero" filtered greps still catch a real violation', () => {
  // A `| wc -l` pipeline always exits 0 and always prints a number, so a
  // broken search path (a typo'd flag, a directory that no longer exists)
  // measures 0 and PASSES for ever — the same silently-forever shape
  // `no-service-role-key.test.ts` already guards its own detector against
  // (`src/__tests__/no-service-role-key.test.ts:177`, "the detector catches
  // a real key in each of its formats"). This is that same guard for the
  // three filtered greps, run for real: not a JS reimplementation of the
  // filter (which could drift from what the command actually does), but the
  // registry's own `claim.cmd` string, pointed at a throwaway fixture
  // directory instead of `src/`.
  let dir
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docs-check-grep-fixture-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function run(cmd) {
    return execFileSync('bash', ['-c', cmd], { encoding: 'utf8' }).trim()
  }

  it('lucide-importers-filtered still catches a real (non-generated) importer', () => {
    const claim = claims.find((c) => c.id === 'lucide-importers-filtered')
    writeFileSync(join(dir, 'Bad.tsx'), "import { Foo } from 'lucide-react'\n")

    const cmd = claim.cmd.replace('src/', `${dir}/`)
    expect(cmd).not.toBe(claim.cmd) // prove the substitution actually landed

    expect(run(cmd)).toBe('1')
  })

  it('supabase-from-filtered still catches a real (uncommented) call', () => {
    const claim = claims.find((c) => c.id === 'supabase-from-filtered')
    mkdirSync(join(dir, 'app'), { recursive: true })
    mkdirSync(join(dir, 'components'), { recursive: true })
    writeFileSync(join(dir, 'app', 'Bad.tsx'), "const x = supabase.from('rides')\n")

    const cmd = claim.cmd.replace('src/app/ src/components/', `${dir}/app/ ${dir}/components/`)
    expect(cmd).not.toBe(claim.cmd)

    expect(run(cmd)).toBe('1')
  })

  it('text-white-filtered still catches a real (uncommented) class', () => {
    const claim = claims.find((c) => c.id === 'text-white-filtered')
    writeFileSync(join(dir, 'Bad.tsx'), '<div className="text-white" />\n')

    const cmd = claim.cmd.replace('src/app/', `${dir}/`)
    expect(cmd).not.toBe(claim.cmd)

    expect(run(cmd)).toBe('1')
  })

  it('and still excludes a commented-out mention — the other half of the filter', () => {
    const claim = claims.find((c) => c.id === 'supabase-from-filtered')
    mkdirSync(join(dir, 'app'), { recursive: true })
    mkdirSync(join(dir, 'components'), { recursive: true })
    writeFileSync(join(dir, 'app', 'Bad.tsx'), "// const x = supabase.from('rides')\n")

    const cmd = claim.cmd.replace('src/app/ src/components/', `${dir}/app/ ${dir}/components/`)
    expect(run(cmd)).toBe('0')
  })
})

describe('the registry against the real repo', () => {
  const fileCache = new Map()
  function content(file) {
    if (!fileCache.has(file)) fileCache.set(file, readFileSync(join(repoRoot, file), 'utf8'))
    return fileCache.get(file)
  }

  it('has at least one claim of every declared kind', () => {
    // A coverage smoke test: if a whole `kind` silently loses its only claim
    // (someone deletes the one contrast entry, say), that is worth noticing.
    const kinds = new Set(claims.map((c) => c.kind))
    expect(kinds).toEqual(new Set(['shell', 'rls', 'vitest', 'build', 'contrast']))
  })

  it.each(claims.map((c) => [c.id, c]))('%s locates its claim in the real file', (_id, claim) => {
    // This is the registry's own regression guard: every claim must still
    // find its anchor text, exactly once, in the file as it exists on disk
    // right now. It does NOT assert the stated value is correct — that is
    // `check.mjs`'s job, against a live measurement — only that the anchor
    // has not silently stopped matching, which is the failure mode
    // `findOnce`'s own tests above exist to make loud rather than silent.
    const match = findOnce(content(claim.file), claim.pattern)
    const stated = claim.extractStated(match)
    expect(typeof stated).toBe('number')
    expect(Number.isNaN(stated)).toBe(false)
  })

  it('every claim id is unique', () => {
    const ids = claims.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('the rating block renders as five skimmable scores', () => {
  // CLAUDE.md §Working Principles: the score goes on its own line, its reason
  // on the next, so a reader can triage on the numbers alone. That only holds
  // if the separator is a PARAGRAPH break — a blank `>` line.
  //
  // This used to be two trailing spaces, a markdown hard break. GitHub honours
  // it; the product owner's client does not, so every block rendered as
  // `**Recommendation** 7/10 a dead column that…` in the one place these files
  // are read most, and nothing noticed because the convention's own guard grep
  // only ever asked whether the two spaces were still THERE. Two invisible
  // characters are also stripped silently by any whitespace-trimming editor.
  //
  // A blank `>` line survives both, and unlike the spaces it is visible in a
  // diff. This is the assertion that keeps it that way.
  const SCORE = /^(\s*>) \*\*(?:Recommendation|Complexity|Urgency|Customer value|This session)\*\*/

  function gluedScoreLines(text) {
    const lines = text.split('\n')
    return lines.flatMap((line, i) => {
      if (!SCORE.test(line)) return []
      const next = lines[i + 1] ?? ''
      return /^\s*>\s*$/.test(next) ? [] : [`${i + 1}: ${line.trim()}`]
    })
  }

  it.each(['CLAUDE.md', 'docs/HANDOFF.md'])('%s separates every score from its reason', (file) => {
    const text = readFileSync(join(repoRoot, file), 'utf8')
    expect(gluedScoreLines(text)).toEqual([])
  })

  it('finds the blocks it claims to be checking — an empty scan is not a pass', () => {
    // The `| wc -l` failure mode this file already guards three greps against:
    // a detector pointed at nothing reports clean for ever. If the convention
    // is renamed or the blocks move, this goes red instead of quietly passing.
    //
    // A bare floor is not enough, and review caught this: at `>= 5` against a
    // real 15 per file, renaming ONE of the five labels leaves 12 — over the
    // floor, so the scan stays green while a third of every block silently
    // stops being checked. Asserting each label individually is what closes
    // it; the floor then only has to catch wholesale deletion.
    const LABELS = ['Recommendation', 'Complexity', 'Urgency', 'Customer value', 'This session']

    for (const file of ['CLAUDE.md', 'docs/HANDOFF.md']) {
      const lines = readFileSync(join(repoRoot, file), 'utf8').split('\n')
      const scored = lines.filter((l) => SCORE.test(l))
      expect(scored.length, `${file} has no rating blocks — the scan above passed vacuously`).toBeGreaterThanOrEqual(15)

      for (const label of LABELS) {
        const seen = scored.filter((l) => l.includes(`**${label}**`)).length
        expect(seen, `${file} has no "${label}" line — a renamed label drops out of the scan silently`).toBeGreaterThan(0)
      }

      // Every block carries all five, so the counts must agree. A block that
      // lost one line reads as complete under a per-label presence check.
      const perLabel = LABELS.map((l) => scored.filter((s) => s.includes(`**${l}**`)).length)
      expect(new Set(perLabel).size, `${file} has an incomplete rating block — label counts ${perLabel} disagree`).toBe(1)
    }
  })

  it('catches a real violation — the hard-break form it replaced', () => {
    const glued = ['> **Recommendation** 7/10  ', '> a dead column that reads as live is a trap'].join('\n')
    expect(gluedScoreLines(glued)).toHaveLength(1)
  })

  it('catches a violation in an indented block, where HANDOFF keeps its blocks', () => {
    // Every real block in docs/HANDOFF.md sits inside a list item, so the
    // quote marker carries two leading spaces. A detector anchored to a
    // column-0 `>` would score all three of them as absent — clean, forever.
    const glued = ['  > **Urgency** 4/10', '  > both doors need a hand-rolled request'].join('\n')
    expect(gluedScoreLines(glued)).toHaveLength(1)
  })

  it('accepts the correct form', () => {
    const ok = ['  > **This session** N', '  >', '  > wants its own branch'].join('\n')
    expect(gluedScoreLines(ok)).toEqual([])
  })
})

describe('mutation: a stale digit is read as the new (wrong) stated value', () => {
  // This is the shape PD-155 asks for directly: take a real claim, mutate
  // the doc text the way a careless edit would, and prove the extractor
  // faithfully reads whatever is written — including a wrong number — rather
  // than caching or hardcoding the value that happened to be correct when
  // this test was written. A checker whose extractor cannot be fooled by a
  // bad edit cannot catch one either.
  it('reads a hand-edited migration count instead of the true one', () => {
    const claim = claims.find((c) => c.id === 'migrations-count-claude')
    const real = content('CLAUDE.md')

    function content(file) {
      return readFileSync(join(repoRoot, file), 'utf8')
    }

    const correctMatch = findOnce(real, claim.pattern)
    const correctStated = claim.extractStated(correctMatch)

    // The mutation is built from the MATCHED SPAN rather than from a
    // hardcoded sentence. Hardcoding it coupled this test to prose the
    // pattern does not own: when 041 landed on DEV alone and the claim's
    // sentence stopped saying "DEV and PROD AGREE", the replace silently
    // stopped landing and the failure read as a broken extractor rather than
    // as a stale literal. findOnce already guarantees the span is unique, so
    // this is exactly as strict and has one less thing to keep in step.
    const mutated = real.replace(
      correctMatch[0],
      correctMatch[0].replace(`${correctStated} files`, `${correctStated + 1} files`)
    )
    expect(mutated).not.toBe(real) // the replace actually landed

    const mutatedMatch = findOnce(mutated, claim.pattern)
    const mutatedStated = claim.extractStated(mutatedMatch)

    expect(mutatedStated).toBe(correctStated + 1)
    expect(mutatedStated).not.toBe(correctStated)
  })

  it('reads a hand-edited RLS assertion count instead of the true one', () => {
    const claim = claims.find((c) => c.id === 'rls-count-claude')
    const real = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8')

    const correctStated = claim.extractStated(findOnce(real, claim.pattern))
    const mutated = real.replace(`Suite **${correctStated}** assertions`, `Suite **999999** assertions`)

    const mutatedStated = claim.extractStated(findOnce(mutated, claim.pattern))
    expect(mutatedStated).toBe(999999)
    expect(mutatedStated).not.toBe(correctStated)
  })
})
