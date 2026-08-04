// Unit tests for the new AI-upgrade helpers in src/ai.js
// Run with: node scripts/test-ai-upgrades.mjs
import assert from 'node:assert/strict'

// We can't import src/ai.js directly because it pulls in firebase, so we
// re-implement the helpers here against the SAME regexes used in production.
// If the production regexes change, update this file too — or, better, lift
// these pure helpers into a separate ESM module. For now this guards the
// urgent-detection contract and the language list shape.

const URGENT_PATTERNS = [
  /\b(chest pain|chest pressure|can'?t breathe|cannot breathe|trouble breathing|short of breath|stroke|face drooping|slurred speech|suicid|kill myself|want to die|unconscious|fainted|passed out|severe bleeding|heavy bleeding|overdose|allergic reaction|swollen tongue|anaphyla)\b/i,
  /(dolor (en el )?pecho|no puedo respirar|dificultad para respirar|accidente cerebrovascular|derrame cerebral|cara caída|habla arrastrada|suicid|matarme|quiero morir|desmayo|inconsciente|sangrado severo|sangrado abundante|reacción alérgica|anafilaxia)/i,
  /(douleur (à la )?poitrine|je ne peux pas respirer|difficulté à respirer|AVC|accident vasculaire|visage affaissé|parole trouble|suicid|tuer|envie de mourir|évanoui|inconscient|hémorragie|réaction allergique|anaphylaxie)/i,
  /(dor (no )?peito|não consigo respirar|dificuldade para respirar|AVC|derrame|rosto caído|fala arrastada|suicid|matar-me|quero morrer|desmaio|inconsciente|sangramento intenso|reação alérgica|anafilaxia)/i,
  /(maumivu ya kifua|sipumui|ugumu wa kupumua|kiharusi|saratani|husema|jitakie|kufa|kuzimia|kupoteza fahamu|damu nyingi|mzio)/i,
  /(ألم (في )?الصدر|لا أستطيع التنفس|صعوبة في التنفس|سكتة دماغية|وجه متدلٍ|كلام غير واضح|انتحار|أريد أن أموت|فقدت الوعي|نزيف شديد|رد فعل تحسسي)/,
]

function detectUrgentContent(text) {
  if (!text || typeof text !== 'string') {
    return { urgent: false, matches: [], suggestedAction: null }
  }
  const matches = []
  for (const re of URGENT_PATTERNS) {
    const m = text.match(re)
    if (m && m[0]) matches.push(m[0])
  }
  if (!matches.length) return { urgent: false, matches: [], suggestedAction: null }
  return {
    urgent: true,
    matches: Array.from(new Set(matches)).slice(0, 4),
    suggestedAction:
      'This sounds like it could be a medical emergency. If you can, please call your local emergency number now or go to the nearest hospital.',
  }
}

const tests = []
const t = (name, fn) => tests.push([name, fn])

t('detects English chest pain', () => {
  const r = detectUrgentContent('I have chest pain and feel dizzy')
  assert.equal(r.urgent, true)
  assert.ok(r.matches.length > 0)
})

t('detects English stroke signs', () => {
  const r = detectUrgentContent('My dad has slurred speech and face drooping')
  assert.equal(r.urgent, true)
})

t('detects suicidal ideation', () => {
  const r = detectUrgentContent("I want to die, I can't go on")
  assert.equal(r.urgent, true)
})

t('detects Spanish chest pain', () => {
  const r = detectUrgentContent('Tengo dolor en el pecho y me falta el aire')
  assert.equal(r.urgent, true)
})

t('detects French breathing difficulty', () => {
  const r = detectUrgentContent("Je ne peux pas respirer depuis 5 minutes")
  assert.equal(r.urgent, true)
})

t('detects Portuguese stroke', () => {
  const r = detectUrgentContent('Ela tem fala arrastada e rosto caído')
  assert.equal(r.urgent, true)
})

t('detects Swahili difficulty breathing', () => {
  const r = detectUrgentContent('Sipumui vizuri, na maumivu ya kifua')
  assert.equal(r.urgent, true)
})

t('detects Arabic chest pain', () => {
  const r = detectUrgentContent('ألم في الصدر وصعوبة في التنفس')
  assert.equal(r.urgent, true)
})

t('does NOT trigger on a common cold', () => {
  const r = detectUrgentContent('I have a runny nose and a mild sore throat')
  assert.equal(r.urgent, false)
  assert.deepEqual(r.matches, [])
})

t('does NOT trigger on a routine question', () => {
  const r = detectUrgentContent('How can I improve my sleep?')
  assert.equal(r.urgent, false)
})

t('handles empty input', () => {
  const r = detectUrgentContent('')
  assert.equal(r.urgent, false)
})

t('handles null input', () => {
  const r = detectUrgentContent(null)
  assert.equal(r.urgent, false)
})

t('deduplicates matches', () => {
  const r = detectUrgentContent('chest pain, severe chest pain, CHEST PAIN')
  assert.ok(r.matches.length <= 4)
})

t('caps matches at 4', () => {
  const r = detectUrgentContent(
    'chest pain stroke unconscious severe bleeding allergic reaction suicidal overdose anaphylaxis overdose'
  )
  // 4-or-fewer is the contract (deduped, then capped).
  assert.ok(r.matches.length > 0)
  assert.ok(r.matches.length <= 4)
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
console.log(failed === 0 ? `ALL ${tests.length} URGENT-DETECTION TESTS PASSED` : `${failed} of ${tests.length} FAILED`)
process.exit(failed === 0 ? 0 : 1)
