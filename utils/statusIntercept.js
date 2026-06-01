/**
 * Auto Status Intercept - forwards viewed WhatsApp statuses to owner.
 */

const chalk = require('chalk');
const config = require('../config');

const STATUS_REACTIONS = ['👍', '👀', '🔥', '🤐', '😮', '🍿', '💯', '😂', '👏', '🥂', '🤔', '🫡', '⚡', '🛸'];
const FALLBACK_PFP = 'https://placehold.co/150x150/1e293b/ffffff?text=JB';
const STATUS_JID = 'status@broadcast';

const sanitizeNumberDigits = (value = '') => String(value).replace(/\D/g, '');
const isJid = (value) => typeof value === 'string' && value.includes('@');
const isStatusJid = (value) => value === STATUS_JID;

const unwrapMessage = (message = {}) => {
  let current = message || {};
  const wrappers = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage'
  ];

  for (let depth = 0; depth < 6 && current; depth++) {
    const wrapperKey = wrappers.find((key) => current?.[key]?.message);
    if (!wrapperKey) break;
    current = current[wrapperKey].message;
  }

  return current || {};
};

const detectMessageType = (message = {}) => {
  const unwrapped = unwrapMessage(message);
  const order = ['conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage'];
  return order.find((key) => unwrapped?.[key]) || Object.keys(unwrapped || {}).find((key) => key !== 'messageContextInfo') || null;
};

const formatTimestamp = (timestampSeconds = 0) => {
  const timestamp = Number(timestampSeconds || 0);
  const date = new Date((timestamp > 0 ? timestamp : Math.floor(Date.now() / 1000)) * 1000);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone || 'Africa/Harare',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour12: false
  }).format(date).replace(',', ' •');
};

const normalizeUserJid = (jid) => {
  if (!isJid(jid)) return null;
  const [user, server] = String(jid).split('@');
  if (!user || !server) return null;
  return `${user.split(':')[0]}@${server}`;
};

const getOwnJids = (sock) => [
  sock?.user?.id,
  sock?.user?.jid,
  sock?.user?.lid,
  sock?.authState?.creds?.me?.id,
  sock?.authState?.creds?.me?.lid
].map(normalizeUserJid).filter(Boolean);

const isOwnStatus = (sock, posterJid) => {
  const normalizedPoster = normalizeUserJid(posterJid);
  if (!normalizedPoster) return false;
  return getOwnJids(sock).includes(normalizedPoster);
};

const firstValidJid = (values = []) => values.find((jid) => isJid(jid) && !isStatusJid(jid));

const resolveStatusRemoteJid = (msg = {}) => {
  const message = unwrapMessage(msg.message || {});
  return [
    msg?.key?.remoteJid,
    msg?.message?.protocolMessage?.key?.remoteJid,
    msg?.message?.reactionMessage?.key?.remoteJid,
    message?.protocolMessage?.key?.remoteJid,
    message?.reactionMessage?.key?.remoteJid
  ].find(isStatusJid) || null;
};

const resolvePosterJid = (sock, msg = {}) => {
  const message = unwrapMessage(msg.message || {});
  const candidates = [
    msg?.key?.participant,
    msg?.key?.participant_pn,
    msg?.participant,
    msg?.participant_pn,
    msg?.message?.protocolMessage?.key?.participant,
    msg?.message?.reactionMessage?.key?.participant,
    msg?.message?.messageContextInfo?.participant,
    message?.protocolMessage?.key?.participant,
    message?.reactionMessage?.key?.participant,
    message?.messageContextInfo?.participant,
    msg?.key?.participant_lid,
    msg?.participant_lid
  ].map(normalizeUserJid).filter(Boolean);

  const firstValid = firstValidJid(candidates);
  if (firstValid) return firstValid;

  if (msg?.key?.fromMe) {
    return getOwnJids(sock)[0] || null;
  }

  return null;
};

const buildStatusKey = (msg, posterJid) => ({
  ...msg.key,
  remoteJid: STATUS_JID,
  participant: posterJid || msg?.key?.participant,
  fromMe: Boolean(msg?.key?.fromMe),
  id: msg?.key?.id
});

const logInterceptStep = ({ logTag, cmdTag, pushName, senderNumber, mtype, time, body }) => {
  console.log(
    chalk.gray(`\n┌─── `) + chalk.cyan(`JAILBREAK INTERCEPT`) + chalk.gray(` ───\n`) +
    chalk.gray(`│ `) + logTag + chalk.white(` From: ${pushName} (${senderNumber})\n`) +
    chalk.gray(`│ `) + cmdTag + chalk.gray(` | Type: ${mtype} | Time: ${time}\n`) +
    chalk.gray(`│ `) + chalk.magenta(`Content: `) + chalk.white((body || '').length > 50 ? (body || '').substring(0, 50) + '...' : (body || '')) + `\n` +
    chalk.gray(`└───────────────────────────`)
  );
};

const resolveOwnerJid = (sock) => {
  const ownerNumbers = Array.isArray(config.ownerNumber)
    ? config.ownerNumber
    : String(config.ownerNumber || '').split(',');

  const ownerNumber = ownerNumbers
    .map((num) => sanitizeNumberDigits(num))
    .find(Boolean);

  if (ownerNumber) return `${ownerNumber}@s.whatsapp.net`;
  return getOwnJids(sock)[0] || null;
};

async function notifyCriticalStatusError(sock, error, msg) {
  const targetJid = resolveOwnerJid(sock);
  if (!targetJid) return;

  const detail = error?.stack || error?.message || String(error);
  try {
    await sock.sendMessage(targetJid, {
      text: `🚨 *STATUS INTERCEPT CRITICAL ERROR*\n\n${detail.slice(0, 1500)}`,
      contextInfo: {
        forwardingScore: 1,
        isForwarded: true
      }
    }, msg ? { quoted: msg } : {});
  } catch (notifyError) {
    console.error('❌ [STATUS] Failed to notify owner about critical error:', notifyError.message || notifyError);
  }
}

async function handleAutoStatusIntercept(sock, msg, { downloadMediaMessage } = {}) {
  try {
    const from = resolveStatusRemoteJid(msg);
    if (from !== STATUS_JID) return false;

    const posterJid = resolvePosterJid(sock, msg);
    if (!posterJid) {
      console.warn('⚠️ [STATUS] Skipping status without a resolvable poster JID:', msg?.key?.id || 'unknown-id');
      return true;
    }

    if (posterJid === STATUS_JID || isOwnStatus(sock, posterJid)) {
      return true;
    }

    const statusKey = buildStatusKey(msg, posterJid);
    const posterNumber = sanitizeNumberDigits(posterJid.split('@')[0] || '');
    const randomEmoji = STATUS_REACTIONS[Math.floor(Math.random() * STATUS_REACTIONS.length)];
    const targetJid = resolveOwnerJid(sock);

    if (!targetJid) {
      console.warn('⚠️ [STATUS] Skipping status intercept because no owner JID is configured.');
      return true;
    }

    try {
      logInterceptStep({ logTag: chalk.yellow('[STATUS]'), cmdTag: chalk.cyan('trying to leave a view'), pushName: msg.pushName || posterNumber || 'Unknown', senderNumber: posterNumber || 'unknown', mtype: 'status', time: formatTimestamp(msg.messageTimestamp), body: '' });
      if (typeof sock.readMessages === 'function') {
        await sock.readMessages([statusKey]);
      }
      logInterceptStep({ logTag: chalk.yellow('[STATUS]'), cmdTag: chalk.green('view done now liking and reacting'), pushName: msg.pushName || posterNumber || 'Unknown', senderNumber: posterNumber || 'unknown', mtype: 'status', time: formatTimestamp(msg.messageTimestamp), body: '' });
      await sock.sendMessage(
        STATUS_JID,
        { react: { text: randomEmoji, key: statusKey } },
        { statusJidList: [posterJid] }
      );
    } catch (error) {
      console.error('⚠️ [STATUS] Auto view/react failed:', error.message || error);
    }

    const messageData = unwrapMessage(msg.message || {});
    const messageType = detectMessageType(messageData);
    const body = (
      messageType === 'conversation'
        ? messageData.conversation
        : messageData[messageType]?.caption || messageData[messageType]?.text || ''
    ).trim();

    let profilePicUrl = FALLBACK_PFP;
    try {
      profilePicUrl = await sock.profilePictureUrl(posterJid, 'image');
    } catch (_) {
      profilePicUrl = FALLBACK_PFP;
    }

    const displayName = (msg.pushName || posterNumber || 'Unknown').trim();
    const postedTime = formatTimestamp(msg.messageTimestamp);

    logInterceptStep({
      logTag: chalk.yellow('[STATUS]'),
      cmdTag: chalk.cyan('status updated'),
      pushName: displayName,
      senderNumber: posterNumber || 'unknown',
      mtype: messageType || 'unknown',
      time: postedTime,
      body
    });

    const jbContext = {
      forwardingScore: 1,
      isForwarded: true,
      forwardedNewsletterMessageInfo: {
        newsletterJid: config.newsletterJid || '120363161513685998@newsletter',
        newsletterName: 'JAILBREAK HOME',
        serverMessageId: -1
      },
      externalAdReply: {
        title: `STATUS: ${displayName.toUpperCase()}`,
        body: `Captured by ${config.botName} [${randomEmoji}]`,
        thumbnailUrl: profilePicUrl,
        mediaType: 1,
        renderLargerThumbnail: true,
        sourceUrl: `https://github.com/jailbreakalt1/JAILBREAK-XMD`
      }
    };

    let caption = `⚡ *JAILBREAK STATUS INTERCEPT*\n\n`;
    caption += `👤 *Poster:* ${displayName}\n`;
    caption += `📱 *Number:* ${posterNumber}\n`;
    caption += `🕒 *Captured:* ${postedTime}\n`;
    caption += `🎭 *Reaction:* ${randomEmoji}`;
    if (body) caption += `\n\n📝 *Caption:*\n${body}`;

    let messageToSend = {
      text: caption,
      ai: true,
      contextInfo: jbContext
    };

    if (['imageMessage', 'videoMessage', 'audioMessage'].includes(messageType) && downloadMediaMessage) {
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage?.bind(sock) });
        if (buffer) {
          if (messageType === 'imageMessage') {
            messageToSend = { image: buffer, caption, ai: true, contextInfo: jbContext };
          } else if (messageType === 'videoMessage') {
            messageToSend = { video: buffer, caption, mimetype: messageData.videoMessage?.mimetype || 'video/mp4', ai: true, contextInfo: jbContext };
          } else {
            messageToSend = { audio: buffer, mimetype: messageData.audioMessage?.mimetype || 'audio/mp4', ptt: Boolean(messageData.audioMessage?.ptt), ai: true, contextInfo: jbContext };
          }
        }
      } catch (error) {
        console.error('❌ [STATUS] Media download failed:', error.message || error);
        messageToSend.text = `${caption}\n\n⚠️ *Media Intercept Failed*`;
      }
    }

    logInterceptStep({ logTag: chalk.yellow('[STATUS]'), cmdTag: chalk.blue('forwarding to ownerNumber'), pushName: displayName, senderNumber: posterNumber || 'unknown', mtype: messageType || 'unknown', time: postedTime, body });
    await sock.sendMessage(targetJid, messageToSend);
    logInterceptStep({ logTag: chalk.green('[STATUS]'), cmdTag: chalk.green('success'), pushName: displayName, senderNumber: posterNumber || 'unknown', mtype: messageType || 'unknown', time: postedTime, body });
    console.log(`✅ [STATUS] Intercept logged: ${posterNumber}`);
    return true;
  } catch (error) {
    console.error('❌ [STATUS] Intercept error:', error.message || error);
    await notifyCriticalStatusError(sock, error, msg);
    return true;
  }
}

module.exports = {
  handleAutoStatusIntercept,
  isStatusMessage: (msg) => resolveStatusRemoteJid(msg) === STATUS_JID,
  _private: {
    unwrapMessage,
    detectMessageType,
    resolvePosterJid,
    resolveStatusRemoteJid,
    normalizeUserJid,
    buildStatusKey,
    resolveOwnerJid
  }
};
