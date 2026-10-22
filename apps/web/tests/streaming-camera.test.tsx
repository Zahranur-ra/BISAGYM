import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { authenticate, renderApp } from './test-utils'
import { reconcileTrackedFaces } from '../src/pages/StreamingCameraPage'
import type { LiveCameraFrame } from '../src/api/client'

const cameraCapture = vi.hoisted(() => vi.fn(async () => new Blob(['camera-frame'], { type: 'image/jpeg' })))

vi.mock('../src/hooks/useCamera', () => ({
  useCamera: () => ({
    videoRef: { current: null },
    state: 'ready',
    retry: vi.fn(),
    capture: cameraCapture,
    captureFrame: cameraCapture,
  }),
}))

describe('streaming camera', () => {
  it('detects registered and unregistered faces after streaming is enabled', async () => {
    authenticate('GYM_ADMIN')
    const user = userEvent.setup()
    renderApp('/live-camera')

    expect(await screen.findByRole('heading', { name: 'Streaming Kamera' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Aktifkan Streaming' }))

    expect(await screen.findByText('Demo Active Member', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getAllByText('Belum terdaftar')).not.toHaveLength(0)
    expect(screen.getAllByText('2')).not.toHaveLength(0)
    const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/live-camera/frames'))
    expect(request?.[1]?.body).toBeInstanceOf(Blob)
    expect(request?.[1]?.headers).toMatchObject({ Authorization: 'Bearer test-token', 'Content-Type': 'image/jpeg' })
    expect(request?.[1]?.headers).not.toHaveProperty('X-Device-Code')
  })

  it('keeps stable identities, smooths movement, and tolerates one missed frame', () => {
    let nextId = 1
    const first: LiveCameraFrame = {
      image_width: 1000,
      image_height: 600,
      face_count: 2,
      faces: [
        { bounding_box: { x: 100, y: 100, width: 150, height: 200 }, registration: 'REGISTERED', reason_code: null, member: { full_name: 'Member A', member_code: 'A' } },
        { bounding_box: { x: 650, y: 110, width: 145, height: 195 }, registration: 'UNREGISTERED', reason_code: 'IDENTITY_NOT_FOUND', member: null },
      ],
    }
    const initial = reconcileTrackedFaces([], first, () => nextId++)
    const memberTrack = initial.find((face) => face.member?.member_code === 'A')
    const moved: LiveCameraFrame = {
      ...first,
      faces: [
        { ...first.faces[1], bounding_box: { x: 625, y: 112, width: 148, height: 198 } },
        { ...first.faces[0], bounding_box: { x: 130, y: 105, width: 152, height: 202 } },
      ],
    }
    const updated = reconcileTrackedFaces(initial, moved, () => nextId++)
    const updatedMember = updated.find((face) => face.member?.member_code === 'A')

    expect(updatedMember?.trackId).toBe(memberTrack?.trackId)
    expect(updatedMember?.bounding_box.x).toBeGreaterThan(100)
    expect(updatedMember?.bounding_box.x).toBeLessThan(130)

    const empty = { ...first, face_count: 0, faces: [] }
    const missedOnce = reconcileTrackedFaces(updated, empty, () => nextId++)
    expect(missedOnce).toHaveLength(2)
    expect(missedOnce.every((face) => face.missedFrames === 1)).toBe(true)
    expect(reconcileTrackedFaces(missedOnce, empty, () => nextId++)).toHaveLength(0)
  })
})
