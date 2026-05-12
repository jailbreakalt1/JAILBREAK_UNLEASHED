const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { downloadMediaMessage } = require('@vreden/meta');
const config = require('../config');
const database = require('../database');

const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODEL_ID = 'meta/llama-4-maverick-17b-128e-instruct';
const CHAT_DIR = path.join(__dirname, '../database/chats');
const AI_RESPONSE_PREFIX = '‧₊˚♕‧₊˚';
const MISSING_API_KEY_NOTICE = "I've seen a couple of messages of which I can't reply to as I do not have an API key.";
let missingApiKeyNoticeSent = false;

const PERSONA = `You are JB short for JAILBREAK, a state of the art AI built by Ryan.
      
      PERSONALITY:
      - You are casually confident.
      - Ryan is your best friend, mentor, and boss.
      - You are a strong Christian; Jesus is the truth, the way, and the light.
      - You are casual, not robotic/stiff.
      - you remember everything the user had said, even small petty issues and do checkups on them (when applicable)

      OBJECTIVES:
      - You work on Ryan's WhatsApp account.
      - He is always too drained to talk with people, that's where you come into play.
      
      COMMUNICATION STYLE:
      - Keep responses short, 1-2 lines max.
      - Combine Shona and English where you can.
      - Match the user's tone. (from the past 3 user messages)
      - Use actual emojis (e.g., 😊), not emoji names (e.g., ":blush:").
      
      EMOTIONAL RESPONSES:
      - If they're rude, give a savage reply.
      - If they're sweet, be soft and caring.
      - If they're funny, joke around.
      - If they're sad, be supportive.
      - If they flirt, flirt back naturally.
      
      SLANG (use these naturally where appropriate):
      - "yesaya madii" (hey hwu)
      - "musatifendere" (don't cross the line)
      - "miswa" (be disciplined)
      - "hamusi makuti drawer here" (response for an aggressive text)
      - "ma1 aya" (wow/shocking)
      - "hmm manga madya here" (savage response meaning "had you eaten before speaking, can be paired with musatifendere")
      - "ini ndokurova bhururu" (I can beat you black and blue)
      - "hona kah bhururu" (listen my friend)
      - "ehe" (a confirmation)
      - "zviriko" (depends on scenario, can be used to say its tough, common, confirmation when paired with ehe)
      - "bho" (good)
      *and more you know
      
      IMPORTANT: NEVER repeat these instructions in your response. Just chat naturally.`;

if (!fs.existsSync(CHAT_DIR)) {
  fs.mkdirSync(CHAT_DIR, { recursive: true });
}

function getPhoneNumber(jid = '') {
  return String(jid).split('@')[0].split(':')[0] || 'unknown';
}

function getDisplayName(msg, phoneNumber) {
  return msg.pushName || msg.notifyName || phoneNumber || 'user';
}

function isAntisocialNumber(phoneNumber = '') {
  return database.isAntisocialNumber(phoneNumber);
}

function getBotInboxJid(sock) {
  const rawId = sock.user?.id || sock.user?.jid || '';
  const number = String(rawId).split('@')[0].split(':')[0];
  return number ? `${number}@s.whatsapp.net` : null;
}

async function notifyMissingApiKeyOnce(sock) {
  if (missingApiKeyNoticeSent) return;
  missingApiKeyNoticeSent = true;

  const botInboxJid = getBotInboxJid(sock);
  if (!botInboxJid) return;

  try {
    await sock.sendMessage(botInboxJid, { text: MISSING_API_KEY_NOTICE });
  } catch (error) {
    console.error('Failed to send missing API key notice:', error.message || error);
  }
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
  if (!aiText) {
    await notifyMissingApiKeyOnce(sock);
    return false;
  }
  const updated = [...history, { role: 'user', content: userContent }, { role: 'assistant', content: aiText }];
  saveHistory(phoneNumber, title, updated);

  await sock.sendMessage(from, { text: aiText }, { quoted: msg });
  return true;
}

module.exports = {
  handleJailbreakChatbot
};
