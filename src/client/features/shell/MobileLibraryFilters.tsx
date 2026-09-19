import { useId, useRef, useState } from 'react';
import { Archive, ChevronDown, Clock, FileText, FolderClosed, Hash, Inbox, Star, Trash2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { t } from '../../lib/i18n';
import { useEscape } from '../../components/overlay';
import { useUi } from '../../store/ui';
import { useNavigationCounts, useNotes } from '../../store/notes';
import { FolderSection, TagSection } from '../sidebar/Sidebar';

export function MobileLibraryFilters() {
    const [open, setOpen] = useState<'menu' | 'tag' | 'folder' | null>(null);
    const trigger = useRef<HTMLButtonElement | null>(null);
    const id = useId();
    const view = useUi((s) => s.view);
    const tag = useUi((s) => s.tag);
    const folderId = useUi((s) => s.folderId);
    const folders = useNotes((s) => s.folders);
    const counts = useNavigationCounts();
    const openView = useUi((s) => s.openView);
    const close = () => { setOpen(null); trigger.current?.focus(); };
    useEscape(Boolean(open), close);
    const items = [
        { view: 'all' as const, label: t('navigation.all_notes'), icon: FileText, count: counts.all },
        { view: 'recent' as const, label: t('navigation.recently_edited'), icon: Clock },
        { view: 'starred' as const, label: t('navigation.favorites'), icon: Star, count: counts.starred },
        { view: 'unfiled' as const, label: t('navigation.unfiled'), icon: Inbox, count: counts.unfiled },
        { view: 'archived' as const, label: t('navigation.archive'), icon: Archive, count: counts.archived },
        { view: 'trash' as const, label: t('navigation.trash'), icon: Trash2, count: counts.trash },
    ];
    const controls = [
        { id: 'menu' as const, icon: FileText, label: items.find((item) => item.view === view)?.label ?? t('mobile.menu'), active: view !== 'tag' && view !== 'folder' },
        { id: 'tag' as const, icon: Hash, label: view === 'tag' ? tag : t('navigation.tag'), active: view === 'tag' },
        { id: 'folder' as const, icon: FolderClosed, label: view === 'folder' ? folders.find((folder) => folder.id === folderId)?.name : t('navigation.folder'), active: view === 'folder' },
    ];
    return <div className="mobile-library-filters relative mt-2">
        {open && <button type="button" tabIndex={-1} aria-label={t('common.close')} className="fixed inset-0 z-20 cursor-default" onClick={close} />}
        <div className={cn('grid grid-cols-3 gap-1', open && 'relative z-30')}>
            {controls.map(({ id: key, icon: Icon, label, active }) => <button key={key} type="button" aria-expanded={open === key} aria-controls={open === key ? id : undefined} onClick={(event) => {
                trigger.current = event.currentTarget;
                setOpen(open === key ? null : key);
            }} className={cn('flex min-h-11 min-w-0 items-center gap-1.5 rounded-[var(--r-md)] px-2 text-[12px] transition-colors active:bg-[var(--bg-active)]', open === key ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : active ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>
                <Icon size={14} aria-hidden="true" className="shrink-0"/><span className="min-w-0 flex-1 truncate text-left">{label}</span><ChevronDown size={12} aria-hidden="true" className="shrink-0"/>
            </button>)}
        </div>
        {open && <div id={id} className="mobile-library-dropdown absolute right-0 left-0 top-full z-30 mt-1 max-h-[min(50dvh,400px)] overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] p-2 shadow-[var(--shadow-modal)]" onClick={(event) => {
            if ((event.target as HTMLElement).closest('[data-navigation-item]')) close();
        }}>
            {open === 'menu' ? items.map(({ view: key, label, icon: Icon, count }) => <button key={key} type="button" aria-current={view === key ? 'page' : undefined} onClick={() => { openView(key); close(); }} className={cn('flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] active:bg-[var(--bg-active)]', view === key && 'bg-[var(--accent-soft)] text-[var(--accent)]')}>
                <Icon size={16} aria-hidden="true"/><span className="flex-1">{label}</span><span className="text-[var(--text-tertiary)]">{count}</span>
            </button>) : <>
                <button type="button" onClick={() => { openView('all'); close(); }} className="min-h-11 w-full rounded-lg px-2 text-left text-[13px] text-[var(--accent)] active:bg-[var(--bg-active)]">{t('navigation.all_notes')}</button>
                {open === 'folder' ? <FolderSection /> : <TagSection />}
            </>}
        </div>}
    </div>;
}
