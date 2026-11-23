// Runs every case through the real zod schemas in server/src (read-only import).
import fs from 'node:fs'
const [casesFile, outFile] = process.argv.slice(2)
const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'))
const modules: Record<string, Record<string, any>> = {}
const results = []
for (const c of cases) {
  const [mod, name] = c.schema.split('.')
  modules[mod] ??= await import(`../../../../server/src/modules/${mod}/validation.ts`)
  const schema = modules[mod][name]
  if (!schema) throw new Error(`No schema ${c.schema}`)
  const r = schema.safeParse(c.input)
  results.push(r.success
    ? { id: c.id, success: true, data: r.data }
    : { id: c.id, success: false, issues: r.error.issues.map((i: any) => [i.path, i.message]) })
}
fs.writeFileSync(outFile, JSON.stringify(results))
