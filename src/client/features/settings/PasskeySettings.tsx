import { useEffect, useRef, useState } from 'react'
import type { PasskeyInfo } from '@shared/types'
import { Button } from '../../components/primitives'
import { Input, SettingRow } from '../../components/form'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { passkeyMessage, passkeySupported, registerPasskey, useOnline } from '../../lib/passkeys'
import { useSession } from '../../store/session'
import { useSettingsResource } from './resource'
import { totpResource } from './resources'

type Action = { kind: 'add' } | { kind: 'rename' | 'delete'; key: PasskeyInfo }
export function PasskeySettings() {
  const enabled = useSession((state) => state.site?.passkeyEnabled)
  const userId = useSession((state) => state.user?.id)
  const online = useOnline()
  const [keys, setKeys] = useState<PasskeyInfo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [reload, setReload] = useState(0)
  const [action, setAction] = useState<Action | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [totpStatus] = useSettingsResource(totpResource)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(false)
  const busyRef = useRef(false)
  const epoch = useRef(0)
  useEffect(() => {
    const current = ++epoch.current
    setKeys([]); setLoaded(false); setAction(null); setPassword(''); setCode('')
    if (enabled && online) {
      Promise.all([api.auth.passkeys.list(), totpResource.load(true)]).then(([list]) => {
        if (epoch.current !== current) return
        setKeys(list); setLoaded(true); setError(null)
      }).catch((error) => { if (epoch.current === current) setError(passkeyMessage(error)) })
    }
    return () => { epoch.current++ }
  }, [enabled, userId, online, reload])
  function open(next: Action) {
    setAction(next); setName(next.kind === 'add' ? '' : next.key.name)
    setPassword(''); setCode(''); setError(null); setNotice(false)
  }
  async function submit() {
    if (!action || busyRef.current || !online) return
    busyRef.current = true; setBusy(true); setError(null)
    const current = epoch.current
    try {
      if (action.kind === 'add') await registerPasskey(password, code, name.trim())
      else if (action.kind === 'rename') await api.auth.passkeys.rename(action.key.id, name.trim())
      else await api.auth.passkeys.delete(action.key.id, password, code)
      if (epoch.current !== current) return
      setNotice(action.kind !== 'rename'); setAction(null); setPassword(''); setCode('')
      const list = await api.auth.passkeys.list()
      if (epoch.current === current) setKeys(list)
    } catch (error) { if (epoch.current === current) setError(passkeyMessage(error)) }
    finally {
      totpResource.invalidate()
      busyRef.current = false
      setBusy(false)
      if (epoch.current === current) { setPassword(''); setCode('') }
    }
  }
  const supported = passkeySupported()
  return <div className="space-y-3">
    <SettingRow title={t('passkey.title')} description={t(enabled ? 'passkey.description' : 'passkey.disabled')}>
      <Button size="sm" disabled={!enabled || !supported || !online || !loaded || busy || keys.length >= 10} onClick={() => open({ kind: 'add' })}>{t('passkey.add')}</Button>
    </SettingRow>
    {enabled && <div className="space-y-3 px-3 text-sm">
      {!online && <p>{t('passkey.offline')}</p>}
      {!supported && <p>{t('passkey.unsupported')}</p>}
      {keys.map((key) => <div key={key.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-md)] border border-[var(--border-default)] p-3">
        <div className="min-w-0"><p className="break-all font-medium">{key.name}</p>
          <p className="text-xs text-[var(--text-tertiary)]">{t('passkey.created', { date: new Date(key.createdAt).toLocaleString() })}</p>
          <p className="text-xs text-[var(--text-tertiary)]">{key.lastUsedAt ? t('passkey.last_used', { date: new Date(key.lastUsedAt).toLocaleString() }) : t('passkey.never_used')}</p>
        </div>
        <div className="flex gap-2"><Button size="sm" disabled={busy || !online} onClick={() => open({ kind: 'rename', key })}>{t('passkey.rename')}</Button>
          <Button size="sm" variant="danger" disabled={busy || !online} onClick={() => open({ kind: 'delete', key })}>{t('passkey.delete')}</Button></div>
      </div>)}
      {action && <form className="space-y-3 rounded-[var(--r-md)] border border-[var(--border-default)] p-3" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        {action.kind !== 'delete' && <label className="block">{t('passkey.name')}<Input aria-label={t('passkey.name')} value={name} maxLength={64} required disabled={busy} onChange={(event) => setName(event.target.value)} /></label>}
        {action.kind === 'delete' && <p>{t('passkey.delete_description', { name: action.key.name })}</p>}
        {action.kind !== 'rename' && <>
          <label className="block">{t('common.password')}<Input aria-label={t('common.password')} type="password" autoComplete="current-password" required value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} /></label>
          {totpStatus?.enabled && <label className="block">{t('passkey.code')}<Input aria-label={t('passkey.code')} autoComplete="one-time-code" required value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} /></label>}
          <p className="text-xs text-[var(--text-tertiary)]">{t('passkey.reauth')}</p>
        </>}
        <div className="flex gap-2"><Button type="submit" disabled={busy || !online || (action.kind !== 'delete' && !name.trim())}>{t('passkey.confirm')}</Button>
          <Button type="button" disabled={busy} onClick={() => { setAction(null); setPassword(''); setCode('') }}>{t('passkey.cancel')}</Button></div>
      </form>}
      {notice && <p role="status">{t('passkey.sessions_revoked')}</p>}
      <p className="text-xs text-[var(--text-tertiary)]">{t('passkey.recovery_note')}</p>
    </div>}
    {error && <div className="space-y-2 px-3"><p role="alert" className="text-sm text-[var(--danger)]">{error}</p>
      {!loaded && online && <Button size="sm" onClick={() => setReload((value) => value + 1)}>{t('passkey.retry')}</Button>}
    </div>}
  </div>
}
