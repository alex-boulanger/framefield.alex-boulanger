import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Deliberately does not reuse `vite.config.ts`.
 *
 * The app config loads the TanStack Start and nitro plugins, which spin up a
 * server build pipeline that these tests have no use for. The renderer is plain
 * TypeScript with no React and no DOM, so it only needs the path alias.
 */
export default defineConfig({
  resolve: {
    alias: {
      '#': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
