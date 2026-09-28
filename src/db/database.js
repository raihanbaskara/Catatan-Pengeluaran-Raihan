const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
require('dotenv').config();

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'finance.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode for better concurrency & speed
db.exec(`PRAGMA journal_mode = WAL;`);

// Create schema
db.exec(`
  CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    initial_balance INTEGER NOT NULL DEFAULT 0,
    total_income INTEGER NOT NULL DEFAULT 0,
    total_expense INTEGER NOT NULL DEFAULT 0,
    balance INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    wallet TEXT NOT NULL,
    target_wallet TEXT,
    amount INTEGER NOT NULL,
    balance_after_cash INTEGER NOT NULL,
    balance_after_atm INTEGER NOT NULL,
    raw_message TEXT,
    source TEXT NOT NULL DEFAULT 'WHATSAPP',
    synced_to_sheets INTEGER NOT NULL DEFAULT 0,
    sheet_sync_error TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Seed default wallets if empty
const nowIso = () => new Date().toISOString();
const initialCash = parseInt(process.env.INITIAL_CASH_BALANCE || '420000', 10);
const initialAtm = parseInt(process.env.INITIAL_ATM_BALANCE || '8300000', 10);
const initialAtm2 = parseInt(process.env.INITIAL_ATM2_BALANCE || '4182000', 10);

const checkWalletStmt = db.prepare(`SELECT id FROM wallets WHERE id = ?`);
const insertWalletStmt = db.prepare(`
  INSERT INTO wallets (id, name, initial_balance, total_income, total_expense, balance, updated_at)
  VALUES (?, ?, ?, 0, 0, ?, ?)
`);

if (!checkWalletStmt.get('CASH')) {
  insertWalletStmt.run('CASH', 'Saldo Uang Tunai (Cash)', initialCash, initialCash, nowIso());
}
if (!checkWalletStmt.get('ATM')) {
  insertWalletStmt.run('ATM', 'Saldo ATM 1', initialAtm, initialAtm, nowIso());
} else {
  db.prepare(`UPDATE wallets SET name = 'Saldo ATM 1' WHERE id = 'ATM'`).run();
}
if (!checkWalletStmt.get('ATM2')) {
  insertWalletStmt.run('ATM2', 'Saldo ATM 2', initialAtm2, initialAtm2, nowIso());
}

// Clean up any accidental @lid strings that were recorded before the filter
try {
  const badRow = db.prepare(`SELECT seq FROM transactions WHERE raw_message LIKE '%@lid%'`).get();
  if (badRow) {
    db.exec(`DELETE FROM transactions WHERE raw_message LIKE '%@lid%' OR seq = 15`);
    db.exec(`UPDATE transactions SET balance_after_cash = 570000 WHERE seq = 16`);
    db.exec(`UPDATE wallets SET balance = 570000, total_expense = 30000, initial_balance = 500000 WHERE id = 'CASH'`);
  }
} catch {}

// Seed default settings
const defaultSettings = {
  spreadsheet_id: process.env.SPREADSHEET_ID || '1_UvnRmnVZzxfzNp-mASlWtrpuqShcDD8ei8NuHK3YkM',
  spreadsheet_url:
    process.env.SPREADSHEET_URL ||
    'https://docs.google.com/spreadsheets/d/1_UvnRmnVZzxfzNp-mASlWtrpuqShcDD8ei8NuHK3YkM/edit?usp=sharing',
  apps_script_webhook_url: process.env.APPS_SCRIPT_WEBHOOK_URL || '',
  google_service_account_json: '',
  ai_provider: process.env.AI_PROVIDER || 'openrouter',
  ai_base_url: process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
  ai_model: process.env.AI_MODEL || 'google/gemini-2.0-flash-exp:free',
  ai_api_key: process.env.AI_API_KEY || '',
  wa_whitelist: process.env.WA_WHITELIST || '6281335499566',
  fonnte_token: process.env.FONNTE_TOKEN || '',
  auto_sync_sheets: 'true',
};

const checkSettingStmt = db.prepare(`SELECT key FROM settings WHERE key = ?`);
const insertSettingStmt = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`);

for (const [k, v] of Object.entries(defaultSettings)) {
  if (!checkSettingStmt.get(k)) {
    insertSettingStmt.run(k, String(v));
  }
}

if (process.env.FONNTE_TOKEN) {
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'fonnte_token'`).run(process.env.FONNTE_TOKEN);
}

function getSettings() {
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  const result = { ...defaultSettings };
  for (const r of rows) {
    result[r.key] = r.value;
  }
  return result;
}

function updateSettings(updates) {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined && v !== null) {
      upsert.run(k, String(v));
    }
  }
  return getSettings();
}

function normalizeWalletId(raw) {
  const w = String(raw || 'CASH').toUpperCase().trim();
  if (w === 'ATM2' || w === 'ATM 2' || w === 'SALDO ATM 2') return 'ATM2';
  if (w === 'ATM' || w === 'ATM1' || w === 'ATM 1' || w === 'SALDO ATM 1' || w === 'SALDO ATM') return 'ATM';
  return 'CASH';
}

function getWallets() {
  const cash = db.prepare(`SELECT * FROM wallets WHERE id = 'CASH'`).get();
  const atm = db.prepare(`SELECT * FROM wallets WHERE id = 'ATM'`).get();
  const atm2 = db.prepare(`SELECT * FROM wallets WHERE id = 'ATM2'`).get();
  const totalBalance = (cash?.balance || 0) + (atm?.balance || 0) + (atm2?.balance || 0);
  const totalInitial = (cash?.initial_balance || 0) + (atm?.initial_balance || 0) + (atm2?.initial_balance || 0);
  const totalIncome = (cash?.total_income || 0) + (atm?.total_income || 0) + (atm2?.total_income || 0);
  const totalExpense = (cash?.total_expense || 0) + (atm?.total_expense || 0) + (atm2?.total_expense || 0);

  return {
    cash,
    atm,
    atm1: atm,
    atm2,
    total: {
      id: 'TOTAL',
      name: 'Total Saldo Gabungan',
      initial_balance: totalInitial,
      total_income: totalIncome,
      total_expense: totalExpense,
      balance: totalBalance,
      updated_at: cash?.updated_at || nowIso(),
    },
  };
}

function setWalletBalance(walletId, newBalance) {
  const targetId = normalizeWalletId(walletId);
  const current = db.prepare(`SELECT * FROM wallets WHERE id = ?`).get(targetId);
  if (!current) throw new Error(`Wallet ${targetId} tidak ditemukan`);

  const numericBalance = Math.round(Number(newBalance) || 0);
  // Adjust initial_balance so that initial + income - expense === newBalance
  const newInitial = numericBalance - current.total_income + current.total_expense;

  db.prepare(`
    UPDATE wallets
    SET balance = ?, initial_balance = ?, updated_at = ?
    WHERE id = ?
  `).run(numericBalance, newInitial, nowIso(), targetId);

  return getWallets();
}

function recordTransactions(items, rawMessage = '', source = 'WHATSAPP') {
  const createdTransactions = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of items) {
      const type = (item.type || 'EXPENSE').toUpperCase();
      const wallet = normalizeWalletId(item.wallet);
      const targetWallet = item.targetWallet ? normalizeWalletId(item.targetWallet) : null;
      const amount = Math.abs(Math.round(Number(item.amount) || 0));
      if (amount <= 0) continue;

      const category = item.category || (type === 'INCOME' ? 'Gaji & Pemasukan' : 'Lainnya');
      const description = item.description || 'Transaksi';
      const ts = nowIso();

      const cashRow = db.prepare(`SELECT * FROM wallets WHERE id = 'CASH'`).get();
      const atmRow = db.prepare(`SELECT * FROM wallets WHERE id = 'ATM'`).get();
      const atm2Row = db.prepare(`SELECT * FROM wallets WHERE id = 'ATM2'`).get();

      const state = {
        CASH: { ...cashRow },
        ATM: { ...atmRow },
        ATM2: { ...atm2Row },
      };

      if (type === 'EXPENSE') {
        state[wallet].balance -= amount;
        state[wallet].total_expense += amount;
      } else if (type === 'INCOME') {
        state[wallet].balance += amount;
        state[wallet].total_income += amount;
      } else if (type === 'TRANSFER') {
        const dest = targetWallet || (wallet === 'CASH' ? 'ATM' : 'CASH');
        if (wallet !== dest && state[wallet] && state[dest]) {
          state[wallet].balance -= amount;
          state[dest].balance += amount;
        }
      }

      for (const wid of ['CASH', 'ATM', 'ATM2']) {
        db.prepare(`
          UPDATE wallets
          SET balance = ?, total_income = ?, total_expense = ?, updated_at = ?
          WHERE id = ?
        `).run(state[wid].balance, state[wid].total_income, state[wid].total_expense, ts, wid);
      }

      const nextSeqRow = db.prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM transactions`).get();
      const txId = `#TRX-${String(nextSeqRow.nextSeq).padStart(4, '0')}`;

      db.prepare(`
        INSERT INTO transactions (
          id, created_at, type, category, description, wallet, target_wallet,
          amount, balance_after_cash, balance_after_atm, raw_message, source, synced_to_sheets
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        txId,
        ts,
        type,
        category,
        description,
        wallet,
        targetWallet,
        amount,
        state.CASH.balance,
        state.ATM.balance + state.ATM2.balance,
        rawMessage,
        source
      );

      const inserted = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(txId);
      createdTransactions.push(inserted);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return {
    transactions: createdTransactions,
    wallets: getWallets(),
  };
}

function undoLastTransaction() {
  const lastTx = db.prepare(`SELECT * FROM transactions ORDER BY seq DESC LIMIT 1`).get();
  if (!lastTx) {
    return null;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const cashRow = db.prepare(`SELECT * FROM wallets WHERE id = 'CASH'`).get();
    const atmRow = db.prepare(`SELECT * FROM wallets WHERE id = 'ATM'`).get();
    const atm2Row = db.prepare(`SELECT * FROM wallets WHERE id = 'ATM2'`).get();

    const state = {
      CASH: { ...cashRow },
      ATM: { ...atmRow },
      ATM2: { ...atm2Row },
    };

    const { type, amount } = lastTx;
    const wallet = normalizeWalletId(lastTx.wallet);
    const targetWallet = lastTx.target_wallet ? normalizeWalletId(lastTx.target_wallet) : null;

    if (type === 'EXPENSE') {
      state[wallet].balance += amount;
      state[wallet].total_expense = Math.max(0, state[wallet].total_expense - amount);
    } else if (type === 'INCOME') {
      state[wallet].balance -= amount;
      state[wallet].total_income = Math.max(0, state[wallet].total_income - amount);
    } else if (type === 'TRANSFER') {
      const dest = targetWallet || (wallet === 'CASH' ? 'ATM' : 'CASH');
      if (wallet !== dest && state[wallet] && state[dest]) {
        state[wallet].balance += amount;
        state[dest].balance -= amount;
      }
    }

    const ts = nowIso();
    for (const wid of ['CASH', 'ATM', 'ATM2']) {
      db.prepare(`
        UPDATE wallets SET balance = ?, total_income = ?, total_expense = ?, updated_at = ? WHERE id = ?
      `).run(state[wid].balance, state[wid].total_income, state[wid].total_expense, ts, wid);
    }

    db.prepare(`DELETE FROM transactions WHERE seq = ?`).run(lastTx.seq);

    db.exec('COMMIT');
    return {
      undoneTransaction: lastTx,
      wallets: getWallets(),
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getTransactions({ limit = 100, wallet = null, type = null } = {}) {
  let sql = `SELECT * FROM transactions WHERE 1=1`;
  const params = [];
  if (wallet && (wallet === 'CASH' || wallet === 'ATM')) {
    sql += ` AND (wallet = ? OR target_wallet = ?)`;
    params.push(wallet, wallet);
  }
  if (type && ['EXPENSE', 'INCOME', 'TRANSFER'].includes(type)) {
    sql += ` AND type = ?`;
    params.push(type);
  }
  sql += ` ORDER BY seq DESC LIMIT ?`;
  params.push(limit);

  return db.prepare(sql).all(...params);
}

function markTransactionSynced(txId, errorMsg = null) {
  if (errorMsg) {
    db.prepare(`UPDATE transactions SET synced_to_sheets = 0, sheet_sync_error = ? WHERE id = ?`).run(
      String(errorMsg),
      txId
    );
  } else {
    db.prepare(`UPDATE transactions SET synced_to_sheets = 1, sheet_sync_error = NULL WHERE id = ?`).run(txId);
  }
}

function getUnsyncedTransactions() {
  return db.prepare(`SELECT * FROM transactions WHERE synced_to_sheets = 0 ORDER BY seq ASC`).all();
}

function getDashboardSummary() {
  const wallets = getWallets();
  const transactions = getTransactions({ limit: 100 });

  // Category breakdown for EXPENSE
  const categoryRows = db.prepare(`
    SELECT category, wallet, SUM(amount) AS total, COUNT(*) AS count
    FROM transactions
    WHERE type = 'EXPENSE'
    GROUP BY category, wallet
    ORDER BY total DESC
  `).all();

  const categoryMap = {};
  for (const row of categoryRows) {
    if (!categoryMap[row.category]) {
      categoryMap[row.category] = { category: row.category, total: 0, cash: 0, atm: 0, count: 0 };
    }
    categoryMap[row.category].total += row.total;
    categoryMap[row.category].count += row.count;
    if (row.wallet === 'CASH') categoryMap[row.category].cash += row.total;
    if (row.wallet === 'ATM') categoryMap[row.category].atm += row.total;
  }

  // Today's stats
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const todayStats = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'EXPENSE' AND wallet = 'CASH' THEN amount ELSE 0 END), 0) AS expense_cash_today,
      COALESCE(SUM(CASE WHEN type = 'EXPENSE' AND wallet = 'ATM' THEN amount ELSE 0 END), 0) AS expense_atm_today,
      COALESCE(SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END), 0) AS expense_total_today,
      COALESCE(SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END), 0) AS income_total_today,
      COUNT(*) AS tx_count_today
    FROM transactions
    WHERE substr(created_at, 1, 10) = ?
  `).get(todayPrefix);

  return {
    wallets,
    todayStats,
    categories: Object.values(categoryMap).sort((a, b) => b.total - a.total),
    transactions,
    settings: getSettings(),
  };
}

module.exports = {
  db,
  getSettings,
  updateSettings,
  getWallets,
  setWalletBalance,
  recordTransactions,
  undoLastTransaction,
  getTransactions,
  getUnsyncedTransactions,
  markTransactionSynced,
  getDashboardSummary,
};
