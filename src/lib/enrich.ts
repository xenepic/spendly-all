import { UNCATEGORIZED } from './categories'
import { builtinCategoryOf, resolveMerchant } from './merchants'
import { classifyTx } from './csv'
import { buildCoverage, isCovered, linkTargetOf } from './accounts'
import type { EnrichedTx, Merchant, MerchantRule, Statement, Transaction, TxLink, TxOverride } from './types'

/**
 * 元の取引に分類情報（正規化店舗名・カテゴリ・手動上書き）を付加する。
 * 元データは変更せず、ルールや分類を変えるたびにここから再計算する。
 * カテゴリの優先順位: 取引単位の手動変更 > 店舗の手動設定 > ユーザーのカテゴリルール > 組み込みルール > 店舗の初期値 > 未分類
 *
 * 銀行の引落（PayPayチャージ・デビット・カード）は、内訳の明細が取り込まれていれば振替として支出から除き、
 * 取り込まれていなければ「内訳なし」の支出として数える（二重計上と計上漏れの両方を防ぐ）。
 */
export function enrich(
  txs: Transaction[],
  overrides: TxOverride[],
  merchants: Merchant[],
  rules: MerchantRule[],
  validCategoryIds?: Set<string>,
  statements: Statement[] = [],
): EnrichedTx[] {
  const coverage = buildCoverage(txs, statements)
  const ovMap = new Map(overrides.map((o) => [o.txId, o]))
  const mMap = new Map(merchants.map((m) => [m.name, m]))
  const cache = new Map<string, ReturnType<typeof resolveMerchant>>()
  const valid = (id: string | undefined) =>
    id != null && (validCategoryIds == null || validCategoryIds.has(id)) ? id : undefined

  return txs.map((t) => {
    const ov = ovMap.get(t.id)
    let r = cache.get(t.payee)
    if (!r) {
      r = resolveMerchant(t.payee, rules)
      cache.set(t.payee, r)
    }
    const m = mMap.get(r.merchant)
    const merchantCategory = m?.manual
      ? valid(m.categoryId)
      : (valid(r.ruleCategory) ??
        valid(r.builtinCategory) ??
        valid(builtinCategoryOf(r.merchant)) ??
        // 店舗名から判定できない請求書払い（自治体・事務局など）は税金・公共料金とする
        (t.description.includes('請求書') ? valid('tax') : undefined) ??
        valid(m?.categoryId))
    const overridden = valid(ov?.categoryId)
    let autoKind = classifyTx(t)
    let link: TxLink | undefined
    if (autoKind === 'internal' && t.direction === 'out') {
      const target = linkTargetOf(t.payee)
      if (target) {
        link = { target, covered: isCovered(target, t, coverage) }
        if (!link.covered) autoKind = 'payment'
      }
    }
    return {
      ...t,
      autoKind,
      // 旧バージョンで手動設定された 'bill'（請求書払い・税金）は支払いとして扱う
      effectiveKind: ((ov?.kind as string) === 'bill' ? 'payment' : ov?.kind) ?? autoKind,
      merchant: r.merchant,
      categoryId: overridden ?? merchantCategory ?? UNCATEGORIZED,
      categoryOverridden: overridden != null,
      link,
    }
  })
}
