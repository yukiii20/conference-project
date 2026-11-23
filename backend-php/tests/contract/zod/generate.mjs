// Expands sample inputs into many variants (missing / null / wrong-typed / blank / long / padded values)
// so the zod (Node) and PHP validators can be compared on the same inputs.
import fs from 'node:fs'
const files = process.argv.slice(2, -1), out = process.argv.at(-1)
const cases = []
const variants = (v) => [undefined, null, 123, 0, -1, 1.5, true, false, '', '   ', 'x', '  padded  ', 'A'.repeat(301), 'a'.repeat(5001), '😀😀', [], ['a'], {}, { a: 1 }, 'NOT-A-UUID', '2026-10-11', '2026-10-11T10:00:00Z', '2026-10-11T10:00:00+05:45', '42', ' 7 ', 'abc@', 'UPPER', 'x@y.com']
for (const file of files) {
  const samples = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const [schema, list] of Object.entries(samples)) {
    list.forEach((sample, si) => {
      cases.push({ id: `${schema}#${si}`, schema, input: sample })
      cases.push({ id: `${schema}#${si}:empty`, schema, input: {} })
      cases.push({ id: `${schema}#${si}:array`, schema, input: [] })
      cases.push({ id: `${schema}#${si}:null`, schema, input: null })
      for (const key of Object.keys(sample)) {
        variants().forEach((v, vi) => {
          const input = { ...sample }
          if (v === undefined) delete input[key]; else input[key] = v
          cases.push({ id: `${schema}#${si}:${key}:${vi}`, schema, input })
        })
      }
      cases.push({ id: `${schema}#${si}:extra`, schema, input: { ...sample, unexpected_key: 'x' } })
    })
  }
}
fs.writeFileSync(out, JSON.stringify(cases))
console.log(`${cases.length} cases`)
