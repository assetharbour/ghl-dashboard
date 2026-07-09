import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDashboardData } from '../lib/sheets'
import { filterByDateRange } from '../lib/metrics'

const DataContext = createContext(null)

export function DataProvider({ children }) {
  const [allRows, setAllRows] = useState(null) // null = initial load in flight
  const [lastSync, setLastSync] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [dateRange, setDateRange] = useState('all')
  const [drilldown, setDrilldown] = useState(null)
  const timerRef = useRef(null)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true)
    try {
      const { rows, lastSync: sync } = await fetchDashboardData()
      setAllRows(rows)
      setLastSync(sync)
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

  const rows = useMemo(
    () => filterByDateRange(allRows || [], dateRange),
    [allRows, dateRange]
  )

  const openDrilldown = useCallback((title, drillRows, extraColumns = []) => {
    setDrilldown({ title, rows: drillRows, extraColumns })
  }, [])

  const closeDrilldown = useCallback(() => setDrilldown(null), [])

  const value = useMemo(
    () => ({
      loading: allRows === null && !error,
      error,
      allRows: allRows || [],
      rows,
      lastSync,
      refreshing,
      refresh: () => load(),
      dateRange,
      setDateRange,
      drilldown,
      openDrilldown,
      closeDrilldown,
    }),
    [allRows, rows, lastSync, error, refreshing, dateRange, drilldown, load, openDrilldown, closeDrilldown]
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used inside <DataProvider>')
  return ctx
}
