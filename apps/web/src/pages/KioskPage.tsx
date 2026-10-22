import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, CircleHelp, Clock3, LoaderCircle, RefreshCw, ShieldCheck, UserRoundX, Volume2, Wifi, WifiOff, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { DemoBadge, Logo, formatDate } from '../components/ui'
import { useCamera } from '../hooks/useCamera'
import { api, assertConfiguredFaceMode, FACE_ENGINE_IS_MOCK, faceErrorMessage, sessionIsMock } from '../api/client'

type DemoOutcome = 'active' | 'expired' | 'suspended' | 'unknown' | 'spoof'
type KioskOutcome = DemoOutcome | 'duplicate' | 'error'
type KioskState = 'idle' | 'scanning' | 'granted' | 'denied'

const outcomes: Record<KioskOutcome, { decision: 'granted' | 'denied'; title: string; message: string; name?: string; reason: string }> = {
  active: { decision: 'granted', title: 'Akses diizinkan', message: 'Selamat berlatih. Pintu siap dibuka.', name: 'Andi P.', reason: 'Membership aktif' },
  expired: { decision: 'denied', title: 'Membership telah berakhir', message: 'Silakan hubungi resepsionis untuk memperpanjang.', name: 'Dimas A.', reason: 'Akses belum dapat diberikan' },
  suspended: { decision: 'denied', title: 'Membership tidak aktif', message: 'Silakan hubungi resepsionis untuk bantuan.', name: 'Maya K.', reason: 'Akses belum dapat diberikan' },
  unknown: { decision: 'denied', title: 'Wajah belum dikenali', message: 'Coba sekali lagi atau hubungi resepsionis.', reason: 'Pastikan hanya satu orang di depan kamera' },
  spoof: { decision: 'denied', title: 'Verifikasi keaktifan gagal', message: 'Ikuti instruksi backend lalu coba kembali.', reason: 'Akses belum dapat diberikan' },
  duplicate: { decision: 'denied', title: 'Check-in baru saja tercatat', message: 'Silakan tunggu sebelum mencoba kembali.', reason: 'Permintaan diproses oleh sistem' },
  error: { decision: 'denied', title: 'Check-in belum dapat diproses', message: 'Silakan coba kembali atau hubungi resepsionis.', reason: 'Akses belum dapat diberikan' },
}

function responseOutcome(decision: 'ALLOW' | 'DENY', reason: string): KioskOutcome {
  if (decision === 'ALLOW') return 'active'
  if (reason === 'MEMBERSHIP_EXPIRED') return 'expired'
  if (reason === 'MEMBERSHIP_SUSPENDED') return 'suspended'
  if (reason === 'LIVENESS_FAILED') return 'spoof'
  if (reason === 'DUPLICATE_CHECKIN') return 'duplicate'
  return 'unknown'
}

function actionableDenial(reason: string) {
  if (['NO_FACE', 'NO_FACE_DETECTED', 'FACE_NOT_DETECTED'].includes(reason)) return { title: 'Wajah tidak terlihat', message: 'Hadap kamera dan pastikan seluruh wajah berada di dalam bingkai.' }
  if (['MULTIPLE_FACES', 'MULTIPLE_FACES_DETECTED'].includes(reason)) return { title: 'Terdeteksi lebih dari satu wajah', message: 'Pastikan hanya satu orang berada di depan kamera, lalu coba lagi.' }
  if (['LOW_QUALITY', 'LOW_IMAGE_QUALITY', 'IMAGE_QUALITY_TOO_LOW', 'QUALITY_TOO_LOW', 'IMAGE_TOO_BLURRY'].includes(reason)) return { title: 'Kualitas gambar belum cukup', message: 'Perbaiki pencahayaan dan jaga posisi tetap stabil, lalu coba lagi.' }
  if (reason === 'FACE_TOO_SMALL') return { title: 'Wajah terlalu jauh', message: 'Mendekatlah sampai wajah memenuhi bingkai, lalu coba lagi.' }
  if (reason === 'BAD_EXPOSURE') return { title: 'Pencahayaan belum sesuai', message: 'Pastikan wajah tidak terlalu gelap atau terlalu terang, lalu coba lagi.' }
  return undefined
}

export function KioskPage() {
  const [state, setState] = useState<KioskState>('idle')
  const camera = useCamera(state === 'idle' || state === 'scanning')
  const [outcome, setOutcome] = useState<KioskOutcome>('unknown')
  const [online, setOnline] = useState(navigator.onLine)
  const [displayName, setDisplayName] = useState('')
  const [backendTitle, setBackendTitle] = useState('')
  const [backendMessage, setBackendMessage] = useState('')
  const result = outcomes[outcome]

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline) }
  }, [])

  useEffect(() => {
    if (state !== 'granted' && state !== 'denied') return
    const timeout = window.setTimeout(() => setState('idle'), 5000)
    return () => window.clearTimeout(timeout)
  }, [state])

  async function runCheckin(nextOutcome: DemoOutcome = 'unknown') {
    if (!online) return
    setOutcome(nextOutcome)
    setBackendTitle('')
    setBackendMessage('')
    setDisplayName('')
    setState('scanning')
    try {
      const session = await api.startKioskSession()
      assertConfiguredFaceMode(session)
      const image = sessionIsMock(session) ? undefined : await camera.capture()
      const response = await api.kioskCheckin(session, image, nextOutcome)
      const resolved = responseOutcome(response.decision, response.reason_code)
      const actionable = actionableDenial(response.reason_code)
      setOutcome(resolved)
      setDisplayName(response.member?.display_name ?? '')
      setBackendTitle(actionable?.title ?? '')
      setBackendMessage(actionable?.message ?? response.public_message ?? '')
      setState(response.decision === 'ALLOW' ? 'granted' : 'denied')
    } catch (error) {
      setOutcome('error')
      setBackendMessage(faceErrorMessage(error))
      setState('denied')
    }
  }

  return <div className={`kiosk-page kiosk-${state}`}>
    <header className="kiosk-header"><Logo /><div className="kiosk-branch"><span>DEMO FITNESS CENTER</span><strong>Pintu Utama · Kiosk 001</strong></div><div className="kiosk-status">{FACE_ENGINE_IS_MOCK && <DemoBadge />}<span className={online ? 'online' : 'offline'}>{online ? <Wifi /> : <WifiOff />}{online ? 'Terhubung' : 'Offline'}</span><span className="kiosk-time"><Clock3 />{new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date())}</span><Link to="/" aria-label="Kembali ke dashboard"><ArrowLeft /></Link></div></header>
    <main className="kiosk-main">
      {!online ? <div className="kiosk-result denied"><div className="result-icon"><WifiOff /></div><span className="result-label">SISTEM TIDAK TERSEDIA</span><h1>Koneksi terputus</h1><p>Akses tidak dapat diberikan saat sistem offline.</p><div className="result-detail"><AlertTriangle /><span>Silakan hubungi resepsionis untuk check-in manual.</span></div></div> : state === 'granted' || state === 'denied' ? <div className={`kiosk-result ${state}`}><div className="result-icon">{state === 'granted' ? <CheckCircle2 /> : outcome === 'unknown' ? <UserRoundX /> : <XCircle />}</div><span className="result-label">{state === 'granted' ? 'VERIFIKASI BERHASIL' : 'AKSES BELUM DAPAT DIBERIKAN'}</span><h1>{backendTitle || result.title}</h1>{displayName && <strong className="result-name">{displayName}</strong>}<p>{backendMessage || result.message}</p><div className="result-detail">{state === 'granted' ? <ShieldCheck /> : <CircleHelp />}<span>{result.reason}<small>{formatDate(new Date().toISOString(), true)} WIB</small></span></div><button className="kiosk-reset" onClick={() => setState('idle')}><RefreshCw /> Kembali sekarang</button></div> : <>
        <section className="kiosk-copy"><span className="kiosk-eyebrow"><span /> CHECK-IN WAJAH</span><h1>{state === 'scanning' ? 'Tetap diam sejenak.' : 'Silakan hadap kamera.'}</h1><p>{state === 'scanning' ? 'Gambar RGB sedang dikirim untuk diverifikasi backend.' : 'Posisikan wajah di dalam bingkai. Pastikan pencahayaan cukup dan hanya satu orang terlihat.'}</p><div className="kiosk-tips"><div><span>1</span><strong>Lihat lurus</strong></div><div><span>2</span><strong>Jaga jarak</strong></div><div><span>3</span><strong>{FACE_ENGINE_IS_MOCK ? 'Pilih simulasi' : 'Satu orang'}</strong></div></div><div className="kiosk-privacy"><ShieldCheck /><span><strong>{FACE_ENGINE_IS_MOCK ? 'Adapter mock aktif' : 'Pengenalan wajah RGB'}</strong>{FACE_ENGINE_IS_MOCK ? ' Scan biasa menggunakan skenario tidak dikenal. Kontrol simulasi tersedia hanya untuk demonstrasi.' : ' SFace bukan pemindaian 3D dan tidak menyediakan liveness kecuali backend menyatakannya.'}</span></div></section>
        <section className="kiosk-camera"><div className="kiosk-video-wrap"><video ref={camera.videoRef} muted playsInline aria-label="Pratinjau kamera kiosk" /><div className="kiosk-face-frame"><i /><i /><i /><i /></div>{camera.state !== 'ready' && <div className="kiosk-camera-error">{camera.state === 'requesting' ? <LoaderCircle className="spin" /> : <Camera />}<strong>{camera.state === 'requesting' ? 'Menyiapkan kamera' : camera.state === 'denied' ? 'Izin kamera diperlukan' : 'Kamera tidak tersedia'}</strong><span>{FACE_ENGINE_IS_MOCK ? 'Mode mock dapat dijalankan tanpa webcam.' : camera.state === 'denied' ? 'Izinkan akses kamera di pengaturan browser, lalu coba lagi.' : 'Hubungkan webcam atau gunakan perangkat lain. Check-in manual tetap tersedia.'}</span>{camera.state !== 'requesting' && <button onClick={() => void camera.retry()}><RefreshCw /> Coba lagi</button>}</div>}{state === 'scanning' && <div className="scan-overlay"><span className="scan-line" /><div><LoaderCircle className="spin" /> Memverifikasi...</div></div>}<div className="camera-footer"><span className={camera.state === 'ready' ? 'ready' : ''}><span /> {camera.state === 'ready' ? 'Kamera siap' : FACE_ENGINE_IS_MOCK ? 'Simulasi tanpa kamera' : 'Kamera belum siap'}</span><button aria-label="Suara aktif"><Volume2 /></button></div></div><button className="scan-button" onClick={() => void runCheckin()} disabled={state === 'scanning' || (!FACE_ENGINE_IS_MOCK && camera.state !== 'ready')}><ScanIcon />{state === 'scanning' ? 'Memproses...' : 'Mulai check-in'}</button></section>
      </>}
    </main>
    <footer className="kiosk-footer"><span>Butuh bantuan? Temui resepsionis di sebelah kanan pintu masuk.</span><span>Alternatif check-in manual selalu tersedia.</span></footer>
    {FACE_ENGINE_IS_MOCK && <aside className="demo-controls" aria-label="Kontrol hasil mock"><strong>SIMULASI HASIL</strong>{(['active', 'expired', 'suspended', 'unknown', 'spoof'] as DemoOutcome[]).map((item) => <button key={item} className={outcome === item ? 'active' : ''} onClick={() => void runCheckin(item)}>{item === 'active' ? 'Member aktif' : item === 'expired' ? 'Kedaluwarsa' : item === 'suspended' ? 'Ditangguhkan' : item === 'unknown' ? 'Tidak dikenal' : 'Spoof'}</button>)}</aside>}
  </div>
}

function ScanIcon() {
  return <span className="scan-icon" aria-hidden="true"><i /><i /><i /><i /></span>
}
