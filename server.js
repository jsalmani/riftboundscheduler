const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const {
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
    const { username, displayName, password } = req.body;

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

    const existing = getUserByUsername.get(username);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = createUser.run(username.toLowerCase(), displayName, passwordHash);

    req.session.userId = result.lastInsertRowid;
    res.json({ success: true, user: { id: result.lastInsertRowid, username: username.toLowerCase(), displayName } });
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
    res.json({ success: true, user: { id: user.id, username: user.username, displayName: user.display_name } });
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
  res.json({ user: { id: user.id, username: user.username, displayName: user.display_name } });
});

// ========== AVAILABILITY ROUTES ==========

app.get('/api/availability/me', requireAuth, (req, res) => {
  const weekYear = getCurrentWeekYear();
  const slots = getAvailability.all(req.session.userId, weekYear);
  res.json({ weekYear, slots });
});

app.post('/api/availability/save', requireAuth, (req, res) => {
  try {
    const weekYear = getCurrentWeekYear();

    // Support both single slot and bulk saves
    if (Array.isArray(req.body.slots)) {
      bulkSaveAvailability(req.session.userId, weekYear, req.body.slots);
    } else {
      const { day, timeSlot, isAvailable } = req.body;
      if (day === undefined || !timeSlot || isAvailable === undefined) {
        return res.status(400).json({ error: 'day, timeSlot, and isAvailable are required' });
      }
      upsertAvailability.run(req.session.userId, weekYear, day, timeSlot, isAvailable ? 1 : 0);
    }

    res.json({ success: true, weekYear });
  } catch (err) {
    console.error('Save availability error:', err);
    res.status(500).json({ error: 'Failed to save availability' });
  }
});

app.get('/api/availability/:username', requireAuth, (req, res) => {
  const user = getUserByUsername.get(req.params.username);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  const weekYear = getCurrentWeekYear();
  const slots = getAvailability.all(user.id, weekYear);
  res.json({ weekYear, user: { username: user.username, displayName: user.display_name }, slots });
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
  const otherUser = getUserByUsername.get(req.params.username);
  if (!otherUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  const weekYear = getCurrentWeekYear();
  const mySlots = getAvailability.all(req.session.userId, weekYear);
  const theirSlots = getAvailability.all(otherUser.id, weekYear);

  // Build a set of the other user's available slots
  const theirSet = new Set(
    theirSlots.map(s => `${s.day_of_week}-${s.time_slot}`)
  );

  // Find overlaps
  const overlap = mySlots
    .filter(s => theirSet.has(`${s.day_of_week}-${s.time_slot}`))
    .map(s => ({ day: s.day_of_week, timeSlot: s.time_slot }));

  res.json({
    weekYear,
    user: { username: otherUser.username, displayName: otherUser.display_name },
    mySlots: mySlots.map(s => ({ day: s.day_of_week, timeSlot: s.time_slot })),
    theirSlots: theirSlots.map(s => ({ day: s.day_of_week, timeSlot: s.time_slot })),
    overlap
  });
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
