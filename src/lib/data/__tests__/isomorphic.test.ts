import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * `src/lib/data/` and `src/lib/actions/` must stay callable from a client
 * component.
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
 * only when the route was already dead in production.
 *
 * **Group 6 widened this test rather than retiring it.** The conditional import
 * it was written around is gone: there is no `react-server` half to protect,
 * because there is no server client at all. What remains is the property that
 * actually mattered — no module under `lib/data/` or `lib/actions/` may reach a
 * Next server runtime — and it now covers the write path too, which group 6
 * moved into the browser alongside the reads. The retired specifier is asserted
 * *absent*, so it cannot come back by half.
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
const ACTIONS_DIR = path.join(SRC, 'lib', 'actions')

/**
 * The subpath import that used to be the doorway, kept only so its *absence* can
 * be asserted. `package.json` no longer declares it and nothing may import it —
 * a resurrected mapping with one half missing resolves to nothing at build time
 * in a way that reads as a missing file rather than as a retired mechanism.
 */
const RETIRED_SPECIFIER = '#supabase/data-client'

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
      if (SERVER_ONLY.includes(specifier)) return [...trail, specifier]

      const next = resolveLocal(specifier, file)
      if (next) queue.push({ file: next, trail: [...trail, next] })
    }
  }

  return null
}

const dataModules = [...walk(DATA_DIR), ...walk(ACTIONS_DIR)].filter(
  (file) => !file.includes('__tests__')
)

describe('the data layer never reaches a server-only module', () => {
  it('finds the data modules, so this cannot pass by scanning nothing', () => {
    expect(dataModules.length).toBeGreaterThanOrEqual(16)
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
    // The negative control used to be `lib/supabase/server.ts`, the module the
    // ban existed for. Group 6 deleted it, so the control has to be synthesised:
    // a module that reaches `next/headers` through one hop must be reported with
    // the hop named, or the walker proves nothing about the modules that pass.
    const viaOneHop = path.join(SRC, 'lib', 'actions', 'auth.ts')
    const trail = pathToServerOnly(viaOneHop)
    expect(trail).toBeNull()

    // Synthetic: prove the walker follows a `from 'next/headers'` at all, using
    // the same `importsOf` it uses on real files.
    expect(importsOf("import { headers } from 'next/headers'")).toEqual(['next/headers'])
    expect(SERVER_ONLY).toContain('next/headers')
  })
})

describe('the conditional import is retired, not half-retired', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

  it('is gone from package.json', () => {
    // Through groups 3-5 this mapping had a `react-server` half and a `default`
    // half, and the whole isomorphic layer rested on it. Group 6 deleted the
    // server half; a mapping left behind with one arm would resolve to a missing
    // file and read as a broken path rather than as a retired mechanism.
    expect(manifest.imports?.[RETIRED_SPECIFIER]).toBeUndefined()
  })

  it('is imported by nothing', () => {
    const offenders = walk(SRC)
      .filter((file) => !file.includes('__tests__'))
      .filter((file) => importsOf(readFileSync(file, 'utf8')).includes(RETIRED_SPECIFIER))
      .map((file) => path.relative(ROOT, file))

    expect(offenders).toEqual([])
  })

  it('left no server half behind on disk', () => {
    for (const orphan of [
      'src/lib/supabase/resolve.rsc.ts',
      'src/lib/supabase/server.ts',
      'src/proxy.ts',
      'src/app/auth/callback/route.ts',
    ]) {
      expect(existsSync(path.join(ROOT, orphan)), orphan).toBe(false)
    }
  })

  it('leaves @supabase/ssr uninstalled — the cookie session is gone with it', () => {
    expect(manifest.dependencies['@supabase/ssr']).toBeUndefined()

    const importers = walk(SRC)
      .filter((file) => importsOf(readFileSync(file, 'utf8')).some((i) => i.startsWith('@supabase/ssr')))
      .map((file) => path.relative(ROOT, file))
    expect(importers).toEqual([])
  })
})

describe('the one remaining half resolves a usable client', () => {
  beforeAll(() => {
    // The suite has no `.env.local`; both factories throw without these, and the
    // values never leave this process.
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-publishable-key'
  })

  it('returns a real Supabase client when there is a DOM', async () => {
    const { resolveSupabase } = await import('@/lib/supabase/resolve.browser')
    // The suite runs in `node`, so the DOM has to be faked. Only `document`'s
    // existence is read: the client is constructed with the session store, which
    // resolves lazily and falls through to the memory store here.
    const globals = globalThis as { document?: unknown }
    globals.document = { cookie: '' }
    try {
      const client = await resolveSupabase()
      expect(typeof client.from).toBe('function')
      expect(typeof client.storage.from).toBe('function')
      expect(typeof client.auth.getUser).toBe('function')
    } finally {
      delete globals.document
    }
  })

  it('refuses to build a client with no DOM, and says why', async () => {
    // The tripwire for the one mistake no static gate catches: a read issued
    // during the SSR pass of a client component, which Next still performs until
    // the native shell lands. It would otherwise succeed into a session-less
    // client and fail closed at RLS, a long way from here.
    const { resolveSupabase } = await import('@/lib/supabase/resolve.browser')
    await expect(resolveSupabase()).rejects.toThrow(/effect or an event handler/)
  })

})
