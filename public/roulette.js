const slug = window.location.pathname.split('/').pop();
const titleEl = document.querySelector('#restaurant-title');
const reviewLink = document.querySelector('#review-link');
const reviewYes = document.querySelector('#review-yes');
const reviewNo = document.querySelector('#review-no');
const customerNameInput = document.querySelector('#customer-name');
const spinBtn = document.querySelector('#spin-btn');
const resultEl = document.querySelector('#spin-result');
const modal = document.querySelector('#result-modal');
const modalResult = document.querySelector('#modal-result');
const modalClose = document.querySelector('#modal-close');
const canvas = document.querySelector('#wheel');
const ctx = canvas.getContext('2d');

let wheelPrizes = [];
let currentRotation = 0;
let spinning = false;
let claimId = null;
let pollTimer = null;
let reviewConfirmed = false;
let pendingPrizeText = '';

const palette = ['#ffb703', '#fb8500', '#219ebc', '#8ecae6', '#ff006e', '#8338ec'];
const SPIN_DURATION = 7000;

function applyTheme(themeId) {
  document.body.classList.remove('theme-neon', 'theme-sunset', 'theme-mint', 'theme-noir');
  document.body.classList.add(`theme-${themeId}`);
}

function setReviewState(isConfirmed) {
  reviewConfirmed = isConfirmed;
  if (reviewYes) reviewYes.classList.toggle('active', isConfirmed);
  if (reviewNo) reviewNo.classList.toggle('active', !isConfirmed);
}

function wrapLabel(text, maxWidth, maxLines = 3) {
  const words = String(text || '').split(' ');
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

function buildColors(count) {
  const colors = [];
  let cursor = 0;
  for (let i = 0; i < count; i += 1) {
    let color = palette[cursor % palette.length];
    if (i > 0 && color === colors[i - 1]) {
      cursor += 1;
      color = palette[cursor % palette.length];
    }
    colors.push(color);
    cursor += 1;
  }
  if (colors.length > 1 && colors[0] === colors[colors.length - 1]) {
    const lastIndex = colors.length - 1;
    const alt = palette[(cursor + 1) % palette.length];
    colors[lastIndex] = alt === colors[colors.length - 2] ? palette[(cursor + 2) % palette.length] : alt;
  }
  return colors;
}

function drawWheel(rotation = 0) {
  const { width, height } = canvas;
  const radius = width / 2;
  ctx.clearRect(0, 0, width, height);

  if (!wheelPrizes.length) {
    ctx.fillStyle = '#d9dbe7';
    ctx.beginPath();
    ctx.arc(radius, radius, radius - 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0e0f19';
    ctx.font = '16px "Sora", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Aucun cadeau', radius, radius);
    return;
  }

  const angleStep = (Math.PI * 2) / wheelPrizes.length;
  const densityFactor = Math.max(0.55, Math.min(1, 7 / wheelPrizes.length));
  const textRadius = radius * 0.56;
  const maxWidth = radius * 0.42;
  let fontSize = Math.floor(Math.max(11, Math.min(18, radius * 0.11)) * densityFactor);
  for (let attempts = 0; attempts < 6; attempts += 1) {
    ctx.font = `700 ${fontSize}px "Sora", sans-serif`;
    const fitsAll = wheelPrizes.every((prize) => {
      const lines = wrapLabel(prize.label, maxWidth, 3);
      if (!lines.length) return true;
      return lines.length <= 3 && lines.every((line) => ctx.measureText(line).width <= maxWidth);
    });
    if (fitsAll) break;
    fontSize = Math.max(9, fontSize - 2);
  }

  const colors = buildColors(wheelPrizes.length);
  wheelPrizes.forEach((prize, index) => {
    const start = rotation + index * angleStep;
    const end = start + angleStep;
    ctx.beginPath();
    ctx.moveTo(radius, radius);
    ctx.arc(radius, radius, radius - 4, start, end);
    ctx.fillStyle = colors[index];
    ctx.fill();

    ctx.save();
    ctx.translate(radius, radius);
    const midAngle = start + angleStep / 2;
    ctx.rotate(midAngle);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0e0f19';

    let fontSize = Math.floor(Math.max(11, Math.min(18, radius * 0.11)) * densityFactor);
    ctx.font = `700 ${fontSize}px "Sora", sans-serif`;
    const lines = wrapLabel(prize.label, maxWidth, 3);
    // Keep text readable (not upside down)
    if (midAngle > Math.PI / 2 && midAngle < Math.PI * 1.5) {
      ctx.rotate(Math.PI);
    }

    const lineHeight = fontSize + 2;
    const startY = lines.length === 1 ? 0 : lines.length === 2 ? -lineHeight / 2 : -lineHeight;
    const textRadiusAdjusted = lines.length >= 3 ? textRadius * 0.92 : textRadius;

    lines.forEach((line, i) => {
      ctx.fillText(line, textRadiusAdjusted, startY + i * lineHeight);
    });

    ctx.restore();
  });
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function spinToIndex(index, onComplete) {
  if (!wheelPrizes.length) return;
  const angleStep = (Math.PI * 2) / wheelPrizes.length;
  const targetAngle = Math.PI * 1.5 - (index + 0.5) * angleStep;
  const spins = 6 * Math.PI * 2;
  const start = currentRotation;
  const end = targetAngle + spins;
  const startTime = performance.now();

  function animate(now) {
    const progress = Math.min((now - startTime) / SPIN_DURATION, 1);
    const eased = easeOutBack(progress);
    currentRotation = start + (end - start) * eased;
    drawWheel(currentRotation);
    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      spinning = false;
      spinBtn.disabled = false;
      if (typeof onComplete === 'function') {
        onComplete();
      }
    }
  }

  requestAnimationFrame(animate);
}

function openResultModal(text) {
  if (!modal || !modalResult) return;
  modalResult.textContent = text;
  modal.classList.remove('hidden');
}

function closeResultModal() {
  if (!modal) return;
  modal.classList.add('hidden');
}

function canSpinToday() {
  const key = `roulette-spin-${slug}`;
  const last = localStorage.getItem(key);
  const today = new Date().toISOString().slice(0, 10);
  return last !== today;
}

function markSpun() {
  const key = `roulette-spin-${slug}`;
  const today = new Date().toISOString().slice(0, 10);
  localStorage.setItem(key, today);
}

async function loadRoulette() {
  const response = await fetch(`/api/restaurant/${slug}`);
  if (!response.ok) {
    titleEl.textContent = 'Restaurant introuvable.';
    spinBtn.disabled = true;
    return;
  }

  const data = await response.json();
  const subscriptionStatus = data.restaurant.subscriptionStatus || 'inactive';
  const themeId = data.restaurant.themeId || 'neon';
  applyTheme(themeId);

  const brandLogoClient = document.querySelector('#brand-logo-client');
  if (brandLogoClient) {
    if (data.restaurant.logoUrl) {
      brandLogoClient.src = data.restaurant.logoUrl;
      brandLogoClient.classList.remove('hidden');
    } else {
      brandLogoClient.classList.add('hidden');
    }
  }

  titleEl.textContent = data.restaurant.name;
  reviewLink.href = data.restaurant.reviewUrl || '#';
  reviewLink.classList.toggle('disabled', !data.restaurant.reviewUrl);
  if (!data.restaurant.reviewUrl) {
    reviewLink.textContent = 'Lien Google Review manquant';
  }

  if (subscriptionStatus !== 'active') {
    spinBtn.disabled = true;
    resultEl.textContent = 'Abonnement requis pour jouer.';
  }

  wheelPrizes = data.prizes.filter((p) => p.probability > 0);
  drawWheel(currentRotation);

  if (subscriptionStatus === 'active') {
    spinBtn.disabled = !canSpinToday();
  }
  if (!canSpinToday()) {
    resultEl.textContent = 'Vous avez deja tourne aujourd\'hui.';
  }
}

async function pollClaim() {
  if (!claimId) return;
  const response = await fetch(`/api/claim/${claimId}`);
  if (!response.ok) return;
  const data = await response.json();
  if (data.status === 'expired') {
    clearInterval(pollTimer);
    pollTimer = null;
    claimId = null;
    resultEl.textContent = 'Demande expiree. Reessayez.';
    spinBtn.disabled = false;
    spinning = false;
    return;
  }
  if (data.status === 'approved') {
    clearInterval(pollTimer);
    pollTimer = null;
    claimId = null;
    const index = wheelPrizes.findIndex((p) => p.id === data.prizeId);
    const targetIndex = index >= 0 ? index : Math.floor(Math.random() * Math.max(1, wheelPrizes.length));
    pendingPrizeText = data.prize;
    resultEl.textContent = 'La roue tourne...';
    spinToIndex(targetIndex, () => {
      resultEl.textContent = pendingPrizeText;
      openResultModal(pendingPrizeText);
      pendingPrizeText = '';
    });
    markSpun();
  }
}

spinBtn.addEventListener('click', async () => {
  if (spinning) return;
  if (!reviewConfirmed) {
    alert('Merci de confirmer que vous avez laisse un avis.');
    return;
  }

  if (!canSpinToday()) {
    resultEl.textContent = 'Vous avez deja tourne aujourd\'hui.';
    return;
  }

  const customerName = (customerNameInput && customerNameInput.value || '').trim();
  if (!customerName) {
    alert('Merci d\'indiquer votre prenom.');
    return;
  }

  spinBtn.disabled = true;
  spinning = true;
  resultEl.textContent = 'Attente de validation du commercant...';

  const response = await fetch(`/api/claim/${slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewConfirmed: true, customerName })
  });

  if (!response.ok) {
    resultEl.textContent = 'Erreur lors de la demande.';
    spinBtn.disabled = false;
    spinning = false;
    return;
  }

  const data = await response.json();
  claimId = data.claimId;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollClaim, 3000);
});

if (modalClose) {
  modalClose.addEventListener('click', closeResultModal);
}

if (modal) {
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeResultModal();
  });
}

if (reviewYes && reviewNo) {
  reviewYes.addEventListener('click', () => setReviewState(true));
  reviewNo.addEventListener('click', () => setReviewState(false));
  setReviewState(false);
}

loadRoulette();
