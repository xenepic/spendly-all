import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  byAmountBand, byCategory, byMerchant, byWeekday, isSpending, median, monthLabel, monthlyCashflow, monthlyTotals, sum,
} from '../lib/analytics'
import { pct, signedYen, yen } from '../lib/format'
import type { SpendlyData } from '../hooks/useData'
import { usePersistentState } from '../hooks/usePersistentState'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { Bars } from '../components/Bars'
import { MonthlyChart } from '../components/MonthlyChart'
import { NoRows } from '../components/Empty'
import { Num } from '../components/Num'
import { FixedToggle, isFixed, useIncludeFixed } from '../components/FixedToggle'

interface Props {
  data: SpendlyData
  month: string
  months: string[]
  scope: 'month' | 'all'
  onScope: (s: 'month' | 'all') => void
  onCategory: (id: string) => void
  onMerchant: (name: string) => void
  onBand: (id: string) => void
  onMonth: (m: string) => void
}

type MerchantSort = 'amount' | 'count' | 'avg'

export function Analysis({ data, month, months, scope, onScope, onCategory, onMerchant, onBand, onMonth }: Props) {
  const reduced = useReducedMotion()
  const [showAllMerchants, setShowAllMerchants] = usePersistentState('analysis.showAllMerchants', false)
  const [merchantSort, setMerchantSort] = usePersistentState<MerchantSort>('analysis.merchantSort', 'amount')
  const [trendCat, setTrendCat] = usePersistentState<string>('analysis.trendCategory', '')

  // 「固定費を含める」がオフなら、この画面の集計すべてから固定費を除く
  const [includeFixed, setIncludeFixed] = useIncludeFixed()
  const paid = useMemo(() => data.txs.filter(isSpending), [data.txs])
  const hasFixed = useMemo(() => paid.some(isFixed), [paid])
  const excludeFixed = !includeFixed && hasFixed
  const allSpend = useMemo(() => (excludeFixed ? paid.filter((t) => !isFixed(t)) : paid), [paid, excludeFixed])
  const spend = useMemo(() => (scope === 'month' ? allSpend.filter((t) => t.month === month) : allSpend), [allSpend, scope, month])
  const total = sum(spend)
  const cats = useMemo(() => byCategory(spend), [spend])
  const merchants = useMemo(() => {
    const rows = byMerchant(spend)
    return merchantSort === 'amount' ? rows : [...rows].sort((a, b) => b[merchantSort] - a[merchantSort])
  }, [spend, merchantSort])
  const weekdays = useMemo(() => byWeekday(spend), [spend])
  const bands = useMemo(() => byAmountBand(spend), [spend])
  const small = spend.filter((t) => t.amount < 1000)
  const smallSum = sum(small)
  const med = median(spend.map((t) => t.amount))
  const maxTx = spend.reduce((a, t) => Math.max(a, t.amount), 0)
  const trend = useMemo(
    () => monthlyTotals(trendCat ? allSpend.filter((t) => t.categoryId === trendCat) : allSpend, months),
    [allSpend, months, trendCat],
  )
  // 収支は固定費の切り替えに関係なく、実際の収入と支出で比べる
  const cashflow = useMemo(() => monthlyCashflow(data.txs, months).reverse(), [data.txs, months])
  const hasIncome = cashflow.some((r) => r.income > 0)
  const scopeLabel = scope === 'month' ? monthLabel(month) : '全期間'
  const catName = (id: string) => data.catMap.get(id)?.name ?? '未分類'
  const catColor = (id: string) => data.catMap.get(id)?.color ?? '#c4cbc1'
  const merchantRows = showAllMerchants ? merchants : merchants.slice(0, 10)

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-[7px]" role="group" aria-label="集計期間">
        {(['month', 'all'] as const).map((s) => (
          <button key={s} className={`pill ${scope === s ? 'pill-active' : ''}`} aria-pressed={scope === s} onClick={() => onScope(s)}>
            {s === 'month' ? `対象月（${monthLabel(month)}）` : '全期間'}
          </button>
        ))}
        <span className="caption ml-1">
          {scopeLabel} ・ {spend.length}回 ・ {yen(total)}
          {excludeFixed && '（固定費を除く）'}
        </span>
        {hasFixed && (
          <span className="ml-auto">
            <FixedToggle checked={includeFixed} onChange={setIncludeFixed} />
          </span>
        )}
      </div>

      <div className="mb-[14px] grid grid-cols-2 gap-3">
        <div className="card">
          <span className="caption">1,000円未満の支払い</span>
          <div className="value">
            <Num>{yen(smallSum)}</Num>
          </div>
          <span className="sub">
            {small.length}回 ・ 支出全体の{pct(total ? smallSum / total : 0)} ・ 回数の{pct(spend.length ? small.length / spend.length : 0)}
          </span>
        </div>
        <div className="card">
          <span className="caption">1回あたりの中央値</span>
          <div className="value">
            <Num>{yen(med)}</Num>
          </div>
          <span className="sub">
            平均 {yen(spend.length ? total / spend.length : 0)} ・ 最大 {yen(maxTx)}
          </span>
        </div>
      </div>

      <div className="mb-[14px] grid gap-[14px] md:grid-cols-[1.05fr_.95fr]">
        <div className="card">
          <div className="cardhead">
            <h2>カテゴリ別支出</h2>
            <span className="caption">選択すると取引一覧に移動</span>
          </div>
          {cats.length ? (
            <Bars
              items={cats.map((c) => ({
                key: c.key,
                label: catName(c.key),
                note: `${c.count}回`,
                amount: c.amount,
                share: c.share,
                color: catColor(c.key),
              }))}
              onSelect={onCategory}
            />
          ) : (
            <NoRows text="この期間の支出はありません" />
          )}
        </div>
        <div className="card">
          <div className="cardhead">
            <h2>金額帯別</h2>
            <span className="caption">支払い1回の金額</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th">金額帯</th>
                  <th className="th text-right!">回数</th>
                  <th className="th text-right!">合計</th>
                  <th className="th text-right!">構成比</th>
                </tr>
              </thead>
              <tbody>
                {bands.map((b) => (
                  <tr key={b.id} className="cursor-pointer transition-colors duration-150 hover:bg-hover-soft" onClick={() => onBand(b.id)}>
                    <td className="td">
                      <button className="border-0 bg-transparent p-0 text-left text-xs text-ink" onClick={() => onBand(b.id)}>
                        {b.label}
                      </button>
                    </td>
                    <td className="td text-right tabular-nums">{b.count}回</td>
                    <td className="td text-right font-bold tabular-nums">{yen(b.amount)}</td>
                    <td className="td text-right text-faint tabular-nums">{pct(b.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card mb-[14px]">
        <div className="cardhead flex-wrap">
          <h2>店舗別支出</h2>
          <div className="flex items-center gap-2">
            <label className="caption" htmlFor="merchant-sort">
              並び順
            </label>
            <select id="merchant-sort" className="select" value={merchantSort} onChange={(e) => setMerchantSort(e.target.value as MerchantSort)}>
              <option value="amount">合計金額</option>
              <option value="count">利用回数</option>
              <option value="avg">平均単価</option>
            </select>
          </div>
        </div>
        {merchants.length === 0 ? (
          <NoRows text="この期間の支出はありません" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr>
                  <th className="th">店舗</th>
                  <th className="th">カテゴリ</th>
                  <th className="th text-right!">回数</th>
                  <th className="th text-right!">平均単価</th>
                  <th className="th text-right!">合計</th>
                  <th className="th text-right!">構成比</th>
                </tr>
              </thead>
              <tbody>
                {merchantRows.map((m) => (
                  <tr key={m.key} className="cursor-pointer transition-colors duration-150 hover:bg-hover-soft" onClick={() => onMerchant(m.key)}>
                    <td className="td">
                      <button className="border-0 bg-transparent p-0 text-left text-xs font-bold text-ink" onClick={() => onMerchant(m.key)}>
                        {m.key}
                      </button>
                    </td>
                    <td className="td">
                      <span className="tag">{catName(m.categoryId)}</span>
                    </td>
                    <td className="td text-right tabular-nums">{m.count}回</td>
                    <td className="td text-right tabular-nums">{yen(m.avg)}</td>
                    <td className="td text-right font-bold tabular-nums">{yen(m.amount)}</td>
                    <td className="td text-right text-faint tabular-nums">{pct(m.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {merchants.length > 10 && (
          <button className="control mt-3" onClick={() => setShowAllMerchants((v) => !v)}>
            {showAllMerchants ? '上位10店舗のみ表示' : `すべて表示（${merchants.length}店舗）`}
          </button>
        )}
      </div>

      <div className="grid gap-[14px] md:grid-cols-[.95fr_1.05fr]">
        <div className="card">
          <div className="cardhead">
            <h2>曜日別支出</h2>
            <span className="caption">{scopeLabel}</span>
          </div>
          <div style={{ height: 190 }} role="img" aria-label="曜日別支出の棒グラフ">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekdays} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="#e8eee7" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  height={34}
                  tick={({ x, y, payload, index }: { x?: number | string; y?: number | string; payload?: { value?: unknown }; index?: number }) => (
                    <text x={x} y={Number(y) + 4} textAnchor="middle" fontSize={11} fill="#94a198">
                      <tspan x={x} dy="0.71em">{String(payload?.value ?? '')}</tspan>
                      <tspan x={x} dy="1.3em" fontSize={10}>{weekdays[index ?? 0]?.count ?? 0}回</tspan>
                    </text>
                  )}
                />
                <YAxis
                  tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 1000) / 10}万` : v.toLocaleString('ja-JP'))}
                  tick={{ fontSize: 11, fill: '#94a198' }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  cursor={{ fill: '#f1f5f0' }}
                  content={({ active, payload }) => {
                    const p = active && (payload?.[0]?.payload as (typeof weekdays)[number] | undefined)
                    if (!p) return null
                    return (
                      <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-sm">
                        <div className="text-faint">{p.label}曜日</div>
                        <div className="mt-0.5 font-bold tabular-nums">{yen(p.amount)}</div>
                        <div className="text-faint">
                          {p.count}回 ・ 平均 {yen(p.count ? p.amount / p.count : 0)}
                        </div>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="amount" fill="#78a38a" radius={[4, 4, 0, 0]} isAnimationActive={!reduced} animationDuration={300} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="cardhead flex-wrap">
            <h2>月別支出推移</h2>
            <select className="select" value={trendCat} onChange={(e) => setTrendCat(e.target.value)} aria-label="カテゴリ">
              <option value="">すべてのカテゴリ</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <MonthlyChart data={trend} selected={month} onSelect={onMonth} />
          <p className="caption mt-2">全期間 ・ 点を選択するとその月を対象月にします</p>
        </div>
      </div>

      {hasIncome && (
        <div className="card mt-[14px]">
          <div className="cardhead">
            <h2>月別収支</h2>
            <span className="caption">収入は銀行の入金のうち給与・振込・利息（振替・返金・ATMは除く）</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse">
              <thead>
                <tr>
                  <th className="th">月</th>
                  <th className="th text-right!">収入</th>
                  <th className="th text-right!">支出</th>
                  <th className="th text-right!">収支</th>
                </tr>
              </thead>
              <tbody>
                {cashflow.map((r) => (
                  <tr
                    key={r.month}
                    className={`cursor-pointer transition-colors duration-150 hover:bg-hover-soft ${r.month === month ? 'bg-mini' : ''}`}
                    onClick={() => onMonth(r.month)}
                  >
                    <td className="td whitespace-nowrap">{monthLabel(r.month)}</td>
                    <td className="td text-right tabular-nums">{yen(r.income)}</td>
                    <td className="td text-right tabular-nums">{yen(r.spending)}</td>
                    <td className="td text-right font-bold tabular-nums" style={{ color: r.balance < 0 ? '#b16f4d' : '#3e8463' }}>
                      {signedYen(r.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="caption mt-2">投資・振替・現金の引き出しは支出に含めません。行を選択するとその月を対象月にします。</p>
        </div>
      )}
    </>
  )
}
