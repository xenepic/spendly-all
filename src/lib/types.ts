/** 取引種別。payment のみが消費支出として集計される */
export type TxKind =
  | 'payment' // 支払い（消費支出）
  | 'charge' // 残高チャージ
  | 'transfer_out' // 送金
  | 'transfer_in' // 受け取り
  | 'refund' // 返金
  | 'point' // ポイント付与・獲得
  | 'investment' // 投資（ポイント運用・投信積立・確定拠出年金など）
  | 'withdrawal' // 銀行への出金
  | 'income' // 収入（給与・振込の受け取り・利息）
  | 'internal' // 振替（銀行からカード引落・PayPayチャージ。内訳は各明細で集計する）
  | 'cash' // ATMでの現金の引き出し・預け入れ
  | 'unknown' // 判定できない取引（要確認）

/**
 * CSVの形式。
 * official / legacy: PayPay（公式・旧形式）、bank: 銀行の普通預金明細、aeon-debit: イオンデビット（拡張機能の出力）、
 * saison: セゾンカード、smbc-card: 三井住友カード
 */
export type CsvFormat = 'official' | 'legacy' | 'bank' | 'aeon-debit' | 'saison' | 'smbc-card'

export type AccountType = 'wallet' | 'bank' | 'debit' | 'credit'

/** 取引の出どころ（PayPay・銀行口座・カード）。取り込んだ明細から自動で登録する */
export interface Account {
  id: string
  name: string
  type: AccountType
}

/** クレジットカードの請求（1回の引落）。銀行の引落と照合し、振替かどうかを判定する */
export interface Statement {
  /** `${accountId}:${paymentMonth}` */
  id: string
  accountId: string
  /** 支払月 'yyyy-MM' */
  paymentMonth: string
  /** 支払日 'yyyy-MM-dd'（明細に記載がある場合） */
  paymentDate?: string
  /** 請求額（円） */
  total: number
  fileName: string
}

/** CSV 由来の取引。raw は元の行をそのまま保持し、正規化値は raw から決定的に導出される */
export interface Transaction {
  id: string
  importId: string
  format: CsvFormat
  /** 取引の出どころ（Account.id） */
  accountId: string
  /** 元CSVの列名 → 値（取り込み時のまま変更しない） */
  raw: Record<string, string>
  /** 取引番号（PayPay公式CSV・イオンデビットのみ） */
  txNumber?: string
  /** ローカル時刻 'yyyy-MM-ddTHH:mm'（時刻のない明細は T00:00） */
  occurredAt: string
  /** 'yyyy-MM' */
  month: string
  /** 正の整数（円） */
  amount: number
  direction: 'out' | 'in'
  /** 取り込み時に CSV から自動判定した種別（表示・集計では再判定した autoKind を使う） */
  kind: TxKind
  /** CSV 上の取引内容（例: 支払い / 支払い完了） */
  description: string
  /** CSV 上の取引先名（ブランド名）。分類の入力に使う */
  payee: string
  /** 店舗名・支店名など（旧形式の2列目） */
  store?: string
  /** 取引方法（公式CSVのみ） */
  method?: string
  /** カード明細の支払月 'yyyy-MM'（最初に取り込んだ明細のもの） */
  statementMonth?: string
}

export interface Category {
  id: string
  name: string
  color: string
  /** 店舗一覧などでカテゴリを表す絵文字（v2 で追加。古いバックアップには無いことがある） */
  emoji?: string
  order: number
}

/** 正規化後の店舗。カテゴリの割り当てを保持する */
export interface Merchant {
  name: string
  categoryId: string
  /** ユーザーが手動で設定したか */
  manual: boolean
}

/** 取引先名 → 正規化店舗名 の統合ルール（ユーザー定義） */
/**
 * ユーザー定義ルール。取引先名（または正規化後の店舗名）がパターンに該当したとき、
 * merchant があれば店舗名を統合し、categoryId があればカテゴリを設定する（少なくとも一方を持つ）。
 */
export interface MerchantRule {
  id: string
  pattern: string
  match: 'contains' | 'exact'
  merchant?: string
  categoryId?: string
  createdAt: string
}

/** 取引単位の手動上書き。元データとは別に保持する */
export interface TxOverride {
  txId: string
  categoryId?: string
  kind?: TxKind
}

export interface ImportHistory {
  id: string
  fileName: string
  importedAt: string
  format: CsvFormat
  accountId?: string
  encoding: string
  totalRows: number
  added: number
  duplicates: number
  skipped: number
  unknown: number
  errors: string[]
  periodFrom?: string
  periodTo?: string
}

/** 集計用に分類情報を付加した取引 */
export interface EnrichedTx extends Transaction {
  /** 現在の判定ルールで元データから再判定した種別 */
  autoKind: TxKind
  effectiveKind: TxKind
  merchant: string
  categoryId: string
  categoryOverridden: boolean
  /** 銀行の引落・チャージのうち、内訳の明細と対応づけたもの */
  link?: TxLink
}

/** 銀行の引落と内訳の明細の対応 */
export interface TxLink {
  /** 内訳の口座グループ（paypay / aeon-debit / saison / smbc） */
  target: string
  /** 内訳の明細が取り込まれているか（false なら内訳なしの支出として扱う） */
  covered: boolean
}
