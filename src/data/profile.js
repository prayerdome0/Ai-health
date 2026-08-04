/**
 * Personal health profile reference data and helpers.
 * Educational reference, not medical guidance.
 */

export const SEX_OPTIONS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'intersex', label: 'Intersex' },
  { value: 'other', label: 'Other / prefer to self-describe' },
  { value: 'na', label: 'Prefer not to say' },
]

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown']

export const COMMON_CONDITIONS = [
  'Hypertension',
  'Diabetes (Type 1)',
  'Diabetes (Type 2)',
  'Asthma',
  'COPD',
  'Heart disease',
  'Stroke (history)',
  'Kidney disease',
  'Liver disease',
  'Thyroid disorder',
  'Epilepsy',
  'Migraine',
  'Anxiety',
  'Depression',
  'Cancer (history)',
  'HIV',
  'Other',
]

export const COMMON_ALLERGIES = [
  'Penicillin',
  'Other antibiotics',
  'Aspirin',
  'NSAIDs (e.g. ibuprofen)',
  'Latex',
  'Peanuts',
  'Tree nuts',
  'Shellfish',
  'Eggs',
  'Milk / dairy',
  'Soy',
  'Wheat / gluten',
  'Bee / wasp stings',
  'Other',
]

/**
 * Approximate age from a YYYY-MM-DD date string. Returns null if invalid.
 */
export function ageFromDob(dob) {
  if (!dob) return null
  const d = new Date(dob + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age >= 0 && age < 130 ? age : null
}

/**
 * Compress a profile into a short string for the AI's context window.
 * Only includes fields the user has actually filled in.
 */
export function profileToContext(profile) {
  if (!profile) return null
  const parts = []
  if (profile.fullName) parts.push(`Name: ${profile.fullName}`)
  const age = ageFromDob(profile.dob)
  if (age != null) parts.push(`Age: ${age}`)
  if (profile.sex && profile.sex !== 'na') {
    const lbl = SEX_OPTIONS.find((s) => s.value === profile.sex)?.label || profile.sex
    parts.push(`Sex: ${lbl}`)
  }
  if (profile.bloodGroup && profile.bloodGroup !== 'Unknown') {
    parts.push(`Blood: ${profile.bloodGroup}`)
  }
  if (profile.heightCm) parts.push(`Height: ${profile.heightCm} cm`)
  if (profile.weightKg) parts.push(`Weight: ${profile.weightKg} kg`)
  if (profile.conditions?.length) {
    parts.push(`Conditions: ${profile.conditions.join(', ')}`)
  }
  if (profile.allergies?.length) {
    parts.push(`Allergies: ${profile.allergies.join(', ')}`)
  }
  return parts.length ? parts.join('; ') + '.' : null
}
