import { api } from './client'
import type { Task, Checkpoint, Category, StatisticsOverview, Recommendation } from '../types'

export const authApi = {
  status: () => api.get<{ authenticated: boolean; username?: string }>('/api/auth/status'),
  login: (body: { username: string; password: string; remember: boolean }) =>
    api.post('/api/auth/login', body),
  logout: () => api.post('/api/auth/logout'),
}

export const tasksApi = {
  list: () => api.get<Task[]>('/api/tasks'),
  get: (id: string) => api.get<Task>(`/api/tasks/${id}`),
  create: (body: Partial<Task>) => api.post<Task>('/api/tasks', body),
  update: (id: string, body: Partial<Task>) => api.patch<Task>(`/api/tasks/${id}`, body),
  delete: (id: string) => api.delete(`/api/tasks/${id}`),
  anomalyIgnore: (id: string, ignored: boolean) =>
    api.patch(`/api/tasks/${id}/anomaly-ignore`, { ignored }),
  action: (id: string, action: string, body?: unknown) =>
    api.post<Task>(`/api/tasks/${id}/${action}`, body),
  anomalies: () => api.get<Task[]>('/api/tasks/anomalies'),
}

export const checkpointsApi = {
  create: (taskId: string, body: Partial<Checkpoint>) =>
    api.post<Checkpoint>(`/api/tasks/${taskId}/checkpoints`, body),
  update: (id: string, body: Partial<Checkpoint>) =>
    api.patch<Checkpoint>(`/api/checkpoints/${id}`, body),
  delete: (id: string) => api.delete(`/api/checkpoints/${id}`),
  complete: (id: string, actualMinutes?: number) =>
    api.post<Checkpoint>(`/api/checkpoints/${id}/complete`, actualMinutes ? { actualMinutes } : undefined),
  skip: (id: string) => api.post<Checkpoint>(`/api/checkpoints/${id}/skip`),
  uncomplete: (id: string) => api.post<Checkpoint>(`/api/checkpoints/${id}/uncomplete`),
}

export const categoriesApi = {
  list: () => api.get<Category[]>('/api/categories'),
  create: (body: { name: string; description: string }) => api.post<Category>('/api/categories', body),
  delete: (id: string) => api.delete(`/api/categories/${id}`),
}

export const statsApi = {
  overview: () => api.get<StatisticsOverview>('/api/statistics/overview'),
}

export const recommendApi = {
  byCategory: () => api.get<Recommendation[]>('/api/recommendations/by-category'),
}
