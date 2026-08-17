import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// node environment only, and the first component test did not change that.
// `src/components/postcards/__tests__/PostcardAction.test.tsx` renders through
// `renderToStaticMarkup`, which needs no DOM: it asserts the class list React
// hands the browser, which is where this repo's component defects have actually
// lived. jsdom becomes the answer when something needs a *layout* or an event —
// a measured width, a click, a focus ring — and not before. Adding it earlier
// buys a dependency to assert strings that arrive without one.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  test: {
    environment: 'node',
    // scripts/ is plain .mjs — the Figma snapshot pipeline runs under node, not
    // Next, so its tests sit beside it rather than under src/.
    // `.tsx` is here for component tests — without it a test file rendering JSX
    // is collected by nothing and passes by not running, which looks identical
    // to a green suite.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mjs'],
    // Explicit imports from 'vitest' everywhere instead — keeps tsconfig.json
    // untouched rather than adding the "vitest/globals" ambient types.
    globals: false,
    // Still needed, but NOT for the reason this comment used to give. It cited
    // "SAT, 16 NOV" as the assertion that would break on an Amsterdam laptop;
    // that comes from `formatRideDate`, which now carries its own `timeZone`
    // and renders identically on any runner. The pin covers what is left with
    // no zone of its own — `formatPostcardDate`, and any future formatter that
    // forgets one.
    //
    // Worth knowing what this pin cost once: while the ride formatters *did*
    // take the process zone, UTC here matched UTC on Vercel, so the suite
    // agreed with production and both were two hours wrong together. A pinned
    // zone makes a suite reproducible; it does not make it right, and it will
    // happily reproduce the deployment's bug. See the timezone block in
    // src/lib/__tests__/utils.test.ts, which asserts the offset rather than
    // the string.
    env: { TZ: 'UTC' },
  },
})
