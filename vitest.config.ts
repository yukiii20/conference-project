import { defineConfig } from 'vitest/config'

// Frontend unit tests only — server/tests/* is a separate Vitest project
// (its own config, run via `npm test` from server/) that needs a live DB
// connection and would otherwise get picked up by this root-level run too.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
})
