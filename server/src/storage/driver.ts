import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { env } from '../config/env.js'
import { PRIVATE_DIR, PUBLIC_DIR } from './paths.js'

/**
 * Every uploaded or generated file goes through this one interface.
 *
 * - `public`  : logos, banners, photos, certificate backgrounds/signatures. Served to anyone at
 *               /files/public/<key> (see app.ts).
 * - `private` : submission files, certificate PDFs, abstract books. Only ever sent by a route
 *               that has already checked permission.
 *
 * Keys are the relative paths stored in the database (e.g. "logos/<uuid>.png"). They are always
 * built by the server (buildPublicPath / buildPrivatePath), never taken from client input.
 */
export type StorageArea = 'public' | 'private'

export type StoredObject = { stream: Readable; size: number | null; contentType: string | null }

export interface StorageDriver {
  readonly name: 'local' | 'r2'
  put(area: StorageArea, key: string, body: Buffer, contentType?: string): Promise<void>
  /** null when the file does not exist. */
  get(area: StorageArea, key: string): Promise<Buffer | null>
  /** null when the file does not exist. */
  open(area: StorageArea, key: string): Promise<StoredObject | null>
  exists(area: StorageArea, key: string): Promise<boolean>
  /** Missing files are not an error. */
  delete(area: StorageArea, key: string): Promise<void>
}

/** Rejects anything that could escape its folder ("..", absolute paths, backslashes). */
export function assertSafeKey(key: string): void {
  if (!key || key.startsWith('/') || key.includes('\\') || key.split('/').some((part) => part === '..' || part === '')) {
    throw new Error('Unsafe storage key.')
  }
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
}

export function contentTypeFor(key: string): string {
  return CONTENT_TYPES[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

function isNotFound(err: unknown): boolean {
  const e = err as { code?: string; name?: string; $metadata?: { httpStatusCode?: number } }
  return e?.code === 'ENOENT' || e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404
}

// ---------------------------------------------------------------------------------- local disk

export class LocalDriver implements StorageDriver {
  readonly name = 'local' as const

  private full(area: StorageArea, key: string): string {
    assertSafeKey(key)
    return path.join(area === 'public' ? PUBLIC_DIR : PRIVATE_DIR, key)
  }

  async put(area: StorageArea, key: string, body: Buffer): Promise<void> {
    const full = this.full(area, key)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, body)
  }

  async get(area: StorageArea, key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.full(area, key))
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async open(area: StorageArea, key: string): Promise<StoredObject | null> {
    const full = this.full(area, key)
    try {
      const info = await stat(full)
      return { stream: createReadStream(full), size: info.size, contentType: contentTypeFor(key) }
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async exists(area: StorageArea, key: string): Promise<boolean> {
    try {
      await stat(this.full(area, key))
      return true
    } catch (err) {
      if (isNotFound(err)) return false
      throw err
    }
  }

  async delete(area: StorageArea, key: string): Promise<void> {
    try {
      await unlink(this.full(area, key))
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
  }
}

// ---------------------------------------------------------------------------------- Cloudflare R2

/**
 * Cloudflare R2 through its S3-compatible API. One private bucket holds both areas under
 * "public/" and "private/" prefixes; the bucket itself is never made public - public files
 * are still served by this backend at /files/public/..., so existing URLs keep working.
 */
export class R2Driver implements StorageDriver {
  readonly name = 'r2' as const
  private readonly client: S3Client

  constructor(
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
    private readonly bucket: string,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })
  }

  private key(area: StorageArea, key: string): string {
    assertSafeKey(key)
    return `${area}/${key}`
  }

  async put(area: StorageArea, key: string, body: Buffer, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.key(area, key), Body: body, ContentType: contentType ?? contentTypeFor(key) }),
    )
  }

  async get(area: StorageArea, key: string): Promise<Buffer | null> {
    const object = await this.open(area, key)
    if (!object) return null
    const chunks: Buffer[] = []
    for await (const chunk of object.stream) chunks.push(Buffer.from(chunk as Uint8Array))
    return Buffer.concat(chunks)
  }

  async open(area: StorageArea, key: string): Promise<StoredObject | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(area, key) }))
      if (!out.Body) return null
      return { stream: out.Body as Readable, size: out.ContentLength ?? null, contentType: out.ContentType ?? contentTypeFor(key) }
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async exists(area: StorageArea, key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(area, key) }))
      return true
    } catch (err) {
      if (isNotFound(err)) return false
      throw err
    }
  }

  async delete(area: StorageArea, key: string): Promise<void> {
    // S3/R2 DeleteObject succeeds for a missing key, matching "missing is not an error".
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(area, key) }))
  }
}

// ---------------------------------------------------------------------------------- selection

let driver: StorageDriver | null = null

export function createDriverFromEnv(): StorageDriver {
  if (env.STORAGE_DRIVER === 'r2') {
    return new R2Driver(env.R2_ACCOUNT_ID!, env.R2_ACCESS_KEY_ID!, env.R2_SECRET_ACCESS_KEY!, env.R2_BUCKET!)
  }
  return new LocalDriver()
}

export function storage(): StorageDriver {
  driver ??= createDriverFromEnv()
  return driver
}

/** Test seam. */
export function setStorageDriverForTesting(next: StorageDriver | null): void {
  driver = next
}
