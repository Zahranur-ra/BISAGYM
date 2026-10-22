# Kontrak API

Dokumen ini merangkum kontrak target dari master spec. Ketersediaan aktual harus diperiksa pada OpenAPI runtime di `/docs` dan [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md); daftar di sini bukan klaim bahwa semua endpoint sudah selesai.

## Konvensi

- Base path: `/api/v1`.
- Format utama: JSON UTF-8; sample RGB dapat menggunakan `multipart/form-data`.
- ID resource: UUID kecuali dinyatakan lain oleh implementasi.
- Waktu: ISO 8601 dengan timezone.
- Auth staf: `Authorization: Bearer <access-token>`.
- Auth device: credential/signature device, bukan token staf atau secret global browser.
- Request tracing: client dapat mengirim correlation ID yang valid; API harus menghasilkan satu jika tidak ada.
- Pagination/filter harus stabil dan didokumentasikan oleh OpenAPI implementasi.
- Embedding, secret, stack trace, dan detail anti-spoof internal tidak boleh ada dalam respons browser.

## Error

Error bisnis menggunakan HTTP 4xx dan bentuk konsisten:

```json
{
  "error": {
    "code": "MEMBERSHIP_EXPIRED",
    "message": "Membership is not active.",
    "details": {},
    "correlation_id": "3a53f046-6a8b-47de-9d9b-6e31d984bd6b"
  }
}
```

`500` hanya untuk kegagalan tak terduga. Pesan publik tidak boleh membocorkan query, filesystem, konfigurasi, key, score keamanan detail, atau traceback.

## Authentication

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/v1/auth/login` | Login staf; wajib rate limit |
| POST | `/api/v1/auth/refresh` | Rotasi/perpanjangan session |
| POST | `/api/v1/auth/logout` | Cabut session/refresh token |
| GET | `/api/v1/auth/me` | Profil dan role user aktif |

Route admin harus menegakkan role di backend dan membatasi cabang. Kiosk memakai identitas mesin pada route kiosk.

## Members

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/v1/members` | Daftar, pencarian, filter, pagination |
| POST | `/api/v1/members` | Buat member |
| GET | `/api/v1/members/{member_id}` | Detail member |
| PATCH | `/api/v1/members/{member_id}` | Perbarui member |
| DELETE | `/api/v1/members/{member_id}` | Soft delete member |
| GET | `/api/v1/members/{member_id}/memberships` | Riwayat membership |
| GET | `/api/v1/members/{member_id}/checkins` | Riwayat check-in member |

Biometrik bukan primary identity member dan tidak disertakan pada payload member biasa.

## Paket dan Membership

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/v1/membership-plans` | Daftar paket |
| POST | `/api/v1/membership-plans` | Buat paket |
| PATCH | `/api/v1/membership-plans/{plan_id}` | Ubah paket |
| POST | `/api/v1/members/{member_id}/memberships` | Buat/renew membership |
| PATCH | `/api/v1/memberships/{membership_id}` | Ubah membership yang diizinkan |
| POST | `/api/v1/memberships/{membership_id}/suspend` | Suspend dengan alasan |
| POST | `/api/v1/memberships/{membership_id}/reactivate` | Aktifkan kembali |
| POST | `/api/v1/memberships/{membership_id}/cancel` | Batalkan |

Status terstandardisasi: `PENDING`, `ACTIVE`, `EXPIRED`, `SUSPENDED`, `CANCELLED`. Keputusan akses harus menghitung batas `start_at`/`end_at`, bukan hanya membaca status tersimpan.

## Consent dan Enrollment

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/v1/members/{member_id}/biometric-consents` | Riwayat consent |
| POST | `/api/v1/members/{member_id}/biometric-consents` | Catat consent terversi |
| POST | `/api/v1/biometric-consents/{consent_id}/revoke` | Cabut consent |
| POST | `/api/v1/enrollments/sessions` | Mulai session enrollment |
| POST | `/api/v1/enrollments/sessions/{session_id}/samples` | Kirim sample pose |
| POST | `/api/v1/enrollments/sessions/{session_id}/complete` | Validasi dan finalisasi profil |
| DELETE | `/api/v1/members/{member_id}/face-profile` | Cabut/hapus profil sesuai workflow |
| GET | `/api/v1/members/{member_id}/face-profile/status` | Status enrollment tanpa embedding |

Enrollment wajib gagal bila consent aktif tidak ada. Endpoint sample wajib memvalidasi ukuran, MIME, decoding gambar, session expiry, pose, dan replay. RGB-D memakai payload device bertanda tangan yang mereferensikan frame sinkron, bukan multipart browser biasa.

## Kiosk

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/v1/kiosk/sessions` | Buat session/challenge capture |
| POST | `/api/v1/kiosk/checkin` | Kirim recognition attempt |
| GET | `/api/v1/kiosk/checkin/{attempt_id}` | Ambil hasil attempt |
| POST | `/api/v1/kiosk/heartbeat` | Health/capability device |

Contoh respons diizinkan:

```json
{
  "attempt_id": "9c267c9c-2519-45be-aa08-10116becc89f",
  "decision": "ALLOW",
  "reason_code": "MEMBERSHIP_ACTIVE",
  "member": { "id": "uuid", "display_name": "Andi" },
  "membership": {
    "status": "ACTIVE",
    "valid_until": "2026-12-31T23:59:59+07:00"
  },
  "processing_time_ms": 284,
  "cooldown_seconds": 3
}
```

Contoh respons ditolak:

```json
{
  "attempt_id": "9c267c9c-2519-45be-aa08-10116becc89f",
  "decision": "DENY",
  "reason_code": "MEMBERSHIP_EXPIRED",
  "public_message": "Membership Anda telah berakhir. Silakan hubungi resepsionis.",
  "processing_time_ms": 241,
  "cooldown_seconds": 3
}
```

Reason code penolakan yang stabil:

`NO_FACE`, `MULTIPLE_FACES`, `LOW_IMAGE_QUALITY`, `LIVENESS_FAILED`, `IDENTITY_NOT_FOUND`, `LOW_MATCH_CONFIDENCE`, `MEMBER_INACTIVE`, `MEMBERSHIP_NOT_STARTED`, `MEMBERSHIP_EXPIRED`, `MEMBERSHIP_SUSPENDED`, `DEVICE_INACTIVE`, `BRANCH_MISMATCH`, `DUPLICATE_CHECKIN`, `SYSTEM_ERROR`, `MANUAL_DENIAL`.

Kiosk tidak menerima raw embedding, exact similarity score, kontak member, atau detail internal keamanan.

## Check-in dan Laporan

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/v1/checkins` | Daftar/filter attempt |
| GET | `/api/v1/checkins/{attempt_id}` | Detail terotorisasi |
| POST | `/api/v1/checkins/{attempt_id}/manual-override` | Override dengan member, operator, dan alasan |
| GET | `/api/v1/reports/attendance` | Kehadiran |
| GET | `/api/v1/reports/denials` | Alasan penolakan |
| GET | `/api/v1/reports/expiring-memberships` | Membership akan habis |
| GET | `/api/v1/reports/device-health` | Kesehatan device |

Manual override tidak boleh mengubah atau menyembunyikan hasil biometrik asal. Export CSV wajib mencegah formula injection pada nilai yang diawali `=`, `+`, `-`, atau `@`.

## Devices

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/v1/devices` | Daftar device sesuai scope |
| POST | `/api/v1/devices` | Daftarkan device |
| GET | `/api/v1/devices/{device_id}` | Detail capability/heartbeat |
| PATCH | `/api/v1/devices/{device_id}` | Aktif/nonaktif dan metadata |
| POST | `/api/v1/devices/{device_id}/rotate-credential` | Rotasi credential tanpa mengembalikan secret lama |

## Health

Health endpoint tidak memakai prefix `/api/v1`:

| Method | Path | Makna |
|---|---|---|
| GET | `/health/live` | Proses hidup; tidak menjamin dependency siap |
| GET | `/health/ready` | API dan dependency wajib siap menerima traffic |
| GET | `/health/model` | Status adapter/model tanpa path atau secret sensitif |

Compose memakai `/health/ready` untuk dependency `web`. Jangan memasukkan detail koneksi database atau lokasi model ke respons publik.
