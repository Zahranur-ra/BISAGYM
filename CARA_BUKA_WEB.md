# Cara Membuka Web BISAGYM V2 di Windows

Panduan operasional lengkap tersedia di [TUTORIAL_PENGGUNAAN_BISAGYM_V2.md](TUTORIAL_PENGGUNAAN_BISAGYM_V2.md).

## Persiapan pertama kali

1. Pastikan Python 3.13 dan Node.js 20 atau versi lebih baru sudah terpasang.
2. Buka PowerShell.
3. Masuk ke folder proyek:

```powershell
Set-Location "D:\1. TUGAS UTAMA NEGARA\BISAGYM_V2"
```

4. Jika PowerShell memblokir script, izinkan hanya untuk jendela yang sedang dipakai:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

5. Pasang dependency dan model wajah. Perintah ini memerlukan internet dan otomatis membuat virtual environment Python agar paket OpenCV tidak bentrok:

```powershell
.\tasks.ps1 install
```

6. Siapkan database lokal dan data demo:

```powershell
.\tasks.ps1 migrate
.\tasks.ps1 seed
```

## Membuka web setiap hari

1. Buka PowerShell dan masuk ke folder proyek:

```powershell
Set-Location "D:\1. TUGAS UTAMA NEGARA\BISAGYM_V2"
```

2. Jalankan API dan web:

```powershell
.\tasks.ps1 dev
```

3. Biarkan jendela PowerShell tetap terbuka.
4. Buka `http://localhost:5174` di Chrome atau Edge.
5. Izinkan akses kamera saat diminta.

## Menggunakan Streaming Kamera

1. Login sebagai staf.
2. Pilih menu `Streaming Kamera`.
3. Super Admin harus memilih cabang yang akan diperiksa.
4. Aktifkan tombol `Aktifkan Streaming` dan izinkan kamera.
5. Kotak hijau menandai profil yang sudah terdaftar. Kotak merah menandai wajah yang belum cocok atau belum cukup jelas.
6. Matikan tombol streaming setelah selesai agar kamera berhenti.

## Login demo

- Email: `superadmin@gym.local`
- Password: `GymDemo123!`

## Mematikan aplikasi

Kembali ke PowerShell yang menjalankan aplikasi, lalu tekan `Ctrl+C`. Setelah proses berhenti, web tidak dapat dibuka sampai `tasks.ps1 dev` dijalankan lagi.

## Pemeriksaan jika web bermasalah

- Web: `http://localhost:5174`
- Status API: `http://localhost:8001/health/ready`
- Status model wajah: `http://localhost:8001/health/model`

Status API dan model harus menampilkan `ready`. Gunakan `Ctrl+F5` jika browser masih menampilkan versi lama. Pemakaian normal berjalan lokal tanpa internet setelah dependency dan model selesai dipasang.
