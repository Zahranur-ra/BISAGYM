import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Download, FileBarChart, Hand, MonitorCheck, Users } from 'lucide-react'
import { api } from '../api/client'
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge, Toast, formatDate } from '../components/ui'
import type { Checkin, Device, Membership } from '../types'

const reportTabs = ['Kehadiran harian', 'Kehadiran member', 'Penolakan akses', 'Membership berakhir', 'Kesehatan perangkat', 'Override manual'] as const
type ReportTab = typeof reportTabs[number]

export function ReportsPage() {
  const now = new Date()
  const [tab, setTab] = useState<ReportTab>(reportTabs[0])
  const [start, setStart] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10))
  const [end, setEnd] = useState(now.toISOString().slice(0, 10))
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const attendanceTab = tab === 'Kehadiran harian' || tab === 'Kehadiran member' || tab === 'Override manual'
  const attendance = useQuery({ queryKey: ['report-attendance', start, end], queryFn: () => api.attendanceReport(start, end), enabled: attendanceTab })
  const denials = useQuery({ queryKey: ['report-denials', start, end], queryFn: () => api.denialReport(start, end), enabled: tab === 'Penolakan akses' })
  const expiring = useQuery({ queryKey: ['expiring-memberships', 30], queryFn: () => api.expiringMemberships(30), enabled: tab === 'Membership berakhir' })
  const devices = useQuery({ queryKey: ['report-device-health'], queryFn: api.deviceHealth, enabled: tab === 'Kesehatan perangkat' })
  const members = useQuery({ queryKey: ['members'], queryFn: api.members, enabled: tab === 'Membership berakhir' })
  const plans = useQuery({ queryKey: ['membership-plans'], queryFn: api.membershipPlans, enabled: tab === 'Membership berakhir' })
  const activeQueries = attendanceTab ? [attendance] : tab === 'Penolakan akses' ? [denials] : tab === 'Membership berakhir' ? [expiring, members, plans] : [devices]

  async function downloadCsv() {
    setExporting(true)
    setExportError('')
    try {
      const blob = await api.attendanceCsv(start, end)
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `laporan-kehadiran-${start}-${end}.csv`
      link.click()
      URL.revokeObjectURL(href)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Ekspor gagal diproses.')
    } finally {
      setExporting(false)
    }
  }
  if (activeQueries.some((query) => query.isLoading)) return <LoadingState label="Menyiapkan laporan..." />
  const failed = activeQueries.find((query) => query.error)
  if (failed?.error) return <ErrorState error={failed.error} retry={() => void Promise.all(activeQueries.map((query) => query.refetch()))} />

  return <>
    <PageHeader eyebrow="ANALITIK OPERASIONAL" title="Laporan" description="Data kehadiran, akses, membership, dan kesehatan perangkat tanpa membuka data biometrik." action={<button className="primary-button" onClick={() => void downloadCsv()} disabled={exporting}><Download /> {exporting ? 'Menyiapkan...' : 'Unduh CSV kehadiran'}</button>} />
    <div className="report-controls"><div className="report-tabs">{reportTabs.map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>{tab !== 'Membership berakhir' && tab !== 'Kesehatan perangkat' && <div className="report-filters"><label><CalendarDays /><input aria-label="Tanggal awal laporan" type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} /></label><label><input aria-label="Tanggal akhir laporan" type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} /></label></div>}</div>
    {attendanceTab && <AttendanceReport tab={tab} items={(attendance.data?.items ?? []).filter((item) => tab !== 'Override manual' || item.manual_override)} />}
    {tab === 'Penolakan akses' && <DenialReport items={denials.data?.items ?? []} reasons={denials.data?.by_reason ?? []} />}
    {tab === 'Membership berakhir' && <ExpiryReport items={expiring.data?.items ?? []} members={members.data ?? []} plans={plans.data ?? []} />}
    {tab === 'Kesehatan perangkat' && <DeviceReport items={devices.data ?? []} />}
    <div className="csv-note"><Download /><span><strong>Ekspor aman</strong> File CSV dihasilkan oleh API dengan token autentikasi pada header, bukan URL.</span></div>
    {exportError && <Toast type="error" onClose={() => setExportError('')}>{exportError}</Toast>}
  </>
}

function AttendanceReport({ tab, items }: { tab: ReportTab; items: Checkin[] }) {
  const uniqueMembers = new Set(items.map((item) => item.member_code).filter(Boolean)).size
  const override = items.filter((item) => item.manual_override).length
  const hours = grouped(items, (item) => `${String(new Date(item.attempted_at).getHours()).padStart(2, '0')}.00`)
  const members = grouped(items, (item) => item.member_name)
  const days = grouped(items, (item) => new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(item.attempted_at)))
  const distribution = tab === 'Kehadiran member' ? members : tab === 'Override manual' ? grouped(items, (item) => item.device_name) : days
  const peak = [...hours].sort((a, b) => b[1] - a[1])[0]
  return <><section className="report-metrics"><ReportMetric icon={Users} label="Total kunjungan" value={items.length} /><ReportMetric icon={FileBarChart} label="Member unik" value={uniqueMembers} /><ReportMetric icon={MonitorCheck} label="Jam tersibuk" value={peak?.[0] ?? '-'} /><ReportMetric icon={Hand} label="Override manual" value={override} /></section><ReportData title={tab} distribution={distribution} items={items} /></>
}

function DenialReport({ items, reasons }: { items: Checkin[]; reasons: { reason_code: string; count: number }[] }) {
  const uniqueMembers = new Set(items.map((item) => item.member_code).filter(Boolean)).size
  return <><section className="report-metrics"><ReportMetric icon={Hand} label="Total ditolak" value={items.length} /><ReportMetric icon={Users} label="Member teridentifikasi" value={uniqueMembers} /><ReportMetric icon={FileBarChart} label="Jenis alasan" value={reasons.length} /><ReportMetric icon={MonitorCheck} label="Perangkat terdampak" value={new Set(items.map((item) => item.device_name)).size} /></section><ReportData title="Penolakan akses" distribution={reasons.map((item) => [humanReason(item.reason_code), item.count])} items={items} /></>
}

function ExpiryReport({ items, members, plans }: { items: Membership[]; members: { id: string; full_name: string; member_code: string }[]; plans: { id: string; name: string }[] }) {
  const memberMap = new Map(members.map((item) => [item.id, item]))
  const planMap = new Map(plans.map((item) => [item.id, item.name]))
  const distribution = grouped(items, (item) => planMap.get(item.plan_id) ?? 'Paket membership')
  return <><section className="report-metrics"><ReportMetric icon={CalendarDays} label="Berakhir 30 hari" value={items.length} /><ReportMetric icon={Users} label="Member terdampak" value={new Set(items.map((item) => item.member_id)).size} /><ReportMetric icon={FileBarChart} label="Jenis paket" value={distribution.length} /><ReportMetric icon={MonitorCheck} label="Paling dekat" value={items[0] ? formatDate(items[0].end_at) : '-'} /></section><section className="panel report-table"><div className="panel-header"><div><span className="panel-kicker">30 HARI KE DEPAN</span><h2>Membership berakhir</h2></div></div>{items.length ? <div className="table-scroll"><table><thead><tr><th>Member</th><th>Paket</th><th>Berakhir</th><th>Status</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{memberMap.get(item.member_id)?.full_name ?? 'Member'}</strong><small className="table-sub">{memberMap.get(item.member_id)?.member_code ?? item.member_id}</small></td><td>{planMap.get(item.plan_id) ?? 'Paket membership'}</td><td>{formatDate(item.end_at)}</td><td><StatusBadge status={item.derived_status} /></td></tr>)}</tbody></table></div> : <EmptyState title="Tidak ada membership berakhir" message="Tidak ada membership aktif yang berakhir dalam 30 hari." />}</section></>
}

function DeviceReport({ items }: { items: Device[] }) {
  const online = items.filter((item) => item.online).length
  return <><section className="report-metrics"><ReportMetric icon={MonitorCheck} label="Total perangkat" value={items.length} /><ReportMetric icon={Users} label="Online" value={online} /><ReportMetric icon={Hand} label="Offline" value={items.length - online} /><ReportMetric icon={FileBarChart} label="Kamera siap" value={items.filter((item) => item.camera_status === 'Siap').length} /></section><section className="panel report-table"><div className="panel-header"><div><span className="panel-kicker">HEARTBEAT TERKINI</span><h2>Kesehatan perangkat</h2></div></div>{items.length ? <div className="table-scroll"><table><thead><tr><th>Perangkat</th><th>Lokasi</th><th>Koneksi</th><th>Kamera</th><th>Heartbeat</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small className="table-sub">{item.code}</small></td><td>{item.location}</td><td><StatusBadge status={item.online ? 'ACTIVE' : 'CANCELLED'} /></td><td>{item.camera_status}</td><td>{formatDate(item.last_seen_at, true)}</td></tr>)}</tbody></table></div> : <EmptyState title="Belum ada perangkat" message="Daftarkan kiosk untuk mulai memantau kesehatan perangkat." />}</section></>
}

function ReportData({ title, distribution, items }: { title: string; distribution: [string, number][]; items: Checkin[] }) {
  const max = Math.max(1, ...distribution.map((item) => item[1]))
  return <section className="report-grid"><div className="panel report-table"><div className="panel-header"><div><span className="panel-kicker">DATA TERBARU</span><h2>{title}</h2></div></div>{items.length ? <div className="table-scroll"><table><thead><tr><th>Waktu</th><th>Member</th><th>Perangkat</th><th>Hasil</th><th>Alasan</th></tr></thead><tbody>{items.slice(0, 25).map((item) => <tr key={item.id}><td>{formatDate(item.attempted_at, true)}</td><td><strong>{item.member_name}</strong><small className="table-sub">{item.member_code ?? 'Tanpa identitas'}</small></td><td>{item.device_name}</td><td><StatusBadge status={item.decision} /></td><td>{humanReason(item.reason_code)}</td></tr>)}</tbody></table></div> : <EmptyState title="Tidak ada data" message="Tidak ada catatan pada rentang dan kategori yang dipilih." />}</div><div className="panel report-breakdown"><div className="panel-header"><div><span className="panel-kicker">DISTRIBUSI</span><h2>Ringkasan data</h2></div></div>{distribution.length ? distribution.slice(0, 12).map(([label, value]) => <div className="breakdown-row" key={label}><span title={label}>{label}</span><div><i style={{ width: `${value / max * 100}%` }} /></div><strong>{value}</strong></div>) : <EmptyState title="Belum ada distribusi" message="Data ringkasan belum tersedia." />}</div></section>
}

function ReportMetric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string | number }) {
  return <div><Icon /><span><small>{label}</small><strong>{value}</strong></span></div>
}

function grouped<T>(items: T[], label: (item: T) => string): [string, number][] {
  const result = new Map<string, number>()
  items.forEach((item) => { const key = label(item); result.set(key, (result.get(key) ?? 0) + 1) })
  return [...result].sort((a, b) => b[1] - a[1])
}

function humanReason(reason: string) {
  return reason.replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase())
}
