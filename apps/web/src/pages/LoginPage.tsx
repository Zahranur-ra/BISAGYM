import { useState, type FormEvent } from 'react'
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { useAuth } from '../auth'
import { DemoBadge, Logo } from '../components/ui'

const schema = z.object({ email: z.string().email('Masukkan alamat email yang valid.'), password: z.string().min(8, 'Kata sandi minimal 8 karakter.') })

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('admin@gym.local')
  const [password, setPassword] = useState('GymDemo123!')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  if (user) return <Navigate to="/" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    const result = schema.safeParse({ email, password })
    if (!result.success) {
      setErrors(Object.fromEntries(result.error.issues.map((issue) => [String(issue.path[0]), issue.message])))
      return
    }
    setErrors({})
    setLoading(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : 'Login gagal.' })
    } finally {
      setLoading(false)
    }
  }

  return <div className="login-page">
    <section className="login-visual">
      <div className="login-grid" />
      <div className="login-visual-top"><Logo /><DemoBadge /></div>
      <div className="login-statement"><span className="eyebrow eyebrow-light">AKSES CERDAS. GYM LEBIH AMAN.</span><h1>Kenali member.<br /><em>Buka potensi.</em></h1><p>Satu platform untuk keanggotaan, akses, dan operasional gym yang bergerak secepat member Anda.</p></div>
      <div className="login-stats"><div><strong>99.8%</strong><span>Uptime perangkat</span></div><div><strong>&lt; 0.4s</strong><span>Rata-rata check-in</span></div><div><strong>24/7</strong><span>Kontrol akses</span></div></div>
      <div className="login-privacy"><ShieldCheck /><span><strong>Privacy by design</strong> Template biometrik terenkripsi. Gambar mentah tidak disimpan.</span></div>
    </section>
    <main className="login-panel">
      <div className="login-mobile-brand"><Logo /><DemoBadge /></div>
      <div className="login-form-wrap">
        <div className="login-heading"><span>PORTAL STAF</span><h2>Selamat datang kembali</h2><p>Masuk untuk mengelola Demo Fitness Center.</p></div>
        <form onSubmit={(event) => void submit(event)} noValidate>
          {errors.form && <div className="form-alert" role="alert">{errors.form}</div>}
          <label>Email staf<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" aria-invalid={!!errors.email} />{errors.email && <span className="field-error">{errors.email}</span>}</label>
          <label>Kata sandi<div className="password-field"><input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="current-password" aria-invalid={!!errors.password} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}>{showPassword ? <EyeOff /> : <Eye />}</button></div>{errors.password && <span className="field-error">{errors.password}</span>}</label>
          <div className="form-between"><label className="checkbox"><input type="checkbox" defaultChecked /> Ingat perangkat ini</label><button type="button" className="link-button">Lupa kata sandi?</button></div>
          <button className="primary-button login-button" disabled={loading}>{loading ? <span className="button-loader" /> : <LockKeyhole />} {loading ? 'Memverifikasi...' : 'Masuk ke dashboard'} {!loading && <ArrowRight />}</button>
        </form>
        <div className="demo-credentials"><div><CheckCircle2 /><strong>Akun demo siap digunakan</strong></div><code>admin@gym.local</code><code>GymDemo123!</code><small>Peran lain: superadmin@gym.local atau reception@gym.local</small></div>
      </div>
      <footer>© 2026 BISA Gym Systems <span>•</span> <button>Kebijakan Privasi</button></footer>
    </main>
  </div>
}
