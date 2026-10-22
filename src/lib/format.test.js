process.env.TZ = 'Europe/London'

import { describe, it, expect } from 'vitest'
import { neutraliseFormula, toCSV, fmtPct, fmtInt, fmtDate, DASH } from './format'

describe('CSV export safety', () => {
  it.each([
    ['=HYPERLINK("http://evil","x")', "'=HYPERLINK(\"http://evil\",\"x\")"],
    ['+cmd|" /C calc"!A0', "'+cmd|\" /C calc\"!A0"],
    ['-2+3+cmd|x', "'-2+3+cmd|x"],
    ['@SUM(A1:A9)', "'@SUM(A1:A9)"],
    ['\t=1+1', "'\t=1+1"],
    ['\r=1+1', "'\r=1+1"],
  ])('turns %j into plain text', (input, expected) => {
    expect(neutraliseFormula(input)).toBe(expected)
  })

  it('leaves ordinary text, numbers, dates and phone numbers alone', () => {
    for (const ok of ['Ava Morris-Boundy', '12', '-5', '3.5', '2026-10-22', '+447700900123', '+44 (0)7700 900123', '', "O'Brien", 'a=b']) {
      expect(neutraliseFormula(ok)).toBe(ok)
    }
  })

  it('applies it to every cell of an exported file and still escapes quotes, commas and line breaks', () => {
    const csv = toCSV(
      [{ n: '=1+1', m: 'a "quoted", cell', k: 'two\nlines', z: 7, e: null }],
      [{ key: 'n', label: 'Name' }, { key: 'm', label: 'M' }, { key: 'k', label: 'K' }, { key: 'z', label: 'Z' }, { key: 'e', label: 'E' }]
    )
    expect(csv).toBe('Name,M,K,Z,E\n\'=1+1,"a ""quoted"", cell","two\nlines",7,')
  })
})

describe('display formatting', () => {
  it('never shows NaN or undefined for missing values', () => {
    expect([fmtPct(1, 0), fmtPct(NaN, 5), fmtInt(undefined), fmtInt('x'), fmtDate(''), fmtDate('garbage')]).toEqual([DASH, DASH, DASH, DASH, DASH, DASH])
    expect(fmtPct(1, 3)).toBe('33.3%')
    expect(fmtInt(12345)).toBe('12,345')
  })
})
