import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Filter, Plus, Search, UserPlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import { api } from '../api/client'
import { useAuth } from '../auth'
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader, StatusBadge, Toast, formatDate, initials } from '../components/ui'
import type { Member, MembershipPlan, MemberStatus } from '../types'

const memberSchema = z.object({
  full_name: z.string().trim().min(3, 'Nama minimal 3 karakter.'),
  email: z.string().email('Format email tidak valid.').or(z.literal('')),
  phone: z.string().trim().min(9, 'Nomor telepon minimal 9 digit.'),
  status: z.enum(['PENDING', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED']),
  plan_id: z.string().optional(),
  membership_start: z.string().optional(),
})

type MemberFormValue = Omit<Member, 'id' | 'member_code' | 'joined_at'> & { plan_id?: string; membership_start?: string }

export function MembersPage() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const query = useQuery({ queryKey: ['members'], queryFn: api.members })
  const plans = useQuery({ queryKey: ['membership-plans'], queryFn: api.membershipPlans })
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')
  const [showForm, setShowForm] = useState(false)
  const [toast, setToast] = useState('')
  const filtered = useMemo(() => query.data?.filter((member) => {
    const matchesSearch = `${member.full_name} ${member.member_code} ${member.phone}`.toLowerCase().includes(search.toLowerCase())
    return matchesSearch && (status === 'ALL' || member.status === status)
  }) ?? [], [query.data, search, status])

  const create = useMutation({
    mutationFn: async (value: MemberFormValue) => {
      const { plan_id, membership_start, ...profile } = value
      const member = await api.createMember(profile)
      const plan = plans.data?.find((item) => item.id === plan_id)
      try {
        if (!plan || !membership_start) throw new Error('Paket atau tanggal mulai tidak tersedia.')
        await api.assignMembership(member.id, plan.id, membership_start, plan.price)
        return { member, partialError: '' }
      } catch (error) {
        return { member, partialError: error instanceof Error ? error.message : 'Membership tidak dapat ditetapkan.' }
      }
    },
    onSuccess: ({ member, partialError }) => {
      queryClient.setQueryData<Member[]>(['members'], (current = []) => [member, ...current])
      void queryClient.invalidateQueries({ queryKey: ['members'] })
      setShowForm(false)
      setToast(partialError ? `${member.full_name} tetap tersimpan, tetapi membership gagal ditetapkan: ${partialError}` : `${member.full_name} dan membership berhasil ditambahkan.`)
    },
  })

  if (query.isLoading || plans.isLoading) return <LoadingState label="Memuat data member..." />
  if (query.error || plans.error) return <ErrorState error={(query.error ?? plans.error) as Error} retry={() => void Promise.all([query.refetch(), plans.refetch()])} />

  return <>
    <PageHeader eyebrow="MANAJEMEN MEMBER" title="Data Member" description={`${query.data?.length ?? 0} member terdaftar di ${user?.branch_name ?? 'cabang aktif'}.`} action={<button className="primary-button" onClick={() => setShowForm(true)} disabled={!plans.data?.some((item) => item.is_active)}><Plus /> Tambah member</button>} />
    <div className="panel table-panel">
      <div className="table-toolbar"><div className="search-field"><Search /><input aria-label="Cari member" placeholder="Cari nama, kode, atau nomor telepon..." value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="filter-group"><div className="select-wrap"><Filter /><select aria-label="Filter status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Semua status</option><option value="ACTIVE">Aktif</option><option value="PENDING">Menunggu</option><option value="EXPIRED">Kedaluwarsa</option><option value="SUSPENDED">Ditangguhkan</option></select><ChevronDown /></div></div></div>
      {filtered.length ? <div className="table-scroll"><table><thead><tr><th>Member</th><th>Status</th><th>Paket</th><th>Berlaku hingga</th><th>Wajah</th></tr></thead><tbody>{filtered.map((member) => <tr key={member.id}><td><Link className="member-cell" to={`/members/${member.id}`}><span className="avatar">{initials(member.full_name)}</span><span><strong>{member.full_name}</strong><small>{member.member_code} · {member.phone}</small></span></Link></td><td><StatusBadge status={member.status} /></td><td><span className="plan-name">{member.plan}</span></td><td><span className={member.status === 'EXPIRED' ? 'text-danger' : ''}>{formatDate(member.valid_until)}</span></td><td>{member.face_enrolled ? <span className="face-ready"><span /> Terdaftar</span> : <Link className="face-missing" to={`/enrollment?member=${member.id}`}>Belum daftar</Link>}</td></tr>)}</tbody></table></div> : <EmptyState title="Member tidak ditemukan" message="Ubah kata kunci atau filter untuk melihat hasil lain." />}
      <div className="table-footer"><span>Menampilkan <strong>{filtered.length}</strong> dari {query.data?.length} member</span></div>
    </div>
    {showForm && <MemberForm plans={plans.data} onClose={() => setShowForm(false)} loading={create.isPending} error={create.error?.message} onSubmit={(value) => create.mutate({ ...value, face_enrolled: false })} />}
    {toast && <Toast type={toast.includes('gagal') ? 'error' : 'success'} onClose={() => setToast('')}>{toast}</Toast>}
  </>
}

export function MemberForm({ initial, plans = [], onClose, onSubmit, loading, error }: { initial?: Member; plans?: MembershipPlan[]; onClose: () => void; onSubmit: (member: MemberFormValue) => void; loading: boolean; error?: string }) {
  const activePlans = plans.filter((item) => item.is_active)
  const [form, setForm] = useState({ full_name: initial?.full_name ?? '', email: initial?.email ?? '', phone: initial?.phone ?? '', status: initial?.status ?? 'ACTIVE' as MemberStatus, plan: initial?.plan ?? '', valid_until: initial?.valid_until ?? '', plan_id: activePlans[0]?.id ?? '', membership_start: new Date().toISOString().slice(0, 10), address: initial?.address ?? '', emergency_contact_name: initial?.emergency_contact_name ?? '', emergency_contact_phone: initial?.emergency_contact_phone ?? '', notes: initial?.notes ?? '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  function update(name: string, value: string) { setForm((current) => ({ ...current, [name]: value })) }
  function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = memberSchema.safeParse(form)
    if (!initial && (!form.plan_id || !form.membership_start)) {
      setErrors({ plan_id: !form.plan_id ? 'Pilih paket membership.' : '', membership_start: !form.membership_start ? 'Pilih tanggal mulai.' : '' })
      return
    }
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])))
      return
    }
    setErrors({})
    onSubmit({ ...form, face_enrolled: initial?.face_enrolled ?? false })
  }
  return <Modal title={initial ? 'Edit data member' : 'Tambah member baru'} description="Informasi ini digunakan untuk keanggotaan dan akses gym." onClose={onClose} wide>
    <form className="modal-form" onSubmit={submit} noValidate>
      {error && <div className="form-alert" role="alert">{error}</div>}
      <div className="form-section"><h3>Informasi pribadi</h3><div className="form-grid"><label className="full-field">Nama lengkap *<input aria-label="Nama lengkap" value={form.full_name} onChange={(e) => update('full_name', e.target.value)} aria-invalid={!!errors.full_name} />{errors.full_name && <span className="field-error">{errors.full_name}</span>}</label><label>Email<input aria-label="Email" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} aria-invalid={!!errors.email} />{errors.email && <span className="field-error">{errors.email}</span>}</label><label>Nomor telepon *<input aria-label="Nomor telepon" value={form.phone} onChange={(e) => update('phone', e.target.value)} aria-invalid={!!errors.phone} />{errors.phone && <span className="field-error">{errors.phone}</span>}</label><label className="full-field">Alamat<textarea value={form.address} onChange={(e) => update('address', e.target.value)} rows={2} /></label></div></div>
      {!initial && <div className="form-section"><h3>Membership</h3><div className="form-grid"><label>Paket *<select aria-label="Paket membership" value={form.plan_id} onChange={(e) => update('plan_id', e.target.value)} aria-invalid={!!errors.plan_id}>{activePlans.map((plan) => <option value={plan.id} key={plan.id}>{plan.name} · {plan.duration_days} hari</option>)}</select>{errors.plan_id && <span className="field-error">{errors.plan_id}</span>}</label><label>Tanggal mulai *<input aria-label="Tanggal mulai membership" type="date" value={form.membership_start} onChange={(e) => update('membership_start', e.target.value)} aria-invalid={!!errors.membership_start} />{errors.membership_start && <span className="field-error">{errors.membership_start}</span>}</label></div></div>}
      <div className="form-section"><h3>Kontak darurat</h3><div className="form-grid"><label>Nama kontak<input value={form.emergency_contact_name} onChange={(e) => update('emergency_contact_name', e.target.value)} /></label><label>Nomor kontak<input value={form.emergency_contact_phone} onChange={(e) => update('emergency_contact_phone', e.target.value)} /></label><label className="full-field">Catatan<textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} rows={2} /></label></div></div>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Batal</button><button className="primary-button" disabled={loading}>{loading ? 'Menyimpan...' : <><UserPlus /> Simpan member</>}</button></div>
    </form>
  </Modal>
}
