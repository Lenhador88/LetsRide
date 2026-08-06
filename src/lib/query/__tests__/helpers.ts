/**
 * Shared by the `lib/query/` test files. Not itself a `*.test.ts`, so
 * Vitest's `include` glob in `vitest.config.ts` never tries to run it as a
 * suite on its own.
 */

/** A promise plus the functions that settle it, for tests that need to
 * control exactly when a fetch resolves relative to another one — the
 * race-safety tests in particular. */
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * Drains the microtask queue. `queryClient.ts`'s fetch chain is
 * `Promise.resolve().then(fetcher).then(...).catch(...).finally(...)` — at
 * most a handful of hops — so a fixed, generous number of `await
 * Promise.resolve()` turns is simpler and more robust here than trying to
 * detect "settled" from outside. Independent of real vs. fake timers, since
 * it never touches `setTimeout`.
 */
export async function flushMicrotasks(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve()
  }
}
