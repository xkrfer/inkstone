import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON, type AuthenticatorTransport,
} from '@simplewebauthn/server'
import type { Env } from '../env'
import { SESSION_TTL_MS } from '@shared/constants'
import { ApiError } from './errors'
import { fromBase64Url, toBase64Url } from './encoding'
import { newId } from './id'
import { PASSKEY_LIMIT, PASSKEY_TTL_MS, passkeyConfig, passkeyName } from './passkey-config'
import { requireCurrentPassword } from './reauth'
import { hashToken, newSessionToken } from './session-store'
import { consumeAttemptBudget, ThrottleError } from './throttle'
import { verifyTotpForPasskey } from './totp-service'

interface Credential {
  id: string; user_id: string; public_key: string; counter: number; transports: string
  device_type: 'singleDevice' | 'multiDevice'; backed_up: number; name: string
  created_at: number; last_used_at: number | null; revision: number
}
interface Challenge {
  id: string; challenge: string; user_id: string | null; session_id: string | null
  browser_hash: string | null; purpose: string; expires_at: number; claimed_by: string | null
}
type Config = NonNullable<ReturnType<typeof passkeyConfig>>
const TOTP_STATE = `COALESCE((SELECT recovery_generation FROM totp_credentials WHERE user_id = webauthn_challenges.user_id AND enabled_at IS NOT NULL), '')`
const AUTHORIZED = `EXISTS (SELECT 1 FROM users u JOIN sessions s ON s.user_id = u.id
  WHERE u.id = webauthn_challenges.user_id AND u.password_hash = webauthn_challenges.password_hash
  AND s.id = webauthn_challenges.session_id AND s.expires_at > ?2)
  AND totp_generation = ${TOTP_STATE}`

export function passkeyError(code: 'passkey_invalid' | 'passkey_expired' | 'passkey_limit' | 'passkey_duplicate' | 'passkey_unavailable') {
  return new ApiError(code === 'passkey_unavailable' ? 503 : code === 'passkey_invalid' ? 401 : 409, code, code)
}
export async function passkeyBudget(db: D1Database, kind: string, identity: string, maxAttempts = 20) {
  try {
    await consumeAttemptBudget(db, [{ key: `passkey:${kind}:${identity}`, maxAttempts, windowMs: 10 * 60 * 1000 }])
  } catch (error) {
    if (error instanceof ThrottleError) throw new ApiError(429, 'too_many_attempts', 'Too many attempts', { retryAfter: error.retryAfterSec })
    throw error
  }
}
export function credentialInfo(row: Credential) {
  return { id: row.id, name: row.name, createdAt: row.created_at, lastUsedAt: row.last_used_at }
}
export async function listPasskeys(db: D1Database, userId: string) {
  const { results } = await db.prepare(`SELECT * FROM passkey_credentials WHERE user_id = ?1 ORDER BY created_at, id`).bind(userId).all<Credential>()
  return results
}
function validName(input: unknown) {
  const name = passkeyName(input)
  if (!name) throw ApiError.badRequest('Passkey name must contain 1–64 characters')
  return name
}
async function authorizedChallenge(env: Env, userId: string, sessionId: string, password: unknown, code: unknown, purpose: 'registration' | 'delete', challenge: string) {
  const passwordHash = await requireCurrentPassword(env.DB, userId, password)
  const generation = await verifyTotpForPasskey(env, userId, code)
  const id = newId()
  const now = Date.now()
  const result = await env.DB.prepare(
    `INSERT INTO webauthn_challenges (id, challenge, purpose, user_id, session_id, password_hash, totp_generation, expires_at, created_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
     WHERE EXISTS (SELECT 1 FROM users u JOIN sessions s ON s.user_id = u.id WHERE u.id = ?4 AND u.password_hash = ?6 AND s.id = ?5 AND s.expires_at > ?9)
     AND COALESCE((SELECT recovery_generation FROM totp_credentials WHERE user_id = ?4 AND enabled_at IS NOT NULL), '') = ?7`,
  ).bind(id, challenge, purpose, userId, sessionId, passwordHash, generation, now + PASSKEY_TTL_MS, now).run()
  if (!result.meta.changes) throw passkeyError('passkey_expired')
  return id
}
export async function registrationOptions(env: Env, config: Config, user: { id: string; username: string; name: string }, sessionId: string, password: unknown, code: unknown) {
  const credentials = await listPasskeys(env.DB, user.id)
  if (credentials.length >= PASSKEY_LIMIT) throw passkeyError('passkey_limit')
  const options = await generateRegistrationOptions({
    rpID: config.rpID, rpName: config.rpName, userName: user.username, userDisplayName: user.name || user.username,
    userID: new Uint8Array(new TextEncoder().encode(user.id)), attestationType: 'none', timeout: PASSKEY_TTL_MS,
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: credentials.map((row) => ({ id: row.id, transports: JSON.parse(row.transports) as AuthenticatorTransport[] })),
  })
  const challengeId = await authorizedChallenge(env, user.id, sessionId, password, code, 'registration', options.challenge)
  return { challengeId, options }
}
async function loadChallenge(db: D1Database, id: unknown, purpose: string) {
  if (typeof id !== 'string' || !/^[0-9a-hjkmnp-tv-z]{26}$/.test(id)) throw passkeyError('passkey_expired')
  const row = await db.prepare(`SELECT * FROM webauthn_challenges WHERE id = ?1 AND purpose = ?2 AND expires_at > ?3 AND claimed_by IS NULL`)
    .bind(id, purpose, Date.now()).first<Challenge>()
  if (!row) throw passkeyError('passkey_expired')
  return row
}
function claimed(db: D1Database, sql: string, operation: string, ...bindings: (string | number | null)[]) {
  return db.prepare(sql).bind(operation, ...bindings)
}
function managementCleanup(db: D1Database, operation: string, userId: string, sessionId: string) {
  const proof = `EXISTS (SELECT 1 FROM webauthn_challenges WHERE claimed_by = ?1)`
  return [
    claimed(db, `DELETE FROM sessions WHERE user_id = ?2 AND id != ?3 AND ${proof}`, operation, userId, sessionId),
    claimed(db, `UPDATE webauthn_challenges SET claimed_by = 'invalidated' WHERE user_id = ?2 AND claimed_by IS NULL AND ${proof}`, operation, userId),
  ]
}
export async function completeRegistration(env: Env, config: Config, userId: string, sessionId: string, input: { challengeId?: unknown; response?: unknown; name?: unknown }) {
  const name = validName(input.name)
  const challenge = await loadChallenge(env.DB, input.challengeId, 'registration')
  if (challenge.user_id !== userId || challenge.session_id !== sessionId) throw passkeyError('passkey_invalid')
  let result
  try {
    result = await verifyRegistrationResponse({ response: input.response as RegistrationResponseJSON,
      expectedChallenge: challenge.challenge, expectedOrigin: config.origin, expectedRPID: config.rpID, requireUserVerification: true })
  } catch { throw passkeyError('passkey_invalid') }
  if (!result.verified) throw passkeyError('passkey_invalid')
  const info = result.registrationInfo
  const credential = info.credential
  if (await env.DB.prepare(`SELECT 1 FROM passkey_credentials WHERE id = ?1`).bind(credential.id).first()) throw passkeyError('passkey_duplicate')
  const operation = newId()
  const now = Date.now()
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE webauthn_challenges SET claimed_by = ?1 WHERE expires_at > ?2 AND id = ?3 AND claimed_by IS NULL
      AND ${AUTHORIZED} AND NOT EXISTS (SELECT 1 FROM passkey_credentials WHERE id = ?4)
      AND (SELECT COUNT(*) FROM passkey_credentials WHERE user_id = ?5) < ?6`)
      .bind(operation, now, challenge.id, credential.id, userId, PASSKEY_LIMIT),
    env.DB.prepare(`INSERT INTO passkey_credentials (id, user_id, public_key, counter, transports, device_type, backed_up, name, created_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE EXISTS (SELECT 1 FROM webauthn_challenges WHERE claimed_by = ?10)`)
      .bind(credential.id, userId, toBase64Url(credential.publicKey), credential.counter, JSON.stringify(credential.transports ?? []), info.credentialDeviceType, Number(info.credentialBackedUp), name, now, operation),
    ...managementCleanup(env.DB, operation, userId, sessionId),
  ])
  if (!results[0].meta.changes || !results[1].meta.changes) throw passkeyError('passkey_expired')
  return { id: credential.id, name, createdAt: now, lastUsedAt: null }
}
export async function loginOptions(env: Env, config: Config, browserHash: string) {
  const options = await generateAuthenticationOptions({ rpID: config.rpID, userVerification: 'required', timeout: PASSKEY_TTL_MS })
  const challengeId = newId()
  const now = Date.now()
  await env.DB.prepare(`INSERT INTO webauthn_challenges (id, challenge, purpose, browser_hash, expires_at, created_at) VALUES (?1, ?2, 'login', ?3, ?4, ?5)`)
    .bind(challengeId, options.challenge, browserHash, now + PASSKEY_TTL_MS, now).run()
  return { challengeId, options }
}
export async function completePasskeyLogin(env: Env, config: Config, browserHash: string, input: { challengeId?: unknown; response?: unknown }, oldSessionHashes: string[]) {
  const challenge = await loadChallenge(env.DB, input.challengeId, 'login')
  if (challenge.browser_hash !== browserHash) throw passkeyError('passkey_invalid')
  const response = input.response as AuthenticationResponseJSON | undefined
  if (!response || typeof response.id !== 'string' || response.id.length > 2048) throw passkeyError('passkey_invalid')
  const row = await env.DB.prepare(`SELECT p.* FROM passkey_credentials p JOIN users u ON u.id = p.user_id WHERE p.id = ?1`).bind(response.id).first<Credential>()
  if (!row) throw passkeyError('passkey_invalid')
  await passkeyBudget(env.DB, 'login-account', row.user_id)
  if (response.response?.userHandle !== toBase64Url(new TextEncoder().encode(row.user_id))) throw passkeyError('passkey_invalid')
  let verification
  try {
    verification = await verifyAuthenticationResponse({ response, expectedChallenge: challenge.challenge,
      expectedOrigin: config.origin, expectedRPID: config.rpID, requireUserVerification: true,
      credential: { id: row.id, publicKey: new Uint8Array(fromBase64Url(row.public_key)), counter: row.counter,
        transports: JSON.parse(row.transports) as AuthenticatorTransport[] } })
  } catch { throw passkeyError('passkey_invalid') }
  if (!verification.verified) throw passkeyError('passkey_invalid')
  const now = Date.now()
  const operation = newId()
  const token = newSessionToken()
  const sessionHash = await hashToken(token)
  const proof = `EXISTS (SELECT 1 FROM webauthn_challenges WHERE claimed_by = ?1)`
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE webauthn_challenges SET claimed_by = ?1, user_id = ?2
      WHERE id = ?3 AND claimed_by IS NULL AND expires_at > ?4
      AND EXISTS (SELECT 1 FROM passkey_credentials p JOIN users u ON u.id = p.user_id WHERE p.id = ?5 AND p.revision = ?6 AND p.user_id = ?2)`)
      .bind(operation, row.user_id, challenge.id, now, row.id, row.revision),
    claimed(env.DB, `UPDATE passkey_credentials SET counter = ?2, backed_up = ?3, last_used_at = ?4, revision = revision + 1 WHERE id = ?5 AND ${proof}`,
      operation, verification.authenticationInfo.newCounter, Number(verification.authenticationInfo.credentialBackedUp), now, row.id),
    claimed(env.DB, `INSERT INTO sessions (id, user_id, expires_at, created_at) SELECT ?2, ?3, ?4, ?5 WHERE ${proof}`,
      operation, sessionHash, row.user_id, now + SESSION_TTL_MS, now),
    ...oldSessionHashes.map((hash) => claimed(env.DB, `DELETE FROM sessions WHERE id = ?2 AND ${proof}`, operation, hash)),
  ])
  if (results.slice(0, 3).some((result) => !result.meta.changes)) throw passkeyError('passkey_expired')
  return { userId: row.user_id, token }
}
export async function renamePasskey(db: D1Database, userId: string, id: string, input: unknown) {
  const name = validName(input)
  const result = await db.prepare(`UPDATE passkey_credentials SET name = ?1 WHERE id = ?2 AND user_id = ?3`).bind(name, id, userId).run()
  if (!result.meta.changes) throw ApiError.notFound()
}
export async function deletePasskey(env: Env, userId: string, sessionId: string, id: string, password: unknown, code: unknown) {
  if (!await env.DB.prepare(`SELECT 1 FROM passkey_credentials WHERE id = ?1 AND user_id = ?2`).bind(id, userId).first()) throw ApiError.notFound()
  const grant = await authorizedChallenge(env, userId, sessionId, password, code, 'delete', newSessionToken())
  const operation = newId()
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE webauthn_challenges SET claimed_by = ?1 WHERE expires_at > ?2 AND id = ?3 AND claimed_by IS NULL AND ${AUTHORIZED}
      AND EXISTS (SELECT 1 FROM passkey_credentials WHERE id = ?4 AND user_id = ?5)`)
      .bind(operation, Date.now(), grant, id, userId),
    claimed(env.DB, `DELETE FROM passkey_credentials WHERE id = ?2 AND user_id = ?3 AND EXISTS (SELECT 1 FROM webauthn_challenges WHERE claimed_by = ?1)`, operation, id, userId),
    ...managementCleanup(env.DB, operation, userId, sessionId),
  ])
  if (!results[0].meta.changes || !results[1].meta.changes) throw passkeyError('passkey_expired')
}
