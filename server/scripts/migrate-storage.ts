/**
 * Copies an existing local storage folder into the S3-compatible bucket. Dry run by default.
 * Usage (from server/):  npm run migrate-storage [-- --from <folder>] [-- --apply] [-- --overwrite]
 * See src/scripts/migrateStorage.ts for details.
 */
import 'dotenv/config'
import { main } from '../src/scripts/migrateStorage.js'

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
