// Runtime smoke test: imports the built ESM bundle in Node with jsdom globals.
import { JSDOM } from 'jsdom'
import { readdirSync } from 'fs'
import { pathToFileURL } from 'url'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:4173/',
  pretendToBeVisual: true,
})

const { window } = dom
global.window = window
global.document = window.document
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true })
global.localStorage = window.localStorage
global.location = window.location
global.HTMLElement = window.HTMLElement
global.Node = window.Node
global.self = window
global.MutationObserver = window.MutationObserver
global.Event = window.Event
global.CustomEvent = window.CustomEvent
global.fetch = async (url) => {
  if (String(url).includes('/api/ai')) {
    return { ok: true, status: 200, json: async () => ({ available: false, model: null }) }
  }
  throw new Error('no network in test: ' + url)
}
window.fetch = global.fetch
window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }))
window.scrollTo = () => {}
window.requestAnimationFrame = (cb) => setTimeout(cb, 0)
window.cancelAnimationFrame = (id) => clearTimeout(id)
window.HTMLElement.prototype.scrollIntoView = function () {}
window.Element.prototype.scrollIntoView = function () {}

const waitFor = (ms) => new Promise((r) => setTimeout(r, ms))
const errors = []
window.addEventListener('error', (e) => errors.push('window error: ' + e.message))

try {
  const jsFile = readdirSync('dist/assets').find((f) => f.endsWith('.js'))
  await import(pathToFileURL(`dist/assets/${jsFile}`).href)

  await waitFor(1800)
  const root = window.document.getElementById('root')
  const text = () => (root ? root.textContent : '')

  const checks = []
  checks.push(['home renders', text().includes('Symptom guide') && text().includes('Check-in')])
  checks.push(['hero present', text().includes('Clarity for every')])
  checks.push(['disclaimer banner', text().includes('not a doctor')])

  for (const [route, needle] of [
    ['/doctors', 'Find a doctor, book a visit'],
    ['/pregnancy', 'Pregnancy tracker'],
    ['/emergency', 'Help, when it matters most'],
    ['/history', 'Your records'],
    ['/admin', 'Admin access required'],
    ['/signup', 'Create your Vitalis account'],
  ]) {
    window.location.hash = route
    await waitFor(350)
    checks.push([`route ${route}`, text().includes(needle)])
  }

  window.location.hash = '/'
  await waitFor(300)
  const buttons = [...window.document.querySelectorAll('.symptom')]
  buttons[0]?.click()
  buttons[6]?.click()
  await waitFor(200)
  const reviewBtn = [...window.document.querySelectorAll('button')].find((b) => b.textContent.includes('Review my symptoms'))
  reviewBtn?.click()
  await waitFor(500)
  checks.push(['urgent guidance shown', text().includes('Urgent care recommended')])
  checks.push(['AI review button shown', text().includes('Ask AI to review')])

  const aiReviewBtn = [...window.document.querySelectorAll('button')].find((b) => b.textContent.includes('Ask AI to review'))
  aiReviewBtn?.click()
  await waitFor(600)
  checks.push(['AI review offline reply', text().includes("I'm in offline mode")])

  const fab = [...window.document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Open AI assistant')
  fab?.click()
  await waitFor(300)
  checks.push(['AI chat opens', text().includes("Hi, I'm Vitalis")])

  let failed = 0
  for (const [name, ok] of checks) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
    if (!ok) failed++
  }
  console.log('----')
  console.log('jsdom errors:', errors.length ? errors : 'none')
  console.log(failed === 0 && errors.length === 0 ? 'SMOKE TEST OK' : 'SMOKE TEST FAILED')
  process.exit(failed === 0 && errors.length === 0 ? 0 : 1)
} catch (e) {
  console.error('Smoke test crashed:', e)
  process.exit(1)
}
