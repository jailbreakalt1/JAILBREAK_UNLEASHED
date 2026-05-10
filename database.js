/**
 * Simple JSON-based Database for Group Settings
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const DB_PATH = path.join(__dirname, 'database');
const GROUPS_DB = path.join(DB_PATH, 'groups.json');
const USERS_DB = path.join(DB_PATH, 'users.json');
const WARNINGS_DB = path.join(DB_PATH, 'warnings.json');
const MODS_DB = path.join(DB_PATH, 'mods.json');
const SUDO_ALLOW_DB = path.join(DB_PATH, 'sudoAllow.json');
const ANTISOCIAL_DB = path.join(DB_PATH, 'antisocial.json');

// Initialize database directory
if (!fs.existsSync(DB_PATH)) {
  fs.mkdirSync(DB_PATH, { recursive: true });
}

// Initialize database files
const initDB = (filePath, defaultData = {}) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
  }
};

initDB(GROUPS_DB, {});
initDB(USERS_DB, {});
initDB(WARNINGS_DB, {});
initDB(MODS_DB, { moderators: [] });
initDB(SUDO_ALLOW_DB, { groups: {} });
initDB(ANTISOCIAL_DB, { numbers: [] });

// Read database
const readDB = (filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading database: ${error.message}`);
    return {};
  }
};

// Write database
const writeDB = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing database: ${error.message}`);
    return false;
  }
};

// Group Settings
const getGroupSettings = (groupId) => {
  const groups = readDB(GROUPS_DB);
  if (!groups[groupId]) {
    groups[groupId] = { ...config.defaultGroupSettings };
    writeDB(GROUPS_DB, groups);
  }
  return groups[groupId];
};

const updateGroupSettings = (groupId, settings) => {
  const groups = readDB(GROUPS_DB);
  groups[groupId] = { ...groups[groupId], ...settings };
  return writeDB(GROUPS_DB, groups);
};

// User Data
const getUser = (userId) => {
  const users = readDB(USERS_DB);
  if (!users[userId]) {
    users[userId] = {
      registered: Date.now(),
      premium: false,
      banned: false
    };
    writeDB(USERS_DB, users);
  }
  return users[userId];
};

const updateUser = (userId, data) => {
  const users = readDB(USERS_DB);
  users[userId] = { ...users[userId], ...data };
  return writeDB(USERS_DB, users);
};

// Warnings System
const getWarnings = (groupId, userId) => {
  const warnings = readDB(WARNINGS_DB);
  const key = `${groupId}_${userId}`;
  return warnings[key] || { count: 0, warnings: [] };
};

const addWarning = (groupId, userId, reason) => {
  const warnings = readDB(WARNINGS_DB);
  const key = `${groupId}_${userId}`;
  
  if (!warnings[key]) {
    warnings[key] = { count: 0, warnings: [] };
  }
  
  warnings[key].count++;
  warnings[key].warnings.push({
    reason,
    date: Date.now()
  });
  
  writeDB(WARNINGS_DB, warnings);
  return warnings[key];
};

const removeWarning = (groupId, userId) => {
  const warnings = readDB(WARNINGS_DB);
  const key = `${groupId}_${userId}`;
  
  if (warnings[key] && warnings[key].count > 0) {
    warnings[key].count--;
    warnings[key].warnings.pop();
    writeDB(WARNINGS_DB, warnings);
    return true;
  }
  return false;
};

const clearWarnings = (groupId, userId) => {
  const warnings = readDB(WARNINGS_DB);
  const key = `${groupId}_${userId}`;
  delete warnings[key];
  return writeDB(WARNINGS_DB, warnings);
};

// Moderators System
const getModerators = () => {
  const mods = readDB(MODS_DB);
  return mods.moderators || [];
};

const addModerator = (userId) => {
  const mods = readDB(MODS_DB);
  if (!mods.moderators) mods.moderators = [];
  if (!mods.moderators.includes(userId)) {
    mods.moderators.push(userId);
    return writeDB(MODS_DB, mods);
  }
  return false;
};

const removeModerator = (userId) => {
  const mods = readDB(MODS_DB);
  if (mods.moderators) {
    mods.moderators = mods.moderators.filter(id => id !== userId);
    return writeDB(MODS_DB, mods);
  }
  return false;
};

const isModerator = (userId) => {
  const mods = getModerators();
  return mods.includes(userId);
};

// Sudo allow system
const getSudoAllowData = () => {
  const data = readDB(SUDO_ALLOW_DB);
  if (!data.groups || typeof data.groups !== 'object') {
    data.groups = {};
    writeDB(SUDO_ALLOW_DB, data);
  }
  return data;
};

const getAllowedCommandsForGroup = (groupId) => {
  const data = getSudoAllowData();
  return data.groups[groupId] || [];
};

const isGroupAllowedForCommand = (groupId, commandName) => {
  const allowed = getAllowedCommandsForGroup(groupId);
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.includes('*') || allowed.includes(commandName);
};

const addGroupCommandAllow = (groupId, commandName) => {
  const data = getSudoAllowData();
  if (!Array.isArray(data.groups[groupId])) {
    data.groups[groupId] = [];
  }

  if (!data.groups[groupId].includes(commandName)) {
    data.groups[groupId].push(commandName);
  }
  return writeDB(SUDO_ALLOW_DB, data);
};

// Antisocial chatbot blocklist system
const normalizeAntisocialNumber = (number = '') => String(number).replace(/\D/g, '');

const normalizeAntisocialEntries = (entries = []) => {
  if (!Array.isArray(entries)) return [];

  return [...new Set(
    entries
      .map((entry) => normalizeAntisocialNumber(entry))
      .filter(Boolean)
  )].sort();
};

const getAntisocialData = () => {
  const rawData = readDB(ANTISOCIAL_DB);
  const data = Array.isArray(rawData)
    ? { numbers: rawData }
    : (rawData && typeof rawData === 'object' ? rawData : { numbers: [] });
  const normalizedNumbers = normalizeAntisocialEntries(data.numbers);

  if (!Array.isArray(data.numbers) || JSON.stringify(data.numbers) !== JSON.stringify(normalizedNumbers)) {
    data.numbers = normalizedNumbers;
    writeDB(ANTISOCIAL_DB, data);
  }

  return data;
};

const getAntisocialNumbers = () => getAntisocialData().numbers;

const isAntisocialNumber = (number) => {
  const normalized = normalizeAntisocialNumber(number);
  if (!normalized) return false;
  return getAntisocialNumbers().includes(normalized);
};

const addAntisocialNumber = (number) => {
  const normalized = normalizeAntisocialNumber(number);
  if (!normalized) return false;

  const data = getAntisocialData();
  if (data.numbers.includes(normalized)) return false;

  data.numbers.push(normalized);
  data.numbers.sort();
  writeDB(ANTISOCIAL_DB, data);
  return true;
};

const removeAntisocialNumber = (number) => {
  const normalized = normalizeAntisocialNumber(number);
  if (!normalized) return false;

  const data = getAntisocialData();
  if (!data.numbers.includes(normalized)) return false;

  data.numbers = data.numbers.filter((entry) => entry !== normalized);
  writeDB(ANTISOCIAL_DB, data);
  return true;
};

const removeGroupCommandAllow = (groupId, commandName) => {
  const data = getSudoAllowData();
  if (!Array.isArray(data.groups[groupId])) return false;

  data.groups[groupId] = data.groups[groupId].filter((cmd) => cmd !== commandName);
  if (data.groups[groupId].length === 0) {
    delete data.groups[groupId];
  }

  return writeDB(SUDO_ALLOW_DB, data);
};

module.exports = {
  getGroupSettings,
  updateGroupSettings,
  getUser,
  updateUser,
  getWarnings,
  addWarning,
  removeWarning,
  clearWarnings,
  getModerators,
  addModerator,
  removeModerator,
  isModerator,
  getAllowedCommandsForGroup,
  isGroupAllowedForCommand,
  addGroupCommandAllow,
  removeGroupCommandAllow,
  normalizeAntisocialNumber,
  getAntisocialNumbers,
  isAntisocialNumber,
  addAntisocialNumber,
  removeAntisocialNumber
};
