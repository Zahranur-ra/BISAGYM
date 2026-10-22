import { useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowRight, CalendarClock, CircleCheck, Clock3, DoorOpen, Server, ShieldX, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth'
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge, formatDate, initials } from '../components/ui'

export function DashboardPage() {
  const { user } = useAuth()
  const isAdmin = user?.role !== 'RECEPTIONIST'
  const summary = useQuery({ queryKey: ['dashboard-summary'], queryFn: api.dashboardSummary })
  const checkins = useQuery({ queryKey: ['checkins'], queryFn: api.checkins, refetchInterval: 30_000 })
  const expiring = useQuery({ queryKey: ['expiring-memberships', 7], queryFn: () => api.expiringMemberships(7) })
  const devices = useQuery({ queryKey: ['devices'], queryFn: api.devices, enabled: isAdmin })
  const queries = [summary, checkins, expiring, ...(isAdmin ? [devices] : [])]
  if (queries.some((query) => query.isLoading)) return <LoadingState label="Menyiapkan ringkasan operasional..." />
  const errorQuery = queries.find((query) => query.error)
  if (errorQuery?.error) return <ErrorState error={errorQuery.error} retry={() => void Promise.all(queries.map((query) => query.refetch()))} />

  const now = new Date()
  const todayKey = localDateKey(now)
  const today = checkins.data?.filter((item) => localDateKey(new Date(item.attempted_at)) === todayKey) ?? []
  const averageProcess = today.length ? Math.round(today.reduce((total, item) => total + item.processing_time_ms, 0) / today.length) : 0
  const hourly = Array.from({ length: 12 }, (_, index) => today.filter((item) => Math.floor(new Date(item.attempted_at).getHours() / 2) === index).length)
  const peakCount = Math.max(0, ...hourly)
  const peakIndex = hourly.indexOf(peakCount)
  const maxHourly = peakCount || 1
  const offline = devices.data?.filter((item) => !item.online) ?? []
  const attentionCount = expiring.data?.total ?? 0
  const dateLabel = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now).toUpperCase()
  const hour = now.getHours()
  const greeting = hour < 11 ? 'pagi' : hour < 15 ? 'siang' : hour < 18 ? 'sore' : 'malam'

  return <>
    <PageHeader eyebrow={dateLabel} title={`Selamat ${greeting}, ${user?.full_name.split(' ')[0] ?? 'Tim'}.`} description={`Berikut kondisi operasional ${user?.branch_name ?? 'gym'} hari ini.`} action={<Link className="secondary-button" to="/kiosk"><DoorOpen /> Buka mode kiosk</Link>} />
    <section className="metrics-grid" aria-label="Metrik utama">
      <Metric icon={Users} label="Member aktif" value={number(summary.data?.active_members)} note="data cabang saat ini" />
      <Metric icon={CalendarClock} label="Berakhir 7 hari" value={number(expiring.data?.total)} note={expiring.data?.total ? 'perlu ditindaklanjuti' : 'tidak ada yang segera berakhir'} warning={Boolean(expiring.data?.total)} />
      <Metric icon={CircleCheck} label="Check-in hari ini" value={number(summary.data?.today_allowed_checkins)} note="akses diizinkan" positive />
      <Metric icon={ShieldX} label="Akses ditolak" value={number(summary.data?.today_denied_attempts)} note="percobaan hari ini" warning={Boolean(summary.data?.today_denied_attempts)} />
      {isAdmin && <Metric icon={Server} label="Perangkat online" value={`${number(summary.data?.devices_online)}/${devices.data?.length ?? 0}`} note={offline.length ? `${offline.length} perlu perhatian` : 'semua perangkat siap'} warning={Boolean(offline.length)} />}
    </section>
    <section className="dashboard-grid">
      <div className="panel activity-panel"><div className="panel-header"><div><span className="panel-kicker">AKTIVITAS LANGSUNG</span><h2>Check-in terbaru</h2></div><Link to="/checkins">Lihat semua <ArrowRight /></Link></div>
        {checkins.data?.length ? <div className="activity-list">{checkins.data.slice(0, 5).map((item) => <div className="activity-row" key={item.id}><div className={`avatar ${item.decision === 'DENY' ? 'avatar-muted' : ''}`}>{item.member_name === 'Tidak dikenali' ? '?' : initials(item.member_name)}</div><div className="activity-name"><strong>{item.member_name}</strong><span>{item.member_code ?? item.reason_code.replaceAll('_', ' ')}</span></div><div className="activity-device"><span>{item.device_name}</span><small><Clock3 />{formatDate(item.attempted_at, true)}</small></div><StatusBadge status={item.decision} /></div>)}</div> : <EmptyState title="Belum ada check-in" message="Aktivitas akses terbaru akan muncul di sini." />}
      </div>
      <div className="side-stack">
        <div className="panel peak-panel"><div className="panel-header"><div><span className="panel-kicker">RITME HARI INI</span><h2>Arus kunjungan</h2></div><span className="live-label"><span /> LIVE</span></div><div className="bar-chart" aria-label="Grafik kunjungan per dua jam">{hourly.map((count, index) => <span key={index} style={{ height: `${Math.max(count ? 12 : 2, count / maxHourly * 100)}%` }} className={count === peakCount && count > 0 ? 'peak' : ''} title={`${String(index * 2).padStart(2, '0')}.00: ${count}`} />)}</div><div className="chart-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>22</span></div><div className="peak-note"><ArrowDownRight /><div><strong>{peakCount ? `Puncak: ${String(peakIndex * 2).padStart(2, '0')}.00 - ${String(peakIndex * 2 + 2).padStart(2, '0')}.00` : 'Belum ada puncak kunjungan'}</strong><span>{peakCount} check-in pada interval tersebut</span></div></div></div>
        <div className="panel attention-panel"><div className="panel-header"><div><span className="panel-kicker">PERLU PERHATIAN</span><h2>Tindakan cepat</h2></div><span className="count-pill">{attentionCount + offline.length}</span></div>{attentionCount > 0 && <Link to="/membership-plans"><CalendarClock /><span><strong>{attentionCount} membership segera berakhir</strong><small>Tinjau daftar untuk tindak lanjut</small></span><ArrowRight /></Link>}{isAdmin && offline.map((device) => <Link to="/devices" key={device.id}><Server /><span><strong>{device.name} tidak terhubung</strong><small>Heartbeat {formatDate(device.last_seen_at, true)}</small></span><ArrowRight /></Link>)}{attentionCount === 0 && offline.length === 0 && <p className="panel-empty">Tidak ada tindakan mendesak saat ini.</p>}</div>
      </div>
    </section>
    <section className="daily-summary"><div><span>RINGKASAN HARI INI</span><strong>{number((summary.data?.today_allowed_checkins ?? 0) + (summary.data?.today_denied_attempts ?? 0))} percobaan akses</strong></div><div><CircleCheck /><span><strong>{number(summary.data?.today_allowed_checkins)}</strong> diizinkan</span></div><div><ShieldX /><span><strong>{number(summary.data?.today_denied_attempts)}</strong> ditolak</span></div><div><Clock3 /><span><strong>{averageProcess || '-'}{averageProcess ? ' ms' : ''}</strong> rata-rata proses</span></div></section>
  </>
}

function Metric({ icon: Icon, label, value, note, positive, warning }: { icon: typeof Users; label: string; value: string; note: string; positive?: boolean; warning?: boolean }) {
  return <article className="metric-card"><div className={`metric-icon ${warning ? 'metric-warning' : ''}`}><Icon /></div><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><div className={`metric-note ${positive ? 'positive' : warning ? 'warning' : ''}`}><span>{note}</span></div></article>
}

function number(value = 0) {
  return new Intl.NumberFormat('id-ID').format(value)
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}
