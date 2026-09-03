import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * PD-381's actual fix — the half `ThreadOptions.test.tsx` cannot see, since
 * it only asserts `onDeleted` is wired on the caller's side. Source-string,
 * matching that file's own precedent: a tap cannot be simulated under this
 * suite's `environment: 'node'` (no jsdom, no events — `vitest.config.ts`'s
 * own header), and comment-stripped so a docstring describing the guard
 * cannot satisfy its own assertion.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const SOURCE = stripComments(
  readFileSync(path.resolve(fileURLToPath(new URL('../page.tsx', import.meta.url))), 'utf8')
)

describe('ClubThreadScreen — a thread this screen just deleted must not 404 on the way out', () => {
  it('gates notFound() on the removedByThisScreen flag, not on thread.data alone', () => {
    const notFoundLine = SOURCE.split('\n').find((line) => line.includes('notFound()'))
    expect(notFoundLine).toBeDefined()
    expect(notFoundLine).toContain('thread.data === null')
    expect(notFoundLine).toContain('!removedByThisScreen')
  })

  it('wires ThreadOptions.onDeleted to set that same flag', () => {
    const threadOptionsBlock = SOURCE.slice(
      SOURCE.indexOf('<ThreadOptions'),
      SOURCE.indexOf('/>', SOURCE.indexOf('<ThreadOptions'))
    )
    expect(threadOptionsBlock).toContain('onDeleted={() => setRemovedByThisScreen(true)}')
  })

  it('starts false — an ordinary 404 for a thread nobody here deleted still fires', () => {
    expect(SOURCE).toContain('useState(false)')
    // Confirms the state hook feeding the guard is the one just asserted above,
    // not an unrelated `useState(false)` elsewhere in the file.
    const declLine = SOURCE.split('\n').find((line) => line.includes('useState(false)'))
    expect(declLine).toContain('removedByThisScreen')
  })
})
