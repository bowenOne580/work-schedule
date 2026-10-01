import { useEffect, useState } from 'react'
import type { Task } from '../types'

// 后端保存计时起点，浏览器只更新显示；切换页面或刷新不丢失累计用时。
export function useTaskMinutes(task: Task | undefined) {
  const [now, setNow] = useState(() => Date.now())
  const startedAt = task?.status === 'in_progress' ? task.timerStartedAt : null

  useEffect(() => {
    if (!startedAt) return
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [startedAt])

  const accumulatedMs = task?.accumulatedMs ?? (task?.actualMinutes ?? 0) * 60_000
  const runningMs = startedAt ? Math.max(0, now - new Date(startedAt).getTime()) : 0
  return (accumulatedMs + runningMs) / 60_000
}
