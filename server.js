const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const ics = require('ics');
const { DateTime } = require('luxon');
const {
  db,
  getCurrentWeekYear,
  getCurrentWeekYearForTimezone,
  localToUtc,
  utcToLocal,
  SUPPORTED_TIMEZONES,
  createUser,
  getUserByUsername,
  getUserById,
  searchUsers,
  getAllUsers,
  upsertAvailability,
  getAvailabilityLocal,
  getUtcSlotsForUser,
  getUserAvailabilityCount,
  bulkSaveAvailability
} = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'riftbound-scheduler-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// ========== AUTH ROUTES ==========

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, displayName, password, timezone } = req.body;

    if (!username || !displayName || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'Username must be 3-30 characters' });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (displayName.length < 1 || displayName.length > 50) {
      return res.status(400).json({ error: 'Display name must be 1-50 characters' });
    }

    const tz = timezone || 'America/New_York';
    if (!SUPPORTED_TIMEZONES.includes(tz)) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }

    const existing = getUserByUsername.get(username);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = createUser.run(username.toLowerCase(), displayName, passwordHash, tz);

    req.session.userId = result.lastInsertRowid;
    res.json({
      success: true,
      user: { id: result.lastInsertRowid, username: username.toLowerCase(), displayName, timezone: tz }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = getUserByUsername.get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    req.session.userId = user.id;
    res.json({
      success: true,
      user: { id: user.id, username: user.username, displayName: user.display_name, timezone: user.timezone }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const user = getUserById.get(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  res.json({
    user: { id: user.id, username: user.username, displayName: user.display_name, timezone: user.timezone }
  });
});

// ========== TIMEZONE LIST ==========

app.get('/api/timezones', (req, res) => {
  res.json({ timezones: SUPPORTED_TIMEZONES });
});

// ========== AVAILABILITY ROUTES ==========

// Get own availability — returned in user's local timezone
app.get('/api/availability/me', requireAuth, (req, res) => {
  const user = getUserById.get(req.session.userId);
  const { localWeekYear, slots } = getAvailabilityLocal(req.session.userId, user.timezone);

  res.json({ weekYear: localWeekYear, timezone: user.timezone, slots });
});

// Save availability — client sends local times, server converts to UTC
app.post('/api/availability/save', requireAuth, (req, res) => {
  try {
    const user = getUserById.get(req.session.userId);
    const localWeekYear = getCurrentWeekYearForTimezone(user.timezone);

    if (Array.isArray(req.body.slots)) {
      const utcSlots = req.body.slots.map(slot => {
        const utc = localToUtc(localWeekYear, slot.day, slot.timeSlot, user.timezone);
        return { weekYear: utc.weekYear, day: utc.day, timeSlot: utc.timeSlot, isAvailable: slot.isAvailable };
      });
      bulkSaveAvailability(req.session.userId, utcSlots);
    } else {
      const { day, timeSlot, isAvailable } = req.body;
      if (day === undefined || !timeSlot || isAvailable === undefined) {
        return res.status(400).json({ error: 'day, timeSlot, and isAvailable are required' });
      }
      const utc = localToUtc(localWeekYear, day, timeSlot, user.timezone);
      upsertAvailability.run(req.session.userId, utc.weekYear, utc.day, utc.timeSlot, isAvailable ? 1 : 0);
    }

    res.json({ success: true, weekYear: localWeekYear });
  } catch (err) {
    console.error('Save availability error:', err);
    res.status(500).json({ error: 'Failed to save availability' });
  }
});

// Get another user's availability — returned in THEIR local timezone
app.get('/api/availability/:username', requireAuth, (req, res) => {
  const user = getUserByUsername.get(req.params.username);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  const { localWeekYear, slots } = getAvailabilityLocal(user.id, user.timezone);

  res.json({
    weekYear: localWeekYear,
    user: { username: user.username, displayName: user.display_name, timezone: user.timezone },
    slots
  });
});

// ========== USER SEARCH ==========

app.get('/api/users/search', requireAuth, (req, res) => {
  const q = req.query.q || '';
  if (q.length < 1) {
    return res.json({ users: [] });
  }
  const users = searchUsers.all(`%${q}%`, req.session.userId);
  res.json({ users });
});

// ========== OVERLAP ==========

app.get('/api/overlap/:username', requireAuth, (req, res) => {
  const me = getUserById.get(req.session.userId);
  const otherUser = getUserByUsername.get(req.params.username);
  if (!otherUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Get all UTC slots for both users (spanning their respective local weeks)
  const myUtcSlots = getUtcSlotsForUser(req.session.userId, me.timezone);
  const theirUtcSlots = getUtcSlotsForUser(otherUser.id, otherUser.timezone);

  // Build set of other user's UTC slots for overlap detection (keyed by week+day+time)
  const theirUtcSet = new Set(
    theirUtcSlots.map(s => `${s.week_year}-${s.day_of_week}-${s.time_slot}`)
  );

  // Find overlapping UTC slots
  const overlapUtc = myUtcSlots
    .filter(s => theirUtcSet.has(`${s.week_year}-${s.day_of_week}-${s.time_slot}`));

  // Convert my slots to MY local timezone for display
  const myLocalSlots = myUtcSlots.map(s => {
    const local = utcToLocal(s.week_year, s.day_of_week, s.time_slot, me.timezone);
    return { day: local.day, timeSlot: local.timeSlot };
  });

  // Convert their slots to THEIR local timezone for display
  const theirLocalSlots = theirUtcSlots.map(s => {
    const local = utcToLocal(s.week_year, s.day_of_week, s.time_slot, otherUser.timezone);
    return { day: local.day, timeSlot: local.timeSlot };
  });

  // Format 12h time
  function fmt12(timeSlot) {
    const [h, m] = timeSlot.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  // For overlap, provide BOTH timezone representations
  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const overlap = overlapUtc.map(s => {
    const myLocal = utcToLocal(s.week_year, s.day_of_week, s.time_slot, me.timezone);
    const theirLocal = utcToLocal(s.week_year, s.day_of_week, s.time_slot, otherUser.timezone);

    return {
      utcDay: s.day_of_week,
      utcTimeSlot: s.time_slot,
      myDay: myLocal.day,
      myTimeSlot: myLocal.timeSlot,
      myLabel: `${DAY_NAMES[myLocal.day]} ${fmt12(myLocal.timeSlot)} ${myLocal.tzAbbrev}`,
      theirDay: theirLocal.day,
      theirTimeSlot: theirLocal.timeSlot,
      theirLabel: `${DAY_NAMES[theirLocal.day]} ${fmt12(theirLocal.timeSlot)} ${theirLocal.tzAbbrev}`,
    };
  });

  const localWeekYear = getCurrentWeekYearForTimezone(me.timezone);

  res.json({
    weekYear: localWeekYear,
    myTimezone: me.timezone,
    theirTimezone: otherUser.timezone,
    user: { username: otherUser.username, displayName: otherUser.display_name, timezone: otherUser.timezone },
    mySlots: myLocalSlots,
    theirSlots: theirLocalSlots,
    overlap
  });
});

// ========== CALENDAR INVITE ==========

app.get('/api/invite/:username', requireAuth, (req, res) => {
  const me = getUserById.get(req.session.userId);
  const otherUser = getUserByUsername.get(req.params.username);
  if (!otherUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  const slot = req.query.slot; // format: "0-14:00" (utcDay-utcTime)
  if (!slot || !/^\d-\d{2}:\d{2}$/.test(slot)) {
    return res.status(400).json({ error: 'Invalid slot format. Expected: day-HH:MM' });
  }

  const [utcDayStr, utcTime] = slot.split('-');
  const utcDay = parseInt(utcDayStr);
  const [utcHour, utcMinute] = utcTime.split(':').map(Number);

  // Compute the actual UTC datetime for this slot
  const localWeekYear = getCurrentWeekYearForTimezone(me.timezone);
  const { getWeekMonday } = require('./database');
  const monday = getWeekMonday(localWeekYear);

  // The slot is stored in UTC with its own week; rebuild actual UTC datetime
  const utcDt = monday.plus({ days: utcDay }).set({ hour: utcHour, minute: utcMinute, second: 0 });

  // Convert to both timezones for the description
  const myLocal = utcDt.setZone(me.timezone);
  const theirLocal = utcDt.setZone(otherUser.timezone);

  function fmt12(dt) {
    const h = dt.hour;
    const m = String(dt.minute).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m} ${ampm}`;
  }

  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const myLabel = `${DAY_NAMES[myLocal.weekday - 1]} ${fmt12(myLocal)} ${myLocal.toFormat('ZZZZ')}`;
  const theirLabel = `${DAY_NAMES[theirLocal.weekday - 1]} ${fmt12(theirLocal)} ${theirLocal.toFormat('ZZZZ')}`;

  const { error, value } = ics.createEvent({
    title: `Riftbound Match vs ${otherUser.display_name}`,
    description: `Riftbound TCG tournament match\\n${me.display_name} (@${me.username}) vs ${otherUser.display_name} (@${otherUser.username})\\n\\nYour time: ${myLabel}\\nTheir time: ${theirLabel}`,
    start: [utcDt.year, utcDt.month, utcDt.day, utcDt.hour, utcDt.minute],
    startInputType: 'utc',
    duration: { hours: 1 },
    status: 'CONFIRMED',
    busyStatus: 'BUSY',
  });

  if (error) {
    console.error('ICS generation error:', error);
    return res.status(500).json({ error: 'Failed to generate calendar invite' });
  }

  const filename = `riftbound-match-vs-${otherUser.username}.ics`;
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(value);
});

// ========== ADMIN ==========

app.get('/api/admin/users', (req, res) => {
  const weekYear = getCurrentWeekYear();
  const users = getAllUsers.all();
  const result = users.map(u => {
    const count = getUserAvailabilityCount.get(u.id, weekYear);
    return {
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      timezone: u.timezone,
      createdAt: u.created_at,
      availabilityFilledThisWeek: count.count > 0,
      slotCount: count.count
    };
  });
  res.json({ weekYear, users: result });
});

// ========== HTML PAGE ROUTES ==========

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/availability', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'availability.html'));
});

app.get('/search', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'search.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ========== START SERVER ==========

const server = app.listen(PORT, () => {
  console.log(`Riftbound Scheduler running at http://localhost:${PORT}`);
});

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down gracefully...');
  server.close(() => {
    db.close();
    console.log('Database connection closed.');
    process.exit(0);
  });
  // Force close after 5 seconds
  setTimeout(() => {
    db.close();
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
