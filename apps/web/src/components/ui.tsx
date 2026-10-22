import { AlertTriangle, Check, ChevronRight, CloudOff, LoaderCircle, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { DEMO_MODE } from '../api/client'

export function Logo({ compact = false }: { compact?: boolean }) {
  return <div className="brand" aria-label="BISA Gym">
    <div className="brand-mark"><span /><span /><span /></div>
    {!compact && <div><strong>BISA</strong><small>GYM ACCESS</small></div>}
  </div>
}

export function DemoBadge() {
  if (!DEMO_MODE) return null
  return <span className="demo-badge"><span /> DEMO MODE</span>
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase().replaceAll('_', '-')
  const labels: Record<string, string> = { ACTIVE: 'Aktif', EXPIRED: 'Kedaluwarsa', SUSPENDED: 'Ditangguhkan', PENDING: 'Menunggu', CANCELLED: 'Dibatalkan', ALLOW: 'Diizinkan', DENY: 'Ditolak', UNKNOWN: 'Tidak diketahui' }
  return <span className={`status-badge status-${normalized}`}><span />{labels[status] ?? status}</span>
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="page-header">
    <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
    {action && <div className="page-actions">{action}</div>}
  </header>
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return <div className="empty-state"><div className="empty-icon">?</div><strong>{title}</strong><p>{message}</p></div>
}

export function LoadingState({ label = 'Memuat data...' }: { label?: string }) {
  return <div className="loading-state"><LoaderCircle className="spin" aria-hidden="true" /><span>{label}</span></div>
}

export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return <div className="error-state" role="alert"><CloudOff /><div><strong>Data belum dapat dimuat</strong><p>{error.message}</p>{retry && <button className="text-button" onClick={retry}>Coba lagi <ChevronRight size={16} /></button>}</div></div>
}

export function Modal({ title, description, children, onClose, wide = false }: { title: string; description?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header><div><h2 id="modal-title">{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Tutup dialog"><X /></button></header>
      {children}
    </section>
  </div>
}

export function Toast({ type = 'success', children, onClose }: { type?: 'success' | 'error'; children: ReactNode; onClose?: () => void }) {
  return <div className={`toast toast-${type}`} role="status">{type === 'success' ? <Check /> : <AlertTriangle />}<span>{children}</span>{onClose && <button onClick={onClose} aria-label="Tutup notifikasi"><X /></button>}</div>
}

export function initials(name: string) {
  return name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

export function formatDate(value: string, includeTime = false) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '-'
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(value))
}
