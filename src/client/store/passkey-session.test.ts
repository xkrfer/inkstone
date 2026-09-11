import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/constants'
import type { SessionInfo } from '@shared/types'
import { useSession } from './session'
import { authenticatePasskey } from '../lib/passkeys'
import { localDb } from '../lib/db'

vi.mock('../lib/passkeys', () => ({ authenticatePasskey: vi.fn() }))
vi.mock('../lib/db', () => ({ localDb: { saveSession: vi.fn(), clearSession: vi.fn() } }))
const info = (id: string): SessionInfo => ({
  user: { id, username: id, login: id, name: id, avatarUrl: '', role: 'member', createdAt: 1 },
  site: { passkeyEnabled: true, name: 'Inkstone', initialized: true, registrationOpen: false, r2Enabled: true, kvEnabled: false, attachmentStorage: 'r2', realtimeEnabled: false, version: 'test' },
  settings: DEFAULT_SETTINGS,
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  useSession.setState({ status: 'anonymous', user: null })
})
afterEach(() => vi.unstubAllGlobals())
it('adopts and persists a completed passkey session', async () => {
  vi.mocked(authenticatePasskey).mockResolvedValue(info('owner'))
  await useSession.getState().passkeyLogin()
  expect(useSession.getState().user?.id).toBe('owner')
  expect(useSession.getState().status).toBe('authed')
  expect(localDb.saveSession).toHaveBeenCalledWith(info('owner'))
})
it('ignores a stale passkey response after a newer login', async () => {
  let resolve!: (value: SessionInfo) => void
  vi.mocked(authenticatePasskey).mockReturnValueOnce(new Promise((done) => { resolve = done })).mockResolvedValueOnce(info('newer'))
  const old = useSession.getState().passkeyLogin()
  await vi.waitFor(() => expect(authenticatePasskey).toHaveBeenCalledTimes(1))
  await useSession.getState().passkeyLogin()
  resolve(info('older'))
  await old
  expect(useSession.getState().user?.id).toBe('newer')
  expect(localDb.saveSession).toHaveBeenCalledTimes(1)
})
