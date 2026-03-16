const slug = window.location.pathname.split('/').pop();
const titleEl = document.querySelector('#restaurant-title');
const reviewLink = document.querySelector('#review-link');
const reviewCheck = document.querySelector('#review-check');
const validationCodeInput = document.querySelector('#validation-code');
const spinBtn = document.querySelector('#spin-btn');
const resultEl = document.querySelector('#spin-result');
const canvas = document.querySelector('#wheel');
const ctx = canvas.getContext('2d');

let wheelPrizes = [];
let currentRotation = 0;
let spinning = false;

const palette = ['#ffb703', '#fb8500', '#219ebc', '#8ecae6', '#ff006e', '#8338ec'];
const SPIN_DURATION = 2600;

function applyTheme(themeId) {
  document.body.classList.remove('theme-neon', 'theme-sunset', 'theme-mint', 'theme-noir');
  document.body.classList.add(`theme-${themeId}`);
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

  wheelPrizes.forEach((prize, index) => {
    const start = rotation + index * angleStep;
    const end = start + angleStep;
    ctx.beginPath();
    ctx.moveTo(radius, radius);
    ctx.arc(radius, radius, radius - 4, start, end);
    ctx.fillStyle = palette[index % palette.length];
    ctx.fill();

    ctx.save();
    ctx.translate(radius, radius);
    ctx.rotate(start + angleStep / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0e0f19';
    const fontSize = Math.max(16, Math.min(22, radius * 0.13));
    ctx.font = `600 ${fontSize}px "Sora", sans-serif`;
    const textRadius = radius * 0.62;
    ctx.fillText(prize.label, textRadius, 0);
    ctx.restore();
  });
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function spinToIndex(index) {
  if (!wheelPrizes.length) return;
  const angleStep = (Math.PI * 2) / wheelPrizes.length;
  const targetAngle = Math.PI * 1.5 - (index + 0.5) * angleStep;
  const spins = 5 * Math.PI * 2;
  const start = currentRotation;
  const end = targetAngle + spins;
  const startTime = performance.now();

  function animate(now) {
    const progress = Math.min((now - startTime) / SPIN_DURATION, 1);
    const eased = easeOutCubic(progress);
    currentRotation = start + (end - start) * eased;
    drawWheel(currentRotation);
    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      spinning = false;
      spinBtn.disabled = false;
    }
  }

  requestAnimationFrame(animate);
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

spinBtn.addEventListener('click', async () => {
  if (spinning) return;
  if (!reviewCheck.checked) {
    alert('Merci de confirmer que vous avez laisse un avis.');
    return;
  }

  if (!canSpinToday()) {
    resultEl.textContent = 'Vous avez deja tourne aujourd\'hui.';
    return;
  }

  const code = (validationCodeInput && validationCodeInput.value || '').trim();
  if (!code) {
    alert('Merci de saisir le code de validation.');
    return;
  }

  spinBtn.disabled = true;
  spinning = true;
  resultEl.textContent = 'La roue tourne...';

  const response = await fetch(`/api/spin/${slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewConfirmed: true, code })
  });

  if (!response.ok) {
    if (response.status === 403) {
      resultEl.textContent = 'Code de validation invalide.';
    } else {
      resultEl.textContent = 'Erreur lors du tirage.';
    }
    spinBtn.disabled = false;
    spinning = false;
    return;
  }

  const data = await response.json();
  const index = wheelPrizes.findIndex((p) => p.id === data.prizeId);
  const targetIndex = index >= 0 ? index : Math.floor(Math.random() * Math.max(1, wheelPrizes.length));

  if (data.retryUsed) {
    resultEl.textContent = 'Retente ta chance...';
    setTimeout(() => {
      resultEl.textContent = data.prize;
    }, SPIN_DURATION);
  } else {
    resultEl.textContent = data.prize;
  }

  spinToIndex(targetIndex);
  markSpun();
});

loadRoulette();
