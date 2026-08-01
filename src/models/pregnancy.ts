export interface PregnancyNote {
  id: string
  week: number
  notes: string
  date: string
  createdAt: Date
}

export interface PregnancyTimeline {
  week: number
  milestone: string
  title?: string
  text?: string
  tip?: string
}

export interface DueDateInfo {
  dueDate: string
  lastPeriodDate: string
  currentWeek: number
  currentDay: number
  trimester: 1 | 2 | 3
  daysRemaining: number
  weeksRemaining: number
}
