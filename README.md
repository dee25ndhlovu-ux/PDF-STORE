# PDF Store (EcoCash via Paynow)

Sell PDFs online. A buyer picks a book, enters name, email and EcoCash number, approves the
prompt on their phone, and a copy watermarked with their details is emailed to them automatically.

## What is in here

| File | Job |
|---|---|
| `server.js` | Web server: catalogue, checkout, Paynow polling and result webhook, fulfilment, admin API |
| `watermark.js` | Stamps buyer name, email, order ref and date on every page plus hidden metadata |
| `mailer.js` | Emails the PDF. Uses a free Ethereal test inbox if no SMTP is configured |
| `products.json` | Your catalogue (id, title, description, price, file) |
| `files/` | Master PDFs live here. Never served directly to the public |
| `public/` | Storefront (`index.html`), checkout, and admin page (`admin.html`) |

## Test it on Render in about 10 minutes

1. **Put the code on GitHub.** Create a new repository and upload this folder
   (everything except `node_modules/` and `.env`, which are already ignored).

2. **Create the Render service.** At render.com choose *New → Web Service*, connect the repo, and use:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: Free

3. **Add environment variables** (Render → your service → Environment). For a first test:

   ```
   DEMO_MODE=true
   ADMIN_PASSWORD=pick-something
   BASE_URL=https://<your-service-name>.onrender.com
   ```
   Leave the Paynow and SMTP values out for now. Demo mode simulates a successful payment so you
   can watch the whole flow: checkout → watermark → email.

4. **Deploy and open the URL.** Buy the Sample Book. Because no SMTP is set, the email goes to a
   free Ethereal test inbox and a "preview" link appears on the confirmation screen and in the
   admin Orders table, so you can open the email and download the watermarked PDF.

5. **Add your own book.** Commit a PDF into `files/`, push, then go to `/admin` (username can be
   anything, password is `ADMIN_PASSWORD`) and list it with a title and price.

## Go live with real EcoCash payments

1. Register a free merchant account at paynow.co.zw, then in *Business → Integrations* create an
   integration and copy the **Integration ID** and **Integration Key**.
2. In Render set:
   ```
   DEMO_MODE=false
   PAYNOW_INTEGRATION_ID=...
   PAYNOW_INTEGRATION_KEY=...
   ```
3. Paynow starts you in **test mode**: only the EcoCash number registered on your Paynow account
   can pay, and no money moves. Test with that number, then ask Paynow to set the integration live.
4. Set real email sending (any SMTP provider works; Brevo and SendGrid have free tiers):
   ```
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587
   SMTP_USER=...
   SMTP_PASS=...
   FROM_EMAIL="Legal Mind <you@yourdomain.com>"
   ```

## Things to know

- **Orders are kept in memory.** On the free Render tier the service restarts when idle, which
  clears the order list (buyers already emailed are unaffected). Before you rely on order history,
  swap the `orders` Map in `server.js` for a database (Render offers a free Postgres instance).
- **`products.json` and `files/` are part of the repo.** Adding a product through `/admin` works
  immediately but is lost on the next deploy or restart on Render's free tier; to make it permanent,
  also commit the change to `products.json`. Long term, move both to storage such as Cloudflare R2
  or a database.
- **Free tier sleeps.** The first visit after 15 idle minutes takes ~30 seconds to wake up.
  A paid instance (~US$7/month) removes this.
- **Watermarking is traceability, not a lock.** It marks whose copy leaked; it does not stop
  forwarding.

## Run locally

```
npm install
cp .env.example .env      # set DEMO_MODE=true for a first run
npm start                 # open http://localhost:3000
```
