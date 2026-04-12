const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@vreden/meta');
const { getTempDir, deleteTempFile } = require('../../utils/tempManager');
const {
  DEFAULT_IMAGES_DIR,
  getAutonomousStatus,
  startAutonomousMode,
  stopAutonomousMode,
  setStaticImageRecord
} = require('../../utils/dpAutonomous');

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const getImageMessage = (msg) => {
  const directImage = msg.message?.imageMessage;
  if (directImage) return directImage;

  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (quoted?.imageMessage) return quoted.imageMessage;

  return null;
};

module.exports = {
  name: 'dp',
  aliases: ['setdp', 'botdp'],
  category: 'admin',
  description: 'Manage bot profile picture (static or autonomous)',
  usage: '.dp mode <static/autonomous/status> (with or without image based on mode)',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const option = (args[0] || '').toLowerCase();
    const subOption = (args[1] || '').toLowerCase();

    if (option === 'mode' && subOption === 'autonomous') {
      const statusBeforeStart = getAutonomousStatus();
      if (statusBeforeStart.imagesCount === 0) {
        return extra.reply(
          `❌ No images found for autonomous mode.\n` +
          `📁 Expected folder: ${DEFAULT_IMAGES_DIR}\n` +
          `Allowed formats: .jpg .jpeg .png .webp`
        );
      }

      await extra.react('⏳');
      startAutonomousMode(sock, { immediate: true });

      const status = getAutonomousStatus();
      const nextAt = status.nextRunAt ? new Date(status.nextRunAt).toLocaleString() : 'pending';

      await extra.reply(
        `🤖 *DP Autonomous Mode Enabled*\n\n` +
        `• Images folder: ${status.imagesDir}\n` +
        `• Total images: ${status.imagesCount}\n` +
        `• Used this cycle: ${status.usedImages.length}\n` +
        `• Next change: ${nextAt}\n` +
        `• Interval: random 20-30 minutes`
      );
      await extra.react('✅');
      return;
    }

    if (option === 'mode' && subOption === 'status') {
      const status = getAutonomousStatus();
      const nextAt = status.nextRunAt ? new Date(status.nextRunAt).toLocaleString() : 'not scheduled';

      return extra.reply(
        `🧾 *DP Mode Status*\n\n` +
        `• Mode: ${status.mode.toUpperCase()}\n` +
        `• Images folder: ${status.imagesDir}\n` +
        `• Images detected: ${status.imagesCount}\n` +
        `• Used in cycle: ${status.usedImages.length}\n` +
        `• Remaining this cycle: ${status.pendingImages}\n` +
        `• Current image: ${status.currentImage || 'n/a'}\n` +
        `• Next run: ${nextAt}`
      );
    }

    if (option === 'mode' && (subOption === 'static' || subOption === 'off')) {
      const imageMessage = getImageMessage(msg);

      if (!imageMessage) {
        stopAutonomousMode();
        return extra.reply('🛑 DP autonomous mode disabled. Static mode is active (no image changed).');
      }

      const tmpDir = getTempDir();
      const imagePath = path.join(tmpDir, `jbx-dp-${Date.now()}.jpg`);

      try {
        await extra.react('⏳');

        const stream = await downloadContentFromMessage(imageMessage, 'image');
        let buffer = Buffer.alloc(0);

        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }

        if (!buffer.length) {
          return extra.reply('⫎ Unable to read image payload. ❌');
        }

        if (buffer.length > MAX_FILE_SIZE) {
          return extra.reply(`❌ File too large: ${(buffer.length / 1024 / 1024).toFixed(2)}MB (max: ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
        }

        fs.writeFileSync(imagePath, buffer);

        const ownJid = `${(sock.user?.id || '').split(':')[0]}@s.whatsapp.net`;
        await sock.updateProfilePicture(ownJid, { url: imagePath });

        stopAutonomousMode();
        setStaticImageRecord('manual-static-image');

        await extra.reply('✅ Static DP set and autonomous mode stopped.');
        await extra.react('✅');
      } catch (error) {
        console.error('DP command error:', error);
        await extra.reply(`⫎ *System Error:* \`${error?.message || 'unknown error'}\``);
        await extra.react('❌');
      } finally {
        deleteTempFile(imagePath);
      }
      return;
    }

    const imageMessage = getImageMessage(msg);

    if (!imageMessage) {
      return extra.reply(
        `⫎ Usage:\n` +
        `• .dp mode static (send/reply image)\n` +
        `• .dp mode autonomous\n` +
        `• .dp mode status\n\n` +
        `Tip: .dp with image still works as static mode.`
      );
    }

    const tmpDir = getTempDir();
    const imagePath = path.join(tmpDir, `jbx-dp-${Date.now()}.jpg`);

    try {
      await extra.react('⏳');

      const stream = await downloadContentFromMessage(imageMessage, 'image');
      let buffer = Buffer.alloc(0);

      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }

      if (!buffer.length) {
        return extra.reply('⫎ Unable to read image payload. ❌');
      }

      if (buffer.length > MAX_FILE_SIZE) {
        return extra.reply(`❌ File too large: ${(buffer.length / 1024 / 1024).toFixed(2)}MB (max: ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
      }

      fs.writeFileSync(imagePath, buffer);

      const ownJid = `${(sock.user?.id || '').split(':')[0]}@s.whatsapp.net`;
      await sock.updateProfilePicture(ownJid, { url: imagePath });

      stopAutonomousMode();
      setStaticImageRecord('manual-static-image');

      await extra.reply('✅ Profile picture updated in static mode.');
      await extra.react('✅');
    } catch (error) {
      console.error('DP command error:', error);
      await extra.reply(`⫎ *System Error:* \`${error?.message || 'unknown error'}\``);
      await extra.react('❌');
    } finally {
      deleteTempFile(imagePath);
    }
  }
};
