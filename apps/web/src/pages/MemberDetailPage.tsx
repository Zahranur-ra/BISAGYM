import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarPlus, Check, Clock3, Edit3, Mail, MapPin, Phone, ScanFace, ShieldCheck, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth'
import { EmptyState, ErrorState, LoadingState, Modal, StatusBadge, Toast, formatDate, initials } from '../components/ui'
import { MemberForm } from './MembersPage'
import type { BiometricConsent, Checkin, Member, Membership, MembershipPlan } from '../types'

type MembershipAction = { kind: 'suspend' | 'reactivate' | 'cancel'; membership: Membership }

export function MemberDetailPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const memberQuery = useQuery({ queryKey: ['member', id], queryFn: () => api.member(id) })
  const memberships = useQuery({ queryKey: ['member-memberships', id], queryFn: () => api.memberMemberships(id) })
  const checkins = useQuery({ queryKey: ['member-checkins', id], queryFn: () => api.memberCheckins(id) })
  const consents = useQuery({ queryKey: ['member-consents', id], queryFn: () => api.memberConsents(id) })
  const face = useQuery({ queryKey: ['face-status', id], queryFn: () => api.faceStatus(id) })
  const plans = useQuery({ queryKey: ['membership-plans'], queryFn: api.membershipPlans })
  const [tab, setTab] = useState('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [renewOpen, setRenewOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [membershipAction, setMembershipAction] = useState<MembershipAction | null>(null)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [toastError, setToastError] = useState(false)
  const queries = [memberQuery, memberships, checkins, consents, face, plans]
  const invalidateDetail = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['member', id] }),
      queryClient.invalidateQueries({ queryKey: ['member-memberships', id] }),
      queryClient.invalidateQueries({ queryKey: ['members'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
    ])
  }
  const update = useMutation({ mutationFn: (value: Partial<Member>) => api.updateMember(id, value), onSuccess: async () => { await invalidateDetail(); setEditOpen(false); showToast('Data member berhasil diperbarui.') } })
  const remove = useMutation({ mutationFn: () => api.deleteMember(id), onSuccess: () => navigate('/members') })
  const statusMutation = useMutation({
    mutationFn: async ({ action, reason }: { action: MembershipAction; reason: string }) => action.kind === 'suspend' ? api.suspendMembership(action.membership.id, reason) : action.kind === 'reactivate' ? api.reactivateMembership(action.membership.id) : api.cancelMembership(action.membership.id),
    onSuccess: async (_, value) => { await invalidateDetail(); setMembershipAction(null); showToast(value.action.kind === 'suspend' ? 'Membership berhasil ditangguhkan.' : value.action.kind === 'reactivate' ? 'Membership berhasil diaktifkan kembali.' : 'Membership berhasil dibatalkan.') },
  })
  const privacyMutation = useMutation({
    mutationFn: async (reason: string) => {
      const activeConsent = consents.data?.find((item) => !item.revoked_at)
      if (activeConsent) return api.revokeConsent(activeConsent.id, reason)
      if (face.data?.enrolled) return api.revokeFaceProfile(id, reason)
      throw new Error('Tidak ada persetujuan atau profil wajah aktif untuk dicabut.')
    },
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['member-consents', id] }), queryClient.invalidateQueries({ queryKey: ['face-status', id] }), queryClient.invalidateQueries({ queryKey: ['member', id] }), queryClient.invalidateQueries({ queryKey: ['members'] })])
      setPrivacyOpen(false)
      showToast('Persetujuan dicabut dan profil wajah aktif telah dinonaktifkan.')
    },
  })
  function showToast(message: string, error = false) { setToast(message); setToastError(error) }

  if (queries.some((query) => query.isLoading)) return <LoadingState />
  const failed = queries.find((query) => query.error)
  if (failed?.error || !memberQuery.data) return <ErrorState error={failed?.error ?? new Error('Member tidak ditemukan.')} retry={() => void Promise.all(queries.map((query) => query.refetch()))} />
  const member = memberQuery.data
  const current = memberships.data?.find((item) => ['ACTIVE', 'PENDING', 'SUSPENDED'].includes(item.derived_status)) ?? memberships.data?.[0]
  const activeConsent = consents.data?.find((item) => !item.revoked_at)
  const canAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'GYM_ADMIN'
  return <>
    <Link className="back-link" to="/members"><ArrowLeft /> Kembali ke Data Member</Link>
    <section className="profile-hero"><div className="profile-main"><div className="avatar avatar-xl">{initials(member.full_name)}</div><div><div className="profile-name"><h1>{member.full_name}</h1><StatusBadge status={member.status} /></div><p>{member.member_code} · Bergabung {formatDate(member.joined_at)}</p><div className="profile-contact"><span><Phone />{member.phone || '-'}</span><span><Mail />{member.email || '-'}</span><span><MapPin />{member.address ?? 'Alamat belum diisi'}</span></div></div></div><div className="profile-actions"><button className="secondary-button" onClick={() => setEditOpen(true)}><Edit3 /> Edit profil</button><button className="primary-button" onClick={() => setRenewOpen(true)} disabled={!plans.data?.some((plan) => plan.is_active)}><CalendarPlus /> Perpanjang</button></div></section>
    <nav className="tabs" aria-label="Detail member"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Ringkasan</button><button className={tab === 'membership' ? 'active' : ''} onClick={() => setTab('membership')}>Riwayat membership</button><button className={tab === 'access' ? 'active' : ''} onClick={() => setTab('access')}>Riwayat akses</button><button className={tab === 'privacy' ? 'active' : ''} onClick={() => setTab('privacy')}>Persetujuan & wajah</button></nav>
    {tab === 'overview' && <div className="detail-grid"><MembershipCard membership={current} plans={plans.data ?? []} onRenew={() => setRenewOpen(true)} /><section className="panel detail-card"><span className="panel-kicker">AKSES WAJAH</span><div className="face-profile"><div className={face.data?.enrolled ? 'face-status-icon ready' : 'face-status-icon'}><ScanFace /></div><div><h2>{face.data?.enrolled ? 'Wajah terdaftar' : 'Belum terdaftar'}</h2><p>{face.data?.last_enrolled_at ? `Terdaftar ${formatDate(face.data.last_enrolled_at)}` : 'Daftarkan wajah untuk check-in mandiri.'}</p></div></div><div className="privacy-row"><ShieldCheck /><span><strong>{activeConsent ? `Consent ${activeConsent.consent_version} aktif` : 'Tidak ada consent aktif'}</strong><small>Gambar mentah tidak ditampilkan</small></span></div><Link className="secondary-button full-button" to={`/enrollment?member=${member.id}`}>{face.data?.enrolled ? 'Daftar ulang wajah' : 'Mulai pendaftaran'}</Link></section><section className="panel detail-card"><span className="panel-kicker">KONTAK DARURAT</span><h2>{member.emergency_contact_name ?? 'Belum ditambahkan'}</h2><p>{member.emergency_contact_phone ?? 'Tambahkan kontak darurat melalui edit profil.'}</p><hr /><span className="panel-kicker">CATATAN</span><p>{member.notes ?? 'Tidak ada catatan untuk member ini.'}</p></section></div>}
    {tab === 'membership' && <MembershipHistory items={memberships.data ?? []} plans={plans.data ?? []} canCancel={canAdmin} onAction={setMembershipAction} />}
    {tab === 'access' && <AccessHistory items={checkins.data ?? []} />}
    {tab === 'privacy' && <PrivacyPanel member={member} consents={consents.data ?? []} faceEnrolled={Boolean(face.data?.enrolled)} onRevoke={() => setPrivacyOpen(true)} />}
    {canAdmin && <div className="danger-zone"><div><Trash2 /><span><strong>Hapus data member</strong><small>Member akan dinonaktifkan dan dihapus secara lunak.</small></span></div><button className="danger-button" onClick={() => setDeleteOpen(true)}>Hapus member</button></div>}
    {editOpen && <MemberForm initial={member} onClose={() => setEditOpen(false)} loading={update.isPending} error={update.error?.message} onSubmit={(value) => update.mutate(value)} />}
    {renewOpen && <RenewModal member={member} plans={plans.data ?? []} onClose={() => setRenewOpen(false)} onSuccess={async () => { await invalidateDetail(); setRenewOpen(false); showToast('Membership berhasil ditambahkan.') }} />}
    {membershipAction && <MembershipActionModal action={membershipAction} loading={statusMutation.isPending} error={statusMutation.error?.message} onClose={() => setMembershipAction(null)} onSubmit={(reason) => statusMutation.mutate({ action: membershipAction, reason })} />}
    {privacyOpen && <ReasonModal title="Cabut persetujuan biometrik?" description="Profil wajah aktif juga akan dinonaktifkan. Alasan disimpan pada audit log." loading={privacyMutation.isPending} error={privacyMutation.error?.message} onClose={() => setPrivacyOpen(false)} onSubmit={(reason) => privacyMutation.mutate(reason)} />}
    {deleteOpen && <Modal title="Hapus member?" description="Tindakan ini menonaktifkan akses dan menjadwalkan penghapusan data sesuai kebijakan retensi." onClose={() => setDeleteOpen(false)}><div className="confirm-body">{remove.error && <div className="form-alert">{remove.error.message}</div>}<p>Pastikan permintaan ini telah diverifikasi sebelum melanjutkan.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setDeleteOpen(false)}>Batal</button><button className="danger-button" onClick={() => remove.mutate()} disabled={remove.isPending}>{remove.isPending ? 'Memproses...' : 'Hapus member'}</button></div></div></Modal>}
    {toast && <Toast type={toastError ? 'error' : 'success'} onClose={() => setToast('')}>{toast}</Toast>}
  </>
}

function MembershipCard({ membership, plans, onRenew }: { membership?: Membership; plans: MembershipPlan[]; onRenew: () => void }) {
  if (!membership) return <section className="panel detail-card"><span className="panel-kicker">MEMBERSHIP SAAT INI</span><EmptyState title="Belum ada membership" message="Tambahkan paket agar member dapat mengakses gym." /><button className="text-button" onClick={onRenew}>Tambahkan membership</button></section>
  const plan = plans.find((item) => item.id === membership.plan_id)
  const start = new Date(membership.start_at).getTime()
  const end = new Date(membership.end_at).getTime()
  const currentTime = new Date().getTime()
  const progress = Math.max(0, Math.min(100, (currentTime - start) / Math.max(1, end - start) * 100))
  const remaining = Math.max(0, Math.ceil((end - currentTime) / 86_400_000))
  return <section className="panel detail-card"><div className="panel-header"><div><span className="panel-kicker">MEMBERSHIP SAAT INI</span><h2>{plan?.name ?? 'Paket membership'}</h2></div><StatusBadge status={membership.derived_status} /></div><div className="membership-dates"><div><span>Mulai</span><strong>{formatDate(membership.start_at)}</strong></div><span className="date-line" /><div><span>Berakhir</span><strong>{formatDate(membership.end_at)}</strong></div></div><div className="membership-progress"><span style={{ width: `${progress}%` }} /></div><p>{remaining ? `${remaining} hari tersisa dalam periode membership.` : 'Periode membership telah berakhir.'}</p><button className="text-button" onClick={onRenew}>Perpanjang membership sekarang</button></section>
}

function MembershipHistory({ items, plans, canCancel, onAction }: { items: Membership[]; plans: MembershipPlan[]; canCancel: boolean; onAction: (action: MembershipAction) => void }) {
  return <section className="panel history-panel"><div className="panel-header"><div><span className="panel-kicker">PERJALANAN MEMBERSHIP</span><h2>Riwayat membership</h2></div></div>{items.length ? items.map((item) => <div className="history-row" key={item.id}><div className="timeline-dot"><Check /></div><div><strong>{plans.find((plan) => plan.id === item.plan_id)?.name ?? 'Paket membership'}</strong><span>{formatDate(item.start_at)} - {formatDate(item.end_at)}{item.suspension_reason ? ` · ${item.suspension_reason}` : ''}</span></div><div className="history-actions"><StatusBadge status={item.derived_status} />{item.status === 'SUSPENDED' ? <button className="text-button" onClick={() => onAction({ kind: 'reactivate', membership: item })}>Aktifkan</button> : item.status !== 'CANCELLED' && <button className="text-button" onClick={() => onAction({ kind: 'suspend', membership: item })}>Tangguhkan</button>}{canCancel && item.status !== 'CANCELLED' && <button className="text-button text-danger" onClick={() => onAction({ kind: 'cancel', membership: item })}>Batalkan</button>}</div></div>) : <EmptyState title="Belum ada riwayat membership" message="Membership yang ditambahkan akan muncul di sini." />}</section>
}

function AccessHistory({ items }: { items: Checkin[] }) {
  return <section className="panel history-panel"><div className="panel-header"><div><span className="panel-kicker">AKTIVITAS PINTU</span><h2>Riwayat akses terbaru</h2></div></div>{items.length ? items.map((item) => <div className="history-row" key={item.id}><div className="timeline-dot"><Check /></div><div><strong>{item.decision === 'ALLOW' ? 'Check-in diizinkan' : 'Akses ditolak'}</strong><span>{item.device_name} · {formatDate(item.attempted_at, true)} · {item.reason_code.replaceAll('_', ' ')}</span></div><StatusBadge status={item.decision} /></div>) : <EmptyState title="Belum ada riwayat akses" message="Percobaan check-in member akan muncul di sini." />}</section>
}

function PrivacyPanel({ member, consents, faceEnrolled, onRevoke }: { member: Member; consents: BiometricConsent[]; faceEnrolled: boolean; onRevoke: () => void }) {
  const active = consents.find((item) => !item.revoked_at)
  return <section className="panel privacy-panel"><div className="privacy-large"><ShieldCheck /><div><span className="panel-kicker">PERSETUJUAN BIOMETRIK</span><h2>{active ? `Consent ${active.consent_version} aktif` : 'Tidak ada persetujuan aktif'}</h2><p>{active ? `Disetujui ${formatDate(active.consented_at)} untuk ${active.capture_purpose}. ${active.retention_policy}` : 'Member harus memberikan persetujuan sebelum profil wajah dapat didaftarkan.'}</p></div></div><div className="privacy-actions"><Link className="secondary-button" to={`/enrollment?member=${member.id}`}>Daftar ulang wajah</Link>{(active || faceEnrolled) && <button className="danger-button" onClick={onRevoke}>Cabut persetujuan & profil</button>}</div>{consents.filter((item) => item.revoked_at).map((item) => <div className="history-row" key={item.id}><div className="timeline-dot"><ShieldCheck /></div><div><strong>Consent {item.consent_version} dicabut</strong><span>{formatDate(item.revoked_at ?? '')}</span></div><StatusBadge status="CANCELLED" /></div>)}</section>
}

function RenewModal({ member, plans, onClose, onSuccess }: { member: Member; plans: MembershipPlan[]; onClose: () => void; onSuccess: () => void | Promise<void> }) {
  const activePlans = plans.filter((item) => item.is_active)
  const [planId, setPlanId] = useState(activePlans[0]?.id ?? '')
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10))
  const [reference, setReference] = useState('')
  const plan = activePlans.find((item) => item.id === planId)
  const renew = useMutation({ mutationFn: () => { if (!plan) throw new Error('Paket tidak tersedia.'); return api.assignMembership(member.id, plan.id, start, plan.price, reference) }, onSuccess })
  return <Modal title="Tambah membership" description={`${member.full_name} · ${member.member_code}`} onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); renew.mutate() }}><div className="renew-summary"><Clock3 /><div><span>Membership tercatat</span><strong>{member.plan} · berakhir {formatDate(member.valid_until)}</strong></div></div><label>Paket baru<select aria-label="Paket baru" required value={planId} onChange={(event) => setPlanId(event.target.value)}>{activePlans.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.duration_days} hari</option>)}</select></label><label>Tanggal mulai<input required type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label><label>Referensi pembayaran<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Opsional" /></label>{renew.error && <div className="form-alert">{renew.error.message}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Batal</button><button className="primary-button" disabled={renew.isPending || !plan}>{renew.isPending ? 'Memproses...' : <><CalendarPlus /> Simpan membership</>}</button></div></form></Modal>
}

function MembershipActionModal({ action, loading, error, onClose, onSubmit }: { action: MembershipAction; loading: boolean; error?: string; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  const needsReason = action.kind === 'suspend'
  const labels = action.kind === 'suspend' ? ['Tangguhkan membership?', 'Tangguhkan'] : action.kind === 'reactivate' ? ['Aktifkan kembali membership?', 'Aktifkan'] : ['Batalkan membership?', 'Batalkan']
  return <Modal title={labels[0]} description="Perubahan status dicatat dalam audit log." onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit(reason) }}>{error && <div className="form-alert">{error}</div>}{needsReason && <label>Alasan penangguhan<textarea aria-label="Alasan penangguhan" required minLength={3} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Batal</button><button className={action.kind === 'cancel' ? 'danger-button' : 'primary-button'} disabled={loading}>{loading ? 'Memproses...' : labels[1]}</button></div></form></Modal>
}

function ReasonModal({ title, description, loading, error, onClose, onSubmit }: { title: string; description: string; loading: boolean; error?: string; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  return <Modal title={title} description={description} onClose={onClose}><form className="modal-form" onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit(reason) }}>{error && <div className="form-alert">{error}</div>}<label>Alasan pencabutan<textarea aria-label="Alasan pencabutan" required minLength={3} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Batal</button><button className="danger-button" disabled={loading}>{loading ? 'Memproses...' : 'Cabut persetujuan'}</button></div></form></Modal>
}
