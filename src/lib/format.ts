export const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`

export const signedYen = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '±') + yen(Math.abs(n))

export const pct = (ratio: number, digits = 1) => `${(ratio * 100).toFixed(digits)}%`

export const signedPct = (ratio: number | null, digits = 1) =>
  ratio == null ? '—' : `${ratio > 0 ? '+' : ratio < 0 ? '−' : '±'}${Math.abs(ratio * 100).toFixed(digits)}%`

/** 'yyyy-MM-ddTHH:mm' → '2026/09/30 12:05' */
export const dateTime = (iso: string) => `${iso.slice(0, 10).replaceAll('-', '/')} ${iso.slice(11, 16)}`
