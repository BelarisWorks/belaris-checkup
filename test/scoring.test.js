const assert = require('assert');
const { combine, questionsFor, OWNER_QUESTIONS, AREAS, bandFor } = require('../src/scoring');
const { test, summary } = require('./helpers');
const c = (points, extra) => Object.assign({ points, top: 3, confidence: 'high', evidence: ['x'] }, extra);
const scanAll = p => ({ finalUrl: 'https://x.com/', facts: {}, checks: Object.fromEntries(
  ['mobile', 'speed', 'clarity', 'contact', 'accessibility', 'trust', 'secure'].map(id => [id, c(p)])) });
const ans = idx => Object.fromEntries(OWNER_QUESTIONS.map(q => [q.id, idx]));
const plain = v => JSON.parse(JSON.stringify(v));
(async () => {
  console.log('scoring');
  await test('11 areas, weights sum to 12.4', () => {
    assert.strictEqual(AREAS.length, 11);
    assert.strictEqual(Math.round(AREAS.reduce((s, a) => s + a.weight, 0) * 10) / 10, 12.4);
  });
  await test('perfect scan + best answers = 100 with 3 keep-it-up steps', () => {
    const r = combine(scanAll(3), ans(0));
    assert.strictEqual(r.score, 100); assert.strictEqual(r.band.label, 'Strong');
    assert.ok(r.steps.every(s => s.topic === 'Keep it up'));
  });
  await test('worst everything = 0, heaviest areas first', () => {
    const r = combine(scanAll(0), ans(3));
    assert.strictEqual(r.score, 0);
    assert.deepStrictEqual(plain(r.steps.map(s => s.topic)), ['Works on phones', 'Easy to contact', 'Loading speed']);
  });
  await test('scan-specific next step replaces the generic one', () => {
    const s = scanAll(3); s.checks.contact = c(1, { nextStep: 'Turn your phone number into a tap-to-call link.' });
    const r = combine(s, ans(0));
    assert.strictEqual(r.steps[0].step, 'Turn your phone number into a tap-to-call link.');
  });
  await test('a check that failed to run is left out of the score, not counted as 0', () => {
    const s = scanAll(3); s.checks.accessibility = null;
    const r = combine(s, ans(0));
    assert.strictEqual(r.score, 100);
    assert.ok(!r.items.find(i => i.id === 'accessibility'));
    assert.strictEqual(r.accessibility, null);
  });
  await test('Google listing from Places beats the owner answer', () => {
    const s = scanAll(3); s.checks.google = c(1, { source: 'google' });
    const r = combine(s, ans(0));
    const g = r.items.find(i => i.id === 'google');
    assert.strictEqual(g.source, 'google'); assert.strictEqual(g.points, 1);
  });
  await test('google question is skipped when Places is configured', () => {
    assert.ok(questionsFor({ placesEnabled: false }).some(q => q.id === 'google'));
    assert.ok(!questionsFor({ placesEnabled: true }).some(q => q.id === 'google'));
  });
  await test('"No idea" about visitors + analytics found = good-news evidence', () => {
    const s = scanAll(3); s.facts = { analytics: ['Google Analytics'] };
    const r = combine(s, Object.assign(ans(0), { visits: 3 }));
    assert.match(r.items.find(i => i.id === 'visits').evidence[0], /already has Google Analytics/);
  });
  await test('old copyright year is flagged', () => {
    const s = scanAll(3); s.facts = { copyright: 2017 };
    const r = combine(s, ans(0), new Date('2026-11-05'));
    assert.match(r.items.find(i => i.id === 'fresh').evidence[0], /2017/);
  });
  await test('score is always an integer 0-100 with 3 steps (1,000 random runs)', () => {
    for (let n = 0; n < 1000; n++) {
      const s = { facts: {}, checks: {} };
      ['mobile', 'speed', 'clarity', 'contact', 'accessibility', 'trust', 'secure'].forEach(id => {
        if (Math.random() < 0.9) s.checks[id] = c(Math.floor(Math.random() * 4));
      });
      const r = combine(s, ans(Math.floor(Math.random() * 4)));
      assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100);
      assert.strictEqual(r.steps.length, 3);
    }
  });
  await test('band boundaries', () => {
    assert.deepStrictEqual([80, 79, 60, 59, 40, 39].map(s => bandFor(s).label),
      ['Strong', 'Solid foundation', 'Solid foundation', 'Room to grow', 'Room to grow', 'Needs attention']);
  });
  summary();
})();
