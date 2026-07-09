# GHL Dashboard — Asset Harbour Mortgage

React reporting dashboard reading live data from the same Google Sheet
that `ghl-reporting-sync` writes to every 15 minutes.

## Stack

- Vite + React 18 (JavaScript)
- Tailwind CSS
- Recharts
- Reads Google Sheets directly via the Sheets API v4 values endpoint
  (`VITE_SHEETS_API_KEY`), no backend of its own

## Local development

1. Copy `.env.example` to `.env` and set `VITE_SHEETS_API_KEY`
2. `npm install`
3. `npm run dev`

## Access

This dashboard requires Basic Auth to view. Credentials are stored as
Vercel environment variables (`DASHBOARD_AUTH_USER`, `DASHBOARD_AUTH_PASS`)
under Project Settings → Environment Variables. To change the password,
update `DASHBOARD_AUTH_PASS` and redeploy — a redeploy is required for
the new value to take effect, editing the env var alone does not update
a live deployment.

Auth is enforced at Vercel's edge via `middleware.js` (Vercel Routing
Middleware), before any page content, JS/CSS bundle, or the Sheets API
key baked into the client bundle is served — not a client-side check.
