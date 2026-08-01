/**
 * Pregnancy tracker reference data: weekly milestones, trimester info and
 * offline fallback tips. Educational content — not medical advice.
 */
export const trimesterInfo = [
  { trimester: 1, label: 'First trimester', weeks: 'Weeks 1–12', color: '#168070' },
  { trimester: 2, label: 'Second trimester', weeks: 'Weeks 13–27', color: '#1b8a99' },
  { trimester: 3, label: 'Third trimester', weeks: 'Weeks 28–40', color: '#b65c1c' },
]

export const weekMilestones = [
  { week: 1, title: 'Your journey begins', text: 'Pregnancy is counted from the first day of your last period, so these early weeks are about preparing your body.', tip: 'Start a daily folic acid (folate) supplement if you have not already, and aim for balanced meals.' },
  { week: 4, title: 'Implantation', text: 'The embryo implants in the lining of the uterus. Many people first notice a missed period around now.', tip: 'Book an early antenatal visit and discuss any medicines you take with your clinician.' },
  { week: 8, title: 'Heartbeat begins', text: 'The baby’s heart is beating and tiny limb buds are forming. Morning sickness often peaks around this time.', tip: 'Small, frequent meals and plenty of fluids can help with nausea. Rest when you can.' },
  { week: 12, title: 'First trimester complete', text: 'Major organs have formed. Many clinics offer a first ultrasound around weeks 11–13.', tip: 'Ask your clinician about the first-trimester screening and any tests recommended for you.' },
  { week: 16, title: 'Movement felt', text: 'Some people feel early flutters ("quickening") between weeks 16 and 20.', tip: 'Continue regular antenatal visits. Keep a note of questions to ask your clinician.' },
  { week: 20, title: 'Halfway point', text: 'The baby can hear sounds now. The anatomy scan usually happens between 18 and 22 weeks.', tip: 'The anatomy scan checks development — bring your partner or a support person if you can.' },
  { week: 24, title: 'Viability milestone', text: 'Babies born after 24 weeks have a chance of survival with specialist care, though most need a long NICU stay.', tip: 'Ask about warning signs like bleeding, severe headache, or reduced movement — know when to call.' },
  { week: 28, title: 'Third trimester begins', text: 'The baby is growing quickly and may respond to light and sound. Kicks should feel regular.', tip: 'Count kicks daily if your clinician recommends it. Report any big change in movement right away.' },
  { week: 32, title: 'Getting ready', text: 'The baby usually settles head-down around now. You may feel more tired and short of breath.', tip: 'Plan your birth route: how you will reach the hospital and who will drive you.' },
  { week: 36, title: 'Full term approaches', text: 'The baby is likely head-down and engaged. Your hospital bag and birth plan should be ready.', tip: 'Pack your bag now: documents, clothes, toiletries, phone charger, and baby clothes.' },
  { week: 40, title: 'Due date week', text: 'Only about 5% of babies arrive exactly on their due date — normal births happen between 37 and 42 weeks.', tip: 'Stay active within comfort, rest well, and call your maternity unit with any concerns.' },
]

export const pregnancyWarningSigns = [
  'Heavy vaginal bleeding or gush of fluid (waters breaking early)',
  'Severe headache that will not go away, with vision changes',
  'Severe pain in the belly, especially with shoulder pain',
  'Baby moving noticeably less than usual',
  'Fever, chills, or painful urination',
  'Swelling of the face, hands, or sudden swelling of feet',
  'Fainting, confusion, or seizures',
]

/** Offline fallback tips shown when the AI service is not reachable. */
export const offlineWeekTip = (week) => {
  const milestone = weekMilestones.filter((m) => m.week <= week).slice(-1)[0]
  const base = milestone
    ? `This week (week ${week}) is a growth phase — ${milestone.tip}`
    : 'Keep up your antenatal appointments, eat balanced meals, and rest well.'
  return (
    base +
    ' Always contact your midwife or clinician with any worry — especially bleeding, severe pain, or reduced baby movement.'
  )
}

export function trimesterForWeek(week) {
  if (week <= 12) return trimesterInfo[0]
  if (week <= 27) return trimesterInfo[1]
  return trimesterInfo[2]
}
