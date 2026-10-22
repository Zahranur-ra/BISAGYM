import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, ChevronDown, Circle, Eye, Lightbulb, LoaderCircle, LockKeyhole, RefreshCw, ScanFace, ShieldCheck, UserRoundCheck } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, assertConfiguredFaceMode, FACE_ENGINE_IS_MOCK, faceErrorMessage, sessionIsMock, type EnrollmentSession } from '../api/client'
import { ErrorState, LoadingState, PageHeader, Toast, initials } from '../components/ui'
import { useCamera } from '../hooks/useCamera'

const poseDetails: Record<string, { title: string; instruction: string }> = {
  FRONT: { title: 'Hadap depan', instruction: 'Lihat lurus ke kamera dan pertahankan posisi.' },
  LEFT: { title: 'Sedikit ke kiri', instruction: 'Putar kepala perlahan sedikit ke kiri.' },
  RIGHT: { title: 'Sedikit ke kanan', instruction: 'Putar kepala perlahan sedikit ke kanan.' },
  UP: { title: 'Sedikit ke atas', instruction: 'Dongakkan kepala sedikit sambil tetap melihat kamera.' },
  BLINK: { title: 'Tes kedipan', instruction: 'Ikuti instruksi backend dan kedipkan kedua mata.' },
}

function describePose(pose: string) {
  return poseDetails[pose] ?? { title: pose.replaceAll('_', ' ').toLowerCase(), instruction: 'Ikuti posisi yang diminta oleh backend.' }
}

export function EnrollmentPage() {
  const [params] = useSearchParams()
  const members = useQuery({ queryKey: ['members'], queryFn: api.members })
  const [memberId, setMemberId] = useState(params.get('member') ?? '')
  const [step, setStep] = useState<'select' | 'consent' | 'capture' | 'success'>('select')
  const [consented, setConsented] = useState(false)
  const [session, setSession] = useState<EnrollmentSession>()
  const [poseIndex, setPoseIndex] = useState(0)
  const [captured, setCaptured] = useState<string[]>([])
  const [toast, setToast] = useState('')
  const selected = members.data?.find((member) => member.id === memberId)
  const camera = useCamera(step === 'capture')
  const requiredPoses = session?.required_poses ?? []
  const currentPose = requiredPoses[poseIndex] ?? 'FRONT'
  const pose = describePose(currentPose)
  const mockSession = session ? sessionIsMock(session) : FACE_ENGINE_IS_MOCK
  const requestsLiveness = requiredPoses.some((item) => item.includes('LIVENESS') || item === 'BLINK')

  const consent = useMutation({
    mutationFn: async () => {
      await api.createConsent(memberId)
      const nextSession = await api.startEnrollment(memberId)
      assertConfiguredFaceMode(nextSession)
      if (!nextSession.required_poses.length) throw new Error('Backend tidak memberikan pose pendaftaran. Periksa konfigurasi face engine.')
      return nextSession
    },
    onSuccess: (nextSession) => {
      setSession(nextSession)
      setStep('capture')
    },
  })

  const sample = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Sesi pendaftaran tidak tersedia. Mulai ulang pendaftaran.')
      const image = mockSession ? undefined : await camera.capture()
      await api.uploadSample(session, memberId, currentPose, image)
      if (poseIndex === requiredPoses.length - 1) await api.completeEnrollment(session.id)
    },
    onSuccess: () => {
      const next = [...captured, currentPose]
      setCaptured(next)
      if (poseIndex < requiredPoses.length - 1) {
        setPoseIndex((index) => index + 1)
        setToast('Sampel diterima backend. Lanjut ke posisi berikutnya.')
      } else {
        setStep('success')
      }
    },
  })

  useEffect(() => {
    if (params.get('member')) setMemberId(params.get('member') ?? '')
  }, [params])

  if (members.isLoading) return <LoadingState />
  if (members.error) return <ErrorState error={members.error} retry={() => void members.refetch()} />

  return <>
    <PageHeader eyebrow="BIOMETRIK & PRIVASI" title="Pendaftaran Wajah" description="Alur terpandu dengan persetujuan eksplisit dan pemeriksaan kualitas oleh backend." />
    <div className="enrollment-layout">
      <aside className="enroll-steps">
        <div className={step === 'select' ? 'active' : 'complete'}><span>{step === 'select' ? '01' : <Check />}</span><div><strong>Pilih member</strong><small>Identitas terdaftar</small></div></div>
        <div className={step === 'consent' ? 'active' : step === 'capture' || step === 'success' ? 'complete' : ''}><span>{step === 'capture' || step === 'success' ? <Check /> : '02'}</span><div><strong>Persetujuan</strong><small>Privasi & retensi</small></div></div>
        <div className={step === 'capture' ? 'active' : step === 'success' ? 'complete' : ''}><span>{step === 'success' ? <Check /> : '03'}</span><div><strong>Ambil sampel</strong><small>{session ? `${requiredPoses.length} pose RGB` : 'Pose RGB dari backend'}</small></div></div>
        <div className={step === 'success' ? 'active' : ''}><span>04</span><div><strong>Selesai</strong><small>Aktifkan profil</small></div></div>
      </aside>
      <section className="panel enrollment-panel">
        {step === 'select' && <div className="select-member-step">
          <div className="step-icon"><UserRoundCheck /></div><span className="panel-kicker">LANGKAH 1 DARI 4</span><h2>Pilih member yang akan didaftarkan</h2><p>Pastikan identitas member telah diverifikasi sebelum melanjutkan.</p>
          <label>Pilih member<div className="select-wrap large"><select aria-label="Pilih member" value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="">Cari nama atau kode member...</option>{members.data?.map((member) => <option key={member.id} value={member.id}>{member.full_name} · {member.member_code}</option>)}</select><ChevronDown /></div></label>
          {selected && <div className="selected-member"><div className="avatar">{initials(selected.full_name)}</div><div><strong>{selected.full_name}</strong><span>{selected.member_code} · {selected.plan}</span></div><span className={selected.face_enrolled ? 'face-ready' : 'face-missing'}>{selected.face_enrolled ? 'Sudah terdaftar' : 'Belum terdaftar'}</span></div>}
          <button className="primary-button continue-button" disabled={!selected} onClick={() => setStep('consent')}>Lanjut ke persetujuan <ArrowRight /></button>
        </div>}
        {step === 'consent' && selected && <div className="consent-step">
          <button className="back-link button-link" onClick={() => setStep('select')}><ArrowLeft /> Ganti member</button>
          <div className="consent-heading"><ShieldCheck /><div><span className="panel-kicker">PERSETUJUAN BIOMETRIK · V2.1</span><h2>Persetujuan harus diberikan secara sadar</h2><p>Jelaskan poin berikut kepada {selected.full_name} sebelum meminta persetujuan.</p></div></div>
          <div className="consent-document"><h3>Penggunaan data wajah di BISA Gym</h3><p>Kami mengumpulkan representasi matematis dari wajah Anda untuk memverifikasi keanggotaan saat check-in. SFace mengenali wajah dari gambar kamera RGB, bukan pemindaian wajah 3D.</p><ul><li><LockKeyhole /><span><strong>Yang disimpan</strong> Template wajah terenkripsi, bukan foto asli.</span></li><li><Camera /><span><strong>Retensi gambar</strong> Gambar mentah diproses sesaat dan tidak disimpan.</span></li><li><Eye /><span><strong>Liveness</strong> Tidak didukung oleh SFace kecuali backend sesi secara eksplisit memintanya.</span></li><li><RefreshCw /><span><strong>Hak Anda</strong> Persetujuan dapat dicabut dan profil dapat dihapus kapan saja.</span></li></ul><div className="fallback-note"><Lightbulb /><span>Member dapat menolak. Check-in manual di resepsionis tetap tersedia sebagai alternatif non-biometrik.</span></div></div>
          <label className="consent-check"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} /><span><strong>Member menyetujui pemrosesan data wajah</strong><small>Saya telah menjelaskan tujuan, retensi, akses, hak pencabutan, dan alternatif non-biometrik.</small></span></label>
          {consent.error && <div className="form-alert" role="alert">{consent.error.message}</div>}
          <button className="primary-button continue-button" disabled={!consented || consent.isPending} onClick={() => consent.mutate()}>{consent.isPending ? <><LoaderCircle className="spin" /> Menyiapkan sesi...</> : <>Setujui & buka kamera <ArrowRight /></>}</button>
        </div>}
        {step === 'capture' && selected && session && <div className="capture-step">
          <div className="capture-header"><div><span className="panel-kicker">SAMPEL {poseIndex + 1} DARI {requiredPoses.length}</span><h2>{pose.title}</h2><p>{pose.instruction}</p></div><div className="capture-member"><div className="avatar">{initials(selected.full_name)}</div><span>{selected.full_name}<small>{selected.member_code}</small></span></div></div>
          <div className="camera-stage"><video ref={camera.videoRef} muted playsInline aria-label="Pratinjau kamera pendaftaran" /><div className="face-guide"><span /><span /><span /><span /></div>{camera.state !== 'ready' && <CameraMessage state={camera.state} retry={() => void camera.retry()} mockMode={mockSession} />}{camera.state === 'ready' && <div className="camera-ready"><span /> KAMERA SIAP</div>}<div className="camera-tip">{pose.instruction}</div></div>
          <div className="quality-strip"><div><span className="quality-dot ready" /><span><strong>Pencahayaan</strong><small>{mockSession ? 'Simulasi' : 'Diperiksa backend'}</small></span></div><div><span className="quality-dot ready" /><span><strong>Kualitas gambar</strong><small>{mockSession ? 'Simulasi' : 'Diperiksa backend'}</small></span></div><div><span className="quality-dot ready" /><span><strong>Jumlah wajah</strong><small>{mockSession ? 'Mock' : 'Diperiksa backend'}</small></span></div></div>
          <div className="pose-progress">{requiredPoses.map((item, index) => <div key={item} className={captured.includes(item) ? 'complete' : index === poseIndex ? 'active' : ''}>{captured.includes(item) ? <Check /> : index === poseIndex ? <Circle /> : <span>{index + 1}</span>}<small>{describePose(item).title}</small></div>)}</div>
          {!mockSession && <div className="fallback-note"><Lightbulb /><span>SFace memproses gambar RGB, bukan data kedalaman 3D. {requestsLiveness ? 'Sesi backend ini meminta langkah liveness tambahan.' : 'Sesi backend ini tidak menyatakan dukungan liveness.'}</span></div>}
          {sample.error && <div className="form-alert" role="alert">{faceErrorMessage(sample.error)}</div>}
          <button className="capture-button" disabled={(!mockSession && camera.state !== 'ready') || sample.isPending} onClick={() => sample.mutate()}>{sample.isPending ? <><LoaderCircle className="spin" /> Memeriksa sampel...</> : mockSession ? <><Camera /> Gunakan sampel mock</> : <><Camera /> Ambil foto RGB</>}</button>
        </div>}
        {step === 'success' && selected && <div className="enroll-success">
          <div className="success-rings"><CheckCircle2 /></div><span className="panel-kicker">PENDAFTARAN SELESAI</span><h2>Wajah berhasil didaftarkan</h2><p>{selected.full_name} kini dapat menggunakan check-in mandiri di kiosk Demo Fitness Center.</p>
          <div className="success-details"><div><ScanFace /><span><strong>{captured.length} sampel diterima</strong><small>{captured.map((item) => describePose(item).title).join(', ')}</small></span></div><div><ShieldCheck /><span><strong>Profil biometrik aktif</strong><small>Consent v2.1 · pengenalan wajah RGB</small></span></div></div>
          <div className="success-actions"><Link className="secondary-button" to={`/members/${selected.id}`}>Lihat profil member</Link><button className="primary-button" onClick={() => { setMemberId(''); setStep('select'); setConsented(false); setSession(undefined); setPoseIndex(0); setCaptured([]) }}>Daftarkan member lain</button></div>
        </div>}
      </section>
    </div>
    {toast && <Toast onClose={() => setToast('')}>{toast}</Toast>}
  </>
}

function CameraMessage({ state, retry, mockMode }: { state: 'requesting' | 'denied' | 'unavailable'; retry: () => void; mockMode: boolean }) {
  return <div className="camera-message">{state === 'requesting' ? <LoaderCircle className="spin" /> : <Camera />}<strong>{state === 'requesting' ? 'Meminta akses kamera...' : state === 'denied' ? 'Izin kamera diblokir' : 'Kamera tidak tersedia'}</strong><p>{mockMode ? 'Adapter mock aktif. Sampel simulasi tersedia tanpa webcam.' : state === 'denied' ? 'Izinkan kamera melalui pengaturan situs browser, lalu coba lagi.' : state === 'unavailable' ? 'Hubungkan webcam dan gunakan HTTPS atau localhost, lalu coba lagi.' : 'Pilih Izinkan pada dialog browser.'}</p>{state !== 'requesting' && <button className="secondary-button" onClick={retry}><RefreshCw /> Coba lagi</button>}</div>
}
