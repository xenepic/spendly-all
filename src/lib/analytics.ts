import { addMonths, format, getDaysInMonth, parse } from 'date-fns'
import type { EnrichedTx } from './types'

/** 消費支出として集計する取引（支払いのみ。チャージ・送金・返金・ポイント等は含めない） */
export const isSpending = (t: EnrichedTx) => t.effectiveKind === 'payment'

export const sum = (txs: { amount: number }[]) => txs.reduce((a, t) => a + t.amount, 0)

export const monthOf = (m: string) => parse(m, 'yyyy-MM', new Date(2000, 0, 1))
export const shiftMonth = (m: string, n: number) => format(addMonths(monthOf(m), n), 'yyyy-MM')
export const monthLabel = (m: string) => `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`
export const shortMonthLabel = (m: string) => `${Number(m.slice(5, 7))}月`

/** 最初の月から最後の月まで、取引のない月も含めて連続した月の配列 */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let m = from; m <= to; m = shiftMonth(m, 1)) out.push(m)
  return out
}

export function availableMonths(txs: EnrichedTx[]): string[] {
  const ms = txs.filter(isSpending).map((t) => t.month)
  if (ms.length === 0) return []
  ms.sort()
  return monthRange(ms[0], ms[ms.length - 1])
}

export interface MonthSummary {
  month: string
  total: number
  count: number
  prevTotal: number
  /** 前月に支出データがあるか（ない場合は比較を表示しない） */
  hasPrev: boolean
  diff: number
  /** 前月比（割合）。前月が0の場合は null */
  rate: number | null
  days: number
  dailyAvg: number
  perTxAvg: number
  /** 当月の途中の場合 true（1日平均を経過日数で算出） */
  partial: boolean
}

export function monthSummary(spend: EnrichedTx[], month: string, today = new Date(), allMonths?: string[]): MonthSummary {
  const cur = spend.filter((t) => t.month === month)
  const prevMonth = shiftMonth(month, -1)
  const prev = spend.filter((t) => t.month === prevMonth)
  const total = sum(cur)
  const prevTotal = sum(prev)
  const todayMonth = format(today, 'yyyy-MM')
  const partial = month === todayMonth
  const days = partial ? today.getDate() : getDaysInMonth(monthOf(month))
  const hasPrev = allMonths ? allMonths.includes(prevMonth) : prev.length > 0
  return {
    month,
    total,
    count: cur.length,
    prevTotal,
    hasPrev,
    diff: total - prevTotal,
    rate: prevTotal > 0 ? (total - prevTotal) / prevTotal : null,
    days,
    dailyAvg: days > 0 ? total / days : 0,
    perTxAvg: cur.length > 0 ? total / cur.length : 0,
    partial,
  }
}

export interface GroupRow {
  key: string
  amount: number
  count: number
  share: number
  avg: number
}

function groupBy(spend: EnrichedTx[], keyOf: (t: EnrichedTx) => string): GroupRow[] {
  const total = sum(spend)
  const map = new Map<string, { amount: number; count: number }>()
  for (const t of spend) {
    const k = keyOf(t)
    const g = map.get(k) ?? { amount: 0, count: 0 }
    g.amount += t.amount
    g.count++
    map.set(k, g)
  }
  return [...map.entries()]
    .map(([key, g]) => ({ key, ...g, share: total > 0 ? g.amount / total : 0, avg: g.count ? g.amount / g.count : 0 }))
    .sort((a, b) => b.amount - a.amount || b.count - a.count || a.key.localeCompare(b.key, 'ja'))
}

export const byCategory = (spend: EnrichedTx[]) => groupBy(spend, (t) => t.categoryId)

/** 支払い元（口座・カード）別 */
export const byAccount = (spend: EnrichedTx[]) => groupBy(spend, (t) => t.accountId)

export interface CashflowRow {
  month: string
  income: number
  spending: number
  /** 収入 − 支出 */
  balance: number
}

/** 月別の収入（銀行の入金のうち収入と判定したもの）と支出 */
export function monthlyCashflow(txs: EnrichedTx[], months: string[]): CashflowRow[] {
  const income = new Map<string, number>()
  const spending = new Map<string, number>()
  for (const t of txs) {
    if (t.effectiveKind === 'income') income.set(t.month, (income.get(t.month) ?? 0) + t.amount)
    else if (isSpending(t)) spending.set(t.month, (spending.get(t.month) ?? 0) + t.amount)
  }
  return months.map((month) => {
    const i = income.get(month) ?? 0
    const s = spending.get(month) ?? 0
    return { month, income: i, spending: s, balance: i - s }
  })
}

export interface MerchantRow extends GroupRow {
  categoryId: string
}

/** 店舗別集計。カテゴリは該当取引で最も金額の大きいもの */
export function byMerchant(spend: EnrichedTx[]): MerchantRow[] {
  const cats = new Map<string, Map<string, number>>()
  for (const t of spend) {
    const m = cats.get(t.merchant) ?? new Map<string, number>()
    m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + t.amount)
    cats.set(t.merchant, m)
  }
  return groupBy(spend, (t) => t.merchant).map((r) => {
    const c = [...(cats.get(r.key) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0]
    return { ...r, categoryId: c?.[0] ?? '' }
  })
}

export function monthlyTotals(spend: EnrichedTx[], months: string[]) {
  const map = new Map<string, { amount: number; count: number }>()
  for (const t of spend) {
    const g = map.get(t.month) ?? { amount: 0, count: 0 }
    g.amount += t.amount
    g.count++
    map.set(t.month, g)
  }
  return months.map((m) => ({ month: m, amount: map.get(m)?.amount ?? 0, count: map.get(m)?.count ?? 0 }))
}

export const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日']

/** 曜日別（月曜始まり） */
export function byWeekday(spend: EnrichedTx[]) {
  const rows = WEEKDAYS.map((label) => ({ label, amount: 0, count: 0 }))
  for (const t of spend) {
    const [y, m, d] = t.occurredAt.slice(0, 10).split('-').map(Number)
    const dow = new Date(y, m - 1, d).getDay() // 0=日
    const r = rows[(dow + 6) % 7]
    r.amount += t.amount
    r.count++
  }
  return rows
}

export interface AmountBand {
  id: string
  label: string
  min: number
  /** 上限（この値未満）。null は上限なし */
  max: number | null
}

export const AMOUNT_BANDS: AmountBand[] = [
  { id: 'lt500', label: '500円未満', min: 0, max: 500 },
  { id: 'lt1000', label: '500〜999円', min: 500, max: 1000 },
  { id: 'lt3000', label: '1,000〜2,999円', min: 1000, max: 3000 },
  { id: 'lt5000', label: '3,000〜4,999円', min: 3000, max: 5000 },
  { id: 'lt10000', label: '5,000〜9,999円', min: 5000, max: 10000 },
  { id: 'gte10000', label: '10,000円以上', min: 10000, max: null },
]

export const inBand = (amount: number, b: Pick<AmountBand, 'min' | 'max'>) =>
  amount >= b.min && (b.max == null || amount < b.max)

export function byAmountBand(spend: EnrichedTx[]) {
  const total = sum(spend)
  return AMOUNT_BANDS.map((b) => {
    const txs = spend.filter((t) => inBand(t.amount, b))
    const amount = sum(txs)
    return { ...b, amount, count: txs.length, share: total > 0 ? amount / total : 0 }
  })
}

export interface CategoryDelta {
  categoryId: string
  current: number
  previous: number
  diff: number
  /** 前月が0の場合は null */
  rate: number | null
}

export function categoryDeltas(spend: EnrichedTx[], month: string): CategoryDelta[] {
  const prevMonth = shiftMonth(month, -1)
  const cur = new Map(byCategory(spend.filter((t) => t.month === month)).map((r) => [r.key, r.amount]))
  const prev = new Map(byCategory(spend.filter((t) => t.month === prevMonth)).map((r) => [r.key, r.amount]))
  const ids = new Set([...cur.keys(), ...prev.keys()])
  return [...ids]
    .map((id) => {
      const c = cur.get(id) ?? 0
      const p = prev.get(id) ?? 0
      return { categoryId: id, current: c, previous: p, diff: c - p, rate: p > 0 ? (c - p) / p : null }
    })
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || b.current - a.current)
}

/** 中央値（円未満は四捨五入） */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}
