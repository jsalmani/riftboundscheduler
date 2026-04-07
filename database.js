const Database = require('better-sqlite3');
const path = require('path');
const { DateTime } = require('luxon');

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
    timezone TEXT NOT NULL DEFAULT 'America/New_York',
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

// Add timezone column if upgrading from old schema
try {
  db.exec('ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT \'America/New_York\'');
} catch {
  // Column already exists
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

// Get the current ISO week as seen from a user's timezone
function getCurrentWeekYearForTimezone(timezone) {
  const now = DateTime.now().setZone(timezone);
  return `${now.weekYear}-W${String(now.weekNumber).padStart(2, '0')}`;
}

// Get the set of UTC ISO weeks that a user's local week might span
// (e.g., AEST Monday 00:00 = previous-Sunday in UTC = different week)
function getUtcWeeksForLocalWeek(localWeekYear, timezone) {
  const monday = getWeekMonday(localWeekYear);
  // Local Monday 00:00 in UTC
  const localWeekStart = monday.set({ hour: 0, minute: 0 }).setZone(timezone, { keepLocalTime: true }).toUTC();
  // Local Sunday 23:30 in UTC
  const localWeekEnd = monday.plus({ days: 6 }).set({ hour: 23, minute: 30 }).setZone(timezone, { keepLocalTime: true }).toUTC();

  const startWeek = `${localWeekStart.weekYear}-W${String(localWeekStart.weekNumber).padStart(2, '0')}`;
  const endWeek = `${localWeekEnd.weekYear}-W${String(localWeekEnd.weekNumber).padStart(2, '0')}`;

  const weeks = [startWeek];
  if (endWeek !== startWeek) weeks.push(endWeek);
  return weeks;
}

// --- Timezone conversion helpers ---

// Get the Monday of a given ISO week (e.g., "2026-W15") as a UTC date
function getWeekMonday(weekYear) {
  // Parse "YYYY-Www" → luxon ISO week date for Monday (day 1)
  const dt = DateTime.fromISO(`${weekYear}-1`, { zone: 'UTC' });
  return dt;
}

// Convert a local (day_of_week, time_slot) in user's timezone to UTC (day_of_week, time_slot)
// day_of_week: 0=Monday ... 6=Sunday, time_slot: "HH:mm"
// Returns { day: number, timeSlot: string, weekYear: string } in UTC
function localToUtc(weekYear, day, timeSlot, timezone) {
  const monday = getWeekMonday(weekYear);
  const [hour, minute] = timeSlot.split(':').map(Number);

  // Build the local datetime: Monday of that week + day offset, at the given time, in user's timezone
  const localDt = monday.plus({ days: day }).set({ hour, minute, second: 0, millisecond: 0 }).setZone(timezone, { keepLocalTime: true });
  const utcDt = localDt.toUTC();

  // Compute the UTC day_of_week relative to that ISO week's Monday
  // luxon weekday: 1=Monday ... 7=Sunday
  const utcWeekday = utcDt.weekday; // 1-7
  const utcDay = utcWeekday - 1; // 0-6
  const utcTimeSlot = `${String(utcDt.hour).padStart(2, '0')}:${String(utcDt.minute).padStart(2, '0')}`;
  const utcWeekYear = `${utcDt.weekYear}-W${String(utcDt.weekNumber).padStart(2, '0')}`;

  return { day: utcDay, timeSlot: utcTimeSlot, weekYear: utcWeekYear };
}

// Convert a UTC (day_of_week, time_slot) to local (day_of_week, time_slot) in user's timezone
// Returns { day: number, timeSlot: string, dayName: string }
function utcToLocal(weekYear, day, timeSlot, timezone) {
  const monday = getWeekMonday(weekYear);
  const [hour, minute] = timeSlot.split(':').map(Number);

  const utcDt = monday.plus({ days: day }).set({ hour, minute, second: 0, millisecond: 0 });
  const localDt = utcDt.setZone(timezone);

  const localDay = localDt.weekday - 1; // 0=Monday ... 6=Sunday
  const localTimeSlot = `${String(localDt.hour).padStart(2, '0')}:${String(localDt.minute).padStart(2, '0')}`;
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return {
    day: localDay,
    timeSlot: localTimeSlot,
    dayName: dayNames[localDay],
    // Include abbreviated timezone name for display
    tzAbbrev: localDt.toFormat('ZZZZ'),
    isoString: localDt.toISO()
  };
}

// --- User queries ---
const createUser = db.prepare(
  'INSERT INTO users (username, display_name, password_hash, timezone) VALUES (?, ?, ?, ?)'
);

const getUserByUsername = db.prepare(
  'SELECT * FROM users WHERE username = ?'
);

const getUserById = db.prepare(
  'SELECT id, username, display_name, timezone, created_at FROM users WHERE id = ?'
);

const searchUsers = db.prepare(
  'SELECT id, username, display_name FROM users WHERE username LIKE ? AND id != ? LIMIT 10'
);

const getAllUsers = db.prepare(
  'SELECT id, username, display_name, timezone, created_at FROM users ORDER BY username'
);

// --- Availability queries ---
const upsertAvailability = db.prepare(`
  INSERT INTO availability (user_id, week_year, day_of_week, time_slot, is_available)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id, week_year, day_of_week, time_slot)
  DO UPDATE SET is_available = excluded.is_available
`);

const getAvailability = db.prepare(
  'SELECT week_year, day_of_week, time_slot, is_available FROM availability WHERE user_id = ? AND week_year = ? AND is_available = 1'
);

const getAvailabilityMultiWeek = db.prepare(
  'SELECT week_year, day_of_week, time_slot, is_available FROM availability WHERE user_id = ? AND (week_year = ? OR week_year = ?) AND is_available = 1'
);

const getUserAvailabilityCount = db.prepare(
  'SELECT COUNT(*) as count FROM availability WHERE user_id = ? AND week_year = ? AND is_available = 1'
);

// Bulk save availability (for efficiency) — slots are already in UTC
const bulkSaveAvailability = db.transaction((userId, slots) => {
  for (const slot of slots) {
    upsertAvailability.run(userId, slot.weekYear, slot.day, slot.timeSlot, slot.isAvailable ? 1 : 0);
  }
});

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

// Get UTC availability across the UTC weeks that correspond to a user's local week
function getUtcSlotsForUser(userId, timezone) {
  const localWeekYear = getCurrentWeekYearForTimezone(timezone);
  const utcWeeks = getUtcWeeksForLocalWeek(localWeekYear, timezone);

  if (utcWeeks.length === 1) {
    return getAvailability.all(userId, utcWeeks[0]);
  }
  return getAvailabilityMultiWeek.all(userId, utcWeeks[0], utcWeeks[1]);
}

module.exports = {
  db,
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
  bulkSaveAvailability
};
