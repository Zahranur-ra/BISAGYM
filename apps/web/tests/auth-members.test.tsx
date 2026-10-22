import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderApp, authenticate } from './test-utils'

describe('authentication and roles', () => {
  it('logs in through the live backend and maps backend collections', async () => {
    const user = userEvent.setup()
    renderApp('/login')
    expect(screen.getByRole('heading', { name: /selamat datang kembali/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /masuk ke dashboard/i }))
    expect(await screen.findByRole('heading', { name: /selamat (pagi|siang|sore|malam)/i })).toBeInTheDocument()
    expect(localStorage.getItem('bisagym_access_token')).toBe('live-access-token')
    expect(localStorage.getItem('bisagym_refresh_token')).toBe('live-refresh-token')
    expect(await screen.findByText('Demo Active Member')).toBeInTheDocument()
    const loginCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/auth/login'))
    expect(loginCall?.[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({ email: 'admin@gym.local', password: 'GymDemo123!' })
  })

  it('hides privileged navigation from receptionists', async () => {
    authenticate('RECEPTIONIST')
    renderApp('/')
    expect(await screen.findByRole('heading', { name: /selamat (pagi|siang|sore|malam)/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Perangkat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Laporan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Pengaturan' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Data Member' })).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/devices'))).toBe(false)
  })
})

describe('member management', () => {
  it('unwraps and maps enriched backend member records', async () => {
    authenticate()
    renderApp('/members')
    expect(await screen.findByText('Demo Active Member')).toBeInTheDocument()
    expect(screen.getAllByText('Monthly').length).toBeGreaterThan(0)
    expect(screen.getByText('Terdaftar')).toBeInTheDocument()
  })

  it('validates the required member fields without losing form state', async () => {
    authenticate()
    const user = userEvent.setup()
    renderApp('/members')
    await screen.findByRole('heading', { name: 'Data Member' })
    await user.click(screen.getByRole('button', { name: /tambah member/i }))
    await user.type(screen.getByLabelText('Nama lengkap'), 'A')
    await user.type(screen.getByLabelText('Nomor telepon'), '12')
    await user.click(screen.getByRole('button', { name: /simpan member/i }))
    expect(await screen.findByText('Nama minimal 3 karakter.')).toBeInTheDocument()
    expect(screen.getByText('Nomor telepon minimal 9 digit.')).toBeInTheDocument()
    expect(screen.getByLabelText('Nama lengkap')).toHaveValue('A')
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
  })
})
