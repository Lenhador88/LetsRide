import { describe, expect, it } from 'vitest'

/**
 * `src/lib/query/` is imported by client components that Next still
 * server-renders until Phase 6 (see `lib/supabase/resolve.ts`), so importing
 * any module here must not touch `window`/`document`/`navigator` at module
 * scope — only inside functions those callers control the timing of.
 *
 * Vitest's `node` environment (`vitest.config.ts`) provides none of the
 * three, so a bare successful import already is the proof: a top-level
 * reference to any of them would throw a `ReferenceError` before this file's
 * `expect` ever ran. Same technique `lib/data/__tests__/isomorphic.test.ts`
 * uses for the same reason, one directory over.
 */
describe('lib/query is safe to import during a server render', () => {
  it('queryClient has no top-level window/document/navigator reference', async () => {
    await expect(import('@/lib/query/queryClient')).resolves.toBeDefined()
  })

  it('connectivity has no top-level window/document/navigator reference', async () => {
    await expect(import('@/lib/query/connectivity')).resolves.toBeDefined()
  })

  it('useQuery has no top-level window/document/navigator reference', async () => {
    await expect(import('@/lib/query/useQuery')).resolves.toBeDefined()
  })

  it('the barrel re-exports without touching any of the three either', async () => {
    await expect(import('@/lib/query/index')).resolves.toBeDefined()
  })
})
