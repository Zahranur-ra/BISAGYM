import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { authenticate, renderApp } from './test-utils'
import { api, type EnrollmentSession, type KioskSession } from '../src/api/client'

describe('face enrollment', () => {
  it('requires consent and allows a hardware-free mock sample', async () => {
    authenticate()
    const user = userEvent.setup()
    renderApp('/enrollment?member=m-005')
    expect(await screen.findByText('Rafi Akbar')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /lanjut ke persetujuan/i }))
    expect(screen.getByRole('button', { name: /setujui & buka kamera/i })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /member menyetujui/i }))
    await user.click(screen.getByRole('button', { name: /setujui & buka kamera/i }))
    expect(await screen.findByText('Kamera tidak tersedia')).toBeInTheDocument()
    expect(screen.getByText(/adapter mock aktif/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Hadap depan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /gunakan sampel mock/i })).toBeEnabled()
  })

  it('forwards an authenticated JPEG blob and pose query for a real session', async () => {
    authenticate()
    const image = new Blob(['jpeg-enrollment'], { type: 'image/jpeg' })
    const session: EnrollmentSession = { id: 'real-enrollment', engine: 'opencv_sface', demo_mode: false, required_poses: ['FRONT'] }

    await api.uploadSample(session, 'm-005', 'FRONT', image)

    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/enrollments/sessions/real-enrollment/samples'))
    expect(String(call?.[0]).endsWith('/enrollments/sessions/real-enrollment/samples?pose_type=FRONT')).toBe(true)
    expect(call?.[1]?.body).toBe(image)
    expect(call?.[1]?.headers).toMatchObject({ Authorization: 'Bearer test-token', 'Content-Type': 'image/jpeg' })
  })
})

describe('public kiosk', () => {
  it('denies a regular camera scan when only the mock engine is active', async () => {
    const user = userEvent.setup()
    renderApp('/kiosk')
    expect(screen.getByText(/scan biasa menggunakan skenario tidak dikenal/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mulai check-in' }))
    expect(await screen.findByRole('heading', { name: 'Wajah belum dikenali' }, { timeout: 2000 })).toBeInTheDocument()
    const checkinCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/kiosk/checkin'))
    expect(JSON.parse(String(checkinCall?.[1]?.body))).toMatchObject({ sample_tag: 'unknown' })
  })

  it('renders an allowed state without sensitive biometric values', async () => {
    const user = userEvent.setup()
    renderApp('/kiosk')
    await user.click(screen.getByRole('button', { name: 'Member aktif' }))
    expect(await screen.findByRole('heading', { name: 'Akses diizinkan' }, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.getByText('Demo')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/embedding|match score|similarity|0\.45/i)
    const calls = vi.mocked(fetch).mock.calls
    const sessionCall = calls.find(([url]) => String(url).endsWith('/kiosk/sessions'))
    const checkinCall = calls.find(([url]) => String(url).endsWith('/kiosk/checkin'))
    expect(calls.indexOf(sessionCall!)).toBeLessThan(calls.indexOf(checkinCall!))
    expect(sessionCall?.[1]?.headers).toMatchObject({ 'X-Device-Code': 'KIOSK-001', 'X-Device-Token': 'development-device-secret' })
    expect(checkinCall?.[1]?.headers).toMatchObject({ 'X-Device-Code': 'KIOSK-001', 'X-Device-Token': 'development-device-secret' })
    expect(JSON.parse(String(checkinCall?.[1]?.body))).toMatchObject({ session_token: 'secure-kiosk-token', sample_tag: 'member-demo-active' })
  })

  it('renders neutral denial states for expired and spoof demos', async () => {
    const user = userEvent.setup()
    renderApp('/kiosk')
    await user.click(screen.getByRole('button', { name: 'Kedaluwarsa' }))
    expect(await screen.findByRole('heading', { name: 'Membership telah berakhir' }, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.getByText(/hubungi resepsionis/i)).toBeInTheDocument()
  })

  it('forwards a real JPEG with device, session, and idempotency headers without bearer auth', async () => {
    authenticate()
    const image = new Blob(['jpeg-kiosk'], { type: 'image/jpeg' })
    const session: KioskSession = { session_token: 'real-session-token', engine: 'opencv_sface', demo_mode: false }

    await api.startKioskSession()
    await api.kioskCheckin(session, image)

    const calls = vi.mocked(fetch).mock.calls
    const sessionCall = calls.find(([url]) => String(url).endsWith('/kiosk/sessions'))
    const checkinCall = calls.find(([url, init]) => String(url).endsWith('/kiosk/checkin') && init?.body instanceof Blob)
    expect(sessionCall?.[1]?.headers).toMatchObject({ 'X-Device-Code': 'KIOSK-001', 'X-Device-Token': 'development-device-secret' })
    expect(sessionCall?.[1]?.headers).not.toHaveProperty('Authorization')
    expect(checkinCall?.[1]?.body).toBe(image)
    expect(checkinCall?.[1]?.headers).toMatchObject({
      'X-Device-Code': 'KIOSK-001',
      'X-Device-Token': 'development-device-secret',
      'X-Kiosk-Session': 'real-session-token',
      'Content-Type': 'image/jpeg',
    })
    expect(checkinCall?.[1]?.headers).not.toHaveProperty('Authorization')
    expect((checkinCall?.[1]?.headers as Record<string, string>)['Idempotency-Key']).toEqual(expect.any(String))
  })
})
