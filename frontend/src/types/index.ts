export type TaskStatus = 'todo' | 'in_progress' | 'paused' | 'done'
export type TaskAction = 'start' | 'pause' | 'resume' | 'complete' | 'postpone'
export type AnomalyFlag = 'postponed' | 'checkpoint_skipped'

export interface Task {
  id: string
  title: string
  categoryId: string
  tags: string[]
  manualPriority: number
  directEstimatedMinutes: number
  estimatedMinutes: number
  deadline: string | null
  status: TaskStatus
  progress: number
  checkpointIds: string[]
  checkpoints?: Checkpoint[]  // included when fetching single task
  directMinutes: number
  actualMinutes: number
  anomalyFlags: AnomalyFlag[]
  anomalyIgnored: boolean
  createdAt: string
  updatedAt: string
  finishedAt?: string       // set when task is completed
}

export interface Checkpoint {
  id: string
  taskId: string
  title: string
  order: number
  estimatedMinutes: number
  actualMinutes: number
  completed: boolean
  skipped: boolean
}

export interface Category {
  id: string
  name: string
  description: string
  isAnomalyBucket: boolean
  isArchiveBucket: boolean
}

export interface StatisticsOverview {
  dateKey: string
  dailyMinutes: number
  weeklyMinutes: number
  dailyDoneCount: number
  weeklyDoneCount: number
  completionRate: number
  onTimeRate: number | null
  avgOverdueRatio: number | null
  categoryTimeShare: Record<string, { actual: number; estimated: number; share: number }>
  doneByPriority: Record<string, number>
  dailyHistory: { dateKey: string; minutes: number }[]
}

export interface Recommendation {
  category: Category
  task: Task
  score: number
  scoreDetails: {
    manualScore: number
    deadlineScore: number
    effortScore: number
    remainingEstimatedMinutes: number
  }
}

export interface ExportPayload {
  version: string
  exportedAt: string
  data: {
    tasks: Task[]
    checkpoints: Checkpoint[]
    categories: Category[]
    statisticsCache: Record<string, unknown>
  }
}

export interface SystemVersion {
  version: string
  latestVersion: string
}

export interface UpdateResponse {
  message: string
  status: string
}

export interface ImportResult {
  imported: boolean
  taskCount: number
  checkpointCount: number
  categoryCount: number
}

export interface ApiError {
  code: string
  message: string
  details: unknown
}
