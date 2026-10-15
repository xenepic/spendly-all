import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../lib/db'
import { enrich } from '../lib/enrich'
import { sortAccounts } from '../lib/accounts'
import type { Account, Category, EnrichedTx, ImportHistory, Merchant, MerchantRule, Statement, TxOverride } from '../lib/types'

export interface SpendlyData {
  loading: boolean
  txs: EnrichedTx[]
  categories: Category[]
  catMap: Map<string, Category>
  merchants: Merchant[]
  rules: MerchantRule[]
  overrides: TxOverride[]
  histories: ImportHistory[]
  accounts: Account[]
  accountMap: Map<string, Account>
  statements: Statement[]
}

/** IndexedDB の内容を購読し、分類情報を付加した取引を返す */
export function useSpendlyData(): SpendlyData {
  const raw = useLiveQuery(async () => {
    const [txs, categories, merchants, rules, overrides, histories, accounts, statements] = await Promise.all([
      db.transactions.toArray(),
      db.categories.orderBy('order').toArray(),
      db.merchants.toArray(),
      db.merchantRules.toArray(),
      db.txOverrides.toArray(),
      db.importHistories.orderBy('importedAt').reverse().toArray(),
      db.accounts.toArray(),
      db.statements.orderBy('paymentMonth').reverse().toArray(),
    ])
    return { txs, categories, merchants, rules, overrides, histories, accounts, statements }
  })

  return useMemo(() => {
    if (!raw) {
      return {
        loading: true, txs: [], categories: [], catMap: new Map(), merchants: [], rules: [], overrides: [], histories: [],
        accounts: [], accountMap: new Map(), statements: [],
      }
    }
    const catMap = new Map(raw.categories.map((c) => [c.id, c]))
    const txs = enrich(raw.txs, raw.overrides, raw.merchants, raw.rules, new Set(catMap.keys()), raw.statements)
    txs.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))
    const accounts = sortAccounts(raw.accounts)
    return { loading: false, ...raw, txs, catMap, accounts, accountMap: new Map(accounts.map((a) => [a.id, a])) }
  }, [raw])
}
