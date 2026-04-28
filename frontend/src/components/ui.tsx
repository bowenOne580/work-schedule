import type { TaskStatus } from '../types'

const labels: Record<TaskStatus, string> = {
  todo: '待开始',
  in_progress: '进行中',
  paused: '已暂停',
  done: '已完成',
}

const styles: Record<TaskStatus, string> = {
  todo: 'bg-slate-100 text-slate-500',
  in_progress: 'bg-blue-100 text-blue-600',
  paused: 'bg-amber-100 text-amber-600',
  done: 'bg-emerald-100 text-emerald-600',
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

const priorityColors: Record<number, string> = {
  1: '#EF4444', 2: '#F97316', 3: '#EAB308', 4: '#3B82F6', 5: '#94A3B8',
}

export function PriorityBar({ priority }: { priority: number }) {
  return (
    <div
      className="w-1 self-stretch rounded-full shrink-0"
      style={{ backgroundColor: priorityColors[priority] ?? '#94A3B8' }}
    />
  )
}

export function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value))
  return (
    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div
        className="h-full bg-indigo-400 rounded-full transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
