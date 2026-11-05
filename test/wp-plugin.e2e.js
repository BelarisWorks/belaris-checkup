// End-to-end: phone browser -> plugin page (PHP, stubbed WordPress) -> plugin REST -> Node scanner -> local test site.
const { spawn } = require('child_process');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const assert = require('assert');
const { chromium, devices } = require('playwright');
const { test, summary, fixtureServer } = require('./helpers');
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const wait = ms => new Promise(r => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch (e) { await wait(250); } } throw new Error('not up: ' + url); }

(async () => {
  console.log('WordPress plugin end-to-end');
  const fx = await fixtureServer();
  const hooks = [];
  const hook = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { hooks.push(JSON.parse(b)); res.end('ok'); }); }).listen(0);
  const SCAN_PORT = 9611, PHP_PORT = 9612;
  const state = path.join(os.tmpdir(), 'bc-state-' + Date.now() + '.json');
  fs.writeFileSync(state, JSON.stringify({ options: { belaris_checkup_settings: {
    scanner_url: `http://127.0.0.1:${SCAN_PORT}`, api_key: 'test-key-123', notify_email: 'owner@belaris.test',
    booking_url: 'https://belaris.test/book', privacy_url: 'https://belaris.test/privacy', visitor_email: 1,
    webhook_url: `http://127.0.0.1:${hook.address().port}/hook` } } }));
  const env = { ...process.env, NO_PROXY: '*', no_proxy: '*' };
  const scanner = spawn('node', ['src/server.js'], { env: { ...env, PORT: SCAN_PORT, CHECKUP_API_KEY: 'test-key-123', ALLOW_PRIVATE: '1', SAVE_LEADS: '0' }, stdio: 'ignore' });
  const php = spawn('php', ['-S', `127.0.0.1:${PHP_PORT}`, 'test/wp/router.php'], { env: { ...env, BC_STATE: state }, stdio: ['ignore', 'ignore', 'pipe'] });
  let phpErr = ''; php.stderr.on('data', d => { const s = String(d); if (/PHP (Warning|Notice|Fatal|Deprecated)/.test(s)) phpErr += s; });
  const base = `http://127.0.0.1:${PHP_PORT}`;
  const st = () => JSON.parse(fs.readFileSync(state, 'utf8'));
  try {
    await up(`http://127.0.0.1:${SCAN_PORT}/health`); await up(base + '/');

    await test('scanner refuses calls without the key', async () => {
      const r = await fetch(`http://127.0.0.1:${SCAN_PORT}/api/scan`, { method: 'POST', body: '{"url":"example.com"}' });
      assert.strictEqual(r.status, 401);
    });

    const browser = await chromium.launch();
    const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    let scanId;
    page.on('response', async r => { if (r.url().endsWith('/wp-json/belaris-checkup/v1/scan') && r.status() === 202) scanId = (await r.json()).id; });

    await test('page renders inside a theme and the start form works', async () => {
      await page.goto(base + '/');
      await page.screenshot({ path: path.join(SHOTS, 'wp-1-start.png') });
      await page.click('#bc-start-btn');
      assert.strictEqual(await page.textContent('#bc-url-error'), 'Enter your website address.');
      await page.fill('#bc-url', fx.base + '/bad.html'); await page.fill('#bc-business', 'Old Co'); await page.fill('#bc-town', 'Riverside');
      await page.click('#bc-start-btn');
      await page.waitForSelector('#bc-v-quiz:not([hidden])');
    });

    await test('questions, then email gate (bad email rejected), then results', async () => {
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(SHOTS, 'wp-2-question.png') });
      for (const pick of [1, 2, 2, 3]) { await page.click(`label[for="bc-opt-${pick}"]`); await page.click('#bc-q-next'); }
      await page.waitForSelector('#bc-v-gate:not([hidden])');
      await page.fill('#bc-email', 'nope'); await page.click('#bc-gate-btn');
      assert.match(await page.textContent('#bc-gate-error'), /valid email/);
      await page.fill('#bc-name', 'Dana'); await page.fill('#bc-email', 'dana@oldco.test'); await page.check('#bc-consent');
      await page.click('#bc-gate-btn');
      await page.waitForSelector('#bc-v-results:not([hidden])', { timeout: 120000 });
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(SHOTS, 'wp-3-results.png'), fullPage: true });
      const score = Number(await page.textContent('#bc-score-num'));
      assert.ok(score > 0 && score < 50, 'score ' + score);
      assert.strictEqual(await page.getAttribute('#bc-book', 'href'), 'https://belaris.test/book');
      assert.ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'page scrolls sideways');
    });

    await test('lead saved once with score, weak areas and consent', async () => {
      const s = st(); const ids = Object.keys(s.posts);
      assert.strictEqual(ids.length, 1);
      const m = s.meta[ids[0]];
      assert.strictEqual(m._bc_email, 'dana@oldco.test'); assert.strictEqual(m._bc_business, 'Old Co');
      assert.strictEqual(m._bc_consent, 1); assert.ok(m._bc_score > 0); assert.match(m._bc_weak, /Works on phones/);
      assert.match(s.posts[ids[0]].post_title, /Old Co – dana@oldco.test/);
    });

    await test('two emails sent: lead alert to you, results to the visitor', async () => {
      const mail = st().mail;
      assert.strictEqual(mail.length, 2);
      assert.strictEqual(mail[0].to, 'owner@belaris.test'); assert.match(mail[0].subject, /Old Co scored/);
      assert.ok(mail[0].headers.includes('Reply-To: dana@oldco.test'));
      assert.strictEqual(mail[1].to, 'dana@oldco.test'); assert.match(mail[1].body, /Your three next steps/);
      assert.match(mail[1].body, /belaris.test\/book/);
      fs.writeFileSync(path.join(SHOTS, 'wp-visitor-email.html'), mail[1].body);
    });

    await test('webhook received the lead (for Zapier → SuiteDash later)', async () => {
      assert.strictEqual(hooks.length, 1);
      assert.strictEqual(hooks[0].email, 'dana@oldco.test'); assert.strictEqual(hooks[0].marketing_ok, true);
      assert.ok(typeof hooks[0].score === 'number');
    });

    await test('submitting the same scan twice does not duplicate the lead', async () => {
      const r = await fetch(base + '/wp-json/belaris-checkup/v1/report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: scanId, answers: {}, lead: { email: 'dana@oldco.test' } }) });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(Object.keys(st().posts).length, 1); assert.strictEqual(st().mail.length, 2);
    });

    await test('bots filling the hidden field are rejected', async () => {
      const r = await fetch(base + '/wp-json/belaris-checkup/v1/report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: scanId, website_confirm: 'spam', lead: { email: 'x@y.co' } }) });
      assert.strictEqual(r.status, 400);
    });

    await test('unknown or expired scan id gets a plain message', async () => {
      const r = await fetch(base + '/wp-json/belaris-checkup/v1/report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'a'.repeat(24), lead: { email: 'x@y.co' } }) });
      assert.strictEqual(r.status, 404); assert.match((await r.json()).error, /expired/);
    });

    await test('wrong scanner key shows a friendly "not set up" message, not a crash', async () => {
      const s = st(); s.options.belaris_checkup_settings.api_key = 'wrong'; fs.writeFileSync(state, JSON.stringify(s));
      const r = await fetch(base + '/wp-json/belaris-checkup/v1/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"url":"example.com"}' });
      assert.strictEqual(r.status, 503); assert.match((await r.json()).error, /not set up/);
    });

    await test('no browser errors and no PHP warnings', async () => {
      assert.deepStrictEqual(errs, []); assert.strictEqual(phpErr, '');
    });
    await browser.close();
  } finally {
    scanner.kill('SIGKILL'); php.kill('SIGKILL'); hook.close(); fx.server.close();
    summary(); setTimeout(() => process.exit(process.exitCode || 0), 200);
  }
})();
