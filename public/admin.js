const nameEl = document.querySelector('#restaurant-name');
const qrEl = document.querySelector('#qr');
const qrLink = document.querySelector('#qr-link');
const prizeRows = document.querySelector('#prize-rows');
const addPrizeBtn = document.querySelector('#add-prize');
const suggestPrizesBtn = document.querySelector('#suggest-prizes');
const savePrizesBtn = document.querySelector('#save-prizes');
const saveStatus = document.querySelector('#save-status');
const spinList = document.querySelector('#spin-list');
const restaurantForm = document.querySelector('#restaurant-form');
const themeSelect = document.querySelector('#theme-select');
const brandLogoAdmin = document.querySelector('#brand-logo-admin');
const subscriptionStatusEl = document.querySelector('#subscription-status');
const subscribeBtn = document.querySelector('#subscribe-btn');
const requestBtn = document.querySelector('#request-btn');
const manageBtn = document.querySelector('#manage-btn');
const subscribeStatus = document.querySelector('#subscribe-status');
const subscriptionBanner = document.querySelector('#subscription-banner');
const logoutBtn = document.querySelector('#logout-btn');
const pendingList = document.querySelector('#pending-list');
const retryOn = document.querySelector('#retry-on');
const retryOff = document.querySelector('#retry-off');
const retryProbability = document.querySelector('#retry-probability');
const manualPay = document.querySelector('#manual-pay');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
const suggestionPanel = document.querySelector('#suggestion-panel');
const suggestionList = document.querySelector('#suggestion-list');
const closeSuggestionsBtn = document.querySelector('#close-suggestions');
const posterEl = document.querySelector('#poster');
const posterQr = document.querySelector('#poster-qr');
const posterName = document.querySelector('#poster-name');
const posterLogo = document.querySelector('#poster-logo');
const posterPrintBtn = document.querySelector('#poster-print');
const posterThemeSelect = document.querySelector('#poster-theme');
const posterSaveBtn = document.querySelector('#poster-save');

let restaurantData = null;
let isEditing = false;
let stripeEnabled = true;
let manualOnly = false;

function setActiveTab(name) {
  tabButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === name);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle('hidden', panel.getAttribute('data-panel') !== name);
  });
  localStorage.setItem('adminTab', name);
}

function formatDate(ts) {
  if (!ts) return '--';
  return new Date(ts).toLocaleString('fr-FR');
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
    <input type="text" placeholder="Ex: Cadeau surprise" value="${prize.label || ''}" />
    <input type="number" min="0" step="1" value="${prize.probability || 0}" />
    <button class="link danger" type="button">Supprimer</button>
  `;

  row.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', markEditing);
  });

  row.querySelector('button').addEventListener('click', () => {
    row.remove();
    markEditing();
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

function renderSuggestedPrizes() {
  if (!suggestionPanel || !suggestionList) return;
  const suggestions = [
    'Remise -10% sur la prochaine visite',
    'Cadeau surprise',
    'Produit offert',
    'Service premium offert',
    'Livraison offerte',
    'Accessoire offert',
    'Bon d achat 5 EUR',
    'Points fidelite x2',
    'Emballage cadeau offert'
  ];
  suggestionPanel.classList.remove('hidden');
  suggestionList.innerHTML = '';
  suggestions.forEach((label) => {
    const row = document.createElement('div');
    row.className = 'suggestion-item';
    const text = document.createElement('span');
    text.textContent = label;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ghost';
    btn.textContent = 'Ajouter';
    btn.addEventListener('click', () => {
      prizeRows.appendChild(createPrizeRow({ label: label, probability: 10 }));
      markEditing();
    });
    row.append(text, btn);
    suggestionList.appendChild(row);
  });
}

function setRetryActive(isActive) {
  if (!retryOn || !retryOff || !retryProbability) return;
  retryOn.classList.toggle('active', isActive);
  retryOff.classList.toggle('active', !isActive);
  retryProbability.disabled = !isActive;
  retryProbability.value = isActive ? retryProbability.value : 0;
}

function applyPosterTheme(themeId) {
  if (!posterEl) return;
  posterEl.classList.remove('theme-neon', 'theme-dark', 'theme-sunset', 'theme-nuit');
  posterEl.classList.add('theme-' + (themeId || 'neon'));
}

function renderPoster(restaurant, qrUrl) {
  if (!posterEl || !posterQr || !posterName) return;
  posterName.textContent = restaurant.name || '--';
  applyPosterTheme(restaurant.posterThemeId);
  if (posterLogo) {
    if (restaurant.logoUrl) {
      posterLogo.src = restaurant.logoUrl;
      posterLogo.classList.remove('hidden');
    } else {
      posterLogo.classList.add('hidden');
    }
  }
  posterQr.innerHTML = '';
  // eslint-disable-next-line no-undef
  new QRCode(posterQr, {
    text: qrUrl,
    width: 240,
    height: 240,
    colorDark: '#0b0f19',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
}

function renderSubscription(status) {
  if (!subscriptionStatusEl || !subscribeBtn) return;
  const normalized = status === 'active' ? 'active' : (status === 'pending' ? 'pending' : 'inactive');
  subscriptionStatusEl.textContent = normalized;
  subscriptionStatusEl.classList.remove('active', 'inactive', 'pending');
  subscriptionStatusEl.classList.add(normalized);
  subscribeBtn.disabled = normalized !== 'inactive' || !stripeEnabled;
  if (requestBtn) {
    requestBtn.disabled = normalized !== 'inactive';
  }
  if (manageBtn) {
    manageBtn.disabled = normalized !== 'active' || !stripeEnabled;
  }
  if (subscriptionBanner) {
    subscriptionBanner.classList.toggle('hidden', normalized === 'active');
  }

  const disableControls = normalized !== 'active';
  addPrizeBtn.disabled = disableControls;
  savePrizesBtn.disabled = disableControls;
  if (retryOn) retryOn.disabled = disableControls;
  if (retryOff) retryOff.disabled = disableControls;
  if (retryProbability) retryProbability.disabled = disableControls;

  Array.from(restaurantForm.elements).forEach((el) => {
    if (el.tagName === 'BUTTON') return;
    el.disabled = disableControls;
  });
}

async function loadAdmin() {
  if (isEditing) return;
  const response = await fetch('/api/admin/me');
  if (!response.ok) {
    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }
    nameEl.textContent = 'Acces invalide.';
    return;
  }
  const data = await response.json();
  stripeEnabled = !data.billing || data.billing.stripeEnabled;
  manualOnly = Boolean(data.billing && data.billing.manualOnly);
  if (!stripeEnabled) {
    if (subscribeBtn) subscribeBtn.style.display = 'none';
    if (manageBtn) manageBtn.style.display = 'none';
  } else {
    if (subscribeBtn) subscribeBtn.style.display = '';
    if (manageBtn) manageBtn.style.display = '';
  }
  if (manualPay) {
    manualPay.classList.toggle('hidden', !manualOnly);
    const ref = document.querySelector('#payment-reference');
    if (ref) {
      ref.textContent = 'R-' + data.restaurant.slug;
    }
  }

  restaurantData = data.restaurant;
  nameEl.textContent = data.restaurant.name;
  restaurantForm.elements.name.value = data.restaurant.name;
  restaurantForm.elements.email.value = data.restaurant.email;
  restaurantForm.elements.reviewUrl.value = data.restaurant.reviewUrl || '';
  if (themeSelect) {
    themeSelect.value = data.restaurant.themeId || 'neon';
  }
  if (posterThemeSelect) {
    posterThemeSelect.value = data.restaurant.posterThemeId || 'neon';
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
  if (qrLink) {
    qrLink.href = qrUrl;
    qrLink.textContent = qrUrl;
  }
  if (qrEl) {
    qrEl.innerHTML = '';
    // eslint-disable-next-line no-undef
    const size = Math.max(120, Math.min(220, qrEl.clientWidth || 180));
    new QRCode(qrEl, {
      text: qrUrl,
      width: size,
      height: size,
      colorDark: '#0b0f19',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
  }

  renderPoster(data.restaurant, qrUrl);
  renderSubscription(data.restaurant.subscriptionStatus || 'inactive');
  renderPrizes(data.prizes || []);
  renderSpins(data.spins || []);

  const retryPrize = (data.prizes || []).find((p) => p.isRetry);
  if (retryPrize && retryPrize.probability > 0) {
    if (retryProbability) retryProbability.value = retryPrize.probability;
    setRetryActive(true);
  } else {
    if (retryProbability) retryProbability.value = 0;
    setRetryActive(false);
  }

  isEditing = false;
}

if (addPrizeBtn) {
  addPrizeBtn.addEventListener('click', () => {
    prizeRows.appendChild(createPrizeRow({ label: '', probability: 0 }));
    markEditing();
  });
}

if (suggestPrizesBtn) {
  suggestPrizesBtn.addEventListener('click', () => {
    renderSuggestedPrizes();
  });
}

if (closeSuggestionsBtn) {
  closeSuggestionsBtn.addEventListener('click', () => {
    if (suggestionPanel) suggestionPanel.classList.add('hidden');
  });
}

if (posterThemeSelect) {
  posterThemeSelect.addEventListener('change', () => {
    applyPosterTheme(posterThemeSelect.value);
  });
}

if (posterSaveBtn) {
  posterSaveBtn.addEventListener('click', async () => {
    if (!posterThemeSelect) return;
    await submitRestaurantUpdate({ posterThemeId: posterThemeSelect.value });
  });
}

if (savePrizesBtn) {
  savePrizesBtn.addEventListener('click', async () => {
    if (!restaurantData) return;
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
}

if (restaurantForm) {
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
}

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

if (posterPrintBtn && posterEl) {
  posterPrintBtn.addEventListener('click', () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Decor QR</title><link rel="stylesheet" href="/styles.css"/><style>body{font-family:Sora,Arial,sans-serif;margin:24px;background:#f5f7fb;}</style></head><body>${posterEl.outerHTML}<script>window.onload=()=>window.print();</script></body></html>`;
    win.document.write(html);
    win.document.close();
  });
}

if (subscribeBtn) {
  subscribeBtn.addEventListener('click', async () => {
    if (!stripeEnabled) return;
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

if (requestBtn) {
  requestBtn.addEventListener('click', async () => {
    subscribeStatus.textContent = 'Demande d\'activation envoyee...';
    const response = await fetch('/api/admin/request-activation', { method: 'POST' });
    if (!response.ok) {
      subscribeStatus.textContent = 'Impossible d\'envoyer la demande.';
      return;
    }
    subscribeStatus.textContent = 'Demande envoyee. Vous serez active bientot.';
    loadAdmin();
  });
}

if (manageBtn) {
  manageBtn.addEventListener('click', async () => {
    if (!stripeEnabled) return;
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
        <strong>${item.customerName || 'Client'} - ${item.prizeLabel}</strong>
        <span>${new Date(item.createdAt).toLocaleString('fr-FR')}</span>
      </div>
      <div class="pending-actions">
        <button class="btn ghost" data-action="approve" data-id="${item.id}">Valider</button>
        <button class="btn ghost danger" data-action="delete" data-id="${item.id}">Supprimer</button>
      </div>
    `;
    row.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.getAttribute('data-action');
        if (action === 'approve') {
          await fetch(`/api/admin/approve/${item.id}`, { method: 'POST' });
        }
        if (action === 'delete') {
          const ok = confirm('Supprimer cette demande ?');
          if (!ok) return;
          await fetch(`/api/admin/pending/${item.id}`, { method: 'DELETE' });
        }
        loadPending();
        loadAdmin();
      });
    });
    pendingList.appendChild(row);
  });
  if (hasNew) {
    alert('Nouvelle demande de validation');
    const audio = new Audio('/notify.mp3');
    audio.play().catch(() => {});
  }
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    setActiveTab(btn.getAttribute('data-tab'));
  });
});

const savedTab = localStorage.getItem('adminTab') || 'wheel';
setActiveTab(savedTab);

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










