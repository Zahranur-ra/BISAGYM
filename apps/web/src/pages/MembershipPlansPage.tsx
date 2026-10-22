import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Edit3, Plus, WalletCards } from 'lucide-react'
import { api, type PlanInput } from '../api/client'
import { useAuth } from '../auth'
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader, StatusBadge, Toast, formatDate } from '../components/ui'
import type { MembershipPlan } from '../types'

export function MembershipPlansPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const plans = useQuery({ queryKey: ['membership-plans'], queryFn: api.membershipPlans })
  const expiring = useQuery({ queryKey: ['expiring-memberships', 7], queryFn: () => api.expiringMemberships(7) })
  const members = useQuery({ queryKey: ['members'], queryFn: api.members })
  const [editing, setEditing] = useState<MembershipPlan | null | undefined>(undefined)
  const [toast, setToast] = useState('')
  const canAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'GYM_ADMIN'
  const save = useMutation({
    mutationFn: (value: PlanInput) => editing ? api.updateMembershipPlan(editing.id, value) : api.createMembershipPlan(value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['membership-plans'] })
      setToast(editing ? 'Paket membership berhasil diperbarui.' : 'Paket membership berhasil dibuat.')
      setEditing(undefined)
    },
  })
  const queries = [plans, expiring, members]
  if (queries.some((query) => query.isLoading)) return <LoadingState label="Memuat paket membership..." />
  const failed = queries.find((query) => query.error)
  if (failed?.error) return <ErrorState error={failed.error} retry={() => void Promise.all(queries.map((query) => query.refetch()))} />

  const planNames = new Map(plans.data?.map((plan) => [plan.id, plan.name]))
  const memberNames = new Map(members.data?.map((member) => [member.id, member]))
  return <>
    <PageHeader eyebrow="PRODUK KEANGGOTAAN" title="Paket Membership" description="Kelola pilihan paket dan pantau membership yang segera berakhir." action={canAdmin && <button className="primary-button" onClick={() => setEditing(null)}><Plus /> Buat paket</button>} />
    <section className="plan-grid">
      {plans.data?.map((plan) => {
        const canEdit = canAdmin && (user?.role === 'SUPER_ADMIN' || plan.branch_id !== null)
        return <article className="panel plan-card" key={plan.id}><header><div className="plan-icon"><WalletCards /></div><StatusBadge status={plan.is_active ? 'ACTIVE' : 'CANCELLED'} /></header><h2>{plan.name}</h2><p>{plan.description || 'Tidak ada deskripsi paket.'}</p><div className="plan-price"><strong>{rupiah(plan.price)}</strong><span>/ {plan.duration_days} hari</span></div><footer><span>{plan.branch_id ? 'Paket cabang' : 'Paket global'}</span>{canEdit && <button className="text-button" onClick={() => setEditing(plan)}><Edit3 /> Edit</button>}</footer></article>
      })}
    </section>
    {!plans.data?.length && <div className="panel"><EmptyState title="Belum ada paket" message="Admin dapat membuat paket membership pertama." /></div>}
    <section className="panel expiry-panel"><div className="panel-header"><div><span className="panel-kicker">7 HARI KE DEPAN</span><h2>Membership segera berakhir</h2></div><span className="count-pill">{expiring.data?.total ?? 0}</span></div>{expiring.data?.items.length ? <div className="table-scroll"><table><thead><tr><th>Member</th><th>Paket</th><th>Berakhir</th><th>Status</th></tr></thead><tbody>{expiring.data.items.map((membership) => { const member = memberNames.get(membership.member_id); return <tr key={membership.id}><td><strong>{member?.full_name ?? 'Member'}</strong><small className="table-sub">{member?.member_code ?? membership.member_id}</small></td><td>{planNames.get(membership.plan_id) ?? 'Paket membership'}</td><td>{formatDate(membership.end_at)}</td><td><StatusBadge status={membership.derived_status} /></td></tr> })}</tbody></table></div> : <EmptyState title="Tidak ada membership segera berakhir" message="Tidak ada membership aktif yang berakhir dalam 7 hari ke depan." />}</section>
    {editing !== undefined && <PlanForm initial={editing ?? undefined} loading={save.isPending} error={save.error?.message} onClose={() => setEditing(undefined)} onSubmit={(value) => save.mutate(value)} />}
    {toast && <Toast onClose={() => setToast('')}>{toast}</Toast>}
  </>
}

function PlanForm({ initial, loading, error, onClose, onSubmit }: { initial?: MembershipPlan; loading: boolean; error?: string; onClose: () => void; onSubmit: (value: PlanInput) => void }) {
  const [form, setForm] = useState({ name: initial?.name ?? '', duration_days: String(initial?.duration_days ?? 30), price: initial?.price ?? '', description: initial?.description ?? '', is_active: initial?.is_active ?? true })
  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit({ name: form.name.trim(), duration_days: Number(form.duration_days), price: Number(form.price), description: form.description.trim() || null, is_active: form.is_active })
  }
  return <Modal title={initial ? 'Edit paket membership' : 'Buat paket membership'} description="Durasi dan harga digunakan saat membership ditetapkan ke member." onClose={onClose}><form className="modal-form" onSubmit={submit}>{error && <div className="form-alert" role="alert">{error}</div>}<label>Nama paket<input aria-label="Nama paket" required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><div className="form-grid"><label>Durasi (hari)<input aria-label="Durasi hari" required type="number" min="1" max="3650" value={form.duration_days} onChange={(event) => setForm({ ...form, duration_days: event.target.value })} /></label><label>Harga<input aria-label="Harga paket" required type="number" min="0" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label></div><label>Deskripsi<textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label className="checkbox"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Paket aktif</label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Batal</button><button className="primary-button" disabled={loading}>{loading ? 'Menyimpan...' : 'Simpan paket'}</button></div></form></Modal>
}

function rupiah(value: string) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value))
}
