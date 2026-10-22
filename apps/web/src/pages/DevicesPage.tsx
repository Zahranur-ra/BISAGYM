import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, CheckCircle2, Copy, Cpu, KeyRound, MapPin, Plus, RefreshCw, Router, Wifi, WifiOff } from 'lucide-react'
import { api, type DeviceInput } from '../api/client'
import { ErrorState, LoadingState, Modal, PageHeader, Toast, formatDate } from '../components/ui'
import type { Device } from '../types'

export function DevicesPage() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['devices'], queryFn: api.devices, refetchInterval: 30_000 })
  const [registerOpen, setRegisterOpen] = useState(false)
  const [credential, setCredential] = useState<{ name: string; value: string } | null>(null)
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null)
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.toggleDevice(id, active),
    onSuccess: (_, values) => { queryClient.setQueryData<Device[]>(['devices'], (current = []) => current.map((item) => item.id === values.id ? { ...item, active: values.active } : item)); setToast({ message: `Perangkat berhasil ${values.active ? 'diaktifkan' : 'dinonaktifkan'}.` }) },
    onError: (error) => setToast({ message: error.message, error: true }),
  })
  const create = useMutation({
    mutationFn: api.createDevice,
    onSuccess: ({ device, credential: oneTimeCredential }) => {
      queryClient.setQueryData<Device[]>(['devices'], (current = []) => [...current, device])
      setRegisterOpen(false)
      setCredential({ name: device.name, value: oneTimeCredential })
    },
  })
  const rotate = useMutation({
    mutationFn: (device: Device) => api.rotateDeviceCredential(device.id).then((result) => ({ device, result })),
    onSuccess: ({ device, result }) => setCredential({ name: device.name, value: result.credential }),
    onError: (error) => setToast({ message: error.message, error: true }),
  })
  if (query.isLoading) return <LoadingState />
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />
  return <>
    <PageHeader eyebrow="INFRASTRUKTUR AKSES" title="Perangkat" description="Pantau kesehatan kamera, heartbeat, dan kredensial kiosk." action={<><button className="secondary-button" onClick={() => void query.refetch()}><RefreshCw /> Segarkan</button><button className="primary-button" onClick={() => setRegisterOpen(true)}><Plus /> Daftarkan kiosk</button></>} />
    <div className="device-overview"><div><Router /><span><small>Total perangkat</small><strong>{query.data?.length}</strong></span></div><div><Wifi /><span><small>Online</small><strong>{query.data?.filter((item) => item.online).length}</strong></span></div><div><Camera /><span><small>Kamera siap</small><strong>{query.data?.filter((item) => item.camera_status === 'Siap').length}</strong></span></div><div><WifiOff /><span><small>Perlu perhatian</small><strong>{query.data?.filter((item) => !item.online).length}</strong></span></div></div>
    <div className="device-grid">{query.data?.map((device) => <article className={`panel device-card ${!device.online ? 'device-offline' : ''}`} key={device.id}><header><div className="device-icon"><Cpu /></div><div><div className={`connection-label ${device.online ? 'online' : 'offline'}`}><span />{device.online ? 'ONLINE' : 'OFFLINE'}</div><h2>{device.name}</h2><span>{device.code}</span></div></header><div className="device-location"><MapPin /> {device.location}</div><div className="device-stats"><div><span>Heartbeat terakhir</span><strong>{device.last_seen_at ? formatDate(device.last_seen_at, true) : 'Belum pernah'}</strong></div><div><span>Status kamera</span><strong className={device.camera_status === 'Siap' ? 'text-success' : 'text-danger'}>{device.camera_status}</strong></div><div><span>Versi software</span><strong>{device.version === '-' ? '-' : `v${device.version}`}</strong></div><div><span>Kemampuan</span><strong>{device.capabilities.join(' + ') || '-'}</strong></div></div><footer><label className="switch"><input aria-label={`Aktifkan ${device.name}`} type="checkbox" checked={device.active} disabled={toggle.isPending} onChange={(event) => toggle.mutate({ id: device.id, active: event.target.checked })} /><span /></label><small>{device.active ? 'Perangkat aktif' : 'Perangkat nonaktif'}</small><button className="text-button" disabled={rotate.isPending} onClick={() => rotate.mutate(device)}><KeyRound /> Rotasi kredensial</button></footer></article>)}</div>
    <div className="security-callout"><CheckCircle2 /><div><strong>Autentikasi perangkat aktif</strong><p>Kredensial baru hanya ditampilkan satu kali. Simpan langsung pada konfigurasi kiosk yang bersangkutan.</p></div></div>
    {registerOpen && <DeviceForm loading={create.isPending} error={create.error?.message} onClose={() => setRegisterOpen(false)} onSubmit={(value) => create.mutate(value)} />}
    {credential && <CredentialModal deviceName={credential.name} credential={credential.value} onClose={() => setCredential(null)} />}
    {toast && <Toast type={toast.error ? 'error' : 'success'} onClose={() => setToast(null)}>{toast.message}</Toast>}
  </>
}

function DeviceForm({ loading, error, onClose, onSubmit }: { loading: boolean; error?: string; onClose: () => void; onSubmit: (value: DeviceInput) => void }) {
  const [form, setForm] = useState({ name: '', location: '', code: '', rgb: true, active_liveness: true, depth: false })
  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit({ name: form.name.trim(), device_code: form.code.trim(), capabilities: { location: form.location.trim(), rgb: form.rgb, active_liveness: form.active_liveness, depth: form.depth } })
  }
  return <Modal title="Daftarkan kiosk baru" description="Kredensial hanya ditampilkan sekali setelah perangkat dibuat." onClose={onClose}><form className="modal-form" onSubmit={submit}>{error && <div className="form-alert" role="alert">{error}</div>}<label>Nama perangkat<input aria-label="Nama perangkat" required minLength={2} placeholder="Contoh: Kiosk Studio 2" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Lokasi<input aria-label="Lokasi perangkat" required placeholder="Contoh: Lantai 2" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label><label>Kode perangkat<input aria-label="Kode perangkat" required minLength={3} placeholder="KIOSK-004" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label><div className="capability-checks"><label className="checkbox"><input type="checkbox" checked={form.rgb} onChange={(event) => setForm({ ...form, rgb: event.target.checked })} /> Kamera RGB</label><label className="checkbox"><input type="checkbox" checked={form.active_liveness} onChange={(event) => setForm({ ...form, active_liveness: event.target.checked })} /> Active liveness</label><label className="checkbox"><input type="checkbox" checked={form.depth} onChange={(event) => setForm({ ...form, depth: event.target.checked })} /> Kamera depth</label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Batal</button><button className="primary-button" disabled={loading}>{loading ? 'Mendaftarkan...' : <><Plus /> Daftarkan</>}</button></div></form></Modal>
}

function CredentialModal({ deviceName, credential, onClose }: { deviceName: string; credential: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  async function copy() { await navigator.clipboard?.writeText(credential); setCopied(true) }
  return <Modal title="Kredensial satu kali" description={`${deviceName} · kredensial ini tidak dapat dilihat lagi setelah dialog ditutup.`} onClose={onClose}><div className="confirm-body"><div className="credential-value"><code>{credential}</code><button className="secondary-button" onClick={() => void copy()}><Copy /> {copied ? 'Tersalin' : 'Salin'}</button></div><div className="modal-actions"><button className="primary-button" onClick={onClose}>Saya sudah menyimpan</button></div></div></Modal>
}
