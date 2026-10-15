import Dexie, { type EntityTable } from 'dexie'
import { DEFAULT_CATEGORIES } from './categories'
import type { Account, Category, ImportHistory, Merchant, MerchantRule, Statement, Transaction, TxOverride } from './types'

export class SpendlyDB extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>
  merchants!: EntityTable<Merchant, 'name'>
  categories!: EntityTable<Category, 'id'>
  merchantRules!: EntityTable<MerchantRule, 'id'>
  txOverrides!: EntityTable<TxOverride, 'txId'>
  importHistories!: EntityTable<ImportHistory, 'id'>
  accounts!: EntityTable<Account, 'id'>
  statements!: EntityTable<Statement, 'id'>

  // PayPay版（Spendly）と同じオリジンで動かしてもデータが混ざらないよう、DB名を分けている
  constructor(name = 'spendly-all') {
    super(name)
    this.version(1).stores({
      transactions: 'id, importId, accountId, month, occurredAt, kind, payee',
      merchants: 'name, categoryId',
      categories: 'id, order',
      merchantRules: 'id, merchant',
      txOverrides: 'txId',
      importHistories: 'id, importedAt',
      accounts: 'id',
      statements: 'id, accountId, paymentMonth',
    })
    this.on('populate', (tx) => {
      tx.table('categories').bulkAdd(DEFAULT_CATEGORIES)
    })
  }
}

export const db = new SpendlyDB()

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
