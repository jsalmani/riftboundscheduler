const http = require('http');

const BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;

// Cookie jars for each user session
let cookieJar1 = '';
let cookieJar2 = '';

function request(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {}
    };

    if (cookie) {
      options.headers['Cookie'] = cookie;
    }
    if (body) {
      const data = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = http.request(options, (res) => {
      let chunks = '';
      res.on('data', (d) => chunks += d);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(chunks); } catch {}
        const setCookie = res.headers['set-cookie'];
        let sessionCookie = '';
        if (setCookie) {
          for (const c of setCookie) {
            const match = c.match(/connect\.sid=[^;]+/);
            if (match) sessionCookie = match[0];
          }
        }
        resolve({ status: res.statusCode, body: json, cookie: sessionCookie, raw: chunks });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(name, condition) {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}`);
    failed++;
  }
}

async function runTests() {
  console.log('=== Riftbound Scheduler Tests ===\n');

  // 1. Register player1
  console.log('1. Register users');
  let res = await request('POST', '/api/auth/register', {
    username: 'player1', displayName: 'Player One', password: 'password123'
  });
  assert('Register player1 returns 200', res.status === 200);
  assert('Register player1 returns success', res.body && res.body.success === true);
  if (res.cookie) cookieJar1 = res.cookie;

  // 2. Register player2
  res = await request('POST', '/api/auth/register', {
    username: 'player2', displayName: 'Player Two', password: 'password456'
  });
  assert('Register player2 returns 200', res.status === 200);
  if (res.cookie) cookieJar2 = res.cookie;

  // 3. Duplicate registration
  res = await request('POST', '/api/auth/register', {
    username: 'player1', displayName: 'Dupe', password: 'password123'
  });
  assert('Duplicate registration returns 409', res.status === 409);

  // 4. Validation: short password
  res = await request('POST', '/api/auth/register', {
    username: 'player3', displayName: 'P3', password: 'short'
  });
  assert('Short password returns 400', res.status === 400);

  // 5. Login
  console.log('\n2. Login');
  res = await request('POST', '/api/auth/login', {
    username: 'player1', password: 'password123'
  });
  assert('Login player1 returns 200', res.status === 200);
  if (res.cookie) cookieJar1 = res.cookie;

  // 6. Login player2
  res = await request('POST', '/api/auth/login', {
    username: 'player2', password: 'password456'
  });
  assert('Login player2 returns 200', res.status === 200);
  if (res.cookie) cookieJar2 = res.cookie;

  // 7. Bad login
  res = await request('POST', '/api/auth/login', {
    username: 'player1', password: 'wrongpass'
  });
  assert('Bad password returns 401', res.status === 401);

  // 8. Auth check
  console.log('\n3. Auth check');
  res = await request('GET', '/api/auth/me', null, cookieJar1);
  assert('GET /api/auth/me returns 200', res.status === 200);
  assert('Returns correct username', res.body && res.body.user && res.body.user.username === 'player1');

  // 9. Unauthed check
  res = await request('GET', '/api/auth/me', null, '');
  assert('Unauthed /api/auth/me returns 401', res.status === 401);

  // 10. Save availability for player1
  console.log('\n4. Save availability');
  const player1Slots = [
    { day: 0, timeSlot: '10:00', isAvailable: true },
    { day: 0, timeSlot: '10:30', isAvailable: true },
    { day: 0, timeSlot: '11:00', isAvailable: true },
    { day: 2, timeSlot: '14:00', isAvailable: true },
    { day: 2, timeSlot: '14:30', isAvailable: true },
    { day: 5, timeSlot: '18:00', isAvailable: true },
  ];
  res = await request('POST', '/api/availability/save', { slots: player1Slots }, cookieJar1);
  assert('Save player1 availability returns 200', res.status === 200);

  // 11. Save availability for player2 (some overlapping)
  const player2Slots = [
    { day: 0, timeSlot: '10:30', isAvailable: true },  // overlaps with player1
    { day: 0, timeSlot: '11:00', isAvailable: true },  // overlaps with player1
    { day: 0, timeSlot: '11:30', isAvailable: true },  // no overlap
    { day: 2, timeSlot: '14:00', isAvailable: true },  // overlaps with player1
    { day: 3, timeSlot: '09:00', isAvailable: true },  // no overlap
    { day: 5, timeSlot: '18:00', isAvailable: true },  // overlaps with player1
  ];
  res = await request('POST', '/api/availability/save', { slots: player2Slots }, cookieJar2);
  assert('Save player2 availability returns 200', res.status === 200);

  // 12. Get own availability
  console.log('\n5. Get availability');
  res = await request('GET', '/api/availability/me', null, cookieJar1);
  assert('Get player1 availability returns 200', res.status === 200);
  assert('Player1 has 6 available slots', res.body && res.body.slots && res.body.slots.length === 6);

  // 13. Get other user's availability
  res = await request('GET', '/api/availability/player2', null, cookieJar1);
  assert('Get player2 availability as player1 returns 200', res.status === 200);
  assert('Player2 has 6 available slots', res.body && res.body.slots && res.body.slots.length === 6);

  // 14. Overlap
  console.log('\n6. Overlap check');
  res = await request('GET', '/api/overlap/player2', null, cookieJar1);
  assert('Get overlap returns 200', res.status === 200);
  assert('Overlap has correct count (4)', res.body && res.body.overlap && res.body.overlap.length === 4);

  // Verify specific overlapping slots
  if (res.body && res.body.overlap) {
    const overlapKeys = res.body.overlap.map(s => `${s.day}-${s.timeSlot}`).sort();
    const expected = ['0-10:30', '0-11:00', '2-14:00', '5-18:00'].sort();
    assert('Overlap contains correct slots', JSON.stringify(overlapKeys) === JSON.stringify(expected));
  } else {
    assert('Overlap contains correct slots', false);
  }

  // 15. Search
  console.log('\n7. User search');
  res = await request('GET', '/api/users/search?q=player', null, cookieJar1);
  assert('Search returns 200', res.status === 200);
  assert('Search finds player2 (not self)', res.body && res.body.users && res.body.users.length === 1 && res.body.users[0].username === 'player2');

  // 16. Search - no results
  res = await request('GET', '/api/users/search?q=nonexistent', null, cookieJar1);
  assert('Search with no match returns empty', res.body && res.body.users && res.body.users.length === 0);

  // 17. Admin
  console.log('\n8. Admin');
  res = await request('GET', '/api/admin/users', null);
  assert('Admin endpoint returns users', res.status === 200 && res.body && res.body.users && res.body.users.length === 2);

  // 18. Logout
  console.log('\n9. Logout');
  res = await request('POST', '/api/auth/logout', null, cookieJar1);
  assert('Logout returns 200', res.status === 200);

  // 19. After logout, auth check should fail
  res = await request('GET', '/api/auth/me', null, cookieJar1);
  assert('After logout, auth check returns 401', res.status === 401);

  // 20. Unauthed availability save should fail
  res = await request('POST', '/api/availability/save', { day: 0, timeSlot: '10:00', isAvailable: true }, '');
  assert('Unauthed save returns 401', res.status === 401);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('All tests passed!');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
