'use strict';
// Optional: checks the business's Google listing with the Google Places API (New).
// Runs only when GOOGLE_PLACES_API_KEY is set. Without it, the owner answers this question instead.
// NOTE: written against Google's documented Text Search endpoint but not yet run with a live key.

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELDS = [
  'places.displayName', 'places.formattedAddress', 'places.websiteUri', 'places.businessStatus',
  'places.regularOpeningHours', 'places.photos', 'places.rating', 'places.userRatingCount'
].join(',');

function sameSite(a, b) {
  try {
    const h = u => new URL(u).hostname.replace(/^www\./, '');
    return h(a) === h(b);
  } catch (e) { return false; }
}

async function lookupPlace({ business, town, siteUrl }) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !business) return null;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify({ textQuery: [business, town].filter(Boolean).join(' '), pageSize: 5 }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error('Places lookup failed: ' + res.status);
  const data = await res.json();
  const places = data.places || [];
  const match = places.find(p => p.websiteUri && sameSite(p.websiteUri, siteUrl)) || places[0];
  const label = `"${[business, town].filter(Boolean).join(', ')}"`;
  if (!match) {
    return { points: 0, top: 3, confidence: 'medium', source: 'google',
      evidence: [`We couldn't find a Google listing for ${label}.`] };
  }
  const name = match.displayName && match.displayName.text || business;
  const hasHours = !!(match.regularOpeningHours && match.regularOpeningHours.weekdayDescriptions);
  const photos = (match.photos || []).length;
  const reviews = match.userRatingCount || 0;
  const linked = match.websiteUri && sameSite(match.websiteUri, siteUrl);
  const evidence = [`We found your Google listing: ${name}${match.formattedAddress ? ', ' + match.formattedAddress : ''}.`];
  let gaps = 0;
  if (!hasHours) { gaps++; evidence.push('It has no opening hours listed.'); }
  if (photos < 3) { gaps++; evidence.push(`It shows ${photos} photo${photos === 1 ? '' : 's'}. Aim for at least 5.`); }
  if (reviews < 10) { gaps++; evidence.push(`It has ${reviews} review${reviews === 1 ? '' : 's'}.`); }
  else evidence.push(`It has ${reviews} reviews averaging ${match.rating} stars.`);
  if (!linked) { gaps++; evidence.push("It doesn't link to the website you entered."); }
  if (match.businessStatus && match.businessStatus !== 'OPERATIONAL') {
    gaps += 2; evidence.push('Google lists this business as closed.');
  }
  return { points: Math.max(0, 3 - gaps), top: 3, confidence: places[0] === match || linked ? 'medium' : 'low',
    source: 'google', evidence };
}

module.exports = { lookupPlace };
