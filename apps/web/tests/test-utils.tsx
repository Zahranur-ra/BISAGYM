import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../src/App'
import { AuthProvider } from '../src/auth'
import { TOKEN_KEY, USER_KEY } from '../src/api/client'
import type { Role, User } from '../src/types'

export function authenticate(role: Role = 'GYM_ADMIN') {
  const user: User = { id: 'test-user', branch_id: role === 'SUPER_ADMIN' ? null : 'branch-1', full_name: role === 'RECEPTIONIST' ? 'Nadia Resepsionis' : 'Budi Admin', email: 'test@gym.local', role, branch_name: 'Demo Fitness Center' }
  localStorage.setItem(TOKEN_KEY, 'test-token')
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function renderApp(path = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></QueryClientProvider>)
}
