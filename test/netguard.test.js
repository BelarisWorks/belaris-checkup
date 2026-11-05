const assert = require('assert');
const { isPrivateAddress, normalizeUrl, assertPublicHost } = require('../src/netguard');
const { test, summary } = require('./helpers');
(async () => {
  console.log('netguard');
  await test('private and loopback addresses are blocked', () => {
    ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']
      .forEach(ip => assert.ok(isPrivateAddress(ip), ip));
  });
  await test('public addresses are allowed', () => {
    ['8.8.8.8', '172.32.0.1', '2606:4700::1111'].forEach(ip => assert.ok(!isPrivateAddress(ip), ip));
  });
  await test('bare domains get https:// added', () => {
    assert.strictEqual(normalizeUrl('richarts.org'), 'https://richarts.org/');
    assert.strictEqual(normalizeUrl(' https://www.example.com/about#x '), 'https://www.example.com/about');
  });
  await test('junk and odd addresses are rejected with a plain message', () => {
    for (const bad of ['', 'not a site', 'ftp://example.com', 'http://user:pw@example.com', 'https://example.com:8080', 'localhost']) {
      assert.throws(() => normalizeUrl(bad), /address|website/i, bad);
    }
  });
  await test('IP literals and localhost names are refused before any request', async () => {
    await assert.rejects(assertPublicHost('127.0.0.1'), /public/);
    await assert.rejects(assertPublicHost('169.254.169.254'), /public/);
    await assert.rejects(assertPublicHost('localhost'), /public/);
  });
  summary();
})();
