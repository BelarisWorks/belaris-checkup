'use strict';
// Belaris Website Checkup server.
//   POST /api/scan    { url, business, town }      -> { id, questions }
//   GET  /api/scan/:id                              -> { status, stage }   (no results until the lead form is sent)
//   POST /api/report  { id, answers, lead }         -> full results; saves the lead
// Static files are served from /public.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scanSite } = require('./scan');
const { combine, questionsFor } = require('./scoring');
const { normalizeUrl, UserError } = require('./netguard');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, '..', 'public');
const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const LEADS_FILE = path.join(DATA, 'leads.jsonl');
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_SCANS || 2);
const CACHE_MS = 24 * 60 * 60 * 1000;
const REPORT_WAIT_MS = Number(process.env.REPORT_WAIT_MS || 20000);
const SAVE_LEADS = process.env.SAVE_LEADS !== '0';
const SCAN_OPTS = {
  allowPrivate: process.env.ALLOW_PRIVATE === '1', // tests only
  launch: process.env.SCAN_PROXY ? { proxy: { server: process.env.SCAN_PROXY } } : undefined,
  ignoreHTTPSErrors: process.env.SCAN_IGNORE_TLS === '1'
};

fs.mkdirSync(DATA, { recursive: true });

// ---- rate limiting (per IP, in memory) ----
const hits = new Map();
function limited(ip, bucket, max, windowMs) {
  const key = bucket + ':' + ip, now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) { hits.set(key, list); return true; }
  list.push(now); hits.set(key, list);
  return false;
}
// When CHECKUP_API_KEY is set, only callers with the key (the WordPress plugin) may use the API.
const API_KEY = process.env.CHECKUP_API_KEY || '';
function hasKey(req) {
  if (!API_KEY) return false;
  const given = Buffer.from(String(req.headers['x-belaris-key'] || ''));
  const want = Buffer.from(API_KEY);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}
function clientIp(req) {
  // The WordPress plugin forwards the visitor's IP so rate limits apply per visitor, not per website.
  if (hasKey(req) && req.headers['x-visitor-ip']) return String(req.headers['x-visitor-ip']).slice(0, 64);
  if (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-for']) {
    return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

// ---- scan jobs with a small queue ----
const jobs = new Map();
const cache = new Map(); // normalized url -> { at, result }
let running = 0; const queue = [];

function runNext() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    running++;
    job.status = 'running';
    const cached = cache.get(job.url);
    const work = cached && Date.now() - cached.at < CACHE_MS
      ? Promise.resolve(cached.result)
      : scanSite(job.url, { ...SCAN_OPTS, business: job.business, town: job.town, onStage: s => { job.stage = s; } })
        .then(r => { cache.set(job.url, { at: Date.now(), result: r }); return r; });
    work.then(r => { job.result = r; job.status = 'done'; job.stage = 'Scan complete'; },
      e => {
        job.status = 'error';
        job.error = e instanceof UserError ? e.message : "Something went wrong while checking that site. Please try again.";
        if (!(e instanceof UserError)) console.error('[scan]', job.url, e);
      })
      .finally(() => { running--; job.resolve(); runNext(); });
  }
}

function startJob(url, business, town) {
  const id = crypto.randomBytes(12).toString('hex');
  const job = { id, url, business, town, status: 'queued', stage: 'Waiting to start', createdAt: Date.now() };
  job.done = new Promise(res => { job.resolve = res; });
  jobs.set(id, job);
  queue.push(job);
  runNext();
  return job;
}

setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, j] of jobs) if (j.createdAt < cutoff) jobs.delete(id);
  for (const [u, c] of cache) if (Date.now() - c.at > CACHE_MS) cache.delete(u);
}, 10 * 60 * 1000).unref();

// ---- leads ----
function saveLead(lead) {
  fs.appendFileSync(LEADS_FILE, JSON.stringify(lead) + '\n');
  if (process.env.LEAD_WEBHOOK_URL) {
    fetch(process.env.LEAD_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lead),
      signal: AbortSignal.timeout(10000)
    }).catch(e => console.error('[lead webhook]', e.message));
  }
}

// ---- http helpers ----
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 20000) { reject(new UserError('Request too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(new UserError('Invalid request.')); } });
    req.on('error', reject);
  });
}
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serveStatic(req, res) {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(PUBLIC, rel === '/' ? 'index.html' : rel));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

async function handle(req, res) {
  const { pathname } = new URL(req.url, 'http://x');
  const ip = clientIp(req);
  try {
    if (pathname.startsWith('/api/') && API_KEY && !hasKey(req)) return send(res, 401, { error: 'Not authorized.' });
    if (req.method === 'GET' && pathname === '/health') return send(res, 200, { ok: true });
    if (req.method === 'POST' && pathname === '/api/scan') {
      if (limited(ip, 'scan', Number(process.env.SCANS_PER_HOUR || 5), 3600000)) {
        return send(res, 429, { error: "You've run a few checks already. Please try again in an hour." });
      }
      const body = await readJson(req);
      const url = normalizeUrl(body.url, { allowAnyPort: SCAN_OPTS.allowPrivate });
      const job = startJob(url, clean(body.business, 120), clean(body.town, 80));
      return send(res, 202, { id: job.id, url, questions: questionsFor({ placesEnabled: !!process.env.GOOGLE_PLACES_API_KEY }) });
    }
    const m = pathname.match(/^\/api\/scan\/([a-f0-9]{24})$/);
    if (req.method === 'GET' && m) {
      const job = jobs.get(m[1]);
      if (!job) return send(res, 404, { error: 'That check has expired. Please start again.' });
      return send(res, 200, { status: job.status, stage: job.stage, error: job.error });
    }
    if (req.method === 'POST' && pathname === '/api/report') {
      if (limited(ip, 'report', 20, 3600000)) return send(res, 429, { error: 'Too many requests. Please try again later.' });
      const body = await readJson(req);
      if (body.website_confirm) return send(res, 400, { error: 'Invalid request.' }); // honeypot field
      const job = jobs.get(String(body.id || ''));
      if (!job) return send(res, 404, { error: 'That check has expired. Please start again.' });
      const lead = body.lead || {};
      const email = clean(lead.email, 200).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return send(res, 400, { error: 'Enter a valid email address so we can send your report.', field: 'email' });
      await Promise.race([job.done, new Promise(r => setTimeout(r, REPORT_WAIT_MS))]);
      if (job.status === 'error') return send(res, 422, { error: job.error });
      if (job.status !== 'done') return send(res, 503, { error: 'Your scan is taking longer than usual. Please try again in a minute.' });
      const answers = {};
      for (const [k, v] of Object.entries(body.answers || {})) if (Number.isInteger(v) && v >= 0 && v < 10) answers[k] = v;
      const result = combine(job.result, answers);
      if (SAVE_LEADS) saveLead({
        at: new Date().toISOString(), name: clean(lead.name, 120), email,
        marketingConsent: lead.consent === true,
        business: job.business, town: job.town, url: job.url, platform: result.scanned.platform,
        score: result.score, band: result.band.label,
        topGaps: result.steps.map(s => s.topic),
        weakAreas: result.items.filter(i => i.status === 'bad').map(i => i.topic),
        accessibilityIssues: result.accessibility ? result.accessibility.issues.length : null
      });
      job.reported = true;
      return send(res, 200, result);
    }
    if (req.method === 'GET') return serveStatic(req, res);
    send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    if (e instanceof UserError) return send(res, 400, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
}

if (require.main === module) {
  http.createServer(handle).listen(PORT, () => console.log(`Belaris Website Checkup on http://localhost:${PORT}`));
}
module.exports = { handle };
