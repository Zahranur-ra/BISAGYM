import { useEffect, useRef, useState } from 'react'

type CameraState = 'requesting' | 'ready' | 'denied' | 'unavailable'

const CAMERA_WARMUP_MS = 600
const BURST_FRAME_COUNT = 3
const BURST_INTERVAL_MS = 100
const JPEG_QUALITY = 0.92
const STREAM_JPEG_QUALITY = 0.88
const STREAM_MAX_WIDTH = 1280

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

async function waitForVideoFrame(video: HTMLVideoElement) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) return
    await delay(50)
  }
  throw new Error('Camera did not provide a usable video frame.')
}

function sharpnessScore(source: HTMLCanvasElement) {
  const sample = document.createElement('canvas')
  sample.width = Math.min(320, source.width)
  sample.height = Math.max(1, Math.round(source.height * sample.width / source.width))
  const context = sample.getContext('2d', { willReadFrequently: true })
  if (!context) return 0

  try {
    context.drawImage(source, 0, 0, sample.width, sample.height)
    const { data } = context.getImageData(0, 0, sample.width, sample.height)
    let score = 0
    let count = 0
    for (let y = 1; y < sample.height; y += 2) {
      for (let x = 1; x < sample.width; x += 2) {
        const index = (y * sample.width + x) * 4
        const left = index - 4
        const above = index - sample.width * 4
        const luminance = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
        const leftLuminance = data[left] * 0.299 + data[left + 1] * 0.587 + data[left + 2] * 0.114
        const aboveLuminance = data[above] * 0.299 + data[above + 1] * 0.587 + data[above + 2] * 0.114
        score += Math.abs(luminance - leftLuminance) + Math.abs(luminance - aboveLuminance)
        count += 1
      }
    }
    return count ? score / count : 0
  } catch {
    return 0
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality = JPEG_QUALITY) {
  return new Promise<Blob | undefined>((resolve) => {
    canvas.toBlob((blob) => resolve(blob && blob.size > 0 ? blob : undefined), 'image/jpeg', quality)
  })
}

export function useCamera(enabled = true) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const requestIdRef = useRef(0)
  const [state, setState] = useState<CameraState>(enabled ? 'requesting' : 'unavailable')

  async function start() {
    const requestId = ++requestIdRef.current
    stopStream(streamRef.current)
    streamRef.current = null
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable')
      return
    }
    setState('requesting')
    let requestedStream: MediaStream | null = null
    try {
      requestedStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false })
      if (requestId !== requestIdRef.current) {
        stopStream(requestedStream)
        return
      }
      const video = videoRef.current
      const track = requestedStream.getVideoTracks()[0]
      if (!video || !track) throw new Error('Camera video track is unavailable.')
      streamRef.current = requestedStream
      video.srcObject = requestedStream
      await video.play()
      await waitForVideoFrame(video)
      await delay(CAMERA_WARMUP_MS)
      if (requestId !== requestIdRef.current || track.readyState !== 'live') {
        stopStream(requestedStream)
        return
      }
      track.addEventListener('ended', () => {
        if (requestId === requestIdRef.current) setState('unavailable')
      }, { once: true })
      setState('ready')
    } catch (error) {
      stopStream(requestedStream)
      if (requestId === requestIdRef.current) {
        streamRef.current = null
        setState(error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? 'denied' : 'unavailable')
      }
    }
  }

  useEffect(() => {
    if (enabled) void start()
    else {
      requestIdRef.current += 1
      stopStream(streamRef.current)
      streamRef.current = null
      setState('unavailable')
    }
    return () => {
      requestIdRef.current += 1
      stopStream(streamRef.current)
      streamRef.current = null
    }
  }, [enabled])

  async function capture(): Promise<Blob | undefined> {
    const video = videoRef.current
    const track = streamRef.current?.getVideoTracks()[0]
    if (!video || !track || track.readyState !== 'live' || state !== 'ready') return undefined
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) return undefined

    let bestFrame: HTMLCanvasElement | undefined
    let bestScore = -1
    for (let frame = 0; frame < BURST_FRAME_COUNT; frame += 1) {
      if (frame > 0) await delay(BURST_INTERVAL_MS)
      if (track.readyState !== 'live' || video.videoWidth <= 0 || video.videoHeight <= 0) return undefined
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (!context) return undefined
      try {
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
      } catch {
        return undefined
      }
      const score = sharpnessScore(canvas)
      if (score > bestScore) {
        bestFrame = canvas
        bestScore = score
      }
    }
    return bestFrame ? canvasToJpeg(bestFrame) : undefined
  }

  async function captureFrame(): Promise<Blob | undefined> {
    const video = videoRef.current
    const track = streamRef.current?.getVideoTracks()[0]
    if (!video || !track || track.readyState !== 'live' || state !== 'ready') return undefined
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) return undefined
    const scale = Math.min(1, STREAM_MAX_WIDTH / video.videoWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return undefined
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
    } catch {
      return undefined
    }
    return canvasToJpeg(canvas, STREAM_JPEG_QUALITY)
  }

  return { videoRef, state, retry: start, capture, captureFrame }
}
