// The browser never talks to Google. /api/leads (api/leads.js) reads the private
// sheet with a service account; the browser's Basic Auth credentials are sent
// automatically because it is the same origin.
async function fetchViaServer() {
  // Development preview only: ?mock in the URL loads synthetic data. `import.meta.env.DEV` is false in a
  // production build, so this branch and mockData.js are removed from what ships.
  const mock = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('mock') : null
  if (mock !== null) {
    const { mockPayload } = await import('./mockData.js')
    return mockPayload(mock)
  }
  const res = await fetch('/api/leads', { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Leads API ${res.status}`)
  const data = await res.json()
  return {
    leadsValues: data.leads || [],
    logValues: data.log || [],
    appointmentsValues: data.appointments || [],
    flagsValues: data.flags || [],
    locksValues: data.locks || [],
    callEvidenceValues: data.callEvidence || [],
    callActivityValues: data.callActivity || [],
    leadSpeedValues: data.leadSpeed || [],
  }
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
  const { leadsValues, logValues, appointmentsValues, flagsValues, locksValues, callEvidenceValues, callActivityValues, leadSpeedValues } = await fetchViaServer()
  const rows = parseTable(leadsValues)
  const lastLogRow = logValues.length > 1 ? logValues[logValues.length - 1] : null
  const lastSync = lastLogRow ? lastLogRow[0] : null
  return {
    rows,
    lastSync,
    appointments: parseTable(appointmentsValues),
    flags: parseTable(flagsValues),
    locks: parseTable(locksValues),
    callEvidence: parseTable(callEvidenceValues || []),
    callActivity: parseTable(callActivityValues || []),
    leadSpeed: parseTable(leadSpeedValues || []),
  }
}
