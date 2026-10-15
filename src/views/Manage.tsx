import { useMemo, useState } from 'react'
import { deleteCategory, restoreMerchants, setMerchantsCategory, type MerchantSnapshot } from '../lib/classify'
import { byMerchant, isSpending } from '../lib/analytics'
import { DEFAULT_EMOJI, EXTRA_COLORS, UNCATEGORIZED } from '../lib/categories'
import { db, newId } from '../lib/db'
import { yen } from '../lib/format'
import { builtinCategoryOf, matchKey, merchantsMatching, resolveMerchant } from '../lib/merchants'
import type { SpendlyData } from '../hooks/useData'
import { usePersistentState } from '../hooks/usePersistentState'
import { NoRows } from '../components/Empty'
import { EmojiPicker } from '../components/EmojiPicker'

type Tab = 'merchants' | 'categories' | 'rules'

interface Props {
  data: SpendlyData
  onMerchant: (name: string) => void
  onUnknown: () => void
}

export function Manage({ data, onMerchant, onUnknown }: Props) {
  const [tab, setTab] = usePersistentState<Tab>('manage.tab', 'merchants')
  const [rulePattern, setRulePattern] = useState('')
  const spend = useMemo(() => data.txs.filter(isSpending), [data.txs])
  const unknownCount = data.txs.filter((t) => t.effectiveKind === 'unknown').length
  const uncategorized = spend.filter((t) => t.categoryId === UNCATEGORIZED)

  return (
    <>
      <div className="mb-[14px] grid grid-cols-2 gap-3">
        <div className="card">
          <span className="caption">未分類の支出</span>
          <div className="value">{yen(uncategorized.reduce((a, t) => a + t.amount, 0))}</div>
          <span className="sub">
            {uncategorized.length}回 ・ {new Set(uncategorized.map((t) => t.merchant)).size}店舗
          </span>
        </div>
        <button className="card text-left transition-colors duration-150 enabled:hover:bg-hover-soft" onClick={onUnknown} disabled={!unknownCount}>
          <span className="caption">種別を判定できない取引</span>
          <div className="value">{unknownCount}件</div>
          <span className="sub">{unknownCount ? '取引一覧で確認 →' : '該当なし'}</span>
        </button>
      </div>

      <div className="mb-[14px] flex flex-wrap gap-[7px]" role="tablist">
        {(
          [
            ['merchants', '店舗'],
            ['categories', 'カテゴリ'],
            ['rules', 'ルール（カテゴリ・店舗名）'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`pill ${tab === id ? 'pill-active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div key={tab} className="motion-safe:animate-appear">
        {tab === 'merchants' && (
          <MerchantsTab
            data={data}
            onMerchant={onMerchant}
            onCreateRule={(pattern) => {
              setRulePattern(pattern)
              setTab('rules')
            }}
          />
        )}
        {tab === 'categories' && <CategoriesTab data={data} />}
        {tab === 'rules' && <RulesTab data={data} initialPattern={rulePattern} />}
      </div>
    </>
  )
}

interface MerchantsTabProps {
  data: SpendlyData
  onMerchant: (name: string) => void
  onCreateRule: (pattern: string) => void
}

function MerchantsTab({ data, onMerchant, onCreateRule }: MerchantsTabProps) {
  const [query, setQuery] = usePersistentState('manage.merchantQuery', '')
  const [onlyUncat, setOnlyUncat] = usePersistentState('manage.onlyUncategorized', false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [limit, setLimit] = useState(50)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkCategory, setBulkCategory] = useState('')
  const [done, setDone] = useState<{ text: string; snapshot: MerchantSnapshot } | null>(null)
  const spend = useMemo(() => data.txs.filter(isSpending), [data.txs])
  const rows = useMemo(() => byMerchant(spend), [spend])
  const payeesOf = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const t of data.txs) {
      if (!m.has(t.merchant)) m.set(t.merchant, new Set())
      m.get(t.merchant)!.add(t.payee)
    }
    return m
  }, [data.txs])
  const mMap = useMemo(() => new Map(data.merchants.map((m) => [m.name, m])), [data.merchants])
  const q = matchKey(query)
  // 一部の取引だけ未分類の店舗も「未分類のみ」に含める
  const uncatMerchants = useMemo(() => new Set(spend.filter((t) => t.categoryId === UNCATEGORIZED).map((t) => t.merchant)), [spend])
  const shown = rows.filter((r) => (!onlyUncat || uncatMerchants.has(r.key)) && (!q || matchKey(r.key).includes(q)))
  // 絞り込みで見えなくなった店舗は選択から外す
  const selectedShown = shown.filter((r) => selected.has(r.key))
  const allShownSelected = shown.length > 0 && selectedShown.length === shown.length
  const toggle = (name: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(name)) n.delete(name)
      else n.add(name)
      return n
    })
  const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(shown.map((r) => r.key)))

  const applyBulk = async (categoryId: string | null) => {
    const names = selectedShown.map((r) => r.key)
    if (names.length === 0) return
    const snapshot = await setMerchantsCategory(db, names, categoryId)
    const label = categoryId ? `「${data.catMap.get(categoryId)?.name}」に設定` : '自動判定に戻'
    setDone({ text: `${names.length}店舗を${label}しました`, snapshot })
    setSelected(new Set())
    setBulkCategory('')
  }

  const setMerchantCategory = (name: string, categoryId: string) =>
    categoryId === '' ? db.merchants.update(name, { manual: false }) : db.merchants.put({ name, categoryId, manual: true })

  const rename = async (from: string) => {
    const to = newName.trim()
    setRenaming(null)
    if (!to || to === from) return
    const payees = [...(payeesOf.get(from) ?? [])]
    await db.transaction('rw', db.merchantRules, db.merchants, async () => {
      // 既存の同名パターンは置き換える
      const existing = await db.merchantRules.toArray()
      const keys = new Set(payees.map(matchKey))
      await db.merchantRules.bulkDelete(existing.filter((r) => r.match === 'exact' && keys.has(matchKey(r.pattern))).map((r) => r.id))
      await db.merchantRules.bulkAdd(
        payees.map((p) => ({ id: newId(), pattern: p, match: 'exact' as const, merchant: to, createdAt: new Date().toISOString() })),
      )
      const old = await db.merchants.get(from)
      const target = await db.merchants.get(to)
      if (old && !target) await db.merchants.put({ ...old, name: to })
    })
  }

  return (
    <div className="card">
      <div className="cardhead flex-wrap">
        <div>
          <h2>店舗ごとのカテゴリ</h2>
          <p className="meta">店舗のカテゴリを変更すると、その店舗の全取引に反映されます（取引単位で変更したものを除く）。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-legend">
            <input type="checkbox" checked={onlyUncat} onChange={(e) => setOnlyUncat(e.target.checked)} className="accent-brand" />
            未分類のみ
          </label>
          <input className="input w-[200px]" placeholder="店舗名で検索" aria-label="店舗検索" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      {query.trim() && shown.length > 0 && (
        <p className="caption -mt-2 mb-3">
          「{query.trim()}」を含む店舗: {shown.length}件 ・{' '}
          <button className="border-0 bg-transparent p-0 text-[11px] font-bold text-brand hover:underline" onClick={() => onCreateRule(query.trim())}>
            この検索語でカテゴリのルールを作る（今後の取り込みにも適用）→
          </button>
        </p>
      )}
      {selectedShown.length > 0 && (
        <div className="sticky top-[calc(var(--header-h,0px)+8px)] z-[5] mb-3 flex flex-wrap items-center gap-2 rounded-[9px] border border-pill-active bg-[#f3f8f2] p-3 text-xs shadow-sm motion-safe:animate-fade">
          <b>{selectedShown.length}店舗を選択中</b>
          <select className="select py-1.5!" aria-label="一括設定するカテゴリ" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)}>
            <option value="">カテゴリを選択</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="control control-primary py-1.5!" disabled={!bulkCategory} onClick={() => applyBulk(bulkCategory)}>
            一括設定
          </button>
          <button className="control py-1.5!" onClick={() => applyBulk(null)}>
            自動判定に戻す
          </button>
          <button className="ml-auto border-0 bg-transparent text-[11px] text-faint hover:text-brand" onClick={() => setSelected(new Set())}>
            選択を解除
          </button>
        </div>
      )}
      {done && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[9px] bg-mini px-3 py-2 text-xs motion-safe:animate-fade" role="status">
          {done.text}
          <button
            className="border-0 bg-transparent p-0 text-xs font-bold text-brand hover:underline"
            onClick={async () => {
              await restoreMerchants(db, done.snapshot)
              setDone(null)
            }}
          >
            元に戻す
          </button>
          <button className="ml-auto border-0 bg-transparent text-[11px] text-faint" onClick={() => setDone(null)} aria-label="閉じる">
            ×
          </button>
        </div>
      )}
      {shown.length === 0 ? (
        <NoRows text="該当する店舗はありません" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse">
            <thead>
              <tr>
                <th className="th w-8 pr-0!">
                  <input
                    type="checkbox"
                    className="accent-brand"
                    checked={allShownSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedShown.length > 0 && !allShownSelected
                    }}
                    onChange={toggleAll}
                    aria-label={`表示中の${shown.length}店舗をすべて選択`}
                    title={`表示中の${shown.length}店舗をすべて選択`}
                  />
                </th>
                <th className="th">店舗</th>
                <th className="th">元の取引先名</th>
                <th className="th">カテゴリ</th>
                <th className="th text-right!">回数</th>
                <th className="th text-right!">合計</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, limit).map((r) => {
                const stored = mMap.get(r.key)
                const payees = [...(payeesOf.get(r.key) ?? [])]
                return (
                  <tr key={r.key} className={selected.has(r.key) ? 'bg-[#f6faf5]' : undefined}>
                    <td className="td w-8 pr-0!">
                      <input type="checkbox" className="accent-brand" checked={selected.has(r.key)} onChange={() => toggle(r.key)} aria-label={`${r.key}を選択`} />
                    </td>
                    <td className="td">
                      {renaming === r.key ? (
                        <form
                          className="flex gap-1"
                          onSubmit={(e) => {
                            e.preventDefault()
                            rename(r.key)
                          }}
                        >
                          <input className="input w-[150px] py-1.5!" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} list="merchant-names" aria-label="新しい店舗名" />
                          <button className="control control-primary py-1.5!">保存</button>
                          <button type="button" className="control py-1.5!" onClick={() => setRenaming(null)}>
                            取消
                          </button>
                        </form>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button className="border-0 bg-transparent p-0 text-left text-xs font-bold text-ink hover:text-brand" onClick={() => onMerchant(r.key)}>
                            {r.key}
                          </button>
                          <button
                            className="border-0 bg-transparent p-0 text-[10px] text-faint hover:text-brand"
                            onClick={() => {
                              setRenaming(r.key)
                              setNewName(r.key)
                            }}
                          >
                            名前変更・統合
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="td max-w-[220px] text-[11px] text-faint">
                      <span className="line-clamp-2">{payees.join('、')}</span>
                    </td>
                    <td className="td">
                      <select
                        className="select py-1.5!"
                        aria-label={`${r.key}のカテゴリ`}
                        value={stored?.manual ? stored.categoryId : ''}
                        onChange={(e) => setMerchantCategory(r.key, e.target.value)}
                      >
                        <option value="">自動（{data.catMap.get(autoCategory(data, r.key, payees))?.name ?? '未分類'}）</option>
                        {data.categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="td text-right tabular-nums">{r.count}回</td>
                    <td className="td text-right font-bold tabular-nums">{yen(r.amount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <datalist id="merchant-names">
            {rows.map((r) => (
              <option key={r.key} value={r.key} />
            ))}
          </datalist>
        </div>
      )}
      {shown.length > limit && (
        <button className="control mt-3" onClick={() => setLimit((l) => l + 50)}>
          さらに表示（残り{shown.length - limit}店舗）
        </button>
      )}
      <p className="caption mt-3">
        左端のチェックで複数の店舗を選び、まとめてカテゴリを設定できます（見出しのチェックで表示中の店舗をすべて選択）。
        「名前変更・統合」で既存の店舗名を入力すると、その店舗に統合されます。
      </p>
    </div>
  )
}

/** 手動設定をしない場合に適用されるカテゴリ（ユーザーのカテゴリルール・組み込みルールによる推定） */
function autoCategory(data: SpendlyData, merchant: string, payees: string[]) {
  return (
    payees.map((p) => resolveMerchant(p, data.rules)).map((r) => r.ruleCategory ?? r.builtinCategory).find(Boolean) ??
    builtinCategoryOf(merchant) ??
    UNCATEGORIZED
  )
}

function CategoriesTab({ data }: { data: SpendlyData }) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(DEFAULT_EMOJI)
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of data.txs) if (isSpending(t)) m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + 1)
    return m
  }, [data.txs])
  const palette = [...new Set([...data.categories.map((c) => c.color), ...EXTRA_COLORS])]

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n || data.categories.some((c) => c.name === n)) return
    const order = Math.max(0, ...data.categories.filter((c) => c.id !== UNCATEGORIZED).map((c) => c.order)) + 1
    const used = new Set(data.categories.map((c) => c.color))
    await db.categories.add({ id: newId(), name: n, color: EXTRA_COLORS.find((c) => !used.has(c)) ?? EXTRA_COLORS[0], emoji, order })
    setName('')
    setEmoji(DEFAULT_EMOJI)
  }

  const remove = async (id: string, label: string) => {
    if (!confirm(`カテゴリ「${label}」を削除しますか？\nこのカテゴリの店舗・取引は自動判定（判定できない場合は未分類）に戻ります。`)) return
    await deleteCategory(db, id)
  }

  return (
    <div className="card">
      <div className="cardhead flex-wrap">
        <h2>カテゴリ</h2>
        <form className="flex gap-2" onSubmit={add}>
          <EmojiPicker value={emoji} onChange={setEmoji} label="新しいカテゴリの絵文字" />
          <input className="input w-[180px]" placeholder="新しいカテゴリ名" aria-label="新しいカテゴリ名" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="control control-primary" disabled={!name.trim()}>
            追加
          </button>
        </form>
      </div>
      {data.categories.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft py-[10px]">
          <EmojiPicker value={c.emoji || DEFAULT_EMOJI} onChange={(e) => db.categories.update(c.id, { emoji: e })} label={`${c.name}の絵文字`} />
          {c.id === UNCATEGORIZED ? (
            <span className="w-[180px] px-[11px] text-xs">{c.name}</span>
          ) : (
            <input
              className="input w-[180px] py-1.5!"
              defaultValue={c.name}
              aria-label="カテゴリ名"
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== c.name) db.categories.update(c.id, { name: v })
                else e.target.value = c.name
              }}
            />
          )}
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`${c.name}の色`}>
            {palette.map((col) => (
              <button
                key={col}
                role="radio"
                aria-checked={c.color === col}
                aria-label={col}
                onClick={() => db.categories.update(c.id, { color: col })}
                className={`h-5 w-5 rounded-md border-2 ${c.color === col ? 'border-ink' : 'border-transparent'}`}
                style={{ background: col }}
              />
            ))}
          </div>
          <span className="caption ml-auto">{counts.get(c.id) ?? 0}回</span>
          {c.id !== UNCATEGORIZED && (
            <button className="border-0 bg-transparent text-[11px] text-faint hover:text-up" onClick={() => remove(c.id, c.name)}>
              削除
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function RulesTab({ data, initialPattern }: { data: SpendlyData; initialPattern: string }) {
  const [pattern, setPattern] = useState(initialPattern)
  const [match, setMatch] = useState<'contains' | 'exact'>('contains')
  const [categoryId, setCategoryId] = useState('')
  const [merchant, setMerchant] = useState('')
  const spend = useMemo(() => data.txs.filter(isSpending), [data.txs])
  const merchantNames = useMemo(() => [...new Set(spend.map((t) => t.merchant))].sort((a, b) => a.localeCompare(b, 'ja')), [spend])
  const pairs = useMemo(() => {
    const seen = new Map<string, { payee: string; merchant: string }>()
    for (const t of spend) seen.set(`${t.payee}\u001f${t.merchant}`, { payee: t.payee, merchant: t.merchant })
    return [...seen.values()]
  }, [spend])
  const preview = useMemo(() => {
    if (!matchKey(pattern)) return []
    const names = new Set(merchantsMatching(pattern, match, pairs))
    return byMerchant(spend.filter((t) => names.has(t.merchant)))
  }, [pattern, match, pairs, spend])
  const mMap = useMemo(() => new Map(data.merchants.map((m) => [m.name, m])), [data.merchants])
  const manualInPreview = preview.filter((r) => mMap.get(r.key)?.manual).length
  const catName = (id?: string) => (id ? (data.catMap.get(id)?.name ?? '（削除済み）') : '—')

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pattern.trim() || (!categoryId && !merchant.trim())) return
    await db.merchantRules.add({
      id: newId(),
      pattern: pattern.trim(),
      match,
      ...(merchant.trim() ? { merchant: merchant.trim() } : {}),
      ...(categoryId ? { categoryId } : {}),
      createdAt: new Date().toISOString(),
    })
    setPattern('')
    setMerchant('')
    setCategoryId('')
  }

  return (
    <div className="card">
      <div className="cardhead">
        <div>
          <h2>ルール（カテゴリ・店舗名）</h2>
          <p className="meta">
            取引先名・店舗名にキーワードを含む店舗へ、カテゴリや統合後の店舗名を設定します。取り込み済みの取引にも、今後取り込む取引にも適用されます。元の取引先名は変更されません。
          </p>
        </div>
      </div>
      <form className="mb-4 rounded-[9px] bg-mini p-3 text-xs" onSubmit={add}>
        <div className="flex flex-wrap items-center gap-2">
          取引先名・店舗名が
          <input className="input w-[160px] py-1.5!" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="例: 焼肉" aria-label="キーワード" />
          <select className="select py-1.5!" value={match} onChange={(e) => setMatch(e.target.value as 'contains' | 'exact')} aria-label="一致条件">
            <option value="contains">を含む</option>
            <option value="exact">と一致</option>
          </select>
          場合、カテゴリを
          <select className="select py-1.5!" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="設定するカテゴリ">
            <option value="">変更しない</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          にする
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-faint">店舗名もまとめる場合（任意）</span>
          <input className="input w-[160px] py-1.5!" value={merchant} onChange={(e) => setMerchant(e.target.value)} list="rule-merchants" placeholder="統合後の店舗名" aria-label="統合後の店舗名" />
          <datalist id="rule-merchants">
            {merchantNames.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button className="control control-primary ml-auto py-1.5!" disabled={!pattern.trim() || (!categoryId && !merchant.trim())}>
            ルールを追加
          </button>
        </div>
        {pattern.trim() && (
          <div className="mt-3 border-t border-line pt-2">
            <span className="caption">
              該当する店舗: {preview.length}件{preview.length > 0 && ` ・ ${preview.reduce((a, r) => a + r.count, 0)}回 ・ ${yen(preview.reduce((a, r) => a + r.amount, 0))}`}
              {manualInPreview > 0 && `（うち${manualInPreview}店舗は手動設定が優先されます）`}
            </span>
            {preview.length > 0 && (
              <ul className="m-0 mt-1 flex list-none flex-wrap gap-1 p-0">
                {preview.slice(0, 30).map((r) => (
                  <li key={r.key} className="rounded-md bg-white px-2 py-0.5 text-[11px]">
                    {r.key} <span className="text-faint">{catName(r.categoryId)}</span>
                  </li>
                ))}
                {preview.length > 30 && <li className="px-1 text-[11px] text-faint">ほか{preview.length - 30}店舗</li>}
              </ul>
            )}
          </div>
        )}
      </form>
      {data.rules.length === 0 ? (
        <NoRows text="ルールはありません（組み込みルールで自動分類しています）" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse">
            <thead>
              <tr>
                <th className="th">キーワード</th>
                <th className="th">条件</th>
                <th className="th">カテゴリ</th>
                <th className="th">店舗名</th>
                <th className="th text-right!">該当</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {[...data.rules]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((r) => (
                  <tr key={r.id}>
                    <td className="td">{r.pattern}</td>
                    <td className="td text-faint">{r.match === 'exact' ? '一致' : '含む'}</td>
                    <td className="td">{r.categoryId ? <span className="tag">{catName(r.categoryId)}</span> : <span className="text-faint">—</span>}</td>
                    <td className="td font-bold">{r.merchant ?? <span className="font-normal text-faint">—</span>}</td>
                    <td className="td text-right text-faint tabular-nums">{merchantsMatching(r.pattern, r.match, pairs).length}店舗</td>
                    <td className="td text-right">
                      <button className="border-0 bg-transparent text-[11px] text-faint hover:text-up" onClick={() => db.merchantRules.delete(r.id)}>
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="caption mt-3">「一致」のルールが「含む」より優先され、同じ条件では新しいルールが優先されます。店舗ごと・取引ごとの手動設定はルールより優先されます。</p>
        </div>
      )}
    </div>
  )
}
