import { useEffect, useRef, useState } from 'react'
import { EMOJI_CHOICES, firstGrapheme } from '../lib/categories'

/** 絵文字を表示するボタン。押すと候補一覧と自由入力欄を開く */
export function EmojiPicker({ value, onChange, label }: { value: string; onChange: (emoji: string) => void; label: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (emoji: string) => {
    onChange(emoji)
    setText('')
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${label}（${value}）`}
        aria-expanded={open}
        title="絵文字を選ぶ"
        className="grid h-[34px] w-[34px] place-items-center rounded-[9px] border border-line bg-white text-[17px] leading-none transition-colors duration-150 hover:bg-hover-soft"
      >
        {value}
      </button>
      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 w-[248px] rounded-xl border border-line bg-white p-2 shadow-lg motion-safe:animate-fade">
          <div className="grid grid-cols-8 gap-0.5" role="listbox" aria-label={label}>
            {EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                type="button"
                role="option"
                aria-selected={e === value}
                onClick={() => pick(e)}
                className={`grid h-7 w-7 place-items-center rounded-md border-0 text-[16px] leading-none hover:bg-hover ${
                  e === value ? 'bg-pill-active' : 'bg-transparent'
                }`}
              >
                {e}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            <input
              className="input min-w-0 flex-1 py-1.5!"
              placeholder="ほかの絵文字を入力"
              aria-label="ほかの絵文字を入力"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const g = firstGrapheme(text)
                  if (g) pick(g)
                }
              }}
            />
            <button type="button" className="control" disabled={!firstGrapheme(text)} onClick={() => pick(firstGrapheme(text))}>
              決定
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
