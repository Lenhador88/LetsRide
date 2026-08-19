import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { words, matchesHeading, headings, references, resolveAll } from '../crossrefs.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * Archived OpenSpec changes are a historical record. A pointer written *inside*
 * one is not a promise about the repo as it is, so they are not sources — but
 * they remain valid *targets*, because pointing into the archive is exactly how
 * a live doc cites the reasoning behind a shipped decision.
 */
const ARCHIVE = 'openspec/changes/archive/'
const isSource = (f) => !f.startsWith(ARCHIVE)

function realDocs() {
  const files = execFileSync('git', ['ls-files', '*.md'], { cwd: repoRoot, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
  return new Map(files.map((f) => [f, readFileSync(join(repoRoot, f), 'utf8')]))
}

describe('words', () => {
  it('strips the markup a heading carries and a citation does not', () => {
    expect(words('`places` — **the** provider')).toEqual(['places', 'the', 'provider'])
  })

  it('resolves a markdown link to its text', () => {
    expect(words('[`docs/reference/linear.md`](docs/reference/linear.md)'))
      .toEqual(['docs', 'reference', 'linear.md'])
  })

  it('strips a possessive so a citation matches the heading it names', () => {
    expect(words("Product Scope's Inbox row")).toEqual(['product', 'scope', 'inbox', 'row'])
  })

  it('splits on a slash, so §D8/§D9 is two words rather than one token', () => {
    expect(words('D8/§D9)')).toEqual(['d8', 'd9'])
  })
})

describe('matchesHeading', () => {
  it('accepts a one-word citation that names the heading', () => {
    expect(matchesHeading('Branching', 'Branching & CI')).toBe(true)
  })

  it('accepts a citation that runs on into the surrounding prose', () => {
    expect(matchesHeading('Branching currently reads the other way', 'Branching & CI')).toBe(true)
    expect(matchesHeading('The necessity gate enforces this, and carries a line budget', 'The necessity gate')).toBe(true)
  })

  // The regression that justifies the stopword rule. This exact pair existed on
  // 2026-08-10: CLAUDE.md cited "§The statuses" after that subsection had moved
  // to docs/reference/linear.md, and CLAUDE.md still had "## The Agent Squad".
  // A first-word match would have called it resolved.
  it('rejects a stopword-led citation that shares only "The" with a heading', () => {
    expect(matchesHeading('The statuses', 'The Agent Squad')).toBe(false)
  })

  it('accepts the same citation against the heading it actually names', () => {
    expect(matchesHeading('The statuses', 'The statuses')).toBe(true)
  })

  it('rejects a citation whose first word appears nowhere', () => {
    expect(matchesHeading('Schema', 'Supabase Rules')).toBe(false)
  })
})

describe('headings', () => {
  it('reads every ATX level, not just H2', () => {
    expect(headings('# A\n\ntext\n\n## B\n\n#### C\n\nnot # a heading')).toEqual(['A', 'B', 'C'])
  })
})

describe('references', () => {
  it('binds a backticked path to the section beside it', () => {
    const [r] = references('see `CLAUDE.md` §Supabase Rules for the rest')
    expect(r).toMatchObject({ file: 'CLAUDE.md', name: 'Supabase Rules for the rest' })
  })

  it('binds a markdown-link path', () => {
    const [r] = references('in [`docs/reference/linear.md`](docs/reference/linear.md) §The statuses')
    expect(r).toMatchObject({ file: 'docs/reference/linear.md', name: 'The statuses' })
  })

  it('follows a reference that wraps across a line, since these files are hard-wrapped', () => {
    const [r] = references('`CLAUDE.md` §The\nroadmap lives in Linear: a rule')
    expect(r.name).toBe('The roadmap lives in Linear: a rule')
  })

  it('keeps a colon inside the name — a real heading starts "Then: classify the diff"', () => {
    const [r] = references('`.claude/agents/reviewer.md` §Then: classify the diff is the list')
    expect(r.name).toBe('Then: classify the diff is the list')
  })

  it('ignores a § inside a fenced code block, which is an example and not a pointer', () => {
    expect(references('```\n`CLAUDE.md` §Nope\n```\n')).toEqual([])
  })

  it('reports an unqualified § as unchecked rather than guessing its target', () => {
    const refs = references('the reasoning is in §Working Principles')
    expect(refs).toEqual([{ line: 0, file: null, name: null }])
  })
})

describe('resolveAll', () => {
  it('resolves a reference whose target still has the section', () => {
    const docs = new Map([
      ['a.md', 'see `b.md` §Widgets'],
      ['b.md', '## Widgets\n'],
    ])
    expect(resolveAll(docs).broken).toEqual([])
  })

  // The whole point of the file. This is the CLAUDE.md split in miniature: the
  // section left b.md for c.md and the pointer in a.md was not updated.
  it('catches a reference into a file the section has left', () => {
    const docs = new Map([
      ['a.md', 'see `b.md` §Widgets'],
      ['b.md', '## Something else\n'],
      ['c.md', '## Widgets\n'],
    ])
    const { broken } = resolveAll(docs)
    expect(broken).toHaveLength(1)
    expect(broken[0]).toMatchObject({ from: 'a.md', target: 'b.md', name: 'Widgets' })
  })

  it('counts a reference to a file it cannot find, rather than dropping it', () => {
    const docs = new Map([['a.md', 'see `nowhere.md` §Widgets']])
    const r = resolveAll(docs)
    expect(r.broken).toEqual([])
    expect(r.unresolvablePath).toHaveLength(1)
  })

  // The regression that a suffix match caused: every OpenSpec change cites its
  // own proposal.md by bare filename, and matching on suffix resolved all of
  // them to whichever change sorted first. That is not a near-miss — it checks
  // the wrong document, so it can fail a good pointer *and* pass a bad one.
  it('prefers a sibling over a same-named file in another directory', () => {
    const docs = new Map([
      ['changes/aaa/proposal.md', '## Something else\n'],
      ['changes/zzz/tasks.md', 'from `proposal.md` §Two defects'],
      ['changes/zzz/proposal.md', '## Two defects this change found\n'],
    ])
    expect(resolveAll(docs).broken).toEqual([])
  })

  it('walks up to find a change-root design.md cited from a nested spec', () => {
    const docs = new Map([
      ['changes/c/design.md', '## D3 — the decision\n'],
      ['changes/c/specs/cap/spec.md', 'see `design.md` §D3'],
    ])
    expect(resolveAll(docs).broken).toEqual([])
  })

  it('refuses to guess when a bare filename is ambiguous and has no sibling', () => {
    const docs = new Map([
      ['x/design.md', '## D1\n'],
      ['y/design.md', '## D1\n'],
      ['z/spec.md', 'see `design.md` §D1'],
    ])
    const r = resolveAll(docs)
    expect(r.broken).toEqual([])
    expect(r.unresolvablePath).toHaveLength(1)
  })
})

describe('the cross-references in the real repo', () => {
  const docs = realDocs()
  const result = resolveAll(docs, isSource)

  it('every file-qualified §reference resolves to a real heading', () => {
    const detail = result.broken
      .map((b) => `${b.from}:${b.line} -> ${b.target} §${b.name}`)
      .join('\n  ')
    expect(result.broken, `broken cross-references:\n  ${detail}`).toEqual([])
  })

  // An empty scan is not a pass. If the scanner silently stops matching — a
  // changed citation style, a regex edit — `broken` goes to zero and the test
  // above turns green while checking nothing. That is the exact shape of this
  // repo's comment trap, so the floor is asserted separately.
  it('finds the references it claims to be checking — an empty scan is not a pass', () => {
    // Pinned near the live value (124) rather than left slack. A floor of 80
    // tolerated a 31% loss, which is wider than either known silent-loss path,
    // so it was a smoke alarm in the next room. Raise it when the real number
    // rises; a drop is the signal.
    expect(result.checked).toBeGreaterThanOrEqual(115)
    expect(docs.size).toBeGreaterThanOrEqual(50)

    // Both silent-loss paths convert a QUALIFIED reference into something else
    // rather than deleting the § mark: one reclassifies it as bare, the other
    // used to blank it from both counts. A floor on the sum catches the second
    // where a floor on `checked` alone cannot.
    expect(result.checked + result.bare).toBeGreaterThanOrEqual(260)

    // A floor is a weak canary: it cannot tell "the regex stopped matching"
    // from "references were legitimately deleted". So also require one specific
    // live reference to be seen, in the exact style the split created.
    const seen = references(docs.get('CLAUDE.md')).filter((r) => r.file)
    expect(seen.some((r) => r.file.startsWith('docs/reference/'))).toBe(true)
  })

  // A one-word leading match means a citation can resolve against a sibling
  // heading that merely starts with the same word — "§Working Principles" hits
  // both `## Working Principles` and `## Working With the Product Owner`. Today
  // the right one is among the hits; delete it and the pointer silently lands on
  // the wrong one. Tightening the match breaks legitimate citations, so the hole
  // is surfaced and pinned instead. A NEW ambiguous citation should be seen.
  it('surfaces every ambiguous citation rather than letting it pass on luck', () => {
    const firstWords = [...new Set(result.ambiguous.map((a) => a.name.split(/\s+/)[0]))].sort()
    expect(firstWords).toEqual(['Before', 'Working'])
    // **8 -> 10 on 2026-08-18 (PD-255).** Both new ones are
    // `openspec/changes/capture-photo-time-and-place/design.md` citing
    // `CLAUDE.md §Working Principles`, which is the exact heading they mean —
    // they are ambiguous only under the one-word leading match this test exists
    // to pin, and `§Working With the Product Owner` is the sibling they collide
    // with. Raising the number is the intended response to that: the guard is
    // the `firstWords` assertion above, which still admits no NEW kind of
    // collision, and this ceiling is the "did you mean to add one" prompt.
    // **Do not raise it to make a red run green without saying which citation
    // moved it and why** — a ceiling nobody defends is the same as no ceiling.
    //
    // **10 -> 11 on 2026-08-18 (the queue rebuild).** The new one is
    // `docs/HANDOFF.md` citing `CLAUDE.md §Working Principles` for the
    // three-attempt CI bound that landed in that section. Same collision as
    // every other entry here — `§Working With the Product Owner` starts with the
    // same word — so it adds no new KIND, which is what `firstWords` above pins.
    //
    // **11 -> 12 on 2026-08-19 (replace-places-index-with-geocoder).** The new
    // one is that change's `tasks.md` citing `CLAUDE.md §Working Principles` for
    // the rule that an inferred value must never pass silently as a measured
    // one — which is the rule the task is applying, so the citation is the point
    // of the sentence rather than decoration. Same `Working` collision again, so
    // `firstWords` still admits no new kind.
    expect(result.ambiguous.length).toBeLessThanOrEqual(12)
  })

  // Two standing specs cite the `design.md` of a change that has since been
  // archived, so there is no file to resolve to from anywhere. They are
  // genuinely unchecked rather than broken. Pinned by location: a new
  // unresolvable reference somewhere else is a mistake worth seeing, while
  // these two are a property of archiving.
  it('leaves only the standing-spec pointers into archived changes unresolved', () => {
    const outside = result.unresolvablePath.filter((u) => !u.from.startsWith('openspec/specs/'))
    const detail = outside.map((u) => `${u.from}:${u.line} -> ${u.file}`).join('\n  ')
    expect(outside, `unresolvable outside openspec/specs/:\n  ${detail}`).toEqual([])
  })
})
