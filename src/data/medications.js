/**
 * Medication frequency helpers for the Vitalis Medications log.
 * Time-of-day keys: morning (08:00), noon (12:00), evening (18:00), night (22:00).
 */

export const TIMINGS = [
  { key: 'morning', label: 'Morning', time: '08:00' },
  { key: 'noon', label: 'Noon', time: '12:00' },
  { key: 'evening', label: 'Evening', time: '18:00' },
  { key: 'night', label: 'Night', time: '22:00' },
]

export const FREQUENCIES = [
  { key: 'once-daily', label: 'Once daily', slots: ['morning'] },
  { key: 'twice-daily', label: 'Twice daily', slots: ['morning', 'evening'] },
  { key: 'three-times-daily', label: 'Three times a day', slots: ['morning', 'noon', 'evening'] },
  { key: 'four-times-daily', label: 'Four times a day', slots: ['morning', 'noon', 'evening', 'night'] },
  { key: 'as-needed', label: 'As needed (PRN)', slots: [] },
]

export function frequencyFor(key) {
  return FREQUENCIES.find((f) => f.key === key) || FREQUENCIES[0]
}

export function timingsForFrequency(key) {
  return frequencyFor(key).slots
    .map((s) => TIMINGS.find((t) => t.key === s))
    .filter(Boolean)
}

/**
 * Compute adherence over the last `days` days for a list of medications.
 * Each medication has scheduled slots per day; we check the user's `takenLogs`.
 * @param {Array} medications
 * @param {Array} takenLogs - { medId, slot, date (YYYY-MM-DD), takenAt }
 * @param {number} days
 * @returns {{ taken: number, scheduled: number, percent: number, perMed: Array }}
 */
export function computeAdherence(medications, takenLogs, days = 7) {
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
      // PRN: count actual logs as scheduled/taken 1:1 in the window.
      const logs = (takenLogs || []).filter(
        (l) => l.medId === med.id && dates.includes(l.date),
      )
      medScheduled = logs.length
      medTaken = logs.length
    } else {
      for (const d of dates) {
        for (const s of slots) {
          medScheduled++
          const log = (takenLogs || []).find(
            (l) => l.medId === med.id && l.slot === s && l.date === d,
          )
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

/**
 * Today's checklist — for each med, which slots have been taken / are due.
 */
export function todaysChecklist(medications, takenLogs) {
  const today = new Date().toISOString().slice(0, 10)
  return medications
    .filter((m) => m.status !== 'stopped')
    .map((m) => {
      const slots =
        m.frequency === 'as-needed'
          ? []
          : timingsForFrequency(m.frequency).map((t) => t.key)
      const items = slots.map((s) => {
        const log = (takenLogs || []).find(
          (l) => l.medId === m.id && l.slot === s && l.date === today,
        )
        return { slot: s, taken: !!(log && log.taken), log }
      })
      return { med: m, items, isPrn: m.frequency === 'as-needed' }
    })
}

export function todayString() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}
