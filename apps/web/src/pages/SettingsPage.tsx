import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Save, ScanFace, ShieldCheck } from 'lucide-react'
import { api } from '../api/client'
import { ErrorState, LoadingState, PageHeader, Toast } from '../components/ui'
import type { SystemSetting } from '../types'

const labels: Record<string, { title: string; description: string; type: 'score' | 'integer' | 'boolean' | 'text'; unit?: string }> = {
  face_match_threshold: { title: 'Threshold kecocokan', description: 'Ambang minimum untuk menerima identitas hasil pencocokan.', type: 'score' },
  face_min_quality_score: { title: 'Kualitas wajah minimum', description: 'Kualitas minimum sampel sebelum proses pencocokan.', type: 'score' },
  liveness_min_score: { title: 'Liveness minimum', description: 'Ambang minimum verifikasi keaktifan wajah.', type: 'score' },
  depth_validation_enabled: { title: 'Validasi depth', description: 'Aktifkan validasi depth untuk kiosk RGB-D yang kompatibel.', type: 'boolean' },
  depth_min_score: { title: 'Depth minimum', description: 'Ambang kualitas depth jika validasi depth aktif.', type: 'score' },
  checkin_cooldown_seconds: { title: 'Cooldown check-in', description: 'Cegah percobaan berulang member dalam periode singkat.', type: 'integer', unit: 'detik' },
  raw_capture_retention_hours: { title: 'Retensi tangkapan mentah', description: 'Masa retensi maksimum tangkapan sementara sebelum dihapus.', type: 'integer', unit: 'jam' },
  privacy_notice_version: { title: 'Versi pemberitahuan privasi', description: 'Versi dokumen privasi yang berlaku saat ini.', type: 'text' },
}

export function SettingsPage() {
  const query = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  if (query.isLoading) return <LoadingState label="Memuat pengaturan sistem..." />
  if (query.error || !query.data) return <ErrorState error={query.error ?? new Error('Pengaturan tidak tersedia.')} retry={() => void query.refetch()} />
  return <SettingsForm settings={query.data} />
}

function SettingsForm({ settings }: { settings: SystemSetting[] }) {
  const queryClient = useQueryClient()
  const initial = Object.fromEntries(settings.map((item) => [item.key, item.value])) as Record<string, SystemSetting['value']>
  const [values, setValues] = useState(initial)
  const [saved, setSaved] = useState(false)
  const save = useMutation({
    mutationFn: async (changes: [string, SystemSetting['value']][]) => {
      const updated: SystemSetting[] = []
      for (const [key, value] of changes) updated.push(await api.updateSetting(key, value))
      return updated
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData<SystemSetting[]>(['settings'], (current = []) => current.map((item) => updated.find((next) => next.key === item.key) ?? item))
      setSaved(true)
    },
    onError: () => { void queryClient.invalidateQueries({ queryKey: ['settings'] }) },
  })
  const changed = Object.entries(values).filter(([key, value]) => value !== initial[key])
  function submit(event: FormEvent) {
    event.preventDefault()
    setSaved(false)
    save.mutate(changed)
  }
  function update(key: string, value: SystemSetting['value']) { setValues((current) => ({ ...current, [key]: value })) }

  return <>
    <PageHeader eyebrow="KONFIGURASI SISTEM" title="Pengaturan" description="Pengaturan sensitif hanya tersedia untuk Super Admin dan setiap perubahan diaudit." />
    <div className="settings-layout"><nav className="settings-nav"><button className="active"><ScanFace /> Konfigurasi akses</button></nav><form className="panel settings-panel" onSubmit={submit}><div className="settings-heading"><div><span className="panel-kicker">KALIBRASI, AKSES & RETENSI</span><h2>Pengaturan sistem</h2><p>Nilai berasal dari konfigurasi API. Simpan hanya akan mengirim field yang berubah.</p></div><ShieldCheck /></div><div className="settings-warning"><AlertTriangle /><span><strong>Perubahan berdampak pada keamanan dan privasi.</strong> Tinjau nilai dengan hati-hati. API mencatat operator, nilai lama, dan nilai baru pada audit log.</span></div>{settings.map((setting) => { const meta = labels[setting.key]; if (!meta) return null; return <div className="setting-row" key={setting.key}><div><strong>{meta.title}</strong><p>{meta.description}</p></div><SettingInput value={values[setting.key]} meta={meta} onChange={(value) => update(setting.key, value)} /></div> })}{save.error && <div className="form-alert" role="alert">{save.error.message}</div>}<footer><span><Check /> {changed.length ? `${changed.length} perubahan belum disimpan` : 'Tidak ada perubahan'}</span><button className="primary-button" disabled={save.isPending || !changed.length}><Save /> {save.isPending ? 'Menyimpan...' : 'Simpan perubahan'}</button></footer></form></div>
    {saved && <Toast onClose={() => setSaved(false)}>Pengaturan berhasil disimpan dan perubahan telah dicatat pada audit log.</Toast>}
  </>
}

function SettingInput({ value, meta, onChange }: { value: SystemSetting['value']; meta: (typeof labels)[string]; onChange: (value: SystemSetting['value']) => void }) {
  if (meta.type === 'boolean') return <label className="switch"><input aria-label={meta.title} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /><span /></label>
  if (meta.type === 'text') return <input className="setting-text" aria-label={meta.title} value={String(value)} onChange={(event) => onChange(event.target.value)} />
  const input = <input aria-label={meta.title} type="number" min={meta.type === 'score' ? 0 : 0} max={meta.type === 'score' ? 1 : undefined} step={meta.type === 'score' ? 0.01 : 1} value={String(value)} onChange={(event) => onChange(meta.type === 'integer' ? Number.parseInt(event.target.value || '0', 10) : Number(event.target.value))} />
  return meta.unit ? <div className="unit-input">{input}<span>{meta.unit}</span></div> : <div className="number-input">{input}<span>0.00 - 1.00</span></div>
}
