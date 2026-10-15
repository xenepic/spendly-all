import { useCallback, useEffect, useState } from 'react'

// PayPay版（Spendly）と同じオリジンで動かしても選択状態が混ざらないよう、接頭辞を分けている
const PREFIX = 'spendly-all:ui:'

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(PREFIX + key)
    return v == null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

/** 画面の選択状態（タブ・チェック・並び順など）を画面切り替えや再読み込み後も保持する */
export function usePersistentState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback))
  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      // 保存できない環境（プライベートモード等）では保持しない
    }
  }, [key, value])
  const set = useCallback((v: T | ((prev: T) => T)) => setValue(v), [])
  return [value, set] as const
}

/** 保存した画面の選択状態をすべて消去する（反映には再読み込みが必要） */
export function clearPersistentState() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k)
  } catch {
    // 消去できない環境では何もしない
  }
}
