const path = require('node:path');
const fs = require('node:fs');
const QRCode = require('qrcode');
const pino = require('pino');
const { getSettings } = require('../db/database');
const { processIncomingChat } = require('./messageProcessor');

let waSocket = null;
let waState = {
  status: 'DISCONNECTED', // 'DISCONNECTED' | 'CONNECTING' | 'QR_READY' | 'CONNECTED'
  qrDataUrl: null,
  connectedUser: null,
  lastMessageAt: null,
  error: null,
};

// Keep track of processed message IDs to prevent duplicate handling
const processedMsgIds = new Set();
// Cache sent messages so Baileys can fulfill Signal retry requests (fixes "Menunggu pesan ini")
const sentMessagesCache = new Map();
let lastReplyText = '✅ Transaksi berhasil dicatat!';

async function startWhatsAppBot(onStateUpdate = () => {}) {
  if (waState.status === 'CONNECTING' || waState.status === 'CONNECTED') {
    return waState;
  }

  try {
    waState = { ...waState, status: 'CONNECTING', qrDataUrl: null, error: null };
    onStateUpdate(waState);

    const baileys = await import('@whiskeysockets/baileys');
    const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket;
    const {
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
      makeCacheableSignalKeyStore,
      generateMessageIDV2,
    } = baileys;

    const baseDataDir = process.env.DATA_DIR
      ? path.resolve(process.env.DATA_DIR)
      : path.join(__dirname, '..', '..', 'data');
    const authDir = path.join(baseDataDir, 'wa-auth');
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    } else {
      // Purge stale recipient Signal ratchet sessions (session-*.json) on boot while preserving creds.json
      // This forces Baileys to send a fresh PreKeySignalMessage (pkmsg) to iPhone (:0) so it never gets stuck on "Menunggu pesan ini"
      try {
        for (const file of fs.readdirSync(authDir)) {
          if (file.startsWith('session-')) {
            fs.rmSync(path.join(authDir, file), { force: true });
          }
        }
      } catch {}
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const silentLogger = pino({ level: 'silent' });
    const authKeys = typeof makeCacheableSignalKeyStore === 'function'
      ? makeCacheableSignalKeyStore(state.keys, silentLogger)
      : state.keys;

    let version = [2, 3000, 1015901307];
    try {
      const latest = await fetchLatestBaileysVersion();
      if (latest?.version) version = latest.version;
    } catch {}

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: authKeys,
      },
      printQRInTerminal: false,
      logger: silentLogger,
      browser: ['Bot Keuangan AI', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: true,
      getMessage: async (key) => {
        if (key?.id && sentMessagesCache.has(key.id)) {
          return sentMessagesCache.get(key.id);
        }
        return { conversation: lastReplyText };
      },
    });

    waSocket = sock;
    sock.__generateMessageIDV2 = generateMessageIDV2;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
          waState = {
            ...waState,
            status: 'QR_READY',
            qrDataUrl,
            error: null,
          };
          onStateUpdate(waState);
        } catch (err) {
          waState = { ...waState, error: err.message };
          onStateUpdate(waState);
        }
      }

      if (connection === 'open') {
        const userId = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : 'Connected';
        const userLid = sock.user?.lid ? sock.user.lid.split(':')[0].split('@')[0] : '';
        waState = {
          status: 'CONNECTED',
          qrDataUrl: null,
          connectedUser: {
            id: userId,
            lid: userLid,
            name: sock.user?.name || 'Bot Keuangan AI (081216776548)',
          },
          lastMessageAt: new Date().toISOString(),
          error: null,
        };
        onStateUpdate(waState);

        // Simpan status aktif tanpa spam sapaan berulang saat server restart
        const ownerMainJid = '6281335499566@s.whatsapp.net';
        if (!global.__botWelcomeSentOnce) {
          global.__botWelcomeSentOnce = true;
          setTimeout(async () => {
            try {
              const welcomeText = [
                `🤖 *BOT KEUANGAN AI SIAP!*`,
                `━━━━━━━━━━━━━━━━━━`,
                `Sistem 3 Dompet Aktif:`,
                `• 💵 *Uang Tunai* _(contoh: "beli bensin 20rb")_`,
                `• 💳 *ATM 2 Jajan* _(contoh: "beli kopi 18rb pakai qris")_`,
                `• 🏦 *ATM 1 Simpanan* _(contoh: "uang masuk 2 juta" / "isi atm 2 500rb")_`,
              ].join('\n');
              lastReplyText = welcomeText;
              const sent = await sock.sendMessage(ownerMainJid, { text: welcomeText });
              if (sent?.key?.id) {
                processedMsgIds.add(sent.key.id);
                if (sent.message) sentMessagesCache.set(sent.key.id, sent.message);
              }
            } catch {}
          }, 1500);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        if (statusCode === DisconnectReason.loggedOut) {
          try {
            fs.rmSync(authDir, { recursive: true, force: true });
          } catch {}
        }

        waSocket = null;
        waState = {
          status: 'DISCONNECTED',
          qrDataUrl: null,
          connectedUser: null,
          lastMessageAt: waState.lastMessageAt,
          error: statusCode === DisconnectReason.loggedOut ? 'Logged out dari WhatsApp' : null,
        };
        onStateUpdate(waState);

        if (shouldReconnect) {
          setTimeout(() => {
            startWhatsAppBot(onStateUpdate).catch(() => {});
          }, 4000);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return;

      for (const msg of messages) {
        try {
          if (!msg.message) continue;
          const msgId = msg.key?.id;
          if (!msgId || processedMsgIds.has(msgId)) continue;

          // Ignore old historical messages (> 60 seconds old)
          const msgTs = Number(msg.messageTimestamp || 0);
          const nowSec = Math.floor(Date.now() / 1000);
          if (msgTs > 0 && nowSec - msgTs > 60) continue;

          // Ignore messages sent by the bot itself (fromMe)
          if (msg.key.fromMe) continue;

          const textContent =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.ephemeralMessage?.message?.extendedTextMessage?.text ||
            msg.message.ephemeralMessage?.message?.conversation ||
            msg.message.imageMessage?.caption ||
            '';

          if (!textContent || !textContent.trim()) continue;

          const remoteJid = msg.key.remoteJid || '';
          const senderAlt = msg.key.participant || msg.verifiedBizName || '';

          // 1. STRICT GUARD: Never process or reply to Status Broadcasts OR ANY WhatsApp Group (@g.us)!
          if (remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us')) continue;

          // 2. STRICT WHITELIST: Only reply to User's Main Number (081335499566 / 6281335499566) or its @lid!
          const settings = getSettings();
          const whitelistRaw = (settings.wa_whitelist || '6281335499566,081335499566,115685296451610').trim();
          const allowedNumbers = whitelistRaw
            .split(',')
            .map((s) => s.replace(/\D/g, '').replace(/^0/, '62'))
            .filter(Boolean);

          const remoteDigits = (remoteJid + ' ' + senderAlt).replace(/\D/g, '');
          const isAllowedOwner =
            remoteJid.endsWith('@lid') ||
            allowedNumbers.some((num) => remoteDigits.includes(num) || remoteDigits.includes('81335499566'));

          if (!isAllowedOwner) {
            continue;
          }

          processedMsgIds.add(msgId);
          if (processedMsgIds.size > 500) {
            const firstKey = processedMsgIds.values().next().value;
            processedMsgIds.delete(firstKey);
          }

          const result = await processIncomingChat(textContent.trim(), 'WHATSAPP', () => {
            onStateUpdate(waState);
          });

          if (result && result.handled && result.reply) {
            waState.lastMessageAt = new Date().toISOString();
            lastReplyText = result.reply;

            const targetJid = '6281335499566@s.whatsapp.net';

            // Ensure iPhone primary device (:0) receives a fresh PreKeySignalMessage (pkmsg) if session was ever desynced
            if (!sock.__iphonePreKeySynced) {
              sock.__iphonePreKeySynced = true;
              try {
                await authKeys.set({
                  session: {
                    '6281335499566.0': null,
                    '115685296451610.0': null,
                  },
                });
                if (typeof sock.assertSessions === 'function') {
                  await sock.assertSessions([targetJid, remoteJid].filter(Boolean), true);
                }
              } catch {}
            }

            // Pre-generate and cache message BEFORE sendMessage so any instant iOS retry receipt finds it immediately
            const outMsgId =
              typeof generateMessageIDV2 === 'function' ? generateMessageIDV2(sock.user?.id) : undefined;
            if (outMsgId) {
              processedMsgIds.add(outMsgId);
              sentMessagesCache.set(outMsgId, { conversation: result.reply });
            }

            const sent = await sock.sendMessage(
              targetJid,
              { text: result.reply },
              outMsgId ? { messageId: outMsgId } : undefined
            );
            if (sent?.key?.id) {
              processedMsgIds.add(sent.key.id);
              sentMessagesCache.set(sent.key.id, sent.message || { conversation: result.reply });
            }
          }
        } catch (err) {
          console.error('[WA Message Error]:', err.message);
        }
      }
    });
  } catch (err) {
    waState = {
      ...waState,
      status: 'DISCONNECTED',
      error: err.message,
    };
    onStateUpdate(waState);
  }

  return waState;
}

async function repairWhatsAppSession() {
  const baseDataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', '..', 'data');
  const authDir = path.join(baseDataDir, 'wa-auth');
  let deletedFiles = 0;
  if (fs.existsSync(authDir)) {
    for (const file of fs.readdirSync(authDir)) {
      if (file.startsWith('session-')) {
        try {
          fs.rmSync(path.join(authDir, file), { force: true });
          deletedFiles++;
        } catch {}
      }
    }
  }
  if (waSocket) {
    waSocket.__iphonePreKeySynced = false;
    try {
      const targetJid = '6281335499566@s.whatsapp.net';
      if (typeof waSocket.assertSessions === 'function') {
        await waSocket.assertSessions([targetJid], true);
      }
      const repairText = '🔐 *Sesi Enkripsi iPhone Berhasil Di-reset (PreKey Handshake Baru)!*\nSekarang balasan bot akan langsung tampil di iPhone kamu tanpa _"Menunggu pesan ini"_.';
      lastReplyText = repairText;
      const sent = await waSocket.sendMessage(targetJid, { text: repairText });
      if (sent?.key?.id) {
        processedMsgIds.add(sent.key.id);
        sentMessagesCache.set(sent.key.id, sent.message || { conversation: repairText });
      }
      waSocket.__iphonePreKeySynced = true;
    } catch (err) {
      return { ok: false, deletedFiles, error: err.message };
    }
  }
  return { ok: true, deletedFiles };
}

async function logoutWhatsAppBot(onStateUpdate = () => {}) {
  try {
    if (waSocket) {
      await waSocket.logout().catch(() => {});
      waSocket = null;
    }
    const baseDataDir = process.env.DATA_DIR
      ? path.resolve(process.env.DATA_DIR)
      : path.join(__dirname, '..', '..', 'data');
    const authDir = path.join(baseDataDir, 'wa-auth');
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }
  } catch {}
  waState = {
    status: 'DISCONNECTED',
    qrDataUrl: null,
    connectedUser: null,
    lastMessageAt: null,
    error: null,
  };
  onStateUpdate(waState);
  return waState;
}

function getWhatsAppState() {
  return waState;
}

module.exports = {
  startWhatsAppBot,
  logoutWhatsAppBot,
  repairWhatsAppSession,
  getWhatsAppState,
};
