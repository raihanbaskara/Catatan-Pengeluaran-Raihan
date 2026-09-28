const {
  getSettings,
  getWallets,
  getTransactions,
  getUnsyncedTransactions,
  markTransactionSynced,
  hydrateStateFromCloud,
} = require('../db/database');

function formatRupiah(num) {
  const n = Number(num) || 0;
  const prefix = n < 0 ? '-Rp ' : 'Rp ';
  return prefix + Math.abs(n).toLocaleString('id-ID');
}

function formatWIBDate(isoStr) {
  try {
    const d = isoStr ? new Date(isoStr) : new Date();
    return d.toLocaleDateString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '28 Sep 2026';
  }
}

/**
 * Maps Indonesian categories from AI Parser to the 9 Dashboard categories in the user's template:
 * Home Rent, Utilities, Food, Supplies, Transportation, Healthcare, Debt, Shopping, Gifts
 */
function mapToDashboardCategory(category = '', description = '') {
  const combined = `${category} ${description}`.toLowerCase();
  if (/(makan|minum|seblak|kopi|bakso|mie|nasi|warung|cafe|jajan|snack|food|es\b|teh)/i.test(combined)) {
    return 'Food';
  }
  if (/(bensin|parkir|ojol|gojek|grab|tol|kereta|transport|motor|oli|ban)/i.test(combined)) {
    return 'Transportation';
  }
  if (/(listrik|wifi|pulsa|kuota|air|pdam|tagihan|utilit|token)/i.test(combined)) {
    return 'Utilities';
  }
  if (/(kos|kontrakan|sewa|rent|asrama)/i.test(combined)) {
    return 'Home Rent';
  }
  if (/(obat|dokter|apotek|vitamin|klinik|rs|kesehatan|health)/i.test(combined)) {
    return 'Healthcare';
  }
  if (/(hutang|cicilan|kredit|pinjaman|debt|paylater)/i.test(combined)) {
    return 'Debt';
  }
  if (/(baju|celana|sepatu|shopee|tokopedia|tiktok|belanja|shopping|skincare)/i.test(combined)) {
    return 'Shopping';
  }
  if (/(sabun|shampoo|indomaret|alfamart|kebutuhan|supplies|rumah)/i.test(combined)) {
    return 'Supplies';
  }
  return 'Gifts';
}

/**
 * Formats a transaction row for the "Spending" (Spending Tracker) tab:
 * [✓ (Boolean), Date, Description, Category, Total (Positive Number), Account, FlowType, BalanceAfterCash, BalanceAfterAtm, RawMessage]
 */
function formatTransactionRow(tx) {
  const srcLabel = tx.wallet === 'ATM2' ? 'ATM 2' : tx.wallet === 'ATM' ? 'ATM 1' : 'CASH';
  const dstLabel = tx.target_wallet === 'ATM2' ? 'ATM 2' : tx.target_wallet === 'ATM' ? 'ATM 1' : 'CASH';
  const accountLabel =
    tx.type === 'TRANSFER'
      ? `${srcLabel} -> ${dstLabel}`
      : tx.wallet === 'ATM2'
      ? 'Saldo ATM 2'
      : tx.wallet === 'ATM'
      ? 'Saldo ATM 1'
      : 'Uang Tunai';

  const typeLabel =
    tx.type === 'EXPENSE' ? 'PENGELUARAN' : tx.type === 'INCOME' ? 'PEMASUKAN' : 'PINDAH SALDO';

  return [
    true,
    formatWIBDate(tx.created_at),
    tx.description,
    mapToDashboardCategory(tx.category, tx.description),
    Math.abs(Number(tx.amount) || 0),
    accountLabel,
    typeLabel,
    tx.balance_after_cash,
    tx.balance_after_atm,
    tx.raw_message || '-',
  ];
}

/**
 * Generates the complete 5-Tab "Money Management Dashboard" Google Apps Script (Code.gs)
 * with NON-DESTRUCTIVE PATCH (`updateDropdownDanAtmTanpaReset`) as the default #1 function:
 * - Adds Month Dropdown (`Report!H2:I2`) & Year Dropdown (`Report!H1:I1`) that dynamically filter Monthly Spending & Realization
 * - Splits ATM into `Saldo ATM 1` (`Report!H5:H6`) and `Saldo ATM 2` (`Report!I5:I6`) without shifting columns or erasing user edits
 */
function getAppsScriptTemplate(spreadsheetId = '1_UvnRmnVZzxfzNp-mASlWtrpuqShcDD8ei8NuHK3YkM') {
  const wallets = getWallets();
  const recentTx = getTransactions({ limit: 50 }).reverse().map(formatTransactionRow);
  const initialDataJson = JSON.stringify({
    wallets,
    transactions: recentTx,
    timestamp: formatWIBDate(new Date().toISOString()),
  });

  return `/**
 * ============================================================================
 * PATCH NON-DESTRUKTIF: DROPDOWN BULAN (REPORT) + SALDO ATM 1 & SALDO ATM 2
 * Target Spreadsheet ID: ${spreadsheetId}
 * ============================================================================
 * AMAN 100% UNTUK EDITAN MANUAL KAMU:
 * - Fungsi utama #1 [updateDropdownDanAtmTanpaReset] HANYA mengupdate:
 *   1. Dropdown Pilih Bulan di Report (H2:I2) + Filter Otomatis Realization & Monthly Spending
 *   2. Pemisahan Kartu [💳 Saldo ATM 1] (H5:H6) & [💳 Saldo ATM 2] (I5:I6) tanpa menggeser tabel
 *   3. Tambah baris [Saldo ATM 2] di tab Setup & pilihan Dropdown Account di tab Spending
 *   (TIDAK menghapus/mereset kategori, angka budget, maupun transaksi yang sudah kamu edit!)
 *
 * CARA PAKAI:
 * 1. Paste seluruh kode ini di menu Ekstensi -> Apps Script, lalu tekan Ctrl + S
 * 2. Pastikan fungsi terpilih di atas adalah: updateDropdownDanAtmTanpaReset
 * 3. Klik tombol "▷ Jalankan" (Run)
 */

const SPREADSHEET_ID = '${spreadsheetId}';
const INITIAL_DATA = ${initialDataJson};

const CATEGORIES = [
  ['Home Rent', 1350000, 'Needs', 'Saldo ATM 1'],
  ['Utilities', 450000, 'Needs', 'Saldo ATM 1'],
  ['Food', 1450000, 'Needs', 'Uang Tunai'],
  ['Supplies', 500000, 'Needs', 'Uang Tunai'],
  ['Transportation', 300000, 'Needs', 'Uang Tunai'],
  ['Healthcare', 200000, 'Needs', 'Uang Tunai'],
  ['Debt', 250000, 'Needs', 'Saldo ATM 2'],
  ['Shopping', 500000, 'Wants', 'Saldo ATM 2'],
  ['Gifts', 500000, 'Wants', 'Uang Tunai']
];

const MONTH_OPTIONS = [
  'Semua Bulan',
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const ACCOUNT_OPTIONS = [
  'Uang Tunai',
  'Saldo ATM 1',
  'Saldo ATM 2',
  'ATM 1 -> CASH',
  'ATM 2 -> CASH',
  'CASH -> ATM 1',
  'CASH -> ATM 2',
  'ATM 1 -> ATM 2',
  'ATM 2 -> ATM 1'
];

/**
 * Otomatis menampilkan menu "📊 Menu Keuangan" di bar atas Google Spreadsheet
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('📊 Menu Keuangan')
      .addItem('🧹 Reset Saldo & Transaksi ke Rp 0 (Kategori Tetap Aman)', 'resetSaldoDanTransaksiKeNolTanpaUbahKategori')
      .addSeparator()
      .addItem('🔄 Pasang Dropdown Bulan & ATM 1 + ATM 2 (Tanpa Reset)', 'updateDropdownDanAtmTanpaReset')
      .addToUi();
  } catch (e) {}
}

/**
 * FUNGSI #1 (MULAI DARI NOL BERSIH - KATEGORI TETAP AMAN):
 * - Mengatur Saldo Awal Uang Tunai, Saldo ATM 1, dan Saldo ATM 2 di tab [Setup] menjadi Rp 0
 * - Menghapus baris transaksi percobaan/dummy di tab [Spending]
 * - 100% TIDAK mengubah nama kategori maupun angka Allocation/Budget di tab [Report] & [Budgeting]!
 */
function resetSaldoDanTransaksiKeNolTanpaUbahKategori() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const setupSheet = ss.getSheetByName('Setup');
  if (setupSheet) {
    setupSheet.getRange('A2:C5').setValues([
      ['Uang Tunai', 0, 'Dompet Fisik / Belanja Harian Tunai'],
      ['Saldo ATM 1', 0, 'Rekening Simpanan Pasti & Uang Masuk Bulanan'],
      ['Saldo ATM 2', 0, 'Rekening Jajan Harian / QRIS / Transfer'],
      ['Tabungan', 0, 'Dana Cadangan / Emergency Fund']
    ]);
    setupSheet.getRange('B2:B5').setNumberFormat('"Rp"#,##0');
  }

  const spendingSheet = ss.getSheetByName('Spending');
  if (spendingSheet) {
    const maxR = Math.max(spendingSheet.getLastRow(), 100);
    spendingSheet.getRange(4, 2, maxR, 9).clearContent();
    spendingSheet.getRange(4, 1, maxR, 1).setValue(false);
  }

  // Nol-kan angka Allocation/Target Budget contoh (D9:D17) di Report tanpa mengubah nama Kategori (B9:C17)
  const reportSheet = ss.getSheetByName('Report');
  if (reportSheet) {
    reportSheet.getRange('D9:D17').setValue(0).setNumberFormat('"Rp"#,##0');
  }

  updateDropdownDanAtmTanpaReset();
}

/**
 * FUNGSI UTAMA #2 (AMAN / NON-DESTRUKTIF):
 * Hanya menambahkan Dropdown Bulan (filter otomatis) + Saldo ATM 1 (Simpanan) & Saldo ATM 2 (Jajan)
 * TANPA mereset atau menghapus editan manual kamu di Spreadsheet!
 */
function updateDropdownDanAtmTanpaReset() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const reportSheet = ss.getSheetByName('Report') || ss.getSheets()[0];
  if (!reportSheet) return;

  // 1. Update Tab [Setup] secara Non-Destruktif
  const setupSheet = ss.getSheetByName('Setup');
  if (setupSheet) {
    const curCash = setupSheet.getRange('B2').getValue();
    const curAtm1 = setupSheet.getRange('B3').getValue();
    const row4Label = String(setupSheet.getRange('A4').getValue() || '');
    const row4Val = setupSheet.getRange('B4').getValue();

    setupSheet.getRange('A2').setValue('Uang Tunai');
    if (curCash === '' || curCash === null) setupSheet.getRange('B2').setValue(0);

    setupSheet.getRange('A3').setValue('Saldo ATM 1');
    if (curAtm1 === '' || curAtm1 === null) setupSheet.getRange('B3').setValue(0);
    setupSheet.getRange('C3').setValue('Rekening Simpanan Pasti & Uang Masuk Bulanan');

    if (row4Label !== 'Saldo ATM 2') {
      const tabunganVal = (row4Label === 'Tabungan' && row4Val) ? row4Val : 0;
      setupSheet.getRange('A4:C4').setValues([['Saldo ATM 2', 0, 'Rekening Jajan Harian / QRIS / Transfer']]);
      setupSheet.getRange('A5:C5').setValues([['Tabungan', tabunganVal, 'Dana Cadangan / Emergency Fund']]);
      setupSheet.getRange('B2:B5').setNumberFormat('"Rp"#,##0');
    }
  }

  // 2. Update Dropdown Kolom Account di Tab [Spending] Tanpa Menghapus Transaksi
  const spendingSheet = ss.getSheetByName('Spending');
  if (spendingSheet) {
    spendingSheet.getRange('H1:J1').setValue('Tunai, ATM 1 (Simpanan) & ATM 2 (Jajan)');
    spendingSheet.getRange('F2').setFormula('=Report!D6+Report!H6+Report!I6');
    const accRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(ACCOUNT_OPTIONS, true)
      .setAllowInvalid(true)
      .build();
    const maxR = Math.max(spendingSheet.getLastRow() + 30, 100);
    spendingSheet.getRange(4, 6, maxR, 1).setDataValidation(accRule);
  }

  // 3. Pasang Dropdown Tahun, Dropdown Bulan (Filter Aktif), & Kartu ATM 1 + ATM 2 di Tab [Report]
  applyReportDropdownAndAtmCards(reportSheet);

  // 4. Update Referensi Income Sources (B4:B7), Kartu Saldo (A10:B13), & Budgeting List (A16:B25) di Tab [Budgeting]
  const budgetingSheet = ss.getSheetByName('Budgeting');
  if (budgetingSheet) {
    budgetingSheet.getRange('A4:B7').setValues([
      ['Saldo Awal Uang Tunai', '=Setup!B2'],
      ['Saldo Awal ATM 1 & ATM 2', '=Setup!B3+Setup!B4'],
      ['Pemasukan Tambahan WA', '=SUMIFS(Spending!E4:E200,Spending!A4:A200,TRUE,Spending!G4:G200,"PEMASUKAN")'],
      ['Total', '=SUM(B4:B6)']
    ]);
    budgetingSheet.getRange('B4:B7').setNumberFormat('"Rp"#,##0');

    budgetingSheet.getRange('A10:B13').setValues([
      ['💵 Sisa Saldo Uang Tunai', '=Report!D6'],
      ['🏦 Sisa Saldo ATM 1 (Simpanan)', '=Report!H6'],
      ['💳 Sisa Saldo ATM 2 (Jajan)', '=Report!I6'],
      ['Grand Total Saldo Aktif', '=B10+B11+B12']
    ]);
    budgetingSheet.getRange('B10:B13').setNumberFormat('"Rp"#,##0');

    // Sinkronkan nama kategori & target budget di Budgeting (A16:B24) langsung ke tabel Report (B9:D17)
    for (var bIdx = 0; bIdx < 9; bIdx++) {
      var repRow = 9 + bIdx;
      var budRow = 16 + bIdx;
      budgetingSheet.getRange(budRow, 1).setFormula('=Report!B' + repRow);
      budgetingSheet.getRange(budRow, 2).setFormula('=Report!D' + repRow).setNumberFormat('"Rp"#,##0');
    }
    budgetingSheet.getRange('A25:B25').setValues([['Total Budget', '=SUM(B16:B24)']])
      .setNumberFormat('"Rp"#,##0');
  }

  const summarySheet = ss.getSheetByName('Summary');
  if (summarySheet) {
    summarySheet.getRange('A3:B5').setValues([
      ['Uang Tunai', '=Report!D6'],
      ['Saldo ATM 1 (Simpanan)', '=Report!H6'],
      ['Saldo ATM 2 (Jajan)', '=Report!I6']
    ]);
  }

  ss.setActiveSheet(reportSheet);
  SpreadsheetApp.flush();
}

/**
 * Helper Non-Destruktif untuk memasang Dropdown Bulan + Kartu ATM 1 & ATM 2 di Tab Report
 * TIDAK mengubah nama kategori (B9:C17) atau angka Allocation (D9:D17) milik user!
 */
function applyReportDropdownAndAtmCards(sheet) {
  sheet.setColumnWidth(8, 130); // Kolom H (🏦 Saldo ATM 1 Simpanan)
  sheet.setColumnWidth(9, 130); // Kolom I (💳 Saldo ATM 2 Jajan)

  // Dropdown Year (H1:I1)
  const curYear = sheet.getRange('H1').getValue() || new Date().getFullYear();
  const yearRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['2025', '2026', '2027', '2028'], true)
    .setAllowInvalid(true).build();
  sheet.getRange('H1:I1').breakApart();
  sheet.getRange('H1:I1').merge().setDataValidation(yearRule).setValue(curYear)
    .setBackground('#F8FAFC').setHorizontalAlignment('center').setFontWeight('bold');

  // Dropdown Month (H2:I2) - bisa dipilih Semua Bulan atau January s/d December
  const curMonth = String(sheet.getRange('H2').getValue() || 'September').trim();
  const validMonth = MONTH_OPTIONS.indexOf(curMonth) !== -1 ? curMonth : 'September';
  const monthRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(MONTH_OPTIONS, true)
    .setAllowInvalid(true).build();
  sheet.getRange('H2:I2').breakApart();
  sheet.getRange('H2:I2').merge().setDataValidation(monthRule).setValue(validMonth)
    .setBackground('#E0F2F1').setFontColor('#004D40').setHorizontalAlignment('center').setFontWeight('bold');

  // Dropdown Filter Dompet (H4:I4)
  const walletFilterRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Semua Dompet', 'Uang Tunai', 'Saldo ATM 1', 'Saldo ATM 2'], true)
    .setAllowInvalid(true).build();
  sheet.getRange('H4:I4').breakApart();
  sheet.getRange('H4:I4').merge().setDataValidation(walletFilterRule).setValue('Semua Dompet')
    .setBackground('#E0F2F1').setFontColor('#004D40').setFontSize(10).setFontWeight('bold').setHorizontalAlignment('center');

  // Card 1: Total Modal & Masuk (Tunai + ATM 1 + ATM 2 + Pemasukan)
  sheet.getRange('B6:C6').merge().setFormula(
    '=Setup!B2+Setup!B3+Setup!B4+SUMIFS(Spending!E4:E200, Spending!G4:G200, "PEMASUKAN")'
  );

  // Card 2: 💵 Saldo Uang Tunai (Support tarik/setor dengan ATM 1 & ATM 2)
  sheet.getRange('D6:E6').merge().setFormula(
    '=Setup!B2+SUMIFS(Spending!E4:E200, Spending!F4:F200, "Uang Tunai", Spending!G4:G200, "PEMASUKAN")+SUMIFS(Spending!E4:E200, Spending!F4:F200, "ATM -> CASH", Spending!G4:G200, "PINDAH SALDO")+SUMIFS(Spending!E4:E200, Spending!F4:F200, "ATM 1 -> CASH", Spending!G4:G200, "PINDAH SALDO")+SUMIFS(Spending!E4:E200, Spending!F4:F200, "ATM 2 -> CASH", Spending!G4:G200, "PINDAH SALDO")-SUMIFS(Spending!E4:E200, Spending!F4:F200, "CASH -> ATM", Spending!G4:G200, "PINDAH SALDO")-SUMIFS(Spending!E4:E200, Spending!F4:F200, "CASH -> ATM 1", Spending!G4:G200, "PINDAH SALDO")-SUMIFS(Spending!E4:E200, Spending!F4:F200, "CASH -> ATM 2", Spending!G4:G200, "PINDAH SALDO")-SUMIFS(Spending!E4:E200, Spending!F4:F200, "Uang Tunai", Spending!G4:G200, "PENGELUARAN")'
  );

  // Ekspresi Filter Bulan (H2), Tahun (H1), & Dompet (H4) untuk ARRAYFORMULA
  const monthRegexExpr = 'IF($H$2="May","May|Mei",IF($H$2="August","Aug|Agu",IF($H$2="October","Oct|Okt",IF($H$2="December","Dec|Des",LEFT($H$2,3)))))';
  const monthFilterCond = 'IF(($H$2="Semua Bulan")+($H$2=""),1,REGEXMATCH(TEXT(Spending!$B$4:$B$200,"dd mmm yyyy"),"(?i)(" & ' + monthRegexExpr + ' & ")"))';
  const yearFilterCond = 'REGEXMATCH(TEXT(Spending!$B$4:$B$200,"dd mmm yyyy"),""&$H$1)';
  const walletFilterCond = 'IF(($H$4="Semua Dompet")+($H$4="")+($H$4="Tunai & ATM ▾"),1,IF($H$4="Saldo ATM 1",(Spending!$F$4:$F$200="Saldo ATM 1")+(Spending!$F$4:$F$200="Saldo ATM"),Spending!$F$4:$F$200=$H$4))';

  // Card 3: Monthly Spending (Terfilter otomatis sesuai Bulan H2, Tahun H1, & Dompet H4)
  sheet.getRange('F6:G6').merge().setFormula(
    '=ARRAYFORMULA(SUM(IF((Spending!$G$4:$G$200="PENGELUARAN")*' + monthFilterCond + '*' + yearFilterCond + '*' + walletFilterCond + ',Spending!$E$4:$E$200,0)))'
  );

  // Unmerge H5:I6 menjadi 2 Kartu Berdampingan: Kolom H = [🏦 ATM 1 Simpanan], Kolom I = [💳 ATM 2 Jajan]
  sheet.getRange('H5:I6').breakApart();

  // Card 4A (Kolom H): 🏦 Saldo ATM 1 (Simpanan)
  sheet.getRange('H5').setValue('🏦 ATM 1 (Simpanan)')
    .setBackground('#4DB6AC').setFontColor('#FFFFFF').setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('H6').setFormula(
    '=Setup!B3+SUMIFS(Spending!E4:E200, Spending!F4:F200, "Saldo ATM 1", Spending!G4:G200, "PEMASUKAN")+SUMIFS(Spending!E4:E200, Spending!F4:F200, "Saldo ATM", Spending!G4:G200, "PEMASUKAN")+SUMIFS(Spending!E4:E200, Spending!F4:F200, "CASH -> ATM 1", Spending!G4:G200, "PINDAH SALDO")+SUMIFS(Spending!E4:E200, Spending!F4:F200, "CASH -> ATM", Spending!G4:G200, "PINDAH SALDO")+SUMIFS(Spending!E4:E200, Spending!F4:F200, "ATM 2 -> ATM 1", Spending!G4:G200, "PINDAH SALDO")-SUMIFS(Spending!E4:E200, Spending!F4:F200, "ATM 1 -> CASH", Spending!G4:G200, "PINDAH SALDO")-SUMIFS(Spending!E4:E200, Spending!F4:F200, "ATM -> CASH", Spending!G4:G200, "PINDAH SALDO")-SUMIFS(Spending!E4:E200, Spending!F4:F200, "ATM 1 -> ATM 2", Spending!G4:G200, "PINDAH SALDO")-SUMIFS(Spending!E4:E200, Spending!F4:F200, "Saldo ATM 1", Spending!G4:G200, "PENGELUARAN")-SUMIFS(Spending!E4:E200, Spending!F4:F200, "Saldo ATM", Spending!G4:G200, "PENGELUARAN")'
  ).setBackground('#F0F9FF').setFontColor('#075985').setFontSize(11).setFontWeight('bold').setHorizontalAlignment('center').setNumberFormat('"Rp"#,##0');

  // Card 4B (Kolom I): 💳 Saldo ATM 2 (Jajan)
  sheet.getRange('I5').setValue('💳 ATM 2 (Jajan)')
    .setBackground('#00897B').setFontColor('#FFFFFF').setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('I6').setFormula(
    '=Setup!B4+SUMIFS(Spending!E4:E200, Spending!F4:F200, "Saldo ATM 2", Spending!G4:G200, "PEMASUKAN")+SUMIFS(Spending!E4:E200, Spending!F4:F200, "CASH -> ATM 2", Spending!G4:G200, "PINDAH SALDO")+SUMIFS(Spending!E4:E200, Spending!F4:F200, "ATM 1 -> ATM 2", Spending!G4:G200, "PINDAH SALDO")-SUMIFS(Spending!E4:E200, Spending!F4:F200, "ATM 2 -> CASH", Spending!G4:G200, "PINDAH SALDO")-SUMIFS(Spending!E4:E200, Spending!F4:F200, "ATM 2 -> ATM 1", Spending!G4:G200, "PINDAH SALDO")-SUMIFS(Spending!E4:E200, Spending!F4:F200, "Saldo ATM 2", Spending!G4:G200, "PENGELUARAN")'
  ).setBackground('#EFF6FF').setFontColor('#1E40AF').setFontSize(11).setFontWeight('bold').setHorizontalAlignment('center').setNumberFormat('"Rp"#,##0');

  sheet.getRange('B5:I6').setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  // Update HANYA Kolom E (Realization) pada baris kategori yang ada (B9:B25) agar ikut terfilter Dropdown Bulan H2
  for (var rowNum = 9; rowNum <= 25; rowNum++) {
    var catCellVal = String(sheet.getRange(rowNum, 2).getValue() || '').trim();
    if (!catCellVal || catCellVal === 'Total' || catCellVal === 'Expenses List') continue;
    sheet.getRange(rowNum, 5).setFormula(
      '=ARRAYFORMULA(SUM(IF((Spending!$D$4:$D$200=B' + rowNum + ')*(Spending!$G$4:$G$200="PENGELUARAN")*' + monthFilterCond + '*' + yearFilterCond + '*' + walletFilterCond + ',Spending!$E$4:$E$200,0)))'
    ).setNumberFormat('"Rp"#,##0').setHorizontalAlignment('right');
  }
}

/**
 * FUNGSI KEDUA: Sekarang sudah diamankan! Jika tab Report sudah ada,
 * otomatis menjalankan updateDropdownDanAtmTanpaReset() agar TIDAK PERNAH mereset editan!
 */
function setupDanUpdateSpreadsheetSekarang() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  if (ss.getSheetByName('Report')) {
    updateDropdownDanAtmTanpaReset();
    return;
  }
  buildCompleteDashboardSuite(ss, INITIAL_DATA.wallets, INITIAL_DATA.transactions);
}

function getOrCreateCleanSheet(ss, name, tabColor, index) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name, index);
  }
  const maxR = Math.max(sheet.getMaxRows(), 60);
  const maxC = Math.max(sheet.getMaxColumns(), 15);
  const r = sheet.getRange(1, 1, maxR, maxC);
  r.clearDataValidations();
  r.breakApart();
  r.clearContent();
  r.clearFormat();
  r.clearNote();
  sheet.clearConditionalFormatRules();
  const charts = sheet.getCharts();
  for (var i = 0; i < charts.length; i++) {
    sheet.removeChart(charts[i]);
  }
  if (tabColor) sheet.setTabColor(tabColor);
  sheet.getRange(1, 1, maxR, maxC).setFontFamily('Arial').setVerticalAlignment('middle');
  return sheet;
}

function buildCompleteDashboardSuite(ss, wallets, txRows) {
  const cashInit = wallets && wallets.cash ? wallets.cash.initial_balance : 500000;
  const atmInit  = wallets && wallets.atm ? wallets.atm.initial_balance : 2500000;
  const atm2Init = wallets && wallets.atm2 ? wallets.atm2.initial_balance : 1000000;

  // Rename first legacy sheet to Report if needed so we don't leave junk sheets
  const firstSheet = ss.getSheets()[0];
  if (firstSheet && !['Report', 'Budgeting', 'Summary', 'Spending', 'Setup'].includes(firstSheet.getName())) {
    if (!ss.getSheetByName('Report')) {
      firstSheet.setName('Report');
    }
  }

  // 1. Setup Tab
  const setupSheet = getOrCreateCleanSheet(ss, 'Setup', '#64748B', 4);
  setupSheet.getRange('A1:C1').setValues([['Kode Dompet', 'Saldo Awal (Rp)', 'Keterangan']])
    .setFontWeight('bold').setBackground('#0F172A').setFontColor('#FFFFFF');
  setupSheet.getRange('A2:C5').setValues([
    ['Uang Tunai', cashInit, 'Dompet Uang Tunai (Default potong saat chat WA)'],
    ['Saldo ATM 1', atmInit, 'Dompet Rekening Bank Utama (ATM 1 / QRIS)'],
    ['Saldo ATM 2', atm2Init, 'Dompet Rekening Bank Kedua (ATM 2)'],
    ['Tabungan', 1500000, 'Dana Cadangan / Emergency Fund']
  ]);
  setupSheet.getRange('B2:B5').setNumberFormat('"Rp"#,##0');
  setupSheet.autoResizeColumns(1, 3);

  // 2. Spending Tab (Tab 4 — Spending Tracker)
  const spendingSheet = getOrCreateCleanSheet(ss, 'Spending', '#F43F5E', 3);
  buildSpendingSheet(spendingSheet, txRows);

  // 3. Budgeting Tab (Tab 2 — Jan-Dec Matrix)
  const budgetingSheet = getOrCreateCleanSheet(ss, 'Budgeting', '#F59E0B', 1);
  buildBudgetingSheet(budgetingSheet, cashInit, atmInit);

  // 4. Report Tab (Tab 1 — Money Management Dashboard)
  const reportSheet = getOrCreateCleanSheet(ss, 'Report', '#00897B', 0);
  buildReportSheet(reportSheet);
  applyReportDropdownAndAtmCards(reportSheet);

  // 5. Summary Tab (Tab 3 — Budgeting Summary)
  const summarySheet = getOrCreateCleanSheet(ss, 'Summary', '#10B981', 2);
  buildSummarySheet(summarySheet);

  ss.setActiveSheet(reportSheet);
}

function buildSpendingSheet(sheet, txRows) {
  const widths = [42, 110, 230, 155, 130, 140, 130, 145, 145, 220];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);

  // Row 1: Title Banner (Matches Image 4)
  sheet.setRowHeight(1, 38);
  sheet.getRange('A1:G1').merge().setValue('Spending Tracker')
    .setBackground('#F3E8EE').setFontColor('#D9536F').setFontSize(15).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('H1:J1').merge().setValue('Uang Tunai, ATM 1 & ATM 2')
    .setBackground('#F3E8EE').setFontColor('#D9536F').setFontSize(10).setFontWeight('bold').setHorizontalAlignment('center');

  // Row 2: Date & Current Balance
  sheet.setRowHeight(2, 28);
  sheet.getRange('A2:C2').merge().setValue('Date: ' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'dd MMM yyyy'))
    .setFontColor('#E15B64').setFontWeight('bold').setFontSize(10);
  sheet.getRange('D2:E2').merge().setValue('Current Total Balance ➔')
    .setFontColor('#D97706').setFontWeight('bold').setHorizontalAlignment('right');
  sheet.getRange('F2').setFormula('=Report!D6+Report!H6+Report!I6')
    .setNumberFormat('"Rp"#,##0').setFontColor('#D97706').setFontWeight('bold');

  // Row 3: Table Header
  sheet.setRowHeight(3, 30);
  sheet.getRange('A3:J3').setValues([[
    '✓', 'Date', 'Description', 'Category', 'Total', 'Account', 'Tipe Arus', 'Sisa Tunai', 'Sisa ATM', 'Chat Asli WA'
  ]]).setBackground('#E6DEC8').setFontColor('#1F2937').setFontWeight('bold').setHorizontalAlignment('center');

  const safeRows = Array.isArray(txRows) && txRows.length > 0 ? txRows : [
    [true, '28 Sep 2026', 'Beli makan seblak', 'Food', 10000, 'Uang Tunai', 'PENGELUARAN', 490000, 2500000, 'beli makan seblak 10 ribu'],
    [true, '28 Sep 2026', 'Beli kopi pakai QRIS', 'Food', 18000, 'Saldo ATM 1', 'PENGELUARAN', 490000, 2482000, 'beli kopi 18rb pakai qris'],
    [true, '28 Sep 2026', 'Tarik Tunai ATM 1 ke Dompet', 'Gifts', 100000, 'ATM 1 -> CASH', 'PINDAH SALDO', 590000, 2382000, 'tarik tunai di atm 100 ribu'],
    [true, '28 Sep 2026', 'Beli bensin motor', 'Transportation', 20000, 'Uang Tunai', 'PENGELUARAN', 570000, 2357000, 'beli bensin 20ribu']
  ];

  const totalPreparedRows = Math.max(25, safeRows.length + 10);
  sheet.getRange(4, 1, totalPreparedRows, 1).insertCheckboxes();

  if (safeRows.length > 0) {
    sheet.getRange(4, 1, safeRows.length, 10).setValues(safeRows);
  }

  // Dropdown validations for Category (Col D) & Account (Col F)
  const catRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CATEGORIES.map(function(c) { return c[0]; }), true)
    .setAllowInvalid(true).build();
  const accRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(ACCOUNT_OPTIONS, true)
    .setAllowInvalid(true).build();

  sheet.getRange(4, 4, totalPreparedRows, 1).setDataValidation(catRule).setHorizontalAlignment('center');
  sheet.getRange(4, 6, totalPreparedRows, 1).setDataValidation(accRule).setHorizontalAlignment('center');
  sheet.getRange(4, 2, totalPreparedRows, 1).setHorizontalAlignment('center');
  sheet.getRange(4, 5, totalPreparedRows, 1).setNumberFormat('"Rp"#,##0').setHorizontalAlignment('right');
  sheet.getRange(4, 7, totalPreparedRows, 1).setHorizontalAlignment('center').setFontSize(9);
  sheet.getRange(4, 8, totalPreparedRows, 2).setNumberFormat('"Rp"#,##0').setHorizontalAlignment('right');
  sheet.getRange(3, 1, totalPreparedRows + 1, 10).setBorder(true, true, true, true, true, true, '#E5E7EB', SpreadsheetApp.BorderStyle.SOLID);
  sheet.setFrozenRows(3);
}

function buildReportSheet(sheet) {
  const widths = [20, 140, 90, 125, 125, 95, 95, 95, 110, 20];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);

  // Row 1-2: Top Title Banner (Matches Image 1)
  sheet.setRowHeight(1, 24);
  sheet.setRowHeight(2, 24);
  sheet.getRange('B1:F2').merge().setValue('Money Management Dashboard 💸')
    .setBackground('#E5E9EC').setFontColor('#2A9D8F').setFontSize(18).setFontWeight('bold').setHorizontalAlignment('left');
  sheet.getRange('G1').setValue('Year:').setBackground('#E5E9EC').setFontWeight('bold').setHorizontalAlignment('right');
  sheet.getRange('H1:I1').merge().setValue(new Date().getFullYear()).setBackground('#F8FAFC').setHorizontalAlignment('center').setFontWeight('bold');
  sheet.getRange('G2').setValue('Month:').setBackground('#E5E9EC').setFontWeight('bold').setHorizontalAlignment('right');
  sheet.getRange('H2:I2').merge().setValue('September').setBackground('#F8FAFC').setHorizontalAlignment('center').setFontWeight('bold');

  // Row 4: Monthly Report Sub-banner (#00796B Deep Teal)
  sheet.setRowHeight(4, 32);
  sheet.getRange('B4:G4').merge().setValue('Monthly Report 📊')
    .setBackground('#00796B').setFontColor('#FFFFFF').setFontSize(12).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('H4:I4').merge().setValue('Tunai & ATM ▾')
    .setBackground('#E0F2F1').setFontColor('#004D40').setFontSize(10).setFontWeight('bold').setHorizontalAlignment('center');

  // Row 5-6: 4 KPI Cards (Total Income | Saldo Uang Tunai | Monthly Spending | Saldo ATM)
  sheet.setRowHeight(5, 24);
  sheet.setRowHeight(6, 38);

  // Card 1: Total Modal & Pemasukan
  sheet.getRange('B5:C5').merge().setValue('Total Modal & Masuk')
    .setBackground('#4DB6AC').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('B6:C6').merge().setFormula('=Setup!B2+Setup!B3+SUMIFS(Spending!E4:E100, Spending!G4:G100, "PEMASUKAN")')
    .setBackground('#FFFFFF').setFontColor('#1F2937').setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center').setNumberFormat('"Rp"#,##0');

  // Card 2: Saldo Uang Tunai (Cash) - Real-Time
  sheet.getRange('D5:E5').merge().setValue('💵 Saldo Uang Tunai')
    .setBackground('#4DB6AC').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('D6:E6').merge().setFormula('=Setup!B2+SUMIFS(Spending!E4:E100, Spending!F4:F100, "Uang Tunai", Spending!G4:G100, "PEMASUKAN")+SUMIFS(Spending!E4:E100, Spending!F4:F100, "ATM -> CASH", Spending!G4:G100, "PINDAH SALDO")-SUMIFS(Spending!E4:E100, Spending!F4:F100, "CASH -> ATM", Spending!G4:G100, "PINDAH SALDO")-SUMIFS(Spending!E4:E100, Spending!F4:F100, "Uang Tunai", Spending!G4:G100, "PENGELUARAN")')
    .setBackground('#ECFDF5').setFontColor('#065F46').setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center').setNumberFormat('"Rp"#,##0');

  // Card 3: Monthly Spending (Pengeluaran Bulan Ini)
  sheet.getRange('F5:G5').merge().setValue('Monthly Spending')
    .setBackground('#4DB6AC').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('F6:G6').merge().setFormula('=SUMIFS(Spending!E4:E100, Spending!G4:G100, "PENGELUARAN")')
    .setBackground('#FFF1F2').setFontColor('#9F1239').setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center').setNumberFormat('"Rp"#,##0');

  // Card 4: Saldo ATM / Bank - Real-Time
  sheet.getRange('H5:I5').merge().setValue('💳 Saldo ATM / Bank')
    .setBackground('#4DB6AC').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('H6:I6').merge().setFormula('=Setup!B3+SUMIFS(Spending!E4:E100, Spending!F4:F100, "Saldo ATM", Spending!G4:G100, "PEMASUKAN")+SUMIFS(Spending!E4:E100, Spending!F4:F100, "CASH -> ATM", Spending!G4:G100, "PINDAH SALDO")-SUMIFS(Spending!E4:E100, Spending!F4:F100, "ATM -> CASH", Spending!G4:G100, "PINDAH SALDO")-SUMIFS(Spending!E4:E100, Spending!F4:F100, "Saldo ATM", Spending!G4:G100, "PENGELUARAN")')
    .setBackground('#F0F9FF').setFontColor('#075985').setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center').setNumberFormat('"Rp"#,##0');

  sheet.getRange('B5:I6').setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

  // Row 8: Expenses List Table Header
  sheet.setRowHeight(8, 28);
  sheet.getRange('B8:C8').merge().setValue('Expenses List');
  sheet.getRange('D8').setValue('Allocation 💰');
  sheet.getRange('E8').setValue('Realization 💸');
  sheet.getRange('F8:H8').merge().setValue('Budget Usage Progress');
  sheet.getRange('I8').setValue('% Usage');
  sheet.getRange('B8:I8').setBackground('#4DB6AC').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');

  // Rows 9-17: 9 Categories with Live SUMIFS + SPARKLINE Progress Bars
  for (var idx = 0; idx < CATEGORIES.length; idx++) {
    var rowNum = 9 + idx;
    var catName = CATEGORIES[idx][0];
    var alloc = CATEGORIES[idx][1];
    sheet.setRowHeight(rowNum, 24);
    sheet.getRange(rowNum, 2, 1, 2).merge().setValue(catName).setFontWeight('medium');
    sheet.getRange(rowNum, 4).setValue(alloc).setNumberFormat('"Rp"#,##0').setHorizontalAlignment('right');
    sheet.getRange(rowNum, 5).setFormula('=SUMIFS(Spending!$E$4:$E$100, Spending!$D$4:$D$100, B' + rowNum + ', Spending!$G$4:$G$100, "PENGELUARAN")')
      .setNumberFormat('"Rp"#,##0').setHorizontalAlignment('right');
    sheet.getRange(rowNum, 6, 1, 3).merge().setFormula(
      '=SPARKLINE(MAX(0.01, MIN(E' + rowNum + ', D' + rowNum + ')), {"charttype","bar"; "max",D' + rowNum + '; "color1", IF(I' + rowNum + '>=1, "#F4A2A8", IF(I' + rowNum + '>=0.7, "#F3D19C", "#88C9D4"))})'
    );
    sheet.getRange(rowNum, 9).setFormula('=IFERROR(E' + rowNum + '/D' + rowNum + ', 0)')
      .setNumberFormat('0.00%').setHorizontalAlignment('right').setBackground('#FFF5F5');
  }
  sheet.getRange('B8:I17').setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);

  // Embedded Charts (Pie Chart & Column Bar Chart matching Image 1)
  var pieChart = sheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(sheet.getRange('B8:B17'))
    .addRange(sheet.getRange('E8:E17'))
    .setOption('title', 'Expense Realization Percentage')
    .setOption('is3D', true)
    .setOption('width', 420)
    .setOption('height', 260)
    .setPosition(19, 2, 0, 0)
    .build();
  sheet.insertChart(pieChart);

  var colChart = sheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sheet.getRange('B8:B17'))
    .addRange(sheet.getRange('E8:E17'))
    .setOption('title', 'Monthly Expense Realization by Category')
    .setOption('colors', ['#F4A2A8'])
    .setOption('width', 440)
    .setOption('height', 260)
    .setPosition(19, 6, 0, 0)
    .build();
  sheet.insertChart(colChart);
}

function buildBudgetingSheet(sheet, cashInit, atmInit) {
  sheet.setColumnWidth(1, 160);
  var months = ['Month', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September'];
  sheet.getRange(1, 1, 1, months.length).setValues([months])
    .setBackground('#E5E0D8').setFontWeight('bold').setHorizontalAlignment('center');

  // Section 1: Income Sources (#FCD34D Yellow)
  sheet.getRange('A3:J3').merge().setValue('Income Sources').setBackground('#FCD34D').setFontWeight('bold');
  sheet.getRange('A4:B7').setValues([
    ['Saldo Awal Uang Tunai', cashInit],
    ['Saldo Awal ATM 1', atmInit],
    ['Saldo Awal ATM 2', 1000000],
    ['Pemasukan Tambahan WA', '=SUMIFS(Spending!E4:E200, Spending!G4:G200, "PEMASUKAN")']
  ]);
  sheet.getRange('A8:B8').setValues([['Total', '=SUM(B4:B7)']])
    .setBackground('#CBD5E1').setFontWeight('bold');
  sheet.getRange('B4:B8').setNumberFormat('"Rp"#,##0');

  // Section 2: Savings & Wallets List (#67E8F9 Sky Blue)
  sheet.getRange('A9:J9').merge().setValue('Wallets & Savings List (Real-Time)').setBackground('#67E8F9').setFontWeight('bold');
  sheet.getRange('A10:B13').setValues([
    ['💵 Sisa Saldo Uang Tunai', '=Report!D6'],
    ['💳 Sisa Saldo ATM 1', '=Report!H6'],
    ['💳 Sisa Saldo ATM 2', '=Report!I6'],
    ['Grand Total Saldo Aktif', '=B10+B11+B12']
  ]);
  sheet.getRange('A13:B13').setBackground('#CBD5E1').setFontWeight('bold');
  sheet.getRange('B10:B13').setNumberFormat('"Rp"#,##0');

  // Section 3: Budgeting List (#FDA4AF Pink)
  sheet.getRange('A15:J15').merge().setValue('Budgeting List (Target vs Realisasi)').setBackground('#FDA4AF').setFontWeight('bold');
  for (var i = 0; i < CATEGORIES.length; i++) {
    sheet.getRange(16 + i, 1).setValue(CATEGORIES[i][0]);
    sheet.getRange(16 + i, 2).setValue(CATEGORIES[i][1]).setNumberFormat('"Rp"#,##0');
  }
  sheet.getRange(25, 1, 1, 2).setValues([['Total Budget', '=SUM(B16:B24)']])
    .setBackground('#CBD5E1').setFontWeight('bold');
  sheet.getRange(25, 2).setNumberFormat('"Rp"#,##0');
}

function buildSummarySheet(sheet) {
  const widths = [40, 120, 180, 140, 130, 120];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);

  sheet.getRange('A1:F1').merge().setValue('Budgeting & Wallet Summary')
    .setFontSize(16).setFontWeight('bold').setFontColor('#00897B').setHorizontalAlignment('center');

  // Top 3x3 Colored Summary Matrix (Uang Tunai, Saldo ATM 1, Saldo ATM 2)
  sheet.getRange('A3:B5').setValues([
    ['Uang Tunai', '=Report!D6'],
    ['Saldo ATM 1', '=Report!H6'],
    ['Saldo ATM 2', '=Report!I6']
  ]);
  sheet.getRange('A3').setBackground('#06B6D4').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getRange('A4').setBackground('#D946EF').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getRange('A5').setBackground('#0284C7').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getRange('B3:B5').setBackground('#F5F5F4').setNumberFormat('"Rp"#,##0').setFontWeight('bold');

  sheet.getRange('C3:D5').setValues([
    ['Needs (Kebutuhan)', '=SUMIFS(E8:E16, D8:D16, "Needs")'],
    ['Wants (Keinginan)', '=SUMIFS(E8:E16, D8:D16, "Wants")'],
    ['Realisasi Keluar WA', '=Report!F6']
  ]);
  sheet.getRange('C3').setBackground('#FBBF24').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getRange('C4').setBackground('#F43F5E').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getRange('C5').setBackground('#10B981').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getRange('D3:D5').setBackground('#F5F5F4').setNumberFormat('"Rp"#,##0').setFontWeight('bold');

  // Table Header Row 7
  sheet.getRange('A7:F7').setValues([[
    '✓', 'Account', 'Expenses List', 'Main Category', 'Realization (WA)', 'Percentage'
  ]]).setBackground('#E5E7EB').setFontWeight('bold').setHorizontalAlignment('center');

  sheet.getRange('A8:A16').insertCheckboxes();
  for (var idx = 0; idx < CATEGORIES.length; idx++) {
    var r = 8 + idx;
    sheet.getRange(r, 1).setValue(true);
    sheet.getRange(r, 2).setValue(CATEGORIES[idx][3]).setHorizontalAlignment('center');
    sheet.getRange(r, 3).setValue(CATEGORIES[idx][0]);
    sheet.getRange(r, 4).setValue(CATEGORIES[idx][2]).setHorizontalAlignment('center');
    sheet.getRange(r, 5).setFormula('=Report!E' + (9 + idx)).setNumberFormat('"Rp"#,##0');
    sheet.getRange(r, 6).setFormula('=IFERROR(E' + r + '/SUM($E$8:$E$16), 0)').setNumberFormat('0.00%').setBackground('#FEF9C3');
  }

  // Bar Chart Comparing Uang Tunai vs Saldo ATM 1 vs Saldo ATM 2
  var walletChart = sheet.newChart()
    .setChartType(Charts.ChartType.BAR)
    .addRange(sheet.getRange('A3:B5'))
    .setOption('title', 'Posisi Saldo: Uang Tunai vs ATM 1 vs ATM 2')
    .setOption('colors', ['#06B6D4'])
    .setOption('width', 400)
    .setOption('height', 220)
    .setPosition(18, 1, 0, 0)
    .build();
  sheet.insertChart(walletChart);
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    if (!ss.getSheetByName('Spending') || !ss.getSheetByName('Report')) {
      buildCompleteDashboardSuite(ss, payload.wallets, payload.allTransactions || payload.newRows || []);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, message: '5-Tab Dashboard Suite Built & Synced!' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Always sync initial_balance of the 3 Wallets into Setup!B2 (Tunai), Setup!B3 (ATM 1), Setup!B4 (ATM 2)
    const setupSheet = ss.getSheetByName('Setup');
    if (setupSheet && payload.wallets) {
      if (payload.wallets.cash && typeof payload.wallets.cash.initial_balance === 'number') {
        setupSheet.getRange('B2').setValue(payload.wallets.cash.initial_balance);
      }
      if (payload.wallets.atm && typeof payload.wallets.atm.initial_balance === 'number') {
        setupSheet.getRange('B3').setValue(payload.wallets.atm.initial_balance);
      }
      if (payload.wallets.atm2 && typeof payload.wallets.atm2.initial_balance === 'number') {
        setupSheet.getRange('B4').setValue(payload.wallets.atm2.initial_balance);
      }
    }

    // If all 3 wallets are 0 on Website/WA (clean start), clear dummy Spending rows while keeping categories 100% safe
    if (
      payload.wallets &&
      Number(payload.wallets.cash?.balance || 0) === 0 &&
      Number(payload.wallets.atm?.balance || 0) === 0 &&
      Number(payload.wallets.atm2?.balance || 0) === 0 &&
      (!payload.newRows || payload.newRows.length === 0)
    ) {
      resetSaldoDanTransaksiKeNolTanpaUbahKategori();
      return ContentService.createTextOutput(JSON.stringify({ ok: true, message: 'Saldo & Transaksi di-reset ke Rp 0 (Kategori Tetap Aman)!' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Non-destructive patch if FULL_SYNC is triggered on an existing spreadsheet
    if (payload.action === 'FULL_SYNC') {
      updateDropdownDanAtmTanpaReset();
      return ContentService.createTextOutput(JSON.stringify({ ok: true, message: 'Non-Destructive Patch & Saldo 3 Dompet Synced!' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Append new WA transaction rows to Spending Tracker tab
    const spendingSheet = ss.getSheetByName('Spending');
    if (spendingSheet && Array.isArray(payload.newRows) && payload.newRows.length > 0) {
      // Find first empty row in Column C (Description) starting from Row 4
      const descValues = spendingSheet.getRange('C4:C200').getValues();
      let targetRow = 4;
      for (var i = 0; i < descValues.length; i++) {
        if (!descValues[i][0]) {
          targetRow = 4 + i;
          break;
        }
      }
      for (var rIdx = 0; rIdx < payload.newRows.length; rIdx++) {
        spendingSheet.getRange(targetRow + rIdx, 1, 1, 10).setValues([payload.newRows[rIdx]]);
        spendingSheet.getRange(targetRow + rIdx, 5).setNumberFormat('"Rp"#,##0');
        spendingSheet.getRange(targetRow + rIdx, 8, 1, 2).setNumberFormat('"Rp"#,##0');
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true, message: 'Spending & Report Dashboard Updated!' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var reportSheet = ss.getSheetByName('Report');
    var wallets = null;
    if (reportSheet) {
      wallets = {
        cash: Number(reportSheet.getRange('D6').getValue() || 0),
        atm1: Number(reportSheet.getRange('H6').getValue() || 0),
        atm2: Number(reportSheet.getRange('I6').getValue() || 0)
      };
    }
    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      wallets: wallets,
      status: 'Aktif! 5-Tab Money Management Dashboard Webhook siap menerima transaksi WA.'
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      status: 'Aktif! 5-Tab Money Management Dashboard Webhook siap menerima transaksi WA.'
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
`;
}

const DEFAULT_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbxdhh_Lfug1rDisxX4KTShgwMb5NzcBQPm-zP76vZHwZycZ55uhT8Qk8ooYzCpSo85mBw/exec';

let lastHydratedAt = 0;

/**
 * Hydrates wallet balances from Google Spreadsheet on Vercel Serverless cold starts
 */
async function hydrateFromGoogleSheets(force = false) {
  const settings = getSettings();
  const webhookUrl = (settings.apps_script_webhook_url || '').trim() || DEFAULT_WEBHOOK_URL;
  if (!webhookUrl || !webhookUrl.startsWith('https://script.google.com/')) return false;
  if (!force && Date.now() - lastHydratedAt < 25000) return true;

  try {
    const res = await fetch(`${webhookUrl}?action=STATE`, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json().catch(() => null);
    if (data && data.ok && data.wallets) {
      hydrateStateFromCloud(data);
      lastHydratedAt = Date.now();
      return true;
    }
  } catch {}
  return false;
}

/**
 * Syncs newly created transactions + updated wallet balances to Google Spreadsheet
 */
async function syncToGoogleSheets(newTransactions = [], forceFullSync = false) {
  const settings = getSettings();
  const spreadsheetId =
    (settings.spreadsheet_id || '1_UvnRmnVZzxfzNp-mASlWtrpuqShcDD8ei8NuHK3YkM').trim();
  const webhookUrl = (settings.apps_script_webhook_url || '').trim() || DEFAULT_WEBHOOK_URL;

  const wallets = getWallets();
  const timestamp = formatWIBDate(new Date().toISOString());

  if (webhookUrl && webhookUrl.startsWith('https://script.google.com/')) {
    try {
      const payload = {
        action: 'APPEND',
        timestamp,
        wallets,
        newRows: newTransactions.map(formatTransactionRow),
      };

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });

      const data = await res.json().catch(() => ({ ok: res.ok }));
      if (data && data.ok !== false) {
        for (const tx of newTransactions) {
          markTransactionSynced(tx.id, null);
        }
        if (forceFullSync) {
          for (const tx of getUnsyncedTransactions()) {
            markTransactionSynced(tx.id, null);
          }
        }
        return {
          synced: true,
          method: 'APPS_SCRIPT_WEBHOOK',
          spreadsheetId,
          message: 'Berhasil update 5-Tab Money Management Dashboard di Google Spreadsheet!',
        };
      } else {
        throw new Error(data?.error || 'Gagal memanggil Apps Script Webhook');
      }
    } catch (err) {
      for (const tx of newTransactions) {
        markTransactionSynced(tx.id, err.message);
      }
      return {
        synced: false,
        method: 'APPS_SCRIPT_WEBHOOK',
        spreadsheetId,
        error: err.message,
      };
    }
  }

  return {
    synced: false,
    method: 'PENDING_SETUP',
    spreadsheetId,
    message: 'Siap disinkronkan ke 5-Tab Money Management Dashboard Spreadsheet.',
  };
}

module.exports = {
  syncToGoogleSheets,
  hydrateFromGoogleSheets,
  getAppsScriptTemplate,
  formatRupiah,
  formatWIBDate,
};
