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

  // State for current overlap data
  let currentOverlapData = null;
  let selectedSlotIndex = null;

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

    const byDay = {};
    overlapSlots.forEach((s, idx) => {
      if (!byDay[s.myDay]) byDay[s.myDay] = [];
      byDay[s.myDay].push({ ...s, idx });
    });

    const dayOrder = Object.keys(byDay).map(Number).sort((a, b) => a - b);

    dayOrder.forEach(dayIdx => {
      const slots = byDay[dayIdx].sort((a, b) => a.myTimeSlot.localeCompare(b.myTimeSlot));
      slots.forEach(s => {
        const row = document.createElement('div');
        row.className = 'overlap-row';
        row.dataset.slotIndex = s.idx;
        if (selectedSlotIndex === s.idx) row.classList.add('selected');
        row.innerHTML = `
          <span class="overlap-time-mine">${s.myLabel}</span>
          <span class="overlap-divider">/</span>
          <span class="overlap-time-theirs">${s.theirLabel}</span>
        `;
        row.addEventListener('click', () => selectSlot(s.idx));
        container.appendChild(row);
      });
    });
  }

  function selectSlot(idx) {
    // Toggle: if clicking same slot, deselect
    if (selectedSlotIndex === idx) {
      selectedSlotIndex = null;
    } else {
      selectedSlotIndex = idx;
    }
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const section = document.getElementById('selectedTimeSection');
    const display = document.getElementById('selectedTimeDisplay');
    const calBtn = document.getElementById('calendarBtn');

    // Update row highlights
    document.querySelectorAll('.overlap-row').forEach(row => {
      if (parseInt(row.dataset.slotIndex) === selectedSlotIndex) {
        row.classList.add('selected');
      } else {
        row.classList.remove('selected');
      }
    });

    if (selectedSlotIndex !== null && currentOverlapData) {
      const s = currentOverlapData.overlap[selectedSlotIndex];
      display.textContent = `${s.myLabel}  /  ${s.theirLabel}`;
      section.classList.add('visible');

      // Calendar invite link
      const slotParam = `${s.utcDay}-${s.utcTimeSlot}`;
      calBtn.href = `/api/invite/${encodeURIComponent(currentOverlapData.user.username)}?slot=${encodeURIComponent(slotParam)}`;
      calBtn.style.display = 'inline-flex';
    } else {
      section.classList.remove('visible');
      calBtn.style.display = 'none';
    }
  }

  // Generate the week-of date string from the weekYear
  function weekOfDate(weekYear) {
    // Parse "2026-W15" to get Monday's date
    // ISO week format: YYYY-Www
    const match = weekYear.match(/(\d{4})-W(\d{2})/);
    if (!match) return weekYear;
    const year = parseInt(match[1]);
    const week = parseInt(match[2]);
    // Compute Monday of ISO week
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const mondayOfWeek1 = new Date(jan4);
    mondayOfWeek1.setDate(jan4.getDate() - dayOfWeek + 1);
    const monday = new Date(mondayOfWeek1);
    monday.setDate(mondayOfWeek1.getDate() + (week - 1) * 7);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[monday.getMonth()]} ${monday.getDate()}, ${monday.getFullYear()}`;
  }

  function buildCopyText(selectedOnly) {
    if (!currentOverlapData) return '';
    const data = currentOverlapData;
    const weekDate = weekOfDate(data.weekYear);
    let text = `\u{1F3B4} Riftbound Match Availability \u{2014} Week of ${weekDate}\n`;

    if (selectedOnly && selectedSlotIndex !== null) {
      const s = data.overlap[selectedSlotIndex];
      text += `\nConfirmed match time:\n`;
      text += `\u{2705} ${s.myLabel} / ${s.theirLabel}\n`;
    } else {
      text += `\nBoth free:\n`;
      data.overlap.forEach(s => {
        text += `\u{2022} ${s.myLabel} / ${s.theirLabel}\n`;
      });
    }
    return text;
  }

  function flashCopyConfirm(el) {
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 1500);
  }

  // Copy all button
  document.getElementById('copyAllBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(buildCopyText(false)).then(() => {
      flashCopyConfirm(document.getElementById('copyAllConfirm'));
    });
  });

  // Copy selected button
  document.getElementById('copySelectedBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(buildCopyText(true)).then(() => {
      flashCopyConfirm(document.getElementById('copySelectedConfirm'));
    });
  });

  async function loadOverlap(username) {
    try {
      const res = await fetch(`/api/overlap/${encodeURIComponent(username)}`);
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to load overlap');
        return;
      }
      const data = await res.json();
      currentOverlapData = data;
      selectedSlotIndex = null;

      document.getElementById('otherName').textContent = data.user.displayName;
      document.getElementById('otherUsername').textContent = data.user.username;
      document.getElementById('overlapWeek').textContent = data.weekYear;

      document.getElementById('tzInfo').innerHTML =
        `<span class="tz-badge">You: ${data.myTimezone}</span>` +
        `<span class="tz-badge">Them: ${data.theirTimezone}</span>`;

      const mySet = new Set(data.mySlots.map(s => `${s.day}-${s.timeSlot}`));
      const theirSet = new Set(data.theirSlots.map(s => `${s.day}-${s.timeSlot}`));
      const overlapMySet = new Set(data.overlap.map(s => `${s.myDay}-${s.myTimeSlot}`));

      const noOverlapMsg = document.getElementById('noOverlapMsg');
      const overlapListWrapper = document.getElementById('overlapListWrapper');
      const overlapActions = document.getElementById('overlapActions');
      const clickHint = document.getElementById('clickHint');

      // Reset selected time section
      document.getElementById('selectedTimeSection').classList.remove('visible');

      if (data.overlap.length === 0) {
        noOverlapMsg.style.display = 'block';
        overlapListWrapper.style.display = 'none';
      } else {
        noOverlapMsg.style.display = 'none';
        overlapListWrapper.style.display = 'block';
        overlapActions.style.display = 'flex';
        clickHint.style.display = 'block';
        buildOverlapList(document.getElementById('overlapList'), data.overlap);
      }

      buildReadOnlyGrid(document.getElementById('comparisonGrid'), mySet, theirSet, overlapMySet);

      overlapContainer.classList.add('visible');
    } catch (err) {
      console.error('Overlap load failed:', err);
    }
  }

  document.getElementById('app').style.display = 'block';
})();
