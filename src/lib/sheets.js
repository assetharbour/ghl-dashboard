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
  if (!API_KEY) {
    console.error(
      'VITE_SHEETS_API_KEY is missing. Copy .env.example to .env and set your Google Sheets API key.'
    )
    throw new Error('Missing VITE_SHEETS_API_KEY. See console for setup instructions.')
  }
  const [leadsValues, logValues] = await Promise.all([fetchTab('Leads'), fetchTab('Sync_Log')])
  const rows = parseTable(leadsValues)
  const lastLogRow = logValues.length > 1 ? logValues[logValues.length - 1] : null
  const lastSync = lastLogRow ? lastLogRow[0] : null
  return { rows, lastSync }
}
