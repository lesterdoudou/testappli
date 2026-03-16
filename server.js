const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 5174;

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const SESSION_COOKIE = 'roulette_session';
const OWNER_COOKIE = 'roulette_owner';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'change-me';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = STRIPE_SECRET_KEY ? require('stripe')(STRIPE_SECRET_KEY) : null;

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ restaurants: [], prizes: [], spins: [] }, null, 2));
  }
}

function loadDb() {
  ensureDb();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    return { restaurants: [], prizes: [], spins: [] };
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function slugify(input) {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function randomId() {
  return crypto.randomUUID();
}

function randomToken() {
  return crypto.randomBytes(16).toString('hex');
}

function generateValidationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const attempt = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(attempt, 'hex'), Buffer.from(hash, 'hex'));
}

function pickWeighted(prizes) {
  const total = prizes.reduce((sum, p) => sum + p.probability, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const prize of prizes) {
    r -= prize.probability;
    if (r <= 0) return prize;
  }
  return prizes[prizes.length - 1] || null;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return;
    out[key] = decodeURIComponent(rest.join('=') || '');
  });
  return out;
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'Non authentifie.' });
  }
  const db = loadDb();
  const restaurant = db.restaurants.find((r) => r.token === token);
  if (!restaurant) {
    return res.status(401).json({ error: 'Session invalide.' });
  }
  req.restaurant = restaurant;
  next();
}

function requireActiveSubscription(req, res, next) {
  const status = req.restaurant && req.restaurant.subscriptionStatus;
  if (status !== 'active') {
    return res.status(402).json({ error: 'Abonnement inactif.' });
  }
  next();
}

function requireOwner(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[OWNER_COOKIE];
  if (!token || token !== 'ok') {
    return res.status(401).json({ error: 'Acces refuse.' });
  }
  next();
}

function updateSubscriptionByCustomer(customerId, status) {
  const db = loadDb();
  const restaurant = db.restaurants.find((r) => r.stripeCustomerId === customerId);
  if (!restaurant) return false;
  restaurant.subscriptionStatus = status;
  saveDb(db);
  return true;
}

function updateSubscriptionById(subscriptionId, status) {
  const db = loadDb();
  const restaurant = db.restaurants.find((r) => r.stripeSubscriptionId === subscriptionId);
  if (!restaurant) return false;
  restaurant.subscriptionStatus = status;
  saveDb(db);
  return true;
}

function countSpins(spins, ms) {
  const since = Date.now() - ms;
  return spins.filter((s) => s.createdAt >= since).length;
}

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return res.status(400).send('Stripe not configured');
  }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const data = event.data.object;

  if (event.type === 'checkout.session.completed' && data.mode === 'subscription') {
    const restaurantId = data.client_reference_id || (data.metadata && data.metadata.restaurantId);
    const db = loadDb();
    const restaurant = db.restaurants.find((r) => r.id === restaurantId);
    if (restaurant) {
      restaurant.stripeCustomerId = data.customer;
      restaurant.stripeSubscriptionId = data.subscription;
      restaurant.subscriptionStatus = 'active';
      saveDb(db);
    }
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const status = data.status === 'active' ? 'active' : 'inactive';
    if (!updateSubscriptionById(data.id, status)) {
      updateSubscriptionByCustomer(data.customer, status);
    }
  }

  res.json({ received: true });
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', (req, res) => {
  const cookies = parseCookies(req);
  if (!cookies[SESSION_COOKIE]) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/owner', (req, res) => {
  const cookies = parseCookies(req);
  if (!cookies[OWNER_COOKIE]) {
    return res.sendFile(path.join(__dirname, 'public', 'owner-login.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'owner.html'));
});

app.get('/r/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'roulette.html'));
});

app.post('/api/signup', (req, res) => {
  const { name, vat, email, reviewUrl, password } = req.body || {};
  if (!name || !vat || !email || !password) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }

  const db = loadDb();
  const emailLower = String(email).trim().toLowerCase();
  const exists = db.restaurants.find((r) => r.email.toLowerCase() === emailLower);
  if (exists) {
    return res.status(409).json({ error: 'Email deja utilise.' });
  }

  const slugBase = slugify(name) || 'restaurant';
  const slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;
  const token = randomToken();
  const passwordInfo = hashPassword(String(password));

  const restaurant = {
    id: randomId(),
    name,
    vat,
    email: emailLower,
    slug,
    token,
    reviewUrl: reviewUrl || '',
    passwordSalt: passwordInfo.salt,
    passwordHash: passwordInfo.hash,
    createdAt: Date.now(),
    subscriptionStatus: 'inactive',
    themeId: 'neon',
    validationCode: generateValidationCode()
  };

  db.restaurants.push(restaurant);
  saveDb(db);

  const loginUrl = '/login';
  const qrUrl = `/r/${slug}`;

  res.json({ loginUrl, qrUrl });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }

  const db = loadDb();
  const emailLower = String(email).trim().toLowerCase();
  const restaurant = db.restaurants.find((r) => r.email.toLowerCase() === emailLower);
  if (!restaurant) {
    return res.status(401).json({ error: 'Identifiants invalides.' });
  }

  const ok = verifyPassword(String(password), restaurant.passwordSalt, restaurant.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Identifiants invalides.' });
  }

  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${restaurant.token}; HttpOnly; Path=/; SameSite=Lax`);
  res.json({ adminUrl: '/admin' });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  res.json({ ok: true });
});

app.post('/api/billing/checkout', requireAuth, async (req, res) => {
  if (!stripe || !STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
    return res.status(400).json({ error: 'Stripe non configure.' });
  }

  const db = loadDb();
  const restaurant = db.restaurants.find((r) => r.id === req.restaurant.id);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }

  let customerId = restaurant.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: restaurant.email,
      name: restaurant.name,
      metadata: { restaurantId: restaurant.id }
    });
    customerId = customer.id;
    restaurant.stripeCustomerId = customerId;
    saveDb(db);
  }

  const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${origin}/admin?billing=success`,
    cancel_url: `${origin}/admin?billing=cancel`,
    client_reference_id: restaurant.id,
    metadata: { restaurantId: restaurant.id }
  });

  res.json({ url: session.url });
});

app.post('/api/billing/portal', requireAuth, async (req, res) => {
  if (!stripe || !STRIPE_SECRET_KEY) {
    return res.status(400).json({ error: 'Stripe non configure.' });
  }

  const db = loadDb();
  const restaurant = db.restaurants.find((r) => r.id === req.restaurant.id);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }

  let customerId = restaurant.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: restaurant.email,
      name: restaurant.name,
      metadata: { restaurantId: restaurant.id }
    });
    customerId = customer.id;
    restaurant.stripeCustomerId = customerId;
    saveDb(db);
  }

  const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/admin?billing=portal`
  });

  res.json({ url: portal.url });
});

app.post('/api/owner/login', (req, res) => {
  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ error: 'Mot de passe requis.' });
  }
  if (String(password) !== OWNER_PASSWORD) {
    return res.status(401).json({ error: 'Mot de passe invalide.' });
  }
  res.setHeader('Set-Cookie', `${OWNER_COOKIE}=ok; HttpOnly; Path=/; SameSite=Lax`);
  res.json({ ok: true });
});

app.post('/api/owner/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${OWNER_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  res.json({ ok: true });
});

app.get('/api/owner/restaurants', requireOwner, (req, res) => {
  const db = loadDb();
  const restaurants = db.restaurants.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    vat: r.vat,
    slug: r.slug,
    createdAt: r.createdAt || null,
    subscriptionStatus: r.subscriptionStatus || 'inactive',
    stripeCustomerId: r.stripeCustomerId || '',
    stripeSubscriptionId: r.stripeSubscriptionId || ''
  }));
  res.json({ restaurants });
});

app.get('/api/owner/stats/:id', requireOwner, (req, res) => {
  const { id } = req.params;
  const db = loadDb();
  const spins = db.spins.filter((s) => s.restaurantId === id);
  res.json({
    total: spins.length,
    day: countSpins(spins, 24 * 60 * 60 * 1000),
    week: countSpins(spins, 7 * 24 * 60 * 60 * 1000),
    month: countSpins(spins, 30 * 24 * 60 * 60 * 1000)
  });
});

app.delete('/api/owner/restaurant/:id', requireOwner, (req, res) => {
  const { id } = req.params;
  const db = loadDb();
  const exists = db.restaurants.find((r) => r.id === id);
  if (!exists) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }
  db.restaurants = db.restaurants.filter((r) => r.id !== id);
  db.prizes = db.prizes.filter((p) => p.restaurantId !== id);
  db.spins = db.spins.filter((s) => s.restaurantId !== id);
  saveDb(db);
  res.json({ ok: true });
});

app.post('/api/owner/subscription', requireOwner, (req, res) => {
  const { id, status } = req.body || {};
  if (!id || !status) {
    return res.status(400).json({ error: 'Parametres invalides.' });
  }
  const db = loadDb();
  const restaurant = db.restaurants.find((r) => r.id === id);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }
  restaurant.subscriptionStatus = String(status);
  saveDb(db);
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAuth, (req, res) => {
  const restaurant = req.restaurant;
  const db = loadDb();
  if (!restaurant.validationCode) {
    restaurant.validationCode = generateValidationCode();
    const idx = db.restaurants.findIndex((r) => r.id === restaurant.id);
    if (idx >= 0) {
      db.restaurants[idx] = restaurant;
      saveDb(db);
    }
  }
  const prizes = db.prizes.filter((p) => p.restaurantId === restaurant.id);
  const spins = db.spins
    .filter((s) => s.restaurantId === restaurant.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);

  res.json({
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      email: restaurant.email,
      slug: restaurant.slug,
      reviewUrl: restaurant.reviewUrl || '',
      subscriptionStatus: restaurant.subscriptionStatus || 'inactive',
      validationCode: restaurant.validationCode || '',
      themeId: restaurant.themeId || 'neon'
    },
    prizes,
    spins
  });
});

app.get('/api/admin/validation-code', requireAuth, (req, res) => {
  const db = loadDb();
  const restaurant = db.restaurants.find((r) => r.id === req.restaurant.id);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }
  if (!restaurant.validationCode) {
    restaurant.validationCode = generateValidationCode();
    saveDb(db);
  }
  res.json({ code: restaurant.validationCode });
});

app.post('/api/admin/validation-code/rotate', requireAuth, (req, res) => {
  const db = loadDb();
  const restaurant = db.restaurants.find((r) => r.id === req.restaurant.id);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }
  restaurant.validationCode = generateValidationCode();
  saveDb(db);
  res.json({ code: restaurant.validationCode });
});

app.post('/api/admin/prizes', requireAuth, requireActiveSubscription, (req, res) => {
  const { prizes } = req.body || {};
  if (!Array.isArray(prizes)) {
    return res.status(400).json({ error: 'Format de liste invalide.' });
  }

  const db = loadDb();
  const restaurant = req.restaurant;

  db.prizes = db.prizes.filter((p) => p.restaurantId !== restaurant.id);
  const cleaned = prizes
    .map((p) => ({
      id: randomId(),
      restaurantId: restaurant.id,
      label: String(p.label || '').trim(),
      probability: Math.max(0, Number(p.probability || 0)),
      isRetry: Boolean(p.isRetry)
    }))
    .filter((p) => p.label.length > 0);

  db.prizes.push(...cleaned);
  saveDb(db);

  res.json({ ok: true });
});

app.post('/api/admin/restaurant', requireAuth, requireActiveSubscription, (req, res) => {
  const { name, email, reviewUrl, themeId } = req.body || {};

  const db = loadDb();
  const restaurant = req.restaurant;

  if (name) restaurant.name = String(name).trim();
  if (email) restaurant.email = String(email).trim();
  if (reviewUrl !== undefined) restaurant.reviewUrl = String(reviewUrl).trim();
  if (themeId) restaurant.themeId = String(themeId).trim();

  const idx = db.restaurants.findIndex((r) => r.id === restaurant.id);
  if (idx >= 0) {
    db.restaurants[idx] = restaurant;
  }

  saveDb(db);
  res.json({ ok: true });
});

app.get('/api/restaurant/:slug', (req, res) => {
  const { slug } = req.params;
  const db = loadDb();
  const restaurant = db.restaurants.find((r) => r.slug === slug);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }

  const prizes = db.prizes.filter((p) => p.restaurantId === restaurant.id);
  res.json({
    restaurant: {
      name: restaurant.name,
      reviewUrl: restaurant.reviewUrl || '',
      subscriptionStatus: restaurant.subscriptionStatus || 'inactive',
      themeId: restaurant.themeId || 'neon'
    },
    prizes
  });
});

app.post('/api/spin/:slug', (req, res) => {
  const { slug } = req.params;
  const db = loadDb();
  const restaurant = db.restaurants.find((r) => r.slug === slug);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }
  const providedCode = String((req.body || {}).code || '').trim();
  const validCode = restaurant.validationCode || '';
  if (!validCode || providedCode !== validCode) {
    return res.status(403).json({ error: 'Code de validation invalide.' });
  }

  const prizes = db.prizes.filter((p) => p.restaurantId === restaurant.id && p.probability > 0);
  let picked = pickWeighted(prizes);
  let retryUsed = false;
  if (picked && picked.isRetry) {
    retryUsed = true;
    const retryless = prizes.filter((p) => !p.isRetry);
    picked = pickWeighted(retryless);
  }

  const spin = {
    id: randomId(),
    restaurantId: restaurant.id,
    prizeId: picked ? picked.id : null,
    prizeLabel: picked ? picked.label : 'Merci pour votre avis !',
    createdAt: Date.now(),
    reviewConfirmed: Boolean((req.body || {}).reviewConfirmed)
  };

  db.spins.push(spin);
  saveDb(db);

  res.json({
    prize: spin.prizeLabel,
    prizeId: spin.prizeId,
    retryUsed
  });
});

app.listen(PORT, () => {
  console.log(`Roulette MVP running on http://localhost:${PORT}`);
});
