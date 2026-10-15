import { matchKey } from './merchants'
import type { Account, AccountType, Statement, Transaction } from './types'

export const PAYPAY_ACCOUNT: Account = { id: 'paypay', name: 'PayPay', type: 'wallet' }
export const BANK_ACCOUNT: Account = { id: 'bank', name: '銀行口座', type: 'bank' }
export const DEBIT_ACCOUNT: Account = { id: 'aeon-debit', name: 'イオンデビット', type: 'debit' }

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  wallet: 'コード決済',
  bank: '銀行',
  debit: 'デビット',
  credit: 'クレジット',
}

const TYPE_ORDER: AccountType[] = ['bank', 'wallet', 'debit', 'credit']

/** 表示順: 銀行 → PayPay → デビット → クレジット（同じ種類は名前順） */
export function sortAccounts(accounts: Account[]): Account[] {
  return [...accounts].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name, 'ja'))
}

/** 口座ごとの表示色（落ち着いた色。カテゴリの色とは別系統） */
export function accountColor(a: Pick<Account, 'type'> | undefined): string {
  return { bank: '#4f6f8f', wallet: '#c94b4b', debit: '#b07a2a', credit: '#6a5a9a' }[a?.type ?? 'bank'] ?? '#98a294'
}

/** カード会社ごとの口座ID（カード名ごとに分ける） */
export const cardAccountId = (group: 'saison' | 'smbc', cardName: string) => `${group}:${matchKey(cardName) || 'card'}`

/** 口座IDが口座グループ（paypay / aeon-debit / saison / smbc）に属するか */
export const inGroup = (accountId: string, group: string) => accountId === group || accountId.startsWith(`${group}:`)

/**
 * 銀行の出金（または デビットのチャージ）の取引内容 → 内訳の明細がある口座グループ。
 * 内訳を取り込んでいる期間は振替として支出から除き、取り込んでいない期間は「内訳なし」の支出として数える。
 * matchKey() 済みの文字列に対して評価する。
 */
const LINK_RULES: { re: RegExp; target: string }[] = [
  { re: /^rs(paypay|ペイペイ)|paypay|ペイペイ/, target: 'paypay' },
  { re: /jcbデビツト|jcbデビット/, target: 'aeon-debit' },
  { re: /^セゾン/, target: 'saison' },
  { re: /^ミツイスミトモカード|^smbcカード|^三井住友カード/, target: 'smbc' },
]

export function linkTargetOf(payee: string): string | undefined {
  const key = matchKey(payee)
  return LINK_RULES.find((r) => r.re.test(key))?.target
}

/**
 * 内訳の明細が取り込まれている範囲。
 * - PayPay: 最初と最後の取引の間の月
 * - イオンデビット: 明細の「ご利用分」の月（月単位で全件そろっている）
 * - カード: 取り込んだ請求（支払月と請求額）。銀行の引落と金額で照合する
 */
export interface Coverage {
  months: Map<string, Set<string>>
  statements: Statement[]
}

export function buildCoverage(txs: Pick<Transaction, 'accountId' | 'month' | 'raw'>[], statements: Statement[]): Coverage {
  const months = new Map<string, Set<string>>()
  const add = (group: string, m: string) => {
    if (!months.has(group)) months.set(group, new Set())
    months.get(group)!.add(m)
  }
  let first: string | undefined
  let last: string | undefined
  for (const t of txs) {
    if (t.accountId === PAYPAY_ACCOUNT.id) {
      if (!first || t.month < first) first = t.month
      if (!last || t.month > last) last = t.month
    } else if (t.accountId === DEBIT_ACCOUNT.id) {
      add(DEBIT_ACCOUNT.id, t.raw['ご利用分'] || t.month)
    }
  }
  if (first && last) {
    for (let m = first; m <= last; m = nextMonth(m)) add(PAYPAY_ACCOUNT.id, m)
  }
  return { months, statements }
}

const nextMonth = (m: string) => {
  const y = Number(m.slice(0, 4))
  const mo = Number(m.slice(5, 7))
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
}

const prevMonth = (m: string) => {
  const y = Number(m.slice(0, 4))
  const mo = Number(m.slice(5, 7))
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`
}

/** 引落・チャージの取引に対応する内訳の明細が取り込まれているか */
export function isCovered(target: string, t: Pick<Transaction, 'month' | 'amount'>, cov: Coverage): boolean {
  if (target === 'saison' || target === 'smbc') {
    // 支払日が休日で翌月にずれる場合に備え、前月の請求も対象にする
    const months = [t.month, prevMonth(t.month)]
    return cov.statements.some((s) => inGroup(s.accountId, target) && months.includes(s.paymentMonth) && s.total === t.amount)
  }
  return cov.months.get(target)?.has(t.month) ?? false
}
