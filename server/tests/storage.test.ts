import { existsSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { LocalDriver, R2Driver, assertSafeKey, setStorageDriverForTesting, storage } from '../src/storage/driver.js'
import { PRIVATE_DIR, PUBLIC_DIR } from '../src/storage/paths.js'
import { deletePublicFile, readPublicFile, savePublicFile } from '../src/storage/fileStore.js'
import { publicFileHandler, sendPrivateFile } from '../src/storage/send.js'

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

  it('serves a public file with long-lived caching, and 404s for missing or unsafe paths', async () => {
    const key = `unit/${crypto.randomUUID()}.png`
    await storage().put('public', key, Buffer.from('img'))
    const ok = await request(app()).get(`/files/public/${key}`)
    expect(ok.status).toBe(200)
    expect(ok.headers['content-type']).toBe('image/png')
    expect(ok.headers['cache-control']).toContain('immutable')
    expect((await request(app()).get('/files/public/unit/nope.png')).status).toBe(404)
    expect((await request(app()).get('/files/public/..%2Fprivate%2Fx.pdf')).status).toBe(404)
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
    expect(res.body.error.message).toMatch(/no longer available/)
  })
})
