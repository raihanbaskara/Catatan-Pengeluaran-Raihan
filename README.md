# DOMPET.AI — Catatan Pengeluaran Raihan (3-Vault Liquid Glass + WhatsApp AI Bot)

Sistem pencatatan keuangan otomatis berbasis **WhatsApp Bot AI** + **Web Dashboard (Ethereal Liquid Glassmorphism)** + **Google Spreadsheet Real-Time Sync** dengan arsitektur **3 Dompet Terpisah**:
1. **Uang Tunai (`CASH`)**: Default untuk belanja harian tanpa keterangan metode bayar (*"beli bensin 20 ribu"*, *"beli seblak 15 ribu"*).
2. **Saldo ATM 1 (`ATM` — Simpanan Utama)**: Default untuk pemasukan/gaji bulanan (*"gaji masuk 3 juta"*) dan aman dari potongan jajan harian.
3. **Saldo ATM 2 (`ATM2` — Dompet Jajan / QRIS)**: Default untuk seluruh transaksi non-tunai harian (`qris`, `tf`, `debit`, contoh: *"beli kopi 18rb pakai qris"*) serta *tarik tunai*.
4. **Alokasi Antar-ATM (`ATM 1 -> ATM 2`)**: Ketik *"isi atm 2 500 ribu"* di WhatsApp untuk memindahkan jatah jajan bulanan dari ATM 1 ke ATM 2 tanpa tercatat sebagai pengeluaran boros.

---

## Arsitektur Database Saat Deploy (Hybrid Dual-Storage)

Aplikasi ini menggunakan sistem **Hybrid Dual-Database** sehingga sangat mudah di-deploy:

1. **Engine Utama (Ultra-Fast Local SQLite — `node:sqlite`)**:
   - Disimpan otomatis di file `data/finance.db` (tanpa perlu install database server eksternal seperti PostgreSQL/MySQL).
   - Lokasi folder data dikontrol lewat environment variable `DATA_DIR` (default: `./data`).
2. **Database Cloud Permanen (Google Spreadsheet 5-Tab)**:
   - Setiap transaksi dari WhatsApp maupun Web Dashboard otomatis dikirim ke **Google Spreadsheet (`1_UvnRmnVZzxfzNp-mASlWtrpuqShcDD8ei8NuHK3YkM`)** melalui `APPS_SCRIPT_WEBHOOK_URL`.
   - Bahkan jika server cloud di-restart, seluruh riwayat transaksi dan saldo 3 dompet (`Uang Tunai`, `Saldo ATM 1`, `Saldo ATM 2`) tetap tersimpan abadi di Google Spreadsheet Anda.

### Rekomendasi Tempat Deploy Terbaik
Karena aplikasi ini menjalankan **WhatsApp Bot (Baileys WebSocket)** dan **SQLite (`node:sqlite` pada Node.js v22+)**, gunakan platform yang mendukung *Long-Running Node.js Process* (bukan Vercel Serverless karena Vercel mematikan koneksi WebSocket WhatsApp setelah 10 detik):
- **Railway.app** *(Rekomendasi #1)*: Hubungkan repo GitHub ini, tambahkan **Volume** dengan mount path `/app/data`, lalu isi Environment Variables dari `.env.example`.
- **Render.com / Fly.io / Koyeb**: Gunakan runtime Docker (`Dockerfile` sudah menggunakan `node:22-alpine`) dan pasang Persistent Disk di `/app/data`.
- **VPS (Ubuntu / CasaOS / Docker)**: Jalankan dengan `pm2 start src/server.js --name dompet-ai` atau `docker build -t dompet-ai . && docker run -d -p 3000:3000 -v $(pwd)/data:/app/data --env-file .env dompet-ai`.

---

## Cara Menjalankan Lokal
```bash
npm install
npm start
```
Buka **`http://localhost:3000`** untuk mengakses Dashboard Liquid Glass, melihat QR Code WhatsApp, atau menyalin script patch Google Spreadsheet (`updateDropdownDanAtmTanpaReset`).
