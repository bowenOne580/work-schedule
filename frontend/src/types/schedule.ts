export type ScheduleSlotType = 'busy' | 'free'

export interface ScheduleSlotInput {
  title: string
  type: ScheduleSlotType
  weekdays: number[]
  startTime: string
  endTime: string
}

export interface ScheduleSlot extends ScheduleSlotInput {
  id: string
  createdAt: string
  updatedAt: string
}
