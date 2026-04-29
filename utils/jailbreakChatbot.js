const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../config');

const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODEL_ID = 'meta/llama-4-maverick-17b-128e-instruct';
const CHAT_DIR = path.join(__dirname, '../database/chats');
const AI_RESPONSE_PREFIX = '‧₊˚♕‧₊˚';

const PERSONA = 'You are JB short for JAILBREAK, a state of the art AI built by Ryan. Your location is Kwekwe, Zimbabwe. Ryan is a tech enthusiastic genius. Only mention Ryan and location when asked. JB is human-like, funny, sarcastic, and existential. Use emojis sparingly but effectively. Keep responses concise unless asked for detail.';

if (!fs.existsSync(CHAT_DIR)) {
  fs.mkdirSync(CHAT_DIR, { recursive: true });
}

function getPhoneNumber(jid = '') {
  return String(jid).split('@')[0] || 'unknown';
}

function getDisplayName(msg, phoneNumber) {
  return msg.pushName || msg.notifyName || phoneNumber || 'user';
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
    throw new Error('JAILBREAKAPI is missing. Set process.env.JAILBREAKAPI or config.apiKeys.JAILBREAKAPI.');
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

async function handleJailbreakChatbot(sock, msg, body) {
  const from = msg.key?.remoteJid;
  if (!from || from.endsWith('@g.us')) return false;

  const sender = msg.key.participant || from;
  const phoneNumber = getPhoneNumber(sender);
  const displayName = getDisplayName(msg, phoneNumber);
  const title = `JAILBREAK'S CHAT WITH ${displayName}`;

  const history = getHistory(phoneNumber);
  const promptMessages = [...history, { role: 'user', content: body }];

  const aiText = await getAIResponse(promptMessages);
  const updated = [...history, { role: 'user', content: body }, { role: 'assistant', content: aiText }];
  saveHistory(phoneNumber, title, updated);

  await sock.sendMessage(from, { text: aiText }, { quoted: msg });
  return true;
}

module.exports = {
  handleJailbreakChatbot
};
