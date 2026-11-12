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

export type StoredObject = {
  stream: Readable
  size: number | null
  contentType: string | null
  /** Quoted entity tag for HTTP caching (If-None-Match), when known. */
  etag?: string | null
  lastModified?: Date | null
}

export interface StorageDriver {
  readonly name: 'local' | 's3'
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
  gif: 'image/gif',
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
      return {
        stream: createReadStream(full),
        size: info.size,
        contentType: contentTypeFor(key),
        // Same shape as express.static's weak ETag: changes whenever the file is replaced.
        etag: `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`,
        lastModified: info.mtime,
      }
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

// ---------------------------------------------------------------------------------- S3-compatible

export type S3DriverOptions = {
  /** e.g. https://<account>.r2.cloudflarestorage.com or https://s3.us-west-004.backblazeb2.com. Omit for AWS S3. */
  endpoint?: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** Path-style URLs (https://endpoint/bucket/key). Defaults to true whenever a custom endpoint is set. */
  forcePathStyle?: boolean
}

/**
 * Any S3-compatible bucket (Cloudflare R2, Backblaze B2, AWS S3, MinIO...). One private bucket
 * holds both areas under "public/" and "private/" prefixes - the same layout as the local
 * storage folder (storage/public/..., storage/private/...), so a key is exactly the relative
 * path saved in the database. The bucket itself is never made public: public files are still
 * served by this backend at /files/public/..., so existing URLs keep working, and private files
 * are only streamed by routes that have checked permission first.
 */
export class S3Driver implements StorageDriver {
  readonly name = 's3' as const
  protected readonly client: S3Client
  protected readonly bucket: string

  constructor(options: S3DriverOptions) {
    this.bucket = options.bucket
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    })
  }

  protected key(area: StorageArea, key: string): string {
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
      return {
        stream: out.Body as Readable,
        size: out.ContentLength ?? null,
        contentType: out.ContentType ?? contentTypeFor(key),
        etag: out.ETag ?? null,
        lastModified: out.LastModified ?? null,
      }
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
    // DeleteObject succeeds for a missing key, matching "missing is not an error".
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(area, key) }))
  }
}

/** Cloudflare R2 shorthand (kept for the older R2_* settings): an S3Driver pointed at the account's R2 endpoint. */
export class R2Driver extends S3Driver {
  constructor(accountId: string, accessKeyId: string, secretAccessKey: string, bucket: string) {
    super({ endpoint: `https://${accountId}.r2.cloudflarestorage.com`, region: 'auto', bucket, accessKeyId, secretAccessKey })
  }
}

// ---------------------------------------------------------------------------------- selection

let driver: StorageDriver | null = null

/** S3 settings from the environment: the generic S3_* variables, or the older R2_* ones. */
type S3EnvKeys =
  | 'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY' | 'S3_FORCE_PATH_STYLE'
  | 'R2_ACCOUNT_ID' | 'R2_ACCESS_KEY_ID' | 'R2_SECRET_ACCESS_KEY' | 'R2_BUCKET'

export function s3OptionsFromEnv(source: Partial<Record<S3EnvKeys, string | undefined>> = env): S3DriverOptions | null {
  if (source.S3_BUCKET && source.S3_ACCESS_KEY_ID && source.S3_SECRET_ACCESS_KEY) {
    return {
      endpoint: source.S3_ENDPOINT || undefined,
      region: source.S3_REGION || 'auto',
      bucket: source.S3_BUCKET,
      accessKeyId: source.S3_ACCESS_KEY_ID,
      secretAccessKey: source.S3_SECRET_ACCESS_KEY,
      forcePathStyle: source.S3_FORCE_PATH_STYLE ? source.S3_FORCE_PATH_STYLE === 'true' : undefined,
    }
  }
  if (source.R2_ACCOUNT_ID && source.R2_BUCKET && source.R2_ACCESS_KEY_ID && source.R2_SECRET_ACCESS_KEY) {
    return {
      endpoint: `https://${source.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      region: 'auto',
      bucket: source.R2_BUCKET,
      accessKeyId: source.R2_ACCESS_KEY_ID,
      secretAccessKey: source.R2_SECRET_ACCESS_KEY,
    }
  }
  return null
}

export function createDriverFromEnv(): StorageDriver {
  if (env.STORAGE_DRIVER === 's3' || env.STORAGE_DRIVER === 'r2') {
    // env.ts has already refused to start without a complete set, so this is never null here.
    return new S3Driver(s3OptionsFromEnv()!)
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
