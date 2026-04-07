// Search page — search for users and show overlap
(async function() {
  const auth = await RiftNav.checkAuth();
  if (!auth) return;
  RiftNav.createNav('search', auth.user.timezone);

  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  let searchTimeout;

  // Create overlap controller using shared module
  // IDs map directly since search.html uses these IDs
  const overlap = RiftOverlap.create({
    selectedTimeSection: 'selectedTimeSection',
    selectedTimeDisplay: 'selectedTimeDisplay',
    calendarBtn: 'calendarBtn',
    calendarNote: 'calendarNote',
    selectAllBtn: 'selectAllBtn',
    copyAllBtn: 'copyAllBtn',
    copyAllConfirm: 'copyAllConfirm',
    copySelectedBtn: 'copySelectedBtn',
    copySelectedConfirm: 'copySelectedConfirm',
    otherName: 'otherName',
    otherUsername: 'otherUsername',
    overlapWeek: 'overlapWeek',
    tzInfo: 'tzInfo',
    noOverlapMsg: 'noOverlapMsg',
    overlapListWrapper: 'overlapListWrapper',
    overlapActions: 'overlapActions',
    clickHint: 'clickHint',
    overlapList: 'overlapList',
    comparisonGrid: 'comparisonGrid',
    overlapContainer: 'overlapContainer',
  });

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
      overlap.loadOverlap(item.dataset.username);
    }
  });

  // Auto-load from URL hash (e.g. /search#player2)
  const hashUser = window.location.hash.slice(1);
  if (hashUser) {
    searchInput.value = decodeURIComponent(hashUser);
    overlap.loadOverlap(decodeURIComponent(hashUser));
  }

  document.getElementById('app').style.display = 'block';
})();
