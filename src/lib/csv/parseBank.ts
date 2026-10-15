import { BANK_ACCOUNT, linkTargetOf } from '../accounts'
import { hash53 } from '../hash'
import { matchKey } from '../merchants'
import type { TxKind } from '../types'
import { nfkc, parseOfficialDate, parseYen, type ParseResult, type ParsedTx } from './parsePayPay'

/**
 * 銀行の普通預金明細（実ファイルで確認。Shift_JIS・ヘッダーあり5列）
 *   日付, お取引内容, お引出し, お預入れ, 残高（お借入れはマイナス表示）
 * 取引番号がないため、日付・内容・金額・残高とファイル内の出現順で重複判定IDを作る（残高を含むのでほぼ一意）。
 */
export const BANK_COLUMNS = ['日付', 'お取引内容', 'お引出し', 'お預入れ'] as const

export function isBankCsv(rows: string[][]): boolean {
  const first = rows[0]?.map((c) => nfkc(c)) ?? []
  return BANK_COLUMNS.every((name) => first.some((c) => c.startsWith(name)))
}

/**
 * 取引内容と入出金方向から種別を判定する。
 * PayPay・デビット・カードの引落は「振替」とし、内訳の明細がない期間は表示時に支出へ戻す（enrich.ts）。
 */
export function classifyBank(description: string, direction: 'out' | 'in'): TxKind {
  const k = matchKey(description)
  if (k.includes('atm')) return 'cash'
  if (direction === 'in') {
    const target = linkTargetOf(description)
    // デビットの入金は返品・キャッシュバック、PayPayからの入金は残高の出金（振替）
    if (target === 'aeon-debit') return 'refund'
    if (target) return 'internal'
    return 'income'
  }
  if (linkTargetOf(description)) return 'internal'
  if (/カクテイキヨシユツ|確定拠出|ショウケン|証券|トウシン/.test(k)) return 'investment'
  // Web即時決済は証券口座への入金にも買い物にも使われるため、利用者が判断する
  if (/webソクジケツサイ|ソクジケツサイ/.test(k)) return 'unknown'
  if (/^インターネツト\(フリコミ\)|^フリコミ|^振込/.test(k)) return 'transfer_out'
  return 'payment'
}

export function parseBankRows(rows: string[][]): ParseResult {
  const header = rows[0].map((h) => nfkc(h))
  const col = (name: string) => header.findIndex((h) => h.startsWith(name))
  const idx = { date: col('日付'), desc: col('お取引内容'), out: col('お引出し'), in: col('お預入れ'), balance: col('残高') }
  const out: ParsedTx[] = []
  const errors: string[] = []
  const seen = new Map<string, number>()
  const body = rows.slice(1)
  body.forEach((cells, i) => {
    try {
      const raw: Record<string, string> = {}
      rows[0].forEach((h, j) => (raw[h.trim() || `列${j + 1}`] = cells[j] ?? ''))
      const outAmt = parseYen(cells[idx.out])
      const inAmt = parseYen(cells[idx.in])
      const direction = outAmt ? 'out' : 'in'
      const amount = Math.abs((outAmt || inAmt) ?? 0)
      const description = (cells[idx.desc] ?? '').trim()
      const occurredAt = parseOfficialDate(cells[idx.date] ?? '')
      const base = `b:${hash53(cells.map((c) => c.trim()).join('\u001f'))}`
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      out.push({
        id: `${base}:${n}`,
        format: 'bank',
        accountId: BANK_ACCOUNT.id,
        raw,
        occurredAt,
        month: occurredAt.slice(0, 7),
        amount,
        direction,
        kind: amount === 0 ? 'unknown' : classifyBank(description, direction),
        description,
        payee: description,
      })
    } catch (e) {
      errors.push(`${i + 2}行目: ${(e as Error).message}`)
    }
  })
  return { format: 'bank', rows: out, totalRows: body.length, skipped: 0, errors, account: BANK_ACCOUNT }
}
