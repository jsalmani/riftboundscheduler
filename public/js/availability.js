// Availability grid logic
(async function() {
  const auth = await RiftNav.checkAuth();
  if (!auth) return;
  const myTimezone = auth.user.timezone;
  RiftNav.createNav('availability', myTimezone);

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function generateTimeSlots() {
    const slots = [];
    for (let h = 6; h <= 23; h++) {
      slots.push(`${String(h).padStart(2, '0')}:00`);
      slots.push(`${String(h).padStart(2, '0')}:30`);
    }
    return slots;
  }

  const TIME_SLOTS = generateTimeSlots();
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

  // Build a lookup for cells by day-time
  const cellMap = {};

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
      grid.appendChild(cell);
      cellMap[cellKey(day, time)] = cell;
    }
  });

  function setCellState(day, time, isAvailable) {
    const key = cellKey(day, time);
    state[key] = isAvailable;
    const cell = cellMap[key];
    if (cell) {
      if (isAvailable) {
        cell.classList.add('available');
      } else {
        cell.classList.remove('available');
      }
    }
  }

  // ========== DRAG TO SELECT ==========
  let isDragging = false;
  let dragMode = null; // true = marking available, false = marking unavailable
  let draggedCells = new Set(); // track which cells were touched during this drag

  function getCellFromEvent(e) {
    let target;
    if (e.touches) {
      const touch = e.touches[0];
      target = document.elementFromPoint(touch.clientX, touch.clientY);
    } else {
      target = e.target;
    }
    if (target && target.classList.contains('grid-cell')) {
      return target;
    }
    return null;
  }

  function startDrag(e) {
    const cell = getCellFromEvent(e);
    if (!cell) return;
    // Don't start drag on header buttons
    if (e.target.dataset.action) return;

    isDragging = true;
    draggedCells = new Set();

    const day = parseInt(cell.dataset.day);
    const time = cell.dataset.time;
    const key = cellKey(day, time);

    // Determine drag mode from initial cell state
    dragMode = !state[key]; // if unchecked → mark available; if checked → mark unavailable

    setCellState(day, time, dragMode);
    draggedCells.add(key);

    e.preventDefault();
  }

  function continueDrag(e) {
    if (!isDragging) return;
    const cell = getCellFromEvent(e);
    if (!cell) return;

    const day = parseInt(cell.dataset.day);
    const time = cell.dataset.time;
    const key = cellKey(day, time);

    if (!draggedCells.has(key)) {
      setCellState(day, time, dragMode);
      draggedCells.add(key);
    }

    e.preventDefault();
  }

  function endDrag() {
    if (!isDragging) return;
    isDragging = false;

    // Batch save all dragged cells
    if (draggedCells.size > 0) {
      const batch = [];
      draggedCells.forEach(key => {
        const [day, time] = key.split('-');
        batch.push({ day: parseInt(day), timeSlot: time, isAvailable: dragMode });
      });
      saveBatch(batch);
    }
    draggedCells = new Set();
    dragMode = null;
  }

  // Mouse events
  grid.addEventListener('mousedown', startDrag);
  grid.addEventListener('mousemove', continueDrag);
  document.addEventListener('mouseup', endDrag);

  // Touch events
  grid.addEventListener('touchstart', startDrag, { passive: false });
  grid.addEventListener('touchmove', continueDrag, { passive: false });
  document.addEventListener('touchend', endDrag);

  // Select All / Clear All buttons
  grid.addEventListener('click', (e) => {
    if (e.target.dataset.action) {
      const day = parseInt(e.target.dataset.day);
      const action = e.target.dataset.action;
      const isAvailable = action === 'all';
      const batch = [];

      TIME_SLOTS.forEach(time => {
        setCellState(day, time, isAvailable);
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

  // Load existing availability
  async function loadAvailability() {
    try {
      const res = await fetch('/api/availability/me');
      const data = await res.json();

      document.getElementById('weekBadge').textContent = data.weekYear;

      data.slots.forEach(s => {
        const key = cellKey(s.day_of_week, s.time_slot);
        state[key] = true;
        const cell = cellMap[key];
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
