/**
 * Vital types and reference ranges for the Vitals Tracker.
 * Reference ranges are general adult wellness ranges only — they are NOT
 * medical guidelines and do not replace advice from a clinician. Each user
 * may have personal targets; we surface those if set.
 */

export const VITAL_TYPES = [
  {
    key: 'bp',
    label: 'Blood pressure',
    short: 'BP',
    unit: 'mmHg',
    icon: 'HeartPulse',
    hasTwo: true, // systolic / diastolic
    twoLabels: ['Systolic', 'Diastolic'],
    fields: [
      { name: 'systolic', label: 'Systolic (top)', placeholder: '120', step: 1 },
      { name: 'diastolic', label: 'Diastolic (bottom)', placeholder: '80', step: 1 },
    ],
    summary: (v) => `${v.systolic ?? '—'}/${v.diastolic ?? '—'} mmHg`,
    range: { low: '90/60', normal: '120/80', high: '140/90', danger: '180/120' },
    category: (v) => bpCategory(v.systolic, v.diastolic),
    notes: 'Two numbers per reading. Sit quietly for 5 minutes before measuring.',
  },
  {
    key: 'hr',
    label: 'Heart rate',
    short: 'HR',
    unit: 'bpm',
    icon: 'Activity',
    hasTwo: false,
    fields: [{ name: 'value', label: 'Beats per minute', placeholder: '72', step: 1 }],
    summary: (v) => `${v.value ?? '—'} bpm`,
    range: { low: '< 50', normal: '60–100', high: '100–120', danger: '> 120 (resting)' },
    category: (v) => {
      const n = Number(v.value)
      if (!Number.isFinite(n)) return 'unknown'
      if (n < 50) return 'low'
      if (n <= 100) return 'normal'
      if (n <= 120) return 'high'
      return 'danger'
    },
    notes: 'Resting heart rate. Measure when you have been sitting for 5+ minutes.',
  },
  {
    key: 'glucose',
    label: 'Blood glucose',
    short: 'Glucose',
    unit: 'mg/dL',
    icon: 'Droplet',
    hasTwo: false,
    fields: [{ name: 'value', label: 'mg/dL', placeholder: '95', step: 1 }],
    summary: (v) => `${v.value ?? '—'} mg/dL`,
    range: { low: '< 70', normal: '70–100 (fasting)', high: '100–125', danger: '> 200 or < 54' },
    category: (v) => {
      const n = Number(v.value)
      if (!Number.isFinite(n)) return 'unknown'
      if (n < 54) return 'danger'
      if (n < 70) return 'low'
      if (n <= 125) return 'normal'
      if (n <= 200) return 'high'
      return 'danger'
    },
    notes: 'Fasting readings are taken before eating. Track the time of day for context.',
  },
  {
    key: 'weight',
    label: 'Weight',
    short: 'Weight',
    unit: 'kg',
    icon: 'Scale',
    hasTwo: false,
    fields: [{ name: 'value', label: 'Kilograms', placeholder: '70', step: 0.1 }],
    summary: (v) => `${v.value ?? '—'} kg`,
    range: { low: '—', normal: '—', high: '—', danger: '—' },
    category: () => 'normal',
    notes: 'Weigh yourself at the same time of day for the most consistent trends.',
  },
  {
    key: 'temperature',
    label: 'Body temperature',
    short: 'Temp',
    unit: '°C',
    icon: 'Thermometer',
    hasTwo: false,
    fields: [{ name: 'value', label: 'Celsius', placeholder: '36.8', step: 0.1 }],
    summary: (v) => `${v.value ?? '—'} °C`,
    range: { low: '< 35.5', normal: '36.1–37.2', high: '37.3–38.0', danger: '> 39.0' },
    category: (v) => {
      const n = Number(v.value)
      if (!Number.isFinite(n)) return 'unknown'
      if (n < 35.5) return 'danger'
      if (n <= 37.2) return 'normal'
      if (n <= 38) return 'high'
      return 'danger'
    },
    notes: 'Oral temperature. Rectal readings are typically 0.3–0.5 °C higher.',
  },
  {
    key: 'spo2',
    label: 'Oxygen saturation',
    short: 'SpO₂',
    unit: '%',
    icon: 'Wind',
    hasTwo: false,
    fields: [{ name: 'value', label: 'Percent', placeholder: '98', step: 1 }],
    summary: (v) => `${v.value ?? '—'} %`,
    range: { low: '90–94', normal: '95–100', high: '—', danger: '< 90' },
    category: (v) => {
      const n = Number(v.value)
      if (!Number.isFinite(n)) return 'unknown'
      if (n < 90) return 'danger'
      if (n < 95) return 'low'
      return 'normal'
    },
    notes: 'If you have a lung condition, your personal target may differ — ask your clinician.',
  },
  {
    key: 'sleep',
    label: 'Sleep',
    short: 'Sleep',
    unit: 'h',
    icon: 'Moon',
    hasTwo: false,
    fields: [{ name: 'value', label: 'Hours', placeholder: '7.5', step: 0.25 }],
    summary: (v) => `${v.value ?? '—'} h`,
    range: { low: '< 6', normal: '7–9', high: '—', danger: '—' },
    category: (v) => {
      const n = Number(v.value)
      if (!Number.isFinite(n)) return 'unknown'
      if (n < 6) return 'low'
      if (n <= 9) return 'normal'
      return 'high'
    },
    notes: 'Track total sleep time (not time in bed). Quality matters as much as quantity.',
  },
]

export function getVital(key) {
  return VITAL_TYPES.find((v) => v.key === key) || null
}

function bpCategory(sys, dia) {
  const s = Number(sys)
  const d = Number(dia)
  if (!Number.isFinite(s) || !Number.isFinite(d)) return 'unknown'
  if (s >= 180 || d >= 120) return 'danger'
  if (s >= 140 || d >= 90) return 'high'
  if (s >= 130 || d >= 80) return 'high'
  if (s < 90 || d < 60) return 'low'
  return 'normal'
}

export const CATEGORY_LABELS = {
  normal: 'Normal',
  low: 'Low',
  high: 'High',
  danger: 'Urgent range',
  unknown: '—',
}
