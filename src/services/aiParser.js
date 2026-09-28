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

  // 4. Check commands: set/atur saldo awal (e.g. "set saldo tunai 300rb" or "atur saldo atm 2 1,5jt")
  const setBalanceMatch = lower.match(/^(?:set|atur|ubah|update)\s+saldo\s+(tunai|cash|atm\s*2|atm\s*1|atm|rekening)\s+(.+)$/i);
  if (setBalanceMatch) {
    const rawTarget = setBalanceMatch[1];
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

  // 5A. Check Alokasi / Menyendirikan Uang dari ATM 1 (Simpanan) ke ATM 2 (Jajan)
  // e.g. "isi atm 2 500 ribu", "pindah ke atm 2 800rb", "sendirikan ke atm 2 500rb", "transfer atm 1 ke atm 2 500rb"
  if (/(?:isi|pindah|sendirikan|alokasi|jatah|oper|tf|transfer).*\batm\s*2\b/i.test(lower)) {
    const cleanedForAmount = text.replace(/\b(atm|rekening|bank)\s*[12]\b/gi, 'atm');
    const amount = parseIndonesianAmount(cleanedForAmount);
    if (amount > 0) {
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
    }
  }

  // 5B. Check Pindah Saldo dari ATM 2 kembali ke ATM 1 (Simpanan)
  if (/(?:isi|pindah|simpan|tabung|oper|tf|transfer).*\batm\s*1\b/i.test(lower) && !/\bke\s+atm\s*2\b/i.test(lower)) {
    const cleanedForAmount = text.replace(/\b(atm|rekening|bank)\s*[12]\b/gi, 'atm');
    const amount = parseIndonesianAmount(cleanedForAmount);
    if (amount > 0) {
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
  const model = settings.ai_model || process.env.AI_MODEL || 'google/gemini-2.0-flash-exp:free';

  // Quick command check first (instant response for cek saldo / undo / rekap)
  const localCheck = localParseMessage(rawText);
  if (['CHECK_BALANCE', 'UNDO', 'SUMMARY', 'SET_BALANCE'].includes(localCheck.intent)) {
    return localCheck;
  }

  if (!apiKey) {
    return localCheck;
  }

  try {
    const systemPrompt = `Kamu adalah AI pencatat keuangan pribadi pintar berbahasa Indonesia.
Tugasmu mengekstrak chat WhatsApp user menjadi JSON murni (tanpa markdown block).

ATURAN DOMPET (SANGAT PENTING):
- Hanya ada 2 dompet: "CASH" (Saldo Uang Tunai) dan "ATM" (Saldo ATM / Bank / QRIS).
- Jika user TIDAK menyebut metode bayar (contoh: "beli makan seblak 10 ribu"), WAJIB pilih wallet: "CASH".
- Jika user menyebut kata kunci non-tunai (contoh: "atm", "qris", "tf", "transfer", "debit", "bca", "mandiri", "gopay", "dana"), pilih wallet: "ATM".
- Jika user tarik tunai di ATM (contoh: "tarik tunai 100rb"), gunakan type: "TRANSFER", wallet: "ATM", targetWallet: "CASH".
- Jika user setor tunai ke ATM, gunakan type: "TRANSFER", wallet: "CASH", targetWallet: "ATM".

Format JSON yang wajib dikembalikan:
{
  "intent": "TRANSACTION" | "CHECK_BALANCE" | "SUMMARY" | "UNDO" | "UNKNOWN",
  "items": [
    {
      "type": "EXPENSE" | "INCOME" | "TRANSFER",
      "description": "Nama transaksi rapi, misal: Beli makan seblak",
      "category": "Makanan & Minuman" | "Transportasi" | "Belanja & Kebutuhan" | "Tagihan & Utilitas" | "Hiburan & Langganan" | "Kesehatan" | "Pendidikan" | "Gaji & Bonus" | "Tarik / Setor Tunai" | "Pengeluaran Lainnya",
      "wallet": "CASH" | "ATM",
      "targetWallet": "CASH" | "ATM" | null,
      "amount": 10000
    }
  ]
}`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Pencatatan Uang AI WA Bot',
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

    if (!response.ok) {
      return localCheck;
    }

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
  } catch (err) {
    // Fallback gracefully to local NLP parser
  }

  return localCheck;
}

module.exports = {
  parseFinancialMessage,
  localParseMessage,
  parseIndonesianAmount,
};
