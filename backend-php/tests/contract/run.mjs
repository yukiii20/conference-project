// Contract test: runs the same scenarios against the Node backend (reference) and the PHP backend
// and diffs status, headers and JSON bodies after normalising the values that legitimately differ
// (generated ids, timestamps, tokens, per-run test data).
//
//   node tests/contract/run.mjs [scenario-file ...]      (default: every tests/contract/scenarios/*.mjs)
//   NODE_BASE=http://localhost:4100 PHP_BASE=http://127.0.0.1:4200
//
// Each backend gets its own cookie jars and its own RUN marker (written into emails / names the
// scenario creates), so both can run against the same seeded test database without colliding.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

const here = path.dirname(fileURLToPath(import.meta.url))
const NODE = process.env.NODE_BASE ?? 'http://localhost:4100'
const PHP = process.env.PHP_BASE ?? 'http://127.0.0.1:4200'
const IGNORED_HEADERS = new Set(['date', 'connection', 'keep-alive', 'host', 'transfer-encoding', 'x-powered-by'])

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(path.join(here, 'scenarios')).filter((f) => f.endsWith('.mjs')).sort().map((f) => path.join(here, 'scenarios', f))

function makeClient(base, run) {
  const jars = {}
  const vars = {}
  return {
    run,
    vars,
    async send(step) {
      const jar = (jars[step.as ?? 'default'] ??= {})
      const sub = (v) => (typeof v === 'string' ? v.replaceAll('$RUN', run).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '') : v)
      const deep = (v) => (Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : sub(v))
      const headers = { ...(step.headers ? deep(step.headers) : {}) }
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
      if (cookie) headers.cookie = cookie
      let body
      if (step.raw !== undefined) body = step.raw
      else if (step.body !== undefined) {
        body = JSON.stringify(deep(step.body))
        headers['content-type'] ??= 'application/json'
      }
      const res = await fetch(base + sub(step.path), { method: step.method ?? 'GET', headers, body, redirect: 'manual' })
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';')
        const i = pair.indexOf('=')
        const name = pair.slice(0, i)
        const value = pair.slice(i + 1)
        if (value === '') delete jar[name]
        else jar[name] = value
      }
      const buf = Buffer.from(await res.arrayBuffer())
      const text = res.headers.get('content-encoding') === 'gzip' ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8')
      let json
      try {
        json = JSON.parse(text)
      } catch {
        json = undefined
      }
      if (step.save && json) for (const [k, p] of Object.entries(step.save)) vars[k] = p.split('.').reduce((o, key) => o?.[key], json)
      const hdrs = {}
      res.headers.forEach((v, k) => {
        if (!IGNORED_HEADERS.has(k)) hdrs[k] = k === 'set-cookie' ? res.headers.getSetCookie() : v
      })
      return { status: res.status, headers: hdrs, text, json }
    },
  }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z/g

function normalizeString(s, run) {
  return s
    .replaceAll(run, '<RUN>')
    .replace(UUID, '<uuid>')
    .replace(ISO, '<ts>')
    .replace(/token=[A-Za-z0-9_-]{20,}/g, 'token=<token>')
}

function normalize(v, run) {
  if (typeof v === 'string') return normalizeString(v, run)
  if (Array.isArray(v)) return v.map((x) => normalize(x, run))
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v)) {
      out[k] = ['uptime_seconds', 'latency_ms'].includes(k) && typeof v[k] === 'number' ? '<n>' : normalize(v[k], run)
    }
    return out
  }
  return v
}

function normalizeHeaders(h, run, rawBodiesEqual) {
  const out = {}
  for (const [k, v] of Object.entries(h)) {
    if (k === 'etag' && !rawBodiesEqual) out[k] = '<etag>'
    else if (k === 'content-length' && !rawBodiesEqual) out[k] = '<len>'
    else if (k === 'set-cookie')
      out[k] = v.map((c) => c.replace(/^(\w+)=[^;]+/, '$1=<value>').replace(/Expires=[^;]+/, 'Expires=<date>'))
    else if (k === 'ratelimit-reset' || k === 'retry-after') out[k] = '<s>'
    else out[k] = normalizeString(String(v), run)
  }
  return out
}

function diff(a, b, p = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return []
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    const keyOrder = Array.isArray(a) || JSON.stringify(Object.keys(a)) === JSON.stringify(Object.keys(b)) ? [] : [`${p || '.'}: key order ${JSON.stringify(Object.keys(a))} vs ${JSON.stringify(Object.keys(b))}`]
    return [...keyOrder, ...keys.flatMap((k) => diff(a[k], b[k], `${p}.${k}`))]
  }
  return [`${p || '.'}: node=${JSON.stringify(a)} php=${JSON.stringify(b)}`]
}

let failures = 0
let total = 0
for (const file of files) {
  const { default: scenarios } = await import(pathToFileURL(path.resolve(file)).href)
  for (const scenario of scenarios) {
    const stamp = process.env.STAMP ? `${process.env.STAMP}${scenarios.indexOf(scenario)}` : Date.now().toString(36)
    const node = makeClient(NODE, `zn${stamp}`)
    const php = makeClient(PHP, `zp${stamp}`)
    for (const [i, step] of scenario.steps.entries()) {
      total++
      const label = `${path.basename(file)} > ${scenario.name} > #${i + 1} ${step.method ?? 'GET'} ${step.path}`
      const [a, b] = [await node.send(step), await php.send(step)]
      const rawEqual = (step.method ?? 'GET') !== 'HEAD' && a.text.replaceAll(node.run, '<RUN>') === b.text.replaceAll(php.run, '<RUN>')
      const left = { status: a.status, headers: normalizeHeaders(a.headers, node.run, rawEqual), body: a.json !== undefined ? normalize(a.json, node.run) : normalizeString(a.text, node.run) }
      const right = { status: b.status, headers: normalizeHeaders(b.headers, php.run, rawEqual), body: b.json !== undefined ? normalize(b.json, php.run) : normalizeString(b.text, php.run) }
      const problems = diff(left, right)
      if (step.expectStatus && a.status !== step.expectStatus) problems.unshift(`node returned ${a.status}, scenario expects ${step.expectStatus}`)
      if (problems.length) {
        failures++
        console.log(`FAIL ${label}`)
        for (const line of problems.slice(0, 15)) console.log(`   ${line}`)
      } else if (process.env.VERBOSE) console.log(`ok   ${label}`)
    }
  }
}
console.log(`\n${total - failures}/${total} steps identical`)
process.exit(failures ? 1 : 0)
