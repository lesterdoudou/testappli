const table = document.querySelector('#owner-table');
const logoutBtn = document.querySelector('#owner-logout');
const exportBtn = document.querySelector('#export-csv');

function formatDate(ts) {
  if (!ts) return '--';
  return new Date(ts).toLocaleDateString('fr-FR');
}

function headerTemplate() {
  return `
    <div class="table-row header">
      <span>Nom</span>
      <span>Email</span>
      <span>TVA</span>
      <span>Inscription</span>
      <span>Abonnement</span>
      <span>Actions</span>
    </div>
  `;
}

function statsTemplate(stats) {
  return `
    <div class="stats">
      <div><strong>Total</strong><span>${stats.total}</span></div>
      <div><strong>Jour</strong><span>${stats.day}</span></div>
      <div><strong>Semaine</strong><span>${stats.week}</span></div>
      <div><strong>Mois</strong><span>${stats.month}</span></div>
    </div>
  `;
}

function createRow(item) {
  const row = document.createElement('div');
  row.className = 'table-row owner';
  row.innerHTML = `
    <span>${item.name}</span>
    <span>${item.email}</span>
    <span>${item.vat}</span>
    <span>${formatDate(item.createdAt)}</span>
    <span class="badge ${item.subscriptionStatus}">${item.subscriptionStatus}</span>
    <div class="owner-actions">
      <button class="link" data-action="toggle">Basculer</button>
      <button class="link" data-action="stats">Stats</button>
      <button class="link danger" data-action="delete">Supprimer</button>
    </div>
  `;

  row.addEventListener('click', async (event) => {
    const action = event.target.getAttribute('data-action');
    if (!action) return;

    if (action === 'toggle') {
      const next = item.subscriptionStatus === 'active' ? 'inactive' : 'active';
      const response = await fetch('/api/owner/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, status: next })
      });
      if (response.ok) {
        loadOwner();
      }
    }

    if (action === 'stats') {
      let statsRow = row.nextElementSibling;
      if (statsRow && statsRow.classList.contains('stats-row')) {
        statsRow.remove();
        return;
      }
      const response = await fetch(`/api/owner/stats/${item.id}`);
      if (!response.ok) return;
      const stats = await response.json();
      statsRow = document.createElement('div');
      statsRow.className = 'stats-row';
      statsRow.innerHTML = statsTemplate(stats);
      row.insertAdjacentElement('afterend', statsRow);
    }

    if (action === 'delete') {
      const ok = confirm(`Supprimer ${item.name} ?`);
      if (!ok) return;
      const response = await fetch(`/api/owner/restaurant/${item.id}`, { method: 'DELETE' });
      if (response.ok) {
        loadOwner();
      }
    }
  });

  return row;
}

async function loadOwner() {
  const response = await fetch('/api/owner/restaurants');
  if (!response.ok) {
    table.innerHTML = '<p class="muted">Acces refuse.</p>';
    return;
  }
  const data = await response.json();
  table.innerHTML = headerTemplate();
  data.restaurants.forEach((item) => {
    table.appendChild(createRow(item));
  });
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/owner/logout', { method: 'POST' });
  window.location.href = '/owner';
});

if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    window.location.href = '/api/owner/restaurants.csv';
  });
}

loadOwner();
