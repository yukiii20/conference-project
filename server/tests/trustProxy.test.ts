import { describe, expect, it } from 'vitest'
import { parseTrustProxySetting } from '../src/app.js'

describe('parseTrustProxySetting (TRUST_PROXY env parsing)', () => {
  it('parses "true"/"false" as booleans', () => {
    expect(parseTrustProxySetting('true')).toBe(true)
    expect(parseTrustProxySetting('false')).toBe(false)
  })

  it('parses a bare number as the hop count Express expects (Render: exactly "1")', () => {
    expect(parseTrustProxySetting('1')).toBe(1)
    expect(parseTrustProxySetting('2')).toBe(2)
  })

  it('passes through a named Express preset untouched', () => {
    expect(parseTrustProxySetting('loopback')).toBe('loopback')
    expect(parseTrustProxySetting('uniquelocal')).toBe('uniquelocal')
  })
})
