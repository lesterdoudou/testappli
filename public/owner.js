const table = document.querySelector('#owner-table');
const logoutBtn = document.querySelector('#owner-logout');

function formatDate(ts) {
  if (!ts) return '--';
  return new Date(ts).toLocaleDateString('fr-FR');
}

function rowTemplate(item) {
  return `
    <div class="table-row header">
      <span>Nom</span>
      <span>Email</span>
      <span>TVA</span>
      <span>Inscription</span>
      <span>Abonnement</span>
      <span></span>
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
    <button class="link" type="button">Basculer</button>
  `;
  row.querySelector('button').addEventListener('click', async () => {
    const next = item.subscriptionStatus === 'active' ? 'inactive' : 'active';
    const response = await fetch('/api/owner/subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, status: next })
    });
    if (response.ok) {
      loadOwner();
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
  table.innerHTML = rowTemplate();
  data.restaurants.forEach((item) => {
    table.appendChild(createRow(item));
  });
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/owner/logout', { method: 'POST' });
  window.location.href = '/owner';
});

loadOwner();
