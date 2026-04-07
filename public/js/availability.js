// Availability grid logic
(async function() {
  const auth = await RiftNav.checkAuth();
  if (!auth) return;
  const myTimezone = auth.user.timezone;
  RiftNav.createNav('availability', myTimezone);

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Generate time slots from 06:00 to 23:30 in 30-min increments
  function generateTimeSlots() {
    const slots = [];
    for (let h = 6; h <= 23; h++) {
      slots.push(`${String(h).padStart(2, '0')}:00`);
      slots.push(`${String(h).padStart(2, '0')}:30`);
    }
    return slots;
  }

  const TIME_SLOTS = generateTimeSlots();

  // State: track which cells are available
  const state = {}; // key: "day-time" -> boolean

  function cellKey(day, time) {
    return `${day}-${time}`;
  }

  // Build grid
  const grid = document.getElementById('grid');

  // Header row
  const timeHeader = document.createElement('div');
  timeHeader.className = 'grid-header time-header';
  timeHeader.textContent = 'Time';
  grid.appendChild(timeHeader);

  DAYS.forEach((day, dayIdx) => {
    const header = document.createElement('div');
    header.className = 'grid-header';
    header.innerHTML = `
      <div>${DAY_SHORT[dayIdx]}</div>
      <div class="day-actions">
        <button data-day="${dayIdx}" data-action="all">All</button>
        <button data-day="${dayIdx}" data-action="clear">Clear</button>
      </div>
    `;
    grid.appendChild(header);
  });

  // Time rows
  TIME_SLOTS.forEach(time => {
    const isHourStart = time.endsWith(':00');
    const label = document.createElement('div');
    label.className = 'time-label' + (isHourStart ? ' hour-start' : '');
    const h = parseInt(time.split(':')[0]);
    const m = time.split(':')[1];
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    label.textContent = `${h12}:${m} ${ampm}`;
    grid.appendChild(label);

    for (let day = 0; day < 7; day++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.day = day;
      cell.dataset.time = time;
      cell.addEventListener('click', () => toggleCell(cell, day, time));
      grid.appendChild(cell);
    }
  });

  function toggleCell(cell, day, time) {
    const key = cellKey(day, time);
    const isNowAvailable = !state[key];
    state[key] = isNowAvailable;

    if (isNowAvailable) {
      cell.classList.add('available');
    } else {
      cell.classList.remove('available');
    }

    scheduleSave(day, time, isNowAvailable);
  }

  // Select All / Clear All buttons
  grid.addEventListener('click', (e) => {
    if (e.target.dataset.action) {
      const day = parseInt(e.target.dataset.day);
      const action = e.target.dataset.action;
      const isAvailable = action === 'all';
      const batch = [];

      TIME_SLOTS.forEach(time => {
        const key = cellKey(day, time);
        state[key] = isAvailable;
        const cell = grid.querySelector(`.grid-cell[data-day="${day}"][data-time="${time}"]`);
        if (cell) {
          if (isAvailable) {
            cell.classList.add('available');
          } else {
            cell.classList.remove('available');
          }
        }
        batch.push({ day, timeSlot: time, isAvailable });
      });

      saveBatch(batch);
    }
  });

  // Debounced save
  let saveTimeout = null;
  let pendingSlots = [];
  const saveStatus = document.getElementById('saveStatus');

  function scheduleSave(day, time, isAvailable) {
    pendingSlots.push({ day, timeSlot: time, isAvailable });
    saveStatus.textContent = 'Saving...';
    saveStatus.className = 'save-status saving';

    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      const batch = [...pendingSlots];
      pendingSlots = [];
      saveBatch(batch);
    }, 500);
  }

  async function saveBatch(batch) {
    saveStatus.textContent = 'Saving...';
    saveStatus.className = 'save-status saving';
    try {
      const res = await fetch('/api/availability/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots: batch })
      });
      if (res.ok) {
        saveStatus.textContent = 'Saved!';
        saveStatus.className = 'save-status saved';
        setTimeout(() => {
          if (saveStatus.textContent === 'Saved!') {
            saveStatus.textContent = '';
            saveStatus.className = 'save-status';
          }
        }, 2000);
      }
    } catch {
      saveStatus.textContent = 'Save failed';
      saveStatus.className = 'save-status saving';
    }
  }

  // Load existing availability — server returns slots already in user's local timezone
  async function loadAvailability() {
    try {
      const res = await fetch('/api/availability/me');
      const data = await res.json();

      document.getElementById('weekBadge').textContent = data.weekYear;

      data.slots.forEach(s => {
        const key = cellKey(s.day_of_week, s.time_slot);
        state[key] = true;
        const cell = grid.querySelector(`.grid-cell[data-day="${s.day_of_week}"][data-time="${s.time_slot}"]`);
        if (cell) {
          cell.classList.add('available');
        }
      });
    } catch (err) {
      console.error('Failed to load availability:', err);
    }
  }

  await loadAvailability();
  document.getElementById('app').style.display = 'block';
})();
