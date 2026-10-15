import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { monthLabel, shortMonthLabel } from '../lib/analytics'
import { yen } from '../lib/format'
import { useReducedMotion } from '../hooks/useReducedMotion'

interface Point {
  month: string
  amount: number
  count: number
}

interface Props {
  data: Point[]
  selected?: string | null
  onSelect?: (month: string) => void
  height?: number
  color?: string
}

const axisTick = { fontSize: 11, fill: '#94a198' }
const compactYen = (v: number) => (v >= 10000 ? `${Math.round(v / 1000) / 10}万` : v.toLocaleString('ja-JP'))

export function MonthlyChart({ data, selected, onSelect, height = 190, color = '#397d59' }: Props) {
  const reduced = useReducedMotion()
  const gradId = `shade-${color.slice(1)}`
  const multiYear = new Set(data.map((d) => d.month.slice(0, 4))).size > 1
  const tickLabel = (m: string) => (multiYear && m.endsWith('-01') ? `${m.slice(2, 4)}/1月` : shortMonthLabel(m))
  return (
    <div style={{ height }} role="img" aria-label={`月別支出の折れ線グラフ（${data.length}か月）`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 12, bottom: 0, left: 0 }}
          onClick={(e) => {
            const i = e?.activeTooltipIndex
            if (onSelect && i != null && data[Number(i)]) onSelect(data[Number(i)].month)
          }}
          style={{ cursor: onSelect ? 'pointer' : undefined }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop stopColor={color === '#397d59' ? '#78ac86' : color} stopOpacity={0.22} />
              <stop offset="1" stopColor={color === '#397d59' ? '#78ac86' : color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#e8eee7" />
          <XAxis dataKey="month" tickFormatter={tickLabel} tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
          <YAxis tickFormatter={compactYen} tick={axisTick} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            cursor={{ stroke: '#cfdacd' }}
            content={({ active, payload }) => {
              const p = active && payload?.[0]?.payload as Point | undefined
              if (!p) return null
              return (
                <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-sm">
                  <div className="text-faint">{monthLabel(p.month)}</div>
                  <div className="mt-0.5 font-bold tabular-nums">{yen(p.amount)}</div>
                  <div className="text-faint">{p.count}回</div>
                </div>
              )
            }}
          />
          <Area
            type="linear"
            dataKey="amount"
            stroke={color}
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill={`url(#${gradId})`}
            isAnimationActive={!reduced}
            animationDuration={300}
            dot={(props: { cx?: number; cy?: number; payload?: Point; index?: number }) => (
              <circle
                key={props.index}
                cx={props.cx}
                cy={props.cy}
                r={props.payload?.month === selected ? 5 : data.length > 18 ? 0 : 3}
                fill={color}
                stroke="white"
                strokeWidth={2}
              />
            )}
            activeDot={{ r: 5, fill: color, stroke: 'white', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
