export type Role = 'SUPER_ADMIN' | 'GYM_ADMIN' | 'RECEPTIONIST'
export type MemberStatus = 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED'

export interface User {
  id: string
  branch_id?: string | null
  full_name: string
  email: string
  role: Role
  branch_name: string
  is_active?: boolean
  last_login_at?: string | null
}

export interface Member {
  id: string
  member_code: string
  full_name: string
  email: string
  phone: string
  status: MemberStatus
  plan: string
  valid_until: string
  face_enrolled: boolean
  joined_at: string
  address?: string
  emergency_contact_name?: string
  emergency_contact_phone?: string
  notes?: string
}

export interface Checkin {
  id: string
  attempted_at: string
  member_name: string
  member_code?: string
  device_name: string
  decision: 'ALLOW' | 'DENY'
  reason_code: string
  confidence: 'Tinggi' | 'Sedang' | 'Rendah' | '-'
  membership_status: MemberStatus | 'UNKNOWN'
  processing_time_ms: number
  manual_override: boolean
}

export interface Device {
  id: string
  code: string
  name: string
  location: string
  online: boolean
  active: boolean
  last_seen_at: string
  version: string
  capabilities: string[]
  camera_status: 'Siap' | 'Terputus'
}

export interface MembershipPlan {
  id: string
  branch_id: string | null
  name: string
  duration_days: number
  price: string
  description: string | null
  is_active: boolean
}

export interface Membership {
  id: string
  member_id: string
  plan_id: string
  start_at: string
  end_at: string
  status: MemberStatus
  derived_status: MemberStatus
  price_paid: string
  payment_reference: string | null
  suspended_at: string | null
  suspension_reason: string | null
}

export interface BiometricConsent {
  id: string
  member_id: string
  consent_version: string
  consented_at: string
  revoked_at: string | null
  capture_purpose: string
  retention_policy: string
}

export interface FaceStatus {
  member_id: string
  enrolled: boolean
  active_profile_count: number
  last_enrolled_at: string | null
}

export interface DashboardSummary {
  active_members: number
  today_allowed_checkins: number
  today_denied_attempts: number
  devices_online: number
}

export interface Branch {
  id: string
  code: string
  name: string
  address: string | null
  timezone: string
  is_active: boolean
}

export interface SystemSetting {
  key: string
  value: boolean | number | string
  scope_type: string
}

export interface ApiErrorShape {
  error?: { code?: string; message?: string; correlation_id?: string }
  detail?: string
}
