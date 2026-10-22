# MASTER BUILD SPEC
## Gym Member Identification with Face Recognition and Membership Access Control

> **Purpose of this file**  
> This document is the primary instruction for a CLI coding agent. Read the entire file before editing code. Build a working web application, not merely a UI mockup or architectural proposal.

---

## 1. Agent Operating Instructions

You are the lead full-stack and computer-vision engineer for this repository.

### Mandatory behavior

1. Inspect the existing repository before creating or replacing files.
2. Begin implementation immediately after inspection.
3. Do not stop after producing a plan.
4. Use the defaults in this document when a minor detail is unspecified.
5. Keep the application runnable after every development phase.
6. Do not delete working features unless replacement behavior is already tested.
7. Use clean, maintainable, production-oriented code.
8. Add comments only where the intent is not obvious.
9. Create database migrations, seed data, tests, and documentation.
10. Never commit secrets, biometric samples, model files, or real member data.
11. Use mock adapters when camera hardware or recognition models are unavailable.
12. At the end of each phase:
    - run linting;
    - run automated tests;
    - fix failures;
    - update `IMPLEMENTATION_STATUS.md`;
    - continue to the next phase.
13. Do not claim a feature is complete unless its acceptance criteria pass.
14. When an external model or package has licensing limitations, isolate it behind an adapter and document the limitation.

### Definition of done

The project is done when a new developer can run:

```bash
docker compose up --build
```

and use the system with demo accounts and demo members without needing physical face-recognition hardware.

---

## 2. Product Summary

Build a web-based gym access system in which a member:

1. stands in front of a check-in camera;
2. passes face and liveness validation;
3. is identified from an enrolled face template;
4. has their membership status checked;
5. is either allowed or denied entry;
6. receives a clear status on the kiosk screen;
7. has the attempt recorded in an audit log.

The system must also provide an admin dashboard for managing:

- gym members;
- membership packages;
- membership periods;
- face enrollment;
- check-in history;
- access decisions;
- devices;
- users and roles;
- reports;
- biometric consent and deletion.

---

## 3. Important Scope Clarification

“3D face recognition” must be implemented as two compatible operating modes.

### Mode A — RGB MVP

Use an ordinary webcam for:

- face detection;
- face alignment;
- facial embedding extraction;
- identity matching;
- basic active liveness challenge;
- check-in and membership validation.

This mode must be fully functional in development and demo environments.

### Mode B — RGB-D / Depth Upgrade

Use an optional depth camera through a local capture service for:

- RGB frame capture;
- depth frame capture;
- face-region depth validation;
- flat-photo and screen replay resistance;
- optional point-cloud or face-depth feature processing;
- stronger liveness validation.

A normal browser must not be assumed to have direct access to proprietary depth-camera streams. Implement the depth integration as a separate local device service communicating with the web system.

### Non-goal

Do not market ordinary face landmarks from a 2D webcam as true 3D biometric recognition. Landmark coordinates may be used for pose and liveness, but true depth mode requires depth-capable hardware.

---

## 4. User Roles

### 4.1 Super Admin

Can:

- manage all branches;
- manage all users and roles;
- view all members and check-ins;
- configure recognition settings;
- manage devices;
- view audit logs;
- export reports;
- initiate biometric deletion.

### 4.2 Gym Admin

Can:

- manage members in assigned branch;
- create and extend memberships;
- enroll or re-enroll faces;
- view check-in history;
- view failed access attempts;
- manage gym packages;
- operate the kiosk in fallback mode.

Cannot:

- change global security settings;
- access another branch unless explicitly assigned.

### 4.3 Receptionist

Can:

- search members;
- register new members;
- renew memberships;
- enroll member faces with consent;
- perform manual check-in;
- inspect recent access attempts.

Cannot:

- manage system users;
- change biometric thresholds;
- delete audit logs.

### 4.4 Kiosk Device

A machine identity, not a human account.

Can only:

- request a capture session;
- submit a recognition attempt;
- receive the access decision;
- send heartbeat and health data.

### 4.5 Member

No full dashboard is required for the first release.

Optional later feature:

- view membership validity;
- view personal check-in history;
- request biometric deletion;
- update consent.

---

## 5. Core Business Rules

### Membership states

Use these normalized states:

- `PENDING`
- `ACTIVE`
- `EXPIRED`
- `SUSPENDED`
- `CANCELLED`

### Access is allowed only when all conditions are true

1. Exactly one valid face is detected.
2. Image quality passes.
3. Liveness passes.
4. A member identity match passes the configured threshold.
5. Member status is active.
6. Current time is inside membership start and end time.
7. Member is not suspended.
8. Device and branch are active.
9. The same member is not inside the duplicate check-in cooldown window.

### Access denial reason codes

Use stable machine-readable codes:

- `NO_FACE`
- `MULTIPLE_FACES`
- `LOW_IMAGE_QUALITY`
- `LIVENESS_FAILED`
- `IDENTITY_NOT_FOUND`
- `LOW_MATCH_CONFIDENCE`
- `MEMBER_INACTIVE`
- `MEMBERSHIP_NOT_STARTED`
- `MEMBERSHIP_EXPIRED`
- `MEMBERSHIP_SUSPENDED`
- `DEVICE_INACTIVE`
- `BRANCH_MISMATCH`
- `DUPLICATE_CHECKIN`
- `SYSTEM_ERROR`
- `MANUAL_DENIAL`

### Manual override

A receptionist may manually allow entry only when:

- they are authenticated;
- they select a registered member;
- they enter a reason;
- the override is recorded with operator identity and timestamp.

Manual override must never silently replace a failed biometric result.

---

## 6. Recommended Technical Architecture

Use a monorepo.

### Frontend

- React
- TypeScript
- Vite
- React Router
- TanStack Query
- Tailwind CSS
- Zod
- Browser camera API for RGB capture
- Accessible responsive interface

### Backend API

- Python
- FastAPI
- SQLAlchemy
- Alembic
- Pydantic
- JWT-based staff authentication
- Role-based access control
- Structured logging
- OpenAPI documentation

### Database

- PostgreSQL
- `pgvector` when available for vector search
- fallback vector matching adapter for test and SQLite-like development scenarios is optional, but PostgreSQL remains the primary database

### Computer Vision Service

Keep recognition logic behind interfaces:

- `FaceDetector`
- `FaceAligner`
- `EmbeddingExtractor`
- `LivenessDetector`
- `DepthValidator`
- `FaceMatcher`

Suggested development adapter:

- InsightFace-compatible ONNX pipeline or another replaceable face embedding model;
- ONNX Runtime for inference;
- MediaPipe Face Landmarker for pose, landmarks, and active challenge support;
- cosine similarity for normalized embeddings.

Do not couple membership logic directly to one face-recognition library.

### Optional Device Service

A local Python application installed on the kiosk PC:

- controls RGB-D camera SDK;
- captures synchronized RGB and depth;
- performs local health checks;
- sends signed requests to the backend;
- never exposes the camera directly to the public network.

### Infrastructure

- Docker
- Docker Compose
- Nginx or equivalent reverse proxy for deployment
- local file storage adapter in development
- S3-compatible object storage adapter for production artifacts if raw capture retention is enabled
- Redis is optional for rate limiting, short-lived sessions, or device heartbeat, but the MVP must not require Redis

---

## 7. High-Level Architecture

```text
┌──────────────────────────────┐
│ Admin / Reception Web Client │
└──────────────┬───────────────┘
               │ HTTPS
               ▼
┌──────────────────────────────┐
│ FastAPI Application API      │
│ - Authentication             │
│ - Membership logic           │
│ - Check-in orchestration     │
│ - Reporting                  │
│ - Audit logging              │
└───────┬──────────┬───────────┘
        │          │
        │          └────────────────────────┐
        ▼                                   ▼
┌────────────────────┐             ┌─────────────────────┐
│ PostgreSQL         │             │ Face Engine Adapter │
│ + pgvector         │             │ ONNX / mock engine  │
└────────────────────┘             └─────────────────────┘

┌──────────────────────────────┐
│ Kiosk Web UI                 │
│ RGB webcam or mock capture   │
└──────────────┬───────────────┘
               │ HTTPS
               ▼
         FastAPI Application

Optional true depth mode:

┌──────────────────────────────┐
│ Local RGB-D Device Service   │
│ Camera SDK + signed identity │
└──────────────┬───────────────┘
               │ LAN / HTTPS
               ▼
         FastAPI Application
```

---

## 8. Repository Structure

Create or adapt the repository toward this structure:

```text
/
├─ apps/
│  ├─ web/
│  │  ├─ src/
│  │  │  ├─ api/
│  │  │  ├─ components/
│  │  │  ├─ features/
│  │  │  │  ├─ auth/
│  │  │  │  ├─ dashboard/
│  │  │  │  ├─ members/
│  │  │  │  ├─ memberships/
│  │  │  │  ├─ enrollment/
│  │  │  │  ├─ kiosk/
│  │  │  │  ├─ checkins/
│  │  │  │  ├─ devices/
│  │  │  │  ├─ reports/
│  │  │  │  └─ settings/
│  │  │  ├─ hooks/
│  │  │  ├─ layouts/
│  │  │  ├─ pages/
│  │  │  ├─ routes/
│  │  │  ├─ schemas/
│  │  │  └─ utils/
│  │  └─ tests/
│  │
│  ├─ api/
│  │  ├─ app/
│  │  │  ├─ api/
│  │  │  │  ├─ deps.py
│  │  │  │  └─ routes/
│  │  │  ├─ core/
│  │  │  ├─ db/
│  │  │  ├─ models/
│  │  │  ├─ schemas/
│  │  │  ├─ services/
│  │  │  │  ├─ access_control/
│  │  │  │  ├─ biometrics/
│  │  │  │  ├─ memberships/
│  │  │  │  ├─ audit/
│  │  │  │  └─ reporting/
│  │  │  ├─ repositories/
│  │  │  ├─ security/
│  │  │  ├─ tasks/
│  │  │  └─ main.py
│  │  ├─ migrations/
│  │  └─ tests/
│  │
│  └─ device-service/
│     ├─ app/
│     │  ├─ adapters/
│     │  ├─ capture/
│     │  ├─ security/
│     │  └─ main.py
│     └─ tests/
│
├─ packages/
│  ├─ contracts/
│  └─ shared-config/
│
├─ docs/
│  ├─ architecture.md
│  ├─ api.md
│  ├─ biometric-security.md
│  ├─ device-setup.md
│  ├─ deployment.md
│  └─ user-guide.md
│
├─ scripts/
├─ docker/
├─ .env.example
├─ docker-compose.yml
├─ Makefile
├─ README.md
├─ IMPLEMENTATION_STATUS.md
└─ MASTER_BUILD_SPEC.md
```

---

## 9. Database Design

Use UUID primary keys unless there is a strong existing-project reason not to.

### 9.1 `branches`

Fields:

- `id`
- `code` unique
- `name`
- `address`
- `timezone`
- `is_active`
- `created_at`
- `updated_at`

### 9.2 `users`

Fields:

- `id`
- `branch_id` nullable for super admin
- `full_name`
- `email` unique
- `password_hash`
- `role`
- `is_active`
- `last_login_at`
- `created_at`
- `updated_at`

### 9.3 `members`

Fields:

- `id`
- `branch_id`
- `member_code` unique per branch
- `full_name`
- `email` nullable
- `phone` nullable
- `date_of_birth` nullable
- `gender` nullable
- `address` nullable
- `photo_url` nullable
- `status`
- `emergency_contact_name` nullable
- `emergency_contact_phone` nullable
- `notes` nullable
- `created_at`
- `updated_at`
- `deleted_at` nullable

Do not use biometric data as the member table primary identity.

### 9.4 `membership_plans`

Fields:

- `id`
- `branch_id` nullable for global plan
- `name`
- `duration_days`
- `price`
- `description`
- `is_active`
- `created_at`
- `updated_at`

### 9.5 `memberships`

Fields:

- `id`
- `member_id`
- `plan_id`
- `start_at`
- `end_at`
- `status`
- `price_paid`
- `payment_reference` nullable
- `created_by`
- `created_at`
- `updated_at`
- `suspended_at` nullable
- `suspension_reason` nullable

Rules:

- A member may have historical memberships.
- At most one membership should be considered active at a given instant.
- Membership status must also be derived from time bounds during access decisions; do not rely only on a stale status column.

### 9.6 `biometric_consents`

Fields:

- `id`
- `member_id`
- `consent_version`
- `consented_at`
- `revoked_at` nullable
- `capture_purpose`
- `retention_policy`
- `operator_user_id`
- `signature_reference` nullable
- `created_at`

No enrollment is allowed without active consent.

### 9.7 `face_profiles`

Fields:

- `id`
- `member_id`
- `model_name`
- `model_version`
- `embedding_dimension`
- `embedding`
- `quality_score`
- `enrollment_status`
- `is_primary`
- `created_by`
- `created_at`
- `revoked_at` nullable
- `revocation_reason` nullable

Requirements:

- Prefer multiple high-quality templates per member rather than one fragile sample.
- Encrypt biometric vectors at rest where practical.
- Never expose raw embeddings to the frontend.
- Store model and preprocessing versions to support later migration.

### 9.8 `face_enrollment_samples`

Fields:

- `id`
- `face_profile_id`
- `pose_type`
- `quality_score`
- `liveness_passed`
- `depth_available`
- `depth_quality_score` nullable
- `storage_reference` nullable
- `created_at`
- `purge_after` nullable

Raw image storage is disabled by default.

If enabled:

- use encrypted private storage;
- set a short retention period;
- never place captures in a publicly served folder.

### 9.9 `devices`

Fields:

- `id`
- `branch_id`
- `device_code` unique
- `name`
- `device_type`
- `public_key` or credential reference
- `capabilities` JSON
- `is_active`
- `last_seen_at`
- `created_at`
- `updated_at`

Example capabilities:

```json
{
  "rgb": true,
  "depth": false,
  "active_liveness": true,
  "door_relay": false
}
```

### 9.10 `checkin_attempts`

Fields:

- `id`
- `branch_id`
- `device_id`
- `member_id` nullable
- `attempted_at`
- `decision`
- `reason_code`
- `match_score` nullable
- `match_threshold` nullable
- `quality_score` nullable
- `liveness_score` nullable
- `depth_score` nullable
- `membership_id` nullable
- `processing_time_ms`
- `manual_override`
- `operator_user_id` nullable
- `correlation_id`
- `metadata` JSON
- `created_at`

### 9.11 `access_events`

Fields:

- `id`
- `checkin_attempt_id`
- `event_type`
- `door_action`
- `door_result`
- `occurred_at`
- `metadata` JSON

### 9.12 `audit_logs`

Fields:

- `id`
- `actor_type`
- `actor_id` nullable
- `action`
- `resource_type`
- `resource_id` nullable
- `before_data` JSON nullable
- `after_data` JSON nullable
- `ip_address` nullable
- `user_agent` nullable
- `correlation_id`
- `created_at`

Audit logs must be append-only through the application API.

### 9.13 `system_settings`

Fields:

- `id`
- `scope_type`
- `scope_id` nullable
- `key`
- `value` JSON
- `updated_by`
- `updated_at`

Sensitive settings must not be editable through a plain unrestricted JSON form.

---

## 10. Default Recognition Configuration

Place these in configuration, never hard-code them inside route handlers:

```env
FACE_ENGINE=mock
FACE_MODEL_NAME=replaceable-embedding-model
FACE_MODEL_VERSION=dev
FACE_MATCH_METRIC=cosine
FACE_MATCH_THRESHOLD=0.45
FACE_MIN_QUALITY_SCORE=0.70
LIVENESS_MODE=active_challenge
LIVENESS_MIN_SCORE=0.70
DEPTH_VALIDATION_ENABLED=false
DEPTH_MIN_SCORE=0.70
CHECKIN_COOLDOWN_SECONDS=60
RAW_CAPTURE_STORAGE_ENABLED=false
RAW_CAPTURE_RETENTION_HOURS=24
```

The numeric values above are development defaults, not universal production guarantees.

Provide an admin calibration screen or documented configuration process. Production thresholds must be selected from validation data collected under the actual gym camera, lighting, distance, and member population.

---

## 11. Face Enrollment Flow

### Required enrollment sequence

```text
Open member record
    ↓
Verify active biometric consent
    ↓
Start enrollment session
    ↓
Show positioning instructions
    ↓
Capture front pose
    ↓
Capture slight left pose
    ↓
Capture slight right pose
    ↓
Capture optional up/down pose
    ↓
Run quality checks
    ↓
Run liveness challenge
    ↓
Extract and normalize embeddings
    ↓
Reject outlier samples
    ↓
Create face profile
    ↓
Store templates and model version
    ↓
Write audit log
    ↓
Show enrollment success
```

### Enrollment quality checks

Reject or request recapture when:

- no face;
- more than one face;
- face too small;
- face too close;
- excessive yaw or pitch for the requested pose;
- blur exceeds tolerance;
- underexposure or overexposure;
- major occlusion;
- eyes not visible when required;
- liveness fails;
- depth quality fails when depth mode is mandatory.

### Duplicate identity check

Before finalizing enrollment:

1. compare the new profile against existing active profiles in the same branch;
2. if similarity is suspiciously high, do not auto-merge;
3. show a restricted admin warning;
4. require human review;
5. record the review decision.

---

## 12. Check-In State Machine

Use an explicit state machine, not a long route handler.

States:

```text
IDLE
CAMERA_READY
FACE_DETECTED
QUALITY_VALIDATED
LIVENESS_VALIDATED
EMBEDDING_EXTRACTED
IDENTITY_MATCHED
MEMBERSHIP_VALIDATED
ACCESS_GRANTED
ACCESS_DENIED
ERROR
COOLDOWN
```

### Main flow

```text
IDLE
  ↓
CAMERA_READY
  ↓
FACE_DETECTED
  ↓
QUALITY_VALIDATED
  ↓
LIVENESS_VALIDATED
  ↓
EMBEDDING_EXTRACTED
  ↓
IDENTITY_MATCHED
  ↓
MEMBERSHIP_VALIDATED
  ├─ valid   → ACCESS_GRANTED → COOLDOWN → IDLE
  └─ invalid → ACCESS_DENIED  → COOLDOWN → IDLE
```

Every transition must produce structured telemetry.

---

## 13. Kiosk User Experience

### Default screen

Display:

- gym logo and branch;
- camera preview;
- “Please face the camera” instruction;
- privacy notice;
- no admin navigation;
- device connection status.

### Capture feedback

Provide clear instructions:

- move closer;
- move farther;
- look straight;
- only one person;
- improve lighting;
- blink;
- turn slightly left;
- turn slightly right.

### Success screen

Display for a short configurable duration:

- green success state;
- member first name or masked full name;
- membership valid-until date;
- check-in timestamp;
- “Access granted.”

Do not expose private member details to people standing nearby.

### Denial screen

Display a neutral message:

- membership expired;
- membership inactive;
- face not recognized;
- liveness failed;
- ask receptionist for assistance.

Do not display similarity scores on the public kiosk.

### Accessibility

- large text;
- high contrast;
- keyboard fallback;
- visual and optional audio feedback;
- do not rely on color alone;
- Indonesian language by default;
- prepare translation structure for English.

---

## 14. Admin Web Pages

### Authentication

- login;
- logout;
- change password;
- session expiry;
- role-aware navigation.

### Dashboard

Cards:

- active members;
- memberships expiring in 7 days;
- today’s successful check-ins;
- today’s denied attempts;
- devices online;
- enrollment failures.

Charts are optional. Prioritize useful tables and counts.

### Members

- list;
- search;
- filters;
- create;
- edit;
- soft delete;
- profile detail;
- membership history;
- consent history;
- enrollment status;
- check-in history.

### Memberships

- create membership;
- renew;
- extend;
- suspend;
- reactivate;
- cancel;
- view expiring memberships.

### Face Enrollment

- select member;
- verify consent;
- camera readiness;
- guided multi-pose capture;
- quality result;
- liveness result;
- save or retry;
- revoke and re-enroll.

### Check-In History

Columns:

- date and time;
- member;
- device;
- result;
- reason;
- confidence category;
- membership status;
- processing time;
- manual override.

Do not show exact biometric vectors.

### Devices

- register kiosk;
- activate/deactivate;
- rotate credentials;
- display capabilities;
- heartbeat;
- last seen;
- software version;
- camera status.

### Reports

- daily attendance;
- member attendance;
- denied access reasons;
- expiring memberships;
- device health;
- manual overrides;
- CSV export.

### Settings

- cooldown;
- capture retention;
- recognition threshold;
- liveness requirement;
- depth requirement;
- privacy notice version.

Threshold editing must require a privileged role and create an audit record.

---

## 15. API Contract

Use `/api/v1`.

### Authentication

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
```

### Members

```text
GET    /api/v1/members
POST   /api/v1/members
GET    /api/v1/members/{member_id}
PATCH  /api/v1/members/{member_id}
DELETE /api/v1/members/{member_id}
GET    /api/v1/members/{member_id}/memberships
GET    /api/v1/members/{member_id}/checkins
```

### Membership plans and memberships

```text
GET    /api/v1/membership-plans
POST   /api/v1/membership-plans
PATCH  /api/v1/membership-plans/{plan_id}

POST   /api/v1/members/{member_id}/memberships
PATCH  /api/v1/memberships/{membership_id}
POST   /api/v1/memberships/{membership_id}/suspend
POST   /api/v1/memberships/{membership_id}/reactivate
POST   /api/v1/memberships/{membership_id}/cancel
```

### Consent

```text
GET    /api/v1/members/{member_id}/biometric-consents
POST   /api/v1/members/{member_id}/biometric-consents
POST   /api/v1/biometric-consents/{consent_id}/revoke
```

### Enrollment

```text
POST   /api/v1/enrollments/sessions
POST   /api/v1/enrollments/sessions/{session_id}/samples
POST   /api/v1/enrollments/sessions/{session_id}/complete
DELETE /api/v1/members/{member_id}/face-profile
GET    /api/v1/members/{member_id}/face-profile/status
```

The sample endpoint may accept multipart images in RGB mode. In depth mode, use a signed device payload referencing synchronized capture data.

### Kiosk

```text
POST   /api/v1/kiosk/sessions
POST   /api/v1/kiosk/checkin
GET    /api/v1/kiosk/checkin/{attempt_id}
POST   /api/v1/kiosk/heartbeat
```

### Check-ins and reports

```text
GET    /api/v1/checkins
GET    /api/v1/checkins/{attempt_id}
POST   /api/v1/checkins/{attempt_id}/manual-override

GET    /api/v1/reports/attendance
GET    /api/v1/reports/denials
GET    /api/v1/reports/expiring-memberships
GET    /api/v1/reports/device-health
```

### Devices

```text
GET    /api/v1/devices
POST   /api/v1/devices
GET    /api/v1/devices/{device_id}
PATCH  /api/v1/devices/{device_id}
POST   /api/v1/devices/{device_id}/rotate-credential
```

### Health

```text
GET    /health/live
GET    /health/ready
GET    /health/model
```

---

## 16. Example Check-In Response

### Allowed

```json
{
  "attempt_id": "uuid",
  "decision": "ALLOW",
  "reason_code": "MEMBERSHIP_ACTIVE",
  "member": {
    "id": "uuid",
    "display_name": "Andi"
  },
  "membership": {
    "status": "ACTIVE",
    "valid_until": "2026-12-31T23:59:59+07:00"
  },
  "processing_time_ms": 284,
  "cooldown_seconds": 3
}
```

### Denied

```json
{
  "attempt_id": "uuid",
  "decision": "DENY",
  "reason_code": "MEMBERSHIP_EXPIRED",
  "public_message": "Membership Anda telah berakhir. Silakan hubungi resepsionis.",
  "processing_time_ms": 241,
  "cooldown_seconds": 3
}
```

The kiosk response must not include raw embeddings or internal security detail.

---

## 17. Recognition Pipeline Interface

Implement a service contract similar to:

```python
class RecognitionResult:
    detected_face_count: int
    quality_score: float | None
    liveness_score: float | None
    depth_score: float | None
    embedding: list[float] | None
    matched_profile_id: str | None
    match_score: float | None
    errors: list[str]
```

```python
class FaceRecognitionEngine(Protocol):
    def analyze_enrollment_sample(self, image_bytes: bytes) -> RecognitionResult:
        ...

    def create_profile(self, samples: list[bytes]) -> list[float]:
        ...

    def identify(self, image_bytes: bytes, branch_id: str) -> RecognitionResult:
        ...
```

For RGB-D mode, define a separate payload type containing:

- RGB timestamp;
- depth timestamp;
- RGB frame reference;
- depth frame reference;
- calibration identifier;
- camera serial;
- capture signature.

### Mock engine

The mock engine is mandatory.

It must support deterministic demo behavior, such as:

- sample tagged `member-demo-active` → recognized active member;
- sample tagged `member-demo-expired` → recognized expired member;
- sample tagged `unknown` → identity not found;
- sample tagged `spoof` → liveness failure.

Do not hide mock mode. Display a visible “DEMO MODE” badge in development.

---

## 18. Liveness and Anti-Spoofing

At minimum, RGB mode must support an active challenge:

1. randomize one or two instructions;
2. ask the user to blink or turn their head;
3. measure landmark movement over a short sequence;
4. reject static images;
5. expire the challenge quickly;
6. prevent replay of a previous challenge token.

Depth mode should additionally validate that the face region has plausible depth variation.

Do not rely on blink detection alone as a production-grade anti-spoofing guarantee.

Create the liveness module behind an interface so a stronger licensed PAD model can replace it.

---

## 19. Security Requirements

### Transport

- HTTPS in production.
- Reject insecure production configuration.
- Use secure headers.
- Configure CORS explicitly.
- Do not use wildcard CORS with credentials.

### Staff authentication

- strong password hashing;
- short-lived access token;
- refresh-token rotation or secure server session;
- role-based authorization at the backend;
- rate-limit login;
- record security-relevant events.

### Device authentication

Use one of:

- asymmetric device signing;
- mTLS;
- rotated device secret with HMAC.

For the first implementation, a signed device token is acceptable, but design the adapter so stronger authentication can replace it.

### Biometric protection

- treat embeddings as sensitive personal data;
- never log embeddings;
- never return embeddings to browser clients;
- encrypt backups;
- separate operational access from biometric administration;
- revoke templates when consent is withdrawn;
- support deletion workflow;
- minimize raw image retention;
- document retention rules.

### API controls

- validate MIME type and image size;
- reject malformed images;
- set upload size limit;
- rate-limit kiosk attempts;
- use correlation IDs;
- protect against duplicate submissions;
- use parameterized queries through ORM;
- sanitize exports;
- prevent formula injection in CSV exports.

### Audit

Log:

- login success and failure;
- member creation and modification;
- membership changes;
- consent changes;
- enrollment and revocation;
- threshold changes;
- device changes;
- manual overrides;
- report exports;
- biometric deletion.

---

## 20. Privacy and Consent Requirements

Before enrollment, display a clear consent statement explaining:

- what face data is collected;
- the purpose;
- whether raw images are retained;
- how long data is retained;
- who can access it;
- how the member can revoke consent;
- the non-biometric fallback entry procedure.

The application must support:

- refusal without secretly enrolling;
- consent versioning;
- consent revocation;
- biometric profile deletion;
- manual or card-based fallback;
- export of member-related records when required by policy.

Do not require the admin to manually edit the database to honor deletion.

---

## 21. Error Handling

Use a consistent API error format:

```json
{
  "error": {
    "code": "MEMBERSHIP_EXPIRED",
    "message": "Membership is not active.",
    "details": {},
    "correlation_id": "uuid"
  }
}
```

Frontend requirements:

- do not show raw stack traces;
- provide retry where appropriate;
- preserve form input on recoverable errors;
- show camera permission guidance;
- show offline device state;
- log client correlation ID.

Backend requirements:

- map known business errors to 4xx responses;
- reserve 500 for unexpected failures;
- record unexpected exceptions with correlation ID;
- never include secrets or embeddings in error logs.

---

## 22. Testing Strategy

### Backend unit tests

Test:

- membership validity at exact start time;
- membership expiry boundary;
- suspended membership;
- cancelled membership;
- duplicate check-in cooldown;
- wrong branch;
- inactive device;
- low confidence match;
- liveness failure;
- manual override authorization;
- consent required for enrollment;
- biometric revocation;
- role permissions.

### Integration tests

Test:

- create member → create membership → consent → enrollment → check-in allowed;
- expired membership → face recognized → access denied;
- unknown face → access denied;
- mock spoof → liveness denied;
- successful manual override;
- audit log created;
- report filtering;
- CSV export escaping;
- migration from empty database.

### Frontend tests

Test:

- login;
- role navigation;
- member form validation;
- enrollment stepper;
- camera error state;
- kiosk success state;
- kiosk denial state;
- no sensitive fields rendered;
- accessibility labels.

### End-to-end tests

Use browser automation for:

1. admin login;
2. create demo member;
3. assign active membership;
4. record consent;
5. complete mock enrollment;
6. open kiosk;
7. run mock active-member scan;
8. confirm allowed check-in;
9. expire membership;
10. repeat scan;
11. confirm denial.

### Performance tests

Measure:

- recognition API latency;
- member search latency;
- vector matching time;
- check-in throughput;
- database query count;
- concurrent kiosk requests.

---

## 23. Seed Data

Create development seed data:

### Users

- `superadmin@gym.local`
- `admin@gym.local`
- `reception@gym.local`

Use a documented development-only password from `.env.example`. Force production deployments to change it.

### Branch

- Code: `GYM-001`
- Name: `Demo Fitness Center`
- Timezone: `Asia/Jakarta`

### Plans

- Daily Pass
- Monthly
- Quarterly
- Annual

### Members

1. Demo Active Member
2. Demo Expired Member
3. Demo Suspended Member
4. Demo Member Without Face Enrollment

### Device

- Code: `KIOSK-001`
- Capability: RGB true, depth false, demo mode true

---

## 24. Docker Compose Services

The default compose file should contain:

```text
web
api
postgres
```

Optional profiles:

```text
device-service
nginx
```

Requirements:

- health checks;
- persistent PostgreSQL volume;
- startup dependency handling;
- `.env.example`;
- no hard-coded production secrets;
- automatic migrations through an explicit entrypoint;
- seed command separated from normal production startup.

---

## 25. Developer Commands

Provide a `Makefile` or equivalent commands:

```bash
make install
make dev
make test
make lint
make format
make migrate
make seed
make reset-db
make e2e
make docker-up
make docker-down
```

Document Windows-compatible alternatives in `README.md` when shell commands differ.

---

## 26. Environment Configuration

Create `.env.example` containing at least:

```env
APP_ENV=development
APP_NAME=Gym Face Access
APP_TIMEZONE=Asia/Jakarta
SECRET_KEY=change-me
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7

DATABASE_URL=postgresql+psycopg://gym:gym@postgres:5432/gym
CORS_ORIGINS=http://localhost:5173

FACE_ENGINE=mock
FACE_MODEL_PATH=
FACE_MATCH_THRESHOLD=0.45
FACE_MIN_QUALITY_SCORE=0.70

LIVENESS_MODE=active_challenge
LIVENESS_MIN_SCORE=0.70

DEPTH_VALIDATION_ENABLED=false
DEVICE_AUTH_MODE=shared_secret
DEVICE_SHARED_SECRET=change-me

CHECKIN_COOLDOWN_SECONDS=60
RAW_CAPTURE_STORAGE_ENABLED=false
RAW_CAPTURE_RETENTION_HOURS=24
```

Validate configuration on application startup.

---

## 27. Implementation Phases

### Phase 0 — Repository assessment

Tasks:

- inspect files;
- detect existing stack;
- preserve useful code;
- create `IMPLEMENTATION_STATUS.md`;
- record chosen adaptations.

Acceptance:

- project structure is clear;
- no working code is destroyed.

### Phase 1 — Foundation

Tasks:

- Docker Compose;
- FastAPI app;
- React app;
- PostgreSQL;
- migrations;
- auth;
- roles;
- health endpoints;
- seed data.

Acceptance:

- system starts;
- staff can log in;
- role permissions work.

### Phase 2 — Membership management

Tasks:

- branches;
- members;
- plans;
- memberships;
- dashboard;
- search and filters;
- expiry calculation;
- audit logs.

Acceptance:

- active, expired, suspended, and cancelled states work correctly.

### Phase 3 — Mock biometric workflow

Tasks:

- consent;
- enrollment sessions;
- mock face engine;
- check-in state machine;
- kiosk UI;
- check-in history;
- denial reasons.

Acceptance:

- complete demo flow works without camera hardware.

### Phase 4 — RGB webcam capture

Tasks:

- camera permission;
- preview;
- frame capture;
- image quality validation;
- backend multipart endpoint;
- enrollment guidance.

Acceptance:

- webcam capture works in supported browsers over secure context or localhost.

### Phase 5 — Real embedding engine

Tasks:

- ONNX adapter;
- face detection;
- alignment;
- normalized embedding;
- vector storage;
- cosine matching;
- duplicate profile review;
- model health endpoint.

Acceptance:

- test dataset can be enrolled and matched;
- threshold is configurable;
- model metadata is stored.

### Phase 6 — Liveness

Tasks:

- randomized challenge;
- landmark tracking;
- signed challenge session;
- replay prevention;
- liveness scoring;
- kiosk instructions.

Acceptance:

- static image mock attack is rejected;
- challenge expiry works;
- all attempts are logged.

### Phase 7 — Optional depth service

Tasks:

- device service;
- camera adapter interface;
- synchronized RGB-depth capture contract;
- mock depth adapter;
- depth scoring;
- health and capability reporting.

Acceptance:

- depth mode can run with a mock adapter;
- absence of hardware does not break RGB mode.

### Phase 8 — Reporting and hardening

Tasks:

- reports;
- exports;
- privacy deletion workflow;
- rate limiting;
- secure headers;
- deployment docs;
- backups;
- recovery documentation;
- end-to-end tests.

Acceptance:

- all automated tests pass;
- no secrets in repository;
- security checklist complete.

---

## 28. Production Model Licensing Gate

Before enabling a pretrained recognition model in a commercial gym:

1. verify the code license;
2. verify the pretrained weights license separately;
3. verify commercial-use permission;
4. record model source and version;
5. isolate the model behind the adapter;
6. do not redistribute weights when prohibited.

The implementation must remain usable with:

- a mock engine;
- a properly licensed commercial model;
- a separately supplied internal model.

---

## 29. Deployment Guidance

### Small single-branch deployment

Suggested topology:

- kiosk PC on local network;
- application server or capable mini-PC;
- PostgreSQL;
- local reverse proxy;
- daily encrypted backup;
- optional internet access for remote administration.

### Reliability behavior

When backend is unreachable:

- kiosk must show “System unavailable”;
- do not silently grant access;
- allow receptionist fallback;
- queue only non-sensitive health telemetry;
- do not store unencrypted biometric captures in a browser cache.

### Door relay

Door unlock integration is optional.

Create an interface:

```python
class DoorController(Protocol):
    def unlock(self, duration_ms: int) -> DoorActionResult:
        ...
```

Default implementation:

- `MockDoorController`

Never trigger a physical relay directly from untrusted browser JavaScript.

---

## 30. Observability

Structured logs must include:

- timestamp;
- level;
- service;
- correlation ID;
- device ID when relevant;
- branch ID;
- operation;
- result;
- processing duration.

Metrics should include:

- check-in attempts;
- allowed vs denied;
- denial reason count;
- recognition latency;
- database latency;
- liveness failures;
- model errors;
- device heartbeat age;
- manual overrides.

Never include:

- raw embeddings;
- raw images;
- access tokens;
- passwords;
- full device secrets.

---

## 31. UI Design Direction

Use a clean fitness-center interface:

- dark or light neutral surfaces;
- one strong accent color;
- large status display for kiosk;
- simple admin tables;
- responsive desktop-first dashboard;
- mobile-friendly member search;
- consistent badges for membership status.

Do not overuse animations. Kiosk feedback should be immediate and readable.

Indonesian labels:

- Dashboard
- Data Member
- Paket Membership
- Membership
- Pendaftaran Wajah
- Check-in
- Riwayat Akses
- Perangkat
- Laporan
- Pengaturan
- Keluar

---

## 32. Required Documentation

Create:

### `README.md`

Include:

- project summary;
- features;
- architecture;
- prerequisites;
- setup;
- demo accounts;
- common commands;
- mock recognition instructions;
- troubleshooting.

### `docs/architecture.md`

Include:

- component diagram;
- request flows;
- adapters;
- security boundaries;
- RGB versus depth modes.

### `docs/biometric-security.md`

Include:

- threat model;
- spoof risks;
- liveness limitations;
- data retention;
- deletion;
- model licensing;
- threshold calibration.

### `docs/device-setup.md`

Include:

- kiosk browser setup;
- webcam permission;
- device registration;
- optional RGB-D service;
- health check.

### `docs/deployment.md`

Include:

- production environment variables;
- TLS;
- database backup;
- migration;
- log retention;
- restore procedure.

### `docs/user-guide.md`

Include:

- member registration;
- consent;
- face enrollment;
- membership renewal;
- manual check-in;
- troubleshooting failed scans.

---

## 33. Final Acceptance Checklist

### Functional

- [ ] Staff login works.
- [ ] Roles are enforced server-side.
- [ ] Member CRUD works.
- [ ] Membership plan CRUD works.
- [ ] Membership validity is calculated correctly.
- [ ] Consent is required before enrollment.
- [ ] Mock enrollment works.
- [ ] Mock kiosk check-in works.
- [ ] Active member is allowed.
- [ ] Expired member is denied.
- [ ] Suspended member is denied.
- [ ] Unknown face is denied.
- [ ] Liveness failure is denied.
- [ ] Manual override is audited.
- [ ] Check-in reports work.
- [ ] Biometric revocation works.
- [ ] Deletion workflow is documented.

### Technical

- [ ] Docker Compose starts the project.
- [ ] Database migrations run.
- [ ] Seed data works.
- [ ] Backend tests pass.
- [ ] Frontend tests pass.
- [ ] End-to-end test passes.
- [ ] Linting passes.
- [ ] Type checks pass.
- [ ] API documentation loads.
- [ ] Health endpoints work.
- [ ] No secret is committed.
- [ ] No raw embedding appears in logs or frontend payloads.

### Security and privacy

- [ ] HTTPS documented for production.
- [ ] Upload limits configured.
- [ ] Authentication rate limiting exists.
- [ ] Device authentication exists.
- [ ] Audit logs are append-only in application behavior.
- [ ] Raw captures are disabled by default.
- [ ] Consent version is recorded.
- [ ] Revocation disables the face profile.
- [ ] A non-biometric fallback exists.
- [ ] Model licensing is documented.

---

## 34. CLI Agent Completion Report

When implementation is complete, output a concise report containing:

1. what was built;
2. repository structure;
3. commands to run;
4. demo login credentials;
5. implemented phases;
6. tests executed and results;
7. remaining hardware-dependent work;
8. model-license caveats;
9. security limitations that still require production configuration.

Do not end with only “done.” Provide verifiable commands and paths.

---

## 35. First Command to the Coding Agent

After placing this file in the repository root, use this instruction:

```text
Read MASTER_BUILD_SPEC.md completely. Inspect the current repository, then implement the application phase by phase. Start coding immediately and continue through the acceptance checklist. Preserve useful existing code, use mock biometric and mock door adapters so the full workflow is runnable without hardware, run tests after every phase, and update IMPLEMENTATION_STATUS.md as you work. Do not stop after planning.
```
