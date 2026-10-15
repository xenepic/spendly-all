import { linkTargetOf } from './accounts'
import type { EnrichedTx, Statement } from './types'

export type ReconcileStatus = 'matched' | 'mismatch' | 'no-bank' | 'zero'

export interface ReconcileRow {
  statement: Statement
  status: ReconcileStatus
  /** 同じ月の、同じカード会社の銀行の引落（照合できなかった場合の参考） */
  bankAmounts: number[]
}

const shift = (m: string, n: number) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * カードの請求額と銀行の引落を照合する。
 * 一致しない場合は、明細の取り込み漏れ（同じ月の別の明細）か、銀行の明細が足りない可能性がある。
 */
export function reconcileStatements(statements: Statement[], txs: EnrichedTx[]): ReconcileRow[] {
  const bank = txs.filter((t) => t.format === 'bank' && t.direction === 'out')
  // 銀行の明細の最終日。支払日（不明なら支払月の末日）がこれより後なら、まだ照合できない
  const bankLast = txs.filter((t) => t.format === 'bank').reduce((a, t) => (t.occurredAt > a ? t.occurredAt : a), '')
  return statements.map((s) => {
    const group = s.accountId.split(':')[0]
    // 支払日が休日の場合は翌月にずれることがある
    const months = [s.paymentMonth, shift(s.paymentMonth, 1)]
    const candidates = bank.filter((t) => months.includes(t.month) && linkTargetOf(t.payee) === group)
    if (s.total === 0) return { statement: s, status: 'zero', bankAmounts: [] }
    if (candidates.some((t) => t.amount === s.total)) return { statement: s, status: 'matched', bankAmounts: [] }
    const due = s.paymentDate ?? `${s.paymentMonth}-31`
    if (!bankLast || bankLast.slice(0, 10) < due) return { statement: s, status: 'no-bank', bankAmounts: [] }
    return { statement: s, status: 'mismatch', bankAmounts: candidates.filter((t) => t.month === s.paymentMonth).map((t) => t.amount) }
  })
}
