import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import iconv from 'iconv-lite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SpendlyDB } from '../src/lib/db'
import { importCsv } from '../src/lib/importer'
import { enrich } from '../src/lib/enrich'
import { byAccount, isSpending, monthlyCashflow, sum } from '../src/lib/analytics'
import { parseStatementCsv, UnsupportedCsvError } from '../src/lib/csv'
import { reconcileStatements } from '../src/lib/reconcile'
import { normalizeKanaName, resolveMerchant } from '../src/lib/merchants'

const text = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
/** 銀行・カードの明細は実際と同じ Shift_JIS で取り込む */
const sjis = (name: string) => iconv.encode(text(name), 'Shift_JIS')
const utf8 = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url))

let db: SpendlyDB
let n = 0
beforeEach(async () => {
  db = new SpendlyDB(`accounts-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

async function load() {
  const [txs, ov, ms, rules, cats, st] = await Promise.all([
    db.transactions.toArray(), db.txOverrides.toArray(), db.merchants.toArray(), db.merchantRules.toArray(), db.categories.toArray(),
    db.statements.toArray(),
  ])
  return enrich(txs, ov, ms, rules, new Set(cats.map((c) => c.id)), st)
}

async function importAll() {
  await importCsv(db, utf8('official.csv'), 'paypay.csv')
  await importCsv(db, sjis('bank.csv'), 'OrdinaryDeposit_details.csv')
  await importCsv(db, utf8('aeon-debit.csv'), 'aeon-debit_202609.csv')
  await importCsv(db, sjis('saison.csv'), 'SAISON_2609.csv')
  await importCsv(db, sjis('smbc-202609.csv'), '202609.csv')
  await importCsv(db, sjis('smbc-202610.csv'), '202610.csv')
}

describe('形式の判定と解析', () => {
  it('銀行の普通預金明細', () => {
    const r = parseStatementCsv(text('bank.csv'))
    expect(r.format).toBe('bank')
    expect(r.rows).toHaveLength(11)
    const kinds = Object.fromEntries(r.rows.map((t) => [`${t.occurredAt.slice(0, 10)} ${t.payee} ${t.amount}`, t.kind]))
    expect(kinds['2026-09-30 ＲＳ　ＰＡＹＰＡＹ 10000']).toBe('internal')
    expect(kinds['2026-09-25 振込カ）　サンプルシヨウジ 300000']).toBe('income')
    expect(kinds['2026-09-02 ＳＭＢＣ（ヤチントウ 80000']).toBe('payment')
    expect(kinds['2026-09-01 ＡＴＭシハライ 20000']).toBe('cash')
    expect(r.rows.find((t) => t.payee.includes('サンプルシヨウジ'))?.direction).toBe('in')
  })

  it('イオンデビット: 未確定の利用は取り込まず、取引番号をIDにする', () => {
    const r = parseStatementCsv(text('aeon-debit.csv'))
    expect(r.format).toBe('aeon-debit')
    expect(r.rows).toHaveLength(4)
    expect(r.skipped).toBe(1)
    expect(r.rows[0].id).toBe('d:202609010000001')
    // 半角カナを全角にし、空白埋めを除き、長音を「ー」にする
    expect(r.rows.map((t) => t.payee)).toEqual(['イオン見本店', 'サンプルシヨツプ', 'モバイルイコカ チヤージ', 'PAYPAY チヤージ'])
    // 交通系ICへのチャージは支出、PayPayへのチャージは振替
    expect(r.rows.map((t) => t.kind)).toEqual(['payment', 'payment', 'payment', 'internal'])
  })

  it('セゾンカード: カード名・支払日・請求額を読む', () => {
    const r = parseStatementCsv(text('saison.csv'), 'SAISON_2609.csv')
    expect(r.format).toBe('saison')
    expect(r.account).toMatchObject({ name: 'SAMPLEカード', type: 'credit' })
    expect(r.statements).toEqual([
      { id: `${r.account.id}:2026-09`, accountId: r.account.id, paymentMonth: '2026-09', paymentDate: '2026-09-04', total: 3000 },
    ])
    expect(r.rows.map((t) => [t.occurredAt, t.payee, t.amount])).toEqual([
      ['2026-07-01T00:00', 'J:COM サービス利用料 (7ガツセイキュウ', 1500],
      ['2026-07-06T00:00', '大阪ガス(26/07 0000000000000)', 1500],
    ])
  })

  it('三井住友カード: 氏名・カード番号は保存せず、支払月はファイル名、合計行は請求額', () => {
    const r = parseStatementCsv(text('smbc-202609.csv'), '202609.csv')
    expect(r.format).toBe('smbc-card')
    expect(r.account.name).toBe('三井住友カード（サンプルカード）')
    expect(r.statements?.[0]).toMatchObject({ paymentMonth: '2026-09', total: 12000 })
    expect(r.rows).toHaveLength(3)
    expect(JSON.stringify(r)).not.toContain('見本')
    expect(JSON.stringify(r)).not.toContain('0000-00')
    // 投信積立は投資、分割払いは利用日に総額
    expect(r.rows.map((t) => t.kind)).toEqual(['payment', 'investment', 'payment'])
    expect(r.rows[2]).toMatchObject({ occurredAt: '2026-07-10T00:00', amount: 9000, method: '3回払い' })
  })

  it('支払月が分からないファイル名なら、最後の利用月の翌月とする', () => {
    const r = parseStatementCsv(text('smbc-202609.csv'), 'meisai.csv')
    expect(r.statements?.[0].paymentMonth).toBe('2026-09')
  })

  it('対応していないCSVは拒否する', () => {
    expect(() => parseStatementCsv('a,b,c\n1,2,3')).toThrow(UnsupportedCsvError)
  })
})

describe('取り込み', () => {
  it('Shift_JISの明細を取り込み、再取り込みしても重複しない', async () => {
    await importAll()
    const count = await db.transactions.count()
    // 分割払いは2つの明細に出てくるが1件
    expect((await db.transactions.toArray()).filter((t) => t.amount === 9000)).toHaveLength(1)
    await importAll()
    expect(await db.transactions.count()).toBe(count)
    expect((await db.accounts.toArray()).map((a) => a.type).sort()).toEqual(['bank', 'credit', 'credit', 'debit', 'wallet'])
    expect(await db.statements.count()).toBe(3)
  })
})

describe('二重計上の防止', () => {
  it('内訳の明細がある引落は振替、ない引落は内訳なしの支出として数える', async () => {
    await importAll()
    const txs = await load()
    const bank = (payee: string, amount: number) => txs.find((t) => t.format === 'bank' && t.payee.includes(payee) && t.amount === amount)!
    // PayPayの明細がある月（8〜9月）のチャージは振替、ない月（7月）は支出
    expect(bank('ＰＡＹＰＡＹ', 10000).effectiveKind).toBe('internal')
    expect(bank('ペイペイ', 5000).effectiveKind).toBe('internal')
    expect(bank('ＰＡＹＰＡＹ', 5000)).toMatchObject({ effectiveKind: 'payment', merchant: 'PayPay（チャージ）', link: { target: 'paypay', covered: false } })
    // カードの引落は請求額と一致すれば振替。一致する明細がないもう1枚のセゾンカードは支出
    expect(bank('ミツイスミトモカード', 12000).effectiveKind).toBe('internal')
    expect(bank('セゾン', 3000).effectiveKind).toBe('internal')
    expect(bank('セゾン', 5000)).toMatchObject({ effectiveKind: 'payment', merchant: 'セゾンカード（内訳なし）' })
    // デビットは「ご利用分」の月を取り込んでいれば振替
    expect(bank('デビツト', 1500).effectiveKind).toBe('internal')
    expect(bank('デビツト', 700).effectiveKind).toBe('payment')
    expect(bank('ヤチントウ', 80000)).toMatchObject({ effectiveKind: 'payment', merchant: '家賃', categoryId: 'housing' })

    const spend = txs.filter(isSpending)
    const nonPayPay = (m: string) => sum(spend.filter((t) => t.accountId !== 'paypay' && t.month === m))
    // 9月: 家賃 80,000 + セゾン（内訳なし）5,000 + デビット 1,500+880+3,000 + 三井住友 2,000
    expect(nonPayPay('2026-09')).toBe(92380)
    // 8月: デビット（内訳なし）700 + Amazon 6,000（投信積立は除く）
    expect(nonPayPay('2026-08')).toBe(6700)
    // 7月: PayPayチャージ（内訳なし）5,000 + セゾン 3,000 + 分割払い 9,000
    expect(nonPayPay('2026-07')).toBe(17000)
  })

  it('支払い元別・収支を集計できる', async () => {
    await importAll()
    const txs = await load()
    const sept = txs.filter((t) => isSpending(t) && t.month === '2026-09')
    const rows = byAccount(sept)
    expect(sum(rows)).toBe(sum(sept))
    expect(rows.find((r) => r.key === 'bank')?.amount).toBe(85000)
    const cf = monthlyCashflow(txs, ['2026-09'])[0]
    expect(cf).toMatchObject({ income: 300000, spending: sum(sept), balance: 300000 - sum(sept) })
  })

  it('カードの請求と銀行の引落を照合する', async () => {
    await importAll()
    const st = await db.statements.toArray()
    const rows = reconcileStatements(st, await load())
    const status = Object.fromEntries(rows.map((r) => [r.statement.paymentMonth + ' ' + r.statement.accountId.split(':')[0], r.status]))
    expect(status).toEqual({ '2026-09 saison': 'matched', '2026-09 smbc': 'matched', '2026-10 smbc': 'no-bank' })
  })
})

describe('カード・銀行の店名', () => {
  it.each([
    ['ﾕ-ﾈｸｽﾄｻ-ﾋﾞｽﾘﾖｳﾘﾖｳ   ', 'ユーネクストサービスリヨウリヨウ'],
    ['スマ―トイ―エツクス　ジエイア―ルトウ', 'スマートイーエツクス ジエイアールトウ'],
    ['ETC東日本  (帯広JCT→夕張)', 'ETC東日本 (帯広JCT→夕張)'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeKanaName(raw)).toBe(expected)
  })

  it.each([
    ['ＳＭＢＣ（ヤチントウ', '家賃', 'housing'],
    ['コクミンネンキンホケンリヨウ', '国民年金保険料', 'tax'],
    ['ドコモ　ケイタイ', 'ドコモ', 'telecom'],
    ['大阪ガス(26/07 0000000000000)', '大阪ガス', 'tax'],
    ['J:COM NHK団体一括 (7ガツセイキュウ', 'NHK受信料（J:COM）', 'tax'],
    ['スマートイーエツクス ジエイアールトウ', 'スマートEX', 'transport'],
    ['ラクテンカードサービス', '楽天カード（内訳なし）', 'other'],
  ])('%s → %s', (payee, merchant, category) => {
    expect(resolveMerchant(payee)).toMatchObject({ merchant, builtinCategory: category })
  })
})
