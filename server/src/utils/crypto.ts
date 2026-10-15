import { randomBytes, createHash } from 'node:crypto'

/** A random 32-byte token, hex-encoded (64 chars) — used for session and reset tokens. */
export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** A random URL-safe token of exactly `length` characters — used for qr_token / verification_token. */
export function generateUrlSafeToken(length: number): string {
  let token = ''
  while (token.length < length) {
    token += randomBytes(length).toString('base64url')
  }
  return token.slice(0, length)
}
