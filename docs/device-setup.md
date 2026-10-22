# Setup Perangkat Kiosk

## Mode Perangkat

BISAGYM mendukung dua jalur capture:

| Mode | Perangkat | Jalur data |
|---|---|---|
| RGB | Webcam standar dan browser kiosk | Browser mengambil frame lalu mengirim ke API melalui HTTPS |
| RGB-D opsional | Kamera depth dengan SDK vendor | Service lokal mengambil RGB/depth sinkron dan mengirim payload bertanda tangan |

Gunakan mock mode untuk demo tanpa kamera. Jangan menyebut landmark webcam RGB sebagai pengenalan 3D.

## Persiapan Kiosk Browser

Perangkat minimum yang disarankan:

- PC kiosk yang menerima update keamanan.
- Webcam 720p atau lebih baik dengan posisi tetap setinggi wajah.
- Pencahayaan depan stabil; hindari jendela terang tepat di belakang pengguna.
- Chromium/Chrome/Edge versi yang masih didukung.
- Koneksi LAN stabil dan sinkronisasi waktu NTP.
- Akun sistem operasi kiosk tanpa hak administrator harian.

Konfigurasi browser:

1. Buka origin HTTPS produksi, atau `http://localhost:5173` saat development lokal.
2. Izinkan kamera hanya untuk origin BISAGYM.
3. Pilih kamera yang benar bila ada beberapa input.
4. Aktifkan kiosk/fullscreen mode sesuai kebijakan OS.
5. Nonaktifkan password saving, extension tidak perlu, dan guest navigation.
6. Jangan menyimpan device secret di local storage jika service lokal dapat menyimpannya lebih aman.
7. Uji restart otomatis setelah reboot serta tampilan offline/fail-closed.

Browser camera API memerlukan secure context. HTTP dengan alamat IP LAN biasanya tidak mendapat akses kamera; gunakan TLS yang dipercaya perangkat.

## Posisi Kamera

- Pasang kamera stabil, kira-kira setinggi mata dan menghadap lurus.
- Tandai jarak berdiri yang menghasilkan wajah cukup besar tetapi tidak terpotong.
- Pastikan hanya satu orang masuk frame check-in.
- Hindari lampu berkedip, backlight kuat, dan pantulan langsung pada kacamata.
- Bersihkan lensa dan lakukan uji pagi, siang, serta malam.
- Kiosk publik harus menampilkan privacy notice dan tidak menampilkan score biometrik.

## Registrasi Device

Registrasi dilakukan oleh Super Admin atau role yang diberi kewenangan:

1. Buat device dengan cabang yang benar, misalnya kode `KIOSK-001`.
2. Tetapkan capability aktual: RGB, depth, active liveness, dan door relay.
3. Terbitkan credential unik sekali; jangan memakai secret development lintas perangkat.
4. Provision credential melalui kanal terpisah dan simpan di OS credential store/service lokal.
5. Kirim heartbeat dan pastikan `last_seen_at`, versi software, kamera, serta capability muncul.
6. Uji device inactive dan branch mismatch menghasilkan penolakan.
7. Rotasi credential setelah provisioning, kehilangan perangkat, pergantian operator, atau sesuai jadwal.

Shared secret pada `.env.example` hanya baseline development. Produksi sebaiknya memakai HMAC per-device, asymmetric signing, atau mTLS. Signature perlu mencakup device ID, timestamp, nonce, method/path, dan hash body agar replay dan modifikasi payload dapat ditolak.

## Uji Webcam RGB

1. Buka halaman kiosk dan periksa badge koneksi/perangkat.
2. Berikan permission kamera dan pastikan preview tidak mirror secara keliru untuk proses backend.
3. Uji no-face, multiple-face, terlalu dekat/jauh, blur, dan pencahayaan buruk.
4. Jalankan challenge blink/putar kepala dan pastikan challenge kedaluwarsa ditolak.
5. Uji member aktif, kedaluwarsa, suspended, unknown, dan duplicate cooldown.
6. Putuskan API; kiosk harus menampilkan sistem tidak tersedia dan tidak membuka pintu.
7. Pastikan tab browser, cache, log, dan screenshot otomatis tidak menyimpan raw capture.

## Service RGB-D Opsional

Browser tidak diasumsikan dapat mengakses stream proprietary. Install service lokal terpisah pada PC kiosk dengan:

- Adapter SDK vendor yang dipin versinya.
- Serial kamera dan calibration ID yang tervalidasi.
- Sinkronisasi timestamp RGB/depth.
- Health endpoint lokal yang hanya dapat diakses host/LAN tepercaya.
- Penyimpanan credential menggunakan OS credential store.
- Outbound HTTPS ke API; tidak ada port camera stream publik.
- Mock depth adapter untuk test tanpa hardware.

Payload capture harus membawa timestamp RGB/depth, reference frame private atau body yang dibatasi, calibration ID, camera serial, nonce, dan signature. API harus menolak frame tidak sinkron, kalibrasi tidak dikenal, timestamp di luar toleransi, nonce ulang, signature salah, atau device tanpa capability depth.

Tidak tersedianya service/kamera depth tidak boleh merusak mode RGB kecuali kebijakan cabang secara eksplisit mewajibkan depth. Jika depth diwajibkan, kegagalan sensor harus fail-closed dengan fallback resepsionis.

## Health Check

API pusat:

```bash
curl -fsS http://localhost:8000/health/live
curl -fsS http://localhost:8000/health/ready
curl -fsS http://localhost:8000/health/model
```

Compose:

```bash
docker compose ps
docker compose logs --tail=100 api web
```

Checklist device sehat:

- Device aktif dan terikat ke cabang yang tepat.
- Heartbeat baru dan waktu perangkat sinkron.
- Kamera terdeteksi serta tidak digunakan aplikasi lain.
- Capability yang dilaporkan sama dengan hardware.
- Challenge/session dapat dibuat dan signature diterima.
- API ready, bukan hanya live.
- Latency dan error rate berada dalam baseline lokasi.

## Troubleshooting

### Permission kamera ditolak

Reset permission origin pada browser, pastikan origin HTTPS/localhost, pilih kamera yang benar, lalu reload. Kebijakan enterprise browser/OS juga dapat memblokir kamera.

### Preview hitam atau sibuk

Tutup aplikasi konferensi/CCTV lain, cabut-pasang perangkat, periksa Device Manager/driver, dan restart browser. Jangan otomatis beralih ke kamera yang belum disetujui tanpa memberi tahu operator.

### Device offline

Periksa DNS, route, TLS trust, waktu NTP, credential, dan log service. Jangan mengaktifkan fail-open. Gunakan prosedur check-in manual oleh staf terautentikasi.

### Banyak false reject

Perbaiki posisi/pencahayaan sebelum mengubah threshold. Catat kondisi, model, kamera, dan reason code; lakukan proses kalibrasi terkontrol sesuai [biometric-security.md](biometric-security.md).
