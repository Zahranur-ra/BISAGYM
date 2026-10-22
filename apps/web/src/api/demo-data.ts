import type { BiometricConsent, Checkin, Device, Membership, MembershipPlan, Member } from '../types'

export const demoMembers: Member[] = [
  { id: 'm-001', member_code: 'BG-000124', full_name: 'Andi Pratama', email: 'andi@example.com', phone: '0812 8821 7109', status: 'ACTIVE', plan: 'Annual Pro', valid_until: '2027-03-14', face_enrolled: true, joined_at: '2024-03-14', address: 'Kemang, Jakarta Selatan', emergency_contact_name: 'Rina Pratama', emergency_contact_phone: '0812 9912 1044', notes: 'Lebih nyaman check-in pagi.' },
  { id: 'm-002', member_code: 'BG-000128', full_name: 'Citra Lestari', email: 'citra@example.com', phone: '0813 4490 1120', status: 'ACTIVE', plan: 'Quarterly', valid_until: '2026-08-22', face_enrolled: true, joined_at: '2025-02-22' },
  { id: 'm-003', member_code: 'BG-000137', full_name: 'Dimas Ardiansyah', email: 'dimas@example.com', phone: '0852 9102 3308', status: 'EXPIRED', plan: 'Monthly', valid_until: '2026-07-19', face_enrolled: true, joined_at: '2025-09-19' },
  { id: 'm-004', member_code: 'BG-000141', full_name: 'Maya Kusuma', email: 'maya@example.com', phone: '0817 3408 8112', status: 'SUSPENDED', plan: 'Annual Pro', valid_until: '2026-12-02', face_enrolled: true, joined_at: '2024-12-02', notes: 'Membership ditangguhkan sementara.' },
  { id: 'm-005', member_code: 'BG-000146', full_name: 'Rafi Akbar', email: 'rafi@example.com', phone: '0819 7701 6504', status: 'ACTIVE', plan: 'Monthly', valid_until: '2026-08-18', face_enrolled: false, joined_at: '2026-07-18' },
  { id: 'm-006', member_code: 'BG-000153', full_name: 'Nadia Putri', email: 'nadia@example.com', phone: '0878 6610 0521', status: 'PENDING', plan: 'Daily Pass', valid_until: '2026-07-29', face_enrolled: false, joined_at: '2026-07-27' },
]

export const demoCheckins: Checkin[] = [
  { id: 'c-101', attempted_at: '2026-07-27T09:42:00+07:00', member_name: 'Andi Pratama', member_code: 'BG-000124', device_name: 'Kiosk Lobby', decision: 'ALLOW', reason_code: 'MEMBERSHIP_ACTIVE', confidence: 'Tinggi', membership_status: 'ACTIVE', processing_time_ms: 284, manual_override: false },
  { id: 'c-102', attempted_at: '2026-07-27T09:31:00+07:00', member_name: 'Tidak dikenali', device_name: 'Kiosk Lobby', decision: 'DENY', reason_code: 'IDENTITY_NOT_FOUND', confidence: '-', membership_status: 'UNKNOWN', processing_time_ms: 198, manual_override: false },
  { id: 'c-103', attempted_at: '2026-07-27T09:18:00+07:00', member_name: 'Citra Lestari', member_code: 'BG-000128', device_name: 'Kiosk Studio', decision: 'ALLOW', reason_code: 'MEMBERSHIP_ACTIVE', confidence: 'Tinggi', membership_status: 'ACTIVE', processing_time_ms: 312, manual_override: false },
  { id: 'c-104', attempted_at: '2026-07-27T08:57:00+07:00', member_name: 'Dimas Ardiansyah', member_code: 'BG-000137', device_name: 'Kiosk Lobby', decision: 'DENY', reason_code: 'MEMBERSHIP_EXPIRED', confidence: 'Tinggi', membership_status: 'EXPIRED', processing_time_ms: 241, manual_override: false },
  { id: 'c-105', attempted_at: '2026-07-27T08:40:00+07:00', member_name: 'Maya Kusuma', member_code: 'BG-000141', device_name: 'Meja Resepsionis', decision: 'ALLOW', reason_code: 'MANUAL_OVERRIDE', confidence: '-', membership_status: 'SUSPENDED', processing_time_ms: 0, manual_override: true },
  { id: 'c-106', attempted_at: '2026-07-27T08:22:00+07:00', member_name: 'Rafi Akbar', member_code: 'BG-000146', device_name: 'Kiosk Studio', decision: 'DENY', reason_code: 'LIVENESS_FAILED', confidence: 'Rendah', membership_status: 'ACTIVE', processing_time_ms: 356, manual_override: false },
]

export const demoDevices: Device[] = [
  { id: 'd-001', code: 'KIOSK-001', name: 'Kiosk Lobby', location: 'Pintu utama', online: true, active: true, last_seen_at: '2026-07-27T10:02:14+07:00', version: '2.4.1', capabilities: ['RGB', 'Liveness'], camera_status: 'Siap' },
  { id: 'd-002', code: 'KIOSK-002', name: 'Kiosk Studio', location: 'Lantai 2', online: true, active: true, last_seen_at: '2026-07-27T10:01:52+07:00', version: '2.4.1', capabilities: ['RGB', 'Liveness'], camera_status: 'Siap' },
  { id: 'd-003', code: 'KIOSK-003', name: 'Kiosk VIP', location: 'Area VIP', online: false, active: true, last_seen_at: '2026-07-26T21:14:00+07:00', version: '2.3.8', capabilities: ['RGB', 'Depth'], camera_status: 'Terputus' },
]

export const demoPlans: MembershipPlan[] = [
  { id: 'plan-daily', branch_id: null, name: 'Daily Pass', duration_days: 1, price: '75000', description: 'Akses satu hari', is_active: true },
  { id: 'plan-monthly', branch_id: null, name: 'Monthly', duration_days: 30, price: '450000', description: 'Paket bulanan', is_active: true },
  { id: 'plan-quarterly', branch_id: null, name: 'Quarterly', duration_days: 90, price: '1200000', description: 'Paket tiga bulan', is_active: true },
  { id: 'plan-annual', branch_id: null, name: 'Annual Pro', duration_days: 365, price: '4200000', description: 'Paket tahunan', is_active: true },
]

export function demoMemberships(memberId: string): Membership[] {
  const member = demoMembers.find((item) => item.id === memberId)
  if (!member) return []
  const plan = demoPlans.find((item) => item.name === member.plan) ?? demoPlans[1]
  return [{ id: `membership-${member.id}`, member_id: member.id, plan_id: plan.id, start_at: member.joined_at, end_at: member.valid_until, status: member.status, derived_status: member.status, price_paid: plan.price, payment_reference: null, suspended_at: null, suspension_reason: null }]
}

export function demoConsents(memberId: string): BiometricConsent[] {
  const member = demoMembers.find((item) => item.id === memberId)
  if (!member?.face_enrolled) return []
  return [{ id: `consent-${memberId}`, member_id: memberId, consent_version: 'v2.1', consented_at: member.joined_at, revoked_at: null, capture_purpose: 'Kontrol akses gym', retention_policy: 'Template sampai persetujuan dicabut; gambar mentah tidak disimpan.' }]
}
