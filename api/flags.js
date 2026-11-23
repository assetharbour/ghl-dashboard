import { GoogleAuth } from 'google-auth-library'
import { isAuthorized } from './_auth.js'

// Marks one flag as sorted (or opens it again), and/or saves a manager's note on it, in the Flags tab of the private sheet.
//
// POST /api/flags  { "flag_id": "...", "status"?: "resolved" | "open", "note"?: "why it was sorted" }   (at least one of the two)
//
// The Flags tab is written by the sync's field audit (ghl-reporting-sync/app/audit_runner.py). The sync only ever
// APPENDS flags whose flag_id it has not seen, and when it refreshes a flag it rewrites only its own columns (A to K,
// app/audit_store.py TabStore.upsert), so anything set here stays as it is. Our columns are added at the END of the tab
// (the sync's header contract allows extra trailing columns): resolved_at (when it was marked) and resolved_via
// ("dashboard") for a status, note and noted_at (when the note was last saved) for a note. Each column is only added
// the first time it is needed. Only this endpoint writes to the sheet, and only those cells of one existing row.

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const TAB = 'Flags'
const STATUSES = new Set(['resolved', 'open'])
const FLAG_ID = /^[A-Za-z0-9_-]{1,64}$/ // the sync's ids are 16 hex characters
const STATUS_EXTRA = ['resolved_at', 'resolved_via']
const NOTE_EXTRA = ['note', 'noted_at']
export const NOTE_MAX = 500

let auth

function google() {
  auth ??= new GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON), scopes: [SCOPE] })
  return auth
}

/** 0 -> A, 25 -> Z, 26 -> AA */
export function columnLetter(index) {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Makes the Flags tab at least `count` columns wide. */
async function ensureColumns(sheetId, count) {
  const meta = await google().request({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title,gridProperties.columnCount)`,
  })
  const tab = (meta.data.sheets || []).map((s) => s.properties).find((p) => p.title === TAB)
  if (!tab) throw Object.assign(new Error('Flags tab not found'), { response: { status: 409 } })
  const have = tab.gridProperties?.columnCount ?? 0
  if (have >= count) return
  await google().request({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
    method: 'POST',
    data: { requests: [{ appendDimension: { sheetId: tab.sheetId, dimension: 'COLUMNS', length: count - have } }] },
  })
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return null
    }
  }
  return null
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')

  if (!isAuthorized(req.headers.authorization)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Asset Harbour Reporting Dashboard"')
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const body = readBody(req)
  const flagId = typeof body?.flag_id === 'string' ? body.flag_id : ''
  const status = body?.status
  const hasStatus = status !== undefined
  const hasNote = body?.note !== undefined
  if (!FLAG_ID.test(flagId) || (!hasStatus && !hasNote)) return res.status(400).json({ error: 'bad_request' })
  if (hasStatus && !STATUSES.has(status)) return res.status(400).json({ error: 'bad_request' })
  if (hasNote && typeof body.note !== 'string') return res.status(400).json({ error: 'bad_request' })
  // One line of plain text: line breaks become spaces so the sheet stays readable.
  const note = hasNote ? body.note.replace(/[\r\n\t]+/g, ' ').trim() : ''
  if (note.length > NOTE_MAX) return res.status(400).json({ error: 'note_too_long' })

  const sheetId = process.env.GOOGLE_SHEET_ID
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values`
  try {
    const read = await google().request({ url: `${base}/${encodeURIComponent(TAB)}` })
    const values = read.data.values || []
    const header = values[0] || []
    const idCol = header.indexOf('flag_id')
    const statusCol = header.indexOf('status')
    if (idCol === -1 || statusCol === -1) return res.status(409).json({ error: 'flags_tab_unexpected' })

    const offset = values.findIndex((row, i) => i > 0 && row[idCol] === flagId)
    if (offset === -1) return res.status(404).json({ error: 'flag_not_found' })
    const rowNumber = offset + 1 // values[0] is sheet row 1

    const data = []
    const cols = {}
    let width = header.length
    const needed = [...(hasStatus ? STATUS_EXTRA : []), ...(hasNote ? NOTE_EXTRA : [])]
    for (const name of needed) {
      let i = header.indexOf(name)
      if (i === -1) {
        i = width
        width += 1
        data.push({ range: `${TAB}!${columnLetter(i)}1`, values: [[name]] })
      }
      cols[name] = i
    }
    // The sync created the tab exactly as wide as its own columns, and Google refuses a write outside the grid
    // ("exceeds grid limits"), so the first time the extra columns are needed the tab is widened.
    if (width > header.length) await ensureColumns(sheetId, width)
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    const cell = (col, value) => data.push({ range: `${TAB}!${columnLetter(col)}${rowNumber}`, values: [[value]] })
    const result = { flag_id: flagId }
    if (hasStatus) {
      const resolved = status === 'resolved'
      cell(statusCol, status)
      cell(cols.resolved_at, resolved ? now : '')
      cell(cols.resolved_via, resolved ? 'dashboard' : '')
      Object.assign(result, { status, resolved_at: resolved ? now : '' })
    }
    if (hasNote) {
      cell(cols.note, note)
      cell(cols.noted_at, note ? now : '')
      Object.assign(result, { note, noted_at: note ? now : '' })
    }

    await google().request({
      url: `${base}:batchUpdate`,
      method: 'POST',
      data: { valueInputOption: 'RAW', data },
    })
    return res.status(200).json(result)
  } catch (err) {
    const code = err?.response?.status
    console.error('flag update failed:', code || '', err?.message || err)
    // 403 = the service account can read the sheet but has not been given edit access.
    return res.status(code === 403 ? 403 : 502).json({ error: code === 403 ? 'no_write_access' : 'upstream_failed' })
  }
}
