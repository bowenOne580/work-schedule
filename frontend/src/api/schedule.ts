import { api } from './client'
import type { ScheduleSlot, ScheduleSlotInput } from '../types/schedule'

export const scheduleApi = {
  list: () => api.get<ScheduleSlot[]>('/api/schedule/slots'),
  create: (body: ScheduleSlotInput) => api.post<ScheduleSlot>('/api/schedule/slots', body),
  update: (id: string, body: ScheduleSlotInput) => api.patch<ScheduleSlot>(`/api/schedule/slots/${id}`, body),
  delete: (id: string) => api.delete(`/api/schedule/slots/${id}`),
}
