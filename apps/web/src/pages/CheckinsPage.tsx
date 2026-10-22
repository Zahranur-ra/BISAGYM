import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, ChevronDown, Download, Filter, Hand, Search, ShieldAlert } from 'lucide-react'
import { api } from '../api/client'
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader, StatusBadge, Toast, formatDate } from '../components/ui'
import type { Checkin } from '../types'

const reasons: Record<string, string> = { MEMBERSHIP_ACTIVE: 'Membership aktif', IDENTITY_NOT_FOUND: 'Wajah tidak dikenali', MEMBERSHIP_EXPIRED: 'Membership kedaluwarsa', MEMBERSHIP_SUSPENDED: 'Membership ditangguhkan', LIVENESS_FAILED: 'Verifikasi keaktifan gagal', MANUAL_OVERRIDE: 'Override manual' }

export function CheckinsPage() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['checkins'], queryFn: api.checkins })
  const members = useQuery({ queryKey: ['members'], queryFn: api.members })
  const [search, setSearch] = useState('')
  const [decision, setDecision] = useState('ALL')
  const [manualAttempt, setManualAttempt] = useState<Checkin | null>(null)
  const [toast, setToast] = useState('')
  const filtered = useMemo(() => query.data?.filter((item) => (decision === 'ALL' || item.decision === decision) && `${item.member_name} ${item.member_code ?? ''} ${item.reason_code}`.toLowerCase().includes(search.toLowerCase())) ?? [], [query.data, search, decision])
  const manual = useMutation({ mutationFn: ({ memberId, reason }: { memberId: string; reason: string }) => api.manualOverride(manualAttempt!.id, memberId, reason), onSuccess: () => { if (manualAttempt) queryClient.setQueryData<Checkin[]>(['checkins'], (current = []) => current.map((item) => item.id === manualAttempt.id ? { ...item, decision: 'ALLOW', reason_code: 'MANUAL_OVERRIDE', manual_override: true } : item)); setManualAttempt(null); setToast('Akses manual diizinkan dan audit log telah dicatat.') } })
  if (query.isLoading) return <LoadingState />
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />
  return <>
    <PageHeader eyebrow="MONITORING AKSES" title="Riwayat Akses" description="Setiap percobaan biometrik dan override manual tercatat terpisah." action={<button className="secondary-button"><Download /> Ekspor CSV</button>} />
    <section className="access-summary"><div><span className="summary-icon allow">✓</span><span><small>Diizinkan hari ini</small><strong>186</strong></span></div><div><span className="summary-icon deny">×</span><span><small>Ditolak hari ini</small><strong>7</strong></span></div><div><span className="summary-icon manual"><Hand /></span><span><small>Override manual</small><strong>2</strong></span></div><div><span className="summary-icon rate">%</span><span><small>Tingkat keberhasilan</small><strong>96.4%</strong></span></div></section>
    <div className="panel table-panel"><div className="table-toolbar"><div className="search-field"><Search /><input aria-label="Cari riwayat akses" placeholder="Cari member, kode, atau alasan..." value={search} onChange={(e) => setSearch(e.target.value)} /></div><div className="filter-group"><div className="select-wrap"><Filter /><select aria-label="Filter hasil" value={decision} onChange={(e) => setDecision(e.target.value)}><option value="ALL">Semua hasil</option><option value="ALLOW">Diizinkan</option><option value="DENY">Ditolak</option></select><ChevronDown /></div><button className="filter-button"><CalendarDays /> Hari ini</button></div></div>
      {filtered.length ? <div className="table-scroll"><table><thead><tr><th>Waktu</th><th>Member</th><th>Perangkat</th><th>Hasil</th><th>Alasan</th><th>Proses</th><th>Override</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><strong className="table-date">{new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date(item.attempted_at))}</strong><small className="table-sub">{formatDate(item.attempted_at)}</small></td><td><strong>{item.member_name}</strong><small className="table-sub">{item.member_code ?? 'Tanpa identitas'}</small></td><td>{item.device_name}</td><td><StatusBadge status={item.decision} /></td><td><span className="reason-text">{reasons[item.reason_code] ?? item.reason_code}</span></td><td>{item.processing_time_ms ? `${item.processing_time_ms} ms` : '-'}</td><td>{item.manual_override ? <span className="manual-tag"><Hand /> Ya</span> : item.decision === 'DENY' ? <button className="override-button" onClick={() => setManualAttempt(item)}>Override</button> : '-'}</td></tr>)}</tbody></table></div> : <EmptyState title="Tidak ada percobaan akses" message="Ubah filter atau rentang tanggal untuk melihat data." />}
    </div>
    {manualAttempt && <ManualOverrideModal attempt={manualAttempt} members={members.data ?? []} loading={manual.isPending} error={manual.error?.message} onClose={() => setManualAttempt(null)} onSubmit={(memberId, reason) => manual.mutate({ memberId, reason })} />}
    {toast && <Toast onClose={() => setToast('')}>{toast}</Toast>}
  </>
}

function ManualOverrideModal({ attempt, members, loading, error, onClose, onSubmit }: { attempt: Checkin; members: Awaited<ReturnType<typeof api.members>>; loading: boolean; error?: string; onClose: () => void; onSubmit: (memberId: string, reason: string) => void }) {
  const [memberId, setMemberId] = useState('')
  const [reason, setReason] = useState('')
  const [validation, setValidation] = useState('')
  function submit(event: FormEvent) { event.preventDefault(); if (!memberId || reason.trim().length < 8) { setValidation('Pilih member dan tulis alasan minimal 8 karakter.'); return } onSubmit(memberId, reason) }
  return <Modal title="Override akses manual" description={`Percobaan ${attempt.id} tetap tercatat sebagai gagal biometrik.`} onClose={onClose}><form className="modal-form" onSubmit={submit}><div className="override-warning"><ShieldAlert /><span><strong>Tindakan ini diaudit</strong>Override tidak mengubah hasil biometrik awal. Identitas operator, alasan, dan waktu akan dicatat.</span></div><label>Member terdaftar<select aria-label="Pilih member untuk override" value={memberId} onChange={(e) => setMemberId(e.target.value)}><option value="">Pilih member...</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name} · {member.member_code}</option>)}</select></label><label>Alasan override<textarea aria-label="Alasan override" value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="Jelaskan verifikasi identitas dan alasan akses diberikan..." /></label>{(validation || error) && <div className="form-alert" role="alert">{validation || error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Batal</button><button className="primary-button" disabled={loading}>{loading ? 'Mencatat...' : <><Hand /> Izinkan akses manual</>}</button></div></form></Modal>
}
