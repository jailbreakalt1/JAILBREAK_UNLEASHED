const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../database/dpAutonomous.json');
const DEFAULT_IMAGES_DIR = path.join(__dirname, '../images');
const MIN_INTERVAL_MS = 20 * 60 * 1000;
const MAX_INTERVAL_MS = 30 * 60 * 1000;
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

let rotationTimer = null;
let activeSock = null;
let isRunning = false;

function ensureDatabaseFile() {
  const databaseDir = path.dirname(DB_PATH);
  if (!fs.existsSync(databaseDir)) {
    fs.mkdirSync(databaseDir, { recursive: true });
  }

  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultState(), null, 2), 'utf8');
  }
}

function defaultState() {
  return {
    mode: 'static',
    imagesDir: DEFAULT_IMAGES_DIR,
    usedImages: [],
    logs: [],
    currentImage: null,
    nextRunAt: null,
    lastUpdatedAt: null
  };
}

function loadState() {
  try {
    ensureDatabaseFile();
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...defaultState(),
      ...parsed,
      usedImages: Array.isArray(parsed.usedImages) ? parsed.usedImages : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : []
    };
  } catch (error) {
    console.error('[dp-autonomous] Failed to load state:', error?.message || error);
    return defaultState();
  }
}

function saveState(state) {
  ensureDatabaseFile();
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function getRandomIntervalMs() {
  return Math.floor(Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS + 1)) + MIN_INTERVAL_MS;
}

function getImageCandidates(imagesDir) {
  if (!fs.existsSync(imagesDir)) {
    return [];
  }

  return fs
    .readdirSync(imagesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => ALLOWED_EXTENSIONS.has(path.extname(fileName).toLowerCase()))
    .sort();
}

function pickRandomImage(images, usedImages) {
  const usedSet = new Set(usedImages);
  let available = images.filter((name) => !usedSet.has(name));

  if (available.length === 0) {
    available = [...images];
    usedImages.length = 0;
  }

  const randomIndex = Math.floor(Math.random() * available.length);
  return available[randomIndex];
}

function scheduleNextRotation(sock, state) {
  if (rotationTimer) {
    clearTimeout(rotationTimer);
    rotationTimer = null;
  }

  const delay = getRandomIntervalMs();
  state.nextRunAt = Date.now() + delay;
  saveState(state);

  rotationTimer = setTimeout(async () => {
    await runRotation(sock);
  }, delay);
}

async function runRotation(sock) {
  if (isRunning) {
    return;
  }

  const state = loadState();
  if (state.mode !== 'autonomous') {
    return;
  }

  const images = getImageCandidates(state.imagesDir || DEFAULT_IMAGES_DIR);
  if (images.length === 0) {
    console.warn(`[dp-autonomous] No image files found in: ${state.imagesDir || DEFAULT_IMAGES_DIR}`);
    scheduleNextRotation(sock, state);
    return;
  }

  isRunning = true;

  try {
    const nextImage = pickRandomImage(images, state.usedImages);
    const imagePath = path.join(state.imagesDir || DEFAULT_IMAGES_DIR, nextImage);
    const ownJid = `${(sock.user?.id || '').split(':')[0]}@s.whatsapp.net`;

    await sock.updateProfilePicture(ownJid, { url: imagePath });

    state.usedImages.push(nextImage);
    state.currentImage = nextImage;
    state.lastUpdatedAt = new Date().toISOString();
    state.logs.unshift({
      image: nextImage,
      at: state.lastUpdatedAt
    });

    if (state.logs.length > 100) {
      state.logs = state.logs.slice(0, 100);
    }

    saveState(state);
    console.log(`[dp-autonomous] Updated profile picture with: ${nextImage}`);
  } catch (error) {
    console.error('[dp-autonomous] Failed to rotate profile picture:', error?.message || error);
  } finally {
    isRunning = false;

    const refreshedState = loadState();
    if (refreshedState.mode === 'autonomous') {
      scheduleNextRotation(sock, refreshedState);
    }
  }
}

function startAutonomousMode(sock, options = {}) {
  activeSock = sock;

  const state = loadState();
  state.mode = 'autonomous';
  if (!state.imagesDir) {
    state.imagesDir = DEFAULT_IMAGES_DIR;
  }
  saveState(state);

  if (options.immediate) {
    runRotation(sock);
    return;
  }

  scheduleNextRotation(sock, state);
}

function stopAutonomousMode() {
  if (rotationTimer) {
    clearTimeout(rotationTimer);
    rotationTimer = null;
  }

  const state = loadState();
  state.mode = 'static';
  state.nextRunAt = null;
  saveState(state);
}

function setStaticImageRecord(imageLabel = null) {
  const state = loadState();
  state.mode = 'static';
  state.currentImage = imageLabel;
  state.lastUpdatedAt = new Date().toISOString();
  state.nextRunAt = null;
  saveState(state);
}

function initializeDpAutonomous(sock) {
  activeSock = sock;

  const state = loadState();
  if (state.mode !== 'autonomous') {
    return;
  }

  if (state.nextRunAt && state.nextRunAt > Date.now()) {
    const delay = state.nextRunAt - Date.now();
    if (rotationTimer) {
      clearTimeout(rotationTimer);
    }
    rotationTimer = setTimeout(async () => {
      await runRotation(sock);
    }, delay);
    return;
  }

  scheduleNextRotation(sock, state);
}

function getAutonomousStatus() {
  const state = loadState();
  const images = getImageCandidates(state.imagesDir || DEFAULT_IMAGES_DIR);

  return {
    ...state,
    imagesCount: images.length,
    pendingImages: Math.max(images.length - state.usedImages.length, 0),
    isTimerActive: Boolean(rotationTimer && activeSock)
  };
}

module.exports = {
  DEFAULT_IMAGES_DIR,
  getAutonomousStatus,
  initializeDpAutonomous,
  startAutonomousMode,
  stopAutonomousMode,
  setStaticImageRecord
};
