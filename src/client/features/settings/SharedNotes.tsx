import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, Eye, Link2, RefreshCw, Search, Settings2, Trash2 } from 'lucide-react'
import type { ShareListItem } from '@shared/types'
import { api } from '../../lib/api'
import { fullTime } from '../../lib/time'
import { Button } from '../../components/primitives'
import { Input } from '../../components/form'
import { confirm } from '../../components/overlay'
import { useNotes } from '../../store/notes'
import { useUi } from '../../store/ui'
import { t } from '../../lib/i18n'
import { SharePanel } from '../share/SharePanel'

export function SharedNotes() {
  const [shares, setShares] = useState<ShareListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ShareListItem | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const copiedTimer = useRef(0)
  const revokeRef = useRef<string | null>(null)
  const toast = useUi((state) => state.toast)
  const openNote = useNotes((state) => state.openNote)
  const pull = useNotes((state) => state.pull)

  const load = useCallback(async (initial = false) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    if (initial) setShares(null)
    setRefreshing(true)
    setError(null)
    try {
      const result = await api.share.list(controller.signal)
      if (!controller.signal.aborted) setShares(result.shares)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    void load(true)
    return () => {
      requestRef.current?.abort()
      requestRef.current = null
      window.clearTimeout(copiedTimer.current)
    }
  }, [load])

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return shares?.filter((share) => !needle ||
      share.noteTitle.toLocaleLowerCase().includes(needle) ||
      share.url.toLocaleLowerCase().includes(needle)) ?? []
  }, [shares, query])

  const copy = async (share: ShareListItem) => {
    try {
      await navigator.clipboard.writeText(share.url)
      setCopied(share.noteId)
      window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(null), 1500)
    } catch {
      toast({ title: t('preview.could_not_copy'), tone: 'danger' })
    }
  }

  const revoke = async (share: ShareListItem) => {
    if (revokeRef.current) return
    revokeRef.current = share.noteId
    setRevoking(share.noteId)
    try {
      const ok = await confirm({
        title: t('share.revoke_this_public_link'),
        description: t('share.anyone_who_gets_the_link_will_immediately_lose_access'),
        confirmLabel: t('share.revoke_link'),
        tone: 'danger',
      })
      if (!ok) return
      await api.share.remove(share.noteId)
      requestRef.current?.abort()
      setShares((current) => current?.filter((item) => item.noteId !== share.noteId) ?? null)
      toast({ title: t('share.link_revoked'), tone: 'success' })
    } catch (cause) {
      toast({ title: t('common.action_failed'), description: cause instanceof Error ? cause.message : String(cause), tone: 'danger' })
    } finally {
      revokeRef.current = null
      setRevoking(null)
    }
  }

  const visitNote = async (share: ShareListItem) => {
    if (!useNotes.getState().notes[share.noteId]) {
      await pull({ force: true }).catch(() => {})
    }
    if (!useNotes.getState().notes[share.noteId]) {
      toast({ title: t('share.source_note_unavailable'), tone: 'danger' })
      return
    }
    useUi.getState().closePanel()
    try {
      await openNote(share.noteId)
    } catch (cause) {
      toast({ title: t('share.source_note_unavailable'), description: cause instanceof Error ? cause.message : String(cause), tone: 'danger' })
    }
  }

  return <section>
    <div className="mb-2 flex items-center justify-between gap-2">
      <div>
        <h3 className="text-[11px] font-semibold tracking-[0.06em] text-[var(--text-quaternary)]">{t('share.shared_notes')}</h3>
        <p className="mt-0.5 text-[11.5px] text-[var(--text-tertiary)]">{t('share.shared_notes_description')}</p>
      </div>
      <Button size="sm" variant="ghost" icon={<RefreshCw size={13}/>} loading={refreshing} onClick={() => void load()} aria-label={t('share.refresh_list')} title={t('share.refresh_list')} />
    </div>

    {shares && shares.length > 0 && <div className="relative mb-2">
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)]" />
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('share.search_shared_notes')} aria-label={t('share.search_shared_notes')} className="w-full pl-8" />
    </div>}

    {error && <div role="alert" className="mb-2 flex items-center justify-between gap-2 rounded-[var(--r-md)] border border-[var(--border-subtle)] px-3 py-2 text-[12px] text-[var(--danger)]">
      <span>{t('share.could_not_load_list')}: {error}</span>
      <Button size="sm" variant="secondary" onClick={() => void load(shares === null)}>{t('common.retry')}</Button>
    </div>}

    {shares === null ? (refreshing && <p role="status" className="py-4 text-center text-[12px] text-[var(--text-tertiary)]">{t('common.loading')}</p>) :
      shares?.length === 0 ? <p className="rounded-[var(--r-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-4 text-center text-[12px] text-[var(--text-tertiary)]">{t('share.no_shared_notes')}</p> :
      visible.length === 0 ? <p className="py-4 text-center text-[12px] text-[var(--text-tertiary)]">{t('share.no_matching_shares')}</p> :
      <div className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--r-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)]">
        {visible.map((share) => {
          const expired = share.expiresAt !== null && share.expiresAt <= Date.now()
          const trashed = share.deletedAt !== null
          return <div key={share.noteId} className="px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <button type="button" disabled={trashed} onClick={() => void visitNote(share)} className="min-w-0 truncate text-left text-[13px] font-medium text-[var(--text-primary)] hover:text-[var(--accent)] disabled:cursor-default disabled:hover:text-[var(--text-primary)]" title={share.noteTitle || t('common.untitled_note')}>{share.noteTitle || t('common.untitled_note')}</button>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${trashed || expired ? 'bg-[var(--bg-inset)] text-[var(--text-tertiary)]' : 'bg-[var(--accent-soft)] text-[var(--accent)]'}`}>
                {trashed ? t('share.in_trash') : expired ? t('share.expired') : t('share.active')}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
              <Link2 size={12} className="shrink-0" />
              <input readOnly value={share.url} aria-label={`${t('share.public_link')}: ${share.noteTitle || t('common.untitled_note')}`} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 truncate bg-transparent text-[11px] text-[var(--text-secondary)] outline-none" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-quaternary)]">
              <span className="inline-flex items-center gap-1"><Eye size={11} />{share.views}{t('share.visits')}</span>
              {share.hasPassword && <span>{t('share.passcode_protected')}</span>}
              <span>{share.expiresAt ? t('share.expires_value0', { value0: fullTime(share.expiresAt) }) : t('share.never_expires_71ab34')}</span>
              <span title={fullTime(share.createdAt)}>{t('common.created')}{fullTime(share.createdAt)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="secondary" icon={copied === share.noteId ? <Check size={12} /> : <Copy size={12} />} onClick={() => void copy(share)}>{copied === share.noteId ? t('common.copied') : t('common.copy')}</Button>
              <a href={share.url} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-[var(--r-sm)] px-2 text-[11.5px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><ExternalLink size={12} />{t('share.open_link')}</a>
              {!trashed && <Button size="sm" variant="ghost" icon={<Settings2 size={12} />} onClick={() => setSelected(share)}>{t('share.manage')}</Button>}
              <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} loading={revoking === share.noteId} disabled={revoking !== null} className="text-[var(--danger)]" onClick={() => void revoke(share)}>{t('share.revoke_link')}</Button>
            </div>
          </div>
        })}
      </div>}

    {selected && <SharePanel key={selected.noteId} targetNote={{ id: selected.noteId, title: selected.noteTitle }} onClose={() => setSelected(null)} onChanged={() => void load()} />}
  </section>
}
