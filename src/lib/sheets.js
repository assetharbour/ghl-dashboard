// Transitional direct-to-Google read, used only if /api/leads fails AND a public
// API key is still configured. Delete this block (and VITE_SHEETS_API_KEY) once
// the sheet is Restricted, since a direct read cannot work on a private sheet.
const SHEET_ID = '1c0x6wpsEVBGvrzMpb2NT2i_829rjoFwh_2784i921rk'
const API_KEY = import.meta.env.VITE_SHEETS_API_KEY
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values`

async function fetchTab(tab) {
  const res = await fetch(`${BASE}/${encodeURIComponent(tab)}?key=${API_KEY}`)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Sheets API ${res.status} for tab "${tab}": ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  return data.values || []
}

async function fetchDirect() {
  const [leadsValues, logValues] = await Promise.all([fetchTab('Leads'), fetchTab('Sync_Log')])
  return { leadsValues, logValues }
}

// The server function reads the private sheet with a service account; the
// browser's Basic Auth credentials are sent automatically (same origin).
async function fetchViaServer() {
  const res = await fetch('/api/leads', { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Leads API ${res.status}`)
  const data = await res.json()
  return { leadsValues: data.leads || [], logValues: data.log || [] }
}

function parseTable(values) {
  if (values.length < 1) return []
  const headers = values[0]
  return values.slice(1).map((row) => {
    const obj = {}
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? ''
    })
    return obj
  })
}

export async function fetchDashboardData() {
  let tabs
  try {
    tabs = await fetchViaServer()
  } catch (err) {
    if (!API_KEY) throw err
    console.warn('Leads API failed, falling back to a direct Sheets read:', err.message)
    tabs = await fetchDirect()
  }
  const { leadsValues, logValues } = tabs
  const rows = parseTable(leadsValues)
  const lastLogRow = logValues.length > 1 ? logValues[logValues.length - 1] : null
  const lastSync = lastLogRow ? lastLogRow[0] : null
  return { rows, lastSync }
}
