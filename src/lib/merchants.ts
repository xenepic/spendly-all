import type { MerchantRule } from './types'

/** 照合用キー: 全角半角統一・小文字化・空白とハイフン類の除去 */
export function matchKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　\-‐‑–—−・･.。'’!！]/g, '')
}

/**
 * カード・デビットの明細の店名を読みやすくする: NFKC（半角カナ→全角）、
 * カナの間の「-」「―」を長音「ー」に統一（例: ｻ-ﾋﾞｽ → サービス）、末尾の空白埋めを除去
 */
export function normalizeKanaName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/(?<=[ァ-ヶ])[-‐―−](?=[ァ-ヶ]|[\s(]|$)/g, 'ー')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 表示用の取引先名: 全角英数・空白のみ統一し、それ以外は元の表記を保つ */
export function displayName(name: string): string {
  const n = name.normalize('NFKC').replace(/\s+/g, ' ').trim()
  return n || '（取引先なし）'
}

interface BuiltinRule {
  re: RegExp
  merchant?: string
  category: string
}

/**
 * 組み込みの店舗統合・カテゴリ判定ルール。matchKey() 済みの文字列に対して先頭から評価する。
 * merchant を指定したルールは表記揺れ・支店名の違いを1つの店舗名に統合する。
 * 実際の公式CSV・旧形式CSVの取引先名を元に調整している。
 */
const BUILTIN_RULES: BuiltinRule[] = [
  // 銀行の引落（内訳の明細を取り込んでいない期間は、この名前で「その他」の支出として数える）
  { re: /^rs(paypay|ペイペイ)/, merchant: 'PayPay（チャージ）', category: 'other' },
  { re: /^jcbデビツト|^jcbデビット/, merchant: 'イオンデビット（内訳なし）', category: 'other' },
  { re: /^セゾン$/, merchant: 'セゾンカード（内訳なし）', category: 'other' },
  { re: /^ミツイスミトモカード/, merchant: '三井住友カード（内訳なし）', category: 'other' },
  { re: /^ラクテンカード/, merchant: '楽天カード（内訳なし）', category: 'other' },
  { re: /^イオンフイナンシヤル|^イオンフィナンシャル/, merchant: 'イオンカード（内訳なし）', category: 'other' },
  // 住居
  { re: /ヤチン|家賃|管理費|共益費/, merchant: '家賃', category: 'housing' },
  // カード明細で月や番号ごとに表記が変わる請求をまとめる
  { re: /^コクミンネンキン/, merchant: '国民年金保険料', category: 'tax' },
  { re: /^大阪ガス/, merchant: '大阪ガス', category: 'tax' },
  { re: /^looop/, merchant: 'Looopでんき', category: 'tax' },
  { re: /^j:?comnhk/, merchant: 'NHK受信料（J:COM）', category: 'tax' },
  { re: /^j:?com/, merchant: 'J:COM', category: 'telecom' },
  { re: /^ドコモ/, merchant: 'ドコモ', category: 'telecom' },
  { re: /カゴヤ|さくらインターネツト|さくらインターネット|xserver|エツクスサーバー|エックスサーバー/, category: 'telecom' },
  { re: /^nintendo/, merchant: 'Nintendo', category: 'hobby' },
  { re: /グーグルプレイ|googleplay/, merchant: 'Google Play', category: 'hobby' },
  { re: /netflix|ネツトフリツクス|ネットフリックス/, merchant: 'Netflix', category: 'hobby' },
  { re: /anthropic|^claude/, merchant: 'Claude', category: 'hobby' },
  { re: /openai|chatgpt/, merchant: 'ChatGPT', category: 'hobby' },
  { re: /^トヨタレンタ/, merchant: 'トヨタレンタカー', category: 'transport' },
  // 税金・年金・公的保険料・公共料金（NHK・電気・ガス・水道）
  { re: /国税|地方税|都税|道税|府税|県税|市税|区税|町税|村税|税金|納税|年金|ネンキン|保険料|ホケンリヨウ|国民健康保険|nhk|受信料/, category: 'tax' },
  { re: /大阪ガス|東京ガス|東邦ガス|西部ガス|でんき|電力|水道局|上下水道|looop/, category: 'tax' },
  // 通信
  { re: /^ドコモ|docomo|ソフトバンク|softbank|ワイモバイル|ymobile|楽天モバイル|^povo|^ahamo|j:?com|nuro|フレッツ|^ocn|biglobe|ビッグローブ/, category: 'telecom' },
  // 公的機関・寺社（少額の手数料・授与品など）
  { re: /神社|神宮|寺院|大社|授与所|区役所|市役所|役場/, category: 'other' },
  // コンビニ
  { re: /セブンー?イレブン|7eleven|seveneleven/, merchant: 'セブンイレブン', category: 'convenience' },
  { re: /ファミリーマート|ファミマ|familymart/, merchant: 'ファミリーマート', category: 'convenience' },
  { re: /ローソン|lawson/, merchant: 'ローソン', category: 'convenience' },
  { re: /ミニストップ|ministop/, merchant: 'ミニストップ', category: 'convenience' },
  { re: /デイリーヤマザキ|ヤマザキデイリー/, merchant: 'デイリーヤマザキ', category: 'convenience' },
  { re: /セイコーマート/, merchant: 'セイコーマート', category: 'convenience' },
  { re: /newdays|ニューデイズ/, merchant: 'NewDays', category: 'convenience' },
  { re: /キヨスク|kiosk/, category: 'convenience' },
  // 百貨店・商業施設
  { re: /伊勢丹/, category: 'shopping' },
  { re: /高島屋|髙島屋|大丸|阪急百貨店|阪神百貨店|近鉄百貨店|三越|松坂屋|そごう|西武百貨店/, category: 'shopping' },
  { re: /東急プラザ|ルミネ|パルコ|parco|オーパ|マルイ|0101|アウトレット/, category: 'shopping' },
  // スーパー
  { re: /まいばすけっと/, merchant: 'まいばすけっと', category: 'supermarket' },
  { re: /マックスバリュ/, merchant: 'マックスバリュ', category: 'supermarket' },
  { re: /^イオン(?!銀行|シネマ|モール)|^aeon(?!bank)/, merchant: 'イオン', category: 'supermarket' },
  { re: /業務スーパー/, merchant: '業務スーパー', category: 'supermarket' },
  { re: /フレスコ/, merchant: 'フレスコ', category: 'supermarket' },
  { re: /新鮮激安市場/, merchant: '新鮮激安市場', category: 'supermarket' },
  { re: /^万代/, merchant: '万代', category: 'supermarket' },
  { re: /^ライフ(?!スタイル)|ライフコーポレーション/, merchant: 'ライフ', category: 'supermarket' },
  { re: /西友|seiyu/, merchant: '西友', category: 'supermarket' },
  { re: /イトーヨーカドー|ヨーカドー/, merchant: 'イトーヨーカドー', category: 'supermarket' },
  { re: /成城石井/, merchant: '成城石井', category: 'supermarket' },
  { re: /^サンディ/, merchant: 'サンディ', category: 'supermarket' },
  { re: /aプライス/, merchant: 'A-プライス', category: 'supermarket' },
  { re: /マルエツ|サミットストア|平和堂|イズミヤ|イヅミヤ|阪急オアシス|ダイエー|関西スーパー|東急ストア|オオゼキ|ヤオコー|コープ|生協|ロピア|オーケーストア|トライアル|大阪屋ショップ|スーパー/, category: 'supermarket' },
  // ドラッグストア
  { re: /スギ薬局|スギドラッグ/, merchant: 'スギ薬局', category: 'drugstore' },
  { re: /マツモトキヨシ|マツキヨ|matsukiyo/, merchant: 'マツモトキヨシ', category: 'drugstore' },
  { re: /ウエルシア|ハックドラッグ/, merchant: 'ウエルシア', category: 'drugstore' },
  { re: /ココカラファイン/, merchant: 'ココカラファイン', category: 'drugstore' },
  { re: /ツルハ/, merchant: 'ツルハドラッグ', category: 'drugstore' },
  { re: /サンドラッグ/, merchant: 'サンドラッグ', category: 'drugstore' },
  { re: /アカカベ|ドラッグ|ドラック|薬局|薬店/, category: 'drugstore' },
  // 外食（チェーン）
  { re: /出前館/, merchant: '出前館', category: 'dining' },
  { re: /ubereats|ウーバーイーツ/, merchant: 'Uber Eats', category: 'dining' },
  { re: /マクドナルド|mcdonald/, merchant: 'マクドナルド', category: 'dining' },
  { re: /スターバックス|starbucks/, merchant: 'スターバックス', category: 'dining' },
  { re: /ミスタードーナ|misdo/, merchant: 'ミスタードーナツ', category: 'dining' },
  { re: /バーガーキング|burgerking/, merchant: 'バーガーキング', category: 'dining' },
  { re: /お酒の美術館/, merchant: 'お酒の美術館', category: 'dining' },
  { re: /鳥貴族/, merchant: '鳥貴族', category: 'dining' },
  { re: /すき家|吉野家|松屋|なか卯|ガスト|サイゼリヤ|ドトール|タリーズ|コメダ|天下一品|モスバーガー|ケンタッキー|くら寿司|スシロー|はま寿司|かっぱ寿司|丸亀製麺|ココイチ|coco壱|大戸屋|バーミヤン|ジョナサン|王将|一蘭|一風堂|勝牛|kichiri|杉玉|ルノアール|カプリチョーザ|eggsnthings|ずんどう屋|壱角家|魁力屋|大同門|^hub|ダーツバー/, category: 'dining' },
  // 外食（業態が明確なもの。食品の「水産」「酒」などより優先）
  { re: /寿司|寿し|鮨|ラーメン|ラー麺|らーめん|焼肉|ヤキニク|ホルモン|うどん|丼|食堂|レストラン/, category: 'dining' },
  // スーパー・食品（持ち帰りの菓子・パン・酒・生鮮・土産物）
  { re: /菓子|製菓|菓匠|パン|ベーカリー|bakery|ブランジェリー|ケーキ|パティスリー|ドーナツ|donuts|六花亭|中村軒|きねや|宝泉堂|満寿屋|タンタシオン|コルネ|リカー|酒店|酒造|酒販|ワイン|ウヰスキー|ウイスキー|ワイナリー|ブルワリー|精肉|肉店|水産|海産|鮮魚|物産|土産|売店|道の駅|茶舗|bento|弁当|佃煮|マネケン|plusta/, category: 'supermarket' },
  // 外食（業態キーワード）
  { re: /ラーメン|ラー麺|らーめん|うどん|そば|蕎麦|丼|寿司|寿し|鮨|すし|焼肉|ホルモン|焼鳥|焼き鳥|串|もつ|居酒屋|酒場|食堂|ダイニング|dining|レストラン|トラットリア|ビストロ|食彩|亭|kitchen|キッチン|カフェ|cafe|かふぇ|喫茶|珈琲|coffee|コーヒー|^bar|お好み焼|鉄板|どてっぱん|トンテキ|ピザ|パスタ|料理|海鮮|うに|回転/, category: 'dining' },
  // 交通（「チケット」を含むバス券売所などを趣味より先に判定）
  { re: /リムジンバス|高速バス|空港バス/, category: 'transport' },
  { re: /スマートイーエ.?クス|スマートex|エクスプレス予約/, merchant: 'スマートEX', category: 'transport' },
  { re: /イコカ|icoca|モバイルスイカ|suica|pasmo/, merchant: '交通系IC（チャージ）', category: 'transport' },
  { re: /^ジエイアール|^jr(?!a)/, category: 'transport' },
  { re: /^etc|イデミツ|出光|エネオス|eneos|コスモ石油|ガソリン|レンタリース|レンタカー|アゴダ|agoda|^タイムズ/, category: 'transport' },
  // 自動販売機
  { re: /コカコーラ|ジハンキ|自販機/, category: 'convenience' },
  // 商業施設（テナントが分からない利用）
  { re: /^イオンモール/, merchant: 'イオンモール', category: 'shopping' },
  // 日用品
  { re: /ダイソー|daiso/, merchant: 'ダイソー', category: 'daily' },
  { re: /ニトリ|デコホーム/, merchant: 'ニトリ', category: 'daily' },
  { re: /無印良品|muji/, merchant: '無印良品', category: 'daily' },
  { re: /^dcm/, merchant: 'DCM', category: 'daily' },
  { re: /セリア|キャンドゥ|ワッツ|ロフト|ハンズ|カインズ|コーナン|コメリ|ビバホーム|ホームセンター/, category: 'daily' },
  // ショッピング
  { re: /amazon|アマゾン/, merchant: 'Amazon', category: 'shopping' },
  { re: /ジーユー|^gu$/, merchant: 'ジーユー', category: 'shopping' },
  { re: /ユニクロ|uniqlo/, merchant: 'ユニクロ', category: 'shopping' },
  { re: /しまむら|asbee|abcマート|ドスパラ|ヨドバシ|ビックカメラ|エディオン|ジョーシン|ケーズデンキ|楽天|ラクテン|panasonic|メガネ|眼鏡|lenslabo|zoff|jins|指輪|ジュエリー|jkplanet|書店|ブックオフ|linegift|松栄堂|ecute/, category: 'shopping' },
  // デジタル
  { re: /ブックライブ|booklive|dlsite|kindle|steam|apple|google|グーグル|netflix|spotify|nintendo|playstation|dmm|シーモア|めちゃコミック|コミックdays|コミチ|^note$|ユーネクスト|unext|デイズニー|ディズニー|disney|マイクロソフト|microsoft|anthropic|claude|openai|chatgpt/, category: 'hobby' },
  // 旅行・宿泊
  { re: /peach|aviation|航空|全日空|tripcom|じゃらん|楽天トラベル|booking|airbnb|ホテル|hotel|旅館|宿$|の宿|宿泊|民宿|アパサービス|^apa/, category: 'transport' },
  // 趣味・娯楽・レジャー
  { re: /第一興商|ビッグエコー|カラオケ|ジャンカラ|ラウンドワン|映画|シネマ|ピカデリー|toho|ミュージアム|美術館|博物館|水族館|動物園|写真祭|kyotographie|アソビュー|入場|チケット|ticket|パーク$|ホースパーク|の丘|温泉|湯|サウナ|銭湯|^jra|即pat|競馬|ゲーム/, category: 'hobby' },
  // 交通
  { re: /タクシー|交通|^jr(?!a)|鉄道|電鉄|バス$|市バス|高速バス|リムジンバス|^go$|sride|新幹線|駐車場|タイムズ/, category: 'transport' },
  // 医療
  { re: /病院|医院|クリニック|歯科|調剤/, category: 'drugstore' },
  // ふるさと納税
  { re: /さとふる|ふるさと/, category: 'other' },
]

/**
 * 「施設名 - テナント名」形式で、施設側ではなくテナント側を店舗として扱う取引先
 * （駅ビル・地下街・空港・SA など。例: 京都ポルタ（地下街） - 一風堂）
 */
const FACILITY = /^(京都ポルタ|ポルタ|ルクア|ホワイティ|ecute|エキュート|グランスタ|gransta|asty|jrplus|nexco|イオンモール|京都ファミリー)|駅ナカ|エキナカ|空港|ターミナルビル|サービスエリア|パーキングエリア|地下街/

const findRule = (name: string) => {
  const key = matchKey(name)
  return key ? BUILTIN_RULES.find((r) => r.re.test(key)) : undefined
}

/** 公式CSVの取引先「ブランド - 店舗名」を分割する（旧形式は分割されない） */
export function splitPayee(payee: string): { brand: string; store?: string } {
  const parts = displayName(payee).split(/\s+-\s+/)
  const brand = parts[0]
  const store = parts.slice(1).join(' - ').trim()
  return store && store !== brand ? { brand, store } : { brand }
}

export interface Resolved {
  merchant: string
  /** 組み込みルールから推定したカテゴリ（なければ undefined） */
  builtinCategory?: string
  /** ユーザーのカテゴリルールで決まったカテゴリ（組み込みルールより優先） */
  ruleCategory?: string
}

const ruleMatches = (r: MerchantRule, keys: string[]) => {
  const p = matchKey(r.pattern)
  return !!p && keys.some((k) => (r.match === 'exact' ? k === p : k.includes(p)))
}

function resolveName(payee: string, userRules: MerchantRule[]): Omit<Resolved, 'ruleCategory'> {
  const key = matchKey(payee)
  const nameRule = sortRules(userRules).find((r) => r.merchant && ruleMatches(r, [key]))
  if (nameRule?.merchant) return { merchant: nameRule.merchant, builtinCategory: builtinCategoryOf(nameRule.merchant) }
  const { brand, store } = splitPayee(payee)
  if (store && FACILITY.test(matchKey(brand))) {
    const r = findRule(store)
    return { merchant: r?.merchant ?? store, builtinCategory: r?.category }
  }
  const byBrand = findRule(brand)
  if (byBrand) return { merchant: byBrand.merchant ?? brand, builtinCategory: byBrand.category }
  const byStore = store ? findRule(store) : undefined
  return byStore ? { merchant: brand, builtinCategory: byStore.category } : { merchant: brand }
}

/** 取引先名から正規化した店舗名と推定カテゴリを求める。元の取引先名は変更しない */
export function resolveMerchant(payee: string, userRules: MerchantRule[] = []): Resolved {
  const resolved = resolveName(payee, userRules)
  // カテゴリルールは元の取引先名と統合後の店舗名のどちらに該当しても適用する
  const keys = [matchKey(payee), matchKey(resolved.merchant)]
  const catRule = sortRules(userRules).find((r) => r.categoryId && ruleMatches(r, keys))
  return catRule ? { ...resolved, ruleCategory: catRule.categoryId } : resolved
}

/** パターンに該当する店舗名（統合後）の一覧 */
export function merchantsMatching(
  pattern: string,
  match: MerchantRule['match'],
  pairs: { payee: string; merchant: string }[],
): string[] {
  const rule = { id: '', pattern, match, createdAt: '' }
  const out = new Set<string>()
  for (const { payee, merchant } of pairs) {
    if (ruleMatches(rule, [matchKey(payee), matchKey(merchant)])) out.add(merchant)
  }
  return [...out]
}

/** ユーザールールの評価順: 完全一致 → 部分一致、同じ条件では新しいものを優先 */
export function sortRules(rules: MerchantRule[]): MerchantRule[] {
  return [...rules].sort(
    (a, b) => (a.match === b.match ? 0 : a.match === 'exact' ? -1 : 1) || b.createdAt.localeCompare(a.createdAt),
  )
}

/** 正規化済み店舗名に対する組み込みカテゴリ */
export function builtinCategoryOf(merchant: string): string | undefined {
  return findRule(merchant)?.category
}
