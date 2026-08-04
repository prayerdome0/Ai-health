// Unit tests for the new pure logic in this batch:
//   - src/data/profile.js (ageFromDob, profileToContext)
//   - src/data/wellness.js (todayKey, buildDayMap, weekSummary, lastNDayKeys)
//   - src/data/trends.js (dateRangeKeys, buildSymptomTrends, longestStreak, buildCalendarCells)
//
// Run with: npm run test:new
//
// We mirror the production logic here (Node, no Firebase) so the tests don't
// need a bundler. If the production rules change, mirror them here too.
import assert from 'node:assert/strict'

// ───── profile.js ─────
function ageFromDob(dob) {
  if (!dob) return null
  const d = new Date(dob + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age >= 0 && age < 130 ? age : null
}

function profileToContext(profile) {
  if (!profile) return null
  const parts = []
  if (profile.fullName) parts.push(`Name: ${profile.fullName}`)
  const age = ageFromDob(profile.dob)
  if (age != null) parts.push(`Age: ${age}`)
  if (profile.sex && profile.sex !== 'na') parts.push(`Sex: ${profile.sex}`)
  if (profile.bloodGroup && profile.bloodGroup !== 'Unknown') parts.push(`Blood: ${profile.bloodGroup}`)
  if (profile.heightCm) parts.push(`Height: ${profile.heightCm} cm`)
  if (profile.weightKg) parts.push(`Weight: ${profile.weightKg} kg`)
  if (profile.conditions?.length) parts.push(`Conditions: ${profile.conditions.join(', ')}`)
  if (profile.allergies?.length) parts.push(`Allergies: ${profile.allergies.join(', ')}`)
  return parts.length ? parts.join('; ') + '.' : null
}

// ───── wellness.js ─────
const WATER_GOAL_ML = 2000
const STEPS_GOAL = 8000
const SLEEP_GOAL_H = 8

function todayKey() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}
function lastNDayKeys(n) {
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
function buildDayMap(entries) {
  const map = {}
  for (const e of entries) {
    if (!e.date) continue
    map[e.date] = { ...(map[e.date] || {}), ...e }
  }
  return map
}
function summarizeDay(day) {
  if (!day) return { waterMl: 0, steps: 0, sleepH: 0 }
  return {
    waterMl: Number(day.waterMl) || 0,
    steps: Number(day.steps) || 0,
    sleepH: Number(day.sleepH) || 0,
  }
}
function weekSummary(entries, days = 7) {
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
    sleepGoalPct: sleepCount
      ? Math.min(100, Math.round((sleepTotal / (SLEEP_GOAL_H * sleepCount)) * 100))
      : 0,
  }
}

// ───── trends.js ─────
function dateRangeKeys(from, to) {
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
function buildSymptomTrends(assessments, from, to) {
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
      const cur = counts.get(k) || { symptom: k, count: 0, days: [], urgentCount: 0 }
      cur.count += 1
      cur.urgentCount += isUrgent ? 1 : 0
      if (!cur.days.includes(day)) cur.days.push(day)
      counts.set(k, cur)
    }
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count)
}
function longestStreak(trend, keys) {
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
function buildCalendarCells(trend, keys) {
  if (!trend) return keys.map(() => 0)
  const set = new Set(trend.days)
  return keys.map((k) => (set.has(k) ? 1 : 0))
}

// ───── tests ─────
const tests = []
const t = (name, fn) => tests.push([name, fn])

// profile
t('ageFromDob: null for empty', () => {
  assert.equal(ageFromDob(''), null)
  assert.equal(ageFromDob(null), null)
})
t('ageFromDob: 30 for someone born 30 years ago', () => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 30)
  d.setMonth(d.getMonth() - 1) // avoid birthday edge case
  const iso = d.toISOString().slice(0, 10)
  assert.equal(ageFromDob(iso), 30)
})
t('profileToContext: empty for null', () => {
  assert.equal(profileToContext(null), null)
})
t('profileToContext: only includes filled fields', () => {
  const ctx = profileToContext({ fullName: 'Maya', allergies: ['Penicillin'] })
  assert.match(ctx, /Name: Maya/)
  assert.match(ctx, /Allergies: Penicillin/)
  assert.doesNotMatch(ctx, /Age/)
  assert.doesNotMatch(ctx, /Blood/)
})
t('profileToContext: hides sex=na and blood=Unknown', () => {
  const ctx = profileToContext({ sex: 'na', bloodGroup: 'Unknown' })
  assert.equal(ctx, null)
})

// wellness
t('todayKey returns YYYY-MM-DD', () => {
  assert.match(todayKey(), /^\d{4}-\d{2}-\d{2}$/)
})
t('lastNDayKeys: 7 days, ending today', () => {
  const keys = lastNDayKeys(7)
  assert.equal(keys.length, 7)
  assert.equal(keys[keys.length - 1], todayKey())
})
t('buildDayMap: merges duplicate dates', () => {
  const map = buildDayMap([
    { date: '2025-01-01', waterMl: 500 },
    { date: '2025-01-01', steps: 4000 },
    { date: '2025-01-02', waterMl: 1000 },
  ])
  assert.equal(map['2025-01-01'].waterMl, 500)
  assert.equal(map['2025-01-01'].steps, 4000)
})
t('summarizeDay: handles missing day', () => {
  assert.deepEqual(summarizeDay(null), { waterMl: 0, steps: 0, sleepH: 0 })
})
t('weekSummary: totals 7 days at goal', () => {
  const keys = lastNDayKeys(7)
  const entries = keys.map((d) => ({ date: d, waterMl: 2000, steps: 8000, sleepH: 8 }))
  const s = weekSummary(entries, 7)
  assert.equal(s.waterTotal, 14000)
  assert.equal(s.stepsTotal, 56000)
  assert.equal(s.waterGoalPct, 100)
  assert.equal(s.stepsGoalPct, 100)
  assert.equal(s.sleepGoalPct, 100)
})
t('weekSummary: half the goal → 50%', () => {
  const keys = lastNDayKeys(7)
  const entries = keys.map((d) => ({ date: d, waterMl: 1000 }))
  const s = weekSummary(entries, 7)
  assert.equal(s.waterGoalPct, 50)
})
t('weekSummary: empty entries → 0%, 0 avg', () => {
  const s = weekSummary([], 7)
  assert.equal(s.waterTotal, 0)
  assert.equal(s.sleepAvg, 0)
  assert.equal(s.waterGoalPct, 0)
})

// trends
t('dateRangeKeys: inclusive endpoints', () => {
  const a = new Date('2025-01-01T00:00:00')
  const b = new Date('2025-01-05T00:00:00')
  const keys = dateRangeKeys(a, b)
  assert.equal(keys.length, 5)
  assert.equal(keys[0], '2025-01-01')
  assert.equal(keys[4], '2025-01-05')
})
t('dateRangeKeys: same day → 1 key', () => {
  const a = new Date('2025-01-01T10:00:00')
  const keys = dateRangeKeys(a, a)
  assert.equal(keys.length, 1)
})
t('buildSymptomTrends: counts and deduplicates days', () => {
  const now = new Date()
  const a1 = { createdAt: now, urgency: 'Monitor', symptoms: ['Headache', 'Fatigue'] }
  const a2 = { createdAt: now, urgency: 'Urgent', symptoms: ['Headache'] }
  const trends = buildSymptomTrends([a1, a2], new Date(now.getTime() - 86400000), new Date(now.getTime() + 86400000))
  const head = trends.find((t) => t.symptom === 'Headache')
  const fatigue = trends.find((t) => t.symptom === 'Fatigue')
  assert.equal(head.count, 2)
  assert.equal(head.days.length, 1) // same day
  assert.equal(head.urgentCount, 1)
  assert.equal(fatigue.count, 1)
  assert.equal(fatigue.urgentCount, 0)
})
t('buildSymptomTrends: ignores out-of-range', () => {
  const old = new Date()
  old.setDate(old.getDate() - 90)
  const trends = buildSymptomTrends(
    [{ createdAt: old, symptoms: ['Cough'] }],
    new Date(Date.now() - 30 * 86400000),
    new Date(),
  )
  assert.equal(trends.length, 0)
})
t('buildSymptomTrends: sorted by count desc', () => {
  const now = new Date()
  const a1 = { createdAt: now, symptoms: ['A'] }
  const a2 = { createdAt: now, symptoms: ['B', 'C'] }
  const a3 = { createdAt: now, symptoms: ['B'] }
  const trends = buildSymptomTrends([a1, a2, a3], new Date(now.getTime() - 86400000), new Date(now.getTime() + 86400000))
  assert.equal(trends[0].symptom, 'B') // 2 reports
  assert.equal(trends[1].count, 1)
})
t('longestStreak: detects a 4-day run inside a 7-day window', () => {
  const keys = ['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05', '2025-01-06', '2025-01-07']
  const trend = { days: ['2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05'] }
  assert.equal(longestStreak(trend, keys), 4)
})
t('longestStreak: 0 when trend is empty', () => {
  const keys = ['2025-01-01']
  assert.equal(longestStreak(null, keys), 0)
  assert.equal(longestStreak({ days: [] }, keys), 0)
})
t('buildCalendarCells: 1/0 per day', () => {
  const keys = ['2025-01-01', '2025-01-02', '2025-01-03']
  const trend = { days: ['2025-01-02'] }
  assert.deepEqual(buildCalendarCells(trend, keys), [0, 1, 0])
})

let failed = 0
for (const [name, fn] of tests) {
  try {
    await fn()
    console.log('PASS  ' + name)
  } catch (err) {
    failed++
    console.log('FAIL  ' + name)
    console.log('      ' + (err.message || err))
  }
}
console.log('----')
console.log(failed === 0 ? `ALL ${tests.length} NEW-FEATURE TESTS PASSED` : `${failed} of ${tests.length} FAILED`)
process.exit(failed === 0 ? 0 : 1)
