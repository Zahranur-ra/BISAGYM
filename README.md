# BISAGYM

BISAGYM adalah sistem web untuk administrasi membership dan kontrol akses gym berbasis pengenalan wajah. Sistem mendukung demo deterministik tanpa kamera/model, mode RGB dengan webcam, serta jalur peningkatan opsional ke kamera RGB-D melalui service perangkat lokal.

> Status implementasi aktual dicatat di [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). Konfigurasi development bukan baseline keamanan produksi.

## Fitur Sasaran

- Login staf dan otorisasi berbasis peran.
- Pengelolaan member, paket, periode membership, dan cabang.
- Persetujuan biometrik, enrollment multi-pose, pencabutan, dan penghapusan.
- Kiosk check-in dengan validasi kualitas, liveness, identitas, membership, perangkat, cabang, dan cooldown.
- Mock recognition untuk demo tanpa perangkat fisik.
- Riwayat akses, audit log, perangkat, dan laporan.
- PostgreSQL/pgvector untuk deployment utama dan SQLite untuk development lokal ringan.

## Arsitektur Singkat

```text
Browser admin/kiosk
        |
        | HTTP(S), /api/v1
        v
React/Vite ----> FastAPI ----> PostgreSQL + pgvector
                    |
                    +--------> adapter face/liveness/depth/mock

Opsional: service RGB-D lokal --request bertanda tangan--> FastAPI
```

Frontend berada di `apps/web`, API di `apps/api`, dan konfigurasi container di `docker`. Lihat [docs/architecture.md](docs/architecture.md) untuk batas keamanan dan alur request.

## Prasyarat

### Docker, direkomendasikan

- Docker Desktop atau Docker Engine dengan Docker Compose v2.
- Port `5173`, `8000`, dan `5432` tersedia.

### Lokal dengan SQLite

- Python 3.13 sesuai metadata backend saat ini.
- Node.js 20 atau lebih baru dan npm.
- GNU Make pada Linux/macOS, atau PowerShell 5.1+ pada Windows.

## Setup Docker

Konfigurasi Compose mempunyai default development sehingga dapat langsung dibangun. Menyalin contoh environment tetap disarankan agar konfigurasi terlihat eksplisit.

```bash
cp .env.example .env
docker compose up --build
```

PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

URL development:

- Web: http://localhost:5173
- API: http://localhost:8000
- OpenAPI: http://localhost:8000/docs
- Liveness: http://localhost:8000/health/live
- Readiness: http://localhost:8000/health/ready

PostgreSQL disimpan pada volume `bisagym_postgres_data`. Container API menjalankan `alembic upgrade head` bila `alembic.ini` tersedia dan `MIGRATE_ON_START=true`. Seed sengaja tidak dijalankan otomatis:

```bash
docker compose exec api python -m app.seed
```

Hentikan stack tanpa menghapus database:

```bash
docker compose down
```

Gunakan `docker compose down -v` hanya jika data development memang boleh dihapus.

## Setup Lokal SQLite

SQLite cocok untuk development satu proses, bukan deployment kiosk produksi atau pengujian pgvector.

Linux/macOS:

```bash
cp .env.example .env
make install
make migrate
make seed
make dev
```

PowerShell:

```powershell
Copy-Item .env.example .env
./tasks.ps1 install
./tasks.ps1 migrate
./tasks.ps1 seed
./tasks.ps1 dev
```

Perintah lokal mengoverride `DATABASE_URL` menjadi `sqlite:///./gym.db`. Override lokasi dengan `LOCAL_DATABASE_URL` bila diperlukan:

```powershell
$env:LOCAL_DATABASE_URL = "sqlite:///./bisagym-local.db"
./tasks.ps1 dev
```

Jika migrasi belum tersedia pada fase implementasi yang sedang berjalan, API development dapat memakai pembuatan tabel development miliknya. Jangan gunakan mekanisme auto-create sebagai pengganti migrasi produksi.

## Akun Demo

Semua akun development berikut menggunakan password `GymDemo123!`, sesuai `DEMO_PASSWORD` pada `.env.example`:

| Peran | Email |
|---|---|
| Super Admin | `superadmin@gym.local` |
| Gym Admin | `admin@gym.local` |
| Resepsionis | `reception@gym.local` |

Cabang demo adalah `GYM-001` / Demo Fitness Center dan perangkat demo adalah `KIOSK-001`. Jangan menjalankan seed demo atau memakai password tersebut di produksi.

## Pengenalan Wajah RGB

Default `FACE_ENGINE=opencv_sface`, `VITE_FACE_ENGINE=opencv_sface`, dan `VITE_DEMO_MODE=false` memakai webcam serta adapter lokal OpenCV YuNet + SFace. YuNet mendeteksi dan menyelaraskan wajah, sedangkan SFace menghasilkan embedding 128 dimensi yang dibandingkan dengan cosine similarity. JPEG diproses sementara di memori dan tidak disimpan.

`./tasks.ps1 install` mengunduh model YuNet dan SFace ke `apps/api/runtime-models` serta memverifikasi SHA-256. Folder model diabaikan Git. Setelah upgrade dari mode mock, lakukan pendaftaran ulang karena profil hash mock lama tidak kompatibel dengan embedding SFace.

Untuk demo tanpa webcam, ubah `FACE_ENGINE=mock` dan `VITE_FACE_ENGINE=mock`, lalu restart API dan web. Skenario deterministik yang tersedia:

| Tag/skenario | Hasil yang diharapkan |
|---|---|
| `member-demo-active` | Identitas cocok, membership aktif, akses diizinkan |
| `member-demo-expired` | Identitas cocok, membership kedaluwarsa, akses ditolak |
| `unknown` | Identitas tidak ditemukan |
| `spoof` | Liveness gagal |

Set `VITE_DEMO_MODE=true` hanya bila membutuhkan data browser mandiri tanpa API. SFace adalah pengenalan wajah RGB, bukan pemindaian 3D dan bukan liveness detection. Default `LIVENESS_MODE=none`; sistem belum aman terhadap foto cetak atau replay video tanpa PAD/depth tambahan.

## Perintah Umum

| Make | PowerShell | Kegunaan |
|---|---|---|
| `make install` | `./tasks.ps1 install` | Instal dependency API dan web |
| `make dev` | `./tasks.ps1 dev` | Jalankan API dan web dengan SQLite |
| `make test` | `./tasks.ps1 test` | Jalankan pytest dan test frontend |
| `make lint` | `./tasks.ps1 lint` | Jalankan Ruff dan ESLint |
| `make format` | `./tasks.ps1 format` | Format Python dan perbaiki lint frontend |
| `make migrate` | `./tasks.ps1 migrate` | Terapkan migrasi lokal |
| `make seed` | `./tasks.ps1 seed` | Isi data demo |
| `make reset-db` | `./tasks.ps1 reset-db` | Hapus dan buat ulang SQLite lokal |
| `make e2e` | `./tasks.ps1 e2e` | Jalankan skrip e2e jika sudah dikonfigurasi |
| `make docker-up` | `./tasks.ps1 docker-up` | Build dan jalankan Compose |
| `make docker-down` | `./tasks.ps1 docker-down` | Hentikan Compose |

`reset-db` bersifat destruktif hanya terhadap file SQLite development di `apps/api`. Perintah `e2e` akan berhenti dengan pesan yang jelas sampai frontend menyediakan skrip `e2e`.

## Troubleshooting

### API tidak sehat

Periksa dependency dan log migrasi:

```bash
docker compose ps
docker compose logs api postgres
```

Pastikan `/health/ready` mengembalikan sukses. Readiness dapat gagal jika PostgreSQL belum siap, kredensial berbeda, atau migrasi gagal.

### Port sudah digunakan

Ubah `WEB_PORT`, `API_PORT`, atau `POSTGRES_PORT` di `.env`, lalu jalankan ulang Compose. URL yang dibuka browser harus mengikuti port baru.

### Frontend tidak dapat menghubungi API

Dalam Docker, proxy Vite diarahkan ke service `api`. Untuk proses lokal, target default adalah `http://localhost:8000`. Periksa `CORS_ORIGINS`, status API, dan tab Network browser. Setelah perubahan environment Vite, restart service web.

### Kamera tidak muncul

- Izinkan permission kamera untuk origin aplikasi.
- Gunakan `localhost` atau HTTPS; browser umumnya menolak kamera pada HTTP non-localhost.
- Tutup aplikasi lain yang mengunci webcam.
- Pastikan hanya satu wajah, pencahayaan cukup, dan lensa tidak tertutup.

### Wajah yang sudah didaftarkan belum dikenali

- Lakukan pendaftaran ulang jika profil dibuat sebelum engine SFace diaktifkan.
- Ambil pose depan, kiri, dan kanan dengan orang yang sama.
- Saat check-in, gunakan kamera, jarak, dan pencahayaan yang serupa.
- Pastikan membership aktif dan tunggu cooldown sebelum mencoba ulang.
- Periksa `/health/model`; engine harus `opencv_sface` dan status `ready`.
- Threshold `0.50` adalah nilai pilot dan harus dikalibrasi untuk kamera serta populasi nyata.

### Login demo gagal

Pastikan email dan `DEMO_PASSWORD` sama dengan nilai saat seed dijalankan. Jika frontend masih dalam demo mandiri, password yang didukung adalah `GymDemo123!`.

### Database PostgreSQL perlu dibuat ulang

Untuk data development yang boleh hilang:

```bash
docker compose down -v
docker compose up --build
docker compose exec api python -m app.seed
```

Jangan lakukan langkah ini terhadap volume produksi. Prosedur backup dan restore ada di [docs/deployment.md](docs/deployment.md).

## Dokumentasi

- [Arsitektur](docs/architecture.md)
- [Kontrak API](docs/api.md)
- [Keamanan biometrik](docs/biometric-security.md)
- [Setup perangkat](docs/device-setup.md)
- [Deployment](docs/deployment.md)
- [Panduan pengguna](docs/user-guide.md)
