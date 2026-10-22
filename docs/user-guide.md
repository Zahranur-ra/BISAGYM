# Panduan Pengguna

Panduan ini ditujukan untuk Super Admin, Gym Admin, dan Resepsionis. Menu yang terlihat bergantung pada role dan cabang. Kewenangan final selalu diperiksa API.

## Login

1. Buka URL BISAGYM yang diberikan administrator.
2. Masukkan email dan password staf sendiri.
3. Pastikan nama, role, dan cabang di header sesuai.
4. Keluar dari aplikasi sebelum meninggalkan meja bersama.

Akun demo development tercantum di [README](../README.md). Jangan memakai akun atau password demo di produksi.

## Mendaftarkan Member

1. Buka **Data Member** lalu pilih tambah member.
2. Pilih cabang yang benar bila role mengelola lebih dari satu cabang.
3. Isi nama lengkap dan data kontak yang memang diperlukan.
4. Periksa duplikasi berdasarkan kode/kontak; jangan memakai wajah sebagai ID utama.
5. Isi kontak darurat dan catatan hanya bila ada kebutuhan operasional yang sah.
6. Simpan dan catat kode member yang dihasilkan.
7. Buat membership bila member sudah memilih paket.

Koreksi data melalui halaman detail. Penghapusan member menggunakan workflow/soft delete dan tidak otomatis menghapus kewajiban audit. Pencabutan biometrik harus mengikuti workflow tersendiri.

## Membuat atau Memperpanjang Membership

1. Buka detail member dan bagian riwayat membership.
2. Pilih paket aktif, tanggal mulai, harga dibayar, dan reference pembayaran bila ada.
3. Periksa timezone serta tanggal/jam berakhir sebelum menyimpan.
4. Pastikan tidak ada periode aktif yang tumpang tindih.
5. Untuk perpanjangan, gunakan tindakan renew/extend dan jangan mengubah riwayat lama tanpa alasan.
6. Untuk penangguhan atau pembatalan, masukkan alasan yang jelas.

Status yang digunakan adalah `PENDING`, `ACTIVE`, `EXPIRED`, `SUSPENDED`, dan `CANCELLED`. Sistem tetap menghitung waktu mulai/akhir saat check-in; label `ACTIVE` tidak menjamin akses bila periode belum mulai atau sudah berakhir.

## Consent Biometrik

Enrollment hanya boleh dilakukan setelah consent aktif:

1. Buka detail member dan bagian persetujuan biometrik.
2. Tampilkan notice consent versi yang berlaku dalam bahasa yang dipahami member.
3. Jelaskan data wajah yang diproses, tujuan akses gym, retention, siapa yang dapat mengakses, dan apakah raw image disimpan.
4. Jelaskan cara mencabut consent serta alternatif check-in non-biometrik.
5. Beri kesempatan menolak tanpa enrollment diam-diam.
6. Jika setuju, catat versi, tujuan, retention, waktu, dan operator.
7. Jangan melanjutkan bila consent ditolak, dicabut, atau tidak dapat dipastikan.

Default sistem tidak menyimpan raw capture. Consent bukan izin tanpa batas; gunakan data hanya untuk tujuan yang dinyatakan.

## Enrollment Wajah

1. Dari detail member, pastikan consent berstatus aktif.
2. Pilih **Pendaftaran Wajah** dan periksa kamera siap.
3. Pastikan area terang, lensa bersih, dan hanya member berada dalam frame.
4. Minta member melepas penghalang wajah yang tidak diperlukan tanpa memaksa tindakan yang bertentangan dengan kebijakan/aksesibilitas.
5. Ambil pose depan, sedikit kiri, sedikit kanan, lalu pose tambahan yang diminta.
6. Ikuti challenge liveness dan jangan memberi tahu urutan sebelum sistem menampilkannya.
7. Ulangi hanya sample yang gagal kualitas; jangan terus menurunkan threshold untuk mengejar keberhasilan.
8. Periksa ringkasan quality/liveness lalu finalisasi.
9. Jika ada peringatan profil mirip, hentikan auto-enrollment dan minta review admin.
10. Pastikan status berubah menjadi enrolled dan audit tercatat.

Jangan mengambil screenshot atau menyimpan frame dengan aplikasi lain. Re-enrollment harus mencabut profil lama dengan alasan dan tetap menjaga riwayat audit minimum.

## Check-in Kiosk

Instruksi untuk member:

1. Berdiri pada penanda jarak dan hadap kamera.
2. Pastikan hanya satu orang terlihat.
3. Ikuti petunjuk bergerak lebih dekat/jauh, lihat lurus, blink, atau putar kepala.
4. Tunggu hasil akses; jangan mengulang selama cooldown.
5. Hubungi resepsionis jika ditolak atau sistem tidak tersedia.

Kiosk hanya menampilkan nama yang diminimalkan, masa berlaku yang relevan, waktu, dan status. Score biometrik serta data kontak tidak ditampilkan.

## Check-in Manual

Check-in manual adalah fallback terkontrol, bukan cara menyembunyikan kegagalan biometrik:

1. Login sebagai resepsionis/operator yang berwenang.
2. Cari dan verifikasi member terdaftar menggunakan prosedur operasional non-biometrik.
3. Buka attempt yang gagal bila tersedia agar hasil asal tetap terkait.
4. Periksa membership, cabang, dan alasan penolakan.
5. Pilih manual override hanya bila kebijakan mengizinkan.
6. Masukkan alasan spesifik dan konfirmasi identitas member yang dipilih.
7. Pastikan catatan memuat operator dan waktu.

Jangan memberikan akses karena tekanan pengguna tanpa verifikasi. Untuk member suspended/cancelled atau device/cabang tidak valid, ikuti eskalasi kebijakan gym.

## Pencabutan dan Penghapusan Biometrik

1. Verifikasi member/pemohon dan kewenangan operator.
2. Catat pencabutan consent.
3. Jalankan revoke/delete face profile melalui tindakan aplikasi yang disediakan.
4. Pastikan status profil tidak lagi aktif untuk matching.
5. Jelaskan kapan raw sample/backup keluar dari retention bila ada.
6. Pastikan fallback non-biometrik tetap tersedia sesuai kebijakan.
7. Eskalasi kegagalan parsial; jangan hanya menghapus foto profil biasa.

Detail kontrol ada di [biometric-security.md](biometric-security.md).

## Riwayat dan Laporan

- Gunakan filter cabang, tanggal, member, device, keputusan, dan reason code sesuai role.
- Confidence ditampilkan sebagai kategori bila diperlukan, bukan embedding.
- Review manual override, denial berulang, device offline, dan membership akan habis.
- Export hanya data yang diperlukan dan simpan pada lokasi resmi yang terlindungi.
- Buka file CSV dengan hati-hati; aplikasi harus melakukan escaping formula tetapi file tetap berisi data pribadi.
- Jangan membagikan laporan melalui akun pribadi atau kanal publik.

## Mengatasi Scan Gagal

| Pesan/kondisi | Tindakan operator |
|---|---|
| Tidak ada wajah | Periksa posisi, kamera, dan pencahayaan |
| Lebih dari satu wajah | Minta orang lain keluar dari frame |
| Kualitas rendah | Bersihkan lensa, kurangi backlight, atur jarak, ambil ulang |
| Liveness gagal | Ulangi challenge baru; jangan reuse session lama |
| Wajah tidak dikenali | Verifikasi member; periksa enrollment/revocation, lalu fallback sesuai prosedur |
| Confidence rendah | Jangan tampilkan score; coba kondisi capture lebih baik atau re-enroll terkontrol |
| Membership belum mulai/kedaluwarsa | Periksa periode dan proses renew bila sesuai |
| Membership suspended | Ikuti alasan suspension dan eskalasi admin |
| Device inactive/cabang salah | Hentikan penggunaan dan hubungi admin perangkat |
| Duplicate check-in | Tunggu cooldown; jangan membuat override tanpa kebutuhan |
| Sistem tidak tersedia | Jangan fail-open; gunakan fallback resepsionis terautentikasi |

Jika kegagalan berulang pada banyak member, catat waktu, device, kondisi cahaya, correlation ID, dan reason code lalu laporkan ke admin teknis. Jangan mengirim raw capture melalui chat/email support.

## Praktik Privasi Harian

- Kunci layar ketika meja ditinggalkan.
- Jangan membagikan password atau credential device.
- Jangan mencari member di luar kebutuhan tugas.
- Jangan memotret layar kiosk atau embedding/debug payload.
- Pastikan orang di sekitar tidak dapat membaca detail member sensitif.
- Laporkan kehilangan perangkat, export salah alamat, atau akses mencurigakan segera.
- Gunakan correlation ID untuk dukungan teknis, bukan raw image atau token.
