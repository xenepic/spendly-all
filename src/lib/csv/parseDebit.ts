import { DEBIT_ACCOUNT, linkTargetOf } from '../accounts'
import { matchKey, normalizeKanaName } from '../merchants'
import type { Transaction, TxKind } from '../types'
import { nfkc, parseOfficialDate, parseYen, type ParseResult, type ParsedTx } from './parsePayPay'

/**
 * イオンデビットの明細（自作のChrome拡張機能 ../debit が出力。UTF-8 BOM付き・ヘッダーあり）
 *   取引番号, 利用日, 利用先, 金額, 金額区分, 確定区分, 有効性確認区分, ご利用分
 * 仕様は debit/docs/csv-format.md。取引番号で重複を判定する。
 */
export const DEBIT_HEADER = ['取引番号', '利用日', '利用先', '金額', '金額区分', '確定区分', '有効性確認区分', 'ご利用分']

export function isDebitCsv(rows: string[][]): boolean {
  const first = rows[0]?.map((c) => nfkc(c)) ?? []
  return DEBIT_HEADER.every((name) => first.includes(name))
}

/**
 * 金額区分が空白以外（返品・取消の可能性）は要確認。
 * チャージは、PayPayへのチャージだけを振替にする（PayPayの明細で支払いを数えるため）。
 * 交通系ICなどへのチャージは利用明細を取り込まないので、支出（交通など）として数える。
 */
export function classifyDebit(t: Pick<Transaction, 'raw' | 'payee'>): TxKind {
  if ((t.raw['金額区分'] ?? '').trim() !== '') return 'unknown'
  if (/チ[ヤャ][-ー]?ジ/.test(matchKey(t.payee)) && linkTargetOf(t.payee) === 'paypay') return 'internal'
  return 'payment'
}

export function parseDebitRows(rows: string[][]): ParseResult {
  const header = rows[0].map((h) => nfkc(h))
  const col = (name: string) => header.indexOf(name)
  const out: ParsedTx[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  let skipped = 0
  const body = rows.slice(1)
  body.forEach((cells, i) => {
    try {
      const raw: Record<string, string> = {}
      header.forEach((h, j) => (raw[h] = cells[j] ?? ''))
      // 未確定の利用（後で金額が変わることがある）と、カードの有効性確認（支払いではない）は取り込まない
      if (raw['確定区分'].trim() !== '1' || (raw['有効性確認区分'].trim() || '0') !== '0') {
        skipped++
        return
      }
      const txNumber = raw['取引番号'].trim()
      if (!txNumber) throw new Error('取引番号が空欄です')
      if (seen.has(txNumber)) return
      seen.add(txNumber)
      const amount = parseYen(cells[col('金額')])
      if (amount == null) throw new Error('金額が空欄です')
      const occurredAt = parseOfficialDate(raw['利用日'])
      const payee = normalizeKanaName(raw['利用先'])
      out.push({
        id: `d:${txNumber}`,
        format: 'aeon-debit',
        accountId: DEBIT_ACCOUNT.id,
        raw,
        txNumber,
        occurredAt,
        month: occurredAt.slice(0, 7),
        amount: Math.abs(amount),
        direction: 'out',
        kind: amount === 0 ? 'unknown' : classifyDebit({ raw, payee }),
        description: 'デビット',
        payee,
      })
    } catch (e) {
      errors.push(`${i + 2}行目: ${(e as Error).message}`)
    }
  })
  return { format: 'aeon-debit', rows: out, totalRows: body.length, skipped, errors, account: DEBIT_ACCOUNT }
}
