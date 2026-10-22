import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const members = [
      { id: 'm-001', member_code: 'DEMO-ACTIVE', full_name: 'Demo Active Member', email: null, phone: null, status: 'ACTIVE', plan: 'Monthly', valid_until: '2026-08-27T00:00:00Z', face_enrolled: true, joined_at: '2026-01-01T00:00:00Z' },
      { id: 'm-005', member_code: 'DEMO-NOFACE', full_name: 'Rafi Akbar', email: 'rafi@example.com', phone: '081977016504', status: 'ACTIVE', plan: 'Monthly', valid_until: '2026-08-18T00:00:00Z', face_enrolled: false, joined_at: '2026-07-18T00:00:00Z' },
    ]
    const plans = [
      { id: 'plan-monthly', branch_id: 'branch-1', name: 'Monthly', duration_days: 30, price: '450000', description: 'Paket bulanan', is_active: true },
      { id: 'plan-annual', branch_id: null, name: 'Annual Pro', duration_days: 365, price: '4200000', description: 'Paket tahunan', is_active: true },
    ]
    const settings = [
      { key: 'face_match_threshold', value: 0.45, scope_type: 'GLOBAL' },
      { key: 'face_min_quality_score', value: 0.55, scope_type: 'GLOBAL' },
      { key: 'liveness_min_score', value: 0.7, scope_type: 'GLOBAL' },
      { key: 'depth_validation_enabled', value: false, scope_type: 'GLOBAL' },
      { key: 'depth_min_score', value: 0.6, scope_type: 'GLOBAL' },
      { key: 'checkin_cooldown_seconds', value: 60, scope_type: 'GLOBAL' },
      { key: 'raw_capture_retention_hours', value: 24, scope_type: 'GLOBAL' },
      { key: 'privacy_notice_version', value: 'v1', scope_type: 'GLOBAL' },
    ]
    if (url.endsWith('/auth/login')) return json({ access_token: 'live-access-token', refresh_token: 'live-refresh-token', user: { id: 'u-admin', full_name: 'Budi Gym Admin', email: 'admin@gym.local', role: 'GYM_ADMIN', branch_id: 'branch-1' } })
    if (url.endsWith('/auth/logout')) return new Response(null, { status: 204 })
    if (url.endsWith('/dashboard/summary')) return json({ active_members: 2, today_allowed_checkins: 1, today_denied_attempts: 0, devices_online: 1 })
    if (url.endsWith('/membership-plans') && init?.method === 'POST') return json({ id: 'plan-new', branch_id: 'branch-1', ...JSON.parse(String(init.body)) }, 201)
    if (url.endsWith('/membership-plans')) return json({ items: plans, total: plans.length })
    if (/\/membership-plans\/[^/]+$/.test(url) && init?.method === 'PATCH') return json({ ...plans[0], ...JSON.parse(String(init.body)) })
    if (url.includes('/reports/expiring-memberships')) return json({ items: [{ id: 'membership-1', member_id: 'm-001', plan_id: 'plan-monthly', start_at: '2026-07-01T00:00:00Z', end_at: '2026-08-01T00:00:00Z', status: 'ACTIVE', derived_status: 'ACTIVE', price_paid: '450000', payment_reference: null, suspended_at: null, suspension_reason: null }], total: 1, days: 7 })
    if (url.includes('/reports/attendance')) return url.includes('export=csv') ? new Response('attempt_id,member_name\n1,Demo', { headers: { 'Content-Type': 'text/csv' } }) : json({ items: [], total: 0, summary: { allowed: 0 } })
    if (url.includes('/reports/denials')) return json({ items: [], total: 0, by_reason: [] })
    if (url.endsWith('/reports/device-health')) return json({ items: [], total: 0 })
    if (url.endsWith('/settings')) return json({ items: settings, total: settings.length })
    if (/\/settings\/[^/]+$/.test(url) && init?.method === 'PATCH') return json({ key: url.split('/').pop(), value: JSON.parse(String(init.body)).value, scope_type: 'GLOBAL' })
    if (url.endsWith('/users') && init?.method === 'POST') return json({ id: 'user-new', ...JSON.parse(String(init.body)), is_active: true }, 201)
    if (url.endsWith('/users')) return json({ items: [{ id: 'u-admin', branch_id: 'branch-1', full_name: 'Budi Gym Admin', email: 'admin@gym.local', role: 'GYM_ADMIN', is_active: true }], total: 1 })
    if (url.endsWith('/branches') && init?.method === 'POST') return json({ id: 'branch-new', ...JSON.parse(String(init.body)) }, 201)
    if (url.endsWith('/branches')) return json({ items: [{ id: 'branch-1', code: 'DEMO', name: 'Demo Fitness Center', address: null, timezone: 'Asia/Jakarta', is_active: true }], total: 1 })
    if (url.endsWith('/members')) return json({ items: members, total: members.length })
    if (/\/members\/[^/]+\/memberships$/.test(url) && init?.method === 'POST') return json({ id: 'membership-new', member_id: 'm-001', ...JSON.parse(String(init.body)), end_at: '2026-08-27T00:00:00Z', status: 'ACTIVE', derived_status: 'ACTIVE' }, 201)
    if (/\/members\/[^/]+\/memberships$/.test(url)) return json({ items: [{ id: 'membership-1', member_id: 'm-001', plan_id: 'plan-monthly', start_at: '2026-07-01T00:00:00Z', end_at: '2026-08-01T00:00:00Z', status: 'ACTIVE', derived_status: 'ACTIVE', price_paid: '450000', payment_reference: null, suspended_at: null, suspension_reason: null }], total: 1 })
    if (/\/members\/[^/]+\/checkins$/.test(url)) return json({ items: [], total: 0 })
    if (/\/members\/[^/]+\/biometric-consents$/.test(url) && (!init?.method || init.method === 'GET')) return json({ items: [], total: 0 })
    if (/\/members\/[^/]+\/face-profile\/status$/.test(url)) return json({ member_id: 'm-001', enrolled: true, active_profile_count: 1, last_enrolled_at: '2026-01-01T00:00:00Z' })
    if (/\/members\/[^/]+$/.test(url)) return json(members.find((member) => url.endsWith(member.id)) ?? members[0])
    if (url.endsWith('/checkins')) return json({ items: [{ id: 'checkin-1', attempted_at: '2026-07-27T09:42:00Z', member: { id: 'm-001', member_code: 'DEMO-ACTIVE', full_name: 'Demo Active Member' }, device: { id: 'device-1', name: 'Demo Front Door Kiosk' }, decision: 'ALLOW', reason_code: 'MEMBERSHIP_ACTIVE', processing_time_ms: 12, manual_override: false, match_score: 0.99 }], total: 1 })
    if (url.endsWith('/devices') && init?.method === 'POST') return json({ id: 'device-new', ...JSON.parse(String(init.body)), is_active: true, last_seen_at: null, credential: 'one-time-device-secret' }, 201)
    if (url.endsWith('/devices')) return json({ items: [{ id: 'device-1', device_code: 'KIOSK-001', name: 'Demo Front Door Kiosk', capabilities: { rgb: true, active_liveness: true, camera_status: 'ready', software_version: 'dev' }, is_active: true, last_seen_at: new Date().toISOString() }], total: 1 })
    if (/\/devices\/[^/]+\/rotate-credential$/.test(url)) return json({ device_id: 'device-1', credential: 'rotated-device-secret' })
    if (url.includes('/biometric-consents')) return json({ id: 'consent-1' }, 201)
    if (url.endsWith('/enrollments/sessions')) return json({ id: 'enrollment-1', engine: 'mock', demo_mode: true, required_poses: ['FRONT', 'LEFT', 'RIGHT', 'UP'] }, 201)
    if (/\/enrollments\/sessions\/[^/]+\/samples/.test(url)) return json({ accepted: true, pose_type: url.includes('pose_type=') ? new URL(url, 'http://localhost').searchParams.get('pose_type') : JSON.parse(String(init?.body)).pose_type }, 201)
    if (url.includes('/live-camera/frames')) return json({ image_width: 1280, image_height: 720, face_count: 2, faces: [{ bounding_box: { x: 120, y: 100, width: 220, height: 280 }, registration: 'REGISTERED', reason_code: null, member: { full_name: 'Demo Active Member', member_code: 'DEMO-ACTIVE' } }, { bounding_box: { x: 760, y: 110, width: 210, height: 270 }, registration: 'UNREGISTERED', reason_code: 'IDENTITY_NOT_FOUND', member: null }] })
    if (url.endsWith('/kiosk/sessions')) return json({ session_id: 'kiosk-session-1', session_token: 'secure-kiosk-token', engine: 'mock', demo_mode: true }, 201)
    if (url.endsWith('/kiosk/checkin')) {
      if (init?.body instanceof Blob) return json({ decision: 'ALLOW', reason_code: 'MEMBERSHIP_ACTIVE', member: { display_name: 'Real Member' } })
      const body = JSON.parse(String(init?.body)) as { sample_tag: string }
      if (body.sample_tag === 'member-demo-active') return json({ decision: 'ALLOW', reason_code: 'MEMBERSHIP_ACTIVE', member: { display_name: 'Demo' }, membership: { valid_until: '2026-08-27T00:00:00Z' } })
      const reason = body.sample_tag === 'member-demo-expired' ? 'MEMBERSHIP_EXPIRED' : body.sample_tag === 'member-demo-suspended' ? 'MEMBERSHIP_SUSPENDED' : body.sample_tag === 'spoof' ? 'LIVENESS_FAILED' : 'IDENTITY_NOT_FOUND'
      return json({ decision: 'DENY', reason_code: reason, public_message: 'Akses ditolak. Silakan hubungi resepsionis.' })
    }
    return json({ error: { code: 'NOT_FOUND', message: `Unhandled test request: ${url}` } }, 404)
  }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
