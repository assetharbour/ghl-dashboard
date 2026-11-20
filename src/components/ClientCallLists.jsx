import { useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import DataTable from './DataTable'
import { fmtInt, fmtDate, displayValue } from '../lib/format'
import { ADMIN_FILTER_PROPS } from '../lib/metrics'
import { annualReviewsForMonth, reviewMonths, ercList, bandCounts, BAND_LABEL, nameOrBlank } from '../lib/clientCalls'
import { printList } from '../lib/print'

const BAND_CLASS = {
  pink: 'bg-brand-pink/10 text-brand-pink',
  amber: 'bg-amber-100 text-amber-700',
  green: 'bg-brand-green/10 text-brand-green',
}

function Chip({ band, children }) {
  return <span className={`inline-block text-xs font-medium rounded-full px-2.5 py-0.5 ${BAND_CLASS[band] ?? ''}`}>{children}</span>
}

function Select({ label, value, onChange, options, allLabel }) {
  return (
    <label className="text-xs text-muted flex items-center gap-2">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-line rounded-md bg-white text-ink text-sm px-2 py-1"
      >
        {allLabel !== undefined && <option value="">{allLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function PrintButton({ onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 text-sm border border-line rounded-md px-3 py-1.5 bg-white text-ink hover:border-brand-green disabled:opacity-50"
    >
      <Printer size={14} /> Print / save as PDF
    </button>
  )
}

function advisorOptions(list) {
  const names = [...new Set(list.map((r) => nameOrBlank(r.advisor_name)).filter(Boolean))].sort()
  return names.map((n) => ({ value: n, label: n }))
}

const byAdvisor = (advisor) => (r) => !advisor || nameOrBlank(r.advisor_name) === advisor

const stageText = (r) => (r.__completedWithUs ? 'Completed with us' : displayValue(r.pipeline_stage))

export function AnnualReviewCalls({ allRows, now }) {
  const months = useMemo(() => reviewMonths(now, 24), [now])
  const [monthKey, setMonthKey] = useState(months[0].key)
  const [advisor, setAdvisor] = useState('')
  const [scope, setScope] = useState('all')
  const month = months.find((m) => m.key === monthKey) ?? months[0]

  const all = useMemo(() => annualReviewsForMonth(allRows, month.year, month.month), [allRows, month])
  const list = useMemo(
    () => all.filter(byAdvisor(advisor)).filter((r) => scope === 'all' || r.__completedWithUs),
    [all, advisor, scope]
  )
  const finals = list.filter((r) => r.__finalCall).length

  const columns = [
    { key: '__due', label: 'Call due', render: (r) => fmtDate(r.__due), rawForCsv: (r) => fmtDate(r.__due), sortValue: (r) => r.__due.getTime() },
    { key: 'client_name', label: 'Client' },
    { key: 'advisor_name', label: 'Advisor' },
    { key: 'admin', label: 'Admin' },
    { key: '__productEnd', label: 'Product end (ERC)', render: (r) => fmtDate(r.__productEnd), rawForCsv: (r) => fmtDate(r.__productEnd) },
    {
      key: '__callsLeft',
      label: 'Review',
      render: (r) => (r.__finalCall ? <Chip band="pink">Final call: product ends</Chip> : `${r.__callsLeft} calls left`),
      rawForCsv: (r) => (r.__finalCall ? 'Final call: product ends' : `${r.__callsLeft} calls left`),
    },
    { key: '__stage', label: 'Case', render: stageText, rawForCsv: stageText, sortValue: stageText },
    { key: 'mortgage_case_type', label: 'Case type' },
    { key: '__otherCases', label: 'Other cases due', render: (r) => (r.__otherCases ? `+${r.__otherCases}` : ''), rawForCsv: (r) => r.__otherCases || '' },
  ]

  const print = () =>
    printList({
      title: `Annual review calls: ${month.label}`,
      subtitle: [advisor || 'All advisors', scope === 'all' ? 'all cases with a product end date' : 'cases completed with us'].join(' · '),
      columns: [
        { label: 'Call due', value: (r) => fmtDate(r.__due) },
        { label: 'Client', value: (r) => nameOrBlank(r.client_name) },
        { label: 'Advisor', value: (r) => nameOrBlank(r.advisor_name) },
        { label: 'Admin', value: (r) => nameOrBlank(r.admin) },
        { label: 'Product end (ERC)', value: (r) => fmtDate(r.__productEnd) },
        { label: 'Review', value: (r) => (r.__finalCall ? 'FINAL CALL: product ends' : `${r.__callsLeft} calls left`), banded: true },
        { label: 'Case', value: stageText },
        { label: 'Called / notes', value: () => '' },
      ],
      rows: list,
      band: (r) => (r.__finalCall ? 'pink' : null),
    })

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Annual Review Calls by Month</h2>
          <p className="text-xs text-muted mt-0.5 max-w-2xl">
            Who to call for their annual review in the month picked: once a year on the anniversary of the product end date
            (the ERC Date), up to the end date itself, starting about a year after completion. Covers every case, whatever
            the date range above. A client with two cases due in the same month is listed once.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select label="Month" value={monthKey} onChange={setMonthKey} options={months.map((m) => ({ value: m.key, label: m.label }))} />
          <Select label="Advisor" value={advisor} onChange={setAdvisor} options={advisorOptions(all)} allLabel="All advisors" />
          <Select
            label="Cases"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'All with an ERC date' },
              { value: 'completed', label: 'Completed with us' },
            ]}
          />
          <PrintButton onClick={print} disabled={!list.length} />
        </div>
      </div>
      <div className="flex gap-6 mb-4">
        <div>
          <div className="kpi-label">Calls due in {month.label}</div>
          <div className="text-2xl font-semibold text-ink">{fmtInt(list.length)}</div>
        </div>
        <div>
          <div className="kpi-label">Final calls (product ends this month)</div>
          <div className={`text-2xl font-semibold ${finals ? 'text-brand-pink' : 'text-ink'}`}>{fmtInt(finals)}</div>
        </div>
      </div>
      <DataTable
        ariaLabel="annual review calls"
        columns={columns}
        rows={list}
        filters={[{ key: 'admin', label: 'Admin', ...ADMIN_FILTER_PROPS }]}
        pageSize={25}
        exportName={`annual_review_calls_${month.key}`}
        initialSort={{ key: '__due', dir: 'asc' }}
      />
    </div>
  )
}

export function ErcListToYearEnd({ allRows, now, untilYear = 2027 }) {
  const [advisor, setAdvisor] = useState('')
  const [scope, setScope] = useState('all')
  const all = useMemo(() => ercList(allRows, now, untilYear), [allRows, now, untilYear])
  const list = useMemo(
    () => all.filter(byAdvisor(advisor)).filter((r) => scope === 'all' || r.__completedWithUs),
    [all, advisor, scope]
  )
  const counts = bandCounts(list)
  const monthOf = (r) => new Date(r.__endTime).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  const columns = [
    {
      key: '__productEnd',
      label: 'Product end (ERC)',
      render: (r) => <Chip band={r.__band}>{fmtDate(r.__productEnd)}</Chip>,
      rawForCsv: (r) => fmtDate(r.__productEnd),
      sortValue: (r) => r.__endTime,
    },
    { key: '__daysLeft', label: 'Days left', render: (r) => fmtInt(r.__daysLeft), rawForCsv: (r) => r.__daysLeft },
    { key: '__band', label: 'Band', render: (r) => BAND_LABEL[r.__band], rawForCsv: (r) => BAND_LABEL[r.__band], sortValue: (r) => r.__endTime },
    { key: 'client_name', label: 'Client' },
    { key: 'advisor_name', label: 'Advisor' },
    { key: 'admin', label: 'Admin' },
    { key: 'mortgage_case_type', label: 'Case type' },
    { key: '__stage', label: 'Case', render: stageText, rawForCsv: stageText, sortValue: stageText },
  ]

  const print = () =>
    printList({
      title: `ERC list: product ends to 31 December ${untilYear}`,
      subtitle: [advisor || 'All advisors', scope === 'all' ? 'all cases' : 'cases completed with us'].join(' · '),
      legend: ['pink', 'amber', 'green'].map((b) => ({ band: b, label: `${BAND_LABEL[b]} (${counts[b]})` })),
      columns: [
        { label: 'Product end (ERC)', value: (r) => fmtDate(r.__productEnd), banded: true },
        { label: 'Days left', value: (r) => r.__daysLeft },
        { label: 'Band', value: (r) => BAND_LABEL[r.__band] },
        { label: 'Client', value: (r) => nameOrBlank(r.client_name) },
        { label: 'Advisor', value: (r) => nameOrBlank(r.advisor_name) },
        { label: 'Admin', value: (r) => nameOrBlank(r.admin) },
        { label: 'Case type', value: (r) => nameOrBlank(r.mortgage_case_type) },
        { label: 'Case', value: stageText },
        { label: 'Notes', value: () => '' },
      ],
      rows: list,
      band: (r) => r.__band,
      groupBy: monthOf,
    })

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">ERC List to 31 December {untilYear}</h2>
          <p className="text-xs text-muted mt-0.5 max-w-2xl">
            Every case whose product ends (the ERC Date) from today to the end of {untilYear}, soonest first, across all
            cases whatever the date range above. Pink within 30 days, amber 31 to 90 days, green beyond. The printed copy is
            grouped by month with a notes column.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select label="Advisor" value={advisor} onChange={setAdvisor} options={advisorOptions(all)} allLabel="All advisors" />
          <Select
            label="Cases"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'All with an ERC date' },
              { value: 'completed', label: 'Completed with us' },
            ]}
          />
          <PrintButton onClick={print} disabled={!list.length} />
        </div>
      </div>
      <div className="flex flex-wrap gap-6 mb-4">
        <div>
          <div className="kpi-label">Total</div>
          <div className="text-2xl font-semibold text-ink">{fmtInt(list.length)}</div>
        </div>
        {['pink', 'amber', 'green'].map((b) => (
          <div key={b}>
            <div className="kpi-label">{BAND_LABEL[b]}</div>
            <div className="mt-1">
              <Chip band={b}>{fmtInt(counts[b])}</Chip>
            </div>
          </div>
        ))}
      </div>
      <DataTable
        ariaLabel="erc list"
        columns={columns}
        rows={list}
        filters={[{ key: 'admin', label: 'Admin', ...ADMIN_FILTER_PROPS }]}
        pageSize={25}
        exportName={`erc_list_to_${untilYear}`}
        initialSort={{ key: '__productEnd', dir: 'asc' }}
      />
    </div>
  )
}
