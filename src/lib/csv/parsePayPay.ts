import Papa from 'papaparse'
import { hash53 } from '../hash'
import { PAYPAY_ACCOUNT } from '../accounts'
import type { Account, CsvFormat, Statement, Transaction, TxKind } from '../types'

/**
 * PayPay 取引履歴 CSV のパーサー。
 *
 * official: PayPayアプリの「取引履歴」からダウンロードする公式CSV（ヘッダーあり・13列）
 *   取引日, 出金金額（円）, 入金金額（円）, 海外出金金額, 通貨, 変換レート（円）, 利用国,
 *   取引内容, 取引先, 取引方法, 支払い区分, 利用者, 取引番号
 *   参照: https://paypay.ne.jp/help/c0447/ , https://paypay.ne.jp/notice/20250206/f-transactionhistory/
 *
 * legacy: ヘッダーなし6列の旧形式（実ファイルで確認）
 *   タイトル（例「セブン-イレブンに支払い」）, 店舗名, ステータス（例「支払い完了」）,
 *   日時（例「2024年5月29日 11時55分」）, 空欄, 符号付き金額
 *   取引番号を含まないため、行の内容とファイル内の出現回数から重複判定IDを作る。
 */

export type ParsedTx = Omit<Transaction, 'importId'>

export interface ParseResult {
  format: CsvFormat
  rows: ParsedTx[]
  totalRows: number
  /** 処理中など取り込み対象外とした行数 */
  skipped: number
  errors: string[]
  /** 明細の口座（カードは明細に記載されたカード名から作る） */
  account: Account
  /** カードの請求（カード明細のみ） */
  statements?: Omit<Statement, 'fileName'>[]
}

export class UnsupportedCsvError extends Error {}

export const LEGACY_COLUMNS = ['タイトル', '店舗', 'ステータス', '日時', '列5', '金額'] as const

export const nfkc = (s: string) => s.normalize('NFKC').trim()

/** 「1,000」「¥1,000」「-」などを整数の円に変換する。空欄は null */
export function parseYen(value: string | undefined): number | null {
  if (value == null) return null
  const v = nfkc(value).replace(/[,¥\s円]/g, '')
  if (v === '' || v === '-' || v === 'ー' || v === '−') return null
  if (!/^[-+]?\d+$/.test(v)) throw new Error(`金額を解釈できません: "${value}"`)
  return Number.parseInt(v, 10)
}

export const pad = (n: string | number) => String(n).padStart(2, '0')

function toLocalIso(y: string, mo: string, d: string, h: string, mi: string): string {
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new Error('日時が範囲外です')
  }
  return `${y}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`
}

/** 「2024/06/03 11:28」「2024-06-03 11:28:05」 */
export function parseOfficialDate(value: string): string {
  const m = nfkc(value).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T]+(\d{1,2}):(\d{1,2})(?::\d{1,2})?)?$/)
  if (!m) throw new Error(`日時を解釈できません: "${value}"`)
  return toLocalIso(m[1], m[2], m[3], m[4] ?? '0', m[5] ?? '0')
}

/** 「2024年5月29日 11時55分」 */
export function parseLegacyDate(value: string): string {
  const m = nfkc(value).match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2})時(\d{1,2})分/)
  if (!m) throw new Error(`日時を解釈できません: "${value}"`)
  return toLocalIso(m[1], m[2], m[3], m[4], m[5])
}

/**
 * 公式CSVの取引内容・取引先・入出金方向から取引種別を判定する。
 * 実CSVで確認した取引内容: 支払い / 請求書払い / ポイント、残高の獲得 / 投資 / チャージ /
 *   受け取った金額 / 送った金額 / 返金 / 期間限定ポイントの期限切れ
 */
export function classifyOfficial(
  description: string,
  payee: string,
  direction: 'out' | 'in',
  txNumber: string,
): TxKind {
  const d = nfkc(description)
  const p = nfkc(payee)
  if (d.includes('返金')) return direction === 'in' ? 'refund' : 'unknown'
  if (txNumber.toLowerCase().startsWith('lp-')) return direction === 'in' ? 'point' : 'unknown'
  if (d.includes('期限切れ') || d.includes('失効')) return 'point'
  if (d.includes('投資') || /(ポイント|ボーナス)運用/.test(d + p)) return direction === 'out' ? 'investment' : 'unknown'
  // 請求書払い（税金・公共料金など）は支払いとして支出に含める
  if (d.includes('請求書')) return direction === 'out' ? 'payment' : 'unknown'
  if (d.includes('チャージ')) return direction === 'in' ? 'charge' : 'unknown'
  if (d.includes('受け取')) return direction === 'in' ? 'transfer_in' : 'unknown'
  if (/送金|送っ|送る/.test(d)) return direction === 'out' ? 'transfer_out' : 'unknown'
  if (d.includes('出金')) return direction === 'out' ? 'withdrawal' : 'unknown'
  if (/ポイント|獲得|付与|キャッシュバック/.test(d)) return direction === 'in' ? 'point' : 'unknown'
  if (d.includes('支払')) return direction === 'out' ? 'payment' : 'unknown'
  return 'unknown'
}

/** 旧形式のステータス・タイトルから取引種別を判定する */
export function classifyLegacy(status: string, title: string, direction: 'out' | 'in'): TxKind {
  const s = nfkc(status)
  const t = nfkc(title)
  if (s.includes('返金')) return direction === 'in' ? 'refund' : 'unknown'
  if (s.includes('請求書')) return direction === 'out' ? 'payment' : 'unknown'
  if (s.startsWith('支払い')) {
    if (/(ポイント|ボーナス)運用/.test(t)) return direction === 'out' ? 'investment' : 'unknown'
    return direction === 'out' && t.endsWith('に支払い') ? 'payment' : 'unknown'
  }
  if (s.startsWith('チャージ')) return direction === 'in' && t.includes('チャージ') ? 'charge' : 'unknown'
  if (s.startsWith('送金')) return direction === 'out' ? 'transfer_out' : 'unknown'
  if (s.startsWith('受け取り')) return direction === 'in' ? 'transfer_in' : 'unknown'
  if (s.startsWith('付与')) return direction === 'in' ? 'point' : 'unknown'
  if (s.includes('出金')) return direction === 'out' ? 'withdrawal' : 'unknown'
  return 'unknown'
}

export type ClassifyInput = Pick<Transaction, 'format' | 'raw' | 'description' | 'payee' | 'direction' | 'txNumber' | 'amount'>

/** 保存済みのPayPayの取引を現在のルールで再判定する（元データから決定的に求まる） */
export function classifyPayPay(t: ClassifyInput): TxKind {
  if (t.amount === 0) return 'unknown'
  return t.format === 'official'
    ? classifyOfficial(t.description, t.payee, t.direction, t.txNumber ?? '')
    : classifyLegacy(t.description, t.raw['タイトル'] ?? t.payee, t.direction)
}

const OFFICIAL_FIELDS = {
  date: '取引日',
  out: '出金金額',
  in: '入金金額',
  description: '取引内容',
  payee: '取引先',
  method: '取引方法',
  txNumber: '取引番号',
} as const

function findHeaderIndex(header: string[], name: string): number {
  return header.findIndex((h) => nfkc(h).replace(/^﻿/, '').startsWith(name))
}

/** PayPayのCSVならその形式、そうでなければ null */
export function detectPayPayFormat(rows: string[][]): 'official' | 'legacy' | null {
  const first = rows[0]?.map((c) => nfkc(c.replace(/^﻿/, ''))) ?? []
  if (first.some((c) => c.startsWith('取引日')) && first.some((c) => c.startsWith('取引内容'))) {
    return 'official'
  }
  const looksLegacy = rows
    .slice(0, 5)
    .every((r) => r.length === 6 && /^\d{4}年\d{1,2}月\d{1,2}日/.test(nfkc(r[3] ?? '')))
  if (rows.length > 0 && looksLegacy) return 'legacy'
  return null
}

/** CSVの文字列を行の配列にする（空行は除く） */
export function splitCsv(text: string): string[][] {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' })
  return parsed.data.filter((r) => r.some((c) => c.trim() !== ''))
}

export function parsePayPayRows(rows: string[][]): ParseResult {
  const format = detectPayPayFormat(rows)
  if (!format) throw new UnsupportedCsvError('PayPayの取引履歴CSVとして認識できませんでした。')
  return format === 'official' ? parseOfficial(rows) : parseLegacy(rows)
}

export function parsePayPayCsv(text: string): ParseResult {
  const rows = splitCsv(text)
  if (rows.length === 0) throw new UnsupportedCsvError('CSVにデータ行がありません。')
  return parsePayPayRows(rows)
}

function parseOfficial(rows: string[][]): ParseResult {
  const header = rows[0].map((h) => h.replace(/^﻿/, '').trim())
  const idx = Object.fromEntries(
    Object.entries(OFFICIAL_FIELDS).map(([k, name]) => [k, findHeaderIndex(header, name)]),
  ) as Record<keyof typeof OFFICIAL_FIELDS, number>
  const missing = Object.entries(idx)
    .filter(([k, i]) => i < 0 && k !== 'method')
    .map(([k]) => OFFICIAL_FIELDS[k as keyof typeof OFFICIAL_FIELDS])
  if (missing.length) {
    throw new UnsupportedCsvError(`必要な列がありません: ${missing.join('、')}`)
  }

  const out: ParsedTx[] = []
  const errors: string[] = []
  const seen = new Map<string, number>()
  const body = rows.slice(1)
  body.forEach((cells, i) => {
    const line = i + 2
    try {
      const raw: Record<string, string> = {}
      header.forEach((h, j) => (raw[h || `列${j + 1}`] = cells[j] ?? ''))
      const outAmt = parseYen(cells[idx.out])
      const inAmt = parseYen(cells[idx.in])
      let direction: 'out' | 'in'
      let amount: number
      if (outAmt != null && outAmt !== 0) {
        direction = 'out'
        amount = Math.abs(outAmt)
      } else if (inAmt != null && inAmt !== 0) {
        direction = 'in'
        amount = Math.abs(inAmt)
      } else {
        direction = 'out'
        amount = 0
      }
      const description = (cells[idx.description] ?? '').trim()
      const payee = (cells[idx.payee] ?? '').trim()
      const txNumber = (cells[idx.txNumber] ?? '').trim()
      const occurredAt = parseOfficialDate(cells[idx.date] ?? '')
      let kind = classifyOfficial(description, payee, direction, txNumber)
      if (amount === 0) kind = 'unknown'
      // 取引番号があればそれを主キーにする。返金などで同一番号が再出現する場合に備え取引内容・方向も含める
      const base = txNumber
        ? `o:${txNumber}:${hash53([description, direction].join('\u001f'))}`
        : `o-:${hash53(cells.map((c) => c.trim()).join('\u001f'))}`
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      out.push({
        id: n === 0 ? base : `${base}#${n}`,
        format: 'official',
        accountId: PAYPAY_ACCOUNT.id,
        raw,
        txNumber: txNumber || undefined,
        occurredAt,
        month: occurredAt.slice(0, 7),
        amount,
        direction,
        kind,
        description,
        payee,
        method: idx.method >= 0 ? (cells[idx.method] ?? '').trim() || undefined : undefined,
      })
    } catch (e) {
      errors.push(`${line}行目: ${(e as Error).message}`)
    }
  })
  return { format: 'official', rows: out, totalRows: body.length, skipped: 0, errors, account: PAYPAY_ACCOUNT }
}

function parseLegacy(rows: string[][]): ParseResult {
  const out: ParsedTx[] = []
  const errors: string[] = []
  const seen = new Map<string, number>()
  let skipped = 0
  rows.forEach((cellsRaw, i) => {
    const line = i + 1
    try {
      if (cellsRaw.length !== 6) throw new Error(`列数が6ではありません（${cellsRaw.length}列）`)
      const cells = cellsRaw.map((c) => c.trim())
      const [title, store, status, date] = cells
      // 公式CSVと同様、処理中の取引は対象外（完了後の行と二重になるため）
      if (status.includes('処理中')) {
        skipped++
        return
      }
      const signed = parseYen(cells[5])
      if (signed == null) throw new Error('金額が空欄です')
      const direction = signed < 0 ? 'out' : 'in'
      const occurredAt = parseLegacyDate(date)
      let kind = classifyLegacy(status, title, direction)
      if (signed === 0) kind = 'unknown'
      const payee = title.replace(/に支払い$/, '').trim()
      const raw: Record<string, string> = {}
      LEGACY_COLUMNS.forEach((col, j) => (raw[col] = cellsRaw[j]))
      // 取引番号がないため、行内容 + ファイル内での出現順で安定IDを作る
      const base = `l:${hash53(cells.join('\u001f'))}`
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      out.push({
        id: `${base}:${n}`,
        format: 'legacy',
        accountId: PAYPAY_ACCOUNT.id,
        raw,
        occurredAt,
        month: occurredAt.slice(0, 7),
        amount: Math.abs(signed),
        direction,
        kind,
        description: status,
        payee,
        store: store || undefined,
      })
    } catch (e) {
      errors.push(`${line}行目: ${(e as Error).message}`)
    }
  })
  return { format: 'legacy', rows: out, totalRows: rows.length, skipped, errors, account: PAYPAY_ACCOUNT }
}
