import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FILE_KEY, renderIconModule, renderTokensTable, svgToIconComponent } from '../lib.mjs'

/**
 * A staleness alarm for the two generated-and-committed artifacts of the Figma
 * pipeline, added 2026-08-16.
 *
 * ## The category this fills
 *
 * `scripts/docs/registry.mjs` holds a declared set of numeric claims, and every
 * one of them verifies PROSE against CODE. Nothing in this repo verified that a
 * generated-and-committed artifact is still what its generator would emit from
 * its committed source. `src/__tests__/openspec-artifacts.test.ts` is the
 * sibling alarm, for the other generator that writes into this tree.
 *
 * That gap was not hypothetical. `design/TOKENS.md`'s pointer sentence had been
 * hand-corrected to `docs/reference/design-system.md` while `extract.mjs`'s
 * template still said `CLAUDE.md` §Design System — every gate green, and the
 * next `npm run figma:extract` would have reinstated the dead pointer silently,
 * as a one-line diff nobody reads in a 2.5 KB generated file. THIS TEST FOUND
 * IT, on its first run, which is the entire argument for it. (The icons module
 * was clean, which is worth knowing too: the check was verified against a
 * healthy artifact as well as a broken one.)
 *
 * ## Why byte-identical rather than a count
 *
 * A count check ("53 exports, 53 SVGs") is satisfied by the wrong 53. Both
 * generators here are PURE functions of committed inputs — `generated.tsx` of
 * `design/icons/*.svg`, and `TOKENS.md` of the same arrays that produced
 * `design/tokens.json` — so the strongest available assertion is also the
 * cheapest: rebuild and compare the bytes. No network, no CLI, no Figma API
 * (`npm run figma:check` hits Figma and must never appear in anything CI runs);
 * `figma:pull` is the only networked stage and its output, `.figma-raw/`, is
 * deliberately not committed. That is exactly why the rebuild is driven from
 * `design/tokens.json` rather than from the raw pull: `tokens.json` is the
 * committed snapshot, and it is a sibling output of the same `extract.mjs` run.
 *
 * ## The one thing this cannot see
 *
 * It compares the artifact against the COMMITTED SNAPSHOT, never against Figma.
 * A snapshot that is months behind the design file passes here and should — that
 * is `npm run figma:check`'s question, it needs the network, and it is a monthly
 * owner job rather than a gate. What this catches is the narrower and commoner
 * defect: one stage of the pipeline re-run and its output committed while
 * another was not.
 *
 * ## Both-ways
 *
 * Every rebuild assertion is paired with a mutation proving it still goes red —
 * a `| wc -l`-style check that has quietly stopped matching passes for ever and
 * looks exactly like a clean repo (`CLAUDE.md` §Working Principles, and
 * `no-service-role-key.test.ts`'s self-check, which is the model).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

describe('src/components/icons/generated.tsx is what the generator emits today', () => {
  const ICONS_DIR = join(ROOT, 'design', 'icons')

  function svgFiles() {
    return readdirSync(ICONS_DIR)
      .filter((f) => f.endsWith('.svg'))
      .sort()
  }

  /** Every SVG's contents, keyed by filename — the generator's whole input. */
  function sources() {
    return new Map(svgFiles().map((f) => [f, readFileSync(join(ICONS_DIR, f), 'utf8')]))
  }

  /** Exactly what `scripts/figma/components.mjs` does, using its own code. */
  function rebuild(src = sources()) {
    return renderIconModule([...src].map(([f, raw]) => svgToIconComponent(f, raw)))
  }

  it('regenerates byte-identically from design/icons/*.svg', () => {
    // The `.sort()` above matters and is not cosmetic: `readdir` order is
    // filesystem-dependent, and the generator sorts, so an unsorted rebuild
    // would fail on some machines and pass here — a flaky alarm, which is the
    // one kind that gets deleted rather than fixed.
    expect(rebuild()).toBe(read('src/components/icons/generated.tsx'))
  })

  it('goes red when an SVG is redrawn and the module is not regenerated', () => {
    // The real regression: `npm run figma:icons` re-exports the set, the
    // redrawn glyph lands in design/icons/, and nobody runs `figma:components`.
    // `tsc`, ESLint and `next build` all stay green — the module still compiles,
    // it just draws the old shape.
    const perturbed = sources()
    const first = svgFiles()[0]
    const redrawn = perturbed.get(first).replace(/ d="M/, ' d="M9 9 ')
    expect(redrawn, 'the mutation did not land — no path to redraw').not.toBe(perturbed.get(first))
    perturbed.set(first, redrawn)

    expect(rebuild(perturbed)).not.toBe(read('src/components/icons/generated.tsx'))
  })

  it('goes red when an icon is added to design/icons/ and not to the module', () => {
    // The count half, and it is a genuinely different edit from the one above:
    // a redraw changes a path, an addition changes the header's "53" and adds
    // an export. Both are silent everywhere else.
    const withExtra = sources()
    withExtra.set('zzz-new-icon.svg', '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="#1A1A1A"/></svg>')

    expect(rebuild(withExtra)).not.toBe(read('src/components/icons/generated.tsx'))
  })

  it('the header states the count the generator actually emitted', () => {
    // Redundant with the byte compare by construction, and kept anyway: this is
    // the number `docs/reference/design-system.md` restates as "**Icons: 53
    // exported**", which `scripts/docs/registry.mjs` checks as a prose claim.
    // Naming it here is what connects the two so a reader of either finds the
    // other.
    const emitted = read('src/components/icons/generated.tsx')
    const stated = Number(/These are the (\d+) `Element \/ Icon \/ \*` components/.exec(emitted)?.[1])
    expect(stated).toBe(svgFiles().length)
    expect(
      (emitted.match(/^export function \w+Icon\(props: IconProps\)/gm) ?? []).length,
    ).toBe(svgFiles().length)
  })
})

describe('design/TOKENS.md is what the generator emits from the committed snapshot', () => {
  function tokens() {
    return JSON.parse(read('design/tokens.json'))
  }

  function rebuild(t = tokens()) {
    return renderTokensTable({
      fileKey: FILE_KEY,
      lastModified: t.lastModified,
      colors: t.colors,
      type: t.type,
      legacy: t.legacy,
    })
  }

  it('regenerates byte-identically from design/tokens.json', () => {
    expect(rebuild()).toBe(read('design/TOKENS.md'))
  })

  it('goes red on a hand-edit to the generated file — the defect that was live here', () => {
    // The exact shape found on this test's first run: one prose line in
    // TOKENS.md corrected by hand, the generator's template left alone. It is
    // the *generator* that gets fixed in that situation, never the artifact.
    const stale = read('design/TOKENS.md').replace(
      '`docs/reference/design-system.md`, this file is right and that one is stale.',
      '`CLAUDE.md` §Design System, this file is right and CLAUDE.md is stale.',
    )
    expect(stale, 'the mutation did not land — the sentence moved').not.toBe(read('design/TOKENS.md'))
    expect(rebuild()).not.toBe(stale)
  })

  it('goes red when a token value changes in the snapshot but not in the table', () => {
    const t = tokens()
    t.colors[0] = { ...t.colors[0], value: '#000000' }
    expect(rebuild(t)).not.toBe(read('design/TOKENS.md'))
  })

  it('goes red when the snapshot is re-pulled and only tokens.json is committed', () => {
    // `figma:extract` writes tokens.json, TOKENS.md, manifest.json and
    // index.json in one pass, so a divergence between any two of them means a
    // partial commit — the commonest way a snapshot goes internally
    // inconsistent, and invisible to every other gate.
    const t = tokens()
    t.lastModified = '2027-01-01T00:00:00Z'
    expect(rebuild(t)).not.toBe(read('design/TOKENS.md'))
  })
})

describe('the design/ snapshot agrees with itself', () => {
  // manifest.json records the counts of the pass that produced the other files.
  // Nothing else reads them, so a partial re-extract — or a hand-added SVG —
  // leaves the manifest confidently wrong and permanently unchallenged.
  const manifest = () => JSON.parse(read('design/manifest.json'))

  it('manifest counts match the artifacts they describe', () => {
    const m = manifest()
    const t = JSON.parse(read('design/tokens.json'))
    const icons = JSON.parse(read('design/icons/index.json'))
    const svgs = readdirSync(join(ROOT, 'design', 'icons')).filter((f) => f.endsWith('.svg'))

    expect(m.counts.colorTokens, 'colorTokens').toBe(t.colors.length)
    expect(m.counts.typeTokens, 'typeTokens').toBe(t.type.length)
    expect(m.counts.legacyStyles, 'legacyStyles').toBe(t.legacy.length)
    expect(m.counts.iconsFound, 'iconsFound').toBe(icons.count)
    expect(m.counts.iconsExported, 'iconsExported').toBe(svgs.length)
    expect(icons.icons.length, 'icons/index.json count vs its own list').toBe(icons.count)
  })

  it('every file of the snapshot names the same Figma file and revision', () => {
    const m = manifest()
    const t = JSON.parse(read('design/tokens.json'))
    expect(m.fileKey).toBe(FILE_KEY)
    expect(JSON.parse(read('design/index.json')).fileKey).toBe(FILE_KEY)
    expect(t.source).toBe(`figma:${FILE_KEY}`)
    // The one that catches a half-committed re-pull: TOKENS.md prints the
    // timestamp, tokens.json stores it, manifest.json records it.
    expect(t.lastModified).toBe(m.lastModified)
    expect(read('design/TOKENS.md')).toContain(`last modified ${m.lastModified}.`)
  })

  it('goes red when a manifest count drifts from the artifact', () => {
    const m = manifest()
    expect(m.counts.iconsExported + 1).not.toBe(
      readdirSync(join(ROOT, 'design', 'icons')).filter((f) => f.endsWith('.svg')).length,
    )
  })
})
