import { Fragment, useMemo, useState } from 'react'
import { AMOUNT_BANDS, inBand, monthLabel, sum } from '../lib/analytics'
import { KIND_LABEL, KIND_ORDER } from '../lib/categories'
import { db } from '../lib/db'
import { dateTime, yen } from '../lib/format'
import { displayName } from '../lib/merchants'
import { FORMAT_LABEL } from '../lib/csv'
import type { EnrichedTx, TxKind } from '../lib/types'
import type { SpendlyData } from '../hooks/useData'
import { usePersistentState } from '../hooks/usePersistentState'
import { EMPTY_FILTER, type KindFilter, type TxFilter } from '../state'

interface Props {
  data: SpendlyData
  month: string
  filter: TxFilter
  onFilter: (f: TxFilter) => void
}

type SortKey = 'date' | 'merchant' | 'amount'

const LINK_LABEL: Record<string, string> = { paypay: 'PayPay', 'aeon-debit': 'イオンデビット', saison: 'セゾンカード', smbc: '三井住友カード' }
const PAGE = 100

const kindMatches = (t: EnrichedTx, k: KindFilter) =>
  k === 'all' ? true : k === 'spending' ? t.effectiveKind === 'payment' : t.effectiveKind === k

async function setCategory(t: EnrichedTx, categoryId: string) {
  const cur = await db.txOverrides.get(t.id)
  if (categoryId === '') {
    if (!cur) return
    if (cur.kind) await db.txOverrides.put({ txId: t.id, kind: cur.kind })
    else await db.txOverrides.delete(t.id)
  } else {
    await db.txOverrides.put({ ...cur, txId: t.id, categoryId })
  }
}

async function setKind(t: EnrichedTx, kind: TxKind) {
  const cur = await db.txOverrides.get(t.id)
  if (kind === t.autoKind) {
    if (!cur) return
    if (cur.categoryId) await db.txOverrides.put({ txId: t.id, categoryId: cur.categoryId })
    else await db.txOverrides.delete(t.id)
  } else {
    await db.txOverrides.put({ ...cur, txId: t.id, kind })
  }
}

export function Transactions({ data, month, filter, onFilter }: Props) {
  const [sort, setSort] = usePersistentState<{ key: SortKey; desc: boolean }>('transactions.sort', { key: 'date', desc: true })
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState<string | null>(null)
  const set = (patch: Partial<TxFilter>) => {
    setLimit(PAGE)
    onFilter({ ...filter, ...patch })
  }

  const merchantsInData = useMemo(
    () => [...new Set(data.txs.filter((t) => t.effectiveKind === 'payment').map((t) => t.merchant))].sort((a, b) => a.localeCompare(b, 'ja')),
    [data.txs],
  )

  const rows = useMemo(() => {
    const q = filter.query.trim().normalize('NFKC').toLowerCase()
    const band = AMOUNT_BANDS.find((b) => b.id === filter.bandId)
    const out = data.txs.filter((t) => {
      if (filter.period === 'month' && t.month !== month) return false
      if (!kindMatches(t, filter.kind)) return false
      if (filter.categoryId && (t.effectiveKind !== 'payment' || t.categoryId !== filter.categoryId)) return false
      if (filter.merchant && t.merchant !== filter.merchant) return false
      if (filter.accountId && t.accountId !== filter.accountId) return false
      if (band && !inBand(t.amount, band)) return false
      if (q) {
        const hay = [
          t.merchant, t.payee, t.store ?? '', data.catMap.get(t.categoryId)?.name ?? '', t.description, KIND_LABEL[t.effectiveKind],
          data.accountMap.get(t.accountId)?.name ?? '',
        ]
          .join(' ')
          .normalize('NFKC')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    const dir = sort.desc ? -1 : 1
    out.sort((a, b) => {
      const c =
        sort.key === 'amount'
          ? a.amount - b.amount
          : sort.key === 'merchant'
            ? a.merchant.localeCompare(b.merchant, 'ja')
            : a.occurredAt.localeCompare(b.occurredAt)
      return c * dir || b.occurredAt.localeCompare(a.occurredAt)
    })
    return out
  }, [data.txs, data.catMap, filter, month, sort])

  const pillCats = useMemo(() => {
    const used = new Set(data.txs.filter((t) => t.effectiveKind === 'payment').map((t) => t.categoryId))
    return data.categories.filter((c) => used.has(c.id))
  }, [data.txs, data.categories])

  const conditions = [
    filter.period === 'month' ? monthLabel(month) : '全期間',
    filter.kind === 'spending' ? '支出' : filter.kind === 'all' ? 'すべての種別' : KIND_LABEL[filter.kind],
    filter.categoryId && data.catMap.get(filter.categoryId)?.name,
    filter.merchant,
    filter.accountId && (data.accountMap.get(filter.accountId)?.name ?? filter.accountId),
    filter.bandId && AMOUNT_BANDS.find((b) => b.id === filter.bandId)?.label,
    filter.query && `「${filter.query}」`,
  ].filter(Boolean)

  const outSum = sum(rows.filter((t) => t.direction === 'out'))
  const inSum = sum(rows.filter((t) => t.direction === 'in'))

  const sortHeader = (key: SortKey, label: string, right = false) => (
    <th className={`th ${right ? 'text-right!' : ''}`} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button
        className="border-0 bg-transparent p-0 text-[11px] text-inherit hover:text-brand"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'merchant' }))}
      >
        {label}
        {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  )

  return (
    <div className="card">
      <div className="cardhead flex-wrap gap-[14px]">
        <div>
          <h2>取引一覧</h2>
          <p className="meta">{conditions.join(' ・ ')}</p>
        </div>
        <input
          className="input w-[260px] max-w-full"
          placeholder="店舗・カテゴリ・支払い元で検索"
          aria-label="取引検索"
          value={filter.query}
          onChange={(e) => set({ query: e.target.value })}
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-[7px]" role="group" aria-label="カテゴリ">
        <button className={`pill ${!filter.categoryId ? 'pill-active' : ''}`} onClick={() => set({ categoryId: null })}>
          すべて
        </button>
        {pillCats.map((c) => (
          <button key={c.id} className={`pill ${filter.categoryId === c.id ? 'pill-active' : ''}`} onClick={() => set({ categoryId: c.id })}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className="select" aria-label="期間" value={filter.period} onChange={(e) => set({ period: e.target.value as TxFilter['period'] })}>
          <option value="month">{monthLabel(month)}</option>
          <option value="all">全期間</option>
        </select>
        <select className="select" aria-label="種別" value={filter.kind} onChange={(e) => set({ kind: e.target.value as KindFilter })}>
          <option value="spending">支出（支払い）</option>
          <option value="all">すべての種別</option>
          {KIND_ORDER.filter((k) => k !== 'payment').map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <select className="select max-w-[180px]" aria-label="店舗" value={filter.merchant ?? ''} onChange={(e) => set({ merchant: e.target.value || null })}>
          <option value="">すべての店舗</option>
          {filter.merchant && !merchantsInData.includes(filter.merchant) && <option value={filter.merchant}>{filter.merchant}</option>}
          {merchantsInData.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {data.accounts.length > 1 && (
          <select className="select max-w-[200px]" aria-label="支払い元" value={filter.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value || null })}>
            <option value="">すべての支払い元</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        <select className="select" aria-label="金額帯" value={filter.bandId ?? ''} onChange={(e) => set({ bandId: e.target.value || null })}>
          <option value="">すべての金額</option>
          {AMOUNT_BANDS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <button className="border-0 bg-transparent px-1 text-xs text-faint hover:text-brand" onClick={() => set({ ...EMPTY_FILTER, period: filter.period })}>
          条件をクリア
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              {sortHeader('date', '日時')}
              {sortHeader('merchant', '店舗')}
              <th className="th">カテゴリ</th>
              <th className="th">取引種別</th>
              {sortHeader('amount', '金額', true)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="td py-[25px]! text-center text-[#829087]">
                  該当する取引はありません
                </td>
              </tr>
            )}
            {rows.slice(0, limit).map((t) => {
              const isPay = t.effectiveKind === 'payment'
              const sub = [
                data.accounts.length > 1 ? data.accountMap.get(t.accountId)?.name : null,
                displayName(t.payee) !== t.merchant ? displayName(t.payee) : null,
                t.store,
              ]
                .filter(Boolean)
                .join(' ・ ')
              // PayPay以外の明細には時刻がない
              const hasTime = t.format === 'official' || t.format === 'legacy'
              return (
                <Fragment key={t.id}>
                  <tr className="transition-colors duration-150 hover:bg-[#fafbf8]">
                    <td className="td whitespace-nowrap text-[#88978a] tabular-nums">
                      {dateTime(t.occurredAt).slice(0, 10)}
                      {hasTime && <span className="block text-[10px] sm:ml-1.5 sm:inline sm:text-xs">{dateTime(t.occurredAt).slice(11)}</span>}
                    </td>
                    <td className="td">
                      <button
                        className="border-0 bg-transparent p-0 text-left text-xs text-ink"
                        onClick={() => setOpen(open === t.id ? null : t.id)}
                        aria-expanded={open === t.id}
                        title="元データを表示"
                      >
                        <b>{t.merchant}</b>
                        {sub && <span className="block text-[10px] text-faint">{sub}</span>}
                      </button>
                    </td>
                    <td className="td">
                      {isPay ? (
                        <select
                          className="tag cursor-pointer appearance-none border-0 pr-[7px]"
                          aria-label={`${t.merchant}のカテゴリ`}
                          value={t.categoryOverridden ? t.categoryId : ''}
                          title={t.categoryOverridden ? 'この取引のみ手動で変更済み' : '店舗の設定に従う'}
                          onChange={(e) => setCategory(t, e.target.value)}
                          style={t.categoryOverridden ? { background: '#dce9df', color: '#255e48', fontWeight: 700 } : undefined}
                        >
                          <option value="">{data.catMap.get(t.categoryId)?.name ?? '未分類'}</option>
                          {data.categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[11px] text-faint">—</span>
                      )}
                    </td>
                    <td className="td">
                      {t.autoKind === 'unknown' || t.effectiveKind !== t.autoKind ? (
                        <select
                          className="tag cursor-pointer appearance-none border-0 pr-[7px]"
                          aria-label="取引種別"
                          value={t.effectiveKind}
                          onChange={(e) => setKind(t, e.target.value as TxKind)}
                          style={t.effectiveKind === 'unknown' ? { background: '#f7eee6', color: '#9a5f3f', fontWeight: 700 } : undefined}
                        >
                          {KIND_ORDER.map((k) => (
                            <option key={k} value={k}>
                              {KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={isPay ? 'tag' : 'tag bg-[#f3f4ef]! text-[#7d8a80]!'}>{KIND_LABEL[t.effectiveKind]}</span>
                      )}
                    </td>
                    <td className={`td text-right font-bold whitespace-nowrap tabular-nums ${isPay ? '' : 'text-[#7d8a80]'}`}>
                      {t.direction === 'in' ? '+' : ''}
                      {yen(t.amount)}
                    </td>
                  </tr>
                  {open === t.id && (
                    <tr>
                      <td colSpan={5} className="border-b border-line-soft bg-mini px-[9px] py-3">
                        <div className="mb-2 text-[11px] font-bold text-faint">元のCSVデータ（{FORMAT_LABEL[t.format]}）</div>
                        {t.link && (
                          <p className="mt-0 mb-2 text-[11px]">
                            {t.link.covered
                              ? `${LINK_LABEL[t.link.target] ?? t.link.target}の明細を取り込み済みのため、振替として支出から除いています（内訳はその明細で集計）。`
                              : `${LINK_LABEL[t.link.target] ?? t.link.target}の明細（この引落に対応するもの）が取り込まれていないため、内訳なしの支出として数えています。`}
                          </p>
                        )}
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px] sm:grid-cols-[auto_1fr_auto_1fr]">
                          {Object.entries(t.raw).map(([k, v]) => (
                            <Fragment key={k}>
                              <dt className="text-faint">{k}</dt>
                              <dd className="m-0 break-all">{v || '—'}</dd>
                            </Fragment>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="caption m-0">
          {rows.length}件
          {outSum > 0 && ` ・ 出金合計 ${yen(outSum)}`}
          {inSum > 0 && ` ・ 入金合計 ${yen(inSum)}`}
          {rows.length > limit && ` ・ ${limit}件を表示中`}
        </p>
        {rows.length > limit && (
          <button className="control" onClick={() => setLimit((l) => l + PAGE)}>
            さらに表示
          </button>
        )}
      </div>
    </div>
  )
}
