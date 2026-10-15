/** 値が変わったときだけ控えめにフェードする数値表示 */
export function Num({ children, className = '' }: { children: string; className?: string }) {
  return (
    <span key={children} className={`inline-block motion-safe:animate-fade ${className}`}>
      {children}
    </span>
  )
}
