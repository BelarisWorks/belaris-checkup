'use strict';
// Scans one homepage the way a phone visitor would see it.
// Each check returns { points (0-3), top: 3, confidence, evidence[], nextStep? }.
const fs = require('fs');
const { chromium, devices } = require('playwright');
const { normalizeUrl, assertPublicHost, UserError } = require('./netguard');
const { reviewClarity } = require('./clarity');
const { lookupPlace } = require('./places');

const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const PHONE = devices['iPhone 13'];

// A mid-range phone on a decent 4G connection (similar to Lighthouse's mobile profile)
const THROTTLE = { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const CPU_SLOWDOWN = 4;

const ANALYTICS = [
  [/googletagmanager\.com|google-analytics\.com|gtag\(/i, 'Google Analytics'],
  [/plausible\.io/i, 'Plausible'], [/usefathom\.com/i, 'Fathom'], [/matomo/i, 'Matomo'],
  [/clarity\.ms/i, 'Microsoft Clarity'], [/connect\.facebook\.net/i, 'Meta Pixel'], [/hotjar\.com/i, 'Hotjar']
];
// Platforms with visitor stats built into the owner's dashboard
const PLATFORMS = [
  [/static\.wixstatic\.com|parastorage\.com/i, 'Wix', true],
  [/squarespace(-cdn)?\.com/i, 'Squarespace', true],
  [/cdn\.shopify\.com/i, 'Shopify', true],
  [/img1\.wsimg\.com/i, 'GoDaddy Website Builder', true],
  [/weebly\.com|editmysite\.com/i, 'Square Online / Weebly', true],
  [/webflow/i, 'Webflow', true],
  [/wp-content|wp-includes/i, 'WordPress', false]
];

// Plain-language versions of the most common axe-core rules
const A11Y_RULES = {
  'image-alt': { say: n => `${n} image${n > 1 ? 's have' : ' has'} no description for people using screen readers`, fix: 'Add a short description (alt text) to each image that shows something meaningful.' },
  'color-contrast': { say: n => `${n} piece${n > 1 ? 's' : ''} of text ${n > 1 ? 'are' : 'is'} hard to read because the color is too faint`, fix: 'Darken light-gray or pale text so it stands out clearly against its background.' },
  'link-name': { say: n => `${n} link${n > 1 ? 's have' : ' has'} no readable name, so screen readers just say "link"`, fix: 'Give icon-only links (like social media icons) a text label.' },
  'button-name': { say: n => `${n} button${n > 1 ? 's have' : ' has'} no readable name`, fix: 'Give every button, including menu and close icons, a text label.' },
  'label': { say: n => `${n} form field${n > 1 ? 's have' : ' has'} no label`, fix: 'Add a visible label to every form field, not just placeholder text.' },
  'select-name': { say: n => `${n} drop-down menu${n > 1 ? 's have' : ' has'} no label`, fix: 'Add a visible label to every drop-down menu.' },
  'html-has-lang': { say: () => "The page doesn't say what language it's written in", fix: 'Ask your web person to set the page language (one line of code).' },
  'document-title': { say: () => 'The page has no title', fix: 'Add a page title that names your business and service.' },
  'meta-viewport': { say: () => 'The page stops people from zooming in on phones', fix: 'Allow pinch-to-zoom so people with low vision can enlarge text.' },
  'frame-title': { say: n => `${n} embedded item${n > 1 ? 's' : ''} (like a map or video) ${n > 1 ? 'have' : 'has'} no title`, fix: 'Give embedded maps and videos a short title.' },
  'link-in-text-block': { say: n => `${n} link${n > 1 ? 's' : ''} can only be told apart from regular text by color`, fix: 'Underline links inside paragraphs.' },
  'heading-order': { say: () => 'Headings skip levels, which makes the page harder to navigate by keyboard or screen reader', fix: 'Use headings in order (main heading, then sub-headings).' },
  'list': { say: () => 'Some lists are built in a way screen readers can\'t follow', fix: 'Ask your web person to fix list markup.' },
  'aria-hidden-focus': { say: n => `${n} hidden item${n > 1 ? 's' : ''} can still be reached by keyboard`, fix: 'Ask your web person to remove hidden items from the keyboard order.' }
};
const IMPACT_RANK = { critical: 0, serious: 1, moderate: 2, minor: 3 };

const PERF_INIT = `(() => { window.__lcp = 0; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {} })();`;

let sharedBrowser = null;
async function getBrowser(launchOpts) {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  sharedBrowser = await chromium.launch(launchOpts || {});
  return sharedBrowser;
}

async function checkSecure(context, url) {
  const host = new URL(url).host;
  let httpsOk = false, redirects = false, certProblem = false;
  try {
    const r = await context.request.get('https://' + host + '/', { timeout: 20000, maxRedirects: 5 });
    httpsOk = r.status() < 500;
  } catch (e) { certProblem = /CERT_|certificate/i.test(e.message); }
  try {
    const r = await context.request.get('http://' + host + '/', { timeout: 20000, maxRedirects: 0 });
    const loc = r.headers()['location'] || '';
    redirects = r.status() >= 300 && r.status() < 400 && /^https:/i.test(new URL(loc, 'http://' + host).href);
  } catch (e) { redirects = httpsOk; } // plain http not served at all is fine
  return { httpsOk, redirects, certProblem };
}

// Runs inside the page
function collectFacts() {
  const vis = el => {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const H = innerHeight;
  const meta = document.querySelector('meta[name="viewport"]');
  const viewport = meta ? meta.getAttribute('content') || '' : '';
  const overflow = document.documentElement.scrollWidth > innerWidth + 4;

  let chars = 0, small = 0; const top = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode.textContent.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const el = walker.currentNode.parentElement;
    if (!el || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName) || !vis(el)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    chars += t.length; if (size < 12) small += t.length;
    if (el.getBoundingClientRect().top + scrollY < H * 1.1 && top.join(' ').length < 1200) top.push(t);
  }

  const targets = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea')]
    .filter(el => vis(el) && !el.closest('p'));
  const tiny = targets.filter(el => { const r = el.getBoundingClientRect(); return r.height < 24 || r.width < 24; }).length;

  const ctaRe = /\b(call|book|schedule|appointment|reserve|order|buy|shop|quote|estimate|contact|donate|tickets?|register|sign ?up|enroll|join|get started|visit|apply|hire)\b/i;
  const ctas = [...document.querySelectorAll('a[href], button, input[type=submit], input[type=button]')]
    .filter(vis)
    .map(el => ({
      text: (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 50),
      href: el.getAttribute('href') || '',
      top: Math.round(el.getBoundingClientRect().top + scrollY)
    }))
    .filter(c => ctaRe.test(c.text) || /^tel:/i.test(c.href));
  const tel = [...document.querySelectorAll('a[href^="tel:"]')].length;
  const mailto = document.querySelectorAll('a[href^="mailto:"]').length;
  const forms = [...document.forms].filter(f =>
    f.querySelectorAll('input:not([type=hidden]):not([type=search]):not([type=submit]), textarea').length >= 2).length;
  const allLinks = [...document.querySelectorAll('a[href]')].map(a => (a.getAttribute('href') + ' ' + a.textContent).toLowerCase());
  const contactLink = allLinks.some(s => /contact|book|appointment|schedul|reserv|ticket/.test(s));
  const bodyText = document.body.innerText || '';
  const phoneText = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.test(bodyText);

  const srcs = [...document.querySelectorAll('script[src], iframe[src], link[href], img[src]')].map(e => e.src || e.href).join(' ');
  const inline = [...document.querySelectorAll('script:not([src])')].map(s => s.textContent.slice(0, 3000)).join(' ');
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent).join(' ');
  const generator = (document.querySelector('meta[name="generator"]') || {}).content || '';

  const years = [...bodyText.matchAll(/(?:©|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map(m => +m[1]);

  return {
    viewport, overflow, textChars: chars, smallChars: small, targets: targets.length, tinyTargets: tiny,
    ctas: ctas.slice(0, 30), viewportHeight: H, tel, mailto, forms, contactLink, phoneText,
    title: document.title.trim(),
    description: ((document.querySelector('meta[name="description"]') || {}).content || '').trim(),
    h1: [...document.querySelectorAll('h1')].filter(vis).map(h => h.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3),
    topText: top.join(' ').slice(0, 1200),
    trustText: /(testimonials?|customer reviews|our reviews|reviews from|what (our )?(customers|clients|people|parents|students|families|patients|guests) (say|are saying)|★{3,}|\b[45](\.\d)? ?(out of 5|stars)\b)/i.test(bodyText),
    proofText: /(as seen (in|on)|featured in|our (partners|sponsors|funders)|award[- ]winning|accredited|in the press)/i.test(bodyText),
    reviewWidget: /(elfsight|trustindex|birdeye|podium|yotpo|judge\.me|trustpilot|yelp\.com\/biz|reviewsonmywebsite|embedsocial|grade\.us)/i.test(srcs + ' ' + inline),
    reviewSchema: /"(Review|AggregateRating)"/.test(ld),
    reviewsLink: allLinks.some(s => /testimonial|review/.test(s)),
    tech: (srcs + ' ' + inline + ' ' + generator).slice(0, 60000),
    copyright: years.length ? Math.max(...years) : null,
    lang: document.documentElement.lang || ''
  };
}

function scoreMobile(f) {
  const evidence = [];
  if (!/width\s*=\s*device-width/i.test(f.viewport)) {
    return { points: 0, top: 3, confidence: 'high',
      evidence: ["Your site isn't set up for phones, so it shows a shrunken desktop page that visitors have to pinch and zoom."],
      nextStep: 'Ask your web person to make the site "responsive" (mobile-friendly). If your platform has a mobile theme, switch it on.' };
  }
  let issues = 0;
  if (f.overflow) { issues++; evidence.push('Part of the page is wider than a phone screen, so it slides sideways.'); }
  const smallPct = f.textChars ? f.smallChars / f.textChars : 0;
  if (smallPct > 0.15) { issues++; evidence.push(`About ${Math.round(smallPct * 100)}% of your text is smaller than is comfortable to read on a phone.`); }
  const tinyPct = f.targets ? f.tinyTargets / f.targets : 0;
  if (tinyPct > 0.3 && f.tinyTargets >= 5) { issues++; evidence.push(`${f.tinyTargets} buttons and links are too small to tap easily.`); }
  if (!issues) evidence.push('Your site is set up for phones: text is readable and nothing slides sideways.');
  return { points: Math.max(1, 3 - issues), top: 3, confidence: 'high', evidence };
}

function scoreSpeed({ lcp, loadMs, bytes }) {
  const secs = (lcp || loadMs) / 1000;
  const mb = bytes / (1024 * 1024);
  const points = secs <= 2.5 ? 3 : secs <= 4 ? 2 : secs <= 6 ? 1 : 0;
  const evidence = [`On a typical phone connection, your main content took about ${secs.toFixed(1)} seconds to appear. Under 2.5 seconds is the goal.`];
  if (mb >= 0.05) evidence.push(`Your homepage downloads ${mb.toFixed(1)} MB${mb > 3 ? ', which is heavy. Large photos are usually the cause.' : '.'}`);
  return { points, top: 3, confidence: 'medium', evidence, measured: { seconds: +secs.toFixed(1), megabytes: +mb.toFixed(1) },
    nextStep: mb > 3 ? 'Shrink your largest photos before uploading them (aim for under 300 KB each). A free tool like squoosh.app does this in a minute.' : undefined };
}

function scoreContact(f) {
  const fold = f.viewportHeight;
  const above = f.ctas.filter(c => c.top < fold);
  const evidence = [];
  let points;
  if (above.length) {
    points = 3;
    const label = above.find(c => c.text) || above[0];
    evidence.push(label.text ? `Visitors see a "${label.text}" button or link without scrolling.` : 'Visitors can tap to call without scrolling.');
  } else if (f.ctas.length || f.forms || f.tel || f.contactLink) {
    points = 2;
    evidence.push("Visitors can reach you, but they have to scroll or open the menu to find how.");
  } else if (f.mailto || f.phoneText) {
    points = 1;
    evidence.push("We only found contact details in the page text, with no button to call, book or message.");
  } else {
    points = 0;
    evidence.push("We couldn't find a phone number, contact form or booking button on your homepage.");
  }
  let nextStep;
  if (f.phoneText && !f.tel) {
    evidence.push("Your phone number isn't a tap-to-call link, so phone visitors have to copy it by hand.");
    nextStep = 'Turn your phone number into a tap-to-call link and put a "Call now" button at the top of the page.';
  }
  return { points, top: 3, confidence: 'medium', evidence, nextStep };
}

function scoreTrust(f) {
  if (f.trustText || f.reviewWidget || f.reviewSchema) {
    return { points: 3, top: 3, confidence: 'medium', evidence: ['Your homepage shows reviews or testimonials.'] };
  }
  if (f.reviewsLink || f.proofText) {
    return { points: 2, top: 3, confidence: 'medium',
      evidence: [f.reviewsLink ? 'You have reviews on another page, but not on your homepage.' : 'Your homepage mentions partners, awards or press, but no customer reviews.'] };
  }
  return { points: 0, top: 3, confidence: 'medium', evidence: ["We didn't find any reviews or testimonials on your homepage."] };
}

function scoreAccessibility(violations) {
  const sorted = violations.slice().sort((a, b) =>
    (IMPACT_RANK[a.impact] ?? 4) - (IMPACT_RANK[b.impact] ?? 4) || b.count - a.count);
  const severe = sorted.filter(v => v.impact === 'critical' || v.impact === 'serious');
  const points = severe.length === 0 ? 3 : severe.length <= 2 ? 2 : severe.length <= 4 ? 1 : 0;
  const issues = sorted.map(v => {
    const rule = A11Y_RULES[v.id];
    return { id: v.id, impact: v.impact, count: v.count,
      text: rule ? rule.say(v.count) : `${v.help} (${v.count} place${v.count > 1 ? 's' : ''})`,
      fix: rule ? rule.fix : 'Ask your web person to review this item.' };
  });
  const evidence = issues.length
    ? [`We found ${issues.length} type${issues.length > 1 ? 's' : ''} of accessibility problem${issues.length > 1 ? 's' : ''}, ${severe.length} of them serious.`]
    : ['Our automated check found no accessibility problems on your homepage.'];
  return { points, top: 3, confidence: 'medium', evidence, issues: issues.slice(0, 8),
    nextStep: issues.length ? issues[0].fix : undefined };
}

async function scanSite(rawUrl, opts = {}) {
  const url = normalizeUrl(rawUrl, { allowAnyPort: !!opts.allowPrivate });
  const host = new URL(url).hostname;
  if (!opts.allowPrivate) await assertPublicHost(host);
  const stage = opts.onStage || (() => {});
  const browser = opts.browser || await getBrowser(opts.launch);
  const out = { url, finalUrl: url, scannedAt: new Date().toISOString(), checks: {}, facts: {}, warnings: [] };

  const context = await browser.newContext({ ...PHONE, bypassCSP: true, ignoreHTTPSErrors: !!opts.ignoreHTTPSErrors });
  const hostOk = new Map();
  await context.route('**/*', async route => {
    let u;
    try { u = new URL(route.request().url()); } catch (e) { return route.abort(); }
    if (opts.blockExternal && !['localhost', '127.0.0.1'].includes(u.hostname)) return route.abort();
    if (!opts.allowPrivate) {
      let ok = hostOk.get(u.hostname);
      if (ok === undefined) {
        ok = await assertPublicHost(u.hostname).then(() => true, () => false);
        hostOk.set(u.hostname, ok);
      }
      if (!ok) return route.abort();
    }
    return route.continue();
  });

  try {
    stage('Checking your security certificate');
    const sec = await checkSecure(context, url);

    stage('Loading your site the way a phone would');
    const page = await context.newPage();
    await page.addInitScript(PERF_INIT);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...THROTTLE });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });

    let bytes = 0; const mixed = new Set();
    page.on('requestfinished', async req => {
      try { const s = await req.sizes(); bytes += s.responseBodySize + s.responseHeadersSize; } catch (e) {}
    });
    page.on('request', req => {
      if (req.url().startsWith('http://') && page.url().startsWith('https://')) mixed.add(req.url());
    });

    const t0 = Date.now();
    let resp;
    try {
      resp = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    } catch (e) {
      throw new UserError("We couldn't load that website. It may be down, very slow, or blocking automated visitors.");
    }
    const loadMs = Date.now() - t0;
    if (resp && resp.status() >= 400) {
      throw new UserError(`That website answered with an error (${resp.status()}). Check the address and try again.`);
    }
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const lcp = await page.evaluate(() => window.__lcp || 0).catch(() => 0);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    out.finalUrl = page.url();

    // Security result, now that we know about mixed content
    {
      const evidence = [];
      let points;
      if (!sec.httpsOk) {
        points = 0;
        evidence.push(sec.certProblem
          ? 'Your security certificate has a problem, so browsers warn visitors your site is "Not secure".'
          : "Your site doesn't load over a secure connection (https), so browsers mark it \"Not secure\".");
      } else {
        points = 3;
        evidence.push('Your site loads over a secure connection (https).');
        if (!sec.redirects) { points = 2; evidence.push('People who type "http://" still get the insecure version instead of being redirected.'); }
        if (mixed.size) { points = Math.min(points, 2); evidence.push(`${mixed.size} file${mixed.size > 1 ? 's load' : ' loads'} insecurely, which can trigger browser warnings.`); }
      }
      out.checks.secure = { points, top: 3, confidence: 'high', evidence };
    }

    stage('Reading your homepage');
    const f = await page.evaluate(collectFacts);
    out.checks.mobile = scoreMobile(f);
    out.checks.speed = scoreSpeed({ lcp, loadMs, bytes });
    out.checks.contact = scoreContact(f);
    out.checks.trust = scoreTrust(f);

    out.facts.analytics = ANALYTICS.filter(([re]) => re.test(f.tech)).map(([, name]) => name);
    const plat = PLATFORMS.find(([re]) => re.test(f.tech));
    out.facts.platform = plat ? plat[1] : null;
    out.facts.platformHasStats = plat ? plat[2] : false;
    out.facts.copyright = f.copyright;
    out.facts.title = f.title;
    out.facts.h1 = f.h1[0] || null;

    stage('Running accessibility checks');
    try {
      await page.addScriptTag({ content: AXE });
      const violations = await page.evaluate(async () => {
        const r = await window.axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
          resultTypes: ['violations']
        });
        return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length }));
      });
      out.checks.accessibility = scoreAccessibility(violations);
    } catch (e) {
      out.warnings.push('accessibility: ' + e.message);
      out.checks.accessibility = null;
    }

    stage('Checking whether your message is clear');
    out.checks.clarity = await reviewClarity({ title: f.title, description: f.description, h1: f.h1,
      topText: f.topText, business: opts.business, town: opts.town });

    if (process.env.GOOGLE_PLACES_API_KEY && opts.business) {
      stage('Looking up your Google listing');
      try { out.checks.google = await lookupPlace({ business: opts.business, town: opts.town, siteUrl: out.finalUrl }); }
      catch (e) { out.warnings.push('google: ' + e.message); }
    }
  } finally {
    await context.close().catch(() => {});
  }
  return out;
}

async function closeBrowser() {
  if (sharedBrowser) await sharedBrowser.close().catch(() => {});
  sharedBrowser = null;
}

module.exports = { scanSite, closeBrowser, scoreAccessibility, scoreSpeed };
