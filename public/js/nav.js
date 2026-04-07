// Shared navigation component
(function() {
  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        window.location.href = '/login';
        return null;
      }
      return await res.json();
    } catch {
      window.location.href = '/login';
      return null;
    }
  }

  function createNav(activePage, timezone) {
    const nav = document.createElement('nav');
    nav.className = 'navbar';
    const tzDisplay = timezone ? ` <span class="nav-tz">(${timezone})</span>` : '';
    nav.innerHTML = `
      <span class="nav-brand">Riftbound Scheduler${tzDisplay}</span>
      <div class="nav-links">
        <a href="/availability" class="${activePage === 'availability' ? 'active' : ''}">My Availability</a>
        <a href="/search" class="${activePage === 'search' ? 'active' : ''}">Find Overlap</a>
        <a href="/profile/edit" class="${activePage === 'profile' ? 'active' : ''}">Profile</a>
        <button class="btn-logout" id="logoutBtn">Logout</button>
      </div>
    `;
    document.body.prepend(nav);

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    });
  }

  window.RiftNav = { checkAuth, createNav };
})();
