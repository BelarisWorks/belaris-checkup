# Setting up the Belaris Website Checkup

There are two pieces:

1. **The scanner.** A small server that visits websites in a real browser. It runs on Render (or a similar host), because GoDaddy's WordPress hosting can't run a browser.
2. **The WordPress plugin.** It puts the checkup on a page of belaris.com, saves leads in your WordPress dashboard, and sends the emails. Visitors never see the scanner's address.

Plan on about an hour the first time.

---

## Part 1: Put the scanner online (Render)

1. **Make a secret key.** This is a password that lets only your WordPress site use the scanner. Use a password manager to generate 32+ random characters and save it. You'll paste it in two places.
2. **Put this project on GitHub.** Render deploys from a GitHub repository. Use a private repository. (I can do this step for you if you connect GitHub to this session.)
3. In Render: **New → Web Service →** pick the repository. Render detects the `Dockerfile`.
4. **Instance size:** the scanner runs a browser, which needs memory. Use an instance with **at least 1 GB of RAM** (2 GB is comfortable). On a smaller one, set `MAX_CONCURRENT_SCANS` to `1`. Check Render's current pricing; expect roughly $7 to $25 a month.
5. **Environment variables:**

   | Name | Value |
   |---|---|
   | `CHECKUP_API_KEY` | your secret key from step 1 |
   | `SAVE_LEADS` | `0` (WordPress stores the leads) |
   | `TRUST_PROXY` | `1` |
   | `ANTHROPIC_API_KEY` | optional: turns on the AI "clear message" review |
   | `GOOGLE_PLACES_API_KEY` | optional: checks Google listings automatically |

6. **Health check path:** `/health`
7. Deploy. When it's live, open `https://YOUR-SERVICE.onrender.com/health` in a browser. It should say `{"ok":true}`.

## Part 2: Install the plugin on belaris.com (GoDaddy WordPress)

1. WordPress dashboard → **Plugins → Add New → Upload Plugin** → choose `belaris-checkup.zip` → **Install** → **Activate**.
2. **Settings → Website Checkup:**
   - **Scanner address:** `https://YOUR-SERVICE.onrender.com`
   - **Scanner key:** the same secret key
   - **Send new-lead alerts to:** your inbox
   - **"Book a free review" link** and **Privacy policy link**
   - Save. The box at the top should say **Scanner: Connected.**
3. **Pages → Add New**, name it something like "Free Website Checkup", add a Shortcode block containing `[belaris_checkup]`, and publish.
4. If you use a caching plugin, make sure it doesn't cache `/wp-json/` requests. Most don't by default.

## Part 3: Make sure emails arrive (important)

WordPress on GoDaddy sends email in a way that often lands in spam or is silently dropped. Since emails are the whole point of a lead tool:

1. Install the free **WP Mail SMTP** plugin.
2. Connect it to the mailbox you already use for belaris.com (Google Workspace, Microsoft 365, or GoDaddy email).
3. Use its **Email Test** tab to confirm delivery.

## Part 4: Test it yourself

1. Open your new page on your phone and run the checkup on your own site.
2. Check that:
   - the result appears,
   - you get the new-lead alert,
   - the visitor copy arrives at the email you entered,
   - the lead shows under **Checkup Leads** in the dashboard.

## Later: send leads to SuiteDash

In **Settings → Website Checkup → Send leads to (webhook)**, paste a Zapier (or Make) "catch hook" URL. In Zapier, add a SuiteDash step that creates a contact from the fields (name, email, business, website, score, weak areas, marketing OK). Check that your SuiteDash plan includes its Zapier integration before relying on this.

## Where leads live

- WordPress: **Checkup Leads** menu. You can open each one for details or **Export all to CSV**.
- Only follow up with marketing when "OK to market" is **Yes**. The others agreed to receive their results, not newsletters.
