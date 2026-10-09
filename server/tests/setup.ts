// Runs before every test file's own imports. dotenv (loaded later by
// src/config/env.ts) never overwrites a variable that's already set, so
// forcing DB_NAME here redirects the whole app at the test database without
// needing a second .env file.
process.env.DB_NAME = 'conference_cms_test'
process.env.NODE_ENV = 'test'
// Keeps uploaded test files out of server/storage (the dev server's real
// storage) — see tests/globalSetup.ts for the matching cleanup.
process.env.STORAGE_ROOT = 'storage-test'
