import { describe, expect, it } from 'vitest'
import { passkeyConfig, passkeyName } from './passkey-config'

describe('passkey deployment configuration', () => {
  it.each([undefined, '', 'broken', 'http://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com/?query=1', 'https://example.com/#fragment', 'file:///tmp/a'])('disables invalid configuration %s', (PUBLIC_URL) => {
    expect(passkeyConfig({ PUBLIC_URL })).toBeNull()
  })
  it('derives an exact origin and host-only RP ID', () => {
    expect(passkeyConfig({ PUBLIC_URL: 'https://Example.com:8443/', APP_NAME: 'Notes' })).toEqual({ origin: 'https://example.com:8443', rpID: 'example.com', rpName: 'Notes' })
    expect(passkeyConfig({ PUBLIC_URL: 'http://localhost:7712' })?.rpID).toBe('localhost')
  })
  it('validates trimmed unicode names without control characters', () => {
    expect(passkeyName('  \u624b\u673a  ')).toBe('\u624b\u673a')
    for (const value of ['', ' ', 1, null, 'a'.repeat(65), 'a\nb']) expect(passkeyName(value)).toBeNull()
    expect(passkeyName('🔑'.repeat(64))).not.toBeNull()
  })
})
