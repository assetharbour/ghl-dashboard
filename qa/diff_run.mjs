import fs from 'node:fs'
process.env.TZ = 'Europe/London'
const { buildSalesTable, advisorDistribution } = await import('../src/lib/sales.js')
const { now, cases } = JSON.parse(fs.readFileSync(new URL('./diff_cases.json', import.meta.url), 'utf8'))
const NOW = new Date(now)
const team = ['Harry Kalsi', 'Ava Morris-Boundy', 'Hugo Sharpe']
const out = cases.map((c) => {
  const opts = (group) => ({ start: c.start ? new Date(c.start) : null, end: c.end ? new Date(c.end) : null, group, salesTeam: team })
  const pack = (table) => Object.fromEntries(table.map((r) => [r.person, r]))
  const fair = Object.fromEntries(advisorDistribution(c.appts, ['Henny Lessey', 'Joe Nicholls', 'Xavier Collin', 'Cecilia Szabo'], { start: c.start ? new Date(c.start) : null, end: c.end ? new Date(c.end) : null }).map((r) => [r.person, [r.appointments, r.share, null]]))
  return { fair, booker: pack(buildSalesTable(c.appts, c.contacts, NOW, opts('booker'))), advisor: pack(buildSalesTable(c.appts, c.contacts, NOW, opts('advisor'))) }
})
process.stdout.write(JSON.stringify(out))
