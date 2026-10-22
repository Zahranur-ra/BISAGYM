import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCamera } from '../src/hooks/useCamera'

function CameraProbe() {
  const camera = useCamera()
  const [captureResult, setCaptureResult] = useState('waiting')
  const [fastCaptureResult, setFastCaptureResult] = useState('waiting-fast')

  return <>
    <video ref={camera.videoRef} muted />
    <span>{camera.state}</span>
    <button onClick={() => void camera.capture().then((blob) => setCaptureResult(blob ? `${blob.type}:${blob.size}` : 'none'))}>Capture</button>
    <button onClick={() => void camera.captureFrame().then((blob) => setFastCaptureResult(blob ? `${blob.type}:${blob.size}` : 'none-fast'))}>Fast Capture</button>
    <span>{captureResult}</span>
    <span>{fastCaptureResult}</span>
  </>
}

describe('useCamera', () => {
  let width = 1920
  let height = 1080
  const stop = vi.fn()
  const drawImage = vi.fn()
  const toBlob = vi.fn()

  beforeEach(() => {
    width = 1920
    height = 1080
    const track = {
      readyState: 'live',
      stop,
      addEventListener: vi.fn(),
    } as unknown as MediaStreamTrack
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => width })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => height })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      drawImage,
      getImageData: (_x: number, _y: number, sampleWidth: number, sampleHeight: number) => ({
        data: new Uint8ClampedArray(sampleWidth * sampleHeight * 4),
      }),
    }) as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type, quality) => {
      toBlob(type, quality)
      callback(new Blob(['high-detail-frame'], { type: type ?? 'image/png' }))
    })
  })

  it('waits for a live frame and sends the sharpest frame from a high-quality burst', async () => {
    render(<CameraProbe />)

    expect(await screen.findByText('ready', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: false,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Capture' }))

    await waitFor(() => expect(screen.getByText(/^image\/jpeg:/)).toBeInTheDocument())
    expect(toBlob).toHaveBeenCalledWith('image/jpeg', 0.92)
    expect(drawImage).toHaveBeenCalled()
  })

  it('does not fabricate a fallback image when the video frame disappears', async () => {
    render(<CameraProbe />)
    expect(await screen.findByText('ready', {}, { timeout: 2000 })).toBeInTheDocument()
    width = 0
    height = 0

    fireEvent.click(screen.getByRole('button', { name: 'Capture' }))

    expect(await screen.findByText('none')).toBeInTheDocument()
    expect(toBlob).not.toHaveBeenCalled()
  })

  it('captures a lightweight single frame for live streaming', async () => {
    render(<CameraProbe />)
    expect(await screen.findByText('ready', {}, { timeout: 2000 })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Fast Capture' }))

    await waitFor(() => expect(screen.getByText(/^image\/jpeg:/)).toBeInTheDocument())
    expect(toBlob).toHaveBeenCalledWith('image/jpeg', 0.88)
  })
})
