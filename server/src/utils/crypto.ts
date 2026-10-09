import { randomBytes, createHash } from 'node:crypto'

/** A random 32-byte token, hex-encoded (64 chars) — used for session and reset tokens. */
export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
