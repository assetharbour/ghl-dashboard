# GHL Dashboard — Asset Harbour Mortgage

React reporting dashboard reading live data from the private Google Sheet
that `ghl-reporting-sync` writes to every 15 minutes.

## Stack

- Vite + React 18 (JavaScript)
- Tailwind CSS
- Recharts
- One Vercel serverless function, `api/leads.js`, which reads the **private**
  sheet with a Google service account (read-only scope) and returns the Leads
  rows plus the newest `Sync_Log` row. It caches for 30 s, serves the last good
  data if Google briefly fails, and drops sensitive columns the dashboard never
  shows. The browser never talks to Google and there is no Google key in the
  client bundle.

## Environment variables (Vercel → Project Settings)

| Name | Purpose |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account key (sensitive). The account needs access to the sheet |
| `GOOGLE_SHEET_ID` | The Leads sheet id |
| `DASHBOARD_AUTH_USER`, `DASHBOARD_AUTH_PASS` | Basic Auth login for the whole site, including `/api/leads` |

See `.env.example`. Never commit real values.

## Local development

`/api/leads` is a Vercel function, so plain `npm run dev` (Vite) does not serve
it. Use `vercel dev` (after `vercel link` and `vercel env pull`), which runs
both the app and the function.

## Access

This dashboard requires Basic Auth to view. Credentials are stored as
Vercel environment variables (`DASHBOARD_AUTH_USER`, `DASHBOARD_AUTH_PASS`)
under Project Settings → Environment Variables. To change the password,
update `DASHBOARD_AUTH_PASS` and redeploy — a redeploy is required for
the new value to take effect, editing the env var alone does not update
a live deployment.

Auth is enforced at Vercel's edge via `middleware.js` (Vercel Routing
Middleware), before any page content, JS/CSS bundle or API response is served,
and `api/leads.js` re-checks the same credentials itself.
