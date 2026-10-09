import { rm } from 'node:fs/promises'
import path from 'node:path'

/**
 * Runs once for the whole vitest process (separate from tests/setup.ts,
 * which runs per test file). Removes the disposable storage-test directory
 * tests/setup.ts points uploads at, so repeated runs don't accumulate files.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  return async () => {
    await rm(path.resolve(process.cwd(), 'storage-test'), { recursive: true, force: true })
  }
}
