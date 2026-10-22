import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Building2, ChevronDown, ClipboardList, DoorOpen, FileBarChart, Gauge, LogOut, Menu, MonitorSmartphone, ScanFace, Settings, Users, Video, WalletCards, X } from 'lucide-react'
import { useAuth } from '../auth'
import { DemoBadge, Logo, initials } from '../components/ui'
import type { Role } from '../types'

const navigation: { to: string; label: string; icon: typeof Gauge; roles?: Role[] }[] = [
  { to: '/', label: 'Dashboard', icon: Gauge },
  { to: '/members', label: 'Data Member', icon: Users },
  { to: '/membership-plans', label: 'Paket Membership', icon: WalletCards },
  { to: '/enrollment', label: 'Pendaftaran Wajah', icon: ScanFace },
  { to: '/live-camera', label: 'Streaming Kamera', icon: Video },
  { to: '/checkins', label: 'Riwayat Akses', icon: ClipboardList },
  { to: '/kiosk', label: 'Buka Kiosk', icon: DoorOpen },
  { to: '/devices', label: 'Perangkat', icon: MonitorSmartphone, roles: ['SUPER_ADMIN', 'GYM_ADMIN'] },
  { to: '/reports', label: 'Laporan', icon: FileBarChart, roles: ['SUPER_ADMIN', 'GYM_ADMIN'] },
  { to: '/settings', label: 'Pengaturan', icon: Settings, roles: ['SUPER_ADMIN'] },
  { to: '/super-admin', label: 'Super Admin', icon: Building2, roles: ['SUPER_ADMIN'] },
]

const titles: Record<string, string> = { '/': 'Dashboard', '/members': 'Data Member', '/membership-plans': 'Paket Membership', '/enrollment': 'Pendaftaran Wajah', '/live-camera': 'Streaming Kamera', '/checkins': 'Riwayat Akses', '/devices': 'Perangkat', '/reports': 'Laporan', '/settings': 'Pengaturan', '/super-admin': 'Super Admin' }

export function AppShell() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const allowed = navigation.filter((item) => !item.roles || (user && item.roles.includes(user.role)))
  const roleLabel = user?.role === 'SUPER_ADMIN' ? 'Super Admin' : user?.role === 'GYM_ADMIN' ? 'Gym Admin' : 'Resepsionis'

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-top"><Logo /><button className="sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Tutup menu"><X /></button></div>
      <div className="branch-card"><span className="branch-label">CABANG AKTIF</span><div><span className="branch-pulse" /><strong>{user?.branch_name}</strong></div><small>Lingkup operasional <ChevronDown size={14} /></small></div>
      <nav aria-label="Navigasi utama">
        <span className="nav-section">OPERASIONAL</span>
        {allowed.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenuOpen(false)}><Icon /><span>{label}</span></NavLink>)}
      </nav>
      <div className="sidebar-foot"><div className="privacy-note"><ScanFace /><div><strong>Data biometrik terlindungi</strong><span>Gambar mentah tidak disimpan</span></div></div><button className="logout-button" onClick={() => void logout()}><LogOut /> Keluar</button></div>
    </aside>
    {menuOpen && <button className="mobile-overlay" aria-label="Tutup menu" onClick={() => setMenuOpen(false)} />}
    <div className="app-main">
      <header className="topbar">
        <div className="topbar-left"><button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Buka menu"><Menu /></button><div><span className="topbar-kicker">BISA GYM /</span><strong>{titles[location.pathname] ?? 'Operasional'}</strong></div></div>
        <div className="topbar-actions"><DemoBadge /><div className="user-chip"><div className="avatar avatar-dark">{initials(user?.full_name ?? '')}</div><div><strong>{user?.full_name}</strong><span>{roleLabel}</span></div><ChevronDown /></div></div>
      </header>
      <div className="offline-banner" hidden={online}><span />Anda offline. Perubahan tidak akan dikirim sampai koneksi pulih.</div>
      <main className="page-content"><Outlet /></main>
    </div>
  </div>
}
