import { pct, yen } from '../lib/format'

export interface BarItem {
  key: string
  label: string
  amount: number
  color: string
  share?: number
  note?: string
}

/** モックの横棒リスト（.bars）。onSelect があれば行を選択可能にする */
export function Bars({ items, onSelect }: { items: BarItem[]; onSelect?: (key: string) => void }) {
  const max = Math.max(1, ...items.map((i) => i.amount))
  return (
    <div>
      {items.map((it) => (
        <button
          key={it.key}
          disabled={!onSelect}
          onClick={() => onSelect?.(it.key)}
          className="flex w-full items-center gap-3 border-0 bg-transparent px-[2px] py-[11px] text-left transition-colors duration-150 enabled:hover:bg-[#f6f8f4]"
        >
          <span className="w-[92px] shrink-0 sm:w-[124px]">
            <span className="block truncate text-xs">{it.label}</span>
            {it.note && <span className="block text-[10px] text-faint">{it.note}</span>}
          </span>
          <span className="h-[14px] flex-1 overflow-hidden rounded bg-bar-track">
            <span
              className="block h-full rounded transition-[width] duration-300 ease-out"
              style={{ width: `${(it.amount / max) * 100}%`, background: it.color }}
            />
          </span>
          <span className="w-[78px] shrink-0 text-right text-xs font-bold tabular-nums sm:w-[85px]">{yen(it.amount)}</span>
          {it.share != null && <span className="w-[42px] shrink-0 text-right text-[11px] text-faint tabular-nums">{pct(it.share)}</span>}
        </button>
      ))}
    </div>
  )
}
