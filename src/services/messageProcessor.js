const {
  getWallets,
  setWalletBalance,
  recordTransactions,
  undoLastTransaction,
  getDashboardSummary,
} = require('../db/database');
const { parseFinancialMessage } = require('./aiParser');
const { syncToGoogleSheets, formatRupiah } = require('./googleSheetsSync');

/**
 * Processes an incoming user chat message (from WA or Web Simulator),
 * updates SQLite Database (Cash & ATM balances), syncs to Google Spreadsheet,
 * notifies connected Dashboard clients, and returns the formatted WhatsApp reply.
 */
function getWalletDisplayName(walletId) {
  if (walletId === 'ATM2') return '💳 Saldo ATM 2 (Jajan)';
  if (walletId === 'ATM') return '🏦 Saldo ATM 1 (Simpanan)';
  return '💵 Saldo Uang Tunai';
}

async function processIncomingChat(rawMessage, source = 'WHATSAPP', onStateChanged = null) {
  const parsed = await parseFinancialMessage(rawMessage);
  const notify = () => {
    if (typeof onStateChanged === 'function') {
      try {
        onStateChanged();
      } catch {}
    }
  };

  // 1. Intent: CHECK_BALANCE ("cek saldo", "info saldo")
  if (parsed.intent === 'CHECK_BALANCE') {
    const w = getWallets();
    const reply = [
      `📊 *INFORMASI SALDO SAAT INI*`,
      `━━━━━━━━━━━━━━━━━━`,
      `💵 *Saldo Uang Tunai:* ${formatRupiah(w.cash.balance)}`,
      `🏦 *Saldo ATM 1 (Simpanan):* ${formatRupiah(w.atm.balance)}`,
      `💳 *Saldo ATM 2 (Jajan):* ${formatRupiah((w.atm2 && w.atm2.balance) || 0)}`,
      `━━━━━━━━━━━━━━━━━━`,
      `💰 *Total Saldo Gabungan:* *${formatRupiah(w.total.balance)}*`,
      ``,
      `_Tips Chat:_`,
      `• _"beli bensin 20rb"_ ➔ potong Tunai`,
      `• _"beli kopi 18rb pakai qris"_ ➔ potong ATM 2 (Jajan)`,
      `• _"uang masuk 3 juta"_ ➔ masuk ATM 1 (Simpanan)`,
      `• _"isi atm 2 500rb"_ ➔ pindah ATM 1 ke ATM 2`,
    ].join('\n');

    return {
      handled: true,
      intent: 'CHECK_BALANCE',
      reply,
      wallets: w,
    };
  }

  // 2. Intent: SET_BALANCE ("set saldo tunai 300rb", "atur saldo atm 2 1,5 juta")
  if (parsed.intent === 'SET_BALANCE') {
    const wallets = setWalletBalance(parsed.wallet, parsed.amount);
    const syncRes = await syncToGoogleSheets([], true);
    notify();

    const walletLabel = getWalletDisplayName(parsed.wallet);
    const reply = [
      `✅ *SALDO BERHASIL DIATUR!*`,
      `━━━━━━━━━━━━━━━━━━`,
      `${walletLabel} diatur menjadi: *${formatRupiah(parsed.amount)}*`,
      ``,
      `📊 *Posisi Saldo Sekarang:*`,
      `💵 Uang Tunai: *${formatRupiah(wallets.cash.balance)}*`,
      `🏦 Saldo ATM 1 (Simpanan): *${formatRupiah(wallets.atm.balance)}*`,
      `💳 Saldo ATM 2 (Jajan): *${formatRupiah((wallets.atm2 && wallets.atm2.balance) || 0)}*`,
      `💰 Total Saldo: *${formatRupiah(wallets.total.balance)}*`,
      syncRes.synced ? `📗 _Spreadsheet otomatis terupdate!_` : `💻 _Dashboard otomatis terupdate!_`,
    ].join('\n');

    return {
      handled: true,
      intent: 'SET_BALANCE',
      reply,
      wallets,
      sheetSync: syncRes,
    };
  }

  // 3. Intent: UNDO ("batal", "undo", "hapus terakhir")
  if (parsed.intent === 'UNDO') {
    const undoResult = undoLastTransaction();
    if (!undoResult) {
      return {
        handled: true,
        intent: 'UNDO',
        reply: `⚠️ Belum ada transaksi yang bisa dibatalkan.`,
      };
    }

    const syncRes = await syncToGoogleSheets([], true);
    notify();

    const tx = undoResult.undoneTransaction;
    const w = undoResult.wallets;
    const reply = [
      `↩️ *TRANSAKSI TERAKHIR DIBATALKAN*`,
      `━━━━━━━━━━━━━━━━━━`,
      `🗑️ Dihapus: *${tx.description}* (${formatRupiah(tx.amount)} - ${getWalletDisplayName(tx.wallet)})`,
      ``,
      `📊 *Saldo Dikembalikan Menjadi:*`,
      `💵 Uang Tunai: *${formatRupiah(w.cash.balance)}*`,
      `🏦 Saldo ATM 1 (Simpanan): *${formatRupiah(w.atm.balance)}*`,
      `💳 Saldo ATM 2 (Jajan): *${formatRupiah((w.atm2 && w.atm2.balance) || 0)}*`,
      `💰 Total Saldo: *${formatRupiah(w.total.balance)}*`,
    ].join('\n');

    return {
      handled: true,
      intent: 'UNDO',
      reply,
      wallets: w,
      sheetSync: syncRes,
    };
  }

  // 4. Intent: SUMMARY ("rekap", "laporan")
  if (parsed.intent === 'SUMMARY') {
    const summary = getDashboardSummary();
    const w = summary.wallets;
    const t = summary.todayStats;
    const reply = [
      `📈 *REKAP KEUANGAN HARI INI*`,
      `━━━━━━━━━━━━━━━━━━`,
      `💸 Pengeluaran Tunai Hari Ini: *${formatRupiah(t.expense_cash_today)}*`,
      `💳 Pengeluaran ATM Hari Ini: *${formatRupiah(t.expense_atm_today)}*`,
      `🔥 Total Keluar Hari Ini: *${formatRupiah(t.expense_total_today)}* (${t.tx_count_today} transaksi)`,
      `📥 Total Pemasukan Hari Ini: *${formatRupiah(t.income_total_today)}*`,
      `━━━━━━━━━━━━━━━━━━`,
      `💵 *Sisa Saldo Tunai:* ${formatRupiah(w.cash.balance)}`,
      `🏦 *Sisa Saldo ATM 1 (Simpanan):* ${formatRupiah(w.atm.balance)}`,
      `💳 *Sisa Saldo ATM 2 (Jajan):* ${formatRupiah((w.atm2 && w.atm2.balance) || 0)}`,
      `💰 *Total Saldo:* *${formatRupiah(w.total.balance)}*`,
    ].join('\n');

    return {
      handled: true,
      intent: 'SUMMARY',
      reply,
      wallets: w,
    };
  }

  // 5. Intent: TRANSACTION (e.g. "beli makan seblak 10 ribu")
  if (parsed.intent === 'TRANSACTION' && parsed.items && parsed.items.length > 0) {
    const { transactions, wallets } = recordTransactions(parsed.items, rawMessage, source);
    const syncRes = await syncToGoogleSheets(transactions, false);
    notify();

    const itemLines = transactions.map((tx) => {
      if (tx.type === 'TRANSFER') {
        const fromLabel = getWalletDisplayName(tx.wallet);
        const toLabel = getWalletDisplayName(tx.target_wallet || 'CASH');
        return `🔄 *${tx.description}*\n    Nominal: *${formatRupiah(tx.amount)}* (${fromLabel} ➡️ ${toLabel})`;
      }
      const sign = tx.type === 'EXPENSE' ? '-' : '+';
      const icon = tx.type === 'EXPENSE' ? '💸' : '💰';
      const walletBadge = getWalletDisplayName(tx.wallet);
      return [
        `${icon} *${tx.description}* (${tx.id})`,
        `   🏷️ Kategori: ${tx.category}`,
        `   💵 Nominal: *${sign}${formatRupiah(tx.amount)}*`,
        `   👛 Dompet: *${walletBadge}*`,
      ].join('\n');
    });

    const sheetStatusLine = syncRes.synced
      ? `📗 *Spreadsheet:* Tercatat & Saldo Terupdate Otomatis ✅`
      : `💻 *Dashboard:* Tercatat & Saldo Terupdate Otomatis ✅`;

    const reply = [
      `✅ *TRANSAKSI BERHASIL DICATAT!*`,
      `━━━━━━━━━━━━━━━━━━`,
      itemLines.join('\n\n'),
      `━━━━━━━━━━━━━━━━━━`,
      `📊 *SISA SALDO SEKARANG:*`,
      `💵 *Saldo Uang Tunai:* *${formatRupiah(wallets.cash.balance)}*`,
      `🏦 *Saldo ATM 1 (Simpanan):* *${formatRupiah(wallets.atm.balance)}*`,
      `💳 *Saldo ATM 2 (Jajan):* *${formatRupiah((wallets.atm2 && wallets.atm2.balance) || 0)}*`,
      `💰 *Total Gabungan:* *${formatRupiah(wallets.total.balance)}*`,
      `━━━━━━━━━━━━━━━━━━`,
      sheetStatusLine,
      `_Ketik "batal" jika salah input._`,
    ].join('\n');

    return {
      handled: true,
      intent: 'TRANSACTION',
      provider: parsed.provider,
      transactions,
      wallets,
      sheetSync: syncRes,
      reply,
    };
  }

  return {
    handled: false,
    intent: 'UNKNOWN',
    reply: null,
  };
}

module.exports = {
  processIncomingChat,
};
