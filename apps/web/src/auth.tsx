import { createContext, useContext, useState, type ReactNode } from 'react'
import { api, REFRESH_TOKEN_KEY, TOKEN_KEY, USER_KEY } from './api/client'
import type { User } from './types'

interface AuthContextValue {
  user: User | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function storedUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') as User | null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(storedUser)

  async function login(email: string, password: string) {
    const result = await api.login(email, password)
    localStorage.setItem(TOKEN_KEY, result.access_token)
    if (result.refresh_token) localStorage.setItem(REFRESH_TOKEN_KEY, result.refresh_token)
    let nextUser = result.user
    if (!nextUser) nextUser = await api.me()
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser))
    setUser(nextUser)
  }

  async function logout() {
    try {
      await api.logout()
    } finally {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(REFRESH_TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
      setUser(null)
    }
  }

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
