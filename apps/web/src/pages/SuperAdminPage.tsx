import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Plus, ShieldCheck, UserPlus } from 'lucide-react'
import { api } from '../api/client'
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader, StatusBadge, Toast, formatDate } from '../components/ui'
import type { Role } from '../types'

export function SuperAdminPage() {
  const queryClient = useQueryClient()
  const users = useQuery({ queryKey: ['users'], queryFn: api.users })
  const branches = useQuery({ queryKey: ['branches'], queryFn: api.branches })
  const [modal, setModal] = useState<'user' | 'branch' | null>(null)
  const [toast, setToast] = useState('')
  const createUser = useMutation({ mutationFn: api.createUser, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['users'] }); setModal(null); setToast('Pengguna berhasil dibuat.') } })
  const createBranch = useMutation({ mutationFn: api.createBranch, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['branches'] }); setModal(null); setToast('Cabang berhasil dibuat.') } })
  if (users.isLoading || branches.isLoading) return <LoadingState label="Memuat administrasi sistem..." />
  if (users.error || branches.error) return <ErrorState error={(users.error ?? branches.error) as Error} retry={() => void Promise.all([users.refetch(), branches.refetch()])} />
  const branchMap = new Map(branches.data?.map((branch) => [branch.id, branch.name]))
  return <>
    <PageHeader eyebrow="KONTROL ORGANISASI" title="Super Admin" description="Kelola akun operator dan cabang yang dapat menggunakan sistem." action={<><button className="secondary-button" onClick={() => setModal('branch')}><Building2 /> Tambah cabang</button><button className="primary-button" onClick={() => setModal('user')}><UserPlus /> Tambah pengguna</button></>} />
    <section className="admin-grid"><div className="panel admin-section"><div className="panel-header"><div><span className="panel-kicker">AKUN OPERATOR</span><h2>Pengguna</h2></div><span className="count-pill">{users.data?.length ?? 0}</span></div>{users.data?.length ? <div className="table-scroll"><table><thead><tr><th>Pengguna</th><th>Peran</th><th>Cabang</th><th>Login terakhir</th><th>Status</th></tr></thead><tbody>{users.data.map((user) => <tr key={user.id}><td><strong>{user.full_name}</strong><small className="table-sub">{user.email}</small></td><td>{roleLabel(user.role)}</td><td>{user.branch_id ? branchMap.get(user.branch_id) ?? user.branch_id : 'Semua cabang'}</td><td>{formatDate(user.last_login_at ?? '', true)}</td><td><StatusBadge status={user.is_active === false ? 'CANCELLED' : 'ACTIVE'} /></td></tr>)}</tbody></table></div> : <EmptyState title="Belum ada pengguna" message="Tambahkan akun operator pertama." />}</div>
      <div className="panel admin-section"><div className="panel-header"><div><span className="panel-kicker">LOKASI OPERASIONAL</span><h2>Cabang</h2></div><span className="count-pill">{branches.data?.length ?? 0}</span></div>{branches.data?.length ? <div className="branch-list">{branches.data.map((branch) => <article key={branch.id}><div className="plan-icon"><Building2 /></div><div><strong>{branch.name}</strong><span>{branch.code} · {branch.timezone}</span><small>{branch.address || 'Alamat belum diisi'}</small></div><StatusBadge status={branch.is_active ? 'ACTIVE' : 'CANCELLED'} /></article>)}</div> : <EmptyState title="Belum ada cabang" message="Tambahkan cabang sebelum membuat operator cabang." />}</div></section>
    {modal === 'user' && <UserForm branches={branches.data ?? []} loading={createUser.isPending} error={createUser.error?.message} onClose={() => setModal(null)} onSubmit={(value) => createUser.mutate(value)} />}
    {modal === 'branch' && <BranchForm loading={createBranch.isPending} error={createBranch.error?.message} onClose={() => setModal(null)} onSubmit={(value) => createBranch.mutate(value)} />}
    {toast && <Toast onClose={() => setToast('')}>{toast}</Toast>}
  </>
}

function UserForm({ branches, loading, error, onClose, onSubmit }: { branches: { id: string; name: string }[]; loading: boolean; error?: string; onClose: () => void; onSubmit: (value: { branch_id: string | null; full_name: string; email: string; password: string; role: Role }) => void }) {
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'GYM_ADMIN' as Role, branch_id: branches[0]?.id ?? '' })
  const needsBranch = form.role !== 'SUPER_ADMIN'
  return <Modal title="Tambah pengguna" description="Tentukan peran dan cakupan cabang sesuai tanggung jawab operator." onClose={onClose}><form className="modal-form" onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit({ ...form, branch_id: needsBranch ? form.branch_id : null }) }}>{error && <div className="form-alert" role="alert">{error}</div>}<label>Nama lengkap<input aria-label="Nama pengguna" required minLength={2} value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></label><label>Email<input aria-label="Email pengguna" required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Kata sandi awal<input aria-label="Kata sandi awal" required type="password" minLength={10} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label><div className="form-grid"><label>Peran<select aria-label="Peran pengguna" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}><option value="SUPER_ADMIN">Super Admin</option><option value="GYM_ADMIN">Gym Admin</option><option value="RECEPTIONIST">Resepsionis</option></select></label><label>Cabang<select aria-label="Cabang pengguna" required={needsBranch} disabled={!needsBranch} value={needsBranch ? form.branch_id : ''} onChange={(event) => setForm({ ...form, branch_id: event.target.value })}><option value="">Pilih cabang</option>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Batal</button><button className="primary-button" disabled={loading || (needsBranch && !form.branch_id)}>{loading ? 'Membuat...' : <><Plus /> Buat pengguna</>}</button></div></form></Modal>
}

function BranchForm({ loading, error, onClose, onSubmit }: { loading: boolean; error?: string; onClose: () => void; onSubmit: (value: { code: string; name: string; address: string | null; timezone: string; is_active: boolean }) => void }) {
  const [form, setForm] = useState({ code: '', name: '', address: '', timezone: 'Asia/Jakarta', is_active: true })
  return <Modal title="Tambah cabang" description="Kode cabang harus unik untuk seluruh organisasi." onClose={onClose}><form className="modal-form" onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit({ ...form, address: form.address.trim() || null }) }}>{error && <div className="form-alert" role="alert">{error}</div>}<div className="form-grid"><label>Kode cabang<input aria-label="Kode cabang" required minLength={2} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label><label>Nama cabang<input aria-label="Nama cabang" required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label></div><label>Alamat<textarea aria-label="Alamat cabang" rows={3} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label><label>Zona waktu<input aria-label="Zona waktu" required value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /></label><label className="checkbox"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Cabang aktif</label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Batal</button><button className="primary-button" disabled={loading}>{loading ? 'Membuat...' : <><ShieldCheck /> Buat cabang</>}</button></div></form></Modal>
}

function roleLabel(role: Role) {
  return role === 'SUPER_ADMIN' ? 'Super Admin' : role === 'GYM_ADMIN' ? 'Gym Admin' : 'Resepsionis'
}
