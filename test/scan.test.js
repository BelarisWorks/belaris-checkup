// Runs the real scanner (headless Chromium + axe-core) against local fixture pages.
const assert = require('assert');
const { scanSite, closeBrowser } = require('../src/scan');
const { combine } = require('../src/scoring');
const { test, summary, fixtureServer } = require('./helpers');
delete process.env.ANTHROPIC_API_KEY; // use the rule-based clarity check in tests
(async () => {
  console.log('scanner (live browser against local test pages)');
  const { server, base } = await fixtureServer();
  const opts = { allowPrivate: true, blockExternal: true };
  let good, bad;
  await test('scans the well-built page', async () => {
    good = await scanSite(base + '/good.html', { ...opts, business: 'Harbor Light Plumbing', town: 'Riverside' });
    assert.ok(good.checks.mobile && good.checks.speed && good.checks.contact && good.checks.accessibility);
  });
  await test('scans the poorly built page', async () => {
    bad = await scanSite(base + '/bad.html', { ...opts, business: 'Old Co', town: 'Riverside' });
  });
  if (!good || !bad) { server.close(); await closeBrowser(); return summary(); }
  const show = (n, s) => console.log(`       ${n}: ` + Object.entries(s.checks).filter(([, v]) => v).map(([k, v]) => `${k}=${v.points}`).join(' '));
  show('good', good); show('bad ', bad);

  await test('mobile: good page passes, page without viewport scores 0', () => {
    assert.strictEqual(good.checks.mobile.points, 3); assert.strictEqual(bad.checks.mobile.points, 0);
  });
  await test('contact: tap-to-call above the fold = 3; untappable phone text = 1 with a tap-to-call fix', () => {
    assert.strictEqual(good.checks.contact.points, 3);
    assert.match(good.checks.contact.evidence[0], /Call now/);
    assert.strictEqual(bad.checks.contact.points, 1);
    assert.match(bad.checks.contact.nextStep, /tap-to-call/);
  });
  await test('trust: testimonials detected on good page only', () => {
    assert.strictEqual(good.checks.trust.points, 3); assert.strictEqual(bad.checks.trust.points, 0);
  });
  await test('accessibility: good page clean, bad page has missing alt text, labels, contrast and language', () => {
    assert.strictEqual(good.checks.accessibility.points, 3, JSON.stringify(good.checks.accessibility.issues));
    const ids = bad.checks.accessibility.issues.map(i => i.id);
    ['image-alt', 'label', 'color-contrast', 'html-has-lang'].forEach(id => assert.ok(ids.includes(id), 'missing ' + id + ' in ' + ids));
    assert.ok(bad.checks.accessibility.points <= 1);
    assert.ok(!/undefined/.test(bad.checks.accessibility.issues.map(i => i.text).join(' ')));
  });
  await test('secure: plain-http site scores 0', () => {
    assert.strictEqual(good.checks.secure.points, 0);
    assert.match(good.checks.secure.evidence[0], /Not secure/);
  });
  await test('clarity (rule-based): good page beats bad page', () => {
    assert.ok(good.checks.clarity.points > bad.checks.clarity.points);
  });
  await test('facts: analytics and old copyright detected', () => {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(good.facts.analytics)), ['Google Analytics']);
    assert.strictEqual(bad.facts.copyright, 2017);
  });
  await test('speed is measured in seconds and megabytes', () => {
    assert.ok(good.checks.speed.measured.seconds > 0);
  });
  await test('combined: good page outscores bad page', () => {
    const a = { google: 1, found: 2, fresh: 0, visits: 1 };
    const g = combine(good, a), b = combine(bad, a);
    console.log(`       good=${g.score} (${g.band.label}), bad=${b.score} (${b.band.label})`);
    console.log('       bad page next steps: ' + b.steps.map(s => s.title).join(' | '));
    assert.ok(g.score - b.score >= 25);
  });
  await test('refuses to load a private address when the guard is on', async () => {
    await assert.rejects(scanSite(base + '/good.html', {}), /public|regular website/);
    await assert.rejects(scanSite('http://127.0.0.1/', {}), /public/);
  });
  server.close(); await closeBrowser(); summary();
})();
