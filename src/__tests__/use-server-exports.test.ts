import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * A `'use server'` module may only export async functions. Exporting a plain
 * value from one throws
 *
 *   A "use server" file can only export async functions, found object
 *
 * at **module evaluation**, the moment a client component imports it — which
 * takes down the whole route.
 *
 * Nothing else in this repo's pipeline catches that. `tsc`, ESLint, `next build`
 * and the unit suite were all green while `/postcards/new` was dead in
 * production, because the failure is a runtime property of the server module
 * graph rather than a type or syntax error. This test is the guard, and it
 * exists because that bug shipped.
 *
 * It is a source scan, not an AST parse — deliberately, to avoid adding a parser
 * dependency for one rule. That means it reasons about `export` statements
 * textually and can be defeated by unusual formatting. It is a tripwire for the
 * ordinary case, not a proof.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : walk(full)
    return /\.tsx?$/.test(full) ? [full] : []
  })
}

/** True when the file's first meaningful line is the `'use server'` directive. */
export function isUseServerModule(source: string): boolean {
  for (const line of source.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue
    }
    return /^['"]use server['"]/.test(trimmed)
  }
  return false
}

/**
 * Returns the export statements that would be illegal in a `'use server'` file.
 *
 * Legal: `export async function`, `export const x = async …`, and anything
 * type-only (`export type`, `export interface`, `export type { … }`) since types
 * are erased before the module is ever evaluated.
 */
export function findIllegalExports(source: string): string[] {
  const offenders: string[] = []

  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('export')) continue

    // Erased at compile time — never reaches the server module graph.
    if (/^export\s+(type|interface)\b/.test(line)) continue
    // `export async function foo(` and `export default async function`.
    if (/^export\s+(default\s+)?async\s+function\b/.test(line)) continue
    // `export const foo = async (…)` / `= async function`.
    if (/^export\s+(const|let|var)\s+\w+\s*(:[^=]+)?=\s*async\b/.test(line)) continue

    offenders.push(line)
  }

  return offenders
}

describe('findIllegalExports', () => {
  it('flags the exact bug that took /postcards/new down', () => {
    const source = `'use server'\nexport const emptyPostcardActionState: PostcardActionState = { error: null }`
    expect(findIllegalExports(source)).toEqual([
      'export const emptyPostcardActionState: PostcardActionState = { error: null }',
    ])
  })

  it.each([
    'export async function createPostcard(',
    'export default async function handler(',
    'export const like = async (id: string) => {',
    'export const like: Action = async (id) => {',
    'export type ActionState = { error: string | null }',
    'export interface Foo { a: string }',
    'export type { ActionState } from "@/lib/actions/state"',
  ])('allows %s', (line) => {
    expect(findIllegalExports(line)).toEqual([])
  })

  it.each([
    'export const MAX = 10',
    'export function notAsync() {',
    'export class Thing {',
    'export { helper } from "./helper"',
  ])('rejects %s', (line) => {
    expect(findIllegalExports(line)).toHaveLength(1)
  })
})

describe('isUseServerModule', () => {
  it('sees the directive past a leading comment block', () => {
    expect(isUseServerModule("/**\n * Doc.\n */\n'use server'\n")).toBe(true)
  })

  it('does not treat a later occurrence as the directive', () => {
    expect(isUseServerModule("import x from 'y'\n'use server'\n")).toBe(false)
  })

  it('is false for an ordinary module', () => {
    expect(isUseServerModule("export const a = 1\n")).toBe(false)
  })
})

/**
 * **There are none left, and that is the assertion.**
 *
 * This block used to require at least three, so it could not pass by scanning
 * nothing. The render migration removed the directive from all nine
 * `lib/actions/` modules — writes run in the browser now, and group 6 deletes
 * the server client they imported — so the guard inverts: the count is zero,
 * and any module that reappears with the directive is checked against the rule
 * rather than being trusted.
 *
 * The pure functions above keep their tests either way. They are the part worth
 * having if a `'use server'` module ever comes back, and they cost nothing to
 * keep while none exists.
 */
describe("every 'use server' module in src/", () => {
  const serverModules = walk(SRC)
    .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
    .filter(({ source }) => isUseServerModule(source))

  it('is empty — the app has no server module graph left', () => {
    expect(serverModules.map(({ file }) => path.relative(SRC, file))).toEqual([])
  })

  it('still checks any that come back', () => {
    for (const { file, source } of serverModules) {
      expect({ file: path.relative(SRC, file), illegal: findIllegalExports(source) }).toEqual({
        file: path.relative(SRC, file),
        illegal: [],
      })
    }
  })
})
