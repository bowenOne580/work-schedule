import { useQuery } from '../hooks/useApi'
import { statsApi, categoriesApi } from '../api'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid,
} from 'recharts'

const PIE_COLORS = ['#EF4444', '#F97316', '#EAB308', '#3B82F6', '#94A3B8']

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

export default function StatsPage() {
  const { data: stats, loading, error } = useQuery('stats', statsApi.overview)
  const { data: categories = [] } = useQuery('categories', categoriesApi.list)

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-red-500">
        加载失败，请刷新重试
      </div>
    )
  }

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]))

  // Dual-bar data: estimated vs actual per category
  const catBarData = Object.entries(stats.categoryTimeShare)
    .map(([id, v]) => {
      const entry = typeof v === 'object' ? v : { actual: Math.round((v as number) * stats.weeklyMinutes), estimated: 0 }
      return {
        name: catMap[id] ?? id,
        预计: entry.estimated,
        实际: entry.actual,
      }
    })
    .filter(d => d.预计 > 0 || d.实际 > 0)

  const priorityPieData = Object.entries(stats.doneByPriority)
    .filter(([, v]) => v > 0)
    .map(([p, v]) => ({ name: `P${p}`, value: v }))

  const overdueVal = stats.avgOverdueRatio as number | null
  const overdueColor = overdueVal === null ? 'text-slate-800' : overdueVal > 0 ? 'text-red-500' : overdueVal < 0 ? 'text-emerald-600' : 'text-slate-800'

  // Daily trend chart from backend daily history (persisted across restarts)
  const dailyTrendData = (stats.dailyHistory || []).map(h => ({
    date: h.dateKey.slice(5), // "MM-DD"
    minutes: h.minutes,
  }))

  const summaryCards = [
    { label: '今日用时', value: fmtMinutes(stats.dailyMinutes) },
    { label: '本周用时', value: fmtMinutes(stats.weeklyMinutes) },
    { label: '本周完成', value: `${stats.weeklyDoneCount ?? 0} 个` },
    { label: '完成率', value: fmtPercent(stats.completionRate) },
    { label: '准时率', value: fmtPercent(stats.onTimeRate) },
    { label: '平均超时比', value: fmtOverdue(stats.avgOverdueRatio), color: overdueColor },
  ]

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-lg font-semibold text-slate-800">统计分析</h1>

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
          <h3 className="text-sm font-semibold text-slate-700 mb-1">分类用时对比</h3>
          <p className="text-xs text-slate-400 mb-4">预计 vs 实际（分钟）</p>
          {catBarData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={catBarData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: unknown) => fmtMinutes(Number(v))} />
                <Legend iconSize={10} formatter={v => <span style={{ fontSize: 12 }}>{v}</span>} />
                <Bar dataKey="预计" fill="#A5B4FC" radius={[4, 4, 0, 0]} />
                <Bar dataKey="实际" fill="#6366F1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
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
        <h3 className="text-sm font-semibold text-slate-700 mb-1">每日用时趋势</h3>
        <p className="text-xs text-slate-400 mb-4">近 7 天（分钟）</p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={dailyTrendData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: unknown) => fmtMinutes(Number(v))} />
            <Line type="monotone" dataKey="minutes" stroke="#6366F1" strokeWidth={2} dot={{ fill: '#6366F1', r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
