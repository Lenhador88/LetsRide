import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * `src/lib/data/` must stay callable from a client component.
 *
 * **Why this test exists, and why it is a source scan.** The migration to a
 * client-rendered shell rests entirely on the 19 read functions in `lib/data/`
 * working from either side without changing a signature. What breaks that is one
 * line — a re-introduced `import { createClient } from '@/lib/supabase/server'`
 * — and nothing else in this repo's pipeline catches it. `next/headers` is a
 * *build-time reachability* rule: Next refuses to bundle it into a client graph,
 * and it refuses whether or not the branch importing it can ever be taken. Until
 * a `'use client'` page actually imports this layer (Phase 4), no client graph
 * reaches it, so `tsc`, ESLint, `next build` and the unit suite all stay green
 * while the property this migration depends on is quietly gone.
 *
 * That is the same shape as the bug `use-server-exports.test.ts` guards — a
 * runtime property of the module graph that every static gate is blind to, found
 * only when the route was already dead in production. This one would be found
 * only in Phase 4, on a screen that had nothing to do with the commit that broke
 * it.
 *
 * **Measured, not assumed.** On Next 16.2.9 / Turbopack, a `'use client'` page
 * importing one read function fails the build with
 *
 *   You're importing a module that depends on "next/headers".
 *
 * and import traces through both `[Client Component Browser]` and
 * `[Client Component SSR]`. Guarding the import behind `typeof document ===
 * 'undefined'` and `await import()` does *not* help — the bundler resolves it
 * statically either way. That measurement is what moved the split from a runtime
 * check to the `react-server` export condition; see `lib/supabase/resolve.ts`.
 */

const SRC = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const ROOT = path.resolve(SRC, '..')
const DATA_DIR = path.join(SRC, 'lib', 'data')

/**
 * The sanctioned doorway. Resolution stops here: the `react-server` half behind
 * it *does* import `next/headers`, and that is the point — the export condition
 * is what keeps it out of the browser graph. Its shape is asserted separately
 * below rather than walked through.
 */
const CONDITIONAL_SPECIFIER = '#supabase/data-client'

/** Anything that only exists in a Next server runtime. */
const SERVER_ONLY = ['next/headers', 'next/cache', 'server-only']

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.tsx?$/.test(full) ? [full] : []
  })
}

/** Every `from '…'` / `import('…')` specifier in a module, in source order. */
function importsOf(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1])
  }
  return specifiers
}

/** Resolves a `@/…` or relative specifier to a file on disk, or null if it leaves `src/`. */
function resolveLocal(specifier: string, from: string): string | null {
  const base = specifier.startsWith('@/')
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(from), specifier)
      : null
  if (!base) return null

  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/**
 * Walks the local module graph from `entry` and returns the first path that
 * reaches a server-only module — as a list of files, so a failure names the hop
 * that introduced it rather than only the destination.
 */
function pathToServerOnly(entry: string): string[] | null {
  const seen = new Set<string>()
  const queue: { file: string; trail: string[] }[] = [{ file: entry, trail: [entry] }]

  while (queue.length > 0) {
    const { file, trail } = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)

    for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
      if (specifier === CONDITIONAL_SPECIFIER) continue
      if (SERVER_ONLY.includes(specifier)) return [...trail, specifier]

      const next = resolveLocal(specifier, file)
      if (next) queue.push({ file: next, trail: [...trail, next] })
    }
  }

  return null
}

const dataModules = walk(DATA_DIR).filter((file) => !file.includes('__tests__'))

describe('the data layer never reaches a server-only module', () => {
  it('finds the data modules, so this cannot pass by scanning nothing', () => {
    expect(dataModules.length).toBeGreaterThanOrEqual(6)
  })

  it.each(dataModules.map((file) => [path.relative(ROOT, file), file]))(
    '%s',
    (_relative, file) => {
      const trail = pathToServerOnly(file as string)
      const rendered = trail?.map((hop) => (hop.startsWith('/') ? path.relative(ROOT, hop) : hop))
      expect(rendered ?? null).toBeNull()
    }
  )

  it('would catch a re-introduced server import, so the scan is not vacuous', () => {
    // `lib/supabase/server.ts` is the module the ban exists for. Pointing the
    // walker at it must fail, or the walker proves nothing about the modules
    // that pass.
    const trail = pathToServerOnly(path.join(SRC, 'lib', 'supabase', 'server.ts'))
    expect(trail?.at(-1)).toBe('next/headers')
  })
})

describe('the conditional import that makes it possible', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const mapping = manifest.imports?.[CONDITIONAL_SPECIFIER]

  it('is declared, with a react-server half and a default half', () => {
    expect(mapping).toBeDefined()
    expect(Object.keys(mapping)).toEqual(['react-server', 'default'])
  })

  it('points both halves at files that exist', () => {
    for (const target of Object.values(mapping) as string[]) {
      expect(existsSync(path.join(ROOT, target)), target).toBe(true)
    }
  })

  it('keeps next/headers behind the react-server half only', () => {
    expect(pathToServerOnly(path.join(ROOT, mapping['react-server']))?.at(-1)).toBe('next/headers')
    expect(pathToServerOnly(path.join(ROOT, mapping.default))).toBeNull()
  })

  it('is the only way in — nothing imports a half directly', () => {
    const halves = (Object.values(mapping) as string[]).map((target) =>
      path.resolve(ROOT, target).replace(/\.tsx?$/, '')
    )
    const offenders = walk(SRC)
      .filter((file) => !halves.includes(file.replace(/\.tsx?$/, '')))
      // This file imports both halves on purpose, to prove each is what it claims.
      .filter((file) => !file.includes('__tests__'))
      .filter((file) =>
        importsOf(readFileSync(file, 'utf8')).some((specifier) => {
          const resolved = resolveLocal(specifier, file)
          return !!resolved && halves.includes(resolved.replace(/\.tsx?$/, ''))
        })
      )
      .map((file) => path.relative(ROOT, file))

    // Bypassing the condition is how a server render silently gets an anonymous
    // client — which fails closed at RLS on every screen, with no build error.
    expect(offenders).toEqual([])
  })
})

describe('both halves resolve a usable client', () => {
  beforeAll(() => {
    // The suite has no `.env.local`; both factories throw without these, and the
    // values never leave this process.
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-publishable-key'
  })

  it('the browser half returns a real Supabase client', async () => {
    const { resolveSupabase } = await import('@/lib/supabase/resolve.browser')
    const client = await resolveSupabase()
    expect(typeof client.from).toBe('function')
    expect(typeof client.storage.from).toBe('function')
    expect(typeof client.auth.getUser).toBe('function')
  })

  it('the react-server half is an async factory that demands a request scope', async () => {
    const { resolveSupabase } = await import('@/lib/supabase/resolve.rsc')
    expect(typeof resolveSupabase).toBe('function')
    // `cookies()` outside a request rejects. That it *does* is the evidence this
    // half is the cookie-session one — a resolved client here would mean the
    // condition had quietly collapsed to the browser factory.
    await expect(resolveSupabase()).rejects.toThrow()
  })
})
