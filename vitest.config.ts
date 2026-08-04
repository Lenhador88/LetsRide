import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// node environment only — no React components exist against the v2 design
// yet, so there is nothing here that needs jsdom. Add it when the first v2
// component lands.
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
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    // Explicit imports from 'vitest' everywhere instead — keeps tsconfig.json
    // untouched rather than adding the "vitest/globals" ambient types.
    globals: false,
    // The date formatters resolve against the *local* zone, so without this a
    // "SAT, 16 NOV" assertion passes on a UTC runner and fails on a laptop in
    // Amsterdam. Pinning it here makes the suite say the same thing everywhere;
    // it does not pin the app, whose own timezone behaviour is a live question
    // recorded in docs/FIGMA-FIDELITY-TODO.md.
    env: { TZ: 'UTC' },
  },
})
