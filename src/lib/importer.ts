import { decodeCsv } from './encoding'
import { parseStatementCsv } from './csv'
import { UNCATEGORIZED } from './categories'
import { resolveMerchant } from './merchants'
import { newId, type SpendlyDB } from './db'
import type { ImportHistory, Merchant, Statement, Transaction } from './types'

/** 明細CSVファイルの内容を解析し、重複を除いてIndexedDBへ保存する */
export async function importCsv(db: SpendlyDB, bytes: ArrayBuffer | Uint8Array, fileName: string): Promise<ImportHistory> {
  const { text, encoding } = decodeCsv(bytes)
  const parsed = parseStatementCsv(text, fileName)
  const importId = newId()

  const ids = parsed.rows.map((r) => r.id)
  const statements: Statement[] = (parsed.statements ?? []).map((s) => ({ ...s, fileName }))
  return db.transaction('rw', [db.transactions, db.importHistories, db.merchants, db.merchantRules, db.accounts, db.statements], async () => {
    const existing = await db.transactions.bulkGet(ids)
    const fresh: Transaction[] = parsed.rows
      .filter((_, i) => existing[i] == null)
      .map((r) => ({ ...r, importId }))

    // 新しく現れた店舗を登録（カテゴリは組み込みルールで初期設定）
    const rules = await db.merchantRules.toArray()
    const newMerchants = new Map<string, Merchant>()
    for (const t of fresh) {
      // 振替（銀行の引落）も内訳がない期間は支出になるため、店舗として登録しておく
      if (t.kind !== 'payment' && t.kind !== 'unknown' && t.kind !== 'internal') continue
      const r = resolveMerchant(t.payee, rules)
      if (!newMerchants.has(r.merchant)) {
        newMerchants.set(r.merchant, { name: r.merchant, categoryId: r.ruleCategory ?? r.builtinCategory ?? UNCATEGORIZED, manual: false })
      }
    }
    const known = await db.merchants.bulkGet([...newMerchants.keys()])
    const merchantsToAdd = [...newMerchants.values()].filter((_, i) => known[i] == null)

    const months = parsed.rows.map((r) => r.occurredAt).sort()
    const history: ImportHistory = {
      id: importId,
      fileName,
      importedAt: new Date().toISOString(),
      format: parsed.format,
      accountId: parsed.account.id,
      encoding,
      totalRows: parsed.totalRows,
      added: fresh.length,
      duplicates: parsed.rows.length - fresh.length,
      skipped: parsed.skipped,
      unknown: fresh.filter((t) => t.kind === 'unknown').length,
      errors: parsed.errors,
      periodFrom: months[0],
      periodTo: months[months.length - 1],
    }
    await db.transactions.bulkAdd(fresh)
    await db.merchants.bulkAdd(merchantsToAdd)
    await db.importHistories.add(history)
    // 口座名は明細の記載で更新する。請求は同じ支払月なら新しい明細で置き換える
    await db.accounts.put(parsed.account)
    await db.statements.bulkPut(statements)
    return history
  })
}
