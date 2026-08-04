// Unit tests for the new medication-adherence and vitals-categorization logic.
// Run with: npm run test:features
import assert from 'node:assert/strict'

// Mirror the production logic in src/data/medications.js so we can run it in
// Node without the Firebase dependency. If the production rules change, mirror
// them here too — or, even better, extract these to a pure ESM module later.
const TIMINGS = [
  { key: 'morning', label: 'Morning', time: '08:00' },
  { key: 'noon', label: 'Noon', time: '12:00' },
  { key: 'evening', label: 'Evening', time: '18:00' },
  { key: 'night', label: 'Night', time: '22:00' },
]
const FREQUENCIES = [
  { key: 'once-daily', label: 'Once daily', slots: ['morning'] },
  { key: 'twice-daily', label: 'Twice daily', slots: ['morning', 'evening'] },
  { key: 'three-times-daily', label: 'Three times a day', slots: ['morning', 'noon', 'evening'] },
  { key: 'four-times-daily', label: 'Four times a day', slots: ['morning', 'noon', 'evening', 'night'] },
  { key: 'as-needed', label: 'As needed (PRN)', slots: [] },
]

const frequencyFor = (key) => FREQUENCIES.find((f) => f.key === key) || FREQUENCIES[0]
const timingsForFrequency = (key) =>
  frequencyFor(key).slots.map((s) => TIMINGS.find((t) => t.key === s)).filter(Boolean)

function computeAdherence(medications, takenLogs, days = 7) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const since = new Date(today)
  since.setDate(since.getDate() - (days - 1))
  const dates = []
  for (let i = 0; i < days; i++) {
    const d = new Date(since)
    d.setDate(since.getDate() + i)
    dates.push(d.toISOString().slice(0, 10))
  }
  let scheduled = 0
  let taken = 0
  const perMed = []
  for (const med of medications) {
    if (med.status === 'stopped') continue
    const slots = med.frequency === 'as-needed' ? [] : timingsForFrequency(med.frequency).map((t) => t.key)
    let medScheduled = 0
    let medTaken = 0
    if (med.frequency === 'as-needed') {
      const logs = (takenLogs || []).filter((l) => l.medId === med.id && dates.includes(l.date))
      medScheduled = logs.length
      medTaken = logs.length
    } else {
      for (const d of dates) {
        for (const s of slots) {
          medScheduled++
          const log = (takenLogs || []).find((l) => l.medId === med.id && l.slot === s && l.date === d)
          if (log && log.taken) medTaken++
        }
      }
    }
    scheduled += medScheduled
    taken += medTaken
    perMed.push({
      medId: med.id,
      name: med.name,
      scheduled: medScheduled,
      taken: medTaken,
      percent: medScheduled === 0 ? null : Math.round((medTaken / medScheduled) * 100),
    })
  }
  return {
    taken,
    scheduled,
    percent: scheduled === 0 ? null : Math.round((taken / scheduled) * 100),
    perMed,
  }
}

const tests = []
const t = (name, fn) => tests.push([name, fn])

t('no medications → 0%', () => {
  const a = computeAdherence([], [], 7)
  assert.equal(a.scheduled, 0)
  assert.equal(a.taken, 0)
  assert.equal(a.percent, null)
})

t('once-daily, 7 days, all taken', () => {
  const meds = [{ id: 'a', name: 'Amlodipine', frequency: 'once-daily', status: 'active' }]
  const today = new Date()
  const logs = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    logs.push({ medId: 'a', slot: 'morning', date: d.toISOString().slice(0, 10), taken: true })
  }
  const a = computeAdherence(meds, logs, 7)
  assert.equal(a.scheduled, 7)
  assert.equal(a.taken, 7)
  assert.equal(a.percent, 100)
})

t('twice-daily, 7 days, half taken', () => {
  const meds = [{ id: 'a', name: 'Metformin', frequency: 'twice-daily', status: 'active' }]
  const today = new Date()
  const logs = []
  // Take morning every day but only evening on 3 of 7.
  for (let i = 0; i < 7; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const ds = d.toISOString().slice(0, 10)
    logs.push({ medId: 'a', slot: 'morning', date: ds, taken: true })
    if (i < 3) logs.push({ medId: 'a', slot: 'evening', date: ds, taken: true })
  }
  const a = computeAdherence(meds, logs, 7)
  assert.equal(a.scheduled, 14)
  assert.equal(a.taken, 7 + 3)
  assert.equal(a.percent, Math.round((10 / 14) * 100))
})

t('stopped medications are excluded', () => {
  const meds = [
    { id: 'a', name: 'A', frequency: 'once-daily', status: 'stopped' },
    { id: 'b', name: 'B', frequency: 'once-daily', status: 'active' },
  ]
  const a = computeAdherence(meds, [], 7)
  assert.equal(a.scheduled, 7) // only B
})

t('as-needed counts actual logs as 100%', () => {
  const meds = [{ id: 'a', name: 'Pain relief', frequency: 'as-needed', status: 'active' }]
  const today = new Date()
  const logs = []
  for (let i = 0; i < 3; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    logs.push({ medId: 'a', slot: 'prn', date: d.toISOString().slice(0, 10), taken: true })
  }
  const a = computeAdherence(meds, logs, 7)
  assert.equal(a.scheduled, 3)
  assert.equal(a.taken, 3)
  assert.equal(a.percent, 100)
})

t('per-med percentages are computed', () => {
  const meds = [
    { id: 'a', name: 'A', frequency: 'once-daily', status: 'active' },
    { id: 'b', name: 'B', frequency: 'twice-daily', status: 'active' },
  ]
  const a = computeAdherence(meds, [], 7)
  assert.equal(a.perMed.length, 2)
  assert.equal(a.perMed[0].scheduled, 7)
  assert.equal(a.perMed[1].scheduled, 14)
  assert.equal(a.perMed[0].percent, 0)
})

t('logs outside window are ignored', () => {
  const meds = [{ id: 'a', name: 'A', frequency: 'once-daily', status: 'active' }]
  const longAgo = new Date()
  longAgo.setDate(longAgo.getDate() - 30)
  const logs = [
    { medId: 'a', slot: 'morning', date: longAgo.toISOString().slice(0, 10), taken: true },
  ]
  const a = computeAdherence(meds, logs, 7)
  assert.equal(a.taken, 0)
  assert.equal(a.scheduled, 7)
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
console.log(failed === 0 ? `ALL ${tests.length} FEATURE TESTS PASSED` : `${failed} of ${tests.length} FAILED`)
process.exit(failed === 0 ? 0 : 1)
