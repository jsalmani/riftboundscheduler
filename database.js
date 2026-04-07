const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');

const dbPath = path.join(__dirname, 'scheduler.db');

let db = null;

// Initialize the database (must be called before using any queries)
async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing DB file if it exists
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      week_year TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      time_slot TEXT NOT NULL,
      is_available INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, week_year, day_of_week, time_slot)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_availability_user_week
      ON availability(user_id, week_year)
  `);

  // Add columns if upgrading from old schema
  try { db.run("ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/New_York'"); } catch {}
  try { db.run("ALTER TABLE users ADD COLUMN discord_handle TEXT DEFAULT ''"); } catch {}
  try { db.run("ALTER TABLE users ADD COLUMN tcg_arena_code TEXT DEFAULT ''"); } catch {}

  saveToFile();
  return db;
}

// Persist database to disk
function saveToFile() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Close the database
function closeDatabase() {
  if (db) {
    saveToFile();
    db.close();
    db = null;
  }
}

// --- Helper wrappers to match better-sqlite3 API patterns ---

// Run a query that returns rows (SELECT)
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Run a query that returns a single row
function queryGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

// Run a statement (INSERT/UPDATE/DELETE) and return info
function runStmt(sql, params = []) {
  db.run(sql, params);
  // Get last insert rowid — sql.js doesn't return it from run(), query it
  const lastId = queryGet('SELECT last_insert_rowid() as id');
  const changes = queryGet('SELECT changes() as count');
  return {
    lastInsertRowid: lastId ? lastId.id : 0,
    changes: changes ? changes.count : 0
  };
}

// --- Supported IANA timezones ---
const SUPPORTED_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Adak',
  'America/Phoenix',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Australia/Melbourne',
];

// --- Helper: get current ISO week string like "2025-W22" ---
function getCurrentWeekYear() {
  const now = DateTime.now().setZone('UTC');
  return `${now.weekYear}-W${String(now.weekNumber).padStart(2, '0')}`;
}

function getCurrentWeekYearForTimezone(timezone) {
  const now = DateTime.now().setZone(timezone);
  return `${now.weekYear}-W${String(now.weekNumber).padStart(2, '0')}`;
}

function getUtcWeeksForLocalWeek(localWeekYear, timezone) {
  const monday = getWeekMonday(localWeekYear);
  const localWeekStart = monday.set({ hour: 0, minute: 0 }).setZone(timezone, { keepLocalTime: true }).toUTC();
  const localWeekEnd = monday.plus({ days: 6 }).set({ hour: 23, minute: 30 }).setZone(timezone, { keepLocalTime: true }).toUTC();

  const startWeek = `${localWeekStart.weekYear}-W${String(localWeekStart.weekNumber).padStart(2, '0')}`;
  const endWeek = `${localWeekEnd.weekYear}-W${String(localWeekEnd.weekNumber).padStart(2, '0')}`;

  const weeks = [startWeek];
  if (endWeek !== startWeek) weeks.push(endWeek);
  return weeks;
}

// --- Timezone conversion helpers ---

function getWeekMonday(weekYear) {
  const dt = DateTime.fromISO(`${weekYear}-1`, { zone: 'UTC' });
  return dt;
}

function localToUtc(weekYear, day, timeSlot, timezone) {
  const monday = getWeekMonday(weekYear);
  const [hour, minute] = timeSlot.split(':').map(Number);

  const localDt = monday.plus({ days: day }).set({ hour, minute, second: 0, millisecond: 0 }).setZone(timezone, { keepLocalTime: true });
  const utcDt = localDt.toUTC();

  const utcDay = utcDt.weekday - 1;
  const utcTimeSlot = `${String(utcDt.hour).padStart(2, '0')}:${String(utcDt.minute).padStart(2, '0')}`;
  const utcWeekYear = `${utcDt.weekYear}-W${String(utcDt.weekNumber).padStart(2, '0')}`;

  return { day: utcDay, timeSlot: utcTimeSlot, weekYear: utcWeekYear };
}

function utcToLocal(weekYear, day, timeSlot, timezone) {
  const monday = getWeekMonday(weekYear);
  const [hour, minute] = timeSlot.split(':').map(Number);

  const utcDt = monday.plus({ days: day }).set({ hour, minute, second: 0, millisecond: 0 });
  const localDt = utcDt.setZone(timezone);

  const localDay = localDt.weekday - 1;
  const localTimeSlot = `${String(localDt.hour).padStart(2, '0')}:${String(localDt.minute).padStart(2, '0')}`;
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return {
    day: localDay,
    timeSlot: localTimeSlot,
    dayName: dayNames[localDay],
    tzAbbrev: localDt.toFormat('ZZZZ'),
    isoString: localDt.toISO()
  };
}

// --- Query functions (replacing prepared statements) ---

const createUser = {
  run: (username, displayName, passwordHash, timezone, discordHandle, tcgArenaCode) => {
    const result = runStmt(
      'INSERT INTO users (username, display_name, password_hash, timezone, discord_handle, tcg_arena_code) VALUES (?, ?, ?, ?, ?, ?)',
      [username, displayName, passwordHash, timezone, discordHandle || '', tcgArenaCode || '']
    );
    saveToFile();
    return result;
  }
};

const getUserByUsername = {
  get: (username) => queryGet('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username])
};

const getUserById = {
  get: (id) => queryGet('SELECT id, username, display_name, timezone, discord_handle, tcg_arena_code, created_at FROM users WHERE id = ?', [id])
};

const searchUsers = {
  all: (pattern, excludeId) => queryAll('SELECT id, username, display_name FROM users WHERE username LIKE ? AND id != ? LIMIT 10', [pattern, excludeId])
};

const getAllUsers = {
  all: () => queryAll('SELECT id, username, display_name, timezone, discord_handle, tcg_arena_code, created_at FROM users ORDER BY username')
};

function updateProfile(userId, displayName, discordHandle, tcgArenaCode) {
  runStmt(
    'UPDATE users SET display_name = ?, discord_handle = ?, tcg_arena_code = ? WHERE id = ?',
    [displayName, discordHandle || '', tcgArenaCode || '', userId]
  );
  saveToFile();
}

const upsertAvailability = {
  run: (userId, weekYear, dayOfWeek, timeSlot, isAvailable) => {
    const result = runStmt(
      `INSERT INTO availability (user_id, week_year, day_of_week, time_slot, is_available)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, week_year, day_of_week, time_slot)
       DO UPDATE SET is_available = excluded.is_available`,
      [userId, weekYear, dayOfWeek, timeSlot, isAvailable]
    );
    saveToFile();
    return result;
  }
};

const getAvailability = {
  all: (userId, weekYear) => queryAll(
    'SELECT week_year, day_of_week, time_slot, is_available FROM availability WHERE user_id = ? AND week_year = ? AND is_available = 1',
    [userId, weekYear]
  )
};

const getAvailabilityMultiWeek = {
  all: (userId, week1, week2) => queryAll(
    'SELECT week_year, day_of_week, time_slot, is_available FROM availability WHERE user_id = ? AND (week_year = ? OR week_year = ?) AND is_available = 1',
    [userId, week1, week2]
  )
};

const getUserAvailabilityCount = {
  get: (userId, weekYear) => queryGet(
    'SELECT COUNT(*) as count FROM availability WHERE user_id = ? AND week_year = ? AND is_available = 1',
    [userId, weekYear]
  )
};

function bulkSaveAvailability(userId, slots) {
  for (const slot of slots) {
    db.run(
      `INSERT INTO availability (user_id, week_year, day_of_week, time_slot, is_available)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, week_year, day_of_week, time_slot)
       DO UPDATE SET is_available = excluded.is_available`,
      [userId, slot.weekYear, slot.day, slot.timeSlot, slot.isAvailable ? 1 : 0]
    );
  }
  saveToFile();
}

// Get availability across potentially two UTC weeks, convert to local, and filter to valid grid range
function getAvailabilityLocal(userId, timezone) {
  const localWeekYear = getCurrentWeekYearForTimezone(timezone);
  const utcWeeks = getUtcWeeksForLocalWeek(localWeekYear, timezone);

  let utcSlots;
  if (utcWeeks.length === 1) {
    utcSlots = getAvailability.all(userId, utcWeeks[0]);
  } else {
    utcSlots = getAvailabilityMultiWeek.all(userId, utcWeeks[0], utcWeeks[1]);
  }

  // Convert each to local and filter to valid grid slots (day 0-6, hourly 06:00-23:00)
  const results = [];
  for (const s of utcSlots) {
    const local = utcToLocal(s.week_year, s.day_of_week, s.time_slot, timezone);
    if (local.day >= 0 && local.day <= 6) {
      const h = parseInt(local.timeSlot.split(':')[0]);
      const m = local.timeSlot.split(':')[1];
      if (h >= 6 && h <= 23 && m === '00') {
        results.push({ day_of_week: local.day, time_slot: local.timeSlot });
      }
    }
  }

  return { localWeekYear, slots: results };
}

function getUtcSlotsForUser(userId, timezone) {
  const localWeekYear = getCurrentWeekYearForTimezone(timezone);
  const utcWeeks = getUtcWeeksForLocalWeek(localWeekYear, timezone);

  if (utcWeeks.length === 1) {
    return getAvailability.all(userId, utcWeeks[0]);
  }
  return getAvailabilityMultiWeek.all(userId, utcWeeks[0], utcWeeks[1]);
}

module.exports = {
  initDatabase,
  closeDatabase,
  saveToFile,
  get db() { return db; },
  getCurrentWeekYear,
  getCurrentWeekYearForTimezone,
  getUtcWeeksForLocalWeek,
  getWeekMonday,
  localToUtc,
  utcToLocal,
  SUPPORTED_TIMEZONES,
  createUser,
  getUserByUsername,
  getUserById,
  searchUsers,
  getAllUsers,
  upsertAvailability,
  getAvailability,
  getAvailabilityMultiWeek,
  getAvailabilityLocal,
  getUtcSlotsForUser,
  getUserAvailabilityCount,
  bulkSaveAvailability,
  updateProfile
};
