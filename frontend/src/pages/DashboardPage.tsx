import { useQuery, useMutation, invalidate } from '../hooks/useApi'
import { tasksApi, recommendApi, statsApi } from '../api'
import { ProgressBar, StatusBadge } from '../components/ui'
import type { Task, Recommendation } from '../types'
import { Play, Pause, CheckCircle, Clock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

function fmtMinutes(m: number) {
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}

function InProgressCard({ task, onNavigate }: { task: Task; onNavigate: (id: string) => void }) {
  const refresh = () => { invalidate('tasks') }
  const pause = useMutation(() => tasksApi.action(task.id, 'pause'), { onSuccess: refresh })
  const complete = useMutation(() => tasksApi.action(task.id, 'complete'), { onSuccess: refresh })

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-3">
        <button
          onClick={() => onNavigate(task.id)}
          className="flex-1 text-left min-w-0"
        >
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge status={task.status} />
            <span className="text-xs text-slate-400">P{task.manualPriority}</span>
          </div>
          <h2 className="text-base font-semibold text-slate-800 hover:text-indigo-600 transition-colors">{task.title}</h2>
        </button>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => pause.mutate(undefined)}
            disabled={pause.pending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <Pause size={13} /> 暂停
          </button>
          <button
            onClick={() => complete.mutate(undefined)}
            disabled={complete.pending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors"
          >
            <CheckCircle size={13} /> 完成
          </button>
        </div>
      </div>

      <ProgressBar value={task.progress} />
      <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
        <span className="flex items-center gap-1"><Clock size={11} /> 估时 {fmtMinutes(task.estimatedMinutes)}</span>
        <span>实际 {fmtMinutes(task.actualMinutes)}</span>
        <span>{Math.round(task.progress)}%</span>
      </div>
    </div>
  )
}

function RecommendCard({ rec, onNavigate }: { rec: Recommendation; onNavigate: (id: string) => void }) {
  const { task, category, score } = rec
  const start = useMutation(
    () => tasksApi.action(task.id, 'start'),
    { onSuccess: () => { invalidate('tasks'); invalidate('recommendations') } }
  )

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3 min-w-0">
      <button onClick={() => onNavigate(task.id)} className="flex-1 text-left min-w-0">
        <p className="text-base font-semibold text-slate-800 line-clamp-2 mb-1 hover:text-indigo-600 transition-colors">{task.title}</p>
        <p className="text-xs text-slate-400">{category.name}</p>
      </button>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-600">P{task.manualPriority}</span>
          {task.estimatedMinutes > 0 && <span>{fmtMinutes(task.estimatedMinutes)}</span>}
          {task.deadline && <span>{task.deadline}</span>}
        </div>
        <span className="text-indigo-400 font-medium">{(score * 100).toFixed(0)}分</span>
      </div>
      <button
        onClick={() => start.mutate(undefined)}
        disabled={start.pending || task.status === 'in_progress'}
        className="flex items-center justify-center gap-1.5 w-full py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-50"
      >
        <Play size={12} /> {task.status === 'in_progress' ? '进行中' : '开始'}
      </button>
    </div>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { data: tasks = [] } = useQuery('tasks', tasksApi.list)
  const { data: recommendations = [] } = useQuery('recommendations', recommendApi.byCategory)
  const { data: stats } = useQuery('stats', statsApi.overview)

  const inProgress = tasks.filter(t => t.status === 'in_progress')
  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
  const goToTask = (id: string) => navigate(`/app/tasks/${id}`)

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-800">今日</h1>
        <p className="text-sm text-slate-400">{today}</p>
      </div>

      {inProgress.length > 0 ? (
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">当前进行中</h2>
          <div className="space-y-3">
            {inProgress.map(t => <InProgressCard key={t.id} task={t} onNavigate={goToTask} />)}
          </div>
        </section>
      ) : (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-6 text-center text-sm text-slate-400">
          暂无进行中的任务，从下方推荐中选一个开始吧
        </div>
      )}

      {recommendations.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">各分类推荐</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recommendations.map(rec => (
              <RecommendCard key={rec.category.id} rec={rec} onNavigate={goToTask} />
            ))}
          </div>
        </section>
      )}

      {stats && (
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">今日摘要</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: '今日用时', value: fmtMinutes(stats.dailyMinutes) },
              { label: '本周用时', value: fmtMinutes(stats.weeklyMinutes) },
              { label: '完成率', value: `${Math.round(stats.completionRate * 100)}%` },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white border border-slate-200 rounded-xl p-4 text-center">
                <p className="text-xl font-semibold text-slate-800">{value}</p>
                <p className="text-xs text-slate-400 mt-1">{label}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
