import type { TxKind } from '../types'
import { classifyBank, isBankCsv, parseBankRows } from './parseBank'
import { classifyCard, isSaisonCsv, isSmbcCsv, parseSaisonRows, parseSmbcRows } from './parseCards'
import { classifyDebit, isDebitCsv, parseDebitRows } from './parseDebit'
import {
  UnsupportedCsvError, classifyPayPay, detectPayPayFormat, parsePayPayRows, splitCsv, type ClassifyInput, type ParseResult,
} from './parsePayPay'

export { UnsupportedCsvError, type ParseResult }

export const FORMAT_LABEL: Record<ParseResult['format'], string> = {
  official: 'PayPay（公式形式）',
  legacy: 'PayPay（旧形式）',
  bank: '銀行（普通預金）',
  'aeon-debit': 'イオンデビット',
  saison: 'セゾンカード',
  'smbc-card': '三井住友カード',
}

/** 明細CSVの形式を判定して解析する。fileName はカード明細の支払月の判定に使う */
export function parseStatementCsv(text: string, fileName = ''): ParseResult {
  const rows = splitCsv(text)
  if (rows.length === 0) throw new UnsupportedCsvError('CSVにデータ行がありません。')
  if (isDebitCsv(rows)) return parseDebitRows(rows)
  if (isBankCsv(rows)) return parseBankRows(rows)
  if (isSaisonCsv(rows)) return parseSaisonRows(rows, fileName)
  if (isSmbcCsv(rows)) return parseSmbcRows(rows, fileName)
  if (detectPayPayFormat(rows)) return parsePayPayRows(rows)
  throw new UnsupportedCsvError(
    '対応している明細CSVとして認識できませんでした（PayPay・銀行の普通預金・イオンデビット・セゾンカード・三井住友カード）。',
  )
}

/** 保存済みの取引を現在のルールで再判定する（元データから決定的に求まる） */
export function classifyTx(t: ClassifyInput): TxKind {
  if (t.amount === 0) return 'unknown'
  switch (t.format) {
    case 'bank':
      return classifyBank(t.description, t.direction)
    case 'aeon-debit':
      return classifyDebit(t)
    case 'saison':
    case 'smbc-card':
      return classifyCard(t.payee, t.direction)
    default:
      return classifyPayPay(t)
  }
}
