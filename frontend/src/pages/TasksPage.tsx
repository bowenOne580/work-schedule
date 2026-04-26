import { useState } from 'react'
import { useQuery, useMutation, invalidate } from '../hooks/useApi'
import { tasksApi, categoriesApi } from '../api'
import { StatusBadge, ProgressBar } from '../components/ui'
import TaskDetail from '../components/TaskDetail'
import type { Task, TaskStatus } from '../types'
import { Plus, List, Columns, ChevronRight, Folder } from 'lucide-react'
import { useParams, useNavigate } from 'react-router-dom'

function NewTaskModal({ onClose, defaultCategoryId }: { onClose: () => void; defaultCategoryId?: string }) {
  const { data: categories = [] } = useQuery('categories', categoriesApi.list)
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? 'cat-general')
  const [priority, setPriority] = useState(3)
  const [deadline, setDeadline] = useState('')
  const [estimatedMinutes, setEstimatedMinutes] = useState('')

  const create = useMutation(
    () => tasksApi.create({
      title,
      categoryId,
      manualPriority: priority,
      deadline: deadline || undefined,
      estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : undefined,
    }),
    { onSuccess: () => { invalidate('tasks'); onClose() } }
  )

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-800">新建任务</h2>

        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="任务标题"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-indigo-400"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">分类</label>
            <select
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-indigo-400"
            >
              {categories.filter(c => !c.isAnomalyBucket && !c.isArchiveBucket).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">优先级</label>
            <select
              value={priority}
              onChange={e => setPriority(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-indigo-400"
            >
              {[1,2,3,4,5].map(p => <option key={p} value={p}>P{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">截止日期</label>
            <input
              type="date"
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">估时（分钟）</label>
            <input
              type="number"
              value={estimatedMinutes}
              onChange={e => setEstimatedMinutes(e.target.value)}
              placeholder="60"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-indigo-400"
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg">取消</button>
          <button
            onClick={() => title.trim() && create.mutate(undefined)}
            disabled={!title.trim() || create.pending}
            className="px-4 py-2 text-sm text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg disabled:opacity-50"
          >
            创建
          </button>
        </div>
      </div>
    </div>
  )
}

const KANBAN_COLS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: '待开始' },
  { status: 'in_progress', label: '进行中' },
  { status: 'paused', label: '已暂停' },
  { status: 'done', label: '已完成' },
]

const priorityColors: Record<number, string> = {
  1: '#EF4444', 2: '#F97316', 3: '#EAB308', 4: '#3B82F6', 5: '#94A3B8',
}

function isDeadlineSoon(deadline: string | null) {
  if (!deadline) return false
  const diff = (new Date(deadline).getTime() - Date.now()) / 86400000
  return diff >= 0 && diff <= 3
}

function CategorySidebar({ selectedCat, onSelect }: { selectedCat: string | null; onSelect: (id: string | null) => void }) {
  const { data: categories = [] } = useQuery('categories', categoriesApi.list)
  const userCats = categories.filter(c => !c.isAnomalyBucket && !c.isArchiveBucket)

  return (
    <aside className="hidden md:flex flex-col w-48 border-r border-slate-200 bg-white shrink-0">
      <div className="px-3 py-3 border-b border-slate-200">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">分类</p>
      </div>
      <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        <button
          onClick={() => onSelect(null)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${!selectedCat ? 'bg-indigo-50 text-indigo-600 font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          <Folder size={14} /> 全部
        </button>
        {userCats.map(c => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${selectedCat === c.id ? 'bg-indigo-50 text-indigo-600 font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <Folder size={14} /> {c.name}
          </button>
        ))}
      </div>
    </aside>
  )
}

function TaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="flex items-stretch gap-0 bg-white border border-slate-200 rounded-lg overflow-hidden cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all group"
    >
      <div className="w-1 shrink-0" style={{ backgroundColor: priorityColors[task.manualPriority] ?? '#94A3B8' }} />
      <div className="flex-1 px-3 py-2.5 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm font-medium text-slate-800 truncate flex-1">{task.title}</span>
          <StatusBadge status={task.status} />
          {task.deadline && (
            <span className={`text-xs shrink-0 ${isDeadlineSoon(task.deadline) ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
              {task.deadline}
            </span>
          )}
          <ChevronRight size={14} className="text-slate-300 group-hover:text-indigo-400 shrink-0 transition-colors" />
        </div>
        <ProgressBar value={task.progress} />
      </div>
    </div>
  )
}

function KanbanCard({ task, onClick }: { task: Task; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="bg-white border border-slate-200 rounded-lg p-3 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start gap-2 mb-2">
        <div className="w-1 min-h-[2rem] rounded-full shrink-0 mt-0.5" style={{ backgroundColor: priorityColors[task.manualPriority] ?? '#94A3B8' }} />
        <p className="text-sm text-slate-800 font-medium line-clamp-2 flex-1">{task.title}</p>
      </div>
      <ProgressBar value={task.progress} />
      {task.deadline && (
        <p className={`text-xs mt-1.5 ${isDeadlineSoon(task.deadline) ? 'text-red-500' : 'text-slate-400'}`}>
          {task.deadline}
        </p>
      )}
    </div>
  )
}

export default function TasksPage() {
  const { taskId: urlTaskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const [selectedCat, setSelectedCat] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'kanban'>('list')
  const [showNewTask, setShowNewTask] = useState(false)

  const selectedTaskId = urlTaskId ?? null

  const { data: tasks = [] } = useQuery('tasks', tasksApi.list)

  const visibleTasks = tasks.filter(t => {
    if (t.categoryId === 'cat-anomaly' || t.categoryId === 'cat-archived') return false
    if (selectedCat) return t.categoryId === selectedCat
    return true
  })

  const openTask = (id: string) => navigate(`/app/tasks/${id}`)
  const closeTask = () => navigate('/app/tasks')

  if (selectedTaskId) {
    return (
      <div className="flex h-full">
        <CategorySidebar selectedCat={selectedCat} onSelect={setSelectedCat} />
        <TaskDetail taskId={selectedTaskId} onBack={closeTask} />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <CategorySidebar selectedCat={selectedCat} onSelect={setSelectedCat} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === 'list' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <List size={13} /> 列表
            </button>
            <button
              onClick={() => setView('kanban')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === 'kanban' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Columns size={13} /> 看板
            </button>
          </div>
          <button
            onClick={() => setShowNewTask(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg transition-colors"
          >
            <Plus size={13} /> 新建任务
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {view === 'list' ? (
            <div className="space-y-2 max-w-2xl">
              {visibleTasks.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-8">暂无任务</p>
              )}
              {visibleTasks.map(t => (
                <TaskRow key={t.id} task={t} onClick={() => openTask(t.id)} />
              ))}
            </div>
          ) : (
            <div className="flex gap-4 h-full min-w-max">
              {KANBAN_COLS.map(({ status }) => {
                const col = visibleTasks.filter(t => t.status === status)
                return (
                  <div key={status} className="w-64 flex flex-col">
                    <div className="flex items-center gap-2 mb-3">
                      <StatusBadge status={status} />
                      <span className="text-xs text-slate-400">{col.length}</span>
                    </div>
                    <div className="flex-1 space-y-2 overflow-y-auto">
                      {col.map(t => (
                        <KanbanCard key={t.id} task={t} onClick={() => openTask(t.id)} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {showNewTask && (
        <NewTaskModal
          onClose={() => setShowNewTask(false)}
          defaultCategoryId={selectedCat ?? undefined}
        />
      )}
    </div>
  )
}
