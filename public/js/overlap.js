// Shared overlap UI logic — used by both search.js and player.html
window.RiftOverlap = (function() {
  const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function generateTimeSlots() {
    const slots = [];
    for (let h = 6; h <= 23; h++) {
      slots.push(`${String(h).padStart(2, '0')}:00`);
    }
    return slots;
  }

  const TIME_SLOTS = generateTimeSlots();

  function formatTime(time) {
    const h = parseInt(time.split(':')[0]);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:00 ${ampm}`;
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

  // Creates an overlap controller bound to DOM elements by prefix
  // prefix: '' for search page, 'p_' for player page (to avoid ID collisions)
  function create(ids) {
    let currentOverlapData = null;
    let selectedIndices = new Set();
    let extraSelections = [];
    let activePopup = null;
    let theirSlotMap = {};

    function el(id) { return document.getElementById(ids[id] || id); }

    function removePopup() {
      if (activePopup) { activePopup.remove(); activePopup = null; }
    }

    document.addEventListener('click', (e) => {
      if (activePopup && !e.target.closest('.cell-popup') && !e.target.closest('.grid-cell')) {
        removePopup();
      }
    });

    function flashConfirm(elem) {
      elem.classList.add('visible');
      setTimeout(() => elem.classList.remove('visible'), 1500);
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
            cell.addEventListener('click', (e) => showCellPopup(e, key, 'both'));
          } else if (mySet.has(key)) {
            cell.classList.add('mine');
            cell.textContent = 'You';
          } else if (theirSet.has(key)) {
            cell.classList.add('theirs');
            cell.textContent = 'Them';
            cell.addEventListener('click', (e) => showCellPopup(e, key, 'theirs'));
          }

          container.appendChild(cell);
        }
      });
    }

    function showCellPopup(e, key, type) {
      e.stopPropagation();
      removePopup();

      let slotData = null;
      if (type === 'both') {
        slotData = currentOverlapData.overlap.find(s => `${s.myDay}-${s.myTimeSlot}` === key);
      }
      if (type === 'theirs' || !slotData) {
        slotData = theirSlotMap[key];
      }
      if (!slotData) return;

      const popup = document.createElement('div');
      popup.className = 'cell-popup';
      const headerText = slotData.theirLabel + (slotData.myLabel ? ` / ${slotData.myLabel}` : '');
      popup.innerHTML = `
        <div class="cell-popup-header">${headerText}</div>
        <div class="cell-popup-item" data-action="select">Select this time</div>
        <div class="cell-popup-item" data-action="copy">Copy to clipboard</div>
        <div class="cell-popup-item" data-action="calendar">Download calendar invite</div>
      `;

      document.body.appendChild(popup);
      activePopup = popup;

      const rect = e.target.getBoundingClientRect();
      let left = rect.right + 4;
      let top = rect.top;
      const pw = popup.offsetWidth;
      const ph = popup.offsetHeight;
      if (left + pw > window.innerWidth) left = rect.left - pw - 4;
      if (top + ph > window.innerHeight) top = window.innerHeight - ph - 8;
      if (top < 0) top = 8;
      popup.style.left = left + 'px';
      popup.style.top = top + 'px';

      popup.addEventListener('click', (ev) => {
        const action = ev.target.dataset.action;
        if (!action) return;
        if (action === 'select') {
          addToSelection(slotData, type);
        } else if (action === 'copy') {
          RiftNav.copyText(buildSingleSlotCopyText(slotData));
        } else if (action === 'calendar') {
          const slotParam = `${slotData.utcDay}-${slotData.utcTimeSlot}`;
          window.location.href = `/api/invite/${encodeURIComponent(currentOverlapData.user.username)}?slot=${encodeURIComponent(slotParam)}`;
        }
        removePopup();
      });
    }

    function addToSelection(slotData, type) {
      if (type === 'both') {
        const idx = currentOverlapData.overlap.findIndex(s =>
          s.utcDay === slotData.utcDay && s.utcTimeSlot === slotData.utcTimeSlot
        );
        if (idx >= 0) selectedIndices.add(idx);
      } else {
        const exists = extraSelections.some(s =>
          s.utcDay === slotData.utcDay && s.utcTimeSlot === slotData.utcTimeSlot
        );
        if (!exists) {
          extraSelections.push({
            theirLabel: slotData.theirLabel,
            myLabel: slotData.myLabel,
            utcDay: slotData.utcDay,
            utcTimeSlot: slotData.utcTimeSlot,
          });
        }
      }
      updateSelectionUI();
    }

    function buildSingleSlotCopyText(slotData) {
      if (!currentOverlapData) return '';
      const weekDate = weekOfDate(currentOverlapData.weekYear);
      return `\u{1F3B4} Riftbound Match \u{2014} Week of ${weekDate}\n\u{2022} ${slotData.theirLabel} / ${slotData.myLabel}\n`;
    }

    function buildOverlapList(container, overlapSlots) {
      container.innerHTML = '';
      if (overlapSlots.length === 0) return;

      const byDay = {};
      overlapSlots.forEach((s, idx) => {
        if (!byDay[s.myDay]) byDay[s.myDay] = [];
        byDay[s.myDay].push({ ...s, idx });
      });

      Object.keys(byDay).map(Number).sort((a, b) => a - b).forEach(dayIdx => {
        byDay[dayIdx].sort((a, b) => a.myTimeSlot.localeCompare(b.myTimeSlot)).forEach(s => {
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
      if (selectedIndices.has(idx)) selectedIndices.delete(idx);
      else selectedIndices.add(idx);
      updateSelectionUI();
    }

    function selectAll() {
      if (!currentOverlapData) return;
      if (selectedIndices.size === currentOverlapData.overlap.length && extraSelections.length === 0) {
        selectedIndices.clear();
      } else {
        currentOverlapData.overlap.forEach((_, idx) => selectedIndices.add(idx));
      }
      extraSelections = [];
      updateSelectionUI();
    }

    function updateSelectionUI() {
      const section = el('selectedTimeSection');
      const display = el('selectedTimeDisplay');
      const calBtn = el('calendarBtn');
      const calNote = el('calendarNote');
      const selectAllBtn = el('selectAllBtn');

      document.querySelectorAll('.overlap-row').forEach(row => {
        const idx = parseInt(row.dataset.slotIndex);
        row.classList.toggle('selected', selectedIndices.has(idx));
      });

      if (currentOverlapData && selectedIndices.size === currentOverlapData.overlap.length && extraSelections.length === 0) {
        selectAllBtn.textContent = 'Deselect All';
      } else {
        selectAllBtn.textContent = 'Select All';
      }

      const totalSelected = selectedIndices.size + extraSelections.length;

      if (totalSelected > 0 && currentOverlapData) {
        const lines = [];

        [...selectedIndices].sort((a, b) => {
          const sa = currentOverlapData.overlap[a], sb = currentOverlapData.overlap[b];
          if (sa.myDay !== sb.myDay) return sa.myDay - sb.myDay;
          return sa.myTimeSlot.localeCompare(sb.myTimeSlot);
        }).forEach(idx => {
          const s = currentOverlapData.overlap[idx];
          lines.push({ label: `${s.myLabel}  /  ${s.theirLabel}`, utcDay: s.utcDay, utcTimeSlot: s.utcTimeSlot });
        });

        extraSelections.forEach(s => {
          lines.push({ label: `${s.myLabel}  /  ${s.theirLabel} (their time only)`, utcDay: s.utcDay, utcTimeSlot: s.utcTimeSlot });
        });

        display.innerHTML = lines.map(l => `<div>${l.label}</div>`).join('');
        section.classList.add('visible');

        const first = lines[0];
        const slotParam = `${first.utcDay}-${first.utcTimeSlot}`;
        calBtn.href = `/api/invite/${encodeURIComponent(currentOverlapData.user.username)}?slot=${encodeURIComponent(slotParam)}`;
        calBtn.style.display = 'inline-flex';

        calNote.textContent = totalSelected > 1 ? 'Calendar invite will use the first selected time.' : '';
        calNote.style.display = totalSelected > 1 ? 'block' : 'none';
      } else {
        section.classList.remove('visible');
        calBtn.style.display = 'none';
        calNote.style.display = 'none';
      }
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

      if (indicesSet && extraSelections.length > 0) {
        text += `\nTheir availability (not yet mutual):\n`;
        extraSelections.forEach(s => {
          text += `\u{2022} ${s.myLabel} / ${s.theirLabel}\n`;
        });
      }
      return text;
    }

    // Wire up buttons
    el('copyAllBtn').addEventListener('click', () => {
      RiftNav.copyText(buildCopyText(null)).then(() => flashConfirm(el('copyAllConfirm')));
    });

    el('copySelectedBtn').addEventListener('click', () => {
      RiftNav.copyText(buildCopyText(selectedIndices)).then(() => flashConfirm(el('copySelectedConfirm')));
    });

    el('selectAllBtn').addEventListener('click', selectAll);

    // Load overlap data and render
    async function loadOverlap(username) {
      try {
        const res = await fetch(`/api/overlap/${encodeURIComponent(username)}`);
        if (!res.ok) return;
        const data = await res.json();
        currentOverlapData = data;
        selectedIndices = new Set();
        extraSelections = [];
        removePopup();

        el('otherName').textContent = data.user.displayName;
        el('otherUsername').textContent = data.user.username;
        el('overlapWeek').textContent = data.weekYear;

        el('tzInfo').innerHTML =
          `<span class="tz-badge">You: ${data.myTimezone}</span>` +
          `<span class="tz-badge">Them: ${data.theirTimezone}</span>`;

        const mySet = new Set(data.mySlots.map(s => `${s.day}-${s.timeSlot}`));
        const theirSet = new Set(data.theirSlots.map(s => `${s.day}-${s.timeSlot}`));
        const overlapMySet = new Set(data.overlap.map(s => `${s.myDay}-${s.myTimeSlot}`));

        theirSlotMap = {};
        data.theirSlots.forEach(s => { theirSlotMap[`${s.day}-${s.timeSlot}`] = s; });

        el('selectedTimeSection').classList.remove('visible');

        if (data.overlap.length === 0) {
          el('noOverlapMsg').style.display = 'block';
          el('overlapListWrapper').style.display = 'none';
        } else {
          el('noOverlapMsg').style.display = 'none';
          el('overlapListWrapper').style.display = 'block';
          el('overlapActions').style.display = 'flex';
          el('clickHint').style.display = 'block';
          buildOverlapList(el('overlapList'), data.overlap);
        }

        buildReadOnlyGrid(el('comparisonGrid'), mySet, theirSet, overlapMySet);
        el('overlapContainer').classList.add('visible');
      } catch (err) {
        console.error('Overlap load failed:', err);
      }
    }

    return { loadOverlap };
  }

  return { create };
})();
