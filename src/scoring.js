'use strict';
// Combines automatic scan results with the owner's answers into one score
// and three recommended next steps.

const AREAS = [
  { id: 'mobile', topic: 'Works on phones', weight: 1.5,
    rec: { title: 'Make your site easy to use on a phone', effort: 'Medium effort',
      why: 'Most visitors arrive on a phone. If they have to zoom or hunt for buttons, they leave and call a competitor.',
      step: 'Open your site on your phone and write down every spot where you had to zoom or mis-tapped. That list is your fix list.' } },
  { id: 'speed', topic: 'Loading speed', weight: 1.2,
    rec: { title: 'Speed up your homepage', effort: 'Quick win',
      why: 'About half of mobile visitors give up on a page that takes longer than 3 seconds to load.',
      step: 'Shrink your largest photos and remove anything on the homepage you don\'t need, like auto-playing video or extra sliders.' } },
  { id: 'clarity', topic: 'Clear message', weight: 1.2,
    rec: { title: 'Say what you do in one line at the top', effort: 'Quick win',
      why: 'Visitors decide in seconds whether they\'re in the right place. A vague headline sends them back to search.',
      step: 'Rewrite your top headline as: what you do + who it\'s for + where.' } },
  { id: 'contact', topic: 'Easy to contact', weight: 1.5,
    rec: { title: 'Put your call-to-action on every page', effort: 'Quick win',
      why: 'Every extra click between interest and contact loses customers. The ones ready to buy shouldn\'t have to search.',
      step: 'Add a "Call now" or "Book online" button to your site header so it shows on every page, including on phones.' } },
  { id: 'accessibility', topic: 'Accessibility', weight: 1.2,
    rec: { title: 'Fix the accessibility basics', effort: 'Medium effort',
      why: 'About 1 in 4 US adults has a disability. Problems like faint text and unlabeled images turn those customers away and can lead to legal complaints.',
      step: 'Start with the first issue listed in your accessibility results.' } },
  { id: 'google', topic: 'Google Business Profile', weight: 1.0,
    rec: { title: 'Claim and update your Google Business Profile', effort: 'Quick win',
      why: 'For local businesses, your Google listing is often seen more than your website. Wrong hours cost you visits.',
      step: 'Go to business.google.com, claim your listing, and update your hours, phone number, and at least 5 recent photos.' } },
  { id: 'trust', topic: 'Reviews and proof', weight: 1.0,
    rec: { title: 'Show off what customers say about you', effort: 'Quick win',
      why: 'New customers trust other customers more than they trust you. Reviews near your contact button make people act.',
      step: 'Pick your 3 best Google or Facebook reviews and add them to your homepage, close to your main button.' } },
  { id: 'secure', topic: 'Secure connection', weight: 1.0,
    rec: { title: 'Fix your secure connection (HTTPS)', effort: 'Quick win',
      why: 'Browsers warn visitors away from sites marked "Not secure", and Google ranks them lower.',
      step: 'Ask your web host to turn on a free SSL certificate and redirect all visitors to the https version.' } },
  { id: 'found', topic: 'Found on Google', weight: 1.2,
    rec: { title: 'Get found when locals search', effort: 'Ongoing',
      why: 'Most people never scroll past the first page of results. If you\'re not there, those customers find someone else.',
      step: 'Make sure your homepage title and first paragraph name your main service and town, the way customers search.' } },
  { id: 'fresh', topic: 'Up-to-date info', weight: 0.8,
    rec: { title: 'Refresh your key details', effort: 'Quick win',
      why: 'Old prices, holiday hours, or stale photos make visitors doubt you\'re still in business.',
      step: 'Set a 15-minute reminder on the first Monday of each quarter to check your hours, prices, and photos.' } },
  { id: 'visits', topic: 'Know your visitors', weight: 0.8,
    rec: { title: 'Start tracking your visitors', effort: 'Quick win',
      why: 'Without visitor numbers you can\'t tell whether changes are working or where your customers come from.',
      step: 'Set up free Google Analytics (or ask your web person to) and check your monthly visitors once a month.' } }
];

// Things only the owner knows. "google" is skipped when the Places lookup is configured.
const OWNER_QUESTIONS = [
  { id: 'google', q: 'Do you have a Google Business Profile with up-to-date hours, photos, and contact details?',
    help: 'This is the box that appears on Google Maps and on the right side of Google search.',
    options: [
      { label: 'Yes, and I\'ve updated it in the last few months', points: 3 },
      { label: 'Yes, but it\'s out of date', points: 2 },
      { label: 'I think one exists, but I\'ve never managed it', points: 1 },
      { label: 'No, or I\'m not sure', points: 0 }] },
  { id: 'found', q: 'If you search Google for your service and your town, where does your business show up?',
    help: 'For example: "bakery Riverside". Try it in a private browser window.',
    options: [
      { label: 'In the top 3 results or the map', points: 3 },
      { label: 'Somewhere on the first page', points: 2 },
      { label: 'On page 2 or later', points: 1 },
      { label: 'Not at all, or I\'m not sure', points: 0 }] },
  { id: 'fresh', q: 'When did you last update your website\'s prices, hours, photos, or services?',
    help: 'Outdated details make people wonder if you\'re still open.',
    options: [
      { label: 'Within the last 3 months', points: 3 },
      { label: 'Within the last year', points: 2 },
      { label: 'More than a year ago', points: 1 },
      { label: 'I don\'t remember', points: 0 }] },
  { id: 'visits', q: 'Do you know roughly how many people visit your website each month?',
    help: 'Tools like Google Analytics, or the stats page in Wix or Squarespace, show this.',
    options: [
      { label: 'Yes, I check regularly', points: 3 },
      { label: 'I have a tool set up, but rarely look', points: 2 },
      { label: 'Someone set something up, but I don\'t know where', points: 1 },
      { label: 'No idea', points: 0 }] }
];

const BANDS = [
  { min: 80, label: 'Strong', tone: 'good', title: 'Your website is working hard for you',
    summary: 'You\'ve covered the basics well. Small refinements will keep you ahead of local competitors.' },
  { min: 60, label: 'Solid foundation', tone: 'good', title: 'You have a solid base to build on',
    summary: 'The essentials are in place, but a few gaps are likely costing you customers.' },
  { min: 40, label: 'Room to grow', tone: 'fair', title: 'Your website has room to grow',
    summary: 'Some important pieces are missing. The next steps below are where you\'ll see the biggest difference.' },
  { min: 0, label: 'Needs attention', tone: 'bad', title: 'Your website needs some attention',
    summary: 'Right now your site is probably turning customers away. The good news: the first fixes are often quick.' }
];

const MAINTAIN = [
  { title: 'Ask happy customers for reviews', effort: 'Ongoing', topic: 'Keep it up',
    why: 'Fresh reviews keep you ranking well and give new customers confidence.',
    step: 'After each good job or sale this month, send one short text asking for a Google review.' },
  { title: 'Test one improvement at a time', effort: 'Ongoing', topic: 'Keep it up',
    why: 'With the basics covered, small tests to your headline or main button add up.',
    step: 'Change one thing, like your button wording, and compare the next month\'s enquiries.' },
  { title: 'Review your site every quarter', effort: 'Quick win', topic: 'Keep it up',
    why: 'Websites drift out of date. A regular check catches problems before customers do.',
    step: 'Run this checkup again every 3 months and compare your score.' }
];

function questionsFor({ placesEnabled }) {
  return OWNER_QUESTIONS.filter(q => !(placesEnabled && q.id === 'google'));
}

function bandFor(score) { return BANDS.find(b => score >= b.min); }

function statusFor(points, top) {
  const ratio = points / top;
  return ratio >= 1 ? 'good' : ratio >= 0.5 ? 'fair' : 'bad';
}

function ownerEvidence(id, answerIdx, facts, year) {
  const ev = [];
  if (id === 'visits') {
    const tools = (facts.analytics || []).slice();
    if (facts.platformHasStats) tools.push(`${facts.platform}'s built-in stats`);
    if (tools.length && answerIdx !== undefined && OWNER_QUESTIONS[3].options[answerIdx].points <= 1) {
      ev.push(`Good news: your site already has ${tools.join(' and ')}. You just need to log in and look.`);
    } else if (tools.length) {
      ev.push(`We found ${tools.join(' and ')} on your site.`);
    } else {
      ev.push("We didn't find a visitor-tracking tool on your homepage.");
    }
  }
  if (id === 'fresh' && facts.copyright && facts.copyright < year) {
    ev.push(`Your footer says © ${facts.copyright}. Visitors notice old dates.`);
  }
  return ev;
}

// scan: output of scanSite(); answers: { questionId: optionIndex }
function combine(scan, answers, now = new Date()) {
  const checks = (scan && scan.checks) || {};
  const facts = (scan && scan.facts) || {};
  let earned = 0, max = 0;
  const items = [];
  AREAS.forEach((area, order) => {
    const check = checks[area.id];
    let entry = null;
    if (check && typeof check.points === 'number') {
      entry = { points: check.points, top: check.top || 3, source: check.source === 'google' ? 'google' : 'scan',
        confidence: check.confidence, evidence: check.evidence || [], nextStep: check.nextStep, issues: check.issues };
    } else {
      const q = OWNER_QUESTIONS.find(x => x.id === area.id);
      const idx = answers ? answers[area.id] : undefined;
      if (q && idx !== undefined && idx !== null && q.options[idx]) {
        entry = { points: q.options[idx].points, top: 3, source: 'owner', confidence: 'owner',
          answer: q.options[idx].label, evidence: ownerEvidence(area.id, idx, facts, now.getFullYear()) };
      }
    }
    if (!entry) return; // not checked and not answered: left out of the score
    earned += entry.points * area.weight;
    max += entry.top * area.weight;
    items.push(Object.assign({ id: area.id, topic: area.topic, weight: area.weight, order,
      lost: Math.round((entry.top - entry.points) * area.weight * 100) / 100,
      status: statusFor(entry.points, entry.top) }, entry));
  });
  if (!items.length) throw new Error('Nothing to score');
  const score = Math.round((earned / max) * 100);
  const gaps = items.filter(i => i.lost > 0)
    .sort((a, b) => (b.lost - a.lost) || (b.weight - a.weight) || (a.order - b.order));
  const steps = gaps.slice(0, 3).map(g => {
    const rec = AREAS[g.order].rec;
    return { topic: g.topic, title: rec.title, effort: rec.effort, why: rec.why, step: g.nextStep || rec.step };
  });
  for (let k = 0; steps.length < 3; k++) steps.push(MAINTAIN[k]);
  const a11y = items.find(i => i.id === 'accessibility');
  return {
    score, band: bandFor(score), steps,
    items: items.map(({ order, lost, nextStep, issues, ...rest }) => rest),
    accessibility: a11y ? { status: a11y.status, issues: a11y.issues || [] } : null,
    scanned: { url: scan && scan.finalUrl, platform: facts.platform || null, at: scan && scan.scannedAt }
  };
}

module.exports = { AREAS, OWNER_QUESTIONS, BANDS, questionsFor, combine, bandFor };
