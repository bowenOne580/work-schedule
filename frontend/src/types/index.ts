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
  completionRate: number
  categoryTimeShare: Record<string, number>
  doneByPriority: Record<string, number>
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

export interface ApiError {
  code: string
  message: string
  details: unknown
}
