import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { authenticate, renderApp } from './test-utils'

describe('admin API integrations', () => {
  it('loads settings and patches only changed values', async () => {
    authenticate('SUPER_ADMIN')
    const user = userEvent.setup()
    renderApp('/settings')
    const threshold = await screen.findByLabelText('Threshold kecocokan')
    expect(threshold).toHaveValue(0.45)
    await user.clear(threshold)
    await user.type(threshold, '0.5')
    await user.click(screen.getByRole('button', { name: /simpan perubahan/i }))
    expect(await screen.findByText(/berhasil disimpan.*audit log/i)).toBeInTheDocument()
    const patchCalls = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH')
    const settingCall = patchCalls.find(([url]) => String(url).endsWith('/settings/face_match_threshold'))
    expect(settingCall).toBeDefined()
    expect(JSON.parse(String(settingCall?.[1]?.body))).toEqual({ value: 0.5 })
    expect(patchCalls.filter(([url]) => String(url).includes('/settings/'))).toHaveLength(1)
  })

  it('creates a device with location capabilities and displays its one-time credential', async () => {
    authenticate()
    const user = userEvent.setup()
    renderApp('/devices')
    await screen.findByRole('heading', { name: 'Perangkat' })
    await user.click(screen.getByRole('button', { name: /daftarkan kiosk/i }))
    await user.type(screen.getByLabelText('Nama perangkat'), 'Kiosk Timur')
    await user.type(screen.getByLabelText('Lokasi perangkat'), 'Pintu timur')
    await user.type(screen.getByLabelText('Kode perangkat'), 'KIOSK-TIMUR')
    await user.click(screen.getByRole('button', { name: 'Daftarkan' }))
    expect(await screen.findByText('one-time-device-secret')).toBeInTheDocument()
    const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/devices') && init?.method === 'POST')
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ name: 'Kiosk Timur', device_code: 'KIOSK-TIMUR', capabilities: { location: 'Pintu timur', rgb: true, active_liveness: true } })
  })

  it('loads membership plans from the backend', async () => {
    authenticate('RECEPTIONIST')
    renderApp('/membership-plans')
    expect(await screen.findByRole('heading', { name: 'Paket Membership' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Monthly' })).toBeInTheDocument()
    expect(screen.getByText(/30 hari/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /buat paket/i })).not.toBeInTheDocument()
  })

  it('creates a membership plan for an admin', async () => {
    authenticate()
    const user = userEvent.setup()
    renderApp('/membership-plans')
    await user.click(await screen.findByRole('button', { name: /buat paket/i }))
    await user.type(screen.getByLabelText('Nama paket'), 'Weekend Fit')
    await user.clear(screen.getByLabelText('Durasi hari'))
    await user.type(screen.getByLabelText('Durasi hari'), '8')
    await user.type(screen.getByLabelText('Harga paket'), '150000')
    await user.click(screen.getByRole('button', { name: 'Simpan paket' }))
    expect(await screen.findByText('Paket membership berhasil dibuat.')).toBeInTheDocument()
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/membership-plans') && init?.method === 'POST')).toBe(true))
    const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/membership-plans') && init?.method === 'POST')
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ name: 'Weekend Fit', duration_days: 8, price: 150000, is_active: true })
  })
})
