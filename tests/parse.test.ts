import { readFileSync } from 'node:fs'
import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import { decodeCsv } from '../src/lib/encoding'
import { parsePayPayCsv, parseYen, UnsupportedCsvError } from '../src/lib/csv/parsePayPay'
import { resolveMerchant } from '../src/lib/merchants'

const legacyText = readFileSync(new URL('./fixtures/legacy.csv', import.meta.url), 'utf8')
const officialText = readFileSync(new URL('./fixtures/official.csv', import.meta.url), 'utf8')

describe('decodeCsv', () => {
  it('UTF-16LE（BOMあり）を判定する', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(legacyText, 'utf16le')])
    const d = decodeCsv(buf)
    expect(d.encoding).toBe('utf-16le')
    expect(d.text).toBe(legacyText)
  })
  it('UTF-8 BOMを除去する', () => {
    const d = decodeCsv(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(officialText)]))
    expect(d.encoding).toBe('utf-8')
    expect(d.text.startsWith('取引日')).toBe(true)
  })
  it('Shift_JISを判定する', () => {
    const d = decodeCsv(iconv.encode(officialText, 'Shift_JIS'))
    expect(d.encoding).toBe('shift_jis')
    expect(d.text).toContain('セブン-イレブン')
  })
  it('BOMなしUTF-16LEを判定する', () => {
    expect(decodeCsv(Buffer.from(legacyText, 'utf16le')).encoding).toBe('utf-16le')
  })
})

describe('parseYen', () => {
  it('カンマ・全角・記号に対応する', () => {
    expect(parseYen('1,000')).toBe(1000)
    expect(parseYen('１，２３４')).toBe(1234)
    expect(parseYen('-3978')).toBe(-3978)
    expect(parseYen('-')).toBeNull()
    expect(parseYen('')).toBeNull()
    expect(() => parseYen('12.5')).toThrow()
  })
})

describe('旧形式（ヘッダーなし6列）', () => {
  const r = parsePayPayCsv(legacyText)
  it('形式を判定し、処理中の行を除外する', () => {
    expect(r.format).toBe('legacy')
    expect(r.totalRows).toBe(14)
    expect(r.skipped).toBe(1)
    expect(r.rows).toHaveLength(13)
    expect(r.errors).toEqual([])
  })
  it('種別を判定する', () => {
    const kinds = r.rows.map((t) => [t.payee, t.kind])
    expect(kinds).toContainEqual(['新鮮激安市場！', 'payment'])
    expect(kinds).toContainEqual(['イオン銀行からチャージ', 'charge'])
    expect(kinds).toContainEqual(['テストさんに送金（譲渡）', 'transfer_out'])
    expect(kinds).toContainEqual(['テストさんから受け取り', 'transfer_in'])
    expect(kinds).toContainEqual(['PayPayポイント運用', 'investment'])
    expect(kinds).toContainEqual(['PayPayポイント付与', 'point'])
  })
  it('タイトルとステータスが矛盾する行は要確認にする', () => {
    const odd = r.rows.find((t) => t.description === 'チャージ完了' && t.direction === 'out')
    expect(odd?.kind).toBe('unknown')
  })
  it('金額は正の整数、日時はローカル時刻', () => {
    const t = r.rows[0]
    expect(t.amount).toBe(3978)
    expect(t.direction).toBe('out')
    expect(t.occurredAt).toBe('2026-09-29T11:55')
    expect(t.month).toBe('2026-09')
    expect(t.store).toBe('新鮮激安市場!四条店')
  })
  it('同一内容の行は出現順で別IDになり、再解析しても同じIDになる', () => {
    const ten = r.rows.filter((t) => t.payee === '天下一品' && t.kind === 'payment')
    expect(ten).toHaveLength(2)
    expect(ten[0].id).not.toBe(ten[1].id)
    expect(parsePayPayCsv(legacyText).rows.map((t) => t.id)).toEqual(r.rows.map((t) => t.id))
  })
  it('元の行を保持する', () => {
    expect(r.rows[0].raw['タイトル']).toBe('新鮮激安市場！に支払い')
    expect(r.rows[0].raw['金額']).toBe('-3978')
  })
})

describe('公式形式（ヘッダーあり13列）', () => {
  const r = parsePayPayCsv(officialText)
  it('列名から解析する', () => {
    expect(r.format).toBe('official')
    expect(r.rows).toHaveLength(9)
    expect(r.errors).toEqual([])
    const t = r.rows[0]
    expect(t).toMatchObject({ amount: 1280, direction: 'out', kind: 'payment', txNumber: '100000000000001', method: 'PayPay残高' })
    expect(t.occurredAt).toBe('2026-09-30T12:05')
  })
  it('種別を判定する', () => {
    expect(r.rows.map((t) => t.kind)).toEqual([
      'payment', 'point', 'charge', 'payment', 'refund', 'transfer_out', 'payment', 'unknown', 'payment',
    ])
  })
  it('同じ取引番号でも取引内容が異なれば別取引', () => {
    const ids = r.rows.filter((t) => t.txNumber === '100000000000003').map((t) => t.id)
    expect(new Set(ids).size).toBe(2)
  })
  it('列の順序が変わっても解析できる', () => {
    const lines = officialText.trim().split('\n').map((l) => l.match(/("[^"]*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '')))
    const reordered = lines.map((c) => [c[12], ...c.slice(0, 12)].join(',')).join('\n')
    expect(parsePayPayCsv(reordered).rows.map((t) => t.amount)).toEqual(r.rows.map((t) => t.amount))
  })
  it('必須列がなければエラー', () => {
    expect(() => parsePayPayCsv('取引日,取引内容\n2026/01/01 00:00,支払い')).toThrow(UnsupportedCsvError)
  })
  it('不正な行はエラーとして報告し、他の行は取り込む', () => {
    const bad = officialText.replace('2026/09/15 08:10', 'not-a-date')
    const p = parsePayPayCsv(bad)
    expect(p.rows).toHaveLength(8)
    expect(p.errors[0]).toMatch(/^8行目/)
  })
})

it('PayPay以外のCSVは拒否する', () => {
  expect(() => parsePayPayCsv('a,b,c\n1,2,3')).toThrow(UnsupportedCsvError)
})

describe('店舗名の正規化', () => {
  it.each([
    ['セブン-イレブン 京都駅前店', 'セブンイレブン', 'convenience'],
    ['ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ', 'セブンイレブン', 'convenience'],
    ['7-Eleven', 'セブンイレブン', 'convenience'],
    ['イオン 桂川店', 'イオン', 'supermarket'],
    ['イオンスタイル京都桂川', 'イオン', 'supermarket'],
    ['スギ薬局 四条店', 'スギ薬局', 'drugstore'],
    ['ジェイアール西日本伊勢丹', 'ジェイアール西日本伊勢丹', 'shopping'],
    ['ＤＬｓｉｔｅ', 'DLsite', 'hobby'],
  ])('%s → %s / %s', (payee, merchant, category) => {
    const r = resolveMerchant(payee)
    expect(r.merchant).toBe(merchant)
    expect(r.builtinCategory).toBe(category)
  })
  it('未知の店舗は名前を保ち、カテゴリを推定しない', () => {
    expect(resolveMerchant('謎の店')).toEqual({ merchant: '謎の店' })
  })
  it('ユーザールールが組み込みルールより優先される', () => {
    const r = resolveMerchant('ローソンストア100 五条', [
      { id: '1', pattern: 'ローソンストア100', match: 'contains', merchant: 'ローソンストア100', createdAt: '' },
    ])
    expect(r.merchant).toBe('ローソンストア100')
  })
})

describe('公式CSVの実際の取引内容', () => {
  const header = '取引日,出金金額（円）,入金金額（円）,海外出金金額,通貨,変換レート（円）,利用国,取引内容,取引先,取引方法,支払い区分,利用者,取引番号'
  const row = (desc: string, payee: string, out: string, inn: string, no: string) =>
    `2026/10/14 18:25:44,${out},${inn},-,-,-,-,${desc},${payee},PayPay残高,-,-,${no}`
  const r = parsePayPayCsv(
    [
      header,
      row('請求書払い', '京都市', '"12,470"', '-', '1'),
      row('支払い', '国税（消費税及地方消費税）', '"152,600"', '-', '2'),
      row('支払い', '日本年金機構(国民年金保険料)', '"17,510"', '-', '3'),
      row('送った金額', 'テスト', '"3,000"', '-', '4'),
      row('受け取った金額', 'テスト', '-', '"4,000"', '5'),
      row('投資', 'PayPayポイント運用', '42', '-', '6'),
      row('期間限定ポイントの期限切れ', '-', '360', '-', '7'),
      row('ポイント、残高の獲得', 'ローソン', '-', '3', '8'),
      row('支払い', 'ローソン - 西京極佃田', '300', '-', '8'),
    ].join('\n'),
  )
  it('種別を判定する（秒付きの日時にも対応）', () => {
    expect(r.errors).toEqual([])
    expect(r.rows.map((t) => t.kind)).toEqual([
      'payment', 'payment', 'payment', 'transfer_out', 'transfer_in', 'investment', 'point', 'point', 'payment',
    ])
  })
  it('支払いとポイント獲得が同じ取引番号でも別取引', () => {
    expect(new Set(r.rows.filter((t) => t.txNumber === '8').map((t) => t.id)).size).toBe(2)
  })
})

describe('公式CSVの「ブランド - 店舗」形式', () => {
  it.each([
    ['万代 - 万代五条西小路店', '万代', 'supermarket'],
    ['万代 - 万代吉祥院店', '万代', 'supermarket'],
    ['鳥貴族 - 鳥貴族　深草店', '鳥貴族', 'dining'],
    ['ローソン - ＨＢ　阪急梅田３階東', 'ローソン', 'convenience'],
    ['京都ポルタ（地下街） - 一風堂', '一風堂', 'dining'],
    ['関西国際空港 - KATE リムジンバス チケットカウンター', 'KATE リムジンバス チケットカウンター', 'transport'],
    ['JR-PLUS - Ｋｉｏｓｋ品川幹線南改札内', 'Kiosk品川幹線南改札内', 'convenience'],
    ['ZUND - ラー麺ずんどう屋　四条烏丸店', 'ZUND', 'dining'],
    ['大起水産回転寿司　京都伏見店 - 大起水産回転寿司　京都伏見店', '大起水産回転寿司 京都伏見店', 'dining'],
    ['お酒の美術館阪急西院駅前店 - お酒の美術館阪急西院駅前店', 'お酒の美術館', 'dining'],
    ['JRA 即PAT', 'JRA 即PAT', 'hobby'],
    ['A－プライス - A－プライス　西京極店', 'A-プライス', 'supermarket'],
    ['キャンドゥ　イオンモール京都五条 - キャンドゥ　イオンモール京都五条', 'キャンドゥ イオンモール京都五条', 'daily'],
  ])('%s → %s / %s', (payee, merchant, category) => {
    expect(resolveMerchant(payee)).toEqual({ merchant, builtinCategory: category })
  })
})
