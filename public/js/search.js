// Search and overlap logic
(async function() {
  const auth = await RiftNav.checkAuth();
  if (!auth) return;
  const myTimezone = auth.user.timezone;
  RiftNav.createNav('search', myTimezone);

  const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // 1-hour slots
  function generateTimeSlots() {
    const slots = [];
    for (let h = 6; h <= 23; h++) {
      slots.push(`${String(h).padStart(2, '0')}:00`);
    }
    return slots;
  }

  const TIME_SLOTS = generateTimeSlots();

  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  const overlapContainer = document.getElementById('overlapContainer');

  let currentOverlapData = null;
  let selectedIndices = new Set(); // multi-select

  let searchTimeout;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = searchInput.value.trim();
    if (q.length < 1) { searchResults.classList.remove('visible'); return; }
    searchTimeout = setTimeout(() => doSearch(q), 250);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) searchResults.classList.remove('visible');
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
    } catch (err) { console.error('Search failed:', err); }
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
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:00 ${ampm}`;
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
      const label = document.createElement('div');
      label.className = 'time-label hour-start';
      label.textContent = formatTime(time);
      container.appendChild(label);

      for (let day = 0; day < 7; day++) {
        const key = `${day}-${time}`;
        const cell = document.createElement('div');
        cell.className = 'grid-cell';

        if (overlapSet.has(key)) {
          cell.classList.add('both');
          cell.textContent = '\u2713';
        } else if (mySet.has(key)) {
          cell.classList.add('mine');
          cell.textContent = 'You';
        } else if (theirSet.has(key)) {
          cell.classList.add('theirs');
          cell.textContent = 'Them';
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
        if (selectedIndices.has(s.idx)) row.classList.add('selected');
        row.innerHTML = `
          <div class="overlap-checkbox"></div>
          <span class="overlap-time-mine">${s.myLabel}</span>
          <span class="overlap-divider">/</span>
          <span class="overlap-time-theirs">${s.theirLabel}</span>
        `;
        row.addEventListener('click', () => toggleSlot(s.idx));
        container.appendChild(row);
      });
    });
  }

  function toggleSlot(idx) {
    if (selectedIndices.has(idx)) {
      selectedIndices.delete(idx);
    } else {
      selectedIndices.add(idx);
    }
    updateSelectionUI();
  }

  function selectAll() {
    if (!currentOverlapData) return;
    if (selectedIndices.size === currentOverlapData.overlap.length) {
      selectedIndices.clear();
    } else {
      currentOverlapData.overlap.forEach((_, idx) => selectedIndices.add(idx));
    }
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const section = document.getElementById('selectedTimeSection');
    const display = document.getElementById('selectedTimeDisplay');
    const calBtn = document.getElementById('calendarBtn');
    const calNote = document.getElementById('calendarNote');
    const selectAllBtn = document.getElementById('selectAllBtn');

    // Update row highlights
    document.querySelectorAll('.overlap-row').forEach(row => {
      const idx = parseInt(row.dataset.slotIndex);
      if (selectedIndices.has(idx)) {
        row.classList.add('selected');
      } else {
        row.classList.remove('selected');
      }
    });

    // Update select all button text
    if (currentOverlapData && selectedIndices.size === currentOverlapData.overlap.length) {
      selectAllBtn.textContent = 'Deselect All';
    } else {
      selectAllBtn.textContent = 'Select All';
    }

    if (selectedIndices.size > 0 && currentOverlapData) {
      // Build display of selected times
      const lines = [];
      const sortedIndices = [...selectedIndices].sort((a, b) => {
        const sa = currentOverlapData.overlap[a];
        const sb = currentOverlapData.overlap[b];
        return (sa.myDay * 100 + sa.myTimeSlot.localeCompare(sb.myTimeSlot)) -
               (sb.myDay * 100);
      });
      sortedIndices.forEach(idx => {
        const s = currentOverlapData.overlap[idx];
        lines.push(`${s.myLabel}  /  ${s.theirLabel}`);
      });
      display.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
      section.classList.add('visible');

      // Calendar invite — use earliest selected slot
      const earliest = sortedIndices[0];
      const s = currentOverlapData.overlap[earliest];
      const slotParam = `${s.utcDay}-${s.utcTimeSlot}`;
      calBtn.href = `/api/invite/${encodeURIComponent(currentOverlapData.user.username)}?slot=${encodeURIComponent(slotParam)}`;
      calBtn.style.display = 'inline-flex';

      if (selectedIndices.size > 1) {
        calNote.textContent = 'Calendar invite will use the earliest selected time. Select one slot for a specific invite.';
        calNote.style.display = 'block';
      } else {
        calNote.style.display = 'none';
      }
    } else {
      section.classList.remove('visible');
      calBtn.style.display = 'none';
      calNote.style.display = 'none';
    }
  }

  function weekOfDate(weekYear) {
    const match = weekYear.match(/(\d{4})-W(\d{2})/);
    if (!match) return weekYear;
    const year = parseInt(match[1]);
    const week = parseInt(match[2]);
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const mondayOfWeek1 = new Date(jan4);
    mondayOfWeek1.setDate(jan4.getDate() - dayOfWeek + 1);
    const monday = new Date(mondayOfWeek1);
    monday.setDate(mondayOfWeek1.getDate() + (week - 1) * 7);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[monday.getMonth()]} ${monday.getDate()}, ${monday.getFullYear()}`;
  }

  function buildCopyText(indicesSet) {
    if (!currentOverlapData) return '';
    const data = currentOverlapData;
    const weekDate = weekOfDate(data.weekYear);
    let text = `\u{1F3B4} Riftbound Match Availability \u{2014} Week of ${weekDate}\n\nBoth free:\n`;

    const indices = indicesSet ? [...indicesSet] : data.overlap.map((_, i) => i);
    indices.sort((a, b) => {
      const sa = data.overlap[a], sb = data.overlap[b];
      if (sa.myDay !== sb.myDay) return sa.myDay - sb.myDay;
      return sa.myTimeSlot.localeCompare(sb.myTimeSlot);
    });
    indices.forEach(idx => {
      const s = data.overlap[idx];
      text += `\u{2022} ${s.myLabel} / ${s.theirLabel}\n`;
    });
    return text;
  }

  function flashCopyConfirm(el) {
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 1500);
  }

  // Copy all
  document.getElementById('copyAllBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(buildCopyText(null)).then(() => {
      flashCopyConfirm(document.getElementById('copyAllConfirm'));
    });
  });

  // Copy selected
  document.getElementById('copySelectedBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(buildCopyText(selectedIndices)).then(() => {
      flashCopyConfirm(document.getElementById('copySelectedConfirm'));
    });
  });

  // Select all
  document.getElementById('selectAllBtn').addEventListener('click', selectAll);

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
      selectedIndices = new Set();

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
