const fs = require('fs');
const https = require('https');
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
const MANUAL_BILLING_ONLY = process.env.MANUAL_BILLING_ONLY === 'true';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? require('@supabase/supabase-js').createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;
const USE_SUPABASE = Boolean(supabase);

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

function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const payload = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text });
  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };
  const req = https.request(options, (res) => {
    res.on('data', () => {});
  });
  req.on('error', () => {});
  req.write(payload);
  req.end();
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

function mapRestaurantRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    vat: row.vat,
    email: row.email,
    slug: row.slug,
    token: row.token,
    reviewUrl: row.review_url || '',
    passwordSalt: row.password_salt,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    subscriptionStatus: row.subscription_status || 'inactive',
    themeId: row.theme_id || 'neon',
    posterThemeId: row.poster_theme_id || 'neon',
    validationCode: row.validation_code || '',
    logoUrl: row.logo_url || '',
    stripeCustomerId: row.stripe_customer_id || '',
    stripeSubscriptionId: row.stripe_subscription_id || ''
  };
}

function mapRestaurantToRow(restaurant) {
  return {
    id: restaurant.id,
    name: restaurant.name,
    vat: restaurant.vat,
    email: restaurant.email,
    slug: restaurant.slug,
    token: restaurant.token,
    review_url: restaurant.reviewUrl || '',
    password_salt: restaurant.passwordSalt,
    password_hash: restaurant.passwordHash,
    created_at: restaurant.createdAt,
    subscription_status: restaurant.subscriptionStatus || 'inactive',
    theme_id: restaurant.themeId || 'neon',
    poster_theme_id: restaurant.posterThemeId || 'neon',
    validation_code: restaurant.validationCode || '',
    logo_url: restaurant.logoUrl || '',
    stripe_customer_id: restaurant.stripeCustomerId || '',
    stripe_subscription_id: restaurant.stripeSubscriptionId || ''
  };
}

async function dbGetRestaurantByToken(token) {
  if (USE_SUPABASE) {
    const { data } = await supabase.from('restaurants').select('*').eq('token', token).maybeSingle();
    return mapRestaurantRow(data);
  }
  const db = loadDb();
  return db.restaurants.find((r) => r.token === token) || null;
}

async function dbGetRestaurantById(id) {
  if (USE_SUPABASE) {
    const { data } = await supabase.from('restaurants').select('*').eq('id', id).maybeSingle();
    return mapRestaurantRow(data);
  }
  const db = loadDb();
  return db.restaurants.find((r) => r.id === id) || null;
}

async function dbGetRestaurantByEmail(email) {
  if (USE_SUPABASE) {
    const { data } = await supabase.from('restaurants').select('*').eq('email', email).maybeSingle();
    return mapRestaurantRow(data);
  }
  const db = loadDb();
  return db.restaurants.find((r) => r.email === email) || null;
}

async function dbGetRestaurantBySlug(slug) {
  if (USE_SUPABASE) {
    const { data } = await supabase.from('restaurants').select('*').eq('slug', slug).maybeSingle();
    return mapRestaurantRow(data);
  }
  const db = loadDb();
  return db.restaurants.find((r) => r.slug === slug) || null;
}

async function dbInsertRestaurant(restaurant) {
  if (USE_SUPABASE) {
    await supabase.from('restaurants').insert(mapRestaurantToRow(restaurant));
    return;
  }
  const db = loadDb();
  db.restaurants.push(restaurant);
  saveDb(db);
}

async function dbUpdateRestaurant(id, patch) {
  if (USE_SUPABASE) {
    await supabase.from('restaurants').update(patch).eq('id', id);
    return;
  }
  const db = loadDb();
  const idx = db.restaurants.findIndex((r) => r.id === id);
  if (idx >= 0) {
    db.restaurants[idx] = { ...db.restaurants[idx], ...patch };
    saveDb(db);
  }
}

async function dbGetRestaurants() {
  if (USE_SUPABASE) {
    const { data } = await supabase.from('restaurants').select('*');
    return (data || []).map(mapRestaurantRow);
  }
  const db = loadDb();
  return db.restaurants;
}

async function dbGetPrizesByRestaurant(restaurantId) {
  if (USE_SUPABASE) {
    const { data } = await supabase.from('prizes').select('*').eq('restaurant_id', restaurantId);
    return (data || []).map((row) => ({
      id: row.id,
      restaurantId: row.restaurant_id,
      label: row.label,
      probability: row.probability,
      isRetry: row.is_retry
    }));
  }
  const db = loadDb();
  return db.prizes.filter((p) => p.restaurantId === restaurantId);
}

async function dbReplacePrizes(restaurantId, prizes) {
  if (USE_SUPABASE) {
    await supabase.from('prizes').delete().eq('restaurant_id', restaurantId);
    if (prizes.length) {
      const rows = prizes.map((p) => ({
        id: p.id,
        restaurant_id: restaurantId,
        label: p.label,
        probability: p.probability,
        is_retry: Boolean(p.isRetry)
      }));
      await supabase.from('prizes').insert(rows);
    }
    return;
  }
  const db = loadDb();
  db.prizes = db.prizes.filter((p) => p.restaurantId !== restaurantId);
  db.prizes.push(...prizes);
  saveDb(db);
}

async function dbGetSpinsByRestaurant(restaurantId, limit = 50) {
  if (USE_SUPABASE) {
    const { data } = await supabase
      .from('spins')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data || []).map((row) => ({
      id: row.id,
      restaurantId: row.restaurant_id,
      prizeId: row.prize_id,
      prizeLabel: row.prize_label,
      createdAt: row.created_at,
      reviewConfirmed: row.review_confirmed,
      status: row.status || 'approved',
      approvedAt: row.approved_at || null,
      customerName: row.customer_name || '',
      expiresAt: row.expires_at || null
    }));
  }
  const db = loadDb();
  return db.spins
    .filter((s) => s.restaurantId === restaurantId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

async function dbInsertSpin(spin) {
  if (USE_SUPABASE) {
    await supabase.from('spins').insert({
      id: spin.id,
      restaurant_id: spin.restaurantId,
      prize_id: spin.prizeId,
      prize_label: spin.prizeLabel,
      created_at: spin.createdAt,
      review_confirmed: spin.reviewConfirmed,
      status: spin.status || 'approved',
      approved_at: spin.approvedAt || null,
      customer_name: spin.customerName || '',
      expires_at: spin.expiresAt || null
    });
    return;
  }
  const db = loadDb();
  db.spins.push(spin);
  saveDb(db);
}

async function dbGetSpinById(id) {
  if (USE_SUPABASE) {
    const { data } = await supabase.from('spins').select('*').eq('id', id).maybeSingle();
    if (!data) return null;
    return {
      id: data.id,
      restaurantId: data.restaurant_id,
      prizeId: data.prize_id,
      prizeLabel: data.prize_label,
      createdAt: data.created_at,
      reviewConfirmed: data.review_confirmed,
      status: data.status || 'approved',
      approvedAt: data.approved_at || null,
      customerName: data.customer_name || '',
      expiresAt: data.expires_at || null
    };
  }
  const db = loadDb();
  return db.spins.find((s) => s.id === id) || null;
}

async function dbGetPendingSpins(restaurantId) {
  if (USE_SUPABASE) {
    const { data } = await supabase
      .from('spins')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    return (data || []).map((row) => ({
      id: row.id,
      prizeLabel: row.prize_label,
      createdAt: row.created_at,
      customerName: row.customer_name || '',
      expiresAt: row.expires_at || null
    }));
  }
  const db = loadDb();
  return db.spins
    .filter((s) => s.restaurantId === restaurantId && s.status === 'pending')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((s) => ({
      id: s.id,
      prizeLabel: s.prizeLabel,
      createdAt: s.createdAt,
      customerName: s.customerName || '',
      expiresAt: s.expiresAt || null
    }));
}

async function dbApproveSpin(id) {
  if (USE_SUPABASE) {
    await supabase.from('spins').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', id);
    return;
  }
  const db = loadDb();
  const spin = db.spins.find((s) => s.id === id);
  if (spin) {
    spin.status = 'approved';
    spin.approvedAt = new Date().toISOString();
    saveDb(db);
  }
}

async function dbDeleteSpin(spinId) {
  if (supabase) {
    await supabase.from('spins').delete().eq('id', spinId);
    return;
  }
  db.spins = db.spins.filter((s) => s.id !== spinId);
}

async function dbDeleteRestaurant(restaurantId) {
  if (USE_SUPABASE) {
    await supabase.from('prizes').delete().eq('restaurant_id', restaurantId);
    await supabase.from('spins').delete().eq('restaurant_id', restaurantId);
    await supabase.from('restaurants').delete().eq('id', restaurantId);
    return;
  }
  const db = loadDb();
  db.restaurants = db.restaurants.filter((r) => r.id !== restaurantId);
  db.prizes = db.prizes.filter((p) => p.restaurantId !== restaurantId);
  db.spins = db.spins.filter((s) => s.restaurantId !== restaurantId);
  saveDb(db);
}

async function dbCountSpinsSince(restaurantId, sinceIso) {
  if (USE_SUPABASE) {
    const { count } = await supabase
      .from('spins')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .gte('created_at', sinceIso);
    return count || 0;
  }
  const db = loadDb();
  const since = new Date(sinceIso).getTime();
  return db.spins.filter((s) => s.restaurantId === restaurantId && new Date(s.createdAt).getTime() >= since).length;
}

async function updateSubscriptionByCustomer(customerId, status) {
  if (USE_SUPABASE) {
    await supabase.from('restaurants').update({ subscription_status: status }).eq('stripe_customer_id', customerId);
    return true;
  }
  const db = loadDb();
  const restaurant = db.restaurants.find((r) => r.stripeCustomerId === customerId);
  if (!restaurant) return false;
  restaurant.subscriptionStatus = status;
  saveDb(db);
  return true;
}

async function updateSubscriptionById(subscriptionId, status) {
  if (USE_SUPABASE) {
    await supabase.from('restaurants').update({ subscription_status: status }).eq('stripe_subscription_id', subscriptionId);
    return true;
  }
  const db = loadDb();
  const restaurant = db.restaurants.find((r) => r.stripeSubscriptionId === subscriptionId);
  if (!restaurant) return false;
  restaurant.subscriptionStatus = status;
  saveDb(db);
  return true;
}

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
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
    const restaurant = await dbGetRestaurantById(restaurantId);
    if (restaurant) {
      await dbUpdateRestaurant(restaurant.id, {
        stripe_customer_id: data.customer,
        stripe_subscription_id: data.subscription,
        subscription_status: 'active'
      });
    }
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const status = data.status === 'active' ? 'active' : 'inactive';
    const updatedBySub = await updateSubscriptionById(data.id, status);
    if (!updatedBySub) {
      await updateSubscriptionByCustomer(data.customer, status);
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

app.post('/api/signup', async (req, res) => {
  const { name, vat, email, reviewUrl, password, logoDataUrl } = req.body || {};
  if (!name || !email || !password || !reviewUrl) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }

  const emailLower = String(email).trim().toLowerCase();
  const exists = await dbGetRestaurantByEmail(emailLower);
  if (exists) {
    return res.status(409).json({ error: 'Email deja utilise.' });
  }

  const slugBase = slugify(name) || 'enseigne';
  const slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;
  const token = randomToken();
  const passwordInfo = hashPassword(String(password));

  const restaurant = {
    id: randomId(),
    name,
    vat: vat || '',
    email: emailLower,
    slug,
    token,
    reviewUrl: reviewUrl || '',
    passwordSalt: passwordInfo.salt,
    passwordHash: passwordInfo.hash,
    createdAt: new Date().toISOString(),
    subscriptionStatus: 'inactive',
    themeId: 'neon',
    posterThemeId: 'neon',
    validationCode: generateValidationCode(),
    logoUrl: logoDataUrl || ''
  };

  await dbInsertRestaurant(restaurant);

  const msg = [
    'Nouvelle inscription',
    `Nom: ${restaurant.name}`,
    `Email: ${restaurant.email}`,
    `TVA: ${restaurant.vat || '--'}`,
    `Slug: ${restaurant.slug}`,
    `Date: ${new Date(restaurant.createdAt).toLocaleString('fr-FR')}`
  ].join('\n');
  sendTelegramMessage(msg);

  const loginUrl = '/login';
  const qrUrl = `/r/${slug}`;

  res.json({ loginUrl, qrUrl });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }

  const emailLower = String(email).trim().toLowerCase();
  const restaurant = await dbGetRestaurantByEmail(emailLower);
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

app.post('/api/billing/checkout', async (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'Non authentifie.' });
  }

  const restaurant = await dbGetRestaurantByToken(token);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }

  if (!stripe || !STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
    return res.status(400).json({ error: 'Stripe non configure.' });
  }

  let customerId = restaurant.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: restaurant.email,
      name: restaurant.name,
      metadata: { restaurantId: restaurant.id }
    });
    customerId = customer.id;
    await dbUpdateRestaurant(restaurant.id, { stripe_customer_id: customerId });
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

app.post('/api/billing/portal', async (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'Non authentifie.' });
  }

  const restaurant = await dbGetRestaurantByToken(token);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }

  if (!stripe || !STRIPE_SECRET_KEY) {
    return res.status(400).json({ error: 'Stripe non configure.' });
  }

  let customerId = restaurant.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: restaurant.email,
      name: restaurant.name,
      metadata: { restaurantId: restaurant.id }
    });
    customerId = customer.id;
    await dbUpdateRestaurant(restaurant.id, { stripe_customer_id: customerId });
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

app.get('/api/owner/restaurants', async (req, res) => {
  const cookies = parseCookies(req);
  if (cookies[OWNER_COOKIE] !== 'ok') {
    return res.status(401).json({ error: 'Acces refuse.' });
  }
  const restaurants = await dbGetRestaurants();
  res.json({ restaurants: restaurants.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    vat: r.vat,
    slug: r.slug,
    createdAt: r.createdAt || null,
    subscriptionStatus: r.subscriptionStatus || 'inactive',
    stripeCustomerId: r.stripeCustomerId || '',
    stripeSubscriptionId: r.stripeSubscriptionId || ''
  })) });
});

app.get('/api/owner/restaurants.csv', async (req, res) => {
  const cookies = parseCookies(req);
  if (cookies[OWNER_COOKIE] !== 'ok') {
    return res.status(401).json({ error: 'Acces refuse.' });
  }
  const restaurants = await dbGetRestaurants();
  const rows = restaurants.map((r) => ({
    ID: r.id,
    Nom: r.name,
    Email: r.email,
    TVA: r.vat || '',
    Slug: r.slug,
    Inscription: r.createdAt || '',
    Abonnement: r.subscriptionStatus || 'inactive',
    StripeCustomerId: r.stripeCustomerId || '',
    StripeSubscriptionId: r.stripeSubscriptionId || ''
  }));
  const header = Object.keys(rows[0] || {
    ID: '', Nom: '', Email: '', TVA: '', Slug: '', Inscription: '', Abonnement: '', StripeCustomerId: '', StripeSubscriptionId: ''
  });
  const escape = (value) => {
    const s = String(value ?? '');
    if (s.includes('"') || s.includes(';') || s.includes('\n')) {
      return `"${s.replace(/\"/g, '""')}"`;
    }
    return s;
  };
  const delimiter = ';';
  const lines = [header.join(delimiter)];
  rows.forEach((row) => {
    lines.push(header.map((key) => escape(row[key])).join(delimiter));
  });
  const csv = `\uFEFF${lines.join('\n')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="enseignes.csv"');
  res.send(csv);
});

app.get('/api/owner/stats/:id', async (req, res) => {
  const cookies = parseCookies(req);
  if (cookies[OWNER_COOKIE] !== 'ok') {
    return res.status(401).json({ error: 'Acces refuse.' });
  }
  const { id } = req.params;
  const now = Date.now();
  const day = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const week = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const month = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  res.json({
    total: await dbCountSpinsSince(id, new Date(0).toISOString()),
    day: await dbCountSpinsSince(id, day),
    week: await dbCountSpinsSince(id, week),
    month: await dbCountSpinsSince(id, month)
  });
});

app.delete('/api/owner/restaurant/:id', async (req, res) => {
  const cookies = parseCookies(req);
  if (cookies[OWNER_COOKIE] !== 'ok') {
    return res.status(401).json({ error: 'Acces refuse.' });
  }
  await dbDeleteRestaurant(req.params.id);
  res.json({ ok: true });
});

app.post('/api/owner/subscription', async (req, res) => {
  const cookies = parseCookies(req);
  if (cookies[OWNER_COOKIE] !== 'ok') {
    return res.status(401).json({ error: 'Acces refuse.' });
  }
  const { id, status } = req.body || {};
  if (!id || !status) {
    return res.status(400).json({ error: 'Parametres invalides.' });
  }
  await dbUpdateRestaurant(id, { subscription_status: String(status) });
  res.json({ ok: true });
});

app.get('/api/admin/me', async (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'Non authentifie.' });
  }
  let restaurant = await dbGetRestaurantByToken(token);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }
  if (!restaurant.validationCode) {
    restaurant.validationCode = generateValidationCode();
    await dbUpdateRestaurant(restaurant.id, { validation_code: restaurant.validationCode });
  }
  const prizes = await dbGetPrizesByRestaurant(restaurant.id);
  const spins = await dbGetSpinsByRestaurant(restaurant.id, 50);

  res.json({
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      email: restaurant.email,
      slug: restaurant.slug,
      reviewUrl: restaurant.reviewUrl || '',
      subscriptionStatus: restaurant.subscriptionStatus || 'inactive',
      validationCode: restaurant.validationCode || '',
      themeId: restaurant.themeId || 'neon',
      posterThemeId: restaurant.posterThemeId || 'neon',
      logoUrl: restaurant.logoUrl || ''
    },
    billing: {
      stripeEnabled: Boolean(stripe && STRIPE_PRICE_ID) && !MANUAL_BILLING_ONLY,
      manualOnly: MANUAL_BILLING_ONLY
    },
    prizes,
    spins
  });
});

app.get('/api/admin/pending', async (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'Non authentifie.' });
  }
  const restaurant = await dbGetRestaurantByToken(token);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }
  const items = await dbGetPendingSpins(restaurant.id);
  res.json({ items });
});

app.post('/api/admin/approve/:id', async (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'Non authentifie.' });
  }
  const restaurant = await dbGetRestaurantByToken(token);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }
  const spin = await dbGetSpinById(req.params.id);
  if (!spin || spin.restaurantId !== restaurant.id) {
    return res.status(404).json({ error: 'Demande introuvable.' });
  }
  await dbApproveSpin(spin.id);
  res.json({ ok: true });
});

app.post('/api/admin/request-activation', async (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'Non authentifie.' });
  }
  const restaurant = await dbGetRestaurantByToken(token);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }
  if (restaurant.subscriptionStatus === 'active') {
    return res.json({ ok: true });
  }
  await dbUpdateRestaurant(restaurant.id, { subscription_status: 'pending' });
  const msg = [
    'Demande activation abonnement',
    `Nom: ${restaurant.name}`,
    `Email: ${restaurant.email}`,
    `TVA: ${restaurant.vat || '--'}`,
    `Slug: ${restaurant.slug}`
  ].join('\n');
  sendTelegramMessage(msg);
  res.json({ ok: true });
});

app.delete('/api/admin/pending/:id', async (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'Non authentifie.' });
  }
  const restaurant = await dbGetRestaurantByToken(token);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }
  const spin = await dbGetSpinById(req.params.id);
  if (!spin || spin.restaurantId !== restaurant.id) {
    return res.status(404).json({ error: 'Demande introuvable.' });
  }
  await dbDeleteSpin(spin.id);
  res.json({ ok: true });
});

app.post('/api/admin/prizes', async (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'Non authentifie.' });
  }
  const restaurant = await dbGetRestaurantByToken(token);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }
  if (restaurant.subscriptionStatus !== 'active') {
    return res.status(402).json({ error: 'Abonnement inactif.' });
  }

  const { prizes } = req.body || {};
  if (!Array.isArray(prizes)) {
    return res.status(400).json({ error: 'Format de liste invalide.' });
  }

  const cleaned = prizes
    .map((p) => ({
      id: randomId(),
      restaurantId: restaurant.id,
      label: String(p.label || '').trim(),
      probability: Math.max(0, Number(p.probability || 0)),
      isRetry: Boolean(p.isRetry)
    }))
    .filter((p) => p.label.length > 0);

  await dbReplacePrizes(restaurant.id, cleaned);
  res.json({ ok: true });
});

app.post('/api/admin/restaurant', async (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'Non authentifie.' });
  }
  const restaurant = await dbGetRestaurantByToken(token);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }
  if (restaurant.subscriptionStatus !== 'active') {
    return res.status(402).json({ error: 'Abonnement inactif.' });
  }

  const { name, email, reviewUrl, themeId, posterThemeId, logoDataUrl } = req.body || {};
  if (name) restaurant.name = String(name).trim();
  if (email) restaurant.email = String(email).trim();
  if (reviewUrl !== undefined) restaurant.reviewUrl = String(reviewUrl).trim();
  if (themeId) restaurant.themeId = String(themeId).trim();
  if (posterThemeId) restaurant.posterThemeId = String(posterThemeId).trim();
  if (logoDataUrl !== undefined) restaurant.logoUrl = String(logoDataUrl).trim();

  await dbUpdateRestaurant(restaurant.id, {
    name: restaurant.name,
    email: restaurant.email,
    review_url: restaurant.reviewUrl,
    theme_id: restaurant.themeId,
    poster_theme_id: restaurant.posterThemeId,
    logo_url: restaurant.logoUrl || ''
  });

  res.json({ ok: true });
});

app.get('/api/restaurant/:slug', async (req, res) => {
  const { slug } = req.params;
  const restaurant = await dbGetRestaurantBySlug(slug);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }

  const prizes = await dbGetPrizesByRestaurant(restaurant.id);
  res.json({
    restaurant: {
      name: restaurant.name,
      reviewUrl: restaurant.reviewUrl || '',
      subscriptionStatus: restaurant.subscriptionStatus || 'inactive',
      themeId: restaurant.themeId || 'neon',
      logoUrl: restaurant.logoUrl || ''
    },
    prizes
  });
});

app.post('/api/claim/:slug', async (req, res) => {
  const { slug } = req.params;
  const restaurant = await dbGetRestaurantBySlug(slug);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }
  if (restaurant.subscriptionStatus !== 'active') {
    return res.status(402).json({ error: 'Abonnement inactif.' });
  }

  const customerName = String((req.body || {}).customerName || '').trim();
  if (!customerName) {
    return res.status(400).json({ error: 'Prenom requis.' });
  }

  const prizes = (await dbGetPrizesByRestaurant(restaurant.id)).filter((p) => p.probability > 0);
  let picked = pickWeighted(prizes);
  if (picked && picked.isRetry) {
    const retryless = prizes.filter((p) => !p.isRetry);
    picked = pickWeighted(retryless);
  }

  const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();
  const spin = {
    id: randomId(),
    restaurantId: restaurant.id,
    prizeId: picked ? picked.id : null,
    prizeLabel: picked ? picked.label : 'Merci pour votre avis !',
    createdAt: new Date().toISOString(),
    reviewConfirmed: Boolean((req.body || {}).reviewConfirmed),
    status: 'pending',
    approvedAt: null,
    customerName,
    expiresAt
  };

  await dbInsertSpin(spin);
  res.json({ claimId: spin.id });
});

app.get('/api/claim/:id', async (req, res) => {
  const spin = await dbGetSpinById(req.params.id);
  if (!spin) {
    return res.status(404).json({ error: 'Demande introuvable.' });
  }
  if (spin.status !== 'approved') {
    if (spin.expiresAt && new Date(spin.expiresAt).getTime() < Date.now()) {
      return res.json({ status: 'expired' });
    }
    return res.json({ status: 'pending' });
  }
  res.json({
    status: 'approved',
    prize: spin.prizeLabel,
    prizeId: spin.prizeId
  });
});

app.post('/api/spin/:slug', async (req, res) => {
  const { slug } = req.params;
  const restaurant = await dbGetRestaurantBySlug(slug);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }

  const providedCode = String((req.body || {}).code || '').trim();
  const validCode = restaurant.validationCode || '';
  if (!validCode || providedCode !== validCode) {
    return res.status(403).json({ error: 'Code de validation invalide.' });
  }

  const prizes = (await dbGetPrizesByRestaurant(restaurant.id)).filter((p) => p.probability > 0);
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
    createdAt: new Date().toISOString(),
    reviewConfirmed: Boolean((req.body || {}).reviewConfirmed)
  };

  await dbInsertSpin(spin);

  res.json({
    prize: spin.prizeLabel,
    prizeId: spin.prizeId,
    retryUsed
  });
});

app.listen(PORT, () => {
  console.log(`Roulette MVP running on http://localhost:${PORT}`);
  if (USE_SUPABASE) {
    console.log('Supabase enabled');
  } else {
    console.log('Using local db.json');
  }
});
