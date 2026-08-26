const PLACEHOLDER_WEBSITES = new Set([
  '',
  '-',
  '—',
  'n/a',
  'na',
  'none',
  'no',
  'no website',
  'not listed',
  'not available',
  'unknown',
  'null',
  'undefined',
])

const SOCIAL_HOSTS = [
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'yelp.com',
  'google.com',
  'goo.gl',
]

export const LEAD_STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'researched', label: 'Researched' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'not-a-fit', label: 'Not a fit' },
]

export const LEAD_SOURCES = ['Google Maps', 'Yelp', 'LinkedIn', 'Other']

function firstValue(...values) {
  return values.find((value) => value != null && String(value).trim() !== '') || ''
}

function clean(value) {
  return String(value ?? '').trim()
}

function headerKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function validStatus(value) {
  const candidate = clean(value).toLowerCase().replace(/\s+/g, '-')
  return LEAD_STATUSES.some((status) => status.value === candidate) ? candidate : 'new'
}

export function normalizeWebsite(value) {
  const website = clean(value)
  return PLACEHOLDER_WEBSITES.has(website.toLowerCase()) ? '' : website
}

function hostnameFor(value) {
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`
    return new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function isSocialOnlyWebsite(value) {
  const hostname = hostnameFor(value)
  return Boolean(
    hostname &&
      SOCIAL_HOSTS.some(
        (host) => hostname === host || hostname.endsWith(`.${host}`)
      )
  )
}

/**
 * A social profile or directory listing is not an owned business website.
 * This keeps the lead list useful when a platform exports a social URL in its
 * website column instead of leaving it blank.
 */
export function isMissingWebsite(lead) {
  const website = normalizeWebsite(lead?.website)
  return !website || isSocialOnlyWebsite(website)
}

export function canonicalSource(value) {
  const source = clean(value).toLowerCase()
  if (source.includes('google') || source.includes('maps')) return 'Google Maps'
  if (source.includes('yelp')) return 'Yelp'
  if (source.includes('linkedin')) return 'LinkedIn'
  return 'Other'
}

function withProtocol(value) {
  const url = clean(value)
  if (!url || !/^https?:\/\//i.test(url)) return url
  return url
}

function sourceFromListingUrl(value) {
  return canonicalSource(value)
}

function stableId(name, location, source, index = 0) {
  const seed = `${name}|${location}|${source}|${index}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `lead-${seed || 'unknown'}-${Date.now()}-${index}`
}

export function normalizeLead(input = {}, index = 0) {
  const name = clean(
    firstValue(
      input.name,
      input.businessName,
      input.companyName,
      input.business,
      input.company,
      input.organization,
      input.organisation
    )
  )
  const location = clean(
    firstValue(input.location, input.city, input.address, input.area, input.region)
  )
  const listingUrl = withProtocol(
    firstValue(
      input.listingUrl,
      input.profileUrl,
      input.listing,
      input.mapsUrl,
      input.yelpUrl,
      input.linkedinUrl,
      input.url,
      input.link
    )
  )
  const sourceValue = firstValue(
    input.source,
    input.platform,
    input.foundOn,
    input.origin,
    listingUrl
  )
  const source = canonicalSource(sourceValue)
  const createdAt = input.createdAt instanceof Date
    ? input.createdAt.toISOString()
    : clean(input.createdAt) || new Date().toISOString()

  return {
    id: clean(input.id) || stableId(name, location, source, index),
    name,
    category: clean(
      firstValue(input.category, input.industry, input.type, input.businessCategory)
    ),
    location,
    phone: clean(firstValue(input.phone, input.telephone, input.tel, input.phoneNumber)),
    email: clean(firstValue(input.email, input.emailAddress)),
    source,
    listingUrl,
    website: normalizeWebsite(
      firstValue(input.website, input.websiteUrl, input.companyWebsite, input.web)
    ),
    status: validStatus(input.status),
    notes: clean(firstValue(input.notes, input.note)),
    createdAt,
  }
}

function parseDelimited(text, delimiter) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"') {
      if (quoted && next === '"') {
        field += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (char === delimiter && !quoted) {
      row.push(field)
      field = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1
      row.push(field)
      field = ''
      if (row.some((cell) => clean(cell))) rows.push(row)
      row = []
    } else {
      field += char
    }
  }

  row.push(field)
  if (row.some((cell) => clean(cell))) rows.push(row)
  return rows
}

const COLUMN_ALIASES = {
  name: ['name', 'business', 'businessname', 'company', 'companyname', 'organization', 'organisation'],
  category: ['category', 'industry', 'type', 'businesscategory'],
  location: ['location', 'city', 'address', 'area', 'region'],
  phone: ['phone', 'telephone', 'tel', 'phonenumber'],
  email: ['email', 'emailaddress'],
  website: ['website', 'websiteurl', 'companywebsite', 'web', 'websitelink', 'domain'],
  source: ['source', 'platform', 'foundon', 'origin', 'directory'],
  listingUrl: [
    'listingurl',
    'listing',
    'profileurl',
    'mapsurl',
    'googlemapsurl',
    'yelpurl',
    'linkedinurl',
    'url',
    'link',
  ],
  status: ['status', 'leadstatus'],
  notes: ['notes', 'note', 'description'],
}

function valueForColumn(row, headers, aliases) {
  const index = headers.findIndex((header) => aliases.includes(header))
  return index === -1 ? '' : row[index] || ''
}

/**
 * Parse a CSV or tab-separated export. Generic URL columns are treated as the
 * directory listing URL; only an explicit Website column can disqualify a row.
 */
export function parseLeadCsv(text) {
  const raw = clean(text)
  if (!raw) return []
  const firstLine = raw.split(/\r?\n/, 1)[0]
  const delimiter = firstLine.includes('\t') ? '\t' : ','
  const rows = parseDelimited(raw, delimiter)
  if (rows.length < 2) return []

  const headers = rows[0].map(headerKey)
  return rows
    .slice(1)
    .map((row, index) => {
      const listingUrl = valueForColumn(row, headers, COLUMN_ALIASES.listingUrl)
      const source = valueForColumn(row, headers, COLUMN_ALIASES.source)
      return normalizeLead(
        {
          name: valueForColumn(row, headers, COLUMN_ALIASES.name),
          category: valueForColumn(row, headers, COLUMN_ALIASES.category),
          location: valueForColumn(row, headers, COLUMN_ALIASES.location),
          phone: valueForColumn(row, headers, COLUMN_ALIASES.phone),
          email: valueForColumn(row, headers, COLUMN_ALIASES.email),
          website: valueForColumn(row, headers, COLUMN_ALIASES.website),
          source: source || sourceFromListingUrl(listingUrl),
          listingUrl,
          status: valueForColumn(row, headers, COLUMN_ALIASES.status),
          notes: valueForColumn(row, headers, COLUMN_ALIASES.notes),
        },
        index
      )
    })
    .filter((lead) => lead.name)
}

export function leadIdentity(lead) {
  return [lead?.name, lead?.location, lead?.source]
    .map((value) => clean(value).toLowerCase())
    .join('|')
}

export function mergeLeadLists(existing = [], incoming = []) {
  const merged = existing.map((lead, index) => normalizeLead(lead, index))
  for (const rawLead of incoming) {
    const lead = normalizeLead(rawLead, merged.length)
    if (!lead.name) continue
    const matchIndex = merged.findIndex(
      (candidate) => leadIdentity(candidate) === leadIdentity(lead)
    )
    if (matchIndex === -1) {
      merged.push(lead)
      continue
    }
    const current = merged[matchIndex]
    merged[matchIndex] = {
      ...current,
      ...lead,
      id: current.id,
      status: current.status || lead.status,
      notes: current.notes || lead.notes,
    }
  }
  return merged
}

export function filterLeads(leads, { query = '', source = 'All', status = 'All' } = {}) {
  const term = clean(query).toLowerCase()
  return leads.filter((lead) => {
    const matchesSource = source === 'All' || lead.source === source
    const matchesStatus = status === 'All' || lead.status === status
    const haystack = [lead.name, lead.category, lead.location, lead.phone, lead.email, lead.source]
      .join(' ')
      .toLowerCase()
    return matchesSource && matchesStatus && (!term || haystack.includes(term))
  })
}

export function makePlatformSearchUrl(source, category = '', location = '') {
  const type = clean(category) || 'local businesses'
  const place = clean(location)
  const query = [type, place].filter(Boolean).join(' ')

  if (source === 'Google Maps') {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
  }
  if (source === 'Yelp') {
    return `https://www.yelp.com/search?find_desc=${encodeURIComponent(type)}&find_loc=${encodeURIComponent(place)}`
  }
  if (source === 'LinkedIn') {
    return `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(query)}`
  }
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`
}

function csvCell(value) {
  const cell = clean(value)
  return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

export function leadsToCsv(leads = []) {
  const headers = [
    'Business name',
    'Category',
    'Location',
    'Phone',
    'Email',
    'Source',
    'Listing URL',
    'Website',
    'Status',
    'Notes',
  ]
  const rows = leads.map((lead) =>
    [
      lead.name,
      lead.category,
      lead.location,
      lead.phone,
      lead.email,
      lead.source,
      lead.listingUrl,
      lead.website,
      lead.status,
      lead.notes,
    ]
      .map(csvCell)
      .join(',')
  )
  return [headers.join(','), ...rows].join('\n')
}
