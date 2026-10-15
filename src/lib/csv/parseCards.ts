import { cardAccountId } from '../accounts'
import { hash53 } from '../hash'
import { matchKey, normalizeKanaName } from '../merchants'
import type { Account, TxKind } from '../types'
import { nfkc, parseOfficialDate, parseYen, type ParseResult, type ParsedTx } from './parsePayPay'

/**
 * クレジットカードの明細（実ファイルで確認。どちらも Shift_JIS・1か月の請求ごとに1ファイル）。
 * 取引番号がないため、カード・利用日・店名・金額・支払区分とファイル内の出現順で重複判定IDを作る。
 * 分割払いは毎月の明細に同じ利用が出てくるが、今回の回数を含めないので1件にまとまる（利用日に総額で計上）。
 */

/** 投資信託の積立など、カード払いでも消費支出ではないもの */
const INVESTMENT = /証券|投信|積立/

export function classifyCard(payee: string, direction: 'out' | 'in'): TxKind {
  if (direction === 'in') return 'refund'
  if (INVESTMENT.test(matchKey(payee))) return 'investment'
  return 'payment'
}

const DATE = /^\d{4}\/\d{1,2}\/\d{1,2}$/

// ---- セゾンカード ---------------------------------------------------------
// カード名称,<カード名> / お支払日,yyyy/MM/dd / 今回ご請求額,<金額> / （空行）/
// 利用日,ご利用店名及び商品名,本人・家族区分,支払区分名称,締前入金区分,利用金額,備考

export function isSaisonCsv(rows: string[][]): boolean {
  return nfkc(rows[0]?.[0] ?? '') === 'カード名称'
}

export function parseSaisonRows(rows: string[][], fileName: string): ParseResult {
  const meta = (name: string) => nfkc(rows.find((r) => nfkc(r[0] ?? '') === name)?.[1] ?? '')
  const cardName = meta('カード名称') || 'セゾンカード'
  const account: Account = { id: cardAccountId('saison', cardName), name: cardName, type: 'credit' }
  const headerAt = rows.findIndex((r) => nfkc(r[0] ?? '') === '利用日')
  if (headerAt < 0) throw new Error('明細の見出し行（利用日・ご利用店名及び商品名…）がありません。')
  const header = rows[headerAt].map((h) => nfkc(h))
  const col = (name: string) => header.indexOf(name)
  const idx = { date: col('利用日'), payee: col('ご利用店名及び商品名'), amount: col('利用金額'), method: col('支払区分名称') }

  const paymentDate = meta('お支払日') ? parseOfficialDate(meta('お支払日')).slice(0, 10) : undefined
  const total = parseYen(meta('今回ご請求額'))
  const body = rows.slice(headerAt + 1)
  const { rows: out, errors } = parseCardBody(body, headerAt + 2, account, 'saison', (cells) => {
    const raw: Record<string, string> = {}
    header.forEach((h, j) => (raw[h || `列${j + 1}`] = cells[j] ?? ''))
    return {
      raw,
      date: cells[idx.date] ?? '',
      payee: cells[idx.payee] ?? '',
      amount: cells[idx.amount] ?? '',
      keyParts: [cells[idx.method] ?? ''],
      method: nfkc(cells[idx.method] ?? '') || undefined,
    }
  })
  const paymentMonth = paymentDate?.slice(0, 7) ?? monthFromFileName(fileName) ?? nextMonthOf(out)
  const statements = paymentMonth && total != null ? [{ id: `${account.id}:${paymentMonth}`, accountId: account.id, paymentMonth, paymentDate, total }] : []
  for (const t of out) t.statementMonth = paymentMonth
  return { format: 'saison', rows: out, totalRows: body.length, skipped: 0, errors, account, statements }
}

// ---- 三井住友カード -------------------------------------------------------
// 1行目: <氏名>様,<マスクしたカード番号>,<カード名>（列名の行はない）
// 明細: ご利用日,ご利用店名,ご利用金額,支払回数,今回回数,お支払い金額,備考
// 最終行: 合計（1列目が空欄）

const SMBC_COLUMNS = ['ご利用日', 'ご利用店名', 'ご利用金額', '支払回数', '今回回数', 'お支払い金額', '備考']

export function isSmbcCsv(rows: string[][]): boolean {
  const first = rows[0] ?? []
  return first.length >= 3 && /\*{4}/.test(first[1] ?? '') && rows.slice(1).some((r) => DATE.test(nfkc(r[0] ?? '')))
}

export function parseSmbcRows(rows: string[][], fileName: string): ParseResult {
  const cardName = nfkc(rows[0][2] ?? '')
  // 1行目の氏名・カード番号は保存しない（バックアップなどに個人情報を含めないため）
  const account: Account = {
    id: cardAccountId('smbc', cardName),
    name: cardName ? `三井住友カード（${cardName}）` : '三井住友カード',
    type: 'credit',
  }
  const body = rows.slice(1).filter((r) => nfkc(r[0] ?? '') !== '')
  const footer = rows.slice(1).find((r) => nfkc(r[0] ?? '') === '' && r.some((c) => nfkc(c) !== ''))
  const total = footer ? parseYen(footer.find((c) => nfkc(c) !== '')) : null
  const { rows: out, errors } = parseCardBody(body, 2, account, 'smbc-card', (cells) => {
    const raw: Record<string, string> = {}
    SMBC_COLUMNS.forEach((h, j) => (raw[h] = cells[j] ?? ''))
    const times = nfkc(cells[3] ?? '')
    return {
      raw,
      date: cells[0] ?? '',
      payee: cells[1] ?? '',
      amount: cells[2] ?? '',
      keyParts: [times],
      method: times && times !== '1' ? `${times}回払い` : '1回',
    }
  })
  const paymentMonth = monthFromFileName(fileName) ?? nextMonthOf(out)
  const statements = paymentMonth && total != null ? [{ id: `${account.id}:${paymentMonth}`, accountId: account.id, paymentMonth, total }] : []
  for (const t of out) t.statementMonth = paymentMonth
  return { format: 'smbc-card', rows: out, totalRows: body.length, skipped: 0, errors, account, statements }
}

// ---- 共通 ----------------------------------------------------------------

interface CardRow {
  raw: Record<string, string>
  date: string
  payee: string
  amount: string
  /** 重複判定IDに含める追加の値（支払区分など） */
  keyParts: string[]
  method?: string
}

function parseCardBody(
  body: string[][],
  firstLine: number,
  account: Account,
  format: 'saison' | 'smbc-card',
  read: (cells: string[]) => CardRow,
): { rows: ParsedTx[]; errors: string[] } {
  const out: ParsedTx[] = []
  const errors: string[] = []
  const seen = new Map<string, number>()
  body.forEach((cells, i) => {
    try {
      const r = read(cells)
      const signed = parseYen(r.amount)
      if (signed == null) throw new Error('金額が空欄です')
      const occurredAt = parseOfficialDate(r.date)
      const payee = normalizeKanaName(r.payee)
      const direction = signed < 0 ? 'in' : 'out'
      const base = `${format === 'saison' ? 's' : 'm'}:${hash53([account.id, occurredAt, payee, signed, ...r.keyParts].join('\u001f'))}`
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      out.push({
        id: `${base}:${n}`,
        format,
        accountId: account.id,
        raw: r.raw,
        occurredAt,
        month: occurredAt.slice(0, 7),
        amount: Math.abs(signed),
        direction,
        kind: signed === 0 ? 'unknown' : classifyCard(payee, direction),
        description: 'カード払い',
        payee,
        method: r.method,
      })
    } catch (e) {
      errors.push(`${firstLine + i}行目: ${(e as Error).message}`)
    }
  })
  return { rows: out, errors }
}

/** ファイル名の yyyyMM（例: 202608.csv）を支払月とする */
function monthFromFileName(fileName: string): string | undefined {
  const m = fileName.match(/(20\d{2})(0[1-9]|1[0-2])(?!\d)/)
  return m ? `${m[1]}-${m[2]}` : undefined
}

/** 支払月が分からない場合は、最後の利用月の翌月とする */
function nextMonthOf(rows: ParsedTx[]): string | undefined {
  const last = rows.map((r) => r.month).sort().pop()
  if (!last) return undefined
  const y = Number(last.slice(0, 4))
  const mo = Number(last.slice(5, 7))
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
}

