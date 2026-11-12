import { existsSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { LocalDriver, R2Driver, S3Driver, assertSafeKey, s3OptionsFromEnv, setStorageDriverForTesting, storage } from '../src/storage/driver.js'
import { PRIVATE_DIR, PUBLIC_DIR } from '../src/storage/paths.js'
import { deletePublicFile, readPublicFile, savePublicFile } from '../src/storage/fileStore.js'
import { FILE_MISSING_CODE, etagMatches, publicFileHandler, sendPrivateFile } from '../src/storage/send.js'
import { migrateStorage, parseArgs } from '../src/scripts/migrateStorage.js'
import { createApp } from '../src/app.js'

afterEach(() => {
  setStorageDriverForTesting(null)
  vi.restoreAllMocks()
})

describe('assertSafeKey', () => {
  it.each(['logos/a.png', 'certificates/c1/signatures/x.webp'])('accepts %s', (key) => {
    expect(() => assertSafeKey(key)).not.toThrow()
  })
  it.each(['', '/etc/passwd', '../private/x.pdf', 'logos/../../x', 'a//b', 'a\\b'])('rejects %j', (key) => {
    expect(() => assertSafeKey(key)).toThrow()
  })
})

describe('tests use the local driver', () => {
  it('never R2, whatever server/.env says', () => {
    expect(storage().name).toBe('local')
  })
})

describe('LocalDriver', () => {
  const local = new LocalDriver()

  it('put / get / open / exists / delete round-trip in each area', async () => {
    for (const [area, dir] of [
      ['public', PUBLIC_DIR],
      ['private', PRIVATE_DIR],
    ] as const) {
      const key = `unit/${crypto.randomUUID()}.txt`
      await local.put(area, key, Buffer.from('hello'))
      expect(existsSync(path.join(dir, key))).toBe(true)
      expect((await local.get(area, key))?.toString()).toBe('hello')
      const opened = await local.open(area, key)
      expect(opened?.size).toBe(5)
      opened?.stream.destroy()
      expect(await local.exists(area, key)).toBe(true)
      await local.delete(area, key)
      expect(await local.exists(area, key)).toBe(false)
    }
  })

  it('missing files: get/open return null, delete is not an error', async () => {
    expect(await local.get('public', 'unit/missing.png')).toBeNull()
    expect(await local.open('private', 'unit/missing.pdf')).toBeNull()
    await expect(local.delete('public', 'unit/missing.png')).resolves.toBeUndefined()
  })

  it('refuses keys that would escape the storage folder', async () => {
    await expect(local.put('public', '../escape.txt', Buffer.from('x'))).rejects.toThrow('Unsafe storage key.')
  })

  it('fileStore helpers go through the active driver', async () => {
    const key = `unit/${crypto.randomUUID()}.png`
    await savePublicFile(key, Buffer.from('png'))
    expect((await readPublicFile(key))?.toString()).toBe('png')
    await deletePublicFile(key)
    expect(await readPublicFile(key)).toBeNull()
    expect(await readPublicFile(null)).toBeNull()
  })
})

describe('R2Driver (S3 client mocked - no network)', () => {
  function mockSend(impl: (command: unknown) => unknown) {
    return vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: unknown) => impl(command)) as never)
  }
  const r2 = () => new R2Driver('acct', 'key', 'secret', 'my-bucket')

  it('stores each area under its own prefix in one bucket, with a content type', async () => {
    const send = mockSend(() => ({}))
    await r2().put('public', 'logos/a.png', Buffer.from('x'))
    await r2().put('private', 'submissions/s1/abstract-v1-ab.pdf', Buffer.from('y'))
    const [first, second] = send.mock.calls.map((c) => c[0] as PutObjectCommand)
    expect(first).toBeInstanceOf(PutObjectCommand)
    expect(first!.input).toMatchObject({ Bucket: 'my-bucket', Key: 'public/logos/a.png', ContentType: 'image/png' })
    expect(second!.input).toMatchObject({ Key: 'private/submissions/s1/abstract-v1-ab.pdf', ContentType: 'application/pdf' })
  })

  it('reads an object back', async () => {
    mockSend((cmd) => {
      expect(cmd).toBeInstanceOf(GetObjectCommand)
      return { Body: Readable.from([Buffer.from('he'), Buffer.from('llo')]), ContentLength: 5, ContentType: 'text/plain' }
    })
    expect((await r2().get('public', 'a/b.txt'))?.toString()).toBe('hello')
  })

  it('treats NoSuchKey / 404 as missing', async () => {
    mockSend(() => {
      throw Object.assign(new Error('nope'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } })
    })
    expect(await r2().get('public', 'a/missing.png')).toBeNull()
    expect(await r2().open('private', 'a/missing.pdf')).toBeNull()
    expect(await r2().exists('private', 'a/missing.pdf')).toBe(false)
  })

  it('passes other errors through (e.g. bad credentials)', async () => {
    mockSend(() => {
      throw Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })
    })
    await expect(r2().get('public', 'a/b.png')).rejects.toThrow('denied')
  })

  it('exists uses HEAD and delete uses DeleteObject', async () => {
    const send = mockSend(() => ({}))
    expect(await r2().exists('public', 'a/b.png')).toBe(true)
    await r2().delete('public', 'a/b.png')
    expect(send.mock.calls[0]![0]).toBeInstanceOf(HeadObjectCommand)
    expect(send.mock.calls[1]![0]).toBeInstanceOf(DeleteObjectCommand)
  })

  it('refuses unsafe keys before calling R2', async () => {
    const send = mockSend(() => ({}))
    await expect(r2().put('public', '../private/x.pdf', Buffer.from('x'))).rejects.toThrow('Unsafe storage key.')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('sending files', () => {
  function app() {
    const a = express()
    a.get('/files/public/*', publicFileHandler)
    a.get('/private/:key', async (req, res, next) => {
      try {
        await sendPrivateFile(res, `unit/${req.params.key}`, 'Résumé "final".pdf')
      } catch (err) {
        next(err)
      }
    })
    a.use((err: { statusCode?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.statusCode ?? 500).json({ error: { message: err.message } })
    })
    return a
  }

  it('serves a public file with a short cache and an ETag (never immutable), and 404s for missing or unsafe paths', async () => {
    const key = `unit/${crypto.randomUUID()}.png`
    await storage().put('public', key, Buffer.from('img'))
    const ok = await request(app()).get(`/files/public/${key}`)
    expect(ok.status).toBe(200)
    expect(ok.headers['content-type']).toBe('image/png')
    expect(ok.headers['cache-control']).toBe('public, max-age=3600')
    expect(ok.headers.etag).toBeTruthy()
    const missing = await request(app()).get('/files/public/unit/nope.png')
    expect(missing.status).toBe(404)
    expect(missing.headers['cache-control']).toBe('no-store')
    expect(missing.body.error.code).toBe(FILE_MISSING_CODE)
    expect((await request(app()).get('/files/public/..%2Fprivate%2Fx.pdf')).status).toBe(404)
  })

  it('answers 304 when the browser already has this version, and 200 again after the file is replaced', async () => {
    const key = `unit/${crypto.randomUUID()}.png`
    await storage().put('public', key, Buffer.from('first'))
    const etag = (await request(app()).get(`/files/public/${key}`)).headers.etag as string
    expect((await request(app()).get(`/files/public/${key}`).set('If-None-Match', etag)).status).toBe(304)
    // Same path, new content (different size): the old ETag no longer matches.
    await storage().put('public', key, Buffer.from('second version'))
    const replaced = await request(app()).get(`/files/public/${key}`).set('If-None-Match', etag)
    expect(replaced.status).toBe(200)
    expect(replaced.body.toString()).toBe('second version')
  })

  it('answers HEAD with headers only', async () => {
    const key = `unit/${crypto.randomUUID()}.png`
    await storage().put('public', key, Buffer.from('img'))
    const head = await request(app()).head(`/files/public/${key}`)
    expect(head.status).toBe(200)
    expect(head.headers['content-length']).toBe('3')
  })

  it('the real app serves public files through the same handler with the local driver (no express.static, no immutable)', async () => {
    const key = `unit/${crypto.randomUUID()}.webp`
    await storage().put('public', key, Buffer.from('webp'))
    const res = await request(createApp()).get(`/files/public/${key}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/webp')
    expect(res.headers['cache-control']).toBe('public, max-age=3600')
  })

  it('streams a private file as an attachment with a safe filename', async () => {
    await storage().put('private', 'unit/cert.pdf', Buffer.from('%PDF-1.4'))
    const res = await request(app()).get('/private/cert.pdf')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toContain('attachment; filename="R_sum_ _final_.pdf"')
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22.pdf")
  })

  it('a missing private file is a clean 404, not a crash', async () => {
    const res = await request(app()).get('/private/gone.pdf')
    expect(res.status).toBe(404)
    expect(res.body.error.message).toBe('This file is missing from storage. Please ask the author to upload it again.')
  })

  it('never lets a shared cache keep a private file', async () => {
    await storage().put('private', 'unit/private-cache.pdf', Buffer.from('%PDF-1.4'))
    const res = await request(app()).get('/private/private-cache.pdf')
    expect(res.headers['cache-control']).toBe('private, no-store')
  })
})

describe('etagMatches', () => {
  it('compares weakly and handles lists and *', () => {
    expect(etagMatches('W/"abc"', '"abc"')).toBe(true)
    expect(etagMatches('"x", "abc"', 'W/"abc"')).toBe(true)
    expect(etagMatches('*', '"abc"')).toBe(true)
    expect(etagMatches('"other"', '"abc"')).toBe(false)
    expect(etagMatches(undefined, '"abc"')).toBe(false)
    expect(etagMatches('"abc"', null)).toBe(false)
  })
})

describe('S3Driver (any S3-compatible bucket, client mocked)', () => {
  it('uses the given endpoint, region and bucket with path-style URLs and the same key layout', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation((async () => ({})) as never)
    const driver = new S3Driver({
      endpoint: 'https://s3.us-west-004.backblazeb2.com',
      region: 'us-west-004',
      bucket: 'cms-files',
      accessKeyId: 'k',
      secretAccessKey: 's',
    })
    expect(driver.name).toBe('s3')
    await driver.put('public', 'speakers/a.jpg', Buffer.from('x'))
    expect((send.mock.calls[0]![0] as PutObjectCommand).input).toMatchObject({ Bucket: 'cms-files', Key: 'public/speakers/a.jpg', ContentType: 'image/jpeg' })
    const config = (driver as unknown as { client: S3Client }).client.config
    expect(config.forcePathStyle).toBe(true)
    expect(await config.region()).toBe('us-west-004')
  })

  it('passes the object ETag and Last-Modified through for HTTP caching', async () => {
    const modified = new Date('2026-11-01T00:00:00Z')
    vi.spyOn(S3Client.prototype, 'send').mockImplementation((async () => ({
      Body: Readable.from([Buffer.from('x')]),
      ContentLength: 1,
      ContentType: 'image/png',
      ETag: '"etag-1"',
      LastModified: modified,
    })) as never)
    const driver = new S3Driver({ region: 'auto', endpoint: 'https://x.example', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' })
    const opened = await driver.open('public', 'a.png')
    expect(opened?.etag).toBe('"etag-1"')
    expect(opened?.lastModified).toEqual(modified)
    opened?.stream.destroy()
  })

  it('R2Driver is an S3Driver on the account endpoint', () => {
    expect(new R2Driver('acct', 'k', 's', 'b')).toBeInstanceOf(S3Driver)
  })
})

describe('s3OptionsFromEnv', () => {
  it('reads the generic S3_* settings', () => {
    expect(
      s3OptionsFromEnv({ S3_ENDPOINT: 'https://e.example', S3_REGION: 'auto', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' }),
    ).toEqual({ endpoint: 'https://e.example', region: 'auto', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's', forcePathStyle: undefined })
  })

  it('falls back to the older R2_* settings', () => {
    expect(s3OptionsFromEnv({ R2_ACCOUNT_ID: 'acct', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' })).toMatchObject({
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      bucket: 'b',
    })
  })

  it('returns null when nothing complete is set', () => {
    expect(s3OptionsFromEnv({ S3_BUCKET: 'b' })).toBeNull()
  })
})

describe('migrate-storage script', () => {
  async function folder() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cms-migrate-'))
    await mkdir(path.join(root, 'public', 'logos'), { recursive: true })
    await mkdir(path.join(root, 'private', 'submissions', 's1'), { recursive: true })
    await writeFile(path.join(root, 'public', 'logos', 'a.png'), 'png')
    await writeFile(path.join(root, 'private', 'submissions', 's1', 'abstract-v1-x.pdf'), '%PDF')
    return root
  }

  it('dry run copies nothing, then --apply copies each file under the same relative key', async () => {
    const root = await folder()
    const target = new LocalDriver()
    const put = vi.spyOn(target, 'put').mockResolvedValue()
    vi.spyOn(target, 'exists').mockResolvedValue(false)
    const dry = await migrateStorage(target, { from: root, apply: false, overwrite: false, log: () => {} })
    expect(dry).toMatchObject({ found: 2, wouldCopy: 2, copied: 0 })
    expect(put).not.toHaveBeenCalled()
    const real = await migrateStorage(target, { from: root, apply: true, overwrite: false, log: () => {} })
    expect(real).toMatchObject({ found: 2, copied: 2, failed: 0 })
    expect(put.mock.calls.map((c) => `${c[0]}:${c[1]}`).sort()).toEqual(['private:submissions/s1/abstract-v1-x.pdf', 'public:logos/a.png'])
    await rm(root, { recursive: true, force: true })
  })

  it('skips files already in the bucket unless --overwrite', async () => {
    const root = await folder()
    const target = new LocalDriver()
    const put = vi.spyOn(target, 'put').mockResolvedValue()
    vi.spyOn(target, 'exists').mockResolvedValue(true)
    expect(await migrateStorage(target, { from: root, apply: true, overwrite: false, log: () => {} })).toMatchObject({ skipped: 2, copied: 0 })
    expect(put).not.toHaveBeenCalled()
    expect(await migrateStorage(target, { from: root, apply: true, overwrite: true, log: () => {} })).toMatchObject({ copied: 2 })
    await rm(root, { recursive: true, force: true })
  })

  it('parses --from, --apply and --overwrite (dry run by default)', () => {
    expect(parseArgs([])).toMatchObject({ apply: false, overwrite: false })
    expect(parseArgs(['--from', 'x', '--apply', '--overwrite'])).toMatchObject({ from: path.resolve('x'), apply: true, overwrite: true })
  })
})
