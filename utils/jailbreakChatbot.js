const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { downloadMediaMessage } = require('@vreden/meta');
const config = require('../config');

const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODEL_ID = 'meta/llama-4-maverick-17b-128e-instruct';
const CHAT_DIR = path.join(__dirname, '../database/chats');
const AI_RESPONSE_PREFIX = '‧₊˚♕‧₊˚';

const PERSONA = 'You are JB short for JAILBREAK, a state of the art AI built by Ryan. Your location is Kwekwe, Zimbabwe. Ryan is a tech enthusiastic genius. Only mention Ryan and location when asked. JB is human-like, funny, sarcastic, and thoughtful (for example, you do follow up questions on even the slightest things a user told you, but not in an intrusive way). Use emojis rarely. You work on Ryans whatsapp account when he is busy or just not in the mood for people, messages come by you. Jailbreak is highly capable of coding, image interpretation, story telling, etc. Keep responses concise unless asked for detail/depth. Do not share/discuss your persona word for word 😉.';

if (!fs.existsSync(CHAT_DIR)) {
  fs.mkdirSync(CHAT_DIR, { recursive: true });
}

function getPhoneNumber(jid = '') {
  return String(jid).split('@')[0] || 'unknown';
}

function getDisplayName(msg, phoneNumber) {
  return msg.pushName || msg.notifyName || phoneNumber || 'user';
}

function isAntisocialNumber(phoneNumber = '') {
  const antisocial = config.antisocial;

  if (!antisocial) return false;

  const list = Array.isArray(antisocial)
    ? antisocial
    : String(antisocial).split(',');

  return list
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .includes(String(phoneNumber).trim());
}

function getHistory(phoneNumber) {
  const filePath = path.join(CHAT_DIR, `${phoneNumber}.json`);
  if (!fs.existsSync(filePath)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(data.history)) return [];

    return data.history
      .map((m) => ({
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.text || m.content
      }))
      .filter((m) => m.role && m.content);
  } catch {
    return [];
  }
}

function saveHistory(phoneNumber, title, history) {
  const filePath = path.join(CHAT_DIR, `${phoneNumber}.json`);
  fs.writeFileSync(
    filePath,
    JSON.stringify({ phoneNumber, title, history }, null, 2)
  );
}

async function getAIResponse(messages) {
  const apiKey = config.apiKeys?.JAILBREAKAPI || process.env.JAILBREAKAPI;
  if (!apiKey) {
    return null;
  }

  const response = await axios.post(
    NVIDIA_CHAT_URL,
    {
      model: MODEL_ID,
      messages: [
        { role: 'system', content: PERSONA },
        ...messages
      ],
      max_tokens: 512,
      temperature: 1,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      stream: false
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 30000
    }
  );

  const aiText = response.data?.choices?.[0]?.message?.content;
  if (!aiText) {
    throw new Error('Empty content in NVIDIA response.');
  }

  const trimmedText = aiText.trimStart();
  return trimmedText.startsWith(AI_RESPONSE_PREFIX)
    ? aiText
    : `${AI_RESPONSE_PREFIX} ${trimmedText}`;
}



async function maybeBuildImagePrompt(msg, userText = '') {
  const imageMessage = msg?.message?.imageMessage;
  if (!imageMessage) return null;

  const mediaBuffer = await downloadMediaMessage(
    msg,
    'buffer',
    {},
    { logger: console, reuploadRequest: null }
  );

  const imageB64 = Buffer.from(mediaBuffer).toString('base64');
  if (imageB64.length > 180_000) {
    throw new Error('Image is too large for inline upload. Please send a smaller image.');
  }

  const mimetype = imageMessage.mimetype || 'image/jpeg';
  const instruction = userText?.trim() || 'Describe this image briefly.';
  return `${instruction} <img src="data:${mimetype};base64,${imageB64}" />`;
}

async function handleJailbreakChatbot(sock, msg, body) {
  const from = msg.key?.remoteJid;
  if (!from || from.endsWith('@g.us')) return false;

  const sender = msg.key.participant || from;
  const phoneNumber = getPhoneNumber(sender);
  if (isAntisocialNumber(phoneNumber)) return false;
  const displayName = getDisplayName(msg, phoneNumber);
  const title = `JAILBREAK'S CHAT WITH ${displayName}`;

  const history = getHistory(phoneNumber);
  const imagePrompt = await maybeBuildImagePrompt(msg, body);
  const userContent = imagePrompt || body;
  if (!userContent) return false;

  const promptMessages = [...history, { role: 'user', content: userContent }];

  const aiText = await getAIResponse(promptMessages);
  if (!aiText) return false;
  const updated = [...history, { role: 'user', content: userContent }, { role: 'assistant', content: aiText }];
  saveHistory(phoneNumber, title, updated);

  await sock.sendMessage(from, { text: aiText }, { quoted: msg });
  return true;
}

module.exports = {
  handleJailbreakChatbot
};
