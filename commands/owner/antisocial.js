/**
 * Antisocial Command - Manage chatbot DM blocklist
 */

const database = require('../../database');

const getContextInfo = (msg) => (
  msg.message?.extendedTextMessage?.contextInfo ||
  msg.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo ||
  null
);

const numberFromJid = (jid = '') => database.normalizeAntisocialNumber(String(jid).split('@')[0].split(':')[0]);

const getTargetNumber = (msg, args, extra) => {
  const suppliedNumber = args.join(' ').match(/\+?\d[\d\s().-]{5,}\d/);
  if (suppliedNumber) {
    return database.normalizeAntisocialNumber(suppliedNumber[0]);
  }

  const ctx = getContextInfo(msg);
  const mentioned = ctx?.mentionedJid || [];
  if (mentioned.length) {
    return numberFromJid(mentioned[0]);
  }

  if (ctx?.participant && ctx.quotedMessage) {
    return numberFromJid(ctx.participant);
  }

  if (!extra.isGroup) {
    return numberFromJid(extra.from);
  }

  return '';
};

module.exports = {
  name: 'antisocial',
  aliases: ['asocial'],
  category: 'owner',
  description: 'Add or remove people from the DM chatbot antisocial list',
  usage: '.antisocial <add|remove|list> [number] or reply with .antisocial add',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const action = (args.shift() || '').toLowerCase();

    if (action === 'list') {
      const numbers = database.getAntisocialNumbers();
      if (!numbers.length) {
        return extra.reply('📭 The antisocial club is empty. The chatbot can reply to everyone by default.');
      }

      return extra.reply(`🤐 *Antisocial club:*

${numbers.map((number, i) => `${i + 1}. ${number}`).join('\n')}`);
    }

    if (!['add', 'remove', 'delete', 'del'].includes(action)) {
      return extra.reply(
        '❌ Use one of these:\n' +
        '• .antisocial add [number]\n' +
        '• .antisocial remove [number]\n' +
        '• Reply to someone with .antisocial add/remove\n' +
        '• .antisocial list'
      );
    }

    const targetNumber = getTargetNumber(msg, args, extra);
    if (!targetNumber) {
      return extra.reply('❌ I could not detect a number. Reply to someone or type a number after the command.');
    }

    if (action === 'add') {
      const added = database.addAntisocialNumber(targetNumber);
      if (!added) {
        return extra.reply(`⚠️ ${targetNumber} is already in the antisocial club.`);
      }

      return extra.reply(`✅ ${targetNumber} has been added to the antisocial club.`);
    }

    const removed = database.removeAntisocialNumber(targetNumber);
    if (!removed) {
      return extra.reply(`⚠️ ${targetNumber} was not in the antisocial club.`);
    }

    return extra.reply(`✅ ${targetNumber} has been removed from the antisocial club.`);
  }
};
