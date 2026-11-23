import fs from 'node:fs'
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x)) : x))
let bad = 0
a.forEach((r, i) => {
  const s = b[i]
  if (canon(r) !== canon(s)) {
    bad++
    if (bad <= 25) console.log(`DIFF ${r.id}\n  node: ${canon(r)}\n  php : ${canon(s)}`)
  }
})
console.log(`${a.length - bad}/${a.length} identical`)
process.exit(bad ? 1 : 0)
