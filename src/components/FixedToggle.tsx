import { usePersistentState } from '../hooks/usePersistentState'
import { FIXED_CATEGORIES } from '../lib/categories'

export const isFixed = (t: { categoryId: string }) => FIXED_CATEGORIES.has(t.categoryId)

/** カテゴリ別の内訳に固定費（税金・公共料金・住居・通信）を含めるか（ダッシュボードと詳細分析で共有） */
export function useIncludeFixed() {
  return usePersistentState('categories.includeFixed', true)
}

export function FixedToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      title="税金・公共料金・住居・通信"
      className="flex shrink-0 items-center gap-2 border-0 bg-transparent p-0 text-[11px] text-faint hover:text-brand"
    >
      固定費を含める
      <span
        className={`relative h-[18px] w-8 rounded-full transition-colors duration-200 ${checked ? 'bg-brand' : 'bg-[#d5dad1]'}`}
        aria-hidden
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-[left] duration-200 ${checked ? 'left-[16px]' : 'left-[2px]'}`}
        />
      </span>
    </button>
  )
}
