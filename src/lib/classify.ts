import { UNCATEGORIZED } from './categories'
import type { SpendlyDB } from './db'
import type { Merchant } from './types'

/** 一括変更前の店舗設定（元に戻す用）。undefined は設定がなかったことを表す */
export type MerchantSnapshot = { name: string; before: Merchant | undefined }[]

/**
 * 複数店舗のカテゴリをまとめて設定する。categoryId が null なら自動判定に戻す。
 * 変更前の状態を返すので restoreMerchants で元に戻せる。
 */
export async function setMerchantsCategory(db: SpendlyDB, names: string[], categoryId: string | null): Promise<MerchantSnapshot> {
  return db.transaction('rw', db.merchants, async () => {
    const before = await db.merchants.bulkGet(names)
    const snapshot = names.map((name, i) => ({ name, before: before[i] }))
    if (categoryId == null) {
      await db.merchants.bulkPut(
        snapshot.map(({ name, before }) => ({ name, categoryId: before?.categoryId ?? UNCATEGORIZED, manual: false })),
      )
    } else {
      await db.merchants.bulkPut(names.map((name) => ({ name, categoryId, manual: true })))
    }
    return snapshot
  })
}

export async function restoreMerchants(db: SpendlyDB, snapshot: MerchantSnapshot): Promise<void> {
  await db.transaction('rw', db.merchants, async () => {
    await db.merchants.bulkDelete(snapshot.filter((s) => !s.before).map((s) => s.name))
    await db.merchants.bulkPut(snapshot.flatMap((s) => (s.before ? [s.before] : [])))
  })
}

/** カテゴリを削除し、参照している店舗設定・取引ごとの変更・カテゴリルールを自動判定に戻す */
export async function deleteCategory(db: SpendlyDB, id: string): Promise<void> {
  await db.transaction('rw', [db.categories, db.merchants, db.txOverrides, db.merchantRules], async () => {
    await db.categories.delete(id)
    await db.merchants.where('categoryId').equals(id).modify({ manual: false, categoryId: UNCATEGORIZED })
    await db.txOverrides.filter((o) => o.categoryId === id).modify((o) => void delete o.categoryId)
    const rules = await db.merchantRules.filter((r) => r.categoryId === id).toArray()
    await db.merchantRules.bulkDelete(rules.filter((r) => !r.merchant).map((r) => r.id))
    await db.merchantRules.bulkPut(rules.filter((r) => r.merchant).map(({ categoryId: _, ...r }) => r))
  })
}
