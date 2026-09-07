import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * The two files every session loads have a size budget, and this is the only
 * thing that keeps it.
 *
 * WHY. `CLAUDE.md` is auto-loaded into every session and re-paid by every
 * subagent; `docs/HANDOFF.md` is the first thing `CLAUDE.md` says to read. On
 * 2026-09-02 a process session cut the pair to ~31k tokens. Five days later
 * they were back at ~73k — the handoff had become a dated journal of fifty
 * entries, and `CLAUDE.md` had grown correction paragraphs faster than rules.
 * Nothing measured it, so nothing stopped it. The 2026-09-07 pass cut them
 * again, moved the journal to `docs/reference/journal.md`, and added this.
 *
 * The budgets sit a little above the size each file landed at, so ordinary
 * edits pass and a session that starts appending history goes red on its own
 * PR. Raising a budget is a deliberate act in this file, with a reason in the
 * commit — not a side effect of an edit somewhere else.
 */
export const BUDGETS = {
  'CLAUDE.md': 56_000,
  'docs/HANDOFF.md': 12_000,
}

/** The handoff's shape: these five H2s, in this order, and no others. */
export const HANDOFF_SECTIONS = ['Position', 'In flight', 'Blocked on the owner', 'Next action', 'Test accounts']

export function h2s(text) {
  return text.split('\n').filter((l) => /^## /.test(l)).map((l) => l.replace(/^## /, '').trim())
}

/** A heading that ends in a date is a journal entry, whatever level it sits at. */
export function datedHeadings(text) {
  return text.split('\n').filter((l) => /^#{1,6} .*\b20\d\d-\d\d-\d\d\s*$/.test(l))
}

describe('the context budget', () => {
  it.each(Object.entries(BUDGETS))('%s is under its byte budget', (file, budget) => {
    const size = Buffer.byteLength(readFileSync(join(repoRoot, file), 'utf8'))
    expect(
      size,
      `${file} is ${size} bytes against a budget of ${budget}. It is loaded by every session; ` +
        'move the addition to the reference doc that owns the topic, or to docs/reference/journal.md, ' +
        'rather than raising the budget.',
    ).toBeLessThanOrEqual(budget)
  })

  it('the handoff has exactly the five sections, in order', () => {
    const text = readFileSync(join(repoRoot, 'docs/HANDOFF.md'), 'utf8')
    expect(h2s(text)).toEqual(HANDOFF_SECTIONS)
  })

  it('the handoff carries no dated entry — those belong in docs/reference/journal.md', () => {
    const text = readFileSync(join(repoRoot, 'docs/HANDOFF.md'), 'utf8')
    expect(datedHeadings(text)).toEqual([])
  })

  it('CLAUDE.md carries no dated entry either', () => {
    const text = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8')
    expect(datedHeadings(text)).toEqual([])
  })

  // The budgets are not slack: each sits within a fifth of the size the file
  // landed at, so a session that pastes one journal entry trips it. If a real
  // rule pushes a file over, the fix is to cut something else, and only then
  // to raise the number here with a reason.
  it('the budgets are pinned near the live sizes rather than left slack', () => {
    for (const [file, budget] of Object.entries(BUDGETS)) {
      const size = Buffer.byteLength(readFileSync(join(repoRoot, file), 'utf8'))
      expect(size, `${file} sits far below its budget — re-pin the budget so growth is measured`).toBeGreaterThan(budget * 0.6)
    }
  })
})

describe('the detectors catch what they claim to — an empty scan is not a pass', () => {
  it('reads H2s and only H2s', () => {
    expect(h2s('# T\n\n## A\n\n### A.1\n\n## B\n')).toEqual(['A', 'B'])
  })

  it('flags a dated heading at any level, and leaves an undated one alone', () => {
    expect(datedHeadings('## Threads replace the ride chat — 2026-09-06\n')).toHaveLength(1)
    expect(datedHeadings('### Store readiness — assessed 2026-08-06\n')).toHaveLength(1)
    expect(datedHeadings('## Position\n## Blocked on the owner\n')).toEqual([])
  })

  it('would fail the old handoff shape', () => {
    const old = '## Where this left off — 2026-09-01, the club bundle is IN PRODUCTION\n\n## Test accounts\n'
    expect(h2s(old)).not.toEqual(HANDOFF_SECTIONS)
  })
})
