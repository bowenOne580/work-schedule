import { useState, useEffect } from 'react'
import { useQuery } from '../hooks/useApi'
import { statsApi, categoriesApi, type StatRange } from '../api'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid,
} from 'recharts'

// 优先级完成分布（饼图）配色，P1 深 → P5 浅：
// 「温度计」语义（紧急=热）：烫红/热橙/温黄/凉绿/冷蓝，五档色相全开、一眼可辨。
const PIE_COLORS = ['#B91C1C', '#EA580C', '#F59E0B', '#10B981', '#0EA5E9']

function fmtMinutes(m: number) {
  if (!m) return '0m'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}

function fmtPercent(v: number | null) {
  if (v === null) return '—'
  return `${Math.round(v * 100)}%`
}

function fmtOverdue(v: number | null) {
  if (v === null) return '—'
  const pct = Math.round(v * 100)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}

const RANGE_OPTIONS: { value: StatRange; label: string }[] = [
  { value: 'week', label: '近 7 天' },
  { value: 'month', label: '近 30 天' },
  { value: 'all', label: '全部' },
  { value: 'custom', label: '自定义' },
]

function localTodayStr() {
  const d = new Date()
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ---- 趋势图粒度自适应 + 横向滚动（stats-range-filter-plan.md 第 11 节）----

type TrendGranularity = 'day' | 'week' | 'month'

// 范围天数 → 粒度：≤31 天用天；≤62 天用周（对齐周一）；更长用月（对齐月初）
function pickTrendGranularity(days: number): TrendGranularity {
  if (days <= 31) return 'day'
  if (days <= 62) return 'week'
  return 'month'
}

// 周桶返回周一日期（YYYY-MM-DD），月桶返回 YYYY-MM
function trendBucketKey(dateKey: string, g: TrendGranularity): string {
  if (g === 'month') return dateKey.slice(0, 7)
  if (g === 'week') {
    const d = new Date(`${dateKey}T00:00:00`)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    const pad = (x: number) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  return dateKey
}

function aggregateTrend(history: { dateKey: string; minutes: number }[]): {
  granularity: TrendGranularity
  points: { label: string; full: string; minutes: number }[]
} {
  const granularity = pickTrendGranularity(history.length)
  if (granularity === 'day') {
    return {
      granularity,
      points: history.map(h => ({ label: h.dateKey.slice(5), full: h.dateKey, minutes: h.minutes })),
    }
  }
  // dailyHistory 连续且升序，按首现顺序聚合即保持时间轴
  const order: string[] = []
  const sums = new Map<string, number>()
  for (const h of history) {
    const key = trendBucketKey(h.dateKey, granularity)
    if (!sums.has(key)) {
      sums.set(key, 0)
      order.push(key)
    }
    sums.set(key, (sums.get(key) ?? 0) + h.minutes)
  }
  return {
    granularity,
    points: order.map(key => ({
      label: granularity === 'month' ? key : key.slice(5),
      full: granularity === 'month' ? key : `${key} 当周`,
      minutes: sums.get(key) ?? 0,
    })),
  }
}

// 桶数超过阈值启用横向滚动：视口内恰好显示阈值个桶（列宽 = 视口宽 / 阈值），其余靠滚动
const TREND_SCROLL_THRESHOLD = 7
const CATEGORY_SCROLL_THRESHOLD = 5

// 测量滚动视口宽度，用于按视口/阈值计算列宽。
// 用 callback ref 存节点：图表 div 在数据加载后才挂载（冷加载时组件先渲染 spinner），
// 若在挂载时用空依赖 effect 读 ref.current 会拿到 null、永远测不到宽度。
function useElementWidth<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!node) return
    setWidth(node.clientWidth)
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) setWidth(entry.contentRect.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return [setNode, width] as const
}

export default function StatsPage() {
  const [range, setRange] = useState<StatRange>('week')
  const [customFrom, setCustomFrom] = useState(localTodayStr())
  const [customTo, setCustomTo] = useState(localTodayStr())
  const todayStr = localTodayStr()

  // 结束日期不允许未来（与后端 clamp 一致）；起始日期超出结束日期时把结束日期一起推过去
  const clampToToday = (v: string) => (v > todayStr ? todayStr : v)
  const changeFrom = (v: string) => {
    const from = clampToToday(v)
    setCustomFrom(from)
    if (from > customTo) setCustomTo(from)
  }
  const customReady = range !== 'custom' || customFrom <= customTo
  const rangeKey = range === 'custom' ? `custom:${customFrom}:${customTo}` : range

  // 每个范围各占一条 30s 缓存；切换时保留旧数据占位，避免整页闪烁
  const { data: stats, loading, error } = useQuery(
    `stats:${rangeKey}`,
    () =>
      statsApi.overview(
        range === 'custom' ? { range, from: customFrom, to: customTo } : { range },
      ),
    customReady,
  )
  const { data: categories = [] } = useQuery('categories', categoriesApi.list)
  const [trendWrapRef, trendWidth] = useElementWidth<HTMLDivElement>()
  const [catWrapRef, catWidth] = useElementWidth<HTMLDivElement>()

  if (error && !stats) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-red-500">
        加载失败，请刷新重试
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]))

  // Dual-bar data: estimated vs actual per category
  const catBarData = Object.entries(stats.categoryTimeShare)
    .map(([id, v]) => ({
      name: catMap[id] ?? id,
      预计: v.estimated,
      实际: v.actual,
    }))
    .filter(d => d.预计 > 0 || d.实际 > 0)

  const priorityPieData = Object.entries(stats.doneByPriority)
    .filter(([, v]) => v > 0)
    .map(([p, v]) => ({ name: `P${p}`, value: v }))

  const overdueVal = stats.avgOverdueRatio
  const overdueColor = overdueVal === null ? 'text-slate-800' : overdueVal > 0 ? 'text-red-500' : overdueVal < 0 ? 'text-emerald-600' : 'text-slate-800'

  // Daily trend chart from backend daily history (persisted across restarts)
  const trend = aggregateTrend(stats.dailyHistory || [])
  const trendScroll = trend.points.length > TREND_SCROLL_THRESHOLD
  const trendStripMinWidth =
    trendScroll && trendWidth > 0
      ? trend.points.length * (trendWidth / TREND_SCROLL_THRESHOLD)
      : undefined
  const catScroll = catBarData.length > CATEGORY_SCROLL_THRESHOLD
  const catStripMinWidth =
    catScroll && catWidth > 0 ? catBarData.length * (catWidth / CATEGORY_SCROLL_THRESHOLD) : undefined

  const rangeLabel = RANGE_OPTIONS.find(o => o.value === range)?.label ?? ''
  const summaryCards = [
    { label: '今日用时', value: fmtMinutes(stats.dailyMinutes) },
    { label: `${rangeLabel}用时`, value: fmtMinutes(stats.rangeMinutes ?? 0) },
    { label: `${rangeLabel}完成`, value: `${stats.rangeDoneCount ?? 0} 个` },
    { label: '完成率', value: fmtPercent(stats.completionRate) },
    { label: '准时率', value: fmtPercent(stats.onTimeRate) },
    { label: '平均超时比', value: fmtOverdue(stats.avgOverdueRatio), color: overdueColor },
  ]

  return (
    <div className={`max-w-4xl mx-auto px-4 py-6 space-y-6 ${loading ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-lg font-semibold text-slate-800">统计分析</h1>
        <div className="flex items-center gap-2">
          {range === 'custom' && (
            <>
              <input
                type="date"
                value={customFrom}
                max={todayStr}
                onChange={e => changeFrom(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <span className="text-xs text-slate-400">至</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                max={todayStr}
                onChange={e => setCustomTo(clampToToday(e.target.value))}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </>
          )}
          <select
            value={range}
            onChange={e => setRange(e.target.value as StatRange)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            {RANGE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {summaryCards.map(({ label, value, color }) => (
          <div key={label} className="bg-white border border-slate-200 rounded-xl p-4 text-center">
            <p className={`text-xl font-semibold ${color ?? 'text-slate-800'}`}>{value}</p>
            <p className="text-xs text-slate-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Category dual-bar chart */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">分类用时对比</h3>
          {catBarData.length > 0 ? (
            <div className="overflow-x-auto" ref={catWrapRef}>
              <div style={catStripMinWidth ? { minWidth: catStripMinWidth } : undefined}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={catBarData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: unknown) => fmtMinutes(Number(v))} />
                    <Legend iconSize={10} formatter={v => <span style={{ fontSize: 12 }}>{v}</span>} />
                    <Bar dataKey="预计" fill="#A5B4FC" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="实际" fill="#6366F1" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400 text-center py-8">暂无数据</p>
          )}
        </div>

        {/* Priority pie chart */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">优先级完成分布</h3>
          {priorityPieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={priorityPieData}
                  cx="50%"
                  cy="45%"
                  innerRadius={45}
                  outerRadius={70}
                  dataKey="value"
                  paddingAngle={2}
                  startAngle={90}
                  endAngle={450}
                >
                  {priorityPieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Legend
                  layout="horizontal"
                  verticalAlign="bottom"
                  align="center"
                  iconSize={10}
                  formatter={(value) => <span style={{ fontSize: 12 }}>{value}</span>}
                />
                <Tooltip formatter={(v: unknown) => [`${v} 个`, '完成']} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-400 text-center py-8">暂无完成数据</p>
          )}
        </div>
      </div>

      {/* Daily trend line chart */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">每日用时趋势</h3>
        <div className="overflow-x-auto" ref={trendWrapRef}>
          <div style={trendStripMinWidth ? { minWidth: trendStripMinWidth } : undefined}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend.points} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: unknown) => [fmtMinutes(Number(v)), null] as [string, null]}
                  labelFormatter={(_, payload) =>
                    (payload?.[0]?.payload as { full?: string } | undefined)?.full ?? ''
                  }
                />
                <Line
                  type="monotone"
                  dataKey="minutes"
                  stroke="#6366F1"
                  strokeWidth={2}
                  dot={{ fill: '#6366F1', r: 4 }}
                  isAnimationActive={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
