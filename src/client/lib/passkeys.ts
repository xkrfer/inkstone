import { useSyncExternalStore } from 'react'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { api, ApiError } from './api'
import { t } from './i18n'
import { IS_DEMO_MODE } from './runtime'

export function passkeySupported() {
  return !IS_DEMO_MODE && window.isSecureContext && typeof window.PublicKeyCredential !== 'undefined'
}
function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => { window.removeEventListener('online', callback); window.removeEventListener('offline', callback) }
}
export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine)
}
function requireAvailable() {
  if (!navigator.onLine) throw new Error(t('passkey.offline'))
  if (!passkeySupported()) throw new Error(t('passkey.unsupported'))
}
export async function authenticatePasskey() {
  requireAvailable()
  const { challengeId, options } = await api.auth.passkeys.loginOptions()
  const response = await startAuthentication({ optionsJSON: options })
  return api.auth.passkeys.login(challengeId, response)
}
export async function registerPasskey(password: string, code: string, name: string) {
  requireAvailable()
  const { challengeId, options } = await api.auth.passkeys.registrationOptions(password, code)
  const response = await startRegistration({ optionsJSON: options })
  return api.auth.passkeys.register(challengeId, response, name)
}
export function passkeyMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error || error instanceof DOMException) {
    const causeName = error.cause instanceof Error || error.cause instanceof DOMException ? error.cause.name : error.name
    if (causeName === 'AbortError') return null
    if (causeName === 'NotAllowedError') return t('passkey.not_completed')
    if (causeName === 'TimeoutError') return t('passkey.timeout')
    if (causeName === 'InvalidStateError') return t('passkey.duplicate')
    return error.message || t('passkey.failed')
  }
  return t('passkey.failed')
}
