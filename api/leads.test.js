import { describe, it, expect, vi, beforeEach } from 'vitest'

// The data endpoint is the only door to the private sheet, so its rules are tested directly: who may call it,
// which columns may never leave the server, what happens when Google or a tab is unavailable, and caching.

const USER = 'dash'
const PASS = 'p@ss:word'
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64')

const LEADS = [
  ['contact_id', 'client_name', 'protection_provider', 'protection_policy_number', 'protection_premium', 'protection_cover_amount', 'broker_fee', 'expected_procuration_fee', 'solicitor_commission', 'total_revenue', 'pipeline_stage'],
  ['c1', 'Ann Lee', 'Aviva', 'POL-1', '10', '1000', '500', '600', '700', '1800', 'Completion'],
]
const LOG = [['timestamp', 'records_processed', 'status'], ['t1', '1', 'success'], ['t2', '2', 'success'], ['t3', '3', 'success']]
const APPTS = [['appointment_id', 'contact_id'], ['e1', 'c1']]
const EVIDENCE = [['appointment_id', 'result'], ['e1', 'long_call']]
const ACTIVITY = [['day', 'caller', 'calls'], ['2026-10-21', 'Joe Nicholls', '3']]
const LOCKS = [
  ['contact_id', 'field', 'first_value', 'first_seen_at', 'current_value', 'current_seen_at'],
  ['c1', 'created_by', 'Ava Morris-Boundy', 't', 'Ava Morris-Boundy', 't'],
  ['c1', 'booked_by:e1', 'Hugo Sharpe', 't', 'Hugo Sharpe', 't'],
]

let sheets
let requests

vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    async request({ url }) {
      requests.push(url)
      const tab = decodeURIComponent(url.split('/values/')[1])
      if (!(tab in sheets)) throw new Error(`Unable to parse range: ${tab}`)
      if (sheets[tab] instanceof Error) throw sheets[tab]
      return { data: { values: sheets[tab] } }
    }
  },
}))

function res() {
  return {
    headers: {}, code: null, body: null,
    setHeader(k, v) { this.headers[k] = v },
    status(c) { this.code = c; return this },
    json(b) { this.body = b; return this },
  }
}

async function call(headers = { authorization: basic(USER, PASS) }, method = 'GET') {
  const { default: handler } = await import('./leads.js')
  const r = res()
  await handler({ method, headers }, r)
  return r
}

beforeEach(() => {
  vi.resetModules()
  requests = []
  sheets = { Leads: LEADS, Sync_Log: LOG, Appointments: APPTS, Flags: [['flag_id'], ['f1']], Field_Locks: LOCKS, Call_Evidence: EVIDENCE, Call_Activity: ACTIVITY }
  process.env.DASHBOARD_AUTH_USER = USER
  process.env.DASHBOARD_AUTH_PASS = PASS
  process.env.GOOGLE_SHEET_ID = 'sheet'
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}'
})

describe('access control', () => {
  it.each([
    ['no credentials', {}],
    ['wrong password', { authorization: basic(USER, 'nope') }],
    ['wrong user', { authorization: basic('x', PASS) }],
    ['not Basic', { authorization: 'Bearer abc' }],
    ['no colon', { authorization: 'Basic ' + Buffer.from('justuser').toString('base64') }],
    ['empty password', { authorization: basic(USER, '') }],
    ['much longer than the real one', { authorization: basic(USER, PASS.repeat(50)) }],
  ])('rejects %s without touching Google', async (_name, headers) => {
    const r = await call(headers)
    expect(r.code).toBe(401)
    expect(r.headers['WWW-Authenticate']).toContain('Basic')
    expect(requests).toEqual([])
    expect(JSON.stringify(r.body)).not.toContain('Ann Lee')
  })

  it('accepts a password that itself contains a colon', async () => {
    expect((await call({ authorization: basic(USER, PASS) })).code).toBe(200)
  })

  it('refuses everything when the credentials are not configured', async () => {
    delete process.env.DASHBOARD_AUTH_PASS
    expect((await call({ authorization: basic(USER, '') })).code).toBe(401)
  })

  it('allows only GET', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) expect((await call(undefined, method)).code).toBe(405)
  })

  it('is never cached by a browser or proxy', async () => {
    expect((await call()).headers['Cache-Control']).toBe('private, no-store')
  })
})

describe('what leaves the server', () => {
  it('drops every sensitive financial and policy column from Leads', async () => {
    const r = await call()
    expect(r.body.leads[0]).toEqual(['contact_id', 'client_name', 'total_revenue', 'pipeline_stage'])
    expect(r.body.leads[1]).toEqual(['c1', 'Ann Lee', '1800', 'Completion'])
    const everything = JSON.stringify(r.body)
    for (const secret of ['protection_provider', 'POL-1', 'Aviva', 'broker_fee', 'expected_procuration_fee', 'solicitor_commission']) expect(everything).not.toContain(secret)
  })

  it('returns only the newest Sync_Log row', async () => {
    expect((await call()).body.log).toEqual([['timestamp', 'records_processed', 'status'], ['t3', '3', 'success']])
  })

  it('returns only the Created By locks, with only the columns the dashboard uses', async () => {
    const { locks } = (await call()).body
    expect(locks).toEqual([['contact_id', 'field', 'first_value', 'first_seen_at', 'current_value'], ['c1', 'created_by', 'Ava Morris-Boundy', 't', 'Ava Morris-Boundy']])
  })

  it('passes the appointments and flags tabs through', async () => {
    const r = await call()
    expect(r.body.appointments).toEqual(APPTS)
    expect(r.body.flags).toEqual([['flag_id'], ['f1']])
  })

  it('passes the call evidence and call activity tabs through', async () => {
    const r = await call()
    expect(r.body.callEvidence).toEqual(EVIDENCE)
    expect(r.body.callActivity).toEqual(ACTIVITY)
  })
})

describe('resilience', () => {
  it('still serves the Leads data when the audit tabs do not exist yet', async () => {
    delete sheets.Appointments
    delete sheets.Flags
    delete sheets.Field_Locks
    delete sheets.Call_Evidence
    delete sheets.Call_Activity
    const r = await call()
    expect(r.code).toBe(200)
    expect(r.body.appointments).toEqual([])
    expect(r.body.flags).toEqual([])
    expect(r.body.locks).toEqual([])
    expect(r.body.callEvidence).toEqual([])
    expect(r.body.callActivity).toEqual([])
    expect(r.body.leads).toHaveLength(2)
  })

  it('shares one Google read between requests within the cache window', async () => {
    const first = await call()
    const reads = requests.length
    const second = await call()
    expect(first.headers['X-Leads-Cache']).toBe('miss')
    expect(second.headers['X-Leads-Cache']).toBe('hit')
    expect(requests.length).toBe(reads)
    expect(reads).toBe(7)
  })

  it('fails with 502 when Google is down and nothing is cached', async () => {
    sheets.Leads = new Error('google is down')
    const r = await call()
    expect(r.code).toBe(502)
    expect(r.body).toEqual({ error: 'upstream_failed' })
  })

  it('serves the last good data (stale) when Google fails after a success', async () => {
    vi.useFakeTimers()
    try {
      const ok = await call()
      expect(ok.code).toBe(200)
      vi.setSystemTime(Date.now() + 60_000) // past the 30 s cache
      sheets.Leads = new Error('google is down')
      const stale = await call()
      expect(stale.code).toBe(200)
      expect(stale.headers['X-Leads-Cache']).toBe('stale')
      expect(stale.body.leads).toEqual(ok.body.leads)
    } finally {
      vi.useRealTimers()
    }
  })
})
