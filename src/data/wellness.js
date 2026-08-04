/**
 * Quick daily wellness log: water (mL), steps, and sleep (h).
 * Each day is a single document under users/{uid}/wellness/{YYYY-MM-DD}.
 */

export const WATER_GOAL_ML = 2000
export const STEPS_GOAL = 8000
export const SLEEP_GOAL_H = 8

export function todayKey() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}

export function lastNDayKeys(n) {
  const keys = []
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d)
    x.setDate(d.getDate() - i)
    keys.push(x.toISOString().slice(0, 10))
  }
  return keys
}

export function buildDayMap(entries) {
  const map = {}
  for (const e of entries) {
    if (!e.date) continue
    map[e.date] = { ...(map[e.date] || {}), ...e }
  }
  return map
}

export function summarizeDay(day) {
  if (!day) return { waterMl: 0, steps: 0, sleepH: 0 }
  return {
    waterMl: Number(day.waterMl) || 0,
    steps: Number(day.steps) || 0,
    sleepH: Number(day.sleepH) || 0,
  }
}

/** Compute the 7-day totals and the goal-percentages for the home card. */
export function weekSummary(entries, days = 7) {
  const map = buildDayMap(entries)
  let waterTotal = 0
  let stepsTotal = 0
  let sleepTotal = 0
  let sleepCount = 0
  for (const k of lastNDayKeys(days)) {
    const d = map[k]
    if (!d) continue
    waterTotal += Number(d.waterMl) || 0
    stepsTotal += Number(d.steps) || 0
    if (d.sleepH != null) {
      sleepTotal += Number(d.sleepH) || 0
      sleepCount++
    }
  }
  return {
    waterTotal,
    stepsTotal,
    sleepAvg: sleepCount ? sleepTotal / sleepCount : 0,
    waterGoalPct: Math.min(100, Math.round((waterTotal / (WATER_GOAL_ML * days)) * 100)),
    stepsGoalPct: Math.min(100, Math.round((stepsTotal / (STEPS_GOAL * days)) * 100)),
    sleepGoalPct: Math.min(100, Math.round((sleepTotal / (SLEEP_GOAL_H * sleepCount || 1)) * 100)),
  }
}
