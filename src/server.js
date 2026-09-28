const path = require('node:path');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const {
  getDashboardSummary,
  updateSettings,
  getSettings,
  setWalletBalance,
} = require('./db/database');
const { processIncomingChat } = require('./services/messageProcessor');
const { syncToGoogleSheets, getAppsScriptTemplate } = require('./services/googleSheetsSync');
const {
  startWhatsAppBot,
  logoutWhatsAppBot,
  getWhatsAppState,
} = require('./services/whatsappBot');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Connected SSE clients for instant real-time UI updates
const sseClients = new Set();

function broadcastStateUpdate() {
  const payload = `data: ${JSON.stringify({ type: 'STATE_UPDATE', ts: Date.now() })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

// SSE Endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED' })}\n\n`);
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Dashboard Data Endpoint
app.get('/api/dashboard', (req, res) => {
  try {
    const summary = getDashboardSummary();
    const spreadsheetId =
      summary.settings?.spreadsheet_id || '1_UvnRmnVZzxfzNp-mASlWtrpuqShcDD8ei8NuHK3YkM';

    res.json({
      ...summary,
      waState: getWhatsAppState(),
      appsScriptTemplate: getAppsScriptTemplate(spreadsheetId),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Chat / Simulator / Direct Transaction Input Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const message = (req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
    }

    const result = await processIncomingChat(message, 'DASHBOARD', broadcastStateUpdate);
    broadcastStateUpdate();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fonnte requires both GET and POST on the Webhook URL ("Webhook url must allow POST and GET method")
app.get('/api/webhook/fonnte', (req, res) => {
  res.status(200).json({ ok: true, status: 'Fonnte Webhook Ready (GET & POST supported)' });
});

// Fonnte WhatsApp Webhook Endpoint (Strictly Personal Only — Never Replies to Groups)
app.post('/api/webhook/fonnte', async (req, res) => {
  try {
    const sender = String(req.body?.sender || req.body?.pengirim || '').trim();
    const message = String(req.body?.message || req.body?.pesan || '').trim();
    const isGroup = Boolean(req.body?.isgroup) || sender.includes('@g.us') || sender.includes('-');

    // STRICT GUARD: Never process or reply to WhatsApp Groups / Communities!
    if (!message || isGroup) {
      return res.json({ ok: true, ignored: true, reason: 'Group or empty message ignored' });
    }

    // Check Whitelist (Default: only allow owner's number 6281335499566 or configured whitelist)
    const settings = getSettings();
    const whitelistRaw = (settings.wa_whitelist || '6281335499566').trim();
    if (whitelistRaw) {
      const allowedNumbers = whitelistRaw
        .split(',')
        .map((s) => s.replace(/\D/g, '').replace(/^0/, '62'))
        .filter(Boolean);
      const senderNormalized = sender.replace(/\D/g, '').replace(/^0/, '62');
      if (allowedNumbers.length > 0 && !allowedNumbers.some((num) => senderNormalized.includes(num))) {
        return res.json({ ok: true, ignored: true, reason: 'Sender not in personal whitelist' });
      }
    }

    const result = await processIncomingChat(message, 'WHATSAPP_FONNTE', broadcastStateUpdate);
    broadcastStateUpdate();

    // Send reply via Fonnte API (tries configured token first, with automatic fallback to active device token VN18b5w8U9s3mW5VHWJV)
    const primaryToken = (settings.fonnte_token || process.env.FONNTE_TOKEN || '1E3YJAQdyanaCKQytCV9').trim();
    const candidateTokens = Array.from(new Set([primaryToken, 'VN18b5w8U9s3mW5VHWJV', '1E3YJAQdyanaCKQytCV9'].filter(Boolean)));

    if (result?.handled && result?.reply && sender) {
      for (const token of candidateTokens) {
        try {
          const fRes = await fetch('https://api.fonnte.com/send', {
            method: 'POST',
            headers: {
              Authorization: token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              target: sender,
              message: result.reply,
            }),
          });
          const fData = await fRes.json().catch(() => ({}));
          if (fData && fData.status === true) {
            break;
          }
        } catch {}
      }
    }

    res.json({
      ok: true,
      handled: result.handled,
      reply: result.reply,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Manual Wallet Balance Adjustment
app.post('/api/wallets/balance', async (req, res) => {
  try {
    const { wallet, balance } = req.body || {};
    const wallets = setWalletBalance(wallet, balance);
    await syncToGoogleSheets([], true);
    broadcastStateUpdate();
    res.json({ ok: true, wallets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Settings (Spreadsheet URL, OpenRouter/Groq Key, WA Whitelist)
app.post('/api/settings', async (req, res) => {
  try {
    const body = req.body || {};
    // Extract spreadsheet_id if user pasted full Google Sheets URL
    if (body.spreadsheet_id && body.spreadsheet_id.includes('/spreadsheets/d/')) {
      const match = body.spreadsheet_id.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (match) {
        body.spreadsheet_url = body.spreadsheet_id;
        body.spreadsheet_id = match[1];
      }
    }
    const updated = updateSettings(body);
    broadcastStateUpdate();
    res.json({ ok: true, settings: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force Full Sync to Google Spreadsheet
app.post('/api/sheets/sync', async (req, res) => {
  try {
    const syncResult = await syncToGoogleSheets([], true);
    broadcastStateUpdate();
    res.json(syncResult);
  } catch (err) {
    res.status(500).json({ synced: false, error: err.message });
  }
});

// Connect WhatsApp Bot (Baileys QR)
app.post('/api/wa/connect', async (req, res) => {
  try {
    const state = await startWhatsAppBot(() => {
      broadcastStateUpdate();
    });
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disconnect WhatsApp Bot
app.post('/api/wa/logout', async (req, res) => {
  try {
    const state = await logoutWhatsAppBot(() => {
      broadcastStateUpdate();
    });
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`==================================================================`);
    console.log(`🚀 Server Bot AI WA & Dashboard Aktif di: http://localhost:${PORT}`);
    console.log(`📗 Target Google Spreadsheet: https://docs.google.com/spreadsheets/d/1_UvnRmnVZzxfzNp-mASlWtrpuqShcDD8ei8NuHK3YkM/edit`);
    console.log(`==================================================================`);
  });
}

module.exports = { app };
