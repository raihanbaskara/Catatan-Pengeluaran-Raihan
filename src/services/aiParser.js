const { getSettings } = require('../db/database');

/**
 * Parses Indonesian amount strings like:
 * "10 ribu", "10rb", "10k", "10.000", "1,5 juta", "1.5jt", "250rb", "secepek", "goceng", "ceban"
 */
function parseIndonesianAmount(text) {
  if (!text) return 0;
  let str = text.toLowerCase().trim();

  // Common Indonesian slang amounts
  const slangMap = {
    goceng: 5000,
    ceban: 10000,
    goban: 50000,
    cepek: 100000,
    secepek: 100000,
    seceng: 1000,
  };
  for (const [slang, val] of Object.entries(slangMap)) {
    if (new RegExp(`\\b${slang}\\b`, 'i').test(str)) {
      return val;
    }
  }

  // Match patterns like: 1.5 juta, 1,5jt, 10 ribu, 10rb, 10k, Rp 15.000, 15000
  const unitRegex = /(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(juta|jt|ribu|rb|k)\b/i;
  const unitMatch = str.match(unitRegex);
  if (unitMatch) {
    const rawNum = parseFloat(unitMatch[1].replace(',', '.'));
    const unit = unitMatch[2].toLowerCase();
    if (unit === 'juta' || unit === 'jt') {
      return Math.round(rawNum * 1_000_000);
    }
    if (unit === 'ribu' || unit === 'rb' || unit === 'k') {
      return Math.round(rawNum * 1_000);
    }
  }

  // Match formatted thousand separator like 10.000 or 2.500.000
  const formattedMatch = str.match(/(?:rp\.?\s*)?(\d{1,3}(?:\.\d{3})+)/i);
  if (formattedMatch) {
    return parseInt(formattedMatch[1].replace(/\./g, ''), 10);
  }

  // Plain integer e.g. 10000 or 25000
  const plainMatch = str.match(/(?:rp\.?\s*)?(\d{4,10})\b/);
  if (plainMatch) {
    return parseInt(plainMatch[1], 10);
  }

  // Small number where user wrote "beli seblak 10" meaning 10rb if context is currency
  const smallMatch = str.match(/\b(\d{1,3})\b/);
  if (smallMatch) {
    const val = parseInt(smallMatch[1], 10);
    return val < 500 ? val * 1000 : val;
  }

  return 0;
}

/**
 * Detects wallet ('CASH' vs 'ATM') based on keywords.
 * Rule from user: Default is CASH (Saldo Uang Tunai), unless ATM/QRIS/Transfer/Bank keywords appear.
 */
function detectWallet(text, type = 'EXPENSE') {
  const lower = text.toLowerCase();
  const atmKeywords = [
    'atm',
    'qris',
    'qr',
    'tf',
    'transfer',
    'debit',
    'bank',
    'bca',
    'bri',
    'bni',
    'mandiri',
    'bsi',
    'jago',
    'seabank',
    'gopay',
    'ovo',
    'dana',
    'shopeepay',
    'mbanking',
    'm-banking',
    'rekening',
    'kartu',
    'non tunai',
    'cashless',
  ];
  if (/\b(atm\s*1|rekening\s*1|bank\s*1|simpanan)\b/i.test(lower)) {
    return 'ATM';
  }
  if (/\b(atm\s*2|rekening\s*2|bank\s*2|jajan)\b/i.test(lower) && /\b(atm|rekening|bank|qris|tf|transfer)\b/i.test(lower)) {
    return 'ATM2';
  }
  if (/\b(atm\s*2|rekening\s*2|bank\s*2)\b/i.test(lower)) {
    return 'ATM2';
  }
  if (/\b(uang\s*tunai|tunai|cash)\b/i.test(lower)) {
    return 'CASH';
  }

  // Untuk PEMASUKAN (uang masuk / gaji / kiriman): otomatis masuk ke ATM 1 (Simpanan) kecuali disebut tunai/cash
  if (type === 'INCOME') {
    if (/(gaji|uang\s*masuk|kiriman|transfer|tf|atm|rekening|bank)/i.test(lower)) {
      return 'ATM';
    }
  }

  // Untuk PENGELUARAN non-tunai (qris, tf, transfer, debit, atm): otomatis potong ATM 2 (Rekening Jajan)
  // supaya ATM 1 (Simpanan) tetap aman!
  for (const kw of atmKeywords) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(lower)) {
      return type === 'INCOME' ? 'ATM' : 'ATM2';
    }
  }
  return 'CASH';
}

/**
 * Detects transaction category from Indonesian description
 */
function detectCategory(text, type = 'EXPENSE') {
  const lower = text.toLowerCase();
  if (type === 'TRANSFER') return 'Tarik / Setor Tunai';
  if (type === 'INCOME') {
    if (/(gaji|upah|thr|bonus)/i.test(lower)) return 'Gaji & Bonus';
    if (/(jual|jualan|profit|untung|freelance|proyek)/i.test(lower)) return 'Bisnis & Freelance';
    if (/(dikasih|uang jajan|kiriman|hadiah)/i.test(lower)) return 'Uang Saku & Kiriman';
    return 'Pemasukan Lainnya';
  }

  if (
    /(makan|minum|seblak|bakso|mie|nasi|ayam|kopi|es\b|teh|jajan|snack|sarapan| makan|warteg|resto|cafe|gofood|grabfood|air|cilok|gorengan|sate|soto|pecel)/i.test(
      lower
    )
  ) {
    return 'Makanan & Minuman';
  }
  if (/(bensin|pertalite|pertamax|parkir|ojol|gojek|grab|maxim|tol|kereta|bus|transport|service motor|oli|ban)/i.test(lower)) {
    return 'Transportasi';
  }
  if (/(listrik|token|wifi|indihome|pulsa|kuota|paket data|pdam|air|kos|kontrakan|sewa|tagihan|cicilan)/i.test(lower)) {
    return 'Tagihan & Utilitas';
  }
  if (/(beli baju|celana|sepatu|skincare|sabun|shampoo|indomaret|alfamart|shopee|tokopedia|tiktok shop|belanja|kado)/i.test(lower)) {
    return 'Belanja & Kebutuhan';
  }
  if (/(nonton|bioskop|game|topup|netflix|spotify|nongkrong|liburan|wisata|hiburan)/i.test(lower)) {
    return 'Hiburan & Langganan';
  }
  if (/(obat|dokter|apotek|vitamin|rumah sakit|klinik|kesehatan)/i.test(lower)) {
    return 'Kesehatan';
  }
  if (/(buku|kuliah|ukt|fotokopi|print|kursus|alat tulis)/i.test(lower)) {
    return 'Pendidikan';
  }

  return 'Pengeluaran Lainnya';
}

/**
 * Clean description string so it looks neat in Spreadsheet and Dashboard
 * e.g. "beli makan seblak 10 ribu pakai tunai" -> "Beli makan seblak"
 */
function cleanDescription(segment) {
  let cleaned = segment
    .replace(/\b(atm\s*[12]|rekening\s*[12]|bank\s*[12])\b/gi, '')
    .replace(/(?:rp\.?\s*)?\d+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k)?/gi, '')
    .replace(/\b(pakai|pake|via|lewat|dengan|dari|ke)\s+(uang\s+tunai|tunai|cash|atm|qris|tf|transfer|debit|rekening|bca|mandiri|bri|bni)\b/gi, '')
    .replace(/\b(uang\s+tunai|tunai|cash|qris|atm)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) cleaned = 'Transaksi Keuangan';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Local Deterministic Indonesian Financial NLP Parser
 * Handles single & multi-item messages, balance checks, balance adjustments, undo, and transfers.
 */
function localParseMessage(rawText) {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();

  // 1. Check commands: cek saldo / info saldo
  if (/^(cek\s*saldo|saldo|info\s*saldo|berapa\s*saldo|sisa\s*uang|sisa\s*saldo)$/i.test(lower)) {
    return { intent: 'CHECK_BALANCE', items: [], provider: 'local-nlp' };
  }

  // 2. Check commands: undo / batal / hapus terakhir
  if (/^(undo|batal|batalkan|hapus\s*terakhir|reset\s*terakhir)$/i.test(lower)) {
    return { intent: 'UNDO', items: [], provider: 'local-nlp' };
  }

  // 3. Check commands: rekap / laporan
  if (/^(rekap|laporan|rekap\s*hari\s*ini|ringkasan|summary)$/i.test(lower)) {
    return { intent: 'SUMMARY', items: [], provider: 'local-nlp' };
  }

  // 4. Check commands: set/atur/ubah/isi saldo awal (e.g. "set saldo tunai 300rb", "isi saldo 15 ribu", "atur saldo atm 2 1,5jt")
  const setBalanceMatch = lower.match(/^(?:set|atur|ubah|update|isi)\s+saldo(?:\s+(tunai|cash|atm\s*2|atm\s*1|atm|rekening))?\s+(.+)$/i);
  if (setBalanceMatch) {
    const rawTarget = setBalanceMatch[1] || 'tunai';
    const walletTarget = /atm\s*2/i.test(rawTarget) ? 'ATM2' : /atm|rekening/i.test(rawTarget) ? 'ATM' : 'CASH';
    const amountVal = parseIndonesianAmount(setBalanceMatch[2]);
    return {
      intent: 'SET_BALANCE',
      wallet: walletTarget,
      amount: amountVal,
      items: [],
      provider: 'local-nlp',
    };
  }

  // 4B. Check "isi [tunai/cash/uang] [nominal]" or plain "isi [nominal]" (NOT "isi bensin/pulsa/kuota/token/air/galon/angin/gas")
  if (
    /^isi\s+(?:uang\s+tunai|tunai|cash|dompet|uang)?\s*(?:rp\.?\s*)?\d+/i.test(lower) &&
    !/\b(bensin|pertalite|pertamax|pulsa|kuota|paket|token|listrik|air|galon|angin|gas|etoll|flazz|emoney|gopay|ovo|dana|shopeepay)\b/i.test(lower)
  ) {
    const amount = parseIndonesianAmount(text);
    if (amount > 0) {
      return {
        intent: 'TRANSACTION',
        provider: 'local-nlp',
        items: [
          {
            type: 'INCOME',
            description: 'Isi Saldo Uang Tunai',
            category: 'Gaji & Bonus',
            wallet: 'CASH',
            amount,
          },
        ],
      };
    }
  }

  // 5A. Check Alokasi / Isi ATM 2 ("isi atm 2 500 ribu", "pindah ke atm 2 800rb")
  // If ATM 1 has sufficient balance (>= amount) OR user explicitly says "pindah/transfer/geser/sendirikan", record TRANSFER (ATM 1 -> ATM 2).
  // Otherwise (e.g. ATM 1 is Rp 0 and user says "isi atm 2 15 ribu"), record INCOME directly into ATM 2!
  if (/(?:isi|pindah|sendirikan|alokasi|jatah|oper|tf|transfer).*\batm\s*2\b/i.test(lower)) {
    const cleanedForAmount = text.replace(/\b(atm|rekening|bank)\s*[12]\b/gi, 'atm');
    const amount = parseIndonesianAmount(cleanedForAmount);
    if (amount > 0) {
      const { getWallets } = require('../db/database');
      const curWallets = getWallets();
      const atm1Bal = Number(curWallets?.atm?.balance || 0);
      const isExplicitTransfer = /\b(pindah|sendirikan|alokasi|geser|oper|dari\s+atm\s*1)\b/i.test(lower);

      if (atm1Bal >= amount || isExplicitTransfer) {
        return {
          intent: 'TRANSACTION',
          provider: 'local-nlp',
          items: [
            {
              type: 'TRANSFER',
              description: 'Alokasi Jajan ATM 1 ke ATM 2',
              category: 'Tarik / Setor Tunai',
              wallet: 'ATM',
              targetWallet: 'ATM2',
              amount,
            },
          ],
        };
      } else {
        return {
          intent: 'TRANSACTION',
          provider: 'local-nlp',
          items: [
            {
              type: 'INCOME',
              description: 'Isi Saldo ATM 2 (Jajan)',
              category: 'Gaji & Bonus',
              wallet: 'ATM2',
              amount,
            },
          ],
        };
      }
    }
  }

  // 5B. Check Isi / Pindah ke ATM 1 (Simpanan)
  if (/(?:isi|pindah|simpan|tabung|oper|tf|transfer).*\batm\s*1\b/i.test(lower) && !/\bke\s+atm\s*2\b/i.test(lower)) {
    const cleanedForAmount = text.replace(/\b(atm|rekening|bank)\s*[12]\b/gi, 'atm');
    const amount = parseIndonesianAmount(cleanedForAmount);
    if (amount > 0) {
      const isExplicitFromAtm2 = /\b(dari\s+atm\s*2|pindah|oper)\b/i.test(lower);
      if (isExplicitFromAtm2) {
        return {
          intent: 'TRANSACTION',
          provider: 'local-nlp',
          items: [
            {
              type: 'TRANSFER',
              description: 'Simpan Saldo ATM 2 ke ATM 1',
              category: 'Tarik / Setor Tunai',
              wallet: 'ATM2',
              targetWallet: 'ATM',
              amount,
            },
          ],
        };
      }
      return {
        intent: 'TRANSACTION',
        provider: 'local-nlp',
        items: [
          {
            type: 'INCOME',
            description: 'Isi Saldo ATM 1 (Simpanan)',
            category: 'Gaji & Bonus',
            wallet: 'ATM',
            amount,
          },
        ],
      };
    }
  }

  // 5C. Check Tarik Tunai / Setor Tunai (Default Tarik Tunai potong ATM 2 Jajan, kecuali sebut ATM 1)
  if (/(tarik\s*tunai|ambil\s*uang\s*di\s*atm|ambil\s*atm)/i.test(lower)) {
    const isAtm1 = /\batm\s*1\b/i.test(lower);
    const cleanedForAmount = text.replace(/\batm\s*[12]\b/gi, 'atm');
    const amount = parseIndonesianAmount(cleanedForAmount);
    if (amount > 0) {
      return {
        intent: 'TRANSACTION',
        provider: 'local-nlp',
        items: [
          {
            type: 'TRANSFER',
            description: isAtm1 ? 'Tarik Tunai ATM 1 ke Dompet Tunai' : 'Tarik Tunai ATM 2 ke Dompet Tunai',
            category: 'Tarik / Setor Tunai',
            wallet: isAtm1 ? 'ATM' : 'ATM2',
            targetWallet: 'CASH',
            amount,
          },
        ],
      };
    }
  }

  if (/(setor\s*tunai|top\s*up\s*atm|masukin\s*uang\s*ke\s*atm|tabung\s*ke\s*atm)/i.test(lower)) {
    const isAtm2 = /\batm\s*2\b/i.test(lower);
    const cleanedForAmount = text.replace(/\batm\s*[12]\b/gi, 'atm');
    const amount = parseIndonesianAmount(cleanedForAmount);
    if (amount > 0) {
      return {
        intent: 'TRANSACTION',
        provider: 'local-nlp',
        items: [
          {
            type: 'TRANSFER',
            description: isAtm2 ? 'Setor Tunai ke Saldo ATM 2' : 'Setor Tunai ke Saldo ATM 1',
            category: 'Tarik / Setor Tunai',
            wallet: 'CASH',
            targetWallet: isAtm2 ? 'ATM2' : 'ATM',
            amount,
          },
        ],
      };
    }
  }

  // Ignore raw JIDs, @lid, phone numbers, or URLs
  if (/@lid|@s\.whatsapp\.net|https?:\/\//i.test(text)) {
    return { intent: 'UNKNOWN', items: [], provider: 'local-nlp' };
  }

  // 6. Split multi-item transactions separated by commas, newlines, "sama", "terus", "dan", "lalu"
  const segments = text
    .split(/(?:\r?\n|,|\b(?:terus|sama|lalu|kemudian)\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const items = [];
  for (const seg of segments) {
    // Must contain either a currency unit (rb, ribu, k, jt, juta, rp) OR a financial action verb
    const hasCurrencyOrVerb =
      /\b(rp|ribu|rb|k|juta|jt|goceng|ceban|goban|cepek|secepek|beli|bayar|jajan|makan|minum|parkir|bensin|topup|top\s*up|tf|transfer|dapat|dapet|terima|gaji|masuk|keluar|abis|habis|ongkir|sewa|tagihan|kopi|seblak)\b/i.test(
        seg
      );
    if (!hasCurrencyOrVerb) continue;

    const cleanedSegForAmount = seg.replace(/\b(atm|rekening|bank)\s*[12]\b/gi, 'atm');
    const amount = parseIndonesianAmount(cleanedSegForAmount);
    if (amount <= 0 || amount > 500_000_000) continue;

    const isIncome =
      /\b(dapat|dapet|terima|gaji|masuk|pemasukan|dikasih|bonus|thr|untung|jual)\b/i.test(seg) &&
      !/\b(beli|bayar|buat|untuk|belanja|jajan)\b/i.test(seg);

    const type = isIncome ? 'INCOME' : 'EXPENSE';
    const wallet = detectWallet(seg, type);
    const description = cleanDescription(seg);
    const category = detectCategory(seg, type);

    items.push({
      type,
      description,
      category,
      wallet,
      amount,
    });
  }

  if (items.length > 0) {
    return {
      intent: 'TRANSACTION',
      items,
      provider: 'local-nlp',
    };
  }

  return {
    intent: 'UNKNOWN',
    items: [],
    provider: 'local-nlp',
  };
}

/**
 * Primary AI Parser: Uses OpenRouter / Groq / OpenAI-compatible API if configured,
 * and falls back to the deterministic local Indonesian Financial NLP engine so it never fails!
 */
async function parseFinancialMessage(rawText) {
  const settings = getSettings();
  const apiKey = (settings.ai_api_key || process.env.AI_API_KEY || '').trim();
  const baseUrl = (settings.ai_base_url || process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const primaryModel = settings.ai_model || process.env.AI_MODEL || 'qwen/qwen3.8-27b:free';

  // Quick command check first (instant response for cek saldo / undo / rekap / set saldo / transfer)
  const localCheck = localParseMessage(rawText);
  if (['CHECK_BALANCE', 'UNDO', 'SUMMARY', 'SET_BALANCE'].includes(localCheck.intent)) {
    return localCheck;
  }

  // If local deterministic parser already confidently matched a transaction or inter-ATM transfer, return fast if no API key
  if (!apiKey) {
    return localCheck;
  }

  const systemPrompt = `Kamu adalah AI pencatat keuangan pribadi pintar berbahasa Indonesia dengan sistem 3 Dompet.
Tugasmu mengekstrak chat WhatsApp user menjadi JSON murni (tanpa markdown block).

ATURAN 3 DOMPET (WAJIB DIIKUTI):
1. "CASH" (Saldo Uang Tunai):
   - WAJIB dipilih untuk PENGELUARAN ("EXPENSE") jika user TIDAK menyebutkan metode bayar (contoh: "beli makan seblak 10 ribu", "beli bensin 20rb").
2. "ATM" (Saldo ATM 1 — Simpanan Utama):
   - WAJIB dipilih untuk PEMASUKAN ("INCOME") seperti gaji/uang masuk (contoh: "gaji masuk 3 juta", "uang masuk 2 juta"), kecuali user eksplisit menyebut "masuk atm 2" atau "masuk tunai".
   - Hanya dipilih untuk pengeluaran jika user eksplisit menyebut "atm 1" atau "simpanan".
3. "ATM2" (Saldo ATM 2 — Dompet Jajan / QRIS):
   - WAJIB dipilih untuk semua PENGELUARAN non-tunai harian (contoh: "qris", "tf", "transfer", "debit", "atm", "bca", "mandiri", "gopay", "dana", misal: "beli kopi 18rb pakai qris").
4. Alokasi / Pindah Saldo ("TRANSFER"):
   - Jika user memindahkan uang ke ATM 2 untuk jajan (contoh: "isi atm 2 500 ribu", "pindah ke atm 2 500rb"), gunakan type: "TRANSFER", wallet: "ATM", targetWallet: "ATM2".
   - Jika user tarik tunai (contoh: "tarik tunai 100rb"), gunakan type: "TRANSFER", wallet: "ATM2", targetWallet: "CASH".

Format JSON yang wajib dikembalikan:
{
  "intent": "TRANSACTION" | "CHECK_BALANCE" | "SUMMARY" | "UNDO" | "UNKNOWN",
  "items": [
    {
      "type": "EXPENSE" | "INCOME" | "TRANSFER",
      "description": "Nama transaksi rapi, misal: Beli kopi",
      "category": "Makanan & Minuman" | "Transportasi" | "Belanja & Kebutuhan" | "Tagihan & Utilitas" | "Hiburan & Langganan" | "Kesehatan" | "Pendidikan" | "Gaji & Bonus" | "Tarik / Setor Tunai" | "Pengeluaran Lainnya",
      "wallet": "CASH" | "ATM" | "ATM2",
      "targetWallet": "CASH" | "ATM" | "ATM2" | null,
      "amount": 18000
    }
  ]
}`;

  const candidateModels = [
    primaryModel,
    'qwen/qwen3.8-27b:free',
    'qwen/qwen3-32b:free',
    'qwen/qwen-2.5-72b-instruct:free',
    'meta-llama/llama-3.3-70b-instruct:free',
  ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

  for (const model of candidateModels) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'DOMPET.AI 3-Vault Ledger',
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: rawText },
          ],
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) continue;

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
          return {
            ...parsed,
            provider: `ai (${model})`,
          };
        }
      }
    } catch {
      // Try next free model in candidate list or fallback to localCheck
    }
  }

  return localCheck;
}

module.exports = {
  parseFinancialMessage,
  localParseMessage,
  parseIndonesianAmount,
};
