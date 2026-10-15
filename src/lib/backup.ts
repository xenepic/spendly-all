import { PAYPAY_ACCOUNT } from './accounts'
import { DEFAULT_CATEGORIES } from './categories'
import type { SpendlyDB } from './db'

export const BACKUP_APP = 'spendly-all'
/** PayPay版（Spendly）のバックアップも読み込める（取引はPayPayの取引として取り込む） */
const PAYPAY_APP = 'spendly'
export const BACKUP_VERSION = 1

const TABLES = [
  'transactions', 'merchants', 'categories', 'merchantRules', 'txOverrides', 'importHistories', 'accounts', 'statements',
] as const
/** PayPay版のバックアップにはないテーブル */
const NEW_TABLES: TableName[] = ['accounts', 'statements']
type TableName = (typeof TABLES)[number]

export interface Backup {
  app: typeof BACKUP_APP | typeof PAYPAY_APP
  version: number
  exportedAt: string
  tables: Record<TableName, unknown[]>
}

export async function exportBackup(db: SpendlyDB): Promise<Backup> {
  const tables = {} as Backup['tables']
  await db.transaction('r', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) tables[t] = await db.table(t).toArray()
  })
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), tables }
}

export function validateBackup(data: unknown): Backup {
  const b = data as Partial<Backup>
  if (!b || (b.app !== BACKUP_APP && b.app !== PAYPAY_APP) || typeof b.version !== 'number' || typeof b.tables !== 'object' || !b.tables) {
    throw new Error('Spendlyのバックアップファイルではありません。')
  }
  if (b.version > BACKUP_VERSION) throw new Error('このバージョンでは読み込めない新しい形式のバックアップです。')
  for (const t of TABLES) {
    if (b.app === PAYPAY_APP && NEW_TABLES.includes(t)) continue
    if (!Array.isArray(b.tables[t])) throw new Error(`バックアップに ${t} がありません。`)
  }
  for (const tx of b.tables.transactions as Record<string, unknown>[]) {
    if (typeof tx.id !== 'string' || !Number.isInteger(tx.amount) || typeof tx.occurredAt !== 'string') {
      throw new Error('取引データの形式が正しくありません。')
    }
  }
  return b.app === PAYPAY_APP ? fromPayPayBackup(b as Backup) : (b as Backup)
}

/** PayPay版のバックアップを、PayPayの口座の取引として読み替える */
function fromPayPayBackup(b: Backup): Backup {
  const transactions = (b.tables.transactions as Record<string, unknown>[]).map((t) => ({ accountId: PAYPAY_ACCOUNT.id, ...t }))
  const histories = (b.tables.importHistories as Record<string, unknown>[]).map((h) => ({ accountId: PAYPAY_ACCOUNT.id, ...h }))
  // PayPay版にない初期カテゴリ（住居・通信など）を補う
  const categories = b.tables.categories as { id: string }[]
  const ids = new Set(categories.map((c) => c.id))
  return {
    ...b,
    app: BACKUP_APP,
    tables: {
      ...b.tables,
      transactions,
      importHistories: histories,
      categories: [...categories, ...DEFAULT_CATEGORIES.filter((c) => !ids.has(c.id))],
      accounts: transactions.length ? [PAYPAY_ACCOUNT] : [],
      statements: [],
    },
  }
}

/** 現在のデータをすべて置き換えて復元する */
export async function restoreBackup(db: SpendlyDB, data: unknown): Promise<void> {
  const b = validateBackup(data)
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear()
      await db.table(t).bulkAdd(b.tables[t])
    }
  })
}

/** 取引・分類・履歴をすべて削除し、カテゴリを初期状態に戻す */
export async function clearAll(db: SpendlyDB, defaults: unknown[]): Promise<void> {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) await db.table(t).clear()
    await db.table('categories').bulkAdd(defaults)
  })
}

/**
 * 分類設定（店舗カテゴリの手動設定・取引ごとの変更・統合ルール・カテゴリ）を初期状態に戻す。
 * 取引データと取り込み履歴は残す。
 */
export async function resetClassification(db: SpendlyDB, defaults: unknown[]): Promise<void> {
  const tables = ['merchants', 'categories', 'merchantRules', 'txOverrides'] as const
  await db.transaction('rw', tables.map((t) => db.table(t)), async () => {
    for (const t of tables) await db.table(t).clear()
    await db.table('categories').bulkAdd(defaults)
  })
}
