import { demoCheckins, demoConsents, demoDevices, demoMemberships, demoMembers, demoPlans } from './demo-data'
import type { ApiErrorShape, BiometricConsent, Branch, Checkin, DashboardSummary, Device, FaceStatus, Member, Membership, MembershipPlan, MemberStatus, Role, SystemSetting, User } from '../types'

export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')
export const TOKEN_KEY = 'bisagym_access_token'
export const REFRESH_TOKEN_KEY = 'bisagym_refresh_token'
export const USER_KEY = 'bisagym_user'
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'
export type FaceEngine = 'opencv_sface' | 'mock'
export const FACE_ENGINE: FaceEngine = import.meta.env.VITE_FACE_ENGINE === 'mock' ? 'mock' : 'opencv_sface'
export const FACE_ENGINE_IS_MOCK = FACE_ENGINE === 'mock'

const DEVELOPMENT_DEVICE_TOKEN = 'development-device-secret'
const DEVICE_TOKEN = import.meta.env.VITE_DEVICE_TOKEN || DEVELOPMENT_DEVICE_TOKEN
const DEVICE_HEADERS = {
  'X-Device-Code': 'KIOSK-001',
  'X-Device-Token': DEVICE_TOKEN,
}

interface Collection<T> {
  items: T[]
  total: number
}

interface BackendMember {
  id: string
  member_code: string
  full_name: string
  email: string | null
  phone: string | null
  status: MemberStatus
  plan: string | null
  valid_until: string | null
  face_enrolled: boolean
  joined_at: string
  address?: string | null
  emergency_contact_name?: string | null
  emergency_contact_phone?: string | null
  notes?: string | null
}

interface BackendCheckin {
  id: string
  attempted_at: string
  member: { id: string; member_code: string; full_name: string } | null
  device: { id: string; name: string } | null
  decision: 'ALLOW' | 'DENY'
  reason_code: string
  processing_time_ms: number
  manual_override: boolean
}

interface BackendDevice {
  id: string
  device_code: string
  name: string
  capabilities: Record<string, unknown> | null
  is_active: boolean
  last_seen_at: string | null
  online?: boolean
}

interface DeviceCredentialResponse extends BackendDevice { credential: string }

export interface PlanInput {
  name: string
  duration_days: number
  price: number
  description?: string | null
  is_active: boolean
}

export interface DeviceInput {
  name: string
  device_code: string
  capabilities: Record<string, unknown>
}

export interface ReportResponse {
  items: Checkin[]
  total: number
  summary?: { allowed: number }
  by_reason?: { reason_code: string; count: number }[]
}

export interface KioskResponse {
  decision: 'ALLOW' | 'DENY'
  reason_code: string
  public_message?: string
  member?: { display_name: string }
  membership?: { valid_until: string }
}

export interface EnrollmentSession {
  id: string
  engine: FaceEngine
  demo_mode: boolean
  required_poses: string[]
}

export interface KioskSession {
  session_token: string
  engine: FaceEngine
  demo_mode: boolean
}

export interface LiveCameraFace {
  bounding_box: { x: number; y: number; width: number; height: number }
  registration: 'REGISTERED' | 'UNREGISTERED'
  reason_code: string | null
  member: { full_name: string; member_code: string } | null
}

export interface LiveCameraFrame {
  image_width: number
  image_height: number
  face_count: number
  faces: LiveCameraFace[]
}

export class ApiError extends Error {
  constructor(message: string, public code = 'API_ERROR', public correlationId?: string) {
    super(message)
  }
}

export function sessionIsMock(session: { engine: FaceEngine; demo_mode: boolean }) {
  return session.engine === 'mock' || session.demo_mode
}

export function assertConfiguredFaceMode(session: { engine: FaceEngine; demo_mode: boolean }) {
  if (sessionIsMock(session) !== FACE_ENGINE_IS_MOCK) {
    throw new ApiError('Mode pengenalan wajah backend tidak sesuai konfigurasi kiosk. Periksa VITE_FACE_ENGINE dan konfigurasi backend.', 'FACE_ENGINE_MISMATCH')
  }
}

export function faceErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return 'Gambar belum dapat diproses. Coba ambil ulang.'
  const code = error.code.toUpperCase()
  if (['NO_FACE', 'NO_FACE_DETECTED', 'FACE_NOT_DETECTED'].includes(code)) return 'Wajah tidak ditemukan. Hadap kamera, pastikan wajah terlihat penuh, lalu coba lagi.'
  if (['MULTIPLE_FACES', 'MULTIPLE_FACES_DETECTED'].includes(code)) return 'Lebih dari satu wajah terdeteksi. Pastikan hanya satu orang berada di depan kamera.'
  if (['LOW_QUALITY', 'LOW_IMAGE_QUALITY', 'IMAGE_QUALITY_TOO_LOW', 'QUALITY_TOO_LOW', 'IMAGE_TOO_BLURRY'].includes(code)) return 'Kualitas gambar belum cukup. Perbaiki pencahayaan, jaga kamera tetap stabil, lalu coba lagi.'
  if (code === 'FACE_TOO_SMALL') return 'Wajah terlalu jauh dari kamera. Mendekatlah sampai wajah memenuhi bingkai.'
  if (code === 'BAD_EXPOSURE') return 'Pencahayaan wajah terlalu gelap atau terlalu terang. Sesuaikan posisi dan cahaya lalu coba lagi.'
  if (code === 'INCONSISTENT_ENROLLMENT_SAMPLES') return 'Sampel wajah tidak konsisten. Pastikan orang yang sama terlihat pada setiap pose lalu ulangi pendaftaran.'
  if (['INVALID_IMAGE', 'IMAGE_DECODE_FAILED', 'CAMERA_CAPTURE_FAILED'].includes(code)) return 'Gambar kamera tidak valid. Pastikan kamera siap lalu ambil ulang.'
  return error.message
}

async function request<T>(path: string, options: RequestInit = {}, responseType: 'json' | 'blob' = 'json', auth = true): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY)
  const bodyHeaders: Record<string, string> = options.body instanceof Blob
    ? { 'Content-Type': options.body.type || 'application/octet-stream' }
    : options.body instanceof FormData || options.body === undefined
      ? {}
      : { 'Content-Type': 'application/json' }
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...bodyHeaders,
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers as Record<string, string> | undefined),
      },
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ApiErrorShape
      throw new ApiError(body.error?.message ?? body.detail ?? 'Permintaan tidak dapat diproses.', body.error?.code, body.error?.correlation_id)
    }
    if (response.status === 204) return undefined as T
    return (responseType === 'blob' ? response.blob() : response.json()) as Promise<T>
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(navigator.onLine ? 'Server tidak dapat dihubungi. Coba beberapa saat lagi.' : 'Anda sedang offline. Periksa koneksi internet.', 'NETWORK_ERROR')
  }
}

function wait<T>(value: T, ms = 180): Promise<T> {
  return new Promise((resolve) => window.setTimeout(() => resolve(structuredClone(value)), ms))
}

function roleForEmail(email: string): User['role'] {
  if (email.startsWith('superadmin')) return 'SUPER_ADMIN'
  if (email.startsWith('reception')) return 'RECEPTIONIST'
  return 'GYM_ADMIN'
}

function mapUser(user: User): User {
  return { ...user, branch_name: user.branch_name || 'Demo Fitness Center' }
}

function mapMember(member: BackendMember): Member {
  return {
    id: member.id,
    member_code: member.member_code,
    full_name: member.full_name,
    email: member.email ?? '',
    phone: member.phone ?? '',
    status: member.status,
    plan: member.plan ?? 'Belum ada paket',
    valid_until: member.valid_until ?? '',
    face_enrolled: member.face_enrolled,
    joined_at: member.joined_at,
    address: member.address ?? undefined,
    emergency_contact_name: member.emergency_contact_name ?? undefined,
    emergency_contact_phone: member.emergency_contact_phone ?? undefined,
    notes: member.notes ?? undefined,
  }
}

function membershipStatus(reason: string): Checkin['membership_status'] {
  if (reason === 'MEMBERSHIP_ACTIVE') return 'ACTIVE'
  if (reason === 'MEMBERSHIP_EXPIRED') return 'EXPIRED'
  if (reason === 'MEMBERSHIP_SUSPENDED') return 'SUSPENDED'
  if (reason === 'MEMBERSHIP_NOT_STARTED') return 'PENDING'
  return 'UNKNOWN'
}

function mapCheckin(checkin: BackendCheckin): Checkin {
  return {
    id: checkin.id,
    attempted_at: checkin.attempted_at,
    member_name: checkin.member?.full_name ?? 'Tidak dikenali',
    member_code: checkin.member?.member_code,
    device_name: checkin.device?.name ?? 'Perangkat tidak diketahui',
    decision: checkin.decision,
    reason_code: checkin.reason_code,
    confidence: '-',
    membership_status: membershipStatus(checkin.reason_code),
    processing_time_ms: checkin.processing_time_ms,
    manual_override: checkin.manual_override,
  }
}

function mapDevice(device: BackendDevice): Device {
  const capabilities = device.capabilities ?? {}
  const names = Object.entries(capabilities)
    .filter(([key, value]) => value === true && ['rgb', 'depth', 'active_liveness'].includes(key))
    .map(([key]) => key === 'active_liveness' ? 'Liveness' : key.toUpperCase())
  const lastSeen = device.last_seen_at ? new Date(device.last_seen_at).getTime() : 0
  const online = device.online ?? Boolean(device.is_active && lastSeen && Date.now() - lastSeen <= 120_000)
  const cameraStatus = capabilities.camera_status
  return {
    id: device.id,
    code: device.device_code,
    name: device.name,
    location: typeof capabilities.location === 'string' ? capabilities.location : '-',
    online,
    active: device.is_active,
    last_seen_at: device.last_seen_at ?? '',
    version: typeof capabilities.software_version === 'string' ? capabilities.software_version : '-',
    capabilities: names,
    camera_status: cameraStatus === 'ready' || cameraStatus === 'Siap' ? 'Siap' : 'Terputus',
  }
}

function memberPayload(member: Partial<Member>) {
  return {
    ...(member.full_name !== undefined ? { full_name: member.full_name } : {}),
    ...(member.email !== undefined ? { email: member.email || null } : {}),
    ...(member.phone !== undefined ? { phone: member.phone || null } : {}),
    ...(member.address !== undefined ? { address: member.address || null } : {}),
    ...(member.emergency_contact_name !== undefined ? { emergency_contact_name: member.emergency_contact_name || null } : {}),
    ...(member.emergency_contact_phone !== undefined ? { emergency_contact_phone: member.emergency_contact_phone || null } : {}),
    ...(member.notes !== undefined ? { notes: member.notes || null } : {}),
    ...(member.status === 'ACTIVE' || member.status === 'SUSPENDED' ? { status: member.status } : {}),
  }
}

export const api = {
  async login(email: string, password: string) {
    if (DEMO_MODE) {
      await wait(null, 350)
      const validEmails = ['superadmin@gym.local', 'admin@gym.local', 'reception@gym.local']
      if (!validEmails.includes(email) || password !== 'GymDemo123!') throw new ApiError('Email atau kata sandi demo tidak sesuai.', 'INVALID_CREDENTIALS')
      const user: User = { id: `u-${roleForEmail(email)}`, full_name: email.startsWith('reception') ? 'Nadia Resepsionis' : email.startsWith('superadmin') ? 'Arif Super Admin' : 'Budi Gym Admin', email, role: roleForEmail(email), branch_name: 'Demo Fitness Center' }
      return { access_token: `demo-token-${Date.now()}`, refresh_token: '', user }
    }
    const result = await request<{ access_token: string; refresh_token: string; user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    return { ...result, user: mapUser(result.user) }
  },
  me: async () => mapUser(await request<User>('/auth/me')),
  logout: () => DEMO_MODE ? wait(undefined) : request<void>('/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: localStorage.getItem(REFRESH_TOKEN_KEY) }) }),
  members: async () => DEMO_MODE ? wait(demoMembers) : (await request<Collection<BackendMember>>('/members')).items.map(mapMember),
  member: async (id: string) => DEMO_MODE ? wait(demoMembers.find((member) => member.id === id) ?? demoMembers[0]) : mapMember(await request<BackendMember>(`/members/${id}`)),
  createMember: async (member: Omit<Member, 'id' | 'member_code' | 'joined_at'>) => DEMO_MODE
    ? wait({ ...member, id: `m-${Date.now()}`, member_code: `BG-${Math.floor(100000 + Math.random() * 900000)}`, joined_at: new Date().toISOString().slice(0, 10) })
    : mapMember(await request<BackendMember>('/members', { method: 'POST', body: JSON.stringify(memberPayload(member)) })),
  updateMember: async (id: string, member: Partial<Member>) => DEMO_MODE
    ? wait({ ...demoMembers.find((item) => item.id === id)!, ...member })
    : mapMember(await request<BackendMember>(`/members/${id}`, { method: 'PATCH', body: JSON.stringify(memberPayload(member)) })),
  deleteMember: (id: string) => DEMO_MODE ? wait(undefined) : request<void>(`/members/${id}`, { method: 'DELETE' }),
  membershipPlans: async () => DEMO_MODE ? wait(demoPlans) : (await request<Collection<MembershipPlan>>('/membership-plans')).items,
  createMembershipPlan: (value: PlanInput) => DEMO_MODE ? wait<MembershipPlan>({ ...value, price: String(value.price), id: `plan-${Date.now()}`, branch_id: null, description: value.description ?? null }) : request<MembershipPlan>('/membership-plans', { method: 'POST', body: JSON.stringify(value) }),
  updateMembershipPlan: (id: string, value: Partial<PlanInput>) => DEMO_MODE ? wait<MembershipPlan>({ ...demoPlans.find((item) => item.id === id)!, ...value, price: String(value.price ?? demoPlans.find((item) => item.id === id)!.price) }) : request<MembershipPlan>(`/membership-plans/${id}`, { method: 'PATCH', body: JSON.stringify(value) }),
  memberMemberships: async (id: string) => DEMO_MODE ? wait(demoMemberships(id)) : (await request<Collection<Membership>>(`/members/${id}/memberships`)).items,
  assignMembership: (id: string, planId: string, start: string, pricePaid: string, paymentReference = '') => {
    if (DEMO_MODE) {
      const plan = demoPlans.find((item) => item.id === planId)
      if (!plan) throw new ApiError('Paket membership yang dipilih tidak tersedia.', 'MEMBERSHIP_PLAN_NOT_FOUND')
      const end = new Date(`${start}T00:00:00.000Z`)
      end.setUTCDate(end.getUTCDate() + plan.duration_days)
      return wait<Membership>({ id: `membership-${Date.now()}`, member_id: id, plan_id: planId, start_at: new Date(`${start}T00:00:00.000Z`).toISOString(), end_at: end.toISOString(), status: 'ACTIVE', derived_status: 'ACTIVE', price_paid: pricePaid, payment_reference: paymentReference || null, suspended_at: null, suspension_reason: null })
    }
    return request<Membership>(`/members/${id}/memberships`, {
      method: 'POST',
      body: JSON.stringify({
        plan_id: planId,
        start_at: new Date(`${start}T00:00:00.000Z`).toISOString(),
        price_paid: pricePaid,
        payment_reference: paymentReference || null,
      }),
    })
  },
  suspendMembership: (id: string, reason: string) => DEMO_MODE ? wait({ id, status: 'SUSPENDED' }) : request<Membership>(`/memberships/${id}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reactivateMembership: (id: string) => DEMO_MODE ? wait({ id, status: 'ACTIVE' }) : request<Membership>(`/memberships/${id}/reactivate`, { method: 'POST' }),
  cancelMembership: (id: string) => DEMO_MODE ? wait({ id, status: 'CANCELLED' }) : request<Membership>(`/memberships/${id}/cancel`, { method: 'POST' }),
  checkins: async () => DEMO_MODE ? wait(demoCheckins) : (await request<Collection<BackendCheckin>>('/checkins')).items.map(mapCheckin),
  memberCheckins: async (id: string) => DEMO_MODE ? wait(demoCheckins.filter((item) => item.member_code === demoMembers.find((member) => member.id === id)?.member_code)) : (await request<Collection<BackendCheckin>>(`/members/${id}/checkins`)).items.map(mapCheckin),
  manualOverride: (id: string, memberId: string, reason: string) => DEMO_MODE ? wait({ id, decision: 'ALLOW', manual_override: true, member_id: memberId, reason }) : request(`/checkins/${id}/manual-override`, { method: 'POST', body: JSON.stringify({ member_id: memberId, reason }) }),
  devices: async () => DEMO_MODE ? wait(demoDevices) : (await request<Collection<BackendDevice>>('/devices')).items.map(mapDevice),
  toggleDevice: (id: string, active: boolean) => DEMO_MODE ? wait({ id, active }) : request(`/devices/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: active }) }),
  createDevice: async (value: DeviceInput) => {
    if (DEMO_MODE) return wait({ device: { ...mapDevice({ id: `device-${Date.now()}`, name: value.name, device_code: value.device_code, capabilities: value.capabilities, is_active: true, last_seen_at: null }), active: true }, credential: `demo-${crypto.randomUUID()}` })
    const result = await request<DeviceCredentialResponse>('/devices', { method: 'POST', body: JSON.stringify(value) })
    return { device: mapDevice(result), credential: result.credential }
  },
  rotateDeviceCredential: (id: string) => DEMO_MODE ? wait({ device_id: id, credential: `demo-${crypto.randomUUID()}` }) : request<{ device_id: string; credential: string }>(`/devices/${id}/rotate-credential`, { method: 'POST' }),
  createConsent: (memberId: string) => DEMO_MODE ? wait({ id: `consent-${Date.now()}`, member_id: memberId, consent_version: 'v2.1' }) : request(`/members/${memberId}/biometric-consents`, { method: 'POST', body: JSON.stringify({ consent_version: 'v2.1', capture_purpose: 'Kontrol akses gym', retention_policy: 'Template sampai persetujuan dicabut; gambar mentah tidak disimpan.' }) }),
  memberConsents: async (memberId: string) => DEMO_MODE ? wait(demoConsents(memberId)) : (await request<Collection<BiometricConsent>>(`/members/${memberId}/biometric-consents`)).items,
  revokeConsent: (consentId: string, reason: string) => DEMO_MODE ? wait({ id: consentId, revoked_at: new Date().toISOString() }) : request(`/biometric-consents/${consentId}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) }),
  faceStatus: (memberId: string) => DEMO_MODE ? wait<FaceStatus>({ member_id: memberId, enrolled: Boolean(demoMembers.find((item) => item.id === memberId)?.face_enrolled), active_profile_count: demoMembers.find((item) => item.id === memberId)?.face_enrolled ? 1 : 0, last_enrolled_at: demoMembers.find((item) => item.id === memberId)?.joined_at ?? null }) : request<FaceStatus>(`/members/${memberId}/face-profile/status`),
  revokeFaceProfile: (memberId: string, reason: string) => DEMO_MODE ? wait(undefined) : request<void>(`/members/${memberId}/face-profile?reason=${encodeURIComponent(reason)}`, { method: 'DELETE' }),
  startEnrollment: (memberId: string) => DEMO_MODE
    ? wait<EnrollmentSession>({ id: `enroll-${Date.now()}`, engine: 'mock', demo_mode: true, required_poses: ['FRONT', 'LEFT', 'RIGHT', 'UP'] })
    : request<EnrollmentSession>('/enrollments/sessions', { method: 'POST', body: JSON.stringify({ member_id: memberId }) }),
  uploadSample: (session: EnrollmentSession, memberId: string, pose: string, image?: Blob) => {
    if (sessionIsMock(session)) {
      if (DEMO_MODE) return wait({ accepted: true, pose, quality_category: 'Baik' }, 450)
      return request(`/enrollments/sessions/${session.id}/samples`, { method: 'POST', body: JSON.stringify({ sample_tag: `ui-enrollment:${memberId}:${pose.toLowerCase()}`, pose_type: pose }) })
    }
    if (!image) throw new ApiError('Kamera belum menghasilkan gambar. Pastikan kamera siap lalu coba lagi.', 'CAMERA_CAPTURE_FAILED')
    return request(`/enrollments/sessions/${session.id}/samples?pose_type=${encodeURIComponent(pose)}`, { method: 'POST', body: image, headers: { 'Content-Type': 'image/jpeg' } })
  },
  completeEnrollment: (sessionId: string) => DEMO_MODE ? wait({ status: 'ENROLLED' }, 500) : request(`/enrollments/sessions/${sessionId}/complete`, { method: 'POST' }),
  analyzeLiveCameraFrame: (image: Blob, branchId: string, signal?: AbortSignal) => request<LiveCameraFrame>(`/live-camera/frames?branch_id=${encodeURIComponent(branchId)}`, { method: 'POST', body: image, signal, headers: { 'Content-Type': 'image/jpeg' } }),
  startKioskSession: () => request<KioskSession>('/kiosk/sessions', { method: 'POST', headers: DEVICE_HEADERS }, 'json', false),
  kioskCheckin: (session: KioskSession, image: Blob | undefined, scenario: 'active' | 'expired' | 'suspended' | 'unknown' | 'spoof' = 'unknown'): Promise<KioskResponse> => {
    const idempotencyKey = crypto.randomUUID()
    const tags = { active: 'member-demo-active', expired: 'member-demo-expired', suspended: 'member-demo-suspended', unknown: 'unknown', spoof: 'spoof' }
    if (sessionIsMock(session)) {
      return request<KioskResponse>('/kiosk/checkin', {
        method: 'POST',
        headers: DEVICE_HEADERS,
        body: JSON.stringify({ session_token: session.session_token, sample_tag: tags[scenario], idempotency_key: idempotencyKey }),
      }, 'json', false)
    }
    if (!image) throw new ApiError('Kamera belum menghasilkan gambar. Pastikan kamera siap lalu coba lagi.', 'CAMERA_CAPTURE_FAILED')
    return request<KioskResponse>('/kiosk/checkin', {
      method: 'POST',
      headers: { ...DEVICE_HEADERS, 'X-Kiosk-Session': session.session_token, 'Idempotency-Key': idempotencyKey, 'Content-Type': 'image/jpeg' },
      body: image,
    }, 'json', false)
  },
  dashboardSummary: async () => DEMO_MODE ? wait<DashboardSummary>({ active_members: demoMembers.filter((item) => item.status === 'ACTIVE').length, today_allowed_checkins: demoCheckins.filter((item) => item.decision === 'ALLOW').length, today_denied_attempts: demoCheckins.filter((item) => item.decision === 'DENY').length, devices_online: demoDevices.filter((item) => item.online).length }) : request<DashboardSummary>('/dashboard/summary'),
  attendanceReport: async (start?: string, end?: string) => {
    if (DEMO_MODE) return wait<ReportResponse>({ items: demoCheckins.filter((item) => item.decision === 'ALLOW'), total: demoCheckins.filter((item) => item.decision === 'ALLOW').length, summary: { allowed: demoCheckins.filter((item) => item.decision === 'ALLOW').length } })
    const data = await request<{ items: BackendCheckin[]; total: number; summary: { allowed: number } }>(`/reports/attendance${reportParams(start, end)}`)
    return { ...data, items: data.items.map(mapCheckin) }
  },
  denialReport: async (start?: string, end?: string) => {
    if (DEMO_MODE) {
      const items = demoCheckins.filter((item) => item.decision === 'DENY')
      const counts = new Map<string, number>()
      items.forEach((item) => counts.set(item.reason_code, (counts.get(item.reason_code) ?? 0) + 1))
      return wait<ReportResponse>({ items, total: items.length, by_reason: [...counts].map(([reason_code, count]) => ({ reason_code, count })) })
    }
    const data = await request<{ items: BackendCheckin[]; total: number; by_reason: { reason_code: string; count: number }[] }>(`/reports/denials${reportParams(start, end)}`)
    return { ...data, items: data.items.map(mapCheckin) }
  },
  expiringMemberships: async (days = 7) => DEMO_MODE ? wait({ items: demoMembers.filter((item) => item.status === 'ACTIVE').flatMap((item) => demoMemberships(item.id)).slice(0, 2), total: Math.min(2, demoMembers.filter((item) => item.status === 'ACTIVE').length), days }) : request<{ items: Membership[]; total: number; days: number }>(`/reports/expiring-memberships?days=${days}`),
  deviceHealth: async () => DEMO_MODE ? wait(demoDevices) : (await request<Collection<BackendDevice & { online: boolean; heartbeat_age_seconds: number | null }>>('/reports/device-health')).items.map(mapDevice),
  attendanceCsv: (start?: string, end?: string) => request<Blob>(`/reports/attendance${reportParams(start, end, true)}`, {}, 'blob'),
  settings: async () => DEMO_MODE ? wait<SystemSetting[]>([{ key: 'face_match_threshold', value: 0.45, scope_type: 'GLOBAL' }, { key: 'face_min_quality_score', value: 0.55, scope_type: 'GLOBAL' }, { key: 'liveness_min_score', value: 0.7, scope_type: 'GLOBAL' }, { key: 'depth_validation_enabled', value: false, scope_type: 'GLOBAL' }, { key: 'depth_min_score', value: 0.6, scope_type: 'GLOBAL' }, { key: 'checkin_cooldown_seconds', value: 60, scope_type: 'GLOBAL' }, { key: 'raw_capture_retention_hours', value: 24, scope_type: 'GLOBAL' }, { key: 'privacy_notice_version', value: 'v1', scope_type: 'GLOBAL' }]) : (await request<Collection<SystemSetting>>('/settings')).items,
  updateSetting: (key: string, value: SystemSetting['value']) => DEMO_MODE ? wait<SystemSetting>({ key, value, scope_type: 'GLOBAL' }) : request<SystemSetting>(`/settings/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify({ value }) }),
  users: async () => DEMO_MODE ? wait<User[]>([{ id: 'u-super', branch_id: null, full_name: 'Arif Super Admin', email: 'superadmin@gym.local', role: 'SUPER_ADMIN', branch_name: 'Semua cabang', is_active: true }]) : (await request<Collection<User>>('/users')).items.map(mapUser),
  branches: async () => DEMO_MODE ? wait<Branch[]>([{ id: 'branch-demo', code: 'JKT-SEL', name: 'Demo Fitness Center', address: 'Jakarta Selatan', timezone: 'Asia/Jakarta', is_active: true }]) : (await request<Collection<Branch>>('/branches')).items,
  createUser: (value: { branch_id: string | null; full_name: string; email: string; password: string; role: Role }) => DEMO_MODE ? wait<User>({ ...value, id: `user-${Date.now()}`, branch_name: 'Demo Fitness Center', is_active: true }) : request<User>('/users', { method: 'POST', body: JSON.stringify(value) }),
  createBranch: (value: { code: string; name: string; address: string | null; timezone: string; is_active: boolean }) => DEMO_MODE ? wait<Branch>({ ...value, id: `branch-${Date.now()}` }) : request<Branch>('/branches', { method: 'POST', body: JSON.stringify(value) }),
}

function reportParams(start?: string, end?: string, csv = false) {
  const params = new URLSearchParams()
  if (start) params.set('start_at', new Date(`${start}T00:00:00`).toISOString())
  if (end) {
    const exclusive = new Date(`${end}T00:00:00`)
    exclusive.setDate(exclusive.getDate() + 1)
    params.set('end_at', exclusive.toISOString())
  }
  if (csv) params.set('export', 'csv')
  const query = params.toString()
  return query ? `?${query}` : ''
}
