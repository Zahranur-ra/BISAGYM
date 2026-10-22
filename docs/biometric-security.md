# Keamanan Biometrik

## Prinsip

Data wajah dan embedding adalah data pribadi sensitif, bukan password yang mudah diganti. Sistem harus meminimalkan pengumpulan, membatasi tujuan, meminta consent aktif sebelum enrollment, menyediakan fallback non-biometrik, dan memungkinkan pencabutan serta penghapusan tanpa edit database manual.

Mock engine hanya untuk development/demo. Mode RGB dengan active challenge mengurangi sebagian risiko tetapi bukan jaminan Presentation Attack Detection (PAD) produksi. Landmark webcam 2D tidak boleh diklaim sebagai biometrik 3D.

## Threat Model

| Ancaman | Contoh | Kontrol minimum |
|---|---|---|
| Presentation attack | Foto cetak, layar ponsel, video replay, mask | Challenge acak dan singkat, anti-replay, quality check; depth/PAD untuk risiko lebih tinggi |
| Account/device theft | Token staf atau secret kiosk dicuri | Token singkat, rotasi, credential per-device, revocation, rate limit |
| API abuse | Upload besar/rusak, brute force, duplicate submission | MIME/size/decode validation, rate limit, idempotency/replay control |
| Data exfiltration | Dump database, backup, object storage, log | Least privilege, encryption, private storage, encrypted backup, redaction |
| Insider misuse | Export atau pencarian biometrik tanpa tujuan | RBAC, branch scope, audit append-only, separation of duties |
| Cross-branch match | Device cabang A menerima member cabang B | Scope matching dan membership/device branch check server-side |
| Model supply chain | Weights berbahaya/tidak berlisensi | Pin version/hash, provenance, isolated adapter, license gate |
| Threshold error | False accept/false reject tinggi | Kalibrasi lokal, monitoring, change approval dan audit |
| Browser cache leakage | Capture tersimpan di cache/local storage | Jangan persist capture; private no-store response; segera release frame |
| Deletion incomplete | Template dicabut tetapi backup/raw sample tertinggal | Workflow deletion, retention ledger, backup expiry, bukti audit |

## Risiko Spoof dan Liveness

Active challenge RGB harus:

1. Memilih satu atau dua instruksi secara acak, misalnya blink atau putar kepala.
2. Mengeluarkan token session berumur pendek yang terkait device dan challenge.
3. Memeriksa gerakan pada urutan frame, bukan satu gambar akhir.
4. Menolak token kedaluwarsa, token yang sudah dipakai, urutan tidak masuk akal, dan gambar statis.
5. Mencatat hasil serta versi algoritma tanpa menyimpan frame di log.

Keterbatasan penting:

- Blink saja dapat direplay dengan video.
- Kamera RGB tidak dapat membuktikan bentuk permukaan wajah.
- Pencahayaan buruk, kacamata, occlusion, dan frame rate rendah menaikkan false reject.
- Kamera depth juga dapat diserang dan memerlukan kalibrasi, sinkronisasi, serta validasi sensor.
- PAD yang kuat mungkin memerlukan model/vendor berlisensi dan evaluasi terhadap serangan lokal.

Sistem harus fail-closed pada kegagalan liveness atau sistem. Resepsionis dapat memakai fallback terautentikasi dengan alasan; fallback tidak boleh menimpa rekaman hasil biometrik.

## Pengumpulan dan Consent

Sebelum enrollment, operator harus menampilkan dan mencatat:

- Data yang dikumpulkan dan tujuan kontrol akses.
- Apakah raw image disimpan; default adalah tidak.
- Retention template dan sample.
- Pihak/role yang dapat mengakses.
- Cara mencabut consent dan meminta penghapusan.
- Prosedur masuk non-biometrik/manual.
- Versi notice/consent, waktu, operator, dan bukti bila digunakan.

Penolakan consent tidak boleh membuat profil diam-diam. Enrollment session harus memeriksa consent aktif di server, bukan hanya checkbox frontend.

## Penyimpanan dan Retention

- Raw capture: `RAW_CAPTURE_STORAGE_ENABLED=false` secara default.
- Jika diaktifkan untuk investigasi/kalibrasi, simpan terenkripsi di private storage, bukan public web root.
- Batasi akses dengan service identity dan rekam setiap akses administratif.
- `RAW_CAPTURE_RETENTION_HOURS=24` adalah batas development, bukan persetujuan kebijakan otomatis.
- Purge job harus berdasarkan `purge_after`, idempotent, dan menghasilkan audit/metric tanpa menyimpan konten.
- Embedding menyimpan nama/versi model, preprocessing, dimensi, quality, status, dan waktu pencabutan.
- Backup terenkripsi mengikuti jadwal expiry sehingga data terhapus tidak dipulihkan tanpa kontrol khusus.
- Log dan telemetry tidak pernah berisi image, embedding, password, token, atau secret penuh.

Kebijakan retention produksi harus disetujui pemilik data/legal sesuai yurisdiksi dan kebutuhan bisnis yang terdokumentasi.

## Pencabutan dan Penghapusan

Workflow minimum:

1. Verifikasi kewenangan pemohon/operator dan scope cabang.
2. Catat permintaan dan correlation ID.
3. Cabut consent aktif.
4. Nonaktifkan/revoke semua face profile agar matching segera berhenti.
5. Hapus template dan raw sample sesuai kebijakan serta reference storage.
6. Pertahankan audit minimum yang diwajibkan tanpa mempertahankan embedding.
7. Catat hasil, kegagalan parsial, retry, dan tanggal data keluar dari siklus backup.
8. Konfirmasi fallback akses/member tetap tersedia bila sesuai kebijakan.

Penghapusan member biasa tidak boleh meninggalkan profil aktif. Restore backup harus menjalankan kembali tombstone/deletion ledger sebelum sistem menerima check-in.

## Enkripsi dan Akses

- Gunakan TLS untuk semua traffic produksi, termasuk device lokal bila melintasi jaringan.
- Enkripsi disk/database backup dan object storage dengan key yang dikelola terpisah.
- Batasi koneksi database ke API dan operator backup yang diperlukan.
- Pisahkan hak operasional member dari hak mengubah threshold atau menghapus biometrik massal.
- Rotasi secret device dan key backup; jangan menyimpan key di repository atau Compose file produksi.
- Jangan pernah mengirim embedding ke frontend, export, atau endpoint support.

## Kalibrasi Threshold

Default `FACE_MATCH_THRESHOLD=0.45`, quality `0.70`, liveness `0.70`, dan depth `0.70` hanya placeholder development.

Kalibrasi produksi harus:

1. Menggunakan model dan preprocessing yang sama dengan produksi.
2. Mengambil data representatif untuk kamera, jarak, sudut, pencahayaan, dan populasi gym aktual dengan dasar consent yang sah.
3. Memisahkan pasangan genuine dan impostor serta mengukur FAR/FRR dan distribusi score.
4. Menentukan target risiko, bukan memilih threshold hanya dari demo yang terlihat berhasil.
5. Menguji kelompok/kondisi yang relevan untuk bias dan false reject.
6. Memvalidasi quality/liveness/depth secara terpisah dari identity match.
7. Merekam dataset version, hasil, approver, threshold, dan tanggal berlaku.
8. Menjalankan shadow/canary dan memonitor denial reason sebelum rollout penuh.

Perubahan threshold hanya untuk role istimewa, perlu alasan, dan menghasilkan audit log. Exact score tidak ditampilkan pada kiosk publik.

## Gate Lisensi Model

Sebelum model nyata dipakai secara komersial:

- Verifikasi lisensi source code dan pretrained weights secara terpisah.
- Pastikan izin penggunaan komersial, redistribusi, dan wilayah penggunaan.
- Catat sumber, checksum, model version, preprocessing, dan bukti persetujuan.
- Jangan bake/commit weights ke repository bila lisensi melarang atau file sensitif/besar.
- Isolasi implementasi di adapter agar mock atau model internal dapat menggantikan vendor.
- Lakukan security scan dan evaluasi akurasi; lisensi yang valid tidak membuktikan keamanan atau fairness.

Tidak ada model eksternal pada konfigurasi root yang otomatis dianggap berlisensi untuk produksi.
