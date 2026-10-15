import { Cell, Pie, PieChart } from 'recharts'
import type { GroupRow } from '../lib/analytics'
import type { Category } from '../lib/types'
import { pct, yen } from '../lib/format'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { Num } from './Num'
import { UNCATEGORIZED } from '../lib/categories'

/** この構成比未満のカテゴリはドーナツ上で「その他」にまとめる（凡例には個別に表示） */
const FOLD_SHARE = 0.03
const OTHER = 'other'

/** ドーナツの区画: カテゴリの並び順で固定し、少額カテゴリを「その他」にまとめる */
function donutSlices(rows: GroupRow[], catMap: Map<string, Category>) {
  const folded = new Set(rows.filter((r) => r.share < FOLD_SHARE && r.key !== UNCATEGORIZED && r.key !== OTHER).map((r) => r.key))
  const slices = new Map<string, number>()
  for (const r of rows) {
    const key = folded.has(r.key) ? OTHER : r.key
    slices.set(key, (slices.get(key) ?? 0) + r.amount)
  }
  const order = (id: string) => catMap.get(id)?.order ?? 50
  return {
    folded,
    slices: [...slices.entries()].map(([key, amount]) => ({ key, amount })).sort((a, b) => order(a.key) - order(b.key)),
  }
}

interface Props {
  rows: GroupRow[]
  catMap: Map<string, Category>
  total: number
  totalLabel?: string
  selected: string | null
  onSelect: (id: string | null) => void
  onShowTransactions: (categoryId: string) => void
  topMerchants: (categoryId: string) => { key: string; amount: number }[]
}

export function CategoryDonut({ rows, catMap, total, totalLabel = '総支出', selected, onSelect, onShowTransactions, topMerchants }: Props) {
  const reduced = useReducedMotion()
  const sel = rows.find((r) => r.key === selected)
  const { slices, folded } = donutSlices(rows, catMap)
  const sliceOf = (key: string | null) => (key && folded.has(key) ? OTHER : key)
  const name = (id: string) => catMap.get(id)?.name ?? '未分類'
  const color = (id: string) => catMap.get(id)?.color ?? '#c4cbc1'
  return (
    <>
      <div className="flex items-center gap-[13px] sm:gap-6">
        <div className="relative h-[143px] w-[143px] shrink-0 sm:h-[178px] sm:w-[178px]">
          <PieChart width={178} height={178} className="origin-top-left scale-[0.8034] sm:scale-100" aria-label="カテゴリ別支出のドーナツグラフ">
            <Pie
              data={slices}
              dataKey="amount"
              nameKey="key"
              innerRadius={64}
              outerRadius={89}
              startAngle={90}
              endAngle={-270}
              stroke="#fff"
              strokeWidth={2}
              isAnimationActive={!reduced}
              animationDuration={300}
              onClick={(_, i) => {
                const k = slices[i]?.key
                if (k) onSelect(sliceOf(selected) === k ? null : k)
              }}
              style={{ cursor: 'pointer', outline: 'none' }}
            >
              {slices.map((r) => (
                <Cell key={r.key} fill={color(r.key)} opacity={selected && sliceOf(selected) !== r.key ? 0.35 : 1} />
              ))}
            </Pie>
          </PieChart>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <span className="block max-w-[100px] truncate text-[11px] text-[#8c9a90]">{sel ? name(sel.key) : totalLabel}</span>
              <strong className="text-base sm:text-xl">
                <Num>{yen(sel ? sel.amount : total)}</Num>
              </strong>
            </div>
          </div>
        </div>
        <div className="max-h-[230px] min-w-0 flex-1 overflow-y-auto">
          {rows.map((r) => (
            <button
              key={r.key}
              onClick={() => onSelect(selected === r.key ? null : r.key)}
              aria-pressed={selected === r.key}
              className={`flex w-full items-center gap-2 rounded-md border-0 px-[2px] py-[6px] text-left text-[11px] text-legend transition-colors duration-150 hover:bg-hover sm:px-1 sm:py-[7px] sm:text-xs ${
                selected === r.key ? 'bg-hover' : 'bg-transparent'
              }`}
            >
              <span className="dot" style={{ background: color(r.key) }} />
              <span className="min-w-0 truncate">{name(r.key)}</span>
              <span className="ml-auto hidden text-faint tabular-nums lg:inline">{yen(r.amount)}</span>
              <b className="ml-auto text-ink tabular-nums lg:ml-2">{pct(r.share)}</b>
            </button>
          ))}
        </div>
      </div>
      {folded.size > 0 && (
        <p className="caption mt-3 mb-0">
          構成比{FOLD_SHARE * 100}%未満の{folded.size}カテゴリ（{[...folded].map(name).join('・')}）はグラフ上で「{name(OTHER)}」にまとめています
        </p>
      )}
      {sel && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[9px] bg-mini px-4 py-3 text-xs motion-safe:animate-fade">
          <span className="flex items-center gap-2 font-bold">
            <span className="dot" style={{ background: color(sel.key) }} />
            {name(sel.key)}
          </span>
          <span className="tabular-nums">{yen(sel.amount)}</span>
          <span className="text-faint">{sel.count}回 ・ 構成比 {pct(sel.share)}</span>
          <span className="min-w-0 truncate text-faint">
            主な店舗: {topMerchants(sel.key).slice(0, 3).map((m) => m.key).join('、')}
          </span>
          <button className="ml-auto border-0 bg-transparent p-0 font-bold text-brand hover:underline" onClick={() => onShowTransactions(sel.key)}>
            取引を見る →
          </button>
        </div>
      )}
    </>
  )
}
