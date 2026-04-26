import { useState } from 'react'
import { useQuery, useMutation, invalidate } from '../hooks/useApi'
import { tasksApi, checkpointsApi, categoriesApi } from '../api'
import { ProgressBar, StatusBadge } from './ui'
import type { Task, TaskAction } from '../types'
import { ArrowLeft, Plus, Check, SkipForward, RotateCcw, Trash2 } from 'lucide-react'

function fmtMinutes(m: number) {
  if (!m) return '—'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}

const ACTION_LABELS: Record<string, string> = {
  start: '开始', pause: '暂停', resume: '继续', complete: '完成', postpone: '推迟',
}
const ACTION_STYLES: Record<string, string> = {
  start: 'bg-indigo-500 hover:bg-indigo-600 text-white',
  pause: 'bg-amber-100 hover:bg-amber-200 text-amber-700',
  resume: 'bg-blue-500 hover:bg-blue-600 text-white',
  complete: 'bg-emerald-500 hover:bg-emerald-600 text-white',
  postpone: 'bg-slate-100 hover:bg-slate-200 text-slate-600',
}

function availableActions(status: Task['status']): TaskAction[] {
  switch (status) {
    case 'todo': return ['start']
    case 'in_progress': return ['pause', 'complete', 'postpone']
    case 'paused': return ['resume', 'complete', 'postpone']
    case 'done': return []
  }
}

interface Props {
  taskId: string
  onBack: () => void
}

export default function TaskDetail({ taskId, onBack }: Props) {
  const [editTitle, setEditTitle] = useState(false)
  const [titleVal, setTitleVal] = useState('')
  const [newCpTitle, setNewCpTitle] = useState('')
  const [newCpMinutes, setNewCpMinutes] = useState('')
  const [addingCp, setAddingCp] = useState(false)

  // Single fetch — backend embeds checkpoints in GET /api/tasks/:id
  const { data: task, loading } = useQuery(`task:${taskId}`, () => tasksApi.get(taskId))
  const { data: categories = [] } = useQuery('categories', categoriesApi.list)

  const refresh = () => {
    invalidate(`task:${taskId}`)
    invalidate('tasks')
  }

  const updateTask = useMutation(
    (body: Partial<Task>) => tasksApi.update(taskId, body),
    { onSuccess: refresh }
  )
  const doAction = useMutation(
    (action: TaskAction) => tasksApi.action(taskId, action),
    { onSuccess: refresh }
  )
  const addCheckpoint = useMutation(
    () => checkpointsApi.create(taskId, {
      title: newCpTitle,
      order: (task?.checkpoints?.length ?? 0) + 1,
      estimatedMinutes: newCpMinutes ? Number(newCpMinutes) : 0,
    }),
    { onSuccess: () => { setNewCpTitle(''); setNewCpMinutes(''); setAddingCp(false); refresh() } }
  )
  const completeCheckpoint = useMutation(
    (id: string) => checkpointsApi.complete(id),
    { onSuccess: refresh }
  )
  const skipCheckpoint = useMutation(
    (id: string) => checkpointsApi.skip(id),
    { onSuccess: refresh }
  )
  const uncompleteCheckpoint = useMutation(
    (id: string) => checkpointsApi.uncomplete(id),
    { onSuccess: refresh }
  )
  const deleteCheckpoint = useMutation(
    (id: string) => checkpointsApi.delete(id),
    { onSuccess: refresh }
  )

  if (loading || !task) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const checkpoints = (task.checkpoints ?? []).slice().sort((a, b) => a.order - b.order)
  const actions = availableActions(task.status)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 z-10">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft size={16} /> 返回列表
        </button>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Title */}
        <div>
          {editTitle ? (
            <input
              autoFocus
              value={titleVal}
              onChange={e => setTitleVal(e.target.value)}
              onBlur={() => {
                if (titleVal.trim() && titleVal !== task.title) {
                  updateTask.mutate({ title: titleVal.trim() })
                }
                setEditTitle(false)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setEditTitle(false)
              }}
              className="w-full text-xl font-semibold text-slate-800 border-b-2 border-indigo-400 outline-none bg-transparent pb-1"
            />
          ) : (
            <h1
              className="text-xl font-semibold text-slate-800 cursor-text hover:text-indigo-600 transition-colors"
              onClick={() => { setTitleVal(task.title); setEditTitle(true) }}
            >
              {task.title}
            </h1>
          )}
          <div className="flex items-center gap-2 mt-2">
            <StatusBadge status={task.status} />
            {task.anomalyFlags.length > 0 && !task.anomalyIgnored && (
              <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded">⚠ 异常</span>
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-400 mb-1">分类</p>
            <select
              value={task.categoryId}
              onChange={e => updateTask.mutate({ categoryId: e.target.value })}
              className="w-full bg-transparent text-slate-700 outline-none text-sm"
            >
              {categories.filter(c => !c.isAnomalyBucket && !c.isArchiveBucket).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-400 mb-1">优先级</p>
            <select
              value={task.manualPriority}
              onChange={e => updateTask.mutate({ manualPriority: Number(e.target.value) })}
              className="w-full bg-transparent text-slate-700 outline-none text-sm"
            >
              {[1,2,3,4,5].map(p => <option key={p} value={p}>P{p}</option>)}
            </select>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-400 mb-1">截止日期</p>
            <input
              type="date"
              value={task.deadline ?? ''}
              onChange={e => updateTask.mutate({ deadline: e.target.value || null })}
              className="w-full bg-transparent text-slate-700 outline-none text-sm"
            />
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-400 mb-1">估时 / 实际</p>
            <p className="text-slate-700">{fmtMinutes(task.estimatedMinutes)} / {fmtMinutes(task.actualMinutes)}</p>
          </div>
        </div>

        {/* Tags */}
        {task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {task.tags.map(tag => (
              <span key={tag} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{tag}</span>
            ))}
          </div>
        )}

        {/* Progress */}
        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1.5">
            <span>进度</span><span>{Math.round(task.progress)}%</span>
          </div>
          <ProgressBar value={task.progress} />
        </div>

        {/* Actions */}
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map(action => (
              <button
                key={action}
                onClick={() => doAction.mutate(action)}
                disabled={doAction.pending}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-60 ${ACTION_STYLES[action]}`}
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
        )}

        {/* Checkpoints */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">检查点</h3>
            <button
              onClick={() => setAddingCp(true)}
              className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
            >
              <Plus size={14} /> 添加
            </button>
          </div>

          {checkpoints.length === 0 && !addingCp && (
            <p className="text-sm text-slate-400">暂无检查点</p>
          )}

          <div className="space-y-2">
            {checkpoints.map(cp => (
              <div key={cp.id} className="flex items-center gap-2 group">
                <div className="flex gap-1 shrink-0">
                  {!cp.completed && !cp.skipped && (
                    <>
                      <button
                        onClick={() => completeCheckpoint.mutate(cp.id)}
                        className="w-5 h-5 rounded border border-slate-300 hover:border-emerald-400 hover:bg-emerald-50 flex items-center justify-center transition-colors"
                        title="完成"
                      >
                        <Check size={11} className="text-emerald-500" />
                      </button>
                      <button
                        onClick={() => skipCheckpoint.mutate(cp.id)}
                        className="w-5 h-5 rounded border border-slate-300 hover:border-amber-400 hover:bg-amber-50 flex items-center justify-center transition-colors"
                        title="跳过"
                      >
                        <SkipForward size={11} className="text-amber-500" />
                      </button>
                    </>
                  )}
                  {cp.completed && (
                    <button
                      onClick={() => uncompleteCheckpoint.mutate(cp.id)}
                      className="w-5 h-5 rounded bg-emerald-500 flex items-center justify-center"
                      title="取消完成"
                    >
                      <Check size={11} className="text-white" />
                    </button>
                  )}
                  {cp.skipped && (
                    <button
                      onClick={() => uncompleteCheckpoint.mutate(cp.id)}
                      className="w-5 h-5 rounded bg-slate-300 flex items-center justify-center"
                      title="取消跳过"
                    >
                      <RotateCcw size={11} className="text-white" />
                    </button>
                  )}
                </div>
                <span className={`flex-1 text-sm ${cp.completed || cp.skipped ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                  {cp.title}
                </span>
                {cp.estimatedMinutes > 0 && (
                  <span className="text-xs text-slate-400">{fmtMinutes(cp.estimatedMinutes)}</span>
                )}
                <button
                  onClick={() => deleteCheckpoint.mutate(cp.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}

            {addingCp && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={newCpTitle}
                    onChange={e => setNewCpTitle(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') { setAddingCp(false); setNewCpTitle(''); setNewCpMinutes('') }
                    }}
                    placeholder="检查点名称"
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-indigo-400"
                  />
                  <input
                    type="number"
                    value={newCpMinutes}
                    onChange={e => setNewCpMinutes(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newCpTitle.trim()) addCheckpoint.mutate(undefined)
                      if (e.key === 'Escape') { setAddingCp(false); setNewCpTitle(''); setNewCpMinutes('') }
                    }}
                    placeholder="分钟"
                    className="w-20 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-indigo-400"
                  />
                  <button
                    onClick={() => newCpTitle.trim() && addCheckpoint.mutate(undefined)}
                    disabled={!newCpTitle.trim() || addCheckpoint.pending}
                    className="text-xs px-3 py-1.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50"
                  >
                    确认
                  </button>
                  <button
                    onClick={() => { setAddingCp(false); setNewCpTitle(''); setNewCpMinutes('') }}
                    className="text-xs px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
