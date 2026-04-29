import { useState } from 'react'
import { useQuery } from '../hooks/useApi'
import { tasksApi } from '../api'
import TaskDetail from '../components/TaskDetail'
import { CategorySidebar } from './TasksPage'
import { Archive, ChevronRight } from 'lucide-react'
import type { Task } from '../types'

function timeRatioDot(task: Task) {
  const est = task.estimatedMinutes ?? 0
  const act = task.actualMinutes ?? 0
  if (est <= 0 || act <= 0) return null
  const ratio = (act - est) / est
  if (ratio <= -0.05) return { color: 'bg-emerald-500', label: '省时' }
  if (ratio >= 0.05) return { color: 'bg-red-500', label: '超时' }
  return { color: 'bg-purple-500', label: '准时' }
}

function fmtPct(task: Task) {
  const est = task.estimatedMinutes ?? 0
  const act = task.actualMinutes ?? 0
  if (est <= 0) return act > 0 ? `实际 ${act}m` : null
  return `${Math.round((act / est) * 100)}%（${act}m / ${est}m）`
}

function ArchiveTaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const dot = timeRatioDot(task)
  const pct = fmtPct(task)

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-3 py-2.5 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all group"
    >
      {dot ? (
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot.color}`} title={dot.label} />
      ) : (
        <span className="w-2 h-2 rounded-full shrink-0 bg-slate-200" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-700 truncate">{task.title}</p>
        {pct && <p className="text-xs text-slate-400 mt-0.5">{pct}</p>}
      </div>
      {task.deadline && (
        <span className="text-xs text-slate-400 shrink-0">{task.deadline}</span>
      )}
      <ChevronRight size={14} className="text-slate-300 group-hover:text-indigo-400 shrink-0 transition-colors" />
    </div>
  )
}

export default function ArchivePage() {
  const [selectedCat, setSelectedCat] = useState<string | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const { data: tasks = [], loading, error } = useQuery('tasks', tasksApi.list)

  const archived = tasks.filter(t => {
    if (t.status !== 'done') return false
    if (selectedCat) return t.categoryId === selectedCat
    return true
  })

  if (viewingId) {
    return (
      <div className="flex h-full">
        <CategorySidebar selectedCat={selectedCat} onSelect={id => { setSelectedCat(id); setViewingId(null) }} />
        <TaskDetail taskId={viewingId} onBack={() => setViewingId(null)} />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <CategorySidebar selectedCat={selectedCat} onSelect={setSelectedCat} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white">
          <h1 className="text-sm font-semibold text-slate-800">归档</h1>
          {archived.length > 0 && (
            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">
              {archived.length}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-auto p-4">
          {!!error && <p className="text-sm text-red-500 mb-4">加载失败，请刷新重试</p>}

          {loading && (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && archived.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <Archive size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">暂无已归档任务</p>
            </div>
          )}

          <div className="space-y-2 max-w-2xl">
            {archived.map(t => (
              <ArchiveTaskRow key={t.id} task={t} onClick={() => setViewingId(t.id)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
