import type { View } from '../state'

const ITEMS: { view: View; icon: string; label: string; short: string }[] = [
  { view: 'dashboard', icon: '▦', label: 'ダッシュボード', short: 'ホーム' },
  { view: 'analysis', icon: '◫', label: '詳細分析', short: '分析' },
  { view: 'transactions', icon: '≡', label: '取引一覧', short: '取引' },
  { view: 'manage', icon: '◇', label: '店舗・カテゴリ', short: '分類' },
  { view: 'data', icon: '⇅', label: '明細・データ', short: 'データ' },
]

interface Props {
  view: View
  onNavigate: (v: View) => void
  txCount: number
  badge: Partial<Record<View, number>>
}

export function Sidebar({ view, onNavigate, txCount, badge }: Props) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[65px] shrink-0 flex-col gap-10 border-r border-side-line bg-side px-2 py-5 sm:flex md:w-[206px] md:px-4 md:py-[29px]">
      <div className="flex items-center gap-[10px] text-xl font-extrabold">
        <span className="rounded-[10px] bg-brand px-[10px] py-[6px] text-white" aria-hidden>
          ◈
        </span>
        <span className="hidden md:inline">
          Spendly All
          <small className="block text-[9px] font-medium tracking-[1px] text-[#829087]">ALL ACCOUNTS</small>
        </span>
      </div>
      <nav className="grid gap-[5px]" aria-label="メイン">
        {ITEMS.map((it) => (
          <button
            key={it.view}
            onClick={() => onNavigate(it.view)}
            aria-current={view === it.view ? 'page' : undefined}
            title={it.label}
            className={`relative rounded-[9px] border-0 p-3 text-center transition-colors duration-150 md:text-left ${
              view === it.view ? 'bg-nav-active font-bold text-brand' : 'bg-transparent text-nav-text hover:bg-[#e6ebe3]'
            }`}
          >
            {it.icon} <span className="hidden md:inline">{it.label}</span>
            {!!badge[it.view] && (
              <span className="absolute top-1.5 right-1.5 rounded-full bg-warn-bg px-1.5 text-[10px] font-bold text-warn-text md:top-1/2 md:right-2 md:-translate-y-1/2">
                {badge[it.view]}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="mt-auto hidden text-[11px] leading-relaxed text-[#819084] md:block">
        {txCount > 0 ? `${txCount.toLocaleString('ja-JP')}件の取引を保存中` : '取引データなし'}
        <br />
        データはこの端末内にのみ保存
      </div>
    </aside>
  )
}

export function MobileNav({ view, onNavigate }: Omit<Props, 'txCount' | 'badge'>) {
  return (
    <nav
      className="fixed right-0 bottom-0 left-0 z-10 grid grid-cols-5 border-t border-th-line bg-white pb-[env(safe-area-inset-bottom)] sm:hidden"
      aria-label="メイン"
    >
      {ITEMS.map((it) => (
        <button
          key={it.view}
          onClick={() => onNavigate(it.view)}
          aria-current={view === it.view ? 'page' : undefined}
          className={`border-0 bg-white px-1 py-[14px] text-xs ${view === it.view ? 'font-bold text-brand' : 'text-[#718277]'}`}
        >
          {it.icon} {it.short}
        </button>
      ))}
    </nav>
  )
}
