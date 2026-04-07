// Search and overlap logic
(async function() {
  const auth = await RiftNav.checkAuth();
  if (!auth) return;
  const myTimezone = auth.user.timezone;
  RiftNav.createNav('search', myTimezone);

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

  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  const overlapContainer = document.getElementById('overlapContainer');

  let searchTimeout;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = searchInput.value.trim();
    if (q.length < 1) {
      searchResults.classList.remove('visible');
      return;
    }
    searchTimeout = setTimeout(() => doSearch(q), 250);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) {
      searchResults.classList.remove('visible');
    }
  });

  async function doSearch(q) {
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();

      if (data.users.length === 0) {
        searchResults.innerHTML = '<div class="search-result-item"><span class="display-name">No users found</span></div>';
      } else {
        searchResults.innerHTML = data.users.map(u =>
          `<div class="search-result-item" data-username="${u.username}">
            <span class="username">${u.username}</span>
            <span class="display-name"> - ${u.display_name}</span>
          </div>`
        ).join('');
      }
      searchResults.classList.add('visible');
    } catch (err) {
      console.error('Search failed:', err);
    }
  }

  searchResults.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item');
    if (item && item.dataset.username) {
      searchInput.value = item.dataset.username;
      searchResults.classList.remove('visible');
      loadOverlap(item.dataset.username);
    }
  });

  function formatTime(time) {
    const h = parseInt(time.split(':')[0]);
    const m = time.split(':')[1];
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m} ${ampm}`;
  }

  function buildReadOnlyGrid(container, mySet, theirSet, overlapSet) {
    container.innerHTML = '';

    // Header
    const timeHeader = document.createElement('div');
    timeHeader.className = 'grid-header time-header';
    timeHeader.textContent = 'Time';
    container.appendChild(timeHeader);

    DAY_SHORT.forEach(day => {
      const header = document.createElement('div');
      header.className = 'grid-header';
      header.textContent = day;
      container.appendChild(header);
    });

    // Rows — show all time slots
    TIME_SLOTS.forEach(time => {
      const isHourStart = time.endsWith(':00');
      const label = document.createElement('div');
      label.className = 'time-label' + (isHourStart ? ' hour-start' : '');
      label.textContent = formatTime(time);
      container.appendChild(label);

      for (let day = 0; day < 7; day++) {
        const key = `${day}-${time}`;
        const cell = document.createElement('div');
        cell.className = 'grid-cell';

        if (overlapSet.has(key)) {
          cell.classList.add('both');
        } else if (mySet.has(key)) {
          cell.classList.add('mine');
        } else if (theirSet.has(key)) {
          cell.classList.add('theirs');
        }

        container.appendChild(cell);
      }
    });
  }

  function buildOverlapList(container, overlapSlots) {
    container.innerHTML = '';

    if (overlapSlots.length === 0) return;

    // Group by day (in my timezone)
    const byDay = {};
    overlapSlots.forEach(s => {
      if (!byDay[s.myDay]) byDay[s.myDay] = [];
      byDay[s.myDay].push(s);
    });

    // Sort by day then time
    const dayOrder = Object.keys(byDay).map(Number).sort((a, b) => a - b);

    dayOrder.forEach(dayIdx => {
      const slots = byDay[dayIdx].sort((a, b) => a.myTimeSlot.localeCompare(b.myTimeSlot));
      slots.forEach(s => {
        const row = document.createElement('div');
        row.className = 'overlap-row';
        row.innerHTML = `
          <span class="overlap-time-mine">${s.myLabel}</span>
          <span class="overlap-divider">/</span>
          <span class="overlap-time-theirs">${s.theirLabel}</span>
        `;
        container.appendChild(row);
      });
    });
  }

  async function loadOverlap(username) {
    try {
      const res = await fetch(`/api/overlap/${encodeURIComponent(username)}`);
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to load overlap');
        return;
      }
      const data = await res.json();

      document.getElementById('otherName').textContent = data.user.displayName;
      document.getElementById('otherUsername').textContent = data.user.username;
      document.getElementById('overlapWeek').textContent = data.weekYear;

      // Show timezone info
      document.getElementById('tzInfo').innerHTML =
        `<span class="tz-badge">You: ${data.myTimezone}</span>` +
        `<span class="tz-badge">Them: ${data.theirTimezone}</span>`;

      // Build sets from local-timezone slots for the comparison grid
      // My slots are in MY local timezone, their slots are in THEIR local timezone
      // For the comparison grid, we show everything in MY timezone perspective
      // So we need my slots in my local tz (already provided) and their slots in my local tz too
      // But the API gives their slots in their tz. We need to use the overlap's myDay/myTimeSlot
      // for overlap cells. For non-overlap cells we show my local and their local independently.
      const mySet = new Set(data.mySlots.map(s => `${s.day}-${s.timeSlot}`));
      const theirSet = new Set(data.theirSlots.map(s => `${s.day}-${s.timeSlot}`));

      // For the grid: overlap cells are keyed by MY local day/time
      const overlapMySet = new Set(data.overlap.map(s => `${s.myDay}-${s.myTimeSlot}`));

      const noOverlapMsg = document.getElementById('noOverlapMsg');
      const overlapListWrapper = document.getElementById('overlapListWrapper');

      if (data.overlap.length === 0) {
        noOverlapMsg.style.display = 'block';
        overlapListWrapper.style.display = 'none';
      } else {
        noOverlapMsg.style.display = 'none';
        overlapListWrapper.style.display = 'block';
        buildOverlapList(document.getElementById('overlapList'), data.overlap);
      }

      // Comparison grid uses my local timezone for my slots,
      // their local timezone for their slots (each sees their own perspective)
      buildReadOnlyGrid(document.getElementById('comparisonGrid'), mySet, theirSet, overlapMySet);

      overlapContainer.classList.add('visible');
    } catch (err) {
      console.error('Overlap load failed:', err);
    }
  }

  document.getElementById('app').style.display = 'block';
})();
