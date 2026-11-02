import { defineConfig } from 'vitest/config'

// environmentMatchGlobs was removed; projects replace it: web/** runs in jsdom, the rest in node.
export default defineConfig({
  test: {
    projects: [
      // Any *.test.ts outside web/ runs in node, so a test in a new top-level folder is never silently skipped.
      { test: { name: 'node', environment: 'node', include: ['**/*.test.ts'], exclude: ['web/**', '**/node_modules/**', 'dist/**'] } },
      { test: { name: 'web', environment: 'jsdom', include: ['web/**/*.test.{ts,tsx}'], setupFiles: ['web/src/test-setup.ts'], testTimeout: 15000 } },
    ],
  },
})
