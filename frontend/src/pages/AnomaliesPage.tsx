import { useQuery, useMutation, invalidate } from '../hooks/useApi'
import { tasksApi } from '../api'
import type { AnomalyFlag } from '../types'
import { AlertTriangle, Eye } from 'lucide-react'
import { useState } from 'react'
import TaskDetail from '../components/TaskDetail'

const flagLabels: Record<AnomalyFlag, string> = {
  postponed: '已推迟',
  checkpoint_skipped: '跳过检查点',
}
const flagStyles: Record<AnomalyFlag, string> = {
  postponed: 'bg-orange-100 text-orange-600',
  checkpoint_skipped: 'bg-yellow-100 text-yellow-600',
}

export default function AnomaliesPage() {
  const [viewingId, setViewingId] = useState<string | null>(null)
  const { data: anomalies = [], loading, error } = useQuery('anomalies', tasksApi.anomalies)

  const ignore = useMutation(
    (id: string) => tasksApi.anomalyIgnore(id, true),
    { onSuccess: () => { invalidate('anomalies'); invalidate('tasks') } }
  )

  if (viewingId) {
    return (
      <div className="flex flex-col h-full">
        <TaskDetail taskId={viewingId} onBack={() => setViewingId(null)} />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-slate-800">异常任务</h1>
        {anomalies.length > 0 && (
          <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">
            {anomalies.length}
          </span>
        )}
      </div>

      {!!error && (
        <p className="text-sm text-red-500">加载失败，请刷新重试</p>
      )}

      {loading && (
        <div className="flex justify-center py-8">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && anomalies.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <AlertTriangle size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">暂无异常任务</p>
        </div>
      )}

      <div className="space-y-3">
        {anomalies.map(task => (
          <div key={task.id} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 mb-2">{task.title}</p>
                <div className="flex flex-wrap gap-1.5">
                  {task.anomalyFlags.map(flag => (
                    <span key={flag} className={`text-xs px-2 py-0.5 rounded-full font-medium ${flagStyles[flag]}`}>
                      {flagLabels[flag]}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setViewingId(task.id)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  <Eye size={12} /> 查看
                </button>
                <button
                  onClick={() => ignore.mutate(task.id)}
                  disabled={ignore.pending}
                  className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  忽略
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
