import { useMemo, useState } from 'react'
import {
  byAccount, byCategory, byMerchant, categoryDeltas, isSpending, monthLabel, monthSummary, monthlyTotals, shiftMonth, sum,
} from '../lib/analytics'
import { pct, signedPct, signedYen, yen } from '../lib/format'
import type { SpendlyData } from '../hooks/useData'
import { usePersistentState } from '../hooks/usePersistentState'
import { CategoryDonut } from '../components/CategoryDonut'
import { MonthlyChart } from '../components/MonthlyChart'
import { Num } from '../components/Num'
import { NoRows } from '../components/Empty'
import { Bars } from '../components/Bars'
import { accountColor } from '../lib/accounts'
import { DEFAULT_EMOJI, UNCATEGORIZED } from '../lib/categories'
import { FixedToggle, isFixed, useIncludeFixed } from '../components/FixedToggle'

interface Props {
  data: SpendlyData
  month: string
  months: string[]
  onMonth: (m: string) => void
  onCategory: (categoryId: string) => void
  onMerchant: (merchant: string) => void
  onAccount: (accountId: string) => void
}

const RANGES = [
  { id: 6, label: '6か月' },
  { id: 12, label: '12か月' },
  { id: 0, label: '全期間' },
] as const

export function Dashboard({ data, month, months, onMonth, onCategory, onMerchant, onAccount }: Props) {
  const [focus, setFocus] = useState<string | null>(null)
  const [range, setRange] = usePersistentState<number>('dashboard.range', 6)
  const spend = useMemo(() => data.txs.filter(isSpending), [data.txs])
  const monthSpend = useMemo(() => spend.filter((t) => t.month === month), [spend, month])
  const summary = useMemo(() => monthSummary(spend, month, new Date(), months), [spend, month, months])
  // 「固定費を含める」がオフなら、集計カード以外（内訳・店舗別・月別・前月比較）から固定費を除く
  const [includeFixed, setIncludeFixed] = useIncludeFixed()
  const hasFixed = useMemo(() => spend.some(isFixed), [spend])
  const fixedAmount = sum(monthSpend.filter(isFixed))
  const excludeFixed = !includeFixed && hasFixed
  const viewSpend = useMemo(() => (excludeFixed ? spend.filter((t) => !isFixed(t)) : spend), [spend, excludeFixed])
  const catSpend = useMemo(() => viewSpend.filter((t) => t.month === month), [viewSpend, month])
  const cats = useMemo(() => byCategory(catSpend), [catSpend])
  const deltas = useMemo(() => categoryDeltas(viewSpend, month), [viewSpend, month])
  // カテゴリ別支出で選択中のカテゴリで月別支出・店舗別支出を絞り込む（その月に支出がなくても選択は維持）
  const focusCategory = focus && data.catMap.has(focus) ? focus : null
  const trend = useMemo(() => {
    const end = months.indexOf(month)
    const shown = range === 0 ? months.slice(0, end + 1) : months.slice(Math.max(0, end + 1 - range), end + 1)
    return monthlyTotals(focusCategory ? viewSpend.filter((t) => t.categoryId === focusCategory) : viewSpend, shown)
  }, [viewSpend, months, month, range, focusCategory])
  const merchants = useMemo(
    () => byMerchant(focusCategory ? catSpend.filter((t) => t.categoryId === focusCategory) : catSpend),
    [catSpend, focusCategory],
  )
  const accounts = useMemo(
    () => byAccount(focusCategory ? catSpend.filter((t) => t.categoryId === focusCategory) : catSpend),
    [catSpend, focusCategory],
  )
  const trendColor = !focusCategory ? undefined : focusCategory === UNCATEGORIZED ? '#9aa39b' : data.catMap.get(focusCategory)?.color

  const catName = (id: string) => data.catMap.get(id)?.name ?? '未分類'
  const catColor = (id: string) => data.catMap.get(id)?.color ?? '#c4cbc1'
  const catEmoji = (id: string) => data.catMap.get(id)?.emoji || DEFAULT_EMOJI
  const focused = cats.some((c) => c.key === focus) ? focus : null
  const prevLabel = monthLabel(shiftMonth(month, -1))

  const focusChip = focusCategory && (
    <span className="flex min-w-0 items-center gap-1.5 rounded-md bg-mini py-0.5 pr-1 pl-2 text-[11px] motion-safe:animate-fade">
      <span className="dot" style={{ background: catColor(focusCategory) }} />
      <span className="truncate">{catName(focusCategory)}</span>
      <button
        className="border-0 bg-transparent px-1 text-faint hover:text-brand"
        onClick={() => setFocus(null)}
        aria-label="カテゴリの絞り込みを解除"
        title="絞り込みを解除"
      >
        ×
      </button>
    </span>
  )

  const kpis = [
    {
      label: '総支出',
      value: yen(summary.total),
      sub: summary.hasPrev
        ? `前月比 ${signedYen(summary.diff)}（${signedPct(summary.rate)}）`
        : '前月のデータなし',
    },
    { label: '支払い回数', value: `${summary.count}回`, sub: '月間合計' },
    {
      label: '1日平均',
      value: yen(summary.dailyAvg),
      sub: summary.partial ? `経過${summary.days}日で算出` : `${summary.days}日で算出`,
    },
    { label: '1回平均', value: yen(summary.perTxAvg), sub: '決済1回あたり' },
  ]

  return (
    <>
      <div className="mb-[14px] grid grid-cols-2 gap-[13px] md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="card">
            <div className="caption">{k.label}</div>
            <div className="value">
              <Num>{k.value}</Num>
            </div>
            <div className="sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {hasFixed && (
        <div className="mb-[14px] flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {excludeFixed && (
            <span className="caption motion-safe:animate-fade">
              以下は固定費（税金・公共料金・住居・通信）{fixedAmount > 0 && `（この月 ${yen(fixedAmount)}）`}を除いて表示中 ・ 上の集計カードは固定費を含む
            </span>
          )}
          <FixedToggle checked={includeFixed} onChange={setIncludeFixed} />
        </div>
      )}

      <div className="mb-[14px] grid gap-[14px] md:grid-cols-[1.05fr_.95fr]">
        <div className="card">
          <div className="cardhead">
            <h2>カテゴリ別支出</h2>
            <span className="caption">{excludeFixed ? '構成比（固定費除く）' : '構成比'}</span>
          </div>
          {cats.length ? (
            <CategoryDonut
              rows={cats}
              catMap={data.catMap}
              total={sum(catSpend)}
              totalLabel={excludeFixed ? '固定費除く' : '総支出'}
              selected={focused}
              onSelect={setFocus}
              onShowTransactions={onCategory}
              topMerchants={(id) => byMerchant(monthSpend.filter((t) => t.categoryId === id))}
            />
          ) : (
            <NoRows text="この月の支出はありません" />
          )}

        </div>
        <div className="card">
          <div className="cardhead">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="shrink-0">月別支出</h2>
              {focusChip}
            </div>
            <div className="flex shrink-0 gap-1" role="group" aria-label="表示期間">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRange(r.id)}
                  aria-pressed={range === r.id}
                  className={`rounded-md border-0 px-2 py-1 text-[11px] transition-colors duration-150 ${
                    range === r.id ? 'bg-pill-active font-bold text-brand' : 'bg-transparent text-faint hover:bg-hover'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <MonthlyChart data={trend} selected={month} onSelect={onMonth} color={trendColor} />
          <p className="caption mt-2">
            {trend.length > 0 &&
              `${monthLabel(trend[0].month)}〜${monthLabel(trend[trend.length - 1].month)} ・ ${
                focusCategory ? `${catName(focusCategory)}のみ ・ ` : 'カテゴリを選択すると絞り込み ・ '
              }点を選択するとその月を表示`}
          </p>
        </div>
      </div>

      {data.accounts.length > 1 && (
        <div className="card mb-[14px]">
          <div className="cardhead">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="shrink-0">支払い元別支出</h2>
              {focusChip}
            </div>
            <span className="caption shrink-0">選択すると取引一覧に移動</span>
          </div>
          {accounts.length ? (
            <Bars
              items={accounts.map((a) => {
                const acc = data.accountMap.get(a.key)
                return { key: a.key, label: acc?.name ?? a.key, note: `${a.count}回`, amount: a.amount, share: a.share, color: accountColor(acc) }
              })}
              onSelect={onAccount}
            />
          ) : (
            <NoRows text="この月の支出はありません" />
          )}
          <p className="caption mt-2">銀行の引落のうち、カード・デビット・PayPayの明細を取り込んだ分は振替として除き、各明細の利用日で集計しています。</p>
        </div>
      )}

      <div className="grid gap-[14px] md:grid-cols-[1.05fr_.95fr]">
        <div className="card">
          <div className="cardhead">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="shrink-0">店舗別支出</h2>
              {focusChip}
            </div>
            <span className="caption shrink-0">{merchants.length > 0 && `${merchants.length}店舗 ・ 金額順`}</span>
          </div>
          {merchants.length === 0 && <NoRows text={focusCategory ? `この月の${catName(focusCategory)}の支出はありません` : 'この月の支出はありません'} />}
          <div className="-mr-1 pr-1 md:max-h-[560px] md:overflow-y-auto">
            {merchants.map((m) => (
              <button
                key={m.key}
                onClick={() => onMerchant(m.key)}
                className="flex w-full items-center gap-[10px] rounded-lg border-0 bg-transparent px-[3px] py-[9px] text-left transition-colors duration-150 hover:bg-hover-soft"
              >
                <div
                  className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] text-[17px] leading-none"
                  style={{ background: `color-mix(in srgb, ${catColor(m.categoryId)} 16%, transparent)` }}
                  title={catName(m.categoryId)}
                  aria-hidden
                >
                  {catEmoji(m.categoryId)}
                </div>
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-xs">{m.key}</b>
                  <p className="mt-1 mb-0 text-[10px] text-[#819087]">
                    {focusCategory ? `${m.count}回 ・ カテゴリ内 ${pct(m.share)}` : `${catName(m.categoryId)} ・ ${m.count}回 ・ ${pct(m.share)}`}
                  </p>
                </div>
                <div className="text-right text-xs font-bold tabular-nums">
                  {yen(m.amount)}
                  <div className="mt-[7px] h-1 w-20 overflow-hidden rounded-[3px] bg-track">
                    <span
                      className="block h-full bg-accent-soft transition-[width] duration-300 ease-out"
                      style={{ width: `${(m.amount / merchants[0].amount) * 100}%` }}
                    />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="cardhead">
            <h2>前月比較</h2>
            <span className="caption">カテゴリ別増減（{prevLabel}比）</span>
          </div>
          {!summary.hasPrev ? (
            <NoRows text={`${prevLabel}のデータがありません`} />
          ) : deltas.length === 0 ? (
            <NoRows text="比較できる支出がありません" />
          ) : (
            deltas.map((d) => (
              <button
                key={d.categoryId}
                onClick={() => onCategory(d.categoryId)}
                className="flex w-full items-center justify-between gap-3 border-0 border-b border-solid border-line-soft bg-transparent px-[2px] py-[11px] text-left text-xs transition-colors duration-150 hover:bg-[#f6f8f4]"
              >
                <span className="flex min-w-0 items-center">
                  <span className="dot mr-2" style={{ background: catColor(d.categoryId) }} />
                  <span className="truncate">{catName(d.categoryId)}</span>
                </span>
                <span className="text-right tabular-nums">
                  <strong style={{ color: d.diff > 0 ? '#b16f4d' : d.diff < 0 ? '#3e8463' : undefined }}>{signedYen(d.diff)}</strong>
                  <span className="ml-2 inline-block w-[58px] text-[11px] text-faint">{d.rate == null ? '前月0円' : signedPct(d.rate)}</span>
                  <span className="block text-[10px] text-faint">
                    {yen(d.previous)} → {yen(d.current)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  )
}
