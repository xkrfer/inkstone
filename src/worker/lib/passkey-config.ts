import type { Env } from '../env'

export const PASSKEY_TTL_MS = 5 * 60 * 1000
export const PASSKEY_LIMIT = 10

export function passkeyConfig(env: Pick<Env, 'PUBLIC_URL' | 'APP_NAME'>) {
  if (!env.PUBLIC_URL?.trim()) return null
  try {
    const url = new URL(env.PUBLIC_URL)
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) return null
    return { origin: url.origin, rpID: url.hostname, rpName: env.APP_NAME || 'Inkstone' }
  } catch {
    return null
  }
}

export function passkeyName(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const name = input.trim()
  return name && [...name].length <= 64 && !/[\u0000-\u001f\u007f]/u.test(name) ? name : null
}
