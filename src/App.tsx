import { useEffect, useMemo, useRef, useState } from 'react'
import { availableMonths, monthLabel } from './lib/analytics'
import type { TxKind } from './lib/types'
import { useSpendlyData } from './hooks/useData'
import { useImporter } from './hooks/useImporter'
import { usePersistentState } from './hooks/usePersistentState'
import { EMPTY_FILTER, VIEW_TITLE, type TxFilter, type View } from './state'
import { MobileNav, Sidebar } from './components/Nav'
import { EmptyState } from './components/Empty'
import { Dashboard } from './views/Dashboard'
import { Analysis } from './views/Analysis'
import { Transactions } from './views/Transactions'
import { Manage } from './views/Manage'
import { DataView } from './views/DataView'

const SUBTITLE: Partial<Record<View, string>> = { dashboard: '支出集計', analysis: '支出分析', transactions: '取引' }

/**
 * ページがスクロールされているか。ヘッダーの縮小で高さが変わっても状態が往復しないよう、
 * 切り替え位置に幅（ヒステリシス）を持たせる。
 */
function useScrolled() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled((prev) => (prev ? window.scrollY > 8 : window.scrollY > 64))
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return scrolled
}

export function App() {
  const data = useSpendlyData()
  const importer = useImporter()
  const [view, setView] = usePersistentState<View>('view', 'dashboard')
  const [month, setMonth] = usePersistentState<string | null>('month', null)
  const [storedFilter, setFilter] = usePersistentState<TxFilter>('txFilter', EMPTY_FILTER)
  const filter = { ...EMPTY_FILTER, ...storedFilter }
  const [analysisScope, setAnalysisScope] = usePersistentState<'month' | 'all'>('analysisScope', 'month')
  const fileRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const scrolled = useScrolled()

  // 固定ヘッダーの高さを CSS 変数にし、他の固定要素（一括設定バーなど）をその下に配置する
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const months = useMemo(() => availableMonths(data.txs), [data.txs])
  const latest = months[months.length - 1] ?? null
  const current = month && months.includes(month) ? month : latest

  // 新しい月のデータを取り込んだら最新月を表示（起動時は前回選択した月を維持）
  const prevLatest = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (data.loading) return
    if (prevLatest.current !== undefined && latest && latest !== prevLatest.current) setMonth(latest)
    prevLatest.current = latest
  }, [data.loading, latest, setMonth])

  const navigate = (v: View) => {
    setView(v)
    window.scrollTo({ top: 0 })
  }
  const showTransactions = (patch: Partial<TxFilter>) => {
    setFilter({ ...EMPTY_FILTER, period: view === 'analysis' && analysisScope === 'all' ? 'all' : 'month', ...patch })
    navigate('transactions')
  }
  const onFiles = async (files: FileList | File[]) => {
    navigate('data')
    await importer.importFiles(files)
  }

  const unknownCount = data.txs.filter((t) => t.effectiveKind === 'unknown').length
  const needsMonth = view === 'dashboard' || view === 'analysis' || view === 'transactions'
  const hasData = current != null

  return (
    <div className="min-h-screen pb-[60px] sm:flex sm:pb-0">
      <Sidebar view={view} onNavigate={navigate} txCount={data.txs.length} badge={{ manage: unknownCount }} />
      <main ref={mainRef} className="mx-auto w-full max-w-[1390px] px-[13px] py-[21px] sm:px-[17px] sm:py-[23px] md:px-[clamp(15px,3.2vw,42px)] md:py-[30px]">
        <header
          ref={headerRef}
          className={`sticky top-0 z-20 mb-[25px] flex justify-between gap-4 bg-ivory transition-[padding,box-shadow] duration-200 -mx-[13px] px-[13px] sm:-mx-[17px] sm:px-[17px] md:-mx-[clamp(15px,3.2vw,42px)] md:px-[clamp(15px,3.2vw,42px)] ${
            scrolled ? 'items-center py-2 shadow-[0_1px_0_#e5e9e1]' : 'items-start py-0 sm:items-center'
          }`}
        >
          <div className="min-w-0">
            <h1 className={`truncate transition-[font-size] duration-200 ${scrolled ? 'text-[18px]! sm:text-[20px]!' : 'text-[23px]! sm:text-[25px]!'}`}>{VIEW_TITLE[view]}</h1>
            <div className={`meta ${scrolled ? 'hidden' : ''}`}>
              {needsMonth && current ? `${monthLabel(current)} ・ ${SUBTITLE[view]}` : view === 'data' ? 'PayPay・銀行・デビット・カードの明細CSV' : view === 'manage' ? '店舗名の統合とカテゴリ分類' : '取引データなし'}
            </div>
          </div>
          <div className={`flex gap-2 sm:flex-row ${scrolled ? 'flex-row items-center' : 'flex-col'}`}>
            {needsMonth && hasData && (
              <div className="flex items-center gap-1" role="group" aria-label="対象月">
                <button
                  className="control px-2.5! disabled:opacity-40 disabled:hover:bg-white"
                  onClick={() => setMonth(months[months.indexOf(current!) - 1])}
                  disabled={months.indexOf(current!) <= 0}
                  aria-label="前の月"
                  title="前の月"
                >
                  ‹
                </button>
              <label className="relative">
                <span className="sr-only">対象月</span>
                <select
                  className="control appearance-none pr-6! sm:pr-8!"
                  value={current}
                  onChange={(e) => setMonth(e.target.value)}
                >
                  {[...months].reverse().map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-control-text sm:right-3">▾</span>
              </label>
                <button
                  className="control px-2.5! disabled:opacity-40 disabled:hover:bg-white"
                  onClick={() => setMonth(months[months.indexOf(current!) + 1])}
                  disabled={months.indexOf(current!) >= months.length - 1}
                  aria-label="次の月"
                  title="次の月"
                >
                  ›
                </button>
              </div>
            )}
            <button
              className={`control control-primary ${scrolled && needsMonth && hasData ? 'hidden sm:inline-block' : ''}`}
              onClick={() => fileRef.current?.click()}
              disabled={importer.busy}
            >
              {importer.busy ? '取り込み中…' : '＋ 明細追加'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) onFiles([...e.target.files])
                e.target.value = ''
              }}
            />
          </div>
        </header>

        <section key={view} className="motion-safe:animate-appear">
          {data.loading ? (
            <p className="caption">読み込み中…</p>
          ) : needsMonth && !hasData ? (
            <EmptyState onImport={() => fileRef.current?.click()} />
          ) : view === 'dashboard' ? (
            <Dashboard
              data={data}
              month={current!}
              months={months}
              onMonth={setMonth}
              onCategory={(categoryId) => showTransactions({ categoryId })}
              onMerchant={(merchant) => showTransactions({ merchant })}
              onAccount={(accountId) => showTransactions({ accountId })}
            />
          ) : view === 'analysis' ? (
            <Analysis
              data={data}
              month={current!}
              months={months}
              scope={analysisScope}
              onScope={setAnalysisScope}
              onCategory={(categoryId) => showTransactions({ categoryId })}
              onMerchant={(merchant) => showTransactions({ merchant })}
              onBand={(bandId) => showTransactions({ bandId })}
              onMonth={setMonth}
            />
          ) : view === 'transactions' ? (
            <Transactions data={data} month={current!} filter={filter} onFilter={setFilter} />
          ) : view === 'manage' ? (
            <Manage
              data={data}
              onMerchant={(merchant) => {
                setFilter({ ...EMPTY_FILTER, period: 'all', merchant })
                navigate('transactions')
              }}
              onUnknown={() => {
                setFilter({ ...EMPTY_FILTER, period: 'all', kind: 'unknown' })
                navigate('transactions')
              }}
            />
          ) : (
            <DataView
              data={data}
              busy={importer.busy}
              results={importer.results}
              onFiles={onFiles}
              onKind={(kind: TxKind) => {
                setFilter({ ...EMPTY_FILTER, period: 'all', kind: kind === 'payment' ? 'spending' : kind })
                navigate('transactions')
              }}
            />
          )}
        </section>
      </main>
      <MobileNav view={view} onNavigate={navigate} />
    </div>
  )
}
