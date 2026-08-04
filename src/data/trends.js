/**
 * Helpers for the Symptom Trends page. Pure functions, safe to test.
 */

/** Days between two Date-like values, inclusive of `now`. */
export function daysBetween(from, to) {
  const a = new Date(from)
  a.setHours(0, 0, 0, 0)
  const b = new Date(to)
  b.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((b - a) / 86400000))
}

/** Build an array of ISO YYYY-MM-DD strings from `from` to `to` (inclusive). */
export function dateRangeKeys(from, to) {
  const keys = []
  const a = new Date(from)
  a.setHours(0, 0, 0, 0)
  const b = new Date(to)
  b.setHours(0, 0, 0, 0)
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    keys.push(d.toISOString().slice(0, 10))
  }
  return keys
}

/**
 * Bucket a flat list of assessment entries (each { symptoms: string[],
 * createdAt: Date, urgency? }) into a per-symptom count for a date range.
 *
 * @param {Array} assessments
 * @param {Date} from
 * @param {Date} to
 * @returns {Array<{ symptom: string, count: number, days: string[], urgentCount: number }>}
 */
export function buildSymptomTrends(assessments, from, to) {
  const fromT = new Date(from)
  fromT.setHours(0, 0, 0, 0)
  const toT = new Date(to)
  toT.setHours(23, 59, 59, 999)
  const counts = new Map()
  for (const a of assessments) {
    const when = a.createdAt ? new Date(a.createdAt) : null
    if (!when || when < fromT || when > toT) continue
    const day = when.toISOString().slice(0, 10)
    const isUrgent = /urgent/i.test(a.urgency || '')
    const symptoms = Array.isArray(a.symptoms) ? a.symptoms : []
    for (const s of symptoms) {
      if (!s) continue
      const k = s.trim()
      if (!k) continue
      const cur = counts.get(k) || {
        symptom: k,
        count: 0,
        days: [],
        urgentCount: 0,
      }
      cur.count += 1
      cur.urgentCount += isUrgent ? 1 : 0
      if (!cur.days.includes(day)) cur.days.push(day)
      counts.set(k, cur)
    }
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count)
}

/**
 * Group a flat symptom list into "stacks": consecutive days with at least
 * one of the same symptom reported. Returns the longest run length so the UI
 * can highlight persistent patterns.
 */
export function longestStreak(trend, keys) {
  if (!trend || !trend.days?.length) return 0
  const set = new Set(trend.days)
  let longest = 0
  let current = 0
  for (const k of keys) {
    if (set.has(k)) {
      current += 1
      if (current > longest) longest = current
    } else {
      current = 0
    }
  }
  return longest
}

/**
 * Compact 30-day bar for one symptom: 30 cells, 1 = reported that day.
 */
export function buildCalendarCells(trend, keys) {
  if (!trend) return keys.map(() => 0)
  const set = new Set(trend.days)
  return keys.map((k) => (set.has(k) ? 1 : 0))
}
