import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Camera, CheckCircle2, LoaderCircle, RefreshCw, ScanFace, ShieldCheck, Video, VideoOff } from 'lucide-react'
import { api, faceErrorMessage, type LiveCameraFrame } from '../api/client'
import { useAuth } from '../auth'
import { PageHeader } from '../components/ui'
import { useCamera } from '../hooks/useCamera'

const POLL_DELAY_MS = 550
const BOX_SMOOTHING = 0.58
const MAX_MISSED_FRAMES = 1

type FaceBox = LiveCameraFrame['faces'][number]['bounding_box']
type TrackedFace = LiveCameraFrame['faces'][number] & { trackId: number; missedFrames: number }

function intersectionOverUnion(left: FaceBox, right: FaceBox) {
  const x1 = Math.max(left.x, right.x)
  const y1 = Math.max(left.y, right.y)
  const x2 = Math.min(left.x + left.width, right.x + right.width)
  const y2 = Math.min(left.y + left.height, right.y + right.height)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = left.width * left.height + right.width * right.height - intersection
  return union > 0 ? intersection / union : 0
}

function normalizedCenterDistance(left: FaceBox, right: FaceBox, frameWidth: number, frameHeight: number) {
  const leftX = left.x + left.width / 2
  const leftY = left.y + left.height / 2
  const rightX = right.x + right.width / 2
  const rightY = right.y + right.height / 2
  return Math.hypot(leftX - rightX, leftY - rightY) / Math.hypot(frameWidth, frameHeight)
}

function smoothBox(previous: FaceBox, current: FaceBox) {
  const blend = (oldValue: number, newValue: number) => oldValue + (newValue - oldValue) * BOX_SMOOTHING
  return {
    x: blend(previous.x, current.x),
    y: blend(previous.y, current.y),
    width: blend(previous.width, current.width),
    height: blend(previous.height, current.height),
  }
}

export function reconcileTrackedFaces(previous: TrackedFace[], frame: LiveCameraFrame, nextTrackId: () => number) {
  const available = new Set(previous.map((face) => face.trackId))
  const tracked = frame.faces.map((face) => {
    let best: TrackedFace | undefined
    let bestScore = Number.NEGATIVE_INFINITY
    for (const candidate of previous) {
      if (!available.has(candidate.trackId)) continue
      if (face.member && candidate.member && face.member.member_code !== candidate.member.member_code) continue
      const overlap = intersectionOverUnion(candidate.bounding_box, face.bounding_box)
      const distance = normalizedCenterDistance(candidate.bounding_box, face.bounding_box, frame.image_width, frame.image_height)
      if (overlap < 0.04 && distance > 0.14) continue
      const sameMember = face.member?.member_code && face.member.member_code === candidate.member?.member_code ? 0.5 : 0
      const score = overlap * 2 - distance + sameMember
      if (score > bestScore) {
        best = candidate
        bestScore = score
      }
    }
    if (!best) return { ...face, trackId: nextTrackId(), missedFrames: 0 }
    available.delete(best.trackId)
    return { ...face, bounding_box: smoothBox(best.bounding_box, face.bounding_box), trackId: best.trackId, missedFrames: 0 }
  })
  const temporarilyMissing = previous
    .filter((face) => available.has(face.trackId) && face.missedFrames < MAX_MISSED_FRAMES)
    .map((face) => ({ ...face, missedFrames: face.missedFrames + 1 }))
  return [...tracked, ...temporarilyMissing]
}

function faceLabel(face: LiveCameraFrame['faces'][number]) {
  if (face.registration === 'REGISTERED') return face.member?.full_name ?? 'Terdaftar'
  if (['FACE_TOO_SMALL', 'IMAGE_TOO_BLURRY', 'BAD_EXPOSURE', 'LOW_IMAGE_QUALITY'].includes(face.reason_code ?? '')) return 'Wajah kurang jelas'
  if (face.reason_code === 'AMBIGUOUS_FACE_MATCH') return 'Perlu verifikasi ulang'
  return 'Belum terdaftar'
}

export function StreamingCameraPage() {
  const { user } = useAuth()
  const [enabled, setEnabled] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState('')
  const [analysis, setAnalysis] = useState<LiveCameraFrame>()
  const [trackedFaces, setTrackedFaces] = useState<TrackedFace[]>([])
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const camera = useCamera(enabled)
  const captureRef = useRef(camera.captureFrame)
  const nextTrackId = useRef(1)
  const branches = useQuery({ queryKey: ['branches', 'live-camera'], queryFn: api.branches, enabled: user?.role === 'SUPER_ADMIN' })
  const branchId = user?.branch_id || selectedBranch || branches.data?.find((branch) => branch.is_active)?.id || ''

  useEffect(() => {
    captureRef.current = camera.captureFrame
  }, [camera.captureFrame])

  useEffect(() => {
    if (!enabled || camera.state !== 'ready' || !branchId) return
    let active = true
    let timer: number | undefined
    let controller: AbortController | undefined

    async function analyze() {
      if (!active) return
      setProcessing(true)
      try {
        const image = await captureRef.current()
        if (!image) throw new Error('Kamera belum menghasilkan frame yang dapat dianalisis.')
        controller = new AbortController()
        const next = await api.analyzeLiveCameraFrame(image, branchId, controller.signal)
        if (active) {
          setAnalysis(next)
          setTrackedFaces((previous) => reconcileTrackedFaces(previous, next, () => nextTrackId.current++))
          setError('')
        }
      } catch (requestError) {
        if (active) {
          setError(faceErrorMessage(requestError))
          setTrackedFaces((previous) => previous
            .filter((face) => face.missedFrames < MAX_MISSED_FRAMES)
            .map((face) => ({ ...face, missedFrames: face.missedFrames + 1 })))
        }
      } finally {
        if (active) {
          setProcessing(false)
          timer = window.setTimeout(() => void analyze(), POLL_DELAY_MS)
        }
      }
    }

    void analyze()
    return () => {
      active = false
      controller?.abort()
      if (timer) window.clearTimeout(timer)
    }
  }, [branchId, camera.state, enabled])

  function toggleStreaming(nextEnabled: boolean) {
    setEnabled(nextEnabled)
    setAnalysis(undefined)
    setTrackedFaces([])
    nextTrackId.current = 1
    setError('')
    setProcessing(false)
  }

  const registeredCount = trackedFaces.filter((face) => face.registration === 'REGISTERED').length
  const aspectRatio = analysis ? `${analysis.image_width} / ${analysis.image_height}` : '16 / 9'

  return <>
    <PageHeader eyebrow="BIOMETRIK REAL-TIME" title="Streaming Kamera" description="Deteksi beberapa wajah secara langsung untuk melihat apakah profilnya sudah terdaftar. Frame diproses sesaat dan tidak disimpan." />
    <section className="panel stream-control-panel">
      <div className="stream-control-copy"><div className={`stream-control-icon ${enabled ? 'active' : ''}`}>{enabled ? <Video /> : <VideoOff />}</div><div><strong>{enabled ? 'Streaming aktif' : 'Streaming nonaktif'}</strong><p>Aktifkan hanya saat petugas sedang melakukan verifikasi wajah.</p></div></div>
      {user?.role === 'SUPER_ADMIN' && <label className="stream-branch">Cabang<select aria-label="Pilih cabang streaming" value={branchId} onChange={(event) => setSelectedBranch(event.target.value)}><option value="">Pilih cabang</option>{branches.data?.filter((branch) => branch.is_active).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
      <div className="stream-toggle-control"><span>Aktifkan Streaming</span><label className="switch"><input type="checkbox" aria-label="Aktifkan Streaming" checked={enabled} disabled={!branchId} onChange={(event) => toggleStreaming(event.target.checked)} /><span /></label></div>
    </section>

    <div className="stream-layout">
      <section className="panel stream-camera-panel">
        <div className="stream-camera-stage" style={{ aspectRatio }}>
          <video ref={camera.videoRef} muted playsInline aria-label="Pratinjau streaming kamera" />
          {!enabled && <div className="stream-placeholder"><Camera /><strong>Streaming belum diaktifkan</strong><span>Tekan tombol Aktifkan Streaming untuk mulai mendeteksi wajah.</span></div>}
          {enabled && camera.state !== 'ready' && <div className="stream-placeholder">{camera.state === 'requesting' ? <LoaderCircle className="spin" /> : <AlertTriangle />}<strong>{camera.state === 'requesting' ? 'Menyiapkan kamera...' : camera.state === 'denied' ? 'Izin kamera diblokir' : 'Kamera tidak tersedia'}</strong><span>{camera.state === 'denied' ? 'Izinkan kamera melalui pengaturan situs browser.' : 'Periksa webcam lalu coba kembali.'}</span>{camera.state !== 'requesting' && <button className="secondary-button" onClick={() => void camera.retry()}><RefreshCw /> Coba lagi</button>}</div>}
          {enabled && camera.state === 'ready' && analysis && trackedFaces.map((face) => {
            const box = face.bounding_box
            const left = (analysis.image_width - box.x - box.width) / analysis.image_width * 100
            const style = { left: `${left}%`, top: `${box.y / analysis.image_height * 100}%`, width: `${box.width / analysis.image_width * 100}%`, height: `${box.height / analysis.image_height * 100}%` }
            return <div key={face.trackId} className={`stream-face-box ${face.registration === 'REGISTERED' ? 'registered' : 'unregistered'} ${face.missedFrames ? 'stale' : ''}`} style={style}><span>{face.registration === 'REGISTERED' ? <CheckCircle2 /> : <ScanFace />}{faceLabel(face)}{face.member && <small>{face.member.member_code} · Terdaftar</small>}</span></div>
          })}
          {enabled && camera.state === 'ready' && <div className="stream-live-badge"><span /> LIVE {processing && <LoaderCircle className="spin" />}</div>}
        </div>
        {error && <div className="form-alert stream-error" role="alert">{error}</div>}
      </section>

      <aside className="stream-info-panel">
        <section className="panel stream-summary"><span className="panel-kicker">HASIL STREAMING</span><div><strong>{trackedFaces.length}</strong><span>Wajah terlacak</span></div><div><strong>{registeredCount}</strong><span>Sudah terdaftar</span></div><div><strong>{trackedFaces.length - registeredCount}</strong><span>Belum dikenali</span></div></section>
        <section className="panel stream-legend"><h3>Keterangan</h3><div><i className="registered" /><span><strong>Terdaftar</strong>Profil wajah cocok dengan database cabang.</span></div><div><i className="unregistered" /><span><strong>Belum terdaftar</strong>Belum ada profil yang cocok atau gambar kurang jelas.</span></div></section>
        <section className="stream-privacy"><ShieldCheck /><div><strong>Pemrosesan lokal dan sementara</strong><p>Gambar tidak disimpan. Fitur ini bukan liveness detection dan tidak memberikan keputusan akses.</p></div></section>
      </aside>
    </div>
  </>
}
