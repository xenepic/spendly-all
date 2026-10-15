import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SpendlyDB } from '../src/lib/db'
import { importCsv } from '../src/lib/importer'
import { enrich } from '../src/lib/enrich'
import { exportBackup, restoreBackup } from '../src/lib/backup'
import {
  availableMonths, byAmountBand, byCategory, byMerchant, byWeekday, categoryDeltas, isSpending, monthSummary, monthlyTotals, sum,
} from '../src/lib/analytics'

const legacy = readFileSync(new URL('./fixtures/legacy.csv', import.meta.url))
const official = readFileSync(new URL('./fixtures/official.csv', import.meta.url))

let db: SpendlyDB
let n = 0
beforeEach(async () => {
  db = new SpendlyDB(`test-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

async function load() {
  const [txs, ov, ms, rules, cats] = await Promise.all([
    db.transactions.toArray(), db.txOverrides.toArray(), db.merchants.toArray(), db.merchantRules.toArray(), db.categories.toArray(),
  ])
  return enrich(txs, ov, ms, rules, new Set(cats.map((c) => c.id)))
}

describe('取り込み', () => {
  it('初期カテゴリが作られる', async () => {
    expect(await db.categories.count()).toBeGreaterThan(5)
  })

  it('同じCSVを再取り込みしても重複登録されない', async () => {
    const h1 = await importCsv(db, legacy, 'a.csv')
    expect(h1.added).toBe(13)
    expect(h1.duplicates).toBe(0)
    expect(h1.skipped).toBe(1)
    expect(h1.unknown).toBe(1)
    const h2 = await importCsv(db, legacy, 'a.csv')
    expect(h2.added).toBe(0)
    expect(h2.duplicates).toBe(13)
    expect(await db.transactions.count()).toBe(13)
    expect(await db.importHistories.count()).toBe(2)
  })

  it('UTF-16LEで保存されたCSVも同じ取引として扱う', async () => {
    await importCsv(db, legacy, 'utf8.csv')
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(legacy.toString('utf8'), 'utf16le')])
    const h = await importCsv(db, utf16, 'utf16.csv')
    expect(h.encoding).toBe('utf-16le')
    expect(h.added).toBe(0)
  })

  it('期間が重なるCSVは新しい取引のみ追加される（取引番号で判定）', async () => {
    const text = official.toString('utf8').trim().split('\n')
    await importCsv(db, Buffer.from(text.slice(0, 6).join('\n')), 'part1.csv')
    const h = await importCsv(db, Buffer.from([text[0], ...text.slice(3)].join('\n')), 'part2.csv')
    expect(h.added).toBe(4)
    expect(h.duplicates).toBe(3)
    expect(await db.transactions.count()).toBe(9)
  })
})

describe('集計', () => {
  it('チャージ・送金・返金・ポイント・運用・要確認は支出に含めない', async () => {
    await importCsv(db, legacy, 'a.csv')
    const spend = (await load()).filter(isSpending)
    // 9月の支払い: 3978 + 2001 + 988 + 980 + 980
    const sep = monthSummary(spend, '2026-09', new Date(2026, 9, 15))
    expect(sep.total).toBe(3978 + 2001 + 988 + 980 + 980)
    expect(sep.count).toBe(5)
    expect(sep.prevTotal).toBe(138 + 1100)
    expect(sep.diff).toBe(sep.total - sep.prevTotal)
    expect(sep.days).toBe(30)
    expect(sep.dailyAvg).toBeCloseTo(sep.total / 30)
  })

  it('当月は経過日数で1日平均を出す', async () => {
    await importCsv(db, legacy, 'a.csv')
    const spend = (await load()).filter(isSpending)
    const s = monthSummary(spend, '2026-09', new Date(2026, 8, 20))
    expect(s.partial).toBe(true)
    expect(s.days).toBe(20)
  })

  it('カテゴリ・店舗・曜日・金額帯・月別の合計が総支出と一致する', async () => {
    await importCsv(db, legacy, 'a.csv')
    await importCsv(db, official, 'b.csv')
    const spend = (await load()).filter(isSpending)
    const total = sum(spend)
    expect(sum(byCategory(spend))).toBe(total)
    expect(sum(byMerchant(spend))).toBe(total)
    expect(sum(byWeekday(spend))).toBe(total)
    expect(sum(byAmountBand(spend))).toBe(total)
    expect(sum(monthlyTotals(spend, availableMonths(await load())))).toBe(total)
    expect(byCategory(spend).reduce((a, r) => a + r.share, 0)).toBeCloseTo(1)
    for (const m of availableMonths(await load())) {
      const d = categoryDeltas(spend, m)
      expect(d.reduce((a, r) => a + r.diff, 0)).toBe(monthSummary(spend, m).diff)
    }
  })

  it('店舗名の表記揺れが統合される', async () => {
    await importCsv(db, legacy, 'a.csv')
    await importCsv(db, official, 'b.csv')
    const spend = (await load()).filter(isSpending)
    const seven = byMerchant(spend).find((m) => m.key === 'セブンイレブン')
    expect(seven).toMatchObject({ count: 3, amount: 2001 + 138 + 1280, categoryId: 'convenience' })
  })

  it('空データでも集計できる', async () => {
    const all = await load()
    expect(availableMonths(all)).toEqual([])
    const s = monthSummary([], '2026-09')
    expect(s).toMatchObject({ total: 0, count: 0, rate: null, perTxAvg: 0 })
    expect(byCategory([])).toEqual([])
    expect(byAmountBand([]).every((b) => b.count === 0 && b.share === 0)).toBe(true)
  })
})

describe('手動分類', () => {
  it('店舗カテゴリの手動設定と取引単位の上書きが反映され、元データは変わらない', async () => {
    await importCsv(db, legacy, 'a.csv')
    const before = await db.transactions.toArray()
    await db.merchants.put({ name: 'セブンイレブン', categoryId: 'other', manual: true })
    let all = await load()
    expect(all.filter((t) => t.merchant === 'セブンイレブン').every((t) => t.categoryId === 'other')).toBe(true)

    const target = all.find((t) => t.merchant === 'セブンイレブン')!
    await db.txOverrides.put({ txId: target.id, categoryId: 'dining' })
    all = await load()
    expect(all.find((t) => t.id === target.id)).toMatchObject({ categoryId: 'dining', categoryOverridden: true })

    const unknown = all.find((t) => t.kind === 'unknown')!
    await db.txOverrides.put({ txId: unknown.id, kind: 'charge' })
    all = await load()
    expect(all.find((t) => t.id === unknown.id)?.effectiveKind).toBe('charge')

    expect(await db.transactions.toArray()).toEqual(before)
  })

  it('店舗統合ルールで別名を1店舗にまとめる', async () => {
    await importCsv(db, legacy, 'a.csv')
    await db.merchantRules.add({ id: 'r', pattern: '新鮮激安市場', match: 'contains', merchant: '近所のスーパー', createdAt: '' })
    const spend = (await load()).filter(isSpending)
    expect(byMerchant(spend).map((m) => m.key)).toContain('近所のスーパー')
  })

  it('削除されたカテゴリを参照する分類は未分類に戻る', async () => {
    await importCsv(db, legacy, 'a.csv')
    await db.categories.add({ id: 'tmp', name: '一時', color: '#000', order: 50 })
    await db.merchants.put({ name: 'セブンイレブン', categoryId: 'tmp', manual: true })
    await db.categories.delete('tmp')
    const all = await load()
    expect(all.find((t) => t.merchant === 'セブンイレブン')?.categoryId).toBe('uncategorized')
  })
})

describe('バックアップ', () => {
  it('JSONで書き出して復元できる', async () => {
    await importCsv(db, legacy, 'a.csv')
    await db.merchants.put({ name: 'セブンイレブン', categoryId: 'other', manual: true })
    const backup = JSON.parse(JSON.stringify(await exportBackup(db)))
    const other = new SpendlyDB(`restore-${n++}`)
    await restoreBackup(other, backup)
    expect(await other.transactions.toArray()).toEqual(await db.transactions.toArray())
    expect(await other.merchants.get('セブンイレブン')).toMatchObject({ categoryId: 'other' })
    await other.delete()
  })
  it('PayPay版（Spendly）のバックアップをPayPayの取引として復元できる', async () => {
    await importCsv(db, legacy, 'a.csv')
    const b = JSON.parse(JSON.stringify(await exportBackup(db)))
    // PayPay版の形式: app が spendly、accounts・statements がなく、取引に accountId がない
    const paypay = {
      ...b,
      app: 'spendly',
      tables: {
        ...b.tables,
        transactions: b.tables.transactions.map(({ accountId: _, ...t }: { accountId: string }) => t),
        categories: b.tables.categories.filter((c: { id: string }) => c.id !== 'housing' && c.id !== 'telecom'),
        accounts: undefined,
        statements: undefined,
      },
    }
    const other = new SpendlyDB(`restore-${n++}`)
    await restoreBackup(other, paypay)
    const txs = await other.transactions.toArray()
    expect(txs).toHaveLength(13)
    expect(txs.every((t) => t.accountId === 'paypay')).toBe(true)
    expect(await other.accounts.toArray()).toEqual([{ id: 'paypay', name: 'PayPay', type: 'wallet' }])
    expect(await other.categories.get('housing')).toBeDefined()
    await other.delete()
  })

  it('不正なファイルは拒否し、既存データを変更しない', async () => {
    await importCsv(db, legacy, 'a.csv')
    await expect(restoreBackup(db, { app: 'other' })).rejects.toThrow()
    expect(await db.transactions.count()).toBe(13)
  })
})

describe('既存データへの反映', () => {
  it('保存済みの種別が古くても、表示時に現在のルールで再判定する', async () => {
    await importCsv(db, official, 'b.csv')
    const t = (await db.transactions.toArray())[0]
    await db.transactions.put({ ...t, id: 'old', kind: 'unknown', description: '請求書払い', payee: '京都市' })
    const e = (await load()).find((x) => x.id === 'old')!
    expect(e.autoKind).toBe('payment')
    expect(isSpending(e)).toBe(true)
  })

  it('税金・請求書払いは支出に含め、税金・公共料金カテゴリに分類する', async () => {
    await importCsv(db, official, 'b.csv')
    const t = (await db.transactions.toArray())[0]
    await db.transactions.bulkPut([
      { ...t, id: 'tax1', description: '支払い', payee: '国税（消費税及地方消費税）' },
      { ...t, id: 'tax2', description: '請求書払い', payee: '京都市' },
      { ...t, id: 'tax3', description: '請求書払い', payee: '日本年金機構(国民年金保険料)' },
    ])
    await db.txOverrides.put({ txId: 'tax3', kind: 'bill' as never })
    const all = await load()
    for (const id of ['tax1', 'tax2', 'tax3']) {
      const e = all.find((x) => x.id === id)!
      expect(isSpending(e)).toBe(true)
      expect(e.categoryId).toBe('tax')
    }
  })
})

describe('設定のリセット', () => {
  it('分類設定のみ初期化し、取引データと履歴は残す', async () => {
    const { resetClassification } = await import('../src/lib/backup')
    const { DEFAULT_CATEGORIES } = await import('../src/lib/categories')
    await importCsv(db, legacy, 'a.csv')
    const tx = (await db.transactions.toArray())[0]
    await db.merchants.put({ name: 'セブンイレブン', categoryId: 'other', manual: true })
    await db.txOverrides.put({ txId: tx.id, categoryId: 'dining' })
    await db.merchantRules.add({ id: 'r', pattern: 'x', match: 'contains', merchant: 'y', createdAt: '' })
    await db.categories.update('supermarket', { name: '食料品' })
    // 上の update で名前を変えたので、リセット後に初期名へ戻ることを確認する
    await db.categories.add({ id: 'custom', name: '独自', color: '#000', order: 50 })

    await resetClassification(db, DEFAULT_CATEGORIES)

    expect(await db.transactions.count()).toBe(13)
    expect(await db.importHistories.count()).toBe(1)
    expect(await db.txOverrides.count()).toBe(0)
    expect(await db.merchantRules.count()).toBe(0)
    expect((await db.merchants.toArray()).some((m) => m.manual)).toBe(false)
    expect((await db.categories.get('supermarket'))?.name).toBe('スーパー・食品')
    expect(await db.categories.get('custom')).toBeUndefined()
    const all = await load()
    expect(all.filter((t) => t.merchant === 'セブンイレブン').every((t) => t.categoryId === 'convenience')).toBe(true)
  })
})

describe('カテゴリのルールと一括設定', () => {
  it('キーワードのカテゴリルールは組み込みルールより優先、店舗の手動設定よりは劣後', async () => {
    await importCsv(db, legacy, 'a.csv')
    const now = new Date().toISOString()
    // セブンイレブン（組み込み: コンビニ）をルールで「その他」に
    await db.merchantRules.add({ id: 'r1', pattern: 'セブン', match: 'contains', categoryId: 'other', createdAt: now })
    let all = await load()
    expect(all.filter((t) => t.merchant === 'セブンイレブン').every((t) => t.categoryId === 'other')).toBe(true)
    // 店舗名は変わらない
    expect(all.some((t) => t.merchant === 'セブンイレブン')).toBe(true)
    await db.merchants.put({ name: 'セブンイレブン', categoryId: 'dining', manual: true })
    all = await load()
    expect(all.filter((t) => t.merchant === 'セブンイレブン').every((t) => t.categoryId === 'dining')).toBe(true)
  })

  it('統合後の店舗名に対してもカテゴリルールが適用される', async () => {
    await importCsv(db, legacy, 'a.csv')
    const now = new Date().toISOString()
    await db.merchantRules.bulkAdd([
      { id: 'n', pattern: '新鮮激安市場', match: 'contains', merchant: '近所の店', createdAt: now },
      { id: 'c', pattern: '近所の店', match: 'exact', categoryId: 'daily', createdAt: now },
    ])
    const t = (await load()).find((x) => x.payee === '新鮮激安市場！')!
    expect(t).toMatchObject({ merchant: '近所の店', categoryId: 'daily' })
  })

  it('複数店舗を一括設定し、元に戻せる', async () => {
    const { setMerchantsCategory, restoreMerchants } = await import('../src/lib/classify')
    await importCsv(db, legacy, 'a.csv')
    await db.merchants.put({ name: 'マツモトキヨシ', categoryId: 'other', manual: true })
    const before = await db.merchants.toArray()
    const snap = await setMerchantsCategory(db, ['セブンイレブン', 'マツモトキヨシ', '存在しない店'], 'hobby')
    let all = await load()
    expect(all.filter((t) => ['セブンイレブン', 'マツモトキヨシ'].includes(t.merchant)).every((t) => t.categoryId === 'hobby')).toBe(true)
    await restoreMerchants(db, snap)
    expect(await db.merchants.toArray()).toEqual(before)

    await setMerchantsCategory(db, ['マツモトキヨシ'], null)
    all = await load()
    expect(all.find((t) => t.merchant === 'マツモトキヨシ')?.categoryId).toBe('drugstore')
  })

  it('カテゴリを削除すると、そのカテゴリのルールも外れる', async () => {
    const { deleteCategory } = await import('../src/lib/classify')
    await db.categories.add({ id: 'x', name: '独自', color: '#000', order: 50 })
    await db.merchantRules.bulkAdd([
      { id: 'a', pattern: 'A', match: 'contains', categoryId: 'x', createdAt: '' },
      { id: 'b', pattern: 'B', match: 'contains', categoryId: 'x', merchant: 'Bの店', createdAt: '' },
    ])
    await deleteCategory(db, 'x')
    expect(await db.merchantRules.get('a')).toBeUndefined()
    expect(await db.merchantRules.get('b')).toEqual({ id: 'b', pattern: 'B', match: 'contains', merchant: 'Bの店', createdAt: '' })
  })
})
