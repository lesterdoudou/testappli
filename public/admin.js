const nameEl = document.querySelector('#restaurant-name');
const qrEl = document.querySelector('#qr');
const qrLink = document.querySelector('#qr-link');
const prizeRows = document.querySelector('#prize-rows');
const addPrizeBtn = document.querySelector('#add-prize');
const savePrizesBtn = document.querySelector('#save-prizes');
const saveStatus = document.querySelector('#save-status');
const spinList = document.querySelector('#spin-list');
const restaurantForm = document.querySelector('#restaurant-form');
const themeSelect = document.querySelector('#theme-select');
const brandLogoAdmin = document.querySelector('#brand-logo-admin');
const subscriptionStatusEl = document.querySelector('#subscription-status');
const subscribeBtn = document.querySelector('#subscribe-btn');
const manageBtn = document.querySelector('#manage-btn');
const subscribeStatus = document.querySelector('#subscribe-status');
const subscriptionBanner = document.querySelector('#subscription-banner');
const logoutBtn = document.querySelector('#logout-btn');
const pendingList = document.querySelector('#pending-list');
const retryOn = document.querySelector('#retry-on');
const retryOff = document.querySelector('#retry-off');
const retryProbability = document.querySelector('#retry-probability');

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
  prizes
    .filter((prize) => !prize.isRetry)
    .forEach((prize) => prizeRows.appendChild(createPrizeRow(prize)));
}

function setRetryActive(isActive) {
  if (!retryOn || !retryOff || !retryProbability) return;
  retryOn.classList.toggle('active', isActive);
  retryOff.classList.toggle('active', !isActive);
  retryProbability.disabled = !isActive;
  retryProbability.value = isActive ? retryProbability.value : 0;
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
  if (themeSelect) {
    themeSelect.value = data.restaurant.themeId || 'neon';
  }
  if (brandLogoAdmin) {
    if (data.restaurant.logoUrl) {
      brandLogoAdmin.src = data.restaurant.logoUrl;
      brandLogoAdmin.classList.remove('hidden');
    } else {
      brandLogoAdmin.classList.add('hidden');
    }
  }

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
  if (retryOn && retryOff && retryProbability) {
    const retryPrize = (data.prizes || []).find((p) => p.isRetry);
    retryProbability.value = retryPrize ? Number(retryPrize.probability || 0) : 0;
    setRetryActive(Boolean(retryPrize));
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
  if (retryOn && retryOff && retryProbability && retryOn.classList.contains('active')) {
    prizes.push({
      label: 'Retente ta chance',
      probability: retryProbability.value,
      isRetry: true
    });
  }

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
    reviewUrl: restaurantForm.elements.reviewUrl.value,
    themeId: themeSelect ? themeSelect.value : 'neon'
  };
  const logoFile = restaurantForm.elements.logo && restaurantForm.elements.logo.files[0];
  if (logoFile) {
    if (logoFile.size > 600 * 1024) {
      alert('Logo trop lourd (max 600 KB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      payload.logoDataUrl = reader.result;
      await submitRestaurantUpdate(payload);
    };
    reader.readAsDataURL(logoFile);
    return;
  }

  await submitRestaurantUpdate(payload);
});

async function submitRestaurantUpdate(payload) {
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
}

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

async function loadPending() {
  if (!pendingList) return;
  const response = await fetch('/api/admin/pending');
  if (!response.ok) {
    pendingList.innerHTML = '<p class="muted">Aucune demande.</p>';
    return;
  }
  const data = await response.json();
  const currentIds = Array.from(pendingList.querySelectorAll('[data-id]')).map((el) => el.getAttribute('data-id'));
  const newIds = data.items.map((item) => item.id);
  const hasNew = newIds.some((id) => !currentIds.includes(id));
  pendingList.innerHTML = '';
  if (!data.items.length) {
    pendingList.innerHTML = '<p class="muted">Aucune demande.</p>';
    return;
  }
  data.items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'spin-item';
    row.innerHTML = `
      <div>
        <strong>${item.customerName || 'Client'} · ${item.prizeLabel}</strong>
        <span>${new Date(item.createdAt).toLocaleString('fr-FR')}</span>
      </div>
      <button class="btn ghost" data-id="${item.id}">Valider</button>
    `;
    row.querySelector('button').addEventListener('click', async () => {
      await fetch(`/api/admin/approve/${item.id}`, { method: 'POST' });
      loadPending();
      loadAdmin();
    });
    pendingList.appendChild(row);
  });
  if (hasNew) {
    alert('Nouvelle demande de validation');
    const audio = new Audio('/notify.mp3');
    audio.play().catch(() => {});
  }
}

if (retryOn && retryOff) {
  retryOn.addEventListener('click', () => setRetryActive(true));
  retryOff.addEventListener('click', () => setRetryActive(false));
}

const params = new URLSearchParams(window.location.search);
if (params.get('billing') === 'success') {
  subscribeStatus.textContent = 'Paiement recu. Votre abonnement va etre active.';
}
if (params.get('billing') === 'cancel') {
  subscribeStatus.textContent = 'Paiement annule.';
}

setInterval(loadAdmin, 10000);
setInterval(loadPending, 5000);
loadAdmin();
loadPending();
