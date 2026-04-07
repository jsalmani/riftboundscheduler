const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'scheduler.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    week_year TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,
    time_slot TEXT NOT NULL,
    is_available INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, week_year, day_of_week, time_slot)
  );

  CREATE INDEX IF NOT EXISTS idx_availability_user_week
    ON availability(user_id, week_year);
`);

// --- Helper: get current ISO week string like "2025-W22" ---
function getCurrentWeekYear() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  // Set to nearest Thursday (ISO week date algorithm)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// --- User queries ---
const createUser = db.prepare(
  'INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)'
);

const getUserByUsername = db.prepare(
  'SELECT * FROM users WHERE username = ?'
);

const getUserById = db.prepare(
  'SELECT id, username, display_name, created_at FROM users WHERE id = ?'
);

const searchUsers = db.prepare(
  'SELECT id, username, display_name FROM users WHERE username LIKE ? AND id != ? LIMIT 10'
);

const getAllUsers = db.prepare(
  'SELECT id, username, display_name, created_at FROM users ORDER BY username'
);

// --- Availability queries ---
const upsertAvailability = db.prepare(`
  INSERT INTO availability (user_id, week_year, day_of_week, time_slot, is_available)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id, week_year, day_of_week, time_slot)
  DO UPDATE SET is_available = excluded.is_available
`);

const getAvailability = db.prepare(
  'SELECT day_of_week, time_slot, is_available FROM availability WHERE user_id = ? AND week_year = ? AND is_available = 1'
);

const getUserAvailabilityCount = db.prepare(
  'SELECT COUNT(*) as count FROM availability WHERE user_id = ? AND week_year = ? AND is_available = 1'
);

// Bulk save availability (for efficiency)
const bulkSaveAvailability = db.transaction((userId, weekYear, slots) => {
  for (const slot of slots) {
    upsertAvailability.run(userId, weekYear, slot.day, slot.timeSlot, slot.isAvailable ? 1 : 0);
  }
});

module.exports = {
  db,
  getCurrentWeekYear,
  createUser,
  getUserByUsername,
  getUserById,
  searchUsers,
  getAllUsers,
  upsertAvailability,
  getAvailability,
  getUserAvailabilityCount,
  bulkSaveAvailability
};
