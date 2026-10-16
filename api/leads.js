import { timingSafeEqual } from 'node:crypto'
import { GoogleAuth } from 'google-auth-library'

// Server-side reader for the private Leads sheet. The browser never talks to
// Google: it calls this function, which reads the sheet with the service
// account. The credentials never leave the server.

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const CACHE_MS = 30_000

// Sensitive financial/policy columns the dashboard never displays; dropped here
// so they never leave the server.
const OMIT_COLUMNS = new Set([
  'protection_provider',
  'protection_policy_number',
  'protection_premium',
  'protection_cover_amount',
  'broker_fee',
  'expected_procuration_fee',
  'solicitor_commission',
])

let auth
let cache = { at: 0, body: null }
let inflight = null

function safeEqual(a, b) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// Same credentials as middleware.js. Re-checked here so this endpoint stays
// locked even if the middleware matcher is ever changed.
function isAuthorized(header) {
  const user = process.env.DASHBOARD_AUTH_USER
  const pass = process.env.DASHBOARD_AUTH_PASS
  if (!user || !pass || !header || !header.startsWith('Basic ')) return false
  let decoded
  try {
    decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
  } catch {
    return false
  }
  const i = decoded.indexOf(':')
  if (i === -1) return false
  return safeEqual(decoded.slice(0, i), user) && safeEqual(decoded.slice(i + 1), pass)
}

async function readTab(sheetId, tab) {
  if (!auth) {
    auth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: [SCOPE],
    })
  }
  const res = await auth.request({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}`,
  })
  return res.data.values || []
}

function dropColumns(values) {
  if (!values.length) return values
  const keep = values[0].map((header) => !OMIT_COLUMNS.has(header))
  return values.map((row) => row.filter((_, i) => keep[i] !== false))
}

async function load() {
  const sheetId = process.env.GOOGLE_SHEET_ID
  const [leads, log] = await Promise.all([readTab(sheetId, 'Leads'), readTab(sheetId, 'Sync_Log')])
  // The dashboard only needs the newest Sync_Log row (for "Updated X min ago").
  return { leads: dropColumns(leads), log: log.length > 1 ? [log[0], log[log.length - 1]] : log }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')

  if (!isAuthorized(req.headers.authorization)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Asset Harbour Reporting Dashboard"')
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const fresh = cache.body !== null && Date.now() - cache.at < CACHE_MS
  try {
    if (!fresh) {
      // One Google read shared by every request that arrives while it is running.
      inflight ??= load()
        .then((body) => {
          cache = { at: Date.now(), body }
        })
        .finally(() => {
          inflight = null
        })
      await inflight
    }
    res.setHeader('X-Leads-Cache', fresh ? 'hit' : 'miss')
    return res.status(200).json(cache.body)
  } catch (err) {
    console.error('leads proxy failed:', err?.message || err)
    if (cache.body) {
      // Serve the last good data rather than blanking the dashboard.
      res.setHeader('X-Leads-Cache', 'stale')
      return res.status(200).json(cache.body)
    }
    return res.status(502).json({ error: 'upstream_failed' })
  }
}
