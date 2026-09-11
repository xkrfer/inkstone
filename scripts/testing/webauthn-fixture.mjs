import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'

const hash = (value) => createHash('sha256').update(value).digest()
const b64 = (value) => Buffer.from(value).toString('base64url')
function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n])
  if (n < 256) return Buffer.from([(major << 5) | 24, n])
  const out = Buffer.alloc(3)
  out[0] = (major << 5) | 25
  out.writeUInt16BE(n, 1)
  return out
}
export function cbor(value) {
  if (typeof value === 'number') return head(value < 0 ? 1 : 0, value < 0 ? -1 - value : value)
  if (typeof value === 'string') { const b = Buffer.from(value); return Buffer.concat([head(3, b.length), b]) }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value])
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])])
  throw new Error('Unsupported fixture CBOR value')
}
export function authenticator(origin = 'http://localhost:7712') {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const idBytes = randomBytes(32)
  const id = b64(idBytes)
  let userHandle
  let counter = 0
  function data(rpId, flags, count) {
    const n = Buffer.alloc(4); n.writeUInt32BE(count)
    return Buffer.concat([hash(rpId), Buffer.from([flags]), n])
  }
  return {
    id,
    register(options, overrides = {}) {
      userHandle = options.user.id
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, ...overrides.client }))
      const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]))
      const length = Buffer.alloc(2); length.writeUInt16BE(idBytes.length)
      const authData = Buffer.concat([data(overrides.rpId ?? options.rp.id, overrides.flags ?? 0x45, 0), Buffer.alloc(16), length, idBytes, cose])
      return { id, rawId: id, type: 'public-key', clientExtensionResults: { credProps: { rk: true } }, response: {
        clientDataJSON: b64(client), transports: ['internal'],
        attestationObject: b64(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))),
      } }
    },
    authenticate(options, overrides = {}) {
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, ...overrides.client }))
      const authData = data(overrides.rpId ?? options.rpId, overrides.flags ?? 5, overrides.counter ?? ++counter)
      const signature = sign('sha256', Buffer.concat([authData, hash(client)]), privateKey)
      return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: {
        clientDataJSON: b64(client), authenticatorData: b64(authData), signature: b64(signature), userHandle: overrides.userHandle ?? userHandle,
      } }
    },
  }
}
