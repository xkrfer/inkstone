import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { AppBindings } from '../env'
import { ApiError } from '../lib/errors'
import { PASSKEY_TTL_MS, passkeyConfig } from '../lib/passkey-config'
import {
  completePasskeyLogin, completeRegistration, credentialInfo, deletePasskey,
  listPasskeys, loginOptions, passkeyBudget, passkeyError, registrationOptions, renamePasskey,
} from '../lib/passkey-service'
import { hashToken, isSessionToken, newSessionToken } from '../lib/session-store'
import { loadUser, sessionInfo } from '../lib/session-info'
import { readJson, requestClientIp } from '../lib/request'
import { requireAuth, sessionCookieNames, writeSessionCookie } from '../middleware/auth'

export const passkeyRoutes = new Hono<AppBindings>()

passkeyRoutes.use('*', async (c, next) => {
  const config = passkeyConfig(c.env)
  if (!config) throw passkeyError('passkey_unavailable')
  if (c.req.method !== 'GET') {
    if (c.req.header('Origin') !== config.origin || new URL(c.req.url).origin !== config.origin) throw ApiError.forbidden('Invalid origin')
    await passkeyBudget(c.env.DB, 'ip', requestClientIp(c), 60)
    if (c.get('userId')) await passkeyBudget(c.env.DB, 'management', c.get('userId'))
  }
  await next()
  if (c.req.method !== 'GET') console.info('[inkstone] passkey', JSON.stringify({ method: c.req.method, operation: c.req.routePath, status: c.res.status }))
})

passkeyRoutes.get('/', requireAuth, async (c) => c.json((await listPasskeys(c.env.DB, c.get('userId'))).map(credentialInfo)))
passkeyRoutes.post('/registration/options', requireAuth, async (c) => {
  const body = await readJson<{ currentPassword?: unknown; code?: unknown }>(c, 4096)
  return c.json(await registrationOptions(c.env, passkeyConfig(c.env)!, c.get('user'), c.get('sessionId'), body.currentPassword, body.code))
})
passkeyRoutes.post('/registration/verify', requireAuth, async (c) => {
  const body = await readJson<{ challengeId?: unknown; response?: unknown; name?: unknown }>(c, 64 * 1024)
  return c.json(await completeRegistration(c.env, passkeyConfig(c.env)!, c.get('userId'), c.get('sessionId'), body), 201)
})

function browserCookie(url: string, id: unknown) {
  if (typeof id !== 'string' || !/^[0-9a-hjkmnp-tv-z]{26}$/.test(id)) throw passkeyError('passkey_expired')
  return `${new URL(url).protocol === 'https:' ? '__Host-' : ''}inkstone_passkey_${id}`
}
passkeyRoutes.post('/login/options', async (c) => {
  const token = newSessionToken()
  const result = await loginOptions(c.env, passkeyConfig(c.env)!, await hashToken(token))
  setCookie(c, browserCookie(c.req.url, result.challengeId), token, {
    path: '/', httpOnly: true, sameSite: 'strict', secure: new URL(c.req.url).protocol === 'https:', maxAge: PASSKEY_TTL_MS / 1000,
  })
  return c.json(result)
})
passkeyRoutes.post('/login/verify', async (c) => {
  const body = await readJson<{ challengeId?: unknown; response?: unknown }>(c, 64 * 1024)
  const name = browserCookie(c.req.url, body.challengeId)
  const token = getCookie(c, name)
  if (!token || !isSessionToken(token)) throw passkeyError('passkey_invalid')
  const presented = sessionCookieNames(c.req.url).map((name) => getCookie(c, name)).filter((value): value is string => Boolean(value && isSessionToken(value)))
  const result = await completePasskeyLogin(c.env, passkeyConfig(c.env)!, await hashToken(token), body, await Promise.all(presented.map(hashToken)))
  const user = await loadUser(c.env, result.userId)
  if (!user) throw ApiError.unauthenticated()
  setCookie(c, name, '', { path: '/', httpOnly: true, sameSite: 'strict', secure: new URL(c.req.url).protocol === 'https:', maxAge: 0 })
  writeSessionCookie(c, result.token)
  return c.json(await sessionInfo(c.env, user))
})
passkeyRoutes.patch('/:id', requireAuth, async (c) => {
  const body = await readJson<{ name?: unknown }>(c, 4096)
  await renamePasskey(c.env.DB, c.get('userId'), c.req.param('id'), body.name)
  return c.json({ ok: true })
})
passkeyRoutes.delete('/:id', requireAuth, async (c) => {
  const body = await readJson<{ currentPassword?: unknown; code?: unknown }>(c, 4096)
  await deletePasskey(c.env, c.get('userId'), c.get('sessionId'), c.req.param('id'), body.currentPassword, body.code)
  return c.json({ ok: true })
})
