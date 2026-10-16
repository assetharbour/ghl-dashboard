// The browser never talks to Google. /api/leads (api/leads.js) reads the private
// sheet with a service account; the browser's Basic Auth credentials are sent
// automatically because it is the same origin.
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
  const { leadsValues, logValues } = await fetchViaServer()
  const rows = parseTable(leadsValues)
  const lastLogRow = logValues.length > 1 ? logValues[logValues.length - 1] : null
  const lastSync = lastLogRow ? lastLogRow[0] : null
  return { rows, lastSync }
}
