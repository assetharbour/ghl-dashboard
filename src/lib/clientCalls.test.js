import { describe, it, expect } from 'vitest'
import { annualReviewsForMonth, reviewMonths, ercList, ercBand, bandCounts } from './clientCalls'
import { printableHtml, escapeHtml } from './print'

const NOW = new Date(2026, 10, 20) // 20 Nov 2026

describe('annual review calls by month', () => {
  it('lists each anniversary of the product end date up to the end date itself', () => {
    const rows = [
      { contact_id: 'a', client_name: 'Ann', erc_date: '2029-12-20', pipeline_stage: 'Completion' },
      { contact_id: 'b', client_name: 'Bob', erc_date: '2026-12-05', pipeline_stage: 'Post Completion' },
      { contact_id: 'c', client_name: 'Cat', erc_date: '2026-11-30', pipeline_stage: 'Lead Received' },
    ]
    const dec26 = annualReviewsForMonth(rows, 2026, 11)
    expect(dec26.map((r) => [r.client_name, r.__callsLeft, r.__finalCall])).toEqual([['Bob', 1, true], ['Ann', 4, false]])
    expect(dec26.every((r) => r.__completedWithUs)).toBe(true)
    expect(annualReviewsForMonth(rows, 2027, 11).map((r) => r.client_name)).toEqual(['Ann']) // Bob's product has ended
    expect(annualReviewsForMonth(rows, 2030, 11)).toEqual([])
    const nov = annualReviewsForMonth(rows, 2026, 10)
    expect(nov.map((r) => [r.client_name, r.__completedWithUs])).toEqual([['Cat', false]])
  })

  it('falls back to the roll-off date, lists a client once, and moves 29 February to the 28th', () => {
    const rows = [
      { contact_id: 'a', client_name: 'Ann', erc_date: '', mortgage_product_roll_off_date: '2028-03-15' },
      { contact_id: 'a', client_name: 'Ann', erc_date: '2030-03-02' },
      { contact_id: 'd', client_name: 'Dan', erc_date: '2028-02-29' },
    ]
    const mar = annualReviewsForMonth(rows, 2027, 2)
    expect(mar).toHaveLength(1)
    expect(mar[0].__due.getDate()).toBe(2)
    expect(mar[0].__otherCases).toBe(1)
    expect(annualReviewsForMonth(rows, 2027, 1)[0].__due.getDate()).toBe(28)
  })

  it('starts reviews about a year after completion, but always keeps the final call', () => {
    const rows = [
      { contact_id: 'e', client_name: 'Eve', erc_date: '2031-10-31', completion_date: '2026-10-22', pipeline_stage: 'Completion' },
      { contact_id: 'f', client_name: 'Fay', erc_date: '2026-11-25', completion_date: '2026-11-03', pipeline_stage: 'Completion' },
    ]
    expect(annualReviewsForMonth(rows, 2026, 9)).toEqual([]) // nine days after completing: no review yet
    expect(annualReviewsForMonth(rows, 2027, 9).map((r) => r.client_name)).toEqual(['Eve'])
    expect(annualReviewsForMonth(rows, 2026, 10).map((r) => r.client_name)).toEqual(['Fay'])
  })

  it('offers this month and the next 23', () => {
    const m = reviewMonths(NOW)
    expect(m).toHaveLength(24)
    expect(m[0].key).toBe('2026-11')
    expect(m[23].key).toBe('2028-10')
  })
})

describe('ERC list to the end of 2027', () => {
  it('keeps product ends from today to 31 Dec 2027, soonest first, banded pink, amber and green', () => {
    const rows = [
      { client_name: 'Late', erc_date: '2028-01-01' },
      { client_name: 'Past', erc_date: '2026-11-19' },
      { client_name: 'Green', erc_date: '2027-12-31' },
      { client_name: 'Amber', erc_date: '2027-01-20' },
      { client_name: 'Today', erc_date: '2026-11-20' },
      { client_name: 'Pink', erc_date: '2026-12-20' },
      { client_name: 'None', erc_date: '' },
    ]
    const list = ercList(rows, NOW, 2027)
    expect(list.map((r) => [r.client_name, r.__band])).toEqual([
      ['Today', 'pink'], ['Pink', 'pink'], ['Amber', 'amber'], ['Green', 'green'],
    ])
    expect(list[0].__daysLeft).toBe(0)
    expect(bandCounts(list)).toEqual({ pink: 2, amber: 1, green: 1 })
    expect(ercBand('2027-02-18', NOW)).toBe('amber') // 90 days
    expect(ercBand('2027-02-19', NOW)).toBe('green')
    expect(ercBand('', NOW)).toBeNull()
  })
})

describe('printable list', () => {
  it('escapes values, groups rows and prints the colour key', () => {
    expect(escapeHtml('<b>"Tom & Jo"</b>')).toBe('&lt;b&gt;&quot;Tom &amp; Jo&quot;&lt;/b&gt;')
    const html = printableHtml({
      title: 'ERC list',
      legend: [{ band: 'pink', label: 'Within 30 days (1)' }],
      columns: [{ label: 'Client', value: (r) => r.name, banded: true }],
      rows: [{ name: '<script>x</script>', g: 'Dec 2026' }, { name: 'B', g: 'Dec 2026' }],
      band: () => 'pink',
      groupBy: (r) => r.g,
    })
    expect(html).not.toContain('<script>x')
    expect(html.match(/class="group"/g)).toHaveLength(1)
    expect(html).toContain('Within 30 days (1)')
    expect(html).toContain('2 rows')
  })
})
