import { useState } from 'react'
import { useQuery, useMutation, invalidate, invalidatePrefix } from '../hooks/useApi'
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

interface CompleteModalProps {
  label: string
  estimatedMinutes?: number
  onConfirm: (minutes: number | undefined) => void
  onCancel: () => void
  pending: boolean
}

function CompleteModal({ label, estimatedMinutes, onConfirm, onCancel, pending }: CompleteModalProps) {
  const [val, setVal] = useState(estimatedMinutes ? String(estimatedMinutes) : '')

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-xs p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-800">完成「{label}」</h2>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">实际花费时间（分钟）</label>
          <input
            autoFocus
            type="number"
            min="0"
            value={val}
            onChange={e => setVal(e.target.value)}
            placeholder={estimatedMinutes ? `预计 ${estimatedMinutes} 分钟` : '可不填'}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-indigo-400"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg">取消</button>
          <button
            onClick={() => onConfirm(val ? Number(val) : undefined)}
            disabled={pending}
            className="px-4 py-2 text-sm text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50"
          >
            确认完成
          </button>
        </div>
      </div>
    </div>
  )
}

function addDays(base: string | null, days: number): string {
  const d = base ? new Date(base) : new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

interface PostponeModalProps {
  currentDeadline: string | null
  onConfirm: (newDeadline: string) => void
  onCancel: () => void
  pending: boolean
}

function PostponeModal({ currentDeadline, onConfirm, onCancel, pending }: PostponeModalProps) {
  const [mode, setMode] = useState<'days' | 'date'>('days')
  const [days, setDays] = useState('1')
  const [date, setDate] = useState(addDays(currentDeadline, 1))

  const handleConfirm = () => {
    const newDeadline = mode === 'days' ? addDays(currentDeadline, Number(days) || 1) : date
    onConfirm(newDeadline)
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-800">推迟任务</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setMode('days')}
            className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors ${mode === 'days' ? 'border-indigo-400 bg-indigo-50 text-indigo-600' : 'border-slate-200 text-slate-500'}`}
          >
            延期天数
          </button>
          <button
            onClick={() => setMode('date')}
            className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors ${mode === 'date' ? 'border-indigo-400 bg-indigo-50 text-indigo-600' : 'border-slate-200 text-slate-500'}`}
          >
            指定日期
          </button>
        </div>
        {mode === 'days' ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              type="number"
              min="1"
              value={days}
              onChange={e => setDays(e.target.value)}
              className="w-24 px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-indigo-400"
            />
            <span className="text-sm text-slate-500">天后</span>
            {currentDeadline && (
              <span className="text-xs text-slate-400 ml-auto">
                → {addDays(currentDeadline, Number(days) || 1)}
              </span>
            )}
          </div>
        ) : (
          <input
            autoFocus
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-indigo-400"
          />
        )}
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg">取消</button>
          <button
            onClick={handleConfirm}
            disabled={pending}
            className="px-4 py-2 text-sm text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg disabled:opacity-50"
          >
            确认推迟
          </button>
        </div>
      </div>
    </div>
  )
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
  const [showPostpone, setShowPostpone] = useState(false)
  // { type: 'task' } | { type: 'checkpoint', id, title, estimatedMinutes }
  const [completeTarget, setCompleteTarget] = useState<
    | { type: 'task' }
    | { type: 'checkpoint'; id: string; title: string; estimatedMinutes: number }
    | null
  >(null)

  // Single fetch — backend embeds checkpoints in GET /api/tasks/:id
  const { data: task, loading, error } = useQuery(`task:${taskId}`, () => tasksApi.get(taskId))
  const { data: categories = [] } = useQuery('categories', categoriesApi.list)

  const refresh = () => {
    invalidatePrefix('task:')
    invalidate('tasks')
  }

  const updateTask = useMutation(
    (body: Partial<Task>) => tasksApi.update(taskId, body),
    { onSuccess: refresh }
  )
  const doAction = useMutation(
    ({ action, actualMinutes }: { action: TaskAction; actualMinutes?: number }) =>
      tasksApi.action(taskId, action, actualMinutes !== undefined ? { actualMinutes } : undefined),
    { onSuccess: refresh }
  )
  const postponeTask = useMutation(
    async (newDeadline: string) => {
      await tasksApi.update(taskId, { deadline: newDeadline })
      await tasksApi.action(taskId, 'postpone')
    },
    { onSuccess: () => { setShowPostpone(false); refresh() } }
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
    ({ id, actualMinutes }: { id: string; actualMinutes?: number }) =>
      checkpointsApi.complete(id, actualMinutes),
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

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-red-500">
        加载失败，请返回重试
      </div>
    )
  }

  if (loading || !task) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const checkpoints = (task.checkpoints ?? []).slice().sort((a, b) => a.order - b.order)
  const actions = availableActions(task.status)
  const readonly = task.status === 'done'

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
          {editTitle && !readonly ? (
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
              className={`text-xl font-semibold text-slate-800 transition-colors ${readonly ? '' : 'cursor-text hover:text-indigo-600'}`}
              onClick={() => { if (!readonly) { setTitleVal(task.title); setEditTitle(true) } }}
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
            {readonly ? (
              <p className="text-slate-700">{categories.find(c => c.id === task.categoryId)?.name ?? task.categoryId}</p>
            ) : (
              <select
                value={task.categoryId}
                onChange={e => updateTask.mutate({ categoryId: e.target.value })}
                className="w-full bg-transparent text-slate-700 outline-none text-sm"
              >
                {categories.filter(c => !c.isAnomalyBucket && !c.isArchiveBucket).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-400 mb-1">优先级</p>
            {readonly ? (
              <p className="text-slate-700">P{task.manualPriority}</p>
            ) : (
              <select
                value={task.manualPriority}
                onChange={e => updateTask.mutate({ manualPriority: Number(e.target.value) })}
                className="w-full bg-transparent text-slate-700 outline-none text-sm"
              >
                {[1,2,3,4,5].map(p => <option key={p} value={p}>P{p}</option>)}
              </select>
            )}
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-400 mb-1">截止日期</p>
            {readonly ? (
              <p className="text-slate-700">{task.deadline ?? '—'}</p>
            ) : (
              <input
                type="date"
                value={task.deadline ?? ''}
                onChange={e => updateTask.mutate({ deadline: e.target.value || null })}
                className="w-full bg-transparent text-slate-700 outline-none text-sm"
              />
            )}
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-400 mb-1">估时 / 实际</p>
            <p className="text-slate-700">{fmtMinutes(task.estimatedMinutes)} / {fmtMinutes(task.actualMinutes)}</p>
          </div>
        </div>

        {/* Time comparison tracks */}
        {(task.estimatedMinutes > 0 || task.actualMinutes > 0) && (() => {
          const est = task.estimatedMinutes || 0
          const act = task.actualMinutes || 0
          const max = Math.max(est, act, 1)
          const overTime = act > est && est > 0
          return (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="w-8 text-right shrink-0">预计</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-300 rounded-full" style={{ width: `${(est / max) * 100}%` }} />
                </div>
                <span className="w-10 shrink-0">{fmtMinutes(est)}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="w-8 text-right shrink-0">实际</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${overTime ? 'bg-orange-400' : 'bg-emerald-400'}`}
                    style={{ width: `${(act / max) * 100}%` }}
                  />
                </div>
                <span className={`w-10 shrink-0 ${overTime ? 'text-orange-500 font-medium' : ''}`}>{fmtMinutes(act)}</span>
              </div>
              {overTime && (
                <p className="text-xs text-orange-500 pl-10">超时 {fmtMinutes(act - est)}</p>
              )}
            </div>
          )
        })()}

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
                onClick={() => {
                  if (action === 'postpone') { setShowPostpone(true) }
                  else if (action === 'complete') { setCompleteTarget({ type: 'task' }) }
                  else { doAction.mutate({ action }) }
                }}
                disabled={doAction.pending || postponeTask.pending}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-60 ${ACTION_STYLES[action]}`}
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
        )}

        {showPostpone && (
          <PostponeModal
            currentDeadline={task.deadline ?? null}
            onConfirm={newDeadline => postponeTask.mutate(newDeadline)}
            onCancel={() => setShowPostpone(false)}
            pending={postponeTask.pending}
          />
        )}

        {completeTarget && (
          <CompleteModal
            label={completeTarget.type === 'task' ? task.title : completeTarget.title}
            estimatedMinutes={
              completeTarget.type === 'task'
                ? task.estimatedMinutes
                : completeTarget.estimatedMinutes
            }
            onConfirm={minutes => {
              if (completeTarget.type === 'task') {
                doAction.mutate({ action: 'complete', actualMinutes: minutes })
              } else {
                completeCheckpoint.mutate({ id: completeTarget.id, actualMinutes: minutes })
              }
              setCompleteTarget(null)
            }}
            onCancel={() => setCompleteTarget(null)}
            pending={doAction.pending || completeCheckpoint.pending}
          />
        )}

        {/* Checkpoints */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">检查点</h3>
            {!readonly && (
              <button
                onClick={() => setAddingCp(true)}
                className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
              >
                <Plus size={14} /> 添加
              </button>
            )}
          </div>

          {checkpoints.length === 0 && !addingCp && (
            <p className="text-sm text-slate-400">暂无检查点</p>
          )}

          <div className="space-y-2">
            {checkpoints.map(cp => (
              <div key={cp.id} className="flex items-center gap-2 group">
                {!readonly && (
                  <div className="flex gap-1 shrink-0">
                    {!cp.completed && !cp.skipped && (
                      <>
                        <button
                          onClick={() => setCompleteTarget({ type: 'checkpoint', id: cp.id, title: cp.title, estimatedMinutes: cp.estimatedMinutes })}
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
                )}
                {readonly && (
                  <div className="w-5 h-5 rounded shrink-0 flex items-center justify-center">
                    {cp.completed && <Check size={13} className="text-emerald-500" />}
                    {cp.skipped && <SkipForward size={13} className="text-slate-400" />}
                    {!cp.completed && !cp.skipped && <div className="w-3 h-3 rounded-full border border-slate-300" />}
                  </div>
                )}
                <span className={`flex-1 text-sm ${cp.completed || cp.skipped ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                  {cp.title}
                </span>
                {cp.estimatedMinutes > 0 && (
                  <span className="text-xs text-slate-400">{fmtMinutes(cp.estimatedMinutes)}</span>
                )}
                {!readonly && (
                  <button
                    onClick={() => deleteCheckpoint.mutate(cp.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
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
