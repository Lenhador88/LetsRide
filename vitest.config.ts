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
    include: ['src/**/*.test.ts'],
    // Explicit imports from 'vitest' everywhere instead — keeps tsconfig.json
    // untouched rather than adding the "vitest/globals" ambient types.
    globals: false,
  },
})
