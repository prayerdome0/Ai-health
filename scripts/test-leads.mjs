import assert from 'node:assert/strict'
import {
  filterLeads,
  isMissingWebsite,
  leadsToCsv,
  makePlatformSearchUrl,
  mergeLeadLists,
  normalizeLead,
  parseLeadCsv,
} from '../src/data/leads.js'

const tests = []
const test = (name, fn) => tests.push([name, fn])

test('blank and placeholder websites qualify as no-site leads', () => {
  assert.equal(isMissingWebsite({ website: '' }), true)
  assert.equal(isMissingWebsite({ website: 'Not listed' }), true)
  assert.equal(isMissingWebsite({ website: 'n/a' }), true)
  assert.equal(isMissingWebsite({ website: 'https://example.com' }), false)
})

test('social and directory URLs do not count as an owned website', () => {
  assert.equal(isMissingWebsite({ website: 'https://www.instagram.com/example' }), true)
  assert.equal(isMissingWebsite({ website: 'linkedin.com/company/example' }), true)
  assert.equal(isMissingWebsite({ website: 'https://example.org' }), false)
})

test('CSV parser maps common columns and infers source from listing URL', () => {
  const rows = parseLeadCsv(
    'Business name,Category,City,Phone,Listing URL,Website,Notes\n"Blue, Oak",Salon,Lusaka,555-0100,https://www.yelp.com/biz/blue-oak,,Needs a booking page'
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'Blue, Oak')
  assert.equal(rows[0].category, 'Salon')
  assert.equal(rows[0].location, 'Lusaka')
  assert.equal(rows[0].source, 'Yelp')
  assert.equal(rows[0].listingUrl, 'https://www.yelp.com/biz/blue-oak')
  assert.equal(isMissingWebsite(rows[0]), true)
})

test('CSV parser supports tabs and keeps a generic URL as the listing', () => {
  const rows = parseLeadCsv(
    'Business\tLocation\tSource\tURL\tWebsite\nMoyo Cafe\tLusaka\tGoogle Maps\thttps://maps.google.com/example\t-'
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'Moyo Cafe')
  assert.equal(rows[0].listingUrl, 'https://maps.google.com/example')
  assert.equal(rows[0].website, '')
})

test('merge deduplicates by business, location, and source while keeping progress', () => {
  const first = normalizeLead({ name: 'Sunrise Clinic', location: 'Lusaka', source: 'Yelp', notes: 'Call Tuesday' })
  first.status = 'contacted'
  const merged = mergeLeadLists([first], [
    { name: 'Sunrise Clinic', location: 'Lusaka', source: 'Yelp', phone: '555-0101' },
  ])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].status, 'contacted')
  assert.equal(merged[0].notes, 'Call Tuesday')
  assert.equal(merged[0].phone, '555-0101')
})

test('filterLeads searches across name and location', () => {
  const leads = [
    normalizeLead({ name: 'Moyo Cafe', location: 'Lusaka', source: 'Google Maps' }),
    normalizeLead({ name: 'River Salon', location: 'Kitwe', source: 'Yelp' }),
  ]
  assert.equal(filterLeads(leads, { query: 'lusaka' }).length, 1)
  assert.equal(filterLeads(leads, { source: 'Yelp' })[0].name, 'River Salon')
})

test('platform URLs encode category and location', () => {
  const maps = makePlatformSearchUrl('Google Maps', 'dentists', 'Lusaka, Zambia')
  const yelp = makePlatformSearchUrl('Yelp', 'salons', 'Kitwe')
  const linkedin = makePlatformSearchUrl('LinkedIn', 'accountants', 'Zambia')
  assert.match(maps, /google\.com\/maps\/search/)
  assert.match(maps, /dentists%20Lusaka%2C%20Zambia/)
  assert.match(yelp, /find_desc=salons/)
  assert.match(linkedin, /linkedin\.com\/search\/results\/companies/)
})

test('CSV export quotes commas and includes lead fields', () => {
  const csv = leadsToCsv([
    normalizeLead({ name: 'Blue, Oak', location: 'Lusaka', source: 'Yelp', notes: 'Warm lead' }),
  ])
  assert.match(csv, /^Business name,Category,Location/)
  assert.match(csv, /"Blue, Oak"/)
  assert.match(csv, /Warm lead/)
})

let failed = 0
for (const [name, fn] of tests) {
  try {
    fn()
    console.log(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${name}`)
    console.log(`      ${error.message || error}`)
  }
}
console.log('----')
console.log(failed === 0 ? `ALL ${tests.length} LEAD TESTS PASSED` : `${failed} of ${tests.length} FAILED`)
process.exit(failed === 0 ? 0 : 1)
