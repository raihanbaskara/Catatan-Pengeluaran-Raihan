const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config();

// Automatically use /tmp/dompet-ai-data when running on Vercel Serverless (where /var/task is read-only)
const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : isVercel
  ? path.join('/tmp', 'dompet-ai-data')
  : path.join(__dirname, '..', '..', 'data');

try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
} catch {}

const nowIso = () => new Date().toISOString();
const initialCash = parseInt(process.env.INITIAL_CASH_BALANCE || '0', 10);
const initialAtm = parseInt(process.env.INITIAL_ATM_BALANCE || '0', 10);
const initialAtm2 = parseInt(process.env.INITIAL_ATM2_BALANCE || '0', 10);

const defaultSettings = {
  spreadsheet_id: process.env.SPREADSHEET_ID || '1_UvnRmnVZzxfzNp-mASlWtrpuqShcDD8ei8NuHK3YkM',
  spreadsheet_url:
    process.env.SPREADSHEET_URL ||
    'https://docs.google.com/spreadsheets/d/1_UvnRmnVZzxfzNp-mASlWtrpuqShcDD8ei8NuHK3YkM/edit?usp=sharing',
  apps_script_webhook_url:
    process.env.APPS_SCRIPT_WEBHOOK_URL ||
    'https://script.google.com/macros/s/AKfycbxdhh_Lfug1rDisxX4KTShgwMb5NzcBQPm-zP76vZHwZycZ55uhT8Qk8ooYzCpSo85mBw/exec',
  google_service_account_json: '',
  ai_provider: process.env.AI_PROVIDER || 'openrouter',
  ai_base_url: process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
  ai_model: process.env.AI_MODEL || 'qwen/qwen3.8-27b:free',
  ai_api_key: process.env.AI_API_KEY || '',
  wa_whitelist: process.env.WA_WHITELIST || '6281335499566',
  fonnte_token: process.env.FONNTE_TOKEN || '',
  auto_sync_sheets: 'true',
};

function normalizeWalletId(raw) {
  const w = String(raw || 'CASH').toUpperCase().trim();
  if (w === 'ATM2' || w === 'ATM 2' || w === 'SALDO ATM 2') return 'ATM2';
  if (w === 'ATM' || w === 'ATM1' || w === 'ATM 1' || w === 'SALDO ATM 1' || w === 'SALDO ATM') return 'ATM';
  return 'CASH';
}

// Try loading built-in node:sqlite (Node 22+), with automatic fallback to JSON store for Vercel Node 18/20
let db = null;
let useSqlite = false;

try {
  const { DatabaseSync } = require('node:sqlite');
  const dbPath = path.join(dataDir, 'finance.db');
  db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode = WAL;`);
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
      balance_after_atm2 INTEGER NOT NULL DEFAULT 0,
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

  // Ensure balance_after_atm2 column exists on existing SQLite DBs
  try {
    db.exec(`ALTER TABLE transactions ADD COLUMN balance_after_atm2 INTEGER NOT NULL DEFAULT 0;`);
  } catch {}

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
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'apps_script_webhook_url' AND (value = '' OR value IS NULL)`).run(
    defaultSettings.apps_script_webhook_url
  );
  useSqlite = true;
} catch {
  useSqlite = false;
}

// Fallback JSON Store for Serverless environments without node:sqlite (e.g. Vercel Node 18/20)
const jsonStorePath = path.join(dataDir, 'ledger.json');
let memoryStore = {
  wallets: {
    CASH: { id: 'CASH', name: 'Saldo Uang Tunai (Cash)', initial_balance: initialCash, total_income: 0, total_expense: 0, balance: initialCash, updated_at: nowIso() },
    ATM: { id: 'ATM', name: 'Saldo ATM 1', initial_balance: initialAtm, total_income: 0, total_expense: 0, balance: initialAtm, updated_at: nowIso() },
    ATM2: { id: 'ATM2', name: 'Saldo ATM 2', initial_balance: initialAtm2, total_income: 0, total_expense: 0, balance: initialAtm2, updated_at: nowIso() },
  },
  transactions: [],
  settings: { ...defaultSettings },
};

function loadJsonStore() {
  try {
    if (fs.existsSync(jsonStorePath)) {
      const parsed = JSON.parse(fs.readFileSync(jsonStorePath, 'utf8'));
      if (parsed && parsed.wallets) {
        memoryStore = {
          wallets: { ...memoryStore.wallets, ...parsed.wallets },
          transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
          settings: { ...defaultSettings, ...(parsed.settings || {}) },
        };
      }
    }
  } catch {}
}

function saveJsonStore() {
  try {
    fs.writeFileSync(jsonStorePath, JSON.stringify(memoryStore, null, 2), 'utf8');
  } catch {}
}

if (!useSqlite) {
  loadJsonStore();
}

function getSettings() {
  if (useSqlite) {
    const rows = db.prepare(`SELECT key, value FROM settings`).all();
    const result = { ...defaultSettings };
    for (const r of rows) {
      result[r.key] = r.value;
    }
    // Environment variables always override empty DB settings on Vercel
    for (const [k, v] of Object.entries(defaultSettings)) {
      if (!result[k] && v) result[k] = String(v);
    }
    return result;
  }
  loadJsonStore();
  const res = { ...defaultSettings, ...memoryStore.settings };
  for (const [k, v] of Object.entries(defaultSettings)) {
    if (!res[k] && v) res[k] = String(v);
  }
  return res;
}

function updateSettings(updates) {
  if (useSqlite) {
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
  loadJsonStore();
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined && v !== null) {
      memoryStore.settings[k] = String(v);
    }
  }
  saveJsonStore();
  return getSettings();
}

function getWallets() {
  let cash, atm, atm2;
  if (useSqlite) {
    cash = db.prepare(`SELECT * FROM wallets WHERE id = 'CASH'`).get();
    atm = db.prepare(`SELECT * FROM wallets WHERE id = 'ATM'`).get();
    atm2 = db.prepare(`SELECT * FROM wallets WHERE id = 'ATM2'`).get();
  } else {
    loadJsonStore();
    cash = memoryStore.wallets.CASH;
    atm = memoryStore.wallets.ATM;
    atm2 = memoryStore.wallets.ATM2;
  }

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
  const numericBalance = Math.round(Number(newBalance) || 0);

  if (useSqlite) {
    const current = db.prepare(`SELECT * FROM wallets WHERE id = ?`).get(targetId);
    if (!current) throw new Error(`Wallet ${targetId} tidak ditemukan`);
    if (numericBalance === 0) {
      db.prepare(`
        UPDATE wallets
        SET balance = 0, initial_balance = 0, total_income = 0, total_expense = 0, updated_at = ?
        WHERE id = ?
      `).run(nowIso(), targetId);
      const w = getWallets();
      if ((w.cash?.balance || 0) === 0 && (w.atm?.balance || 0) === 0 && (w.atm2?.balance || 0) === 0) {
        db.exec(`DELETE FROM transactions`);
      }
    } else {
      const newInitial = numericBalance - current.total_income + current.total_expense;
      db.prepare(`
        UPDATE wallets
        SET balance = ?, initial_balance = ?, updated_at = ?
        WHERE id = ?
      `).run(numericBalance, newInitial, nowIso(), targetId);
    }
    return getWallets();
  }

  loadJsonStore();
  const current = memoryStore.wallets[targetId];
  if (!current) throw new Error(`Wallet ${targetId} tidak ditemukan`);
  if (numericBalance === 0) {
    current.balance = 0;
    current.initial_balance = 0;
    current.total_income = 0;
    current.total_expense = 0;
    if (
      (memoryStore.wallets.CASH?.balance || 0) === 0 &&
      (memoryStore.wallets.ATM?.balance || 0) === 0 &&
      (memoryStore.wallets.ATM2?.balance || 0) === 0
    ) {
      memoryStore.transactions = [];
    }
  } else {
    current.balance = numericBalance;
    current.initial_balance = numericBalance - current.total_income + current.total_expense;
  }
  current.updated_at = nowIso();
  saveJsonStore();
  return getWallets();
}

// Hydrate local /tmp database from Google Spreadsheet state on Vercel cold starts
function hydrateStateFromCloud(cloudData) {
  if (!cloudData || typeof cloudData !== 'object') return;
  try {
    if (cloudData.wallets) {
      if (typeof cloudData.wallets.cash === 'number') setWalletBalance('CASH', cloudData.wallets.cash);
      if (typeof cloudData.wallets.atm1 === 'number') setWalletBalance('ATM', cloudData.wallets.atm1);
      if (typeof cloudData.wallets.atm2 === 'number') setWalletBalance('ATM2', cloudData.wallets.atm2);
    }
  } catch {}
}

function recordTransactions(items, rawMessage = '', source = 'WHATSAPP') {
  const createdTransactions = [];

  if (useSqlite) {
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

        const state = {
          CASH: { ...db.prepare(`SELECT * FROM wallets WHERE id = 'CASH'`).get() },
          ATM: { ...db.prepare(`SELECT * FROM wallets WHERE id = 'ATM'`).get() },
          ATM2: { ...db.prepare(`SELECT * FROM wallets WHERE id = 'ATM2'`).get() },
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
            amount, balance_after_cash, balance_after_atm, balance_after_atm2, raw_message, source, synced_to_sheets
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
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
          state.ATM.balance,
          state.ATM2.balance,
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

  // JSON Fallback execution
  loadJsonStore();
  for (const item of items) {
    const type = (item.type || 'EXPENSE').toUpperCase();
    const wallet = normalizeWalletId(item.wallet);
    const targetWallet = item.targetWallet ? normalizeWalletId(item.targetWallet) : null;
    const amount = Math.abs(Math.round(Number(item.amount) || 0));
    if (amount <= 0) continue;

    const category = item.category || (type === 'INCOME' ? 'Gaji & Pemasukan' : 'Lainnya');
    const description = item.description || 'Transaksi';
    const ts = nowIso();
    const state = memoryStore.wallets;

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

    const nextSeq = (memoryStore.transactions.reduce((m, t) => Math.max(m, t.seq || 0), 0) || 0) + 1;
    const txId = `#TRX-${String(nextSeq).padStart(4, '0')}`;
    const inserted = {
      seq: nextSeq,
      id: txId,
      created_at: ts,
      type,
      category,
      description,
      wallet,
      target_wallet: targetWallet,
      amount,
      balance_after_cash: state.CASH.balance,
      balance_after_atm: state.ATM.balance,
      balance_after_atm2: state.ATM2.balance,
      raw_message: rawMessage,
      source,
      synced_to_sheets: 0,
      sheet_sync_error: null,
    };
    memoryStore.transactions.push(inserted);
    createdTransactions.push(inserted);
  }
  saveJsonStore();
  return {
    transactions: createdTransactions,
    wallets: getWallets(),
  };
}

function undoLastTransaction() {
  if (useSqlite) {
    const lastTx = db.prepare(`SELECT * FROM transactions ORDER BY seq DESC LIMIT 1`).get();
    if (!lastTx) return null;

    db.exec('BEGIN IMMEDIATE');
    try {
      const state = {
        CASH: { ...db.prepare(`SELECT * FROM wallets WHERE id = 'CASH'`).get() },
        ATM: { ...db.prepare(`SELECT * FROM wallets WHERE id = 'ATM'`).get() },
        ATM2: { ...db.prepare(`SELECT * FROM wallets WHERE id = 'ATM2'`).get() },
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

  loadJsonStore();
  if (memoryStore.transactions.length === 0) return null;
  const lastTx = memoryStore.transactions.pop();
  const state = memoryStore.wallets;
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
  saveJsonStore();
  return {
    undoneTransaction: lastTx,
    wallets: getWallets(),
  };
}

function getTransactions({ limit = 100, wallet = null, type = null } = {}) {
  if (useSqlite) {
    let sql = `SELECT * FROM transactions WHERE 1=1`;
    const params = [];
    if (wallet && ['CASH', 'ATM', 'ATM2'].includes(wallet)) {
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

  loadJsonStore();
  return [...memoryStore.transactions]
    .reverse()
    .filter((tx) => {
      if (wallet && ['CASH', 'ATM', 'ATM2'].includes(wallet)) {
        if (tx.wallet !== wallet && tx.target_wallet !== wallet) return false;
      }
      if (type && ['EXPENSE', 'INCOME', 'TRANSFER'].includes(type)) {
        if (tx.type !== type) return false;
      }
      return true;
    })
    .slice(0, limit);
}

function markTransactionSynced(txId, errorMsg = null) {
  if (useSqlite) {
    if (errorMsg) {
      db.prepare(`UPDATE transactions SET synced_to_sheets = 0, sheet_sync_error = ? WHERE id = ?`).run(
        String(errorMsg),
        txId
      );
    } else {
      db.prepare(`UPDATE transactions SET synced_to_sheets = 1, sheet_sync_error = NULL WHERE id = ?`).run(txId);
    }
    return;
  }
  loadJsonStore();
  const found = memoryStore.transactions.find((t) => t.id === txId);
  if (found) {
    found.synced_to_sheets = errorMsg ? 0 : 1;
    found.sheet_sync_error = errorMsg ? String(errorMsg) : null;
    saveJsonStore();
  }
}

function getUnsyncedTransactions() {
  if (useSqlite) {
    return db.prepare(`SELECT * FROM transactions WHERE synced_to_sheets = 0 ORDER BY seq ASC`).all();
  }
  loadJsonStore();
  return memoryStore.transactions.filter((t) => !t.synced_to_sheets);
}

function getDashboardSummary() {
  const wallets = getWallets();
  const transactions = getTransactions({ limit: 100 });

  const categoryMap = {};
  for (const tx of transactions) {
    if (tx.type !== 'EXPENSE') continue;
    if (!categoryMap[tx.category]) {
      categoryMap[tx.category] = { category: tx.category, total: 0, cash: 0, atm: 0, atm2: 0, count: 0 };
    }
    categoryMap[tx.category].total += tx.amount;
    categoryMap[tx.category].count += 1;
    if (tx.wallet === 'CASH') categoryMap[tx.category].cash += tx.amount;
    if (tx.wallet === 'ATM') categoryMap[tx.category].atm += tx.amount;
    if (tx.wallet === 'ATM2') categoryMap[tx.category].atm2 += tx.amount;
  }

  const todayPrefix = new Date().toISOString().slice(0, 10);
  let expenseCashToday = 0;
  let expenseAtmToday = 0;
  let expenseTotalToday = 0;
  let incomeTotalToday = 0;
  let txCountToday = 0;

  for (const tx of transactions) {
    if (String(tx.created_at || '').slice(0, 10) !== todayPrefix) continue;
    txCountToday += 1;
    if (tx.type === 'EXPENSE') {
      expenseTotalToday += tx.amount;
      if (tx.wallet === 'CASH') expenseCashToday += tx.amount;
      else expenseAtmToday += tx.amount;
    } else if (tx.type === 'INCOME') {
      incomeTotalToday += tx.amount;
    }
  }

  return {
    wallets,
    todayStats: {
      expense_cash_today: expenseCashToday,
      expense_atm_today: expenseAtmToday,
      expense_total_today: expenseTotalToday,
      income_total_today: incomeTotalToday,
      tx_count_today: txCountToday,
    },
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
  hydrateStateFromCloud,
  recordTransactions,
  undoLastTransaction,
  getTransactions,
  getUnsyncedTransactions,
  markTransactionSynced,
  getDashboardSummary,
};
