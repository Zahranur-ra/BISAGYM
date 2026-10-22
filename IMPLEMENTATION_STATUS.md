# Implementation Status

Terakhir diperbarui: 27 Juli 2026.

Dokumen ini hanya menandai pekerjaan yang dapat diverifikasi dari repository. Item aplikasi tetap tidak dicentang sampai acceptance criteria dan test terkait lulus. `MASTER_BUILD_SPEC_GYM_FACE_RECOGNITION.md` tetap menjadi sumber kebutuhan dan tidak diubah.

## Infrastruktur dan Dokumentasi

- [x] Docker Compose mendefinisikan `web`, `api`, dan PostgreSQL/pgvector.
- [x] Health check dan dependency startup tersedia pada ketiga service.
- [x] Volume PostgreSQL persisten tersedia.
- [x] Entrypoint migrasi API eksplisit; seed tetap perintah terpisah.
- [x] `.env.example` menyediakan default OpenCV SFace, device, retention, dan mode mock opsional.
- [x] `.gitignore` mengecualikan secret, database lokal, capture, model, dan artifact build/test.
- [x] `.dockerignore` mencegah environment, data lokal, model, dan artifact masuk build context.
- [x] Makefile menyediakan perintah developer yang diminta.
- [x] `tasks.ps1` menyediakan padanan perintah utama untuk Windows.
- [x] README setup Docker, SQLite, akun demo, perintah, dan troubleshooting tersedia.
- [x] Dokumentasi arsitektur, API, keamanan biometrik, perangkat, deployment, dan pengguna tersedia.
- [ ] `docker compose up --build` terverifikasi end-to-end dengan aplikasi lengkap.

## Phase 0 - Repository Assessment

- [x] Spesifikasi sumber dibaca lengkap.
- [x] Struktur monorepo root dan tanggung jawab service didokumentasikan.
- [x] Source aplikasi yang dibuat paralel tidak dihapus atau dimodifikasi oleh pekerjaan infrastruktur ini.
- [ ] Seluruh struktur aplikasi final dan dependency lock telah stabil.

## Phase 1 - Foundation

- [x] FastAPI dapat start dan seluruh health endpoint lulus.
- [x] React dapat start dan berkomunikasi dengan API.
- [x] Migrasi dari database kosong lulus.
- [x] Seed menghasilkan tiga akun, cabang, paket, member, dan perangkat demo.
- [x] Login dan role enforcement teruji.

## Phase 2 - Membership Management

- [x] CRUD utama cabang/member/paket/membership teruji melalui API dan kontrak UI.
- [x] Boundary waktu membership aktif dan kedaluwarsa teruji.
- [x] Suspend, reactivate, cancel, pencarian, dashboard, dan audit tersedia serta tercakup pengujian kontrak terkait.

## Phase 3 - Mock Biometric Workflow

- [x] Consent wajib sebelum enrollment teruji.
- [x] Enrollment mock deterministik teruji.
- [x] State machine check-in dan denial reason teruji.
- [x] Skenario member aktif, kedaluwarsa, suspended, unknown, dan spoof teruji.
- [x] Manual override menghasilkan audit log.

## Phase 4 - RGB Webcam

- [x] Permission, preview, capture JPEG, fallback, dan error kamera tercakup kontrak frontend.
- [x] Validasi MIME, ukuran, decode, jumlah wajah, kualitas, dan panduan enrollment teruji.

## Phase 5 - Real Embedding Engine

- [x] Adapter YuNet/SFace berlisensi permisif, alignment, embedding 128 dimensi, dan cosine matching tersedia.
- [x] Hash model, metadata versi, vector storage, branch/model scoping, duplicate review, dan model health tersedia.

## Phase 6 - Liveness

- [ ] Challenge acak, expiry, replay prevention, dan scoring teruji.
- [x] Serangan gambar statis mock ditolak dan dicatat.

## Phase 7 - Optional Depth Service

- [ ] Kontrak RGB-D sinkron dan signed capture tersedia.
- [ ] Mock depth adapter dan pelaporan kapabilitas teruji.
- [ ] Tidak adanya hardware tidak merusak mode RGB.

## Phase 8 - Reporting and Hardening

- [x] Report attendance dan CSV escaping teruji.
- [x] Workflow pencabutan consent dan profil biometrik teruji.
- [ ] Rate limit, secure headers, correlation ID, backup, dan restore diuji.
- [ ] Backend, frontend, integration, dan end-to-end test lulus.
- [ ] Review produksi memastikan tidak ada secret, capture, embedding, atau model terlarang.

## Catatan Terbuka

- Backend: 19 test lulus; frontend: 14 test lulus; Ruff, ESLint, TypeScript, dan build Vite lulus pada 27 Juli 2026.
- Smoke test lokal YuNet/SFace lulus: deteksi 1 wajah, embedding 128 dimensi, enrollment tiga sampel, dan check-in `ALLOW` untuk profil yang sama.
- Frontend belum mendefinisikan skrip browser E2E atau `format`; wrapper menanganinya tanpa mengklaim E2E selesai.
- Dockerfile API menerima `requirements.txt` atau `pyproject.toml` dan saat ini mengikuti requirement Python 3.13 dari backend.
- Threshold SFace development (`0.50`) dan kualitas (`0.70`) belum dikalibrasi untuk kamera, pencahayaan, dan populasi gym nyata.
- SFace tidak menyediakan liveness; `LIVENESS_MODE=none`. PAD production-grade dan RGB-D tetap memerlukan implementasi, hardware, SDK, serta validasi lapangan.
- YuNet menggunakan lisensi MIT dan SFace Apache-2.0; deployment komersial tetap memerlukan review lisensi, provenance model, dan regulasi biometrik.
- Docker Compose belum dapat diuji di host ini karena Docker belum terpasang.
