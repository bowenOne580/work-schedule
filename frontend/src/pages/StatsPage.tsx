import { useQuery } from '../hooks/useApi'
import { statsApi, categoriesApi } from '../api'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  LineChart, Line, CartesianGrid,
} from 'recharts'

const PIE_COLORS = ['#EF4444', '#F97316', '#EAB308', '#3B82F6', '#94A3B8']

function fmtMinutes(m: number) {
  if (!m) return '0m'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}

export default function StatsPage() {
  const { data: stats } = useQuery('stats', statsApi.overview)
  const { data: categories = [] } = useQuery('categories', categoriesApi.list)

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]))

  const catBarData = Object.entries(stats.categoryTimeShare).map(([id, share]) => ({
    name: catMap[id] ?? id,
    分钟: Math.round(share * stats.weeklyMinutes),
  }))

  // Remove zero-value entries and use only entries with data
  const priorityPieData = Object.entries(stats.doneByPriority)
    .filter(([, v]) => v > 0)
    .map(([p, v]) => ({ name: `P${p}`, value: v }))

  const summaryCards = [
    { label: '今日用时', value: fmtMinutes(stats.dailyMinutes) },
    { label: '本周用时', value: fmtMinutes(stats.weeklyMinutes) },
    { label: '完成率', value: `${Math.round(stats.completionRate * 100)}%` },
    { label: '统计日期', value: stats.dateKey },
  ]

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-lg font-semibold text-slate-800">统计分析</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summaryCards.map(({ label, value }) => (
          <div key={label} className="bg-white border border-slate-200 rounded-xl p-4 text-center">
            <p className="text-xl font-semibold text-slate-800">{value}</p>
            <p className="text-xs text-slate-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Category bar chart */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">分类时间占比</h3>
          {catBarData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={catBarData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: unknown) => fmtMinutes(Number(v))} />
                <Bar dataKey="分钟" fill="#6366F1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-400 text-center py-8">暂无数据</p>
          )}
        </div>

        {/* Priority pie chart — no label prop, use Legend only to avoid overlap */}
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

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">近期用时趋势</h3>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={[{ day: stats.dateKey, 分钟: stats.dailyMinutes }]}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: unknown) => fmtMinutes(Number(v))} />
            <Line type="monotone" dataKey="分钟" stroke="#6366F1" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
        <p className="text-xs text-slate-400 text-center mt-2">后端目前仅提供当日统计，趋势图将在多日数据积累后丰富</p>
      </div>
    </div>
  )
}
