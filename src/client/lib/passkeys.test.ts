import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { api } from './api'
import { initI18n } from './i18n'
import { authenticatePasskey, passkeyMessage, passkeySupported, registerPasskey } from './passkeys'

vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }))
vi.mock('./api', () => ({ ApiError: class extends Error {}, api: { auth: { passkeys: { loginOptions: vi.fn(), login: vi.fn(), registrationOptions: vi.fn(), register: vi.fn() } } } }))
beforeEach(async () => {
  await initI18n()
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('PublicKeyCredential', class {})
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })
describe('passkey browser flow', () => {
  it('posts the browser response against the server challenge', async () => {
    const options = { challenge: 'challenge', rpId: 'localhost' }
    vi.mocked(api.auth.passkeys.loginOptions).mockResolvedValue({ challengeId: 'id', options })
    const response = { id: 'credential' } as Awaited<ReturnType<typeof startAuthentication>>
    vi.mocked(startAuthentication).mockResolvedValue(response)
    await authenticatePasskey()
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: options })
    expect(api.auth.passkeys.login).toHaveBeenCalledWith('id', response)
  })
  it('never submits an assertion after a cancelled browser request', async () => {
    vi.mocked(api.auth.passkeys.loginOptions).mockResolvedValue({ challengeId: 'id', options: { challenge: 'challenge' } })
    vi.mocked(startAuthentication).mockRejectedValue(new DOMException('cancel', 'NotAllowedError'))
    await expect(authenticatePasskey()).rejects.toThrow()
    expect(api.auth.passkeys.login).not.toHaveBeenCalled()
    expect(passkeyMessage(new DOMException('cancel', 'AbortError'))).toBeNull()
    expect(passkeyMessage(new DOMException('cancel', 'NotAllowedError'))).not.toContain('failed')
  })
  it('does not invoke registration when offline or insecure', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await expect(registerPasskey('password', '', 'Phone')).rejects.toThrow()
    expect(startRegistration).not.toHaveBeenCalled()
    vi.stubGlobal('isSecureContext', false)
    expect(passkeySupported()).toBe(false)
  })
})
