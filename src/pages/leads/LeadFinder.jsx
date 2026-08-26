import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Clipboard,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  Globe2,
  Info,
  Linkedin,
  ListFilter,
  Map,
  MessageSquare,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Target,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react'
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  filterLeads,
  isMissingWebsite,
  leadsToCsv,
  makePlatformSearchUrl,
  mergeLeadLists,
  normalizeLead,
  parseLeadCsv,
} from '../../data/leads'

const STORAGE_KEY = 'vitalis_lead_finder_v1'

const EMPTY_FORM = {
  name: '',
  category: '',
  location: '',
  phone: '',
  email: '',
  source: 'Google Maps',
  listingUrl: '',
  website: '',
  notes: '',
}

const PLATFORM_CARDS = [
  {
    source: 'Google Maps',
    short: 'G',
    icon: Map,
    description: 'Search local listings and check whether the Website button is missing.',
    tone: 'maps',
  },
  {
    source: 'Yelp',
    short: 'Y',
    icon: Search,
    description: 'Open business pages and look for listings with no business website.',
    tone: 'yelp',
  },
  {
    source: 'LinkedIn',
    short: 'in',
    icon: Linkedin,
    description: 'Review company pages and capture small businesses without a site.',
    tone: 'linkedin',
  },
]

const SAMPLE_IMPORT = `Business name,Category,Location,Phone,Source,Listing URL,Website,Notes
Example Dental Studio,Dentist,Your city,555-0100,Google Maps,https://maps.google.com/, ,Ask about a simple booking page`

function loadLeads() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return []
    const parsed = JSON.parse(saved)
    return Array.isArray(parsed)
      ? parsed.map((lead, index) => normalizeLead(lead, index)).filter((lead) => lead.name)
      : []
  } catch {
    return []
  }
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function safeExternalUrl(value) {
  const url = String(value || '').trim()
  if (!url) return ''
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

function statusLabel(value) {
  return LEAD_STATUSES.find((status) => status.value === value)?.label || 'New'
}

export default function LeadFinder() {
  const [leads, setLeads] = useState(loadLeads)
  const [criteria, setCriteria] = useState({ category: '', location: '', radius: '10 miles' })
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [importOpen, setImportOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(leads))
    } catch {
      // Local storage is a convenience; the workspace remains usable if it is blocked.
    }
  }, [leads])

  const noSiteLeads = useMemo(() => leads.filter(isMissingWebsite), [leads])
  const visibleLeads = useMemo(
    () =>
      filterLeads(noSiteLeads, {
        query,
        source: sourceFilter,
        status: statusFilter,
      }),
    [noSiteLeads, query, sourceFilter, statusFilter]
  )
  const activeLeads = useMemo(
    () => noSiteLeads.filter((lead) => !['contacted', 'not-a-fit'].includes(lead.status)),
    [noSiteLeads]
  )
  const sourceCount = new Set(noSiteLeads.map((lead) => lead.source)).size

  const updateCriteria = (key, value) => {
    setCriteria((current) => ({ ...current, [key]: value }))
  }

  const updateLead = (id, changes) => {
    setLeads((current) =>
      current.map((lead) => (lead.id === id ? { ...lead, ...changes } : lead))
    )
  }

  const addSingleLead = (event) => {
    event.preventDefault()
    const lead = normalizeLead(form)
    if (!lead.name) {
      setMessage('Add a business name before saving the lead.')
      return
    }
    if (!isMissingWebsite(lead)) {
      setMessage('This listing has an owned website, so it was not added to the no-site list.')
      return
    }
    setLeads((current) => mergeLeadLists(current, [lead]))
    setForm(EMPTY_FORM)
    setAddOpen(false)
    setMessage(`${lead.name} added to your lead list.`)
  }

  const importListings = (event) => {
    event?.preventDefault()
    const parsed = parseLeadCsv(importText)
    if (!parsed.length) {
      setMessage('No rows found. Include a Business name column and at least one listing row.')
      return
    }
    const qualified = parsed.filter(isMissingWebsite)
    const skipped = parsed.length - qualified.length
    if (!qualified.length) {
      setMessage('Every imported row has an owned website, so there are no no-site leads to add.')
      return
    }
    setLeads((current) => mergeLeadLists(current, qualified))
    setImportText('')
    setImportOpen(false)
    setMessage(
      `${qualified.length} no-site ${qualified.length === 1 ? 'lead' : 'leads'} added${
        skipped ? ` · ${skipped} row${skipped === 1 ? '' : 's'} skipped because a website was present` : ''
      }.`
    )
  }

  const readImportFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      setImportText(await file.text())
      setImportOpen(true)
      setMessage(`${file.name} loaded. Review the rows, then import them.`)
    } catch {
      setMessage('That file could not be read. Try a CSV or TSV file.')
    } finally {
      event.target.value = ''
    }
  }

  const exportLeads = () => {
    if (!noSiteLeads.length) {
      setMessage('Add at least one no-site lead before exporting.')
      return
    }
    const blob = new Blob([leadsToCsv(noSiteLeads)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'no-site-leads.csv'
    link.click()
    URL.revokeObjectURL(url)
    setMessage(`${noSiteLeads.length} lead${noSiteLeads.length === 1 ? '' : 's'} exported.`)
  }

  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(SAMPLE_IMPORT)
      setCopied(true)
      setMessage('CSV template copied to your clipboard.')
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setImportText(SAMPLE_IMPORT)
      setMessage('Template placed in the import box. Copy it from there.')
    }
  }

  const openAddForm = () => {
    setForm({
      ...EMPTY_FORM,
      category: criteria.category,
      location: criteria.location,
    })
    setAddOpen(true)
    setImportOpen(false)
    setMessage('')
  }

  const clearFilters = () => {
    setQuery('')
    setSourceFilter('All')
    setStatusFilter('All')
  }

  return (
    <section className="page leads-page">
      <div className="page-head lead-page-head">
        <p className="overline">
          <Target size={14} /> LEAD FINDER
        </p>
        <h1>Find businesses that need a website.</h1>
        <p>
          Search public business directories, bring the listings here, and keep a
          clean list of companies with no owned website to pitch. No guessing,
          no scraped personal data, and no duplicate busywork.
        </p>
      </div>

      <div className="lead-workflow-note">
        <ShieldCheck size={19} />
        <div>
          <strong>Public listing workflow</strong>
          <span>
            Search LinkedIn, Yelp, or Google Maps yourself, then paste or import
            the public listing data. Vitalis does not log in, bypass protections,
            or scrape these platforms.
          </span>
        </div>
      </div>

      <section className="lead-discovery panel">
        <div className="panel-head">
          <div>
            <h2>1. Choose what to look for</h2>
            <p>Use a focused category and location to create better source searches.</p>
          </div>
          <Target size={20} />
        </div>
        <div className="lead-criteria-grid">
          <label className="lead-field">
            <span>Business type or niche</span>
            <input
              value={criteria.category}
              onChange={(event) => updateCriteria('category', event.target.value)}
              placeholder="e.g. dentists, salons, plumbers"
            />
          </label>
          <label className="lead-field">
            <span>City, region, or country</span>
            <input
              value={criteria.location}
              onChange={(event) => updateCriteria('location', event.target.value)}
              placeholder="e.g. Lusaka, Zambia"
            />
          </label>
          <label className="lead-field lead-radius-field">
            <span>Search radius</span>
            <select
              value={criteria.radius}
              onChange={(event) => updateCriteria('radius', event.target.value)}
            >
              <option>5 miles</option>
              <option>10 miles</option>
              <option>25 miles</option>
              <option>50 miles</option>
            </select>
          </label>
        </div>
        <div className="lead-platform-label">
          <span>2. Open a source search</span>
          <small>Look for a blank Website field, then capture the listing.</small>
        </div>
        <div className="lead-platform-grid">
          {PLATFORM_CARDS.map(({ source, short, icon: Icon, description, tone }) => (
            <a
              className={`lead-platform-card ${tone}`}
              href={makePlatformSearchUrl(source, criteria.category, criteria.location)}
              target="_blank"
              rel="noreferrer"
              key={source}
            >
              <span className="lead-platform-icon">
                {source === 'LinkedIn' ? <Icon size={18} /> : short}
              </span>
              <span className="lead-platform-copy">
                <strong>Search {source}</strong>
                <small>{description}</small>
              </span>
              <ExternalLink size={15} />
            </a>
          ))}
        </div>
      </section>

      <div className="lead-stat-grid">
        <div className="lead-stat-card">
          <span className="lead-stat-icon"><Globe2 size={17} /></span>
          <div><strong>{noSiteLeads.length}</strong><span>No-site leads</span></div>
        </div>
        <div className="lead-stat-card">
          <span className="lead-stat-icon ready"><Users size={17} /></span>
          <div><strong>{activeLeads.length}</strong><span>Still to work</span></div>
        </div>
        <div className="lead-stat-card">
          <span className="lead-stat-icon source"><ListFilter size={17} /></span>
          <div><strong>{sourceCount}</strong><span>Sources represented</span></div>
        </div>
        <div className="lead-stat-card lead-stat-action">
          <FileSpreadsheet size={17} />
          <div><strong>Private workspace</strong><span>Saved in this browser</span></div>
        </div>
      </div>

      {message && (
        <div className="lead-message" role="status">
          <CheckCircle2 size={16} /> {message}
        </div>
      )}

      <div className="lead-workspace">
        <div className="lead-main-column">
          <div className="lead-list-head">
            <div>
              <p className="overline">YOUR PROSPECTS</p>
              <h2>No-site lead list</h2>
              <p>Only listings with no owned website appear here.</p>
            </div>
            <div className="lead-actions">
              <label className="ghost-btn lead-upload-btn">
                <Upload size={14} /> Import file
                <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={readImportFile} />
              </label>
              <button className="ghost-btn" type="button" onClick={() => { setImportOpen((open) => !open); setAddOpen(false) }}>
                <Clipboard size={14} /> Paste data
              </button>
              <button className="complete small" type="button" onClick={openAddForm}>
                <Plus size={15} /> Add lead
              </button>
            </div>
          </div>

          {importOpen && (
            <form className="lead-import panel" onSubmit={importListings}>
              <div className="lead-inline-head">
                <div>
                  <h3>Import a directory export</h3>
                  <p>CSV and tab-separated rows work. A Website column is optional; rows with a real owned site are skipped.</p>
                </div>
                <button className="icon-btn" type="button" onClick={() => setImportOpen(false)} aria-label="Close import panel"><X size={16} /></button>
              </div>
              <textarea
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder="Business name,Category,Location,Phone,Source,Listing URL,Website,Notes"
                rows={6}
              />
              <div className="lead-import-footer">
                <span><Info size={14} /> Required: Business name. Recommended: Source and Listing URL.</span>
                <div>
                  <button className="linklike" type="button" onClick={copyTemplate}>
                    {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy template'}
                  </button>
                  <button className="complete small" type="submit"><Upload size={14} /> Import no-site leads</button>
                </div>
              </div>
            </form>
          )}

          {addOpen && (
            <form className="lead-add panel" onSubmit={addSingleLead}>
              <div className="lead-inline-head">
                <div>
                  <h3>Add a lead manually</h3>
                  <p>Capture only public business details you are allowed to use.</p>
                </div>
                <button className="icon-btn" type="button" onClick={() => setAddOpen(false)} aria-label="Close add lead panel"><X size={16} /></button>
              </div>
              <div className="lead-form-grid">
                <label className="lead-field span-2"><span>Business name *</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Business name" /></label>
                <label className="lead-field"><span>Source</span><select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>{LEAD_SOURCES.map((source) => <option key={source}>{source}</option>)}</select></label>
                <label className="lead-field"><span>Category</span><input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="e.g. salon" /></label>
                <label className="lead-field"><span>Location</span><input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="City or area" /></label>
                <label className="lead-field"><span>Phone</span><input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Public business number" /></label>
                <label className="lead-field"><span>Listing URL</span><input type="url" value={form.listingUrl} onChange={(event) => setForm({ ...form, listingUrl: event.target.value })} placeholder="https://…" /></label>
                <label className="lead-field"><span>Website, if present</span><input type="url" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} placeholder="Leave blank for no-site lead" /></label>
                <label className="lead-field span-2"><span>Notes</span><input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Why they may need help" /></label>
              </div>
              <div className="lead-form-actions"><button className="ghost-btn" type="button" onClick={() => setAddOpen(false)}>Cancel</button><button className="complete small" type="submit"><Plus size={14} /> Save lead</button></div>
            </form>
          )}

          <div className="lead-filter-row">
            <div className="search-box lead-search-box">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your leads…" aria-label="Search your leads" />
            </div>
            <label className="lead-filter-select"><Filter size={14} /><span className="sr-only">Filter by source</span><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option>All</option>{LEAD_SOURCES.map((source) => <option key={source}>{source}</option>)}</select></label>
            <label className="lead-filter-select"><ListFilter size={14} /><span className="sr-only">Filter by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All</option>{LEAD_STATUSES.map((status) => <option value={status.value} key={status.value}>{status.label}</option>)}</select></label>
            {(query || sourceFilter !== 'All' || statusFilter !== 'All') && <button className="linklike lead-clear-filter" type="button" onClick={clearFilters}>Clear filters</button>}
          </div>

          <div className="lead-list-meta">
            <span>{visibleLeads.length} of {noSiteLeads.length} lead{noSiteLeads.length === 1 ? '' : 's'}</span>
            <button className="ghost-btn" type="button" onClick={exportLeads} disabled={!noSiteLeads.length}><Download size={14} /> Export CSV</button>
          </div>

          <div className="lead-list">
            {visibleLeads.map((lead) => (
              <article className="lead-card" key={lead.id}>
                <div className="lead-card-top">
                  <div className="lead-avatar">{initials(lead.name)}</div>
                  <div className="lead-card-title">
                    <h3>{lead.name}</h3>
                    <p>{[lead.category || 'Local business', lead.location || 'Location not added'].join(' · ')}</p>
                  </div>
                  <span className="lead-no-site"><Globe2 size={13} /> No website</span>
                </div>
                <div className="lead-card-meta">
                  <span className={`lead-source-tag ${lead.source.toLowerCase().replace(/\s+/g, '-')}`}><span>{lead.source === 'LinkedIn' ? 'in' : lead.source.charAt(0)}</span>{lead.source}</span>
                  {lead.phone && <a href={`tel:${lead.phone}`}><Phone size={13} /> {lead.phone}</a>}
                  {lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>}
                  {lead.listingUrl && <a href={safeExternalUrl(lead.listingUrl)} target="_blank" rel="noreferrer"><ExternalLink size={13} /> View listing</a>}
                </div>
                <div className="lead-card-bottom">
                  <label className="lead-status-control"><span>Status</span><select aria-label={`Status for ${lead.name}`} value={lead.status} onChange={(event) => updateLead(lead.id, { status: event.target.value })}>{LEAD_STATUSES.map((status) => <option value={status.value} key={status.value}>{status.label}</option>)}</select></label>
                  <label className="lead-note-control"><MessageSquare size={14} /><span className="sr-only">Notes for {lead.name}</span><input value={lead.notes} onChange={(event) => updateLead(lead.id, { notes: event.target.value })} placeholder="Add a note…" /></label>
                  <button className="icon-btn danger" type="button" onClick={() => setLeads((current) => current.filter((item) => item.id !== lead.id))} aria-label={`Delete ${lead.name}`}><Trash2 size={14} /></button>
                </div>
              </article>
            ))}
          </div>

          {!visibleLeads.length && (
            <div className="lead-empty-state">
              <span><Building2 size={22} /></span>
              <h3>{noSiteLeads.length ? 'No leads match these filters.' : 'Your lead list is ready for its first prospect.'}</h3>
              <p>{noSiteLeads.length ? 'Try clearing a filter or searching for another business.' : 'Open a source search above, then import a CSV or add a public listing manually.'}</p>
              {noSiteLeads.length ? <button className="linklike" type="button" onClick={clearFilters}>Clear filters</button> : <button className="complete small" type="button" onClick={openAddForm}><Plus size={14} /> Add your first lead</button>}
            </div>
          )}
        </div>

        <aside className="lead-sidebar">
          <div className="panel lead-howto">
            <div className="panel-head">
              <div><h2>Simple workflow</h2><p>Turn a public listing into a useful conversation.</p></div>
              <ArrowRight size={19} />
            </div>
            <ol>
              <li><span>1</span><div><strong>Search a source</strong><p>Choose a niche and location, then open Maps, Yelp, or LinkedIn.</p></div></li>
              <li><span>2</span><div><strong>Check the website field</strong><p>Keep companies with no owned site. A social profile is not a replacement.</p></div></li>
              <li><span>3</span><div><strong>Save and follow up</strong><p>Track status, add context, and export a clean CSV for outreach.</p></div></li>
            </ol>
          </div>
          <div className="panel lead-quality-note">
            <div className="lead-quality-icon"><CheckCircle2 size={17} /></div>
            <div><strong>Quality over volume</strong><p>Use public business contact details only. Personal emails and private profile data do not belong in this list.</p></div>
          </div>
          <div className="panel lead-privacy-note">
            <ShieldCheck size={17} />
            <div><strong>Saved locally</strong><p>Your leads stay in this browser until you export or clear them.</p></div>
          </div>
        </aside>
      </div>
    </section>
  )
}
