// Tiny test runner + a local server for the fixture pages.
const http = require('http'); const fs = require('fs'); const path = require('path');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
function summary() { console.log(`\n${passed} passed, ${failed} failed`); }
function fixtureServer() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const f = path.join(__dirname, 'fixtures', path.basename(req.url.split('?')[0]) || 'good.html');
      if (fs.existsSync(f) && f.endsWith('.html')) { res.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(f).pipe(res); }
      else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html lang="en"><title>Page</title><body>ok</body></html>'); }
    }).listen(0, '127.0.0.1', () => resolve({ server: s, base: `http://127.0.0.1:${s.address().port}` }));
  });
}
module.exports = { test, summary, fixtureServer };
