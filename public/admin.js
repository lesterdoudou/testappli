const nameEl = document.querySelector('#restaurant-name');
const qrEl = document.querySelector('#qr');
const qrLink = document.querySelector('#qr-link');
const prizeRows = document.querySelector('#prize-rows');
const addPrizeBtn = document.querySelector('#add-prize');
const savePrizesBtn = document.querySelector('#save-prizes');
const saveStatus = document.querySelector('#save-status');
const spinList = document.querySelector('#spin-list');
const restaurantForm = document.querySelector('#restaurant-form');
const subscriptionStatusEl = document.querySelector('#subscription-status');
const subscribeBtn = document.querySelector('#subscribe-btn');
const manageBtn = document.querySelector('#manage-btn');
const subscribeStatus = document.querySelector('#subscribe-status');
const subscriptionBanner = document.querySelector('#subscription-banner');
const logoutBtn = document.querySelector('#logout-btn');
const validationCodeEl = document.querySelector('#validation-code');
const rotateCodeBtn = document.querySelector('#rotate-code');

let restaurantData = null;
let isEditing = false;

function formatDate(ts) {
  const date = new Date(ts);
  return date.toLocaleString('fr-FR');
}

function markEditing() {
  isEditing = true;
}

function renderSpins(spins) {
  spinList.innerHTML = '';
  if (!spins.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Aucune roulette pour le moment.';
    spinList.appendChild(empty);
    return;
  }
  spins.forEach((spin) => {
    const item = document.createElement('div');
    item.className = 'spin-item';
    item.innerHTML = `
      <div>
        <strong>${spin.prizeLabel}</strong>
        <span>${spin.reviewConfirmed ? 'Avis confirme' : 'Avis non confirme'}</span>
      </div>
      <span class="muted">${formatDate(spin.createdAt)}</span>
    `;
    spinList.appendChild(item);
  });
}

function createPrizeRow(prize = {}) {
  const row = document.createElement('div');
  row.className = 'table-row';
  row.innerHTML = `
    <input type="text" placeholder="Ex: Boisson offerte" value="${prize.label || ''}" />
    <input type="number" min="0" step="1" value="${Number(prize.probability || 0)}" />
    <button type="button" class="link danger">Supprimer</button>
  `;
  row.querySelector('button').addEventListener('click', () => {
    row.remove();
    markEditing();
  });
  row.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', markEditing);
  });
  return row;
}

function renderPrizes(prizes) {
  prizeRows.innerHTML = '';
  if (!prizes.length) {
    prizeRows.appendChild(createPrizeRow({ label: '', probability: 0 }));
    return;
  }
  prizes.forEach((prize) => prizeRows.appendChild(createPrizeRow(prize)));
}

function renderSubscription(status) {
  if (!subscriptionStatusEl || !subscribeBtn) return;
  const normalized = status === 'active' ? 'active' : 'inactive';
  subscriptionStatusEl.textContent = normalized;
  subscriptionStatusEl.classList.remove('active', 'inactive');
  subscriptionStatusEl.classList.add(normalized);
  subscribeBtn.disabled = normalized === 'active';
  if (manageBtn) {
    manageBtn.disabled = normalized !== 'active';
  }
  if (subscriptionBanner) {
    subscriptionBanner.classList.toggle('hidden', normalized === 'active');
  }
  const disableControls = normalized !== 'active';
  addPrizeBtn.disabled = disableControls;
  savePrizesBtn.disabled = disableControls;
  Array.from(restaurantForm.elements).forEach((el) => {
    if (el.tagName === 'BUTTON') return;
    el.disabled = disableControls;
  });
}

async function loadAdmin() {
  if (isEditing) {
    return;
  }
  const response = await fetch('/api/admin/me');
  if (!response.ok) {
    nameEl.textContent = 'Acces invalide.';
    return;
  }

  const data = await response.json();
  restaurantData = data.restaurant;

  nameEl.textContent = data.restaurant.name;
  restaurantForm.elements.name.value = data.restaurant.name;
  restaurantForm.elements.email.value = data.restaurant.email;
  restaurantForm.elements.reviewUrl.value = data.restaurant.reviewUrl || '';

  const qrUrl = `${window.location.origin}/r/${data.restaurant.slug}`;
  qrLink.href = qrUrl;
  qrLink.textContent = qrUrl;

  qrEl.innerHTML = '';
  new QRCode(qrEl, {
    text: qrUrl,
    width: 180,
    height: 180,
    colorDark: '#0e0f19',
    colorLight: '#ffffff'
  });

  renderPrizes(data.prizes);
  renderSpins(data.spins);
  renderSubscription(data.restaurant.subscriptionStatus || 'inactive');
  if (validationCodeEl) {
    validationCodeEl.textContent = data.restaurant.validationCode || '------';
  }
}

addPrizeBtn.addEventListener('click', () => {
  prizeRows.appendChild(createPrizeRow({ label: '', probability: 0 }));
  markEditing();
});

savePrizesBtn.addEventListener('click', async () => {
  const rows = Array.from(prizeRows.querySelectorAll('.table-row'));
  const prizes = rows.map((row) => {
    const inputs = row.querySelectorAll('input');
    return {
      label: inputs[0].value,
      probability: inputs[1].value
    };
  });

  saveStatus.textContent = 'Enregistrement...';
  const response = await fetch('/api/admin/prizes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prizes })
  });

  if (!response.ok) {
    if (response.status === 402) {
      saveStatus.textContent = 'Abonnement inactif.';
    } else {
      saveStatus.textContent = 'Erreur lors de l\'enregistrement.';
    }
    return;
  }
  saveStatus.textContent = 'Roue mise a jour.';
  setTimeout(() => (saveStatus.textContent = ''), 2000);
  isEditing = false;
  loadAdmin();
});

restaurantForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    name: restaurantForm.elements.name.value,
    email: restaurantForm.elements.email.value,
    reviewUrl: restaurantForm.elements.reviewUrl.value
  };

  const response = await fetch('/api/admin/restaurant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    if (response.status === 402) {
      alert('Abonnement inactif.');
    } else {
      alert('Impossible de mettre a jour.');
    }
    return;
  }

  loadAdmin();
});

if (subscribeBtn) {
  subscribeBtn.addEventListener('click', async () => {
    subscribeStatus.textContent = 'Redirection vers Stripe...';
    const response = await fetch('/api/billing/checkout', { method: 'POST' });
    if (!response.ok) {
      subscribeStatus.textContent = 'Stripe non configure.';
      return;
    }
    const data = await response.json();
    window.location.href = data.url;
  });
}

if (manageBtn) {
  manageBtn.addEventListener('click', async () => {
    subscribeStatus.textContent = 'Ouverture du portail Stripe...';
    const response = await fetch('/api/billing/portal', { method: 'POST' });
    if (!response.ok) {
      subscribeStatus.textContent = 'Portail Stripe indisponible.';
      return;
    }
    const data = await response.json();
    window.location.href = data.url;
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });
}

if (rotateCodeBtn && validationCodeEl) {
  rotateCodeBtn.addEventListener('click', async () => {
    rotateCodeBtn.disabled = true;
    const response = await fetch('/api/admin/validation-code/rotate', { method: 'POST' });
    if (!response.ok) {
      rotateCodeBtn.disabled = false;
      return;
    }
    const data = await response.json();
    validationCodeEl.textContent = data.code || '------';
    rotateCodeBtn.disabled = false;
  });
}

const params = new URLSearchParams(window.location.search);
if (params.get('billing') === 'success') {
  subscribeStatus.textContent = 'Paiement recu. Votre abonnement va etre active.';
}
if (params.get('billing') === 'cancel') {
  subscribeStatus.textContent = 'Paiement annule.';
}

setInterval(loadAdmin, 10000);
loadAdmin();
