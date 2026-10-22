# Tutorial Penggunaan BISAGYM V2

Panduan ini menjelaskan cara menjalankan BISAGYM V2 di Windows dan alur penggunaan dari pembuatan member sampai pengujian streaming pengenalan wajah.

## 1. Alamat Aplikasi

| Layanan | Alamat |
|---|---|
| Web BISAGYM V2 | `http://localhost:5174` |
| API | `http://localhost:8001` |
| Status aplikasi | `http://localhost:8001/health/ready` |
| Status model wajah | `http://localhost:8001/health/model` |

Web hanya dapat dibuka selama proses API dan web sedang berjalan.

## 2. Persiapan Pertama Kali

Bagian ini hanya diperlukan pada komputer baru atau setelah dependency dihapus. Internet diperlukan saat instalasi awal.

1. Pasang Python 3.13 dan Node.js 20 atau versi lebih baru.
2. Buka PowerShell.
3. Masuk ke folder BISAGYM V2:

```powershell
Set-Location "D:\1. TUGAS UTAMA NEGARA\BISAGYM_V2"
```

4. Jika PowerShell memblokir script, izinkan script hanya untuk jendela saat ini:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

5. Pasang dependency dan model wajah:

```powershell
.\tasks.ps1 install
```

6. Terapkan struktur database:

```powershell
.\tasks.ps1 migrate
```

Database V2 saat ini sudah merupakan salinan database BISAGYM lama. Jangan menjalankan `reset-db` jika data salinan tersebut masih diperlukan.

## 3. Membuka Aplikasi Setiap Hari

1. Coba buka `http://localhost:5174` terlebih dahulu.
2. Jika halaman belum dapat dibuka, jalankan PowerShell.
3. Masuk ke folder proyek:

```powershell
Set-Location "D:\1. TUGAS UTAMA NEGARA\BISAGYM_V2"
```

4. Jalankan aplikasi:

```powershell
.\tasks.ps1 dev
```

5. Tunggu sampai API dan Vite menampilkan bahwa server siap.
6. Biarkan PowerShell tetap terbuka selama aplikasi digunakan.
7. Buka Chrome atau Edge ke `http://localhost:5174`.

Jika browser menampilkan versi lama, tekan `Ctrl+F5`.

## 4. Login

Semua akun demo menggunakan password `GymDemo123!`.

| Peran | Email | Kegunaan |
|---|---|---|
| Super Admin | `superadmin@gym.local` | Semua cabang dan pengaturan sistem |
| Gym Admin | `admin@gym.local` | Operasional cabang, member, enrollment, perangkat, dan laporan |
| Resepsionis | `reception@gym.local` | Member, membership, enrollment, streaming, dan operasional harian |

Langkah login:

1. Buka `http://localhost:5174`.
2. Masukkan email dan password.
3. Tekan tombol login.
4. Periksa nama, role, dan cabang di bagian atas aplikasi.

## 5. Urutan Pengujian yang Disarankan

Gunakan urutan berikut agar pengenalan wajah dapat diuji dengan benar:

1. Pastikan member tersedia.
2. Pastikan member mempunyai membership aktif.
3. Daftarkan wajah member.
4. Uji melalui menu Streaming Kamera.
5. Uji check-in melalui Kiosk bila diperlukan.

## 6. Menambah Member

1. Pilih menu **Data Member**.
2. Tekan tombol tambah member.
3. Isi nama lengkap dan data yang diperlukan.
4. Pilih cabang yang benar jika pilihan cabang tersedia.
5. Simpan data.
6. Buka detail member yang baru dibuat.

Gunakan satu data member untuk satu orang. Jangan membuat beberapa member hanya untuk memperbaiki hasil pengenalan wajah.

## 7. Membuat Membership

Wajah yang terdaftar belum otomatis berarti boleh check-in. Member juga memerlukan membership aktif.

1. Buka **Data Member**.
2. Pilih member.
3. Buka bagian membership pada detail member.
4. Pilih paket membership.
5. Isi tanggal mulai, pembayaran, dan data lain yang diperlukan.
6. Simpan.
7. Pastikan status membership aktif dan belum melewati tanggal berakhir.

## 8. Mendaftarkan Wajah

### Persiapan

- Bersihkan lensa kamera.
- Gunakan pencahayaan dari depan, bukan cahaya kuat dari belakang.
- Pastikan hanya satu orang berada di dalam frame.
- Wajah tidak terlalu jauh dan tidak terpotong.
- Gunakan orang yang sama untuk seluruh pose.

### Langkah pendaftaran

1. Pilih menu **Pendaftaran Wajah**.
2. Pilih member yang akan didaftarkan.
3. Tekan lanjut ke persetujuan.
4. Jelaskan penggunaan data wajah kepada member.
5. Centang persetujuan biometrik jika member setuju.
6. Tekan **Setujui & buka kamera**.
7. Izinkan akses kamera pada browser.
8. Ambil pose depan.
9. Ikuti pose kiri, kanan, dan pose tambahan yang ditampilkan.
10. Jangan bergerak cepat saat tombol foto ditekan.
11. Tunggu sampai backend menerima setiap sampel.
12. Pastikan halaman menampilkan bahwa profil biometrik berhasil diaktifkan.

Jika sampel ditolak, perbaiki posisi atau pencahayaan. Jangan menurunkan threshold hanya agar pendaftaran berhasil.

## 9. Menggunakan Streaming Kamera

Fitur ini dapat mendeteksi beberapa wajah dalam satu frame dan menunjukkan wajah yang cocok dengan profil cabang.

1. Login sebagai staf.
2. Pilih menu **Streaming Kamera**.
3. Jika login sebagai Super Admin, pilih cabang terlebih dahulu.
4. Tekan tombol **Aktifkan Streaming**.
5. Pilih **Izinkan** saat browser meminta akses kamera.
6. Minta satu atau dua orang berdiri menghadap kamera.
7. Tunggu beberapa frame agar posisi kotak dan hasil pengenalan stabil.

Arti tampilan:

| Tampilan | Arti |
|---|---|
| Kotak hijau | Wajah cocok dengan profil yang sudah terdaftar di cabang |
| Kotak merah | Wajah belum cocok, belum terdaftar, atau kualitas gambar belum cukup |
| Wajah kurang jelas | Atur jarak, cahaya, dan posisi lalu tunggu analisis berikutnya |
| Perlu verifikasi ulang | Terdapat hasil yang terlalu mirip atau belum cukup pasti |

Untuk menguji dua orang:

1. Gunakan satu orang yang wajahnya sudah didaftarkan.
2. Gunakan satu orang yang belum didaftarkan.
3. Pastikan kedua wajah cukup besar dan tidak saling menutupi.
4. Berdiri sejajar dengan jarak yang hampir sama dari kamera.
5. Tunggu sampai kotak mengikuti masing-masing wajah.

Matikan **Aktifkan Streaming** setelah selesai agar webcam berhenti.

Streaming hanya memberi informasi profil terdaftar atau belum dikenali. Fitur ini tidak memberikan keputusan akses dan tidak memeriksa status membership.

## 10. Menggunakan Kiosk Check-in

1. Pilih menu **Buka Kiosk**.
2. Izinkan kamera.
3. Pastikan hanya satu orang berada di depan kamera.
4. Hadapkan wajah ke kamera.
5. Tekan **Mulai check-in**.
6. Tunggu hasil verifikasi identitas dan membership.

Hasil umum:

| Hasil | Tindakan |
|---|---|
| Akses diizinkan | Member dikenali dan membership memenuhi syarat |
| Wajah belum dikenali | Perbaiki posisi atau lakukan enrollment terkontrol |
| Membership berakhir | Perpanjang membership melalui staf |
| Lebih dari satu wajah | Minta orang lain keluar dari frame kiosk |
| Kualitas gambar rendah | Perbaiki cahaya, jarak, dan kestabilan |

## 11. Melihat Riwayat dan Laporan

1. Pilih **Riwayat Akses** untuk melihat attempt check-in.
2. Gunakan filter yang tersedia untuk mencari waktu, member, atau hasil akses.
3. Gym Admin dan Super Admin dapat membuka **Laporan**.
4. Jangan membagikan export laporan melalui kanal pribadi karena dapat berisi data member.

Streaming kamera tidak membuat riwayat check-in. Riwayat hanya dibuat melalui alur check-in atau tindakan operasional yang memang mencatat attempt.

## 12. Mematikan Aplikasi

Jika aplikasi dijalankan menggunakan `tasks.ps1 dev`:

1. Kembali ke PowerShell yang menjalankan BISAGYM V2.
2. Tekan `Ctrl+C`.
3. Tunggu sampai proses API dan web berhenti.
4. Tutup PowerShell.

Jika server pernah dijalankan di background dan tidak mempunyai jendela PowerShell, hentikan proses port V2 dengan:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 5174,8001 |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ }
```

Perintah tersebut hanya ditujukan untuk server development BISAGYM V2 pada port `5174` dan `8001`.

## 13. Troubleshooting

### Web tidak dapat dibuka

1. Pastikan `tasks.ps1 dev` masih berjalan.
2. Buka `http://localhost:8001/health/ready`.
3. Jika port sudah dipakai proses lain, hentikan proses V2 lama lalu jalankan ulang.

### Model wajah tidak siap

1. Buka `http://localhost:8001/health/model`.
2. Pastikan status adalah `ready` dan OpenCV adalah `4.13.0`.
3. Jika model hilang, jalankan kembali `tasks.ps1 install` dengan koneksi internet.

### Kamera tidak muncul

1. Gunakan `localhost`, Chrome, atau Edge.
2. Tekan ikon izin situs di sebelah alamat browser.
3. Ubah izin kamera menjadi **Allow/Izinkan**.
4. Tutup aplikasi lain yang sedang memakai webcam.
5. Matikan lalu aktifkan kembali streaming.

### Streaming tersendat

1. Tutup tab kamera lain.
2. Gunakan pencahayaan yang stabil.
3. Kurangi gerakan cepat.
4. Pastikan tidak terlalu banyak wajah di dalam frame.
5. Matikan streaming, tunggu dua detik, lalu aktifkan kembali.

### Wajah terdaftar masih berwarna merah

1. Pastikan cabang streaming sama dengan cabang profil member.
2. Pastikan enrollment sudah selesai dan profil masih aktif.
3. Mendekatlah agar wajah lebih besar.
4. Gunakan kondisi cahaya yang mirip dengan saat enrollment.
5. Jika tetap gagal, lakukan pendaftaran ulang secara terkontrol.

### Login gagal

1. Pastikan API `8001` berstatus siap.
2. Gunakan akun demo dan password yang benar.
3. Jika password database pernah diubah, gunakan password saat data tersebut dibuat.

## 14. Catatan Privasi dan Keamanan

- Frame streaming diproses sementara dan tidak disimpan oleh fitur ini.
- Jangan mengambil screenshot wajah tanpa tujuan dan persetujuan yang sah.
- SFace adalah pengenalan wajah RGB 2D, bukan pemindaian 3D.
- Sistem belum mempunyai liveness detection yang dapat diandalkan.
- Foto cetak atau wajah dari layar masih berpotensi dikenali.
- Selalu sediakan alternatif verifikasi manual.
- Matikan streaming ketika tidak digunakan.
- Akun dan password demo tidak boleh digunakan untuk produksi.

## 15. Ringkasan Cepat

```text
Jalankan tasks.ps1 dev
        |
        v
Buka localhost:5174 dan login
        |
        v
Buat/pilih member dan aktifkan membership
        |
        v
Daftarkan wajah dengan persetujuan
        |
        v
Aktifkan Streaming Kamera untuk pengujian multi-face
        |
        v
Gunakan Kiosk untuk pengujian keputusan check-in
        |
        v
Matikan streaming dan tekan Ctrl+C setelah selesai
```
