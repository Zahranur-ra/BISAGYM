# Deployment

## Cakupan

`docker-compose.yml` root ditujukan untuk development/integrasi: frontend menjalankan Vite dev server dan default secret bersifat tidak aman. Produksi memerlukan image immutable, static web server/reverse proxy, TLS, secret manager, backup terenkripsi, resource limit, dan observability yang dikelola.

Topologi single-branch yang disarankan:

```text
Kiosk LAN --> HTTPS reverse proxy --> Web/API --> PostgreSQL private
                      |                  |
                      |                  +--> private storage/model adapter
                      +--> access logs
```

Jangan mengekspos PostgreSQL, object storage private, model service, atau RGB-D camera stream ke internet.

## Environment Produksi

Mulai dari `.env.example`, tetapi jangan menyimpan file produksi di Git. Nilai minimum yang wajib ditinjau:

| Variable | Panduan produksi |
|---|---|
| `APP_ENV` | `production` |
| `SECRET_KEY` | Random minimal 32 karakter, dari secret manager |
| `DATABASE_URL` | User DB least-privilege, host private, TLS DB bila remote |
| `AUTO_CREATE_DB` | `false`; schema produksi hanya melalui migrasi yang direview |
| `POSTGRES_PASSWORD` | Unik dan tidak sama dengan default Compose |
| `CORS_ORIGINS` | Origin HTTPS eksplisit; tanpa wildcard dengan credential |
| `VITE_DEMO_MODE` | `false` untuk integrasi API produksi |
| `DEMO_PASSWORD` | Ganti; idealnya seed demo tidak dijalankan |
| `DEVICE_SHARED_SECRET` | Jangan gunakan secret global development; prefer per-device |
| `FACE_ENGINE` | Adapter yang disetujui; mock hanya jika deployment sengaja demo |
| `FACE_MODEL_*` | Model/version/path atau reference immutable yang berlisensi |
| `FACE_MATCH_THRESHOLD` | Hasil kalibrasi deployment, bukan default contoh |
| `RAW_CAPTURE_STORAGE_ENABLED` | Tetap `false` kecuali ada dasar, kontrol, dan retention eksplisit |
| `MIGRATE_ON_START` | Sesuaikan strategi rollout; satu migrator lebih aman pada multi-replica |

Konfigurasi startup harus menolak secret development, wildcard CORS, atau HTTP insecure untuk mode production. Pisahkan account database migrator dari account runtime bila operasional memungkinkan.

## Build dan Release

Pipeline produksi sebaiknya:

1. Pin dependency dan base image dengan lock/digest.
2. Menjalankan lint, typecheck, unit, integration, dan e2e test.
3. Memindai dependency, container, dan secret.
4. Membangun frontend static dengan URL API produksi.
5. Membangun API image tanpa dev dependency atau source rahasia.
6. Mengambil model weights dari artifact registry private, bukan Git.
7. Menandatangani image dan mencatat SBOM/version.
8. Menjalankan migrasi sebagai job eksplisit sebelum traffic dialihkan.
9. Melakukan smoke test `/health/live`, `/health/ready`, `/health/model`, login, dan mock/canary check-in.

Compose root dapat dipakai untuk smoke test development:

```bash
docker compose config
docker compose up --build -d
docker compose ps
```

Jangan menganggap Vite dev server sebagai web server produksi.

## TLS dan Reverse Proxy

- Terminasi TLS pada Nginx, Caddy, ingress, atau load balancer yang dikelola.
- Gunakan sertifikat valid yang dipercaya kiosk; aktifkan renewal dan alert expiry.
- Redirect HTTP ke HTTPS dan set HSTS setelah domain/TLS stabil.
- Forward host/proto/correlation header hanya dari proxy tepercaya.
- Terapkan upload body limit sesuai `MAX_SAMPLE_BYTES` ditambah overhead multipart.
- Set timeout recognition yang terbatas dan rate limit login/kiosk.
- Tambahkan secure headers: CSP yang sesuai kamera, `X-Content-Type-Options`, frame restriction, referrer policy, dan permission policy kamera untuk origin sendiri.
- Batasi route admin dari jaringan yang diperlukan bila model operasional mendukung.

Webcam browser memerlukan secure context. Sertifikat self-signed yang tidak dipercaya dapat membuat permission kamera tidak stabil dan tidak disarankan untuk operasi harian.

## Migrasi Database

Backup database sebelum migrasi destruktif. Pada satu instance development, entrypoint akan menjalankan Alembic jika `alembic.ini` tersedia. Untuk produksi/multi-replica, gunakan job tunggal:

```bash
docker compose run --rm -e MIGRATE_ON_START=false api python -m alembic upgrade head
```

Verifikasi revision sebelum dan sesudah:

```bash
docker compose run --rm -e MIGRATE_ON_START=false api python -m alembic current
docker compose run --rm -e MIGRATE_ON_START=false api python -m alembic heads
```

Jangan menjalankan seed demo di produksi. Uji migrasi dari salinan backup pada staging, termasuk rollback aplikasi. Downgrade schema hanya dilakukan jika migration secara eksplisit aman; sering kali forward-fix lebih aman.

## Backup

Backup harus mencakup PostgreSQL dan, bila digunakan, object storage private/deletion ledger. Model dapat dipulihkan dari registry immutable dan tidak perlu dicampur dengan data member.

Contoh logical dump development:

```bash
docker compose exec -T postgres pg_dump -U gym -d gym -Fc > bisagym.dump
```

Persyaratan produksi:

- Jadwal harian atau sesuai RPO, ditambah WAL/PITR bila diperlukan.
- Enkripsi sebelum dipindahkan dan key terpisah dari backup.
- Lokasi off-host/off-site dengan least privilege dan immutability yang sesuai.
- Retention serta expiry yang konsisten dengan kewajiban penghapusan biometrik.
- Checksum, monitoring job, dan alert kegagalan.
- Restore drill berkala yang mengukur RPO/RTO.

File dump berisi data sensitif dan tidak boleh masuk repository atau lokasi user publik.

## Restore

Restore adalah operasi terkontrol dan diuji terlebih dahulu di environment terisolasi:

1. Hentikan write traffic dan catat waktu insiden.
2. Buat database kosong dengan versi PostgreSQL/extension yang kompatibel.
3. Verifikasi checksum, decrypt melalui kanal terkontrol, lalu restore.
4. Jalankan migrasi aplikasi yang diperlukan.
5. Terapkan kembali deletion/tombstone setelah titik backup agar profil yang sudah dihapus tidak hidup kembali.
6. Verifikasi count, constraint, consent aktif, face profile revoked, dan audit linkage.
7. Jalankan health/smoke/security test sebelum membuka traffic.
8. Hapus salinan restore sementara sesuai retention.

Contoh restore development ke database kosong:

```bash
docker compose exec -T postgres dropdb -U gym --if-exists gym_restore
docker compose exec -T postgres createdb -U gym gym_restore
docker compose exec -T postgres pg_restore -U gym -d gym_restore --clean --if-exists < bisagym.dump
```

Perintah tersebut destruktif terhadap target bernama `gym_restore`; jangan mengganti target dengan database aktif tanpa change procedure dan backup tervalidasi.

## Log, Metric, dan Retention

Log terstruktur memuat timestamp, level, service, correlation ID, branch/device bila relevan, operasi, hasil, dan durasi. Jangan memuat raw image, embedding, password, token, secret, atau payload consent signature.

Monitor setidaknya:

- Readiness API/database/model.
- Check-in allow/deny dan reason code.
- Recognition/database latency.
- Liveness/model errors.
- Heartbeat age perangkat.
- Login failure dan rate limit.
- Manual override, perubahan threshold, export, deletion.
- Backup age dan restore drill terakhir.

Atur rotation dan retention log berdasarkan kebutuhan audit/privacy. Batasi akses log, karena metadata check-in tetap data pribadi walaupun tanpa embedding.

## Reliability dan Rollback

- Gunakan restart policy, health check, resource limit, dan disk alert.
- Pisahkan readiness dari liveness agar dependency failure tidak memicu restart loop tanpa batas.
- Kiosk harus fail-closed ketika API tidak tersedia.
- Gunakan rolling/canary deployment jika ada banyak kiosk.
- Pertahankan image aplikasi sebelumnya dan prosedur rollback yang kompatibel dengan schema.
- Uji kegagalan PostgreSQL, storage, model, DNS, TLS expiry, dan jaringan kiosk.
- Dokumentasikan fallback resepsionis untuk outage tanpa menyimpan capture browser.

Setelah deployment, perbarui [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md) hanya berdasarkan test dan bukti operasional yang benar-benar lulus.
