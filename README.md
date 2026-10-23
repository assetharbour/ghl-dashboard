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

## Sales Team and Flags pages

* `/sales` (Sales Team): appointments booked, showed, no-shows, cancelled, rebooked, full fact finds, completed, and the two
  conversion rates per sales rep (booked -> full fact find, booked -> completed), per advisor, per week, appointments per advisor,
  the next working week, full fact finds by month, leads added per locked Created By, and the appointment list. The date range
  (top right) applies to the day each appointment was **booked**. Weekly and monthly presets (This week, Last week, This month,
  Last month) were added to the shared date range and work on every page.
* `/flags` (Flags): changes and mismatches found by the sync's field audit (Created By / Booked By changed or cleared, Booked By
  missing or not matching the calendar, advisor mismatch, appointment given to a non-advisor, new booking source).
* Data: `api/leads.js` now also returns the `Appointments`, `Flags` and `Field_Locks` (Created By rows only) tabs. A tab that does
  not exist yet is returned empty, so the Leads data never depends on them. These tabs are written by `ghl-reporting-sync`
  (`FIELD_AUDIT=on`); the Leads tab gained `fact_find_outcome`, `fact_find_date` and `docs_requested` columns.
* The KPI definitions live in `src/lib/sales.js`, a port of `ghl-reporting-sync/app/sales_metrics.py` (the agreed definitions
  and tests). Change both together.
* Tests: `npm test` (vitest). Preview with sample data: `npm run dev` and open `/sales?mock` (development only; the sample data
  is not part of the production build).

## QA

The 22 Oct 2026 QA report (approach, results, defect log, UAT checklist, residual risks, how to repeat) is `../ghl-reporting-sync/docs/qa/QA_REPORT_2026-10-22.md`.

## Leadership board (`/leadership`)

One clean page for the people running the business, second in the sidebar. Headline cards (leads received, appointments booked, show rate, full fact
finds, completions, revenue recorded), five "top of the board" honours (top booker, fastest first call, top advisor, top of handover, top introducer),
leaderboards for the sales team, advisors and handover team, speed to lead, the lead-to-completion funnel, a 12-week trend, the top introducers and a
"needs attention" strip. Logic and tests: `src/lib/leadership.js`, `src/lib/leadership.test.js`.

Definitions: leads, introducers and the funnel are the leads CREATED in the date range; appointments are the S3 calendar BOOKED in the range (same as the Sales
Team page); a completion is the Completion stage and is counted in the period it COMPLETED (completion date inside the range, every one for All time), so a case that
completes this month counts this month whatever its age; revenue counts only recorded fees. Speed to lead (from the `Lead_Speed` tab) is shown per person only from three
first calls; nobody is named a winner with a zero. Cases owned by people outside the four handover admins are not ranked.
