const { getAppsScriptTemplate } = require('../src/services/googleSheetsSync');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { setWalletBalance, getWallets, db } = require('../src/db/database');
const { processIncomingChat } = require('../src/services/messageProcessor');

async function runTests() {
  console.log('🧪 Menjalankan Verifikasi Alur Bot AI WA Pencatatan Keuangan...\n');

  // Save standalone Code.gs file for user's convenience
  const scriptDir = path.join(__dirname, '..', 'google-apps-script');
  if (!fs.existsSync(scriptDir)) fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptDir, 'Code.gs'),
    getAppsScriptTemplate('1_UvnRmnVZzxfzNp-mASlWtrpuqShcDD8ei8NuHK3YkM'),
    'utf8'
  );
  console.log('✅ File google-apps-script/Code.gs berhasil dibuat untuk Spreadsheet 1_UvnRmnVZzxfzNp-mASlWtrpuqShcDD8ei8NuHK3YkM');

  // Reset transactions and set clean starting balance: Tunai Rp 500.000, ATM Rp 2.500.000
  db.exec(`DELETE FROM transactions`);
  db.exec(`UPDATE wallets SET total_income = 0, total_expense = 0`);
  setWalletBalance('CASH', 500000);
  setWalletBalance('ATM', 2500000);
  setWalletBalance('ATM2', 1000000);

  let w = getWallets();
  assert.strictEqual(w.cash.balance, 500000, 'Saldo awal Tunai harus Rp 500.000');
  assert.strictEqual(w.atm.balance, 2500000, 'Saldo awal ATM 1 harus Rp 2.500.000');
  assert.strictEqual(w.atm2.balance, 1000000, 'Saldo awal ATM 2 harus Rp 1.000.000');
  console.log('✅ Saldo Awal: Tunai Rp 500.000 | ATM 1 Rp 2.500.000 | ATM 2 Rp 1.000.000');

  // Test 1: "beli makan seblak 10 ribu" (Otomatis potong Saldo Uang Tunai)
  const res1 = await processIncomingChat('beli makan seblak 10 ribu', 'WHATSAPP');
  assert.strictEqual(res1.handled, true);
  assert.strictEqual(res1.transactions[0].amount, 10000);
  assert.strictEqual(res1.transactions[0].wallet, 'CASH');
  assert.strictEqual(res1.wallets.cash.balance, 490000);
  assert.strictEqual(res1.wallets.atm.balance, 2500000);
  console.log('✅ Test 1 ("beli makan seblak 10 ribu") -> Saldo Tunai berkurang jadi Rp 490.000');

  // Test 2: "beli kopi 18rb pakai qris" (Otomatis potong Saldo ATM 2 Jajan! ATM 1 Simpanan tetap aman!)
  const res2 = await processIncomingChat('beli kopi 18rb pakai qris', 'WHATSAPP');
  assert.strictEqual(res2.handled, true);
  assert.strictEqual(res2.transactions[0].amount, 18000);
  assert.strictEqual(res2.transactions[0].wallet, 'ATM2');
  assert.strictEqual(res2.wallets.atm.balance, 2500000, 'ATM 1 (Simpanan) tidak boleh terpotong saat jajan QRIS');
  assert.strictEqual(res2.wallets.atm2.balance, 982000, 'ATM 2 (Jajan) berkurang jadi Rp 982.000');
  console.log('✅ Test 2 ("beli kopi 18rb pakai qris") -> Otomatis potong ATM 2 (Jajan) jadi Rp 982.000, ATM 1 (Simpanan) tetap Rp 2.500.000');

  // Test 3: "uang masuk 2 juta" (Otomatis masuk ke Saldo ATM 1 Simpanan)
  const res3 = await processIncomingChat('uang masuk 2 juta', 'WHATSAPP');
  assert.strictEqual(res3.handled, true);
  assert.strictEqual(res3.transactions[0].type, 'INCOME');
  assert.strictEqual(res3.transactions[0].wallet, 'ATM');
  assert.strictEqual(res3.wallets.atm.balance, 4500000);
  console.log('✅ Test 3 ("uang masuk 2 juta") -> Otomatis masuk ke ATM 1 (Simpanan) jadi Rp 4.500.000');

  // Test 4: "isi atm 2 500 ribu" (Pindah Saldo ATM 1 Simpanan -> ATM 2 Jajan)
  const res4 = await processIncomingChat('isi atm 2 500 ribu', 'WHATSAPP');
  assert.strictEqual(res4.handled, true);
  assert.strictEqual(res4.transactions[0].type, 'TRANSFER');
  assert.strictEqual(res4.transactions[0].wallet, 'ATM');
  assert.strictEqual(res4.transactions[0].target_wallet, 'ATM2');
  assert.strictEqual(res4.wallets.atm.balance, 4000000);
  assert.strictEqual(res4.wallets.atm2.balance, 1482000);
  console.log('✅ Test 4 ("isi atm 2 500 ribu") -> Pindah ATM 1 ke ATM 2: ATM 1 jadi Rp 4.000.000, ATM 2 jadi Rp 1.482.000');

  // Save standalone Code.gs file with latest transactions & balances included
  fs.writeFileSync(
    path.join(scriptDir, 'Code.gs'),
    getAppsScriptTemplate('1_UvnRmnVZzxfzNp-mASlWtrpuqShcDD8ei8NuHK3YkM'),
    'utf8'
  );
  console.log('\n🎉 Semua pengujian lulus 100%!');
}

runTests().catch((err) => {
  console.error('❌ Test gagal:', err);
  process.exit(1);
});
