import { describe, it, expect, vi, beforeEach } from 'vitest'

// The only endpoint that writes to the sheet: who may call it, what it accepts, and exactly which cells it touches.

const USER = 'dash'
const PASS = 'p@ss:word'
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64')

const HEADER = ['flag_id', 'detected_at', 'type', 'contact_id', 'field', 'old_value', 'new_value', 'locked_value', 'appointment_id', 'detail', 'status']

let flagsTab
let calls
let failWith
let columnCount

vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    async request({ url, method, data }) {
      calls.push({ url, method: method || 'GET', data })
      if (failWith) throw failWith
      if (!method && url.includes('fields=sheets.properties')) return { data: { sheets: [{ properties: { sheetId: 1, title: 'Other' } }, { properties: { sheetId: 77, title: 'Flags', gridProperties: { columnCount } } }] } }
      if (!method) return { data: { values: flagsTab } }
      return { data: {} }
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

async function call(body, { headers = { authorization: basic(USER, PASS) }, method = 'POST' } = {}) {
  const { default: handler } = await import('./flags.js')
  const r = res()
  await handler({ method, headers, body }, r)
  return r
}

const writes = () => calls.find((c) => c.method === 'POST' && c.url.endsWith('/values:batchUpdate'))?.data
const widen = () => calls.find((c) => c.method === 'POST' && !c.url.includes('/values'))?.data

beforeEach(() => {
  vi.resetModules()
  calls = []
  failWith = null
  columnCount = 11 // the sync creates the tab exactly as wide as its own columns
  flagsTab = [HEADER, ['f1', 't', 'booked_by_missing', 'c1', '', '', '', '', 'e1', 'd', 'open'], ['f2', 't', 'showed_without_call', 'c2', '', '', '', '', 'e2', 'd', 'open']]
  process.env.DASHBOARD_AUTH_USER = USER
  process.env.DASHBOARD_AUTH_PASS = PASS
  process.env.GOOGLE_SHEET_ID = 'sheet'
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}'
})

describe('access control', () => {
  it('rejects a request without the dashboard login, without touching Google', async () => {
    const r = await call({ flag_id: 'f1', status: 'resolved' }, { headers: {} })
    expect(r.code).toBe(401)
    expect(calls).toEqual([])
  })

  it('allows only POST', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) expect((await call({ flag_id: 'f1', status: 'resolved' }, { method })).code).toBe(405)
    expect(calls).toEqual([])
  })

  it.each([
    ['no body', undefined],
    ['unknown status', { flag_id: 'f1', status: 'deleted' }],
    ['missing flag id', { status: 'resolved' }],
    ['a flag id that could be a range', { flag_id: "Leads!A1'", status: 'resolved' }],
    ['broken JSON', '{nope'],
  ])('rejects %s', async (_name, body) => {
    expect((await call(body)).code).toBe(400)
    expect(calls).toEqual([])
  })
})

describe('writing the status', () => {
  it('marks one flag resolved and adds the resolved_at / resolved_via columns at the end', async () => {
    const r = await call({ flag_id: 'f2', status: 'resolved' })
    expect(r.code).toBe(200)
    expect(r.body).toMatchObject({ flag_id: 'f2', status: 'resolved' })
    const { valueInputOption, data } = writes()
    expect(valueInputOption).toBe('RAW')
    expect(data).toEqual([
      { range: 'Flags!L1', values: [['resolved_at']] },
      { range: 'Flags!M1', values: [['resolved_via']] },
      { range: 'Flags!K3', values: [['resolved']] },
      { range: 'Flags!L3', values: [[r.body.resolved_at]] },
      { range: 'Flags!M3', values: [['dashboard']] },
    ])
    expect(r.body.resolved_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
  })

  it('widens the Flags tab first, because Google refuses a write outside the grid', async () => {
    await call({ flag_id: 'f2', status: 'resolved' })
    expect(widen()).toEqual({ requests: [{ appendDimension: { sheetId: 77, dimension: 'COLUMNS', length: 2 } }] })
    const order = calls.filter((c) => c.method === 'POST').map((c) => (c.url.includes('/values') ? 'values' : 'widen'))
    expect(order).toEqual(['widen', 'values'])
  })

  it('does not widen a tab that is already wide enough', async () => {
    columnCount = 26
    await call({ flag_id: 'f2', status: 'resolved' })
    expect(widen()).toBeUndefined()
    expect(writes()).toBeDefined()
  })

  it('reuses the extra columns once they exist, and clears them when a flag is opened again', async () => {
    flagsTab[0] = [...HEADER, 'resolved_at', 'resolved_via']
    flagsTab[1] = [...flagsTab[1].slice(0, 10), 'resolved', '2026-11-19T10:00:00Z', 'dashboard']
    const r = await call({ flag_id: 'f1', status: 'open' })
    expect(r.code).toBe(200)
    expect(calls.some((c) => c.url.includes('fields=sheets.properties'))).toBe(false) // columns exist: no metadata read
    expect(writes().data).toEqual([
      { range: 'Flags!K2', values: [['open']] },
      { range: 'Flags!L2', values: [['']] },
      { range: 'Flags!M2', values: [['']] },
    ])
  })

  it('answers 404 for a flag that is not in the tab and writes nothing', async () => {
    expect((await call({ flag_id: 'nope', status: 'resolved' })).code).toBe(404)
    expect(writes()).toBeUndefined()
  })

  it('says so when the service account has no edit access', async () => {
    failWith = Object.assign(new Error('forbidden'), { response: { status: 403 } })
    const r = await call({ flag_id: 'f1', status: 'resolved' })
    expect(r.code).toBe(403)
    expect(r.body).toEqual({ error: 'no_write_access' })
  })

  it('accepts a JSON string body', async () => {
    expect((await call(JSON.stringify({ flag_id: 'f1', status: 'resolved' }))).code).toBe(200)
  })
})

describe('saving a note', () => {
  it('adds the note and noted_at columns the first time and writes only those two cells', async () => {
    const r = await call({ flag_id: 'f2', note: 'Client rang back on his mobile, call was 25 min' })
    expect(r.code).toBe(200)
    expect(r.body).toMatchObject({ flag_id: 'f2', note: 'Client rang back on his mobile, call was 25 min' })
    expect(r.body.status).toBeUndefined() // the status is left alone
    expect(writes().data).toEqual([
      { range: 'Flags!L1', values: [['note']] },
      { range: 'Flags!M1', values: [['noted_at']] },
      { range: 'Flags!L3', values: [['Client rang back on his mobile, call was 25 min']] },
      { range: 'Flags!M3', values: [[r.body.noted_at]] },
    ])
    expect(widen()).toEqual({ requests: [{ appendDimension: { sheetId: 77, dimension: 'COLUMNS', length: 2 } }] })
  })

  it('saves a note and marks the flag sorted in one write, after the existing status columns', async () => {
    flagsTab[0] = [...HEADER, 'resolved_at', 'resolved_via']
    columnCount = 13
    const r = await call({ flag_id: 'f1', status: 'resolved', note: 'Checked with Ben' })
    expect(r.code).toBe(200)
    expect(writes().data).toEqual([
      { range: 'Flags!N1', values: [['note']] },
      { range: 'Flags!O1', values: [['noted_at']] },
      { range: 'Flags!K2', values: [['resolved']] },
      { range: 'Flags!L2', values: [[r.body.resolved_at]] },
      { range: 'Flags!M2', values: [['dashboard']] },
      { range: 'Flags!N2', values: [['Checked with Ben']] },
      { range: 'Flags!O2', values: [[r.body.noted_at]] },
    ])
  })

  it('clears a note, and keeps it on one line', async () => {
    flagsTab[0] = [...HEADER, 'note', 'noted_at']
    columnCount = 13
    expect((await call({ flag_id: 'f1', note: '  ' })).body).toMatchObject({ note: '', noted_at: '' })
    calls = []
    expect((await call({ flag_id: 'f1', note: 'line one\nline two' })).body.note).toBe('line one line two')
  })

  it.each([
    ['a note that is not text', { flag_id: 'f1', note: 42 }, 'bad_request'],
    ['a bad status next to a note', { flag_id: 'f1', status: 'deleted', note: 'x' }, 'bad_request'],
    ['a note that is too long', { flag_id: 'f1', note: 'x'.repeat(501) }, 'note_too_long'],
  ])('rejects %s and writes nothing', async (_name, body, error) => {
    const r = await call(body)
    expect(r.code).toBe(400)
    expect(r.body).toEqual({ error })
    expect(calls).toEqual([])
  })
})

describe('columnLetter', () => {
  it('counts like a spreadsheet', async () => {
    const { columnLetter } = await import('./flags.js')
    expect([0, 10, 25, 26, 27, 51, 52].map(columnLetter)).toEqual(['A', 'K', 'Z', 'AA', 'AB', 'AZ', 'BA'])
  })
})
