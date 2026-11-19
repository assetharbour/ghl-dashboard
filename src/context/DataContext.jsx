import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDashboardData, saveFlagStatus } from '../lib/sheets'
import { applyFlagOverrides, pendingOverrides } from '../lib/flags'
import { filterByDateRange, attachAppointmentStart } from '../lib/metrics'

const DataContext = createContext(null)

export function DataProvider({ children }) {
  const [allRows, setAllRows] = useState(null) // null = initial load in flight
  const [lastSync, setLastSync] = useState(null)
  // Appointments, flags and Created By locks come from the sync's field audit; empty until it has run.
  const [appointments, setAppointments] = useState([])
  const [flags, setFlags] = useState([])
  // Flags ticked (or undone) in this browser, shown at once until the sheet data catches up: flag_id -> { status, resolved_at }.
  const [flagOverrides, setFlagOverrides] = useState(() => new Map())
  const [locks, setLocks] = useState([])
  // What the advisor's Evonex call looked like per appointment, and calls per day per caller (empty until CALL_EVIDENCE is on).
  const [callEvidence, setCallEvidence] = useState([])
  const [callActivity, setCallActivity] = useState([])
  const [leadSpeed, setLeadSpeed] = useState([]) // minutes to the first call per new lead
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [dateRange, setDateRange] = useState('all')
  const [customRange, setCustomRange] = useState({ from: null, to: null })
  const [drilldown, setDrilldown] = useState(null)
  const timerRef = useRef(null)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true)
    try {
      const { rows, lastSync: sync, appointments: appts, flags: flagRows, locks: lockRows, callEvidence: evidenceRows, callActivity: activityRows, leadSpeed: speedRows } = await fetchDashboardData()
      setAllRows(rows)
      setLastSync(sync)
      setAppointments(appts)
      setFlags(flagRows)
      setFlagOverrides((prev) => pendingOverrides(flagRows, prev))
      setLocks(lockRows)
      setCallEvidence(evidenceRows || [])
      setCallActivity(activityRows || [])
      setLeadSpeed(speedRows || [])
      setError(null)
    } catch (e) {
      console.error('Data fetch failed:', e)
      // keep previous data on silent refresh failures — no UI flicker
      setError((prev) => (silent && allRows ? prev : e.message))
    } finally {
      setRefreshing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load()
    timerRef.current = setInterval(() => load({ silent: true }), 60000)
    return () => clearInterval(timerRef.current)
  }, [load])

  // Every lead carries the start of its latest live calendar appointment (used by the stuck-case rule).
  const decoratedRows = useMemo(() => attachAppointmentStart(allRows || [], appointments), [allRows, appointments])

  const rows = useMemo(
    () => filterByDateRange(decoratedRows, dateRange, customRange),
    [decoratedRows, dateRange, customRange]
  )

  const shownFlags = useMemo(() => applyFlagOverrides(flags, flagOverrides), [flags, flagOverrides])

  /** Marks a flag sorted ('resolved') or opens it again ('open'). Shows the change at once and undoes it if saving fails. */
  const setFlagStatus = useCallback(async (flagId, status) => {
    const previous = flagOverrides.get(flagId)
    setFlagOverrides((prev) => new Map(prev).set(flagId, { status, resolved_at: status === 'resolved' ? new Date().toISOString() : '' }))
    try {
      const saved = await saveFlagStatus(flagId, status)
      setFlagOverrides((prev) => new Map(prev).set(flagId, { status: saved.status, resolved_at: saved.resolved_at }))
    } catch (e) {
      setFlagOverrides((prev) => {
        const next = new Map(prev)
        if (previous) next.set(flagId, previous)
        else next.delete(flagId)
        return next
      })
      throw e
    }
  }, [flagOverrides])

  const openDrilldown = useCallback((title, drillRows, extraColumns = []) => {
    setDrilldown({ title, rows: drillRows, extraColumns })
  }, [])

  const closeDrilldown = useCallback(() => setDrilldown(null), [])

  const value = useMemo(
    () => ({
      loading: allRows === null && !error,
      error,
      allRows: decoratedRows,
      appointments,
      flags: shownFlags,
      setFlagStatus,
      locks,
      callEvidence,
      callActivity,
      leadSpeed,
      rows,
      lastSync,
      refreshing,
      refresh: () => load(),
      dateRange,
      setDateRange,
      customRange,
      setCustomRange,
      drilldown,
      openDrilldown,
      closeDrilldown,
    }),
    [
      allRows,
      decoratedRows,
      appointments,
      shownFlags,
      setFlagStatus,
      locks,
      callEvidence,
      callActivity,
      leadSpeed,
      rows,
      lastSync,
      error,
      refreshing,
      dateRange,
      customRange,
      drilldown,
      load,
      openDrilldown,
      closeDrilldown,
    ]
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used inside <DataProvider>')
  return ctx
}
