# Belaris Website Checkup

Lead-generation tool for small business owners. A visitor enters their website, answers 4 quick
questions while the site is scanned, enters their email, and gets a score out of 100 with three
prioritized next steps and an accessibility report.

## What gets checked

| Area | How | Weight |
|---|---|---|
| Works on phones | Scan: mobile setup, sideways scrolling, tiny text, tiny tap targets | 1.5 |
| Easy to contact | Scan: call/book/buy buttons on the first screen, tap-to-call, forms | 1.5 |
| Loading speed | Scan: main content load time on a simulated 4G phone, page weight | 1.2 |
| Clear message | Scan: Claude reads the top of the homepage (rule-based check if no API key) | 1.2 |
| Accessibility | Scan: axe-core, WCAG 2.1 A/AA rules, translated to plain language | 1.2 |
| Found on Google | Owner answer | 1.2 |
| Google Business Profile | Google Places API if configured, otherwise owner answer | 1.0 |
| Reviews and proof | Scan: testimonials, review widgets, review markup | 1.0 |
| Secure connection | Scan: valid HTTPS, http->https redirect, insecure files | 1.0 |
| Up-to-date info | Owner answer (+ flags an old copyright year) | 0.8 |
| Know your visitors | Owner answer (+ detects Google Analytics etc. and platform stats) | 0.8 |

If a check can't run, it is left out of the score rather than counted as zero.

## Run locally

    npm install
    npx playwright install chromium
    npm start              # http://localhost:3000
    npm test

## Settings (environment variables)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on the AI "clear message" review. Without it a simple rule-based check runs. |
| `CLARITY_MODEL` | Model for the clarity review. Default `claude-opus-5-5`; `claude-haiku-5-5` is much cheaper. |
| `GOOGLE_PLACES_API_KEY` | Checks the Google listing automatically and drops that question. |
| `LEAD_WEBHOOK_URL` | Each lead is POSTed here as JSON (e.g. a Zapier/Make hook into your CRM or email tool). |
| `DATA_DIR` | Where `leads.jsonl` is written. Default `./data`. Use a persistent disk. |
| `SCANS_PER_HOUR` | Scans allowed per visitor IP per hour. Default 5. |
| `MAX_CONCURRENT_SCANS` | Scans run at once. Default 2 (each uses a browser tab, ~150-300 MB RAM). |
| `TRUST_PROXY` | Set to `1` behind a load balancer so rate limits use the real visitor IP. |
| `ALLOW_PRIVATE` | Tests only. Never set in production. |

Set the booking link in `public/index.html` (`bookingUrl`).

## Hosting

The scanner runs a real headless browser, so it needs a host that runs Docker or Node with Chromium:
Render, Railway, Fly.io, or a small VPS (1 GB RAM minimum, 2 GB recommended). It will not run on
WordPress, Wix or Squarespace hosting, or on serverless functions with short time limits.

Recommended setup: deploy this container at `checkup.belaris.com` and link to it (or embed it) from
the main Belaris site.

## Security notes

- Visitors choose the URL the server fetches. Addresses on private networks are blocked before
  loading and on every request the page makes. Also run the container on a network with no
  access to internal services; that is the strongest protection.
- Results are only returned after the email form is submitted. A hidden honeypot field filters basic bots.
- Rate limits and the 24-hour result cache are in memory and reset on restart.

## WordPress plugin

`wordpress-plugin/belaris-checkup/` (packaged as `dist/belaris-checkup.zip`) puts the checkup on a WordPress
page with `[belaris_checkup]`, passes requests to this server with `CHECKUP_API_KEY`, stores leads under
"Checkup Leads", emails you and the visitor, and can send each lead to a webhook. See INSTALL.md.

## Not built yet

- Search-ranking check ("Found on Google" is still an owner question).
- The Google listing lookup and the AI headline review have not been run with live API keys yet.
