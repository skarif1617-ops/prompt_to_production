import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, BookOpenCheck, BriefcaseBusiness, Check, ChevronDown, Clock3, Code2, Compass, Copy, ExternalLink, GitCompare, GraduationCap, Lightbulb, Menu, MessageCircle, Moon, PanelsTopLeft, Search, SlidersHorizontal, Sparkles, Sun, Target, Volume2, VolumeX, X } from 'lucide-react'
import tools from './data/tools.json'
import interviewData from './data/interviews.json'
import { coachFallback, evaluateFallback, guideFallback, recommendFallback } from './lib/fallbacks.js'
import { postJSON } from './lib/api.js'
import VoiceAnswerInput from './VoiceAnswerInput.jsx'
import './App.css'

const stages = ['Class 12', 'UG', 'PG', 'Job Seeker']
const categories = ['How to Use AI', ...new Set(tools.map((tool) => tool.category))]
const examples = ['Make a PPT', 'Build my resume', 'Explain calculus', 'Prepare for interviews']
const toolAliases = { chatgpt: ['Chat GPT', 'GPT Chat'], gemini: ['Google Gemini', 'Google Bard'], claude: ['Anthropic Claude'] }
const scenarios = ['Tell me about yourself', 'HR questions', 'Behavioral (STAR method)', 'Explain a project', 'Group discussion', 'Campus placement self-intro']
const storage = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage may be unavailable */ }
  },
}
const titleCase = (value) => value.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const makeSearchUrl = (query) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
const evaluationScoreKeys = ['problemUnderstanding', 'approachQuality', 'edgeCases', 'codeCorrectness', 'complexity', 'clarity']
const coachFeedbackKeys = ['structure', 'clarity', 'fillerWords', 'length', 'confidence', 'vocabulary', 'grammar']

function isCompleteGuide(guide) {
  const listFields = ['setup', 'firstResult', 'prompts', 'tips', 'mistakes', 'alternatives']
  return Boolean(guide)
    && ['what', 'who', 'freeTierNotes'].every((key) => typeof guide[key] === 'string')
    && listFields.every((key) => Array.isArray(guide[key]) && guide[key].every((item) => typeof item === 'string'))
    && guide.setup.length >= 3 && guide.firstResult.length >= 5 && guide.prompts.length >= 5
}

function getRouteDetails() {
  if (typeof window === 'undefined') return { view: 'finder' }
  const route = window.location.hash.replace(/^#\/?/, '')
  if (!route) return { view: 'finder' }
  const [path, query = ''] = route.split('?')
  if (path.startsWith('guide/')) {
    let toolId
    try { toolId = decodeURIComponent(path.slice('guide/'.length)) } catch { return { view: 'not-found' } }
    const params = new URLSearchParams(query)
    const returnView = ['finder', 'learn'].includes(params.get('from')) ? params.get('from') : 'finder'
    let tool = tools.find((item) => item.id === toolId)
    if (!tool && toolId.startsWith('external-') && params.get('name')) {
      const name = params.get('name')
      tool = { id: toolId, name, category: 'AI Models & APIs', url: `https://www.google.com/search?q=${encodeURIComponent(`${name} official`)}`, bestFor: `A practical student guide to ${name}`, learnGuide: null, external: true }
    }
    return tool ? { view: 'guide', tool, returnView } : { view: 'not-found' }
  }
  return ['finder', 'learn', 'interview', 'coach'].includes(path) ? { view: path } : { view: 'not-found' }
}

function App() {
  const [initialRoute] = useState(getRouteDetails)
  const [theme, setTheme] = useState(() => storage.get('sai-theme', 'light'))
  const [view, setView] = useState(initialRoute.view)
  const [stageMenuOpen, setStageMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState(() => storage.get('sai-stage', 'UG'))
  const [category, setCategory] = useState('All tools')
  const [pricing, setPricing] = useState('Any price')
  const [recommendation, setRecommendation] = useState(null)
  const [guideReturnView, setGuideReturnView] = useState(initialRoute.returnView || 'finder')
  const [loading, setLoading] = useState(false)
  const [compareMode, setCompareMode] = useState(false)
  const [compareIds, setCompareIds] = useState([])
  const [activeGuide, setActiveGuide] = useState(() => initialRoute.tool ? { tool: initialRoute.tool, guide: initialRoute.tool.learnGuide || guideFallback(initialRoute.tool.name), generated: !initialRoute.tool.learnGuide, fallback: !initialRoute.tool.learnGuide } : null)
  const [guideLoading, setGuideLoading] = useState(false)
  const [completedGuide, setCompletedGuide] = useState(() => storage.get('sai-guides', {}))
  const [searchMessage, setSearchMessage] = useState('')
  const [mobileMenu, setMobileMenu] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    storage.set('sai-theme', theme)
  }, [theme])

  useEffect(() => {
    const syncRoute = () => {
      const route = getRouteDetails()
      setView(route.view)
      setGuideReturnView(route.returnView || 'finder')
      setActiveGuide(route.tool ? { tool: route.tool, guide: route.tool.learnGuide || guideFallback(route.tool.name), generated: !route.tool.learnGuide, fallback: !route.tool.learnGuide } : null)
      setGuideLoading(false)
    }
    window.addEventListener('popstate', syncRoute)
    window.addEventListener('hashchange', syncRoute)
    return () => {
      window.removeEventListener('popstate', syncRoute)
      window.removeEventListener('hashchange', syncRoute)
    }
  }, [])

  useEffect(() => storage.set('sai-stage', stage), [stage])
  useEffect(() => storage.set('sai-guides', completedGuide), [completedGuide])

  const filteredTools = useMemo(() => tools.filter((tool) =>
    (category === 'All tools' || tool.category === category)
    && (tool.stages.includes(stage))
    && (pricing === 'Any price' || tool.pricing === pricing),
  ), [category, stage, pricing])

  const search = async (searchQuery = query) => {
    const rawQuery = searchQuery.trim()
    const cleaned = rawQuery.slice(0, 500)
    if (!cleaned) {
      setRecommendation(null)
      setSearchMessage('Add a task to get a useful recommendation.')
      return
    }
    setQuery(cleaned)
    setLoading(true)
    setRecommendation(null)
    setSearchMessage(rawQuery.length > 500 ? 'Search was shortened to 500 characters.' : '')
    setActiveGuide(null)
    setView('finder')
    const guideMatch = findNamedTool(cleaned)
    if (guideMatch) {
      await openGuide(guideMatch)
      setLoading(false)
      return
    }
    const requestedGuide = detectGuideName(cleaned)
    if (requestedGuide) {
      const externalTool = { id: `external-${requestedGuide.toLowerCase().replace(/\W+/g, '-')}`, name: requestedGuide, category: 'AI Models & APIs', url: `https://www.google.com/search?q=${encodeURIComponent(`${requestedGuide} official`)}`, bestFor: `A practical student guide to ${requestedGuide}`, learnGuide: null, external: true }
      await openGuide(externalTool)
      setLoading(false)
      return
    }
    try {
      const result = await postJSON('/api/recommend', { query: `${cleaned}. Student stage: ${stage}.` })
      const valid = tools.some((tool) => tool.id === result.topPick) && Array.isArray(result.alternatives) && result.alternatives.every((id) => tools.some((tool) => tool.id === id)) && typeof result.reason === 'string' && typeof result.noMatch === 'boolean' && typeof result.fallback === 'boolean'
      if (!valid) throw new Error('The recommendation could not be validated.')
      if (result.noMatch) {
        setSearchMessage('No close match found. Try a subject, task, or tool name, or browse the catalog below.')
        return
      }
      setRecommendation(result)
      if (result.fallback) setSearchMessage('Showing a keyword-based recommendation while AI recommendations are unavailable.')
    } catch {
      const fallback = recommendFallback(`${cleaned} ${stage}`)
      if (fallback.noMatch) setSearchMessage('No close match found. Try a subject, task, or tool name, or browse the catalog below.')
      else {
        setRecommendation(fallback)
        setSearchMessage('Showing a keyword-based recommendation while AI recommendations are unavailable.')
      }
    } finally {
      setLoading(false)
    }
  }

  const findNamedTool = (value) => {
    const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const normalized = normalize(value)
    return tools.find((tool) => {
      const terms = [tool.name, tool.id.replaceAll('-', ' '), ...(toolAliases[tool.id] || [])]
      return terms.some((term) => normalize(term).length > 2 && normalized.includes(normalize(term)))
    }) || null
  }

  const detectGuideName = (value) => {
    const match = value.match(/\b(?:how to use|teach me|learn(?: how to use)?|guide (?:for|to))\s+([\w.+-]+(?:\s+[\w.+-]+)?)/i)
    return match?.[1]?.replace(/[?.!,]+$/, '').trim() || null
  }

  const openGuide = async (tool) => {
    const returnView = view === 'guide' ? guideReturnView : view
    setGuideReturnView(returnView)
    const guideQuery = new URLSearchParams({ from: returnView, name: tool.external ? tool.name : '' })
    window.history.pushState({}, '', `#/guide/${encodeURIComponent(tool.id)}?${guideQuery}`)
    setActiveGuide({ tool, guide: tool.learnGuide, generated: false })
    setView('guide')
    if (tool.learnGuide) return
    setGuideLoading(true)
    try {
      const result = await postJSON('/api/guide', { name: tool.name })
      if (!isCompleteGuide(result.guide) || typeof result.generated !== 'boolean') throw new Error('The guide could not be validated.')
      setActiveGuide({ tool, guide: result.guide, generated: Boolean(result.generated), fallback: Boolean(result.fallback) })
    } catch {
      setActiveGuide({ tool, guide: guideFallback(tool.name), generated: true, fallback: true })
    } finally {
      setGuideLoading(false)
    }
  }

  const toggleCompare = (toolId) => setCompareIds((current) => current.includes(toolId)
    ? current.filter((id) => id !== toolId)
    : current.length < 3 ? [...current, toolId] : current)

  const switchView = (nextView) => {
    setView(nextView)
    window.history.pushState({}, '', `#/${nextView}`)
    setActiveGuide(null)
    setMobileMenu(false)
  }

  const revealLearnGuide = (tool) => openGuide(tool)

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); switchView('finder') }} aria-label="StudentAI Navigator home">
          <span className="brand-mark"><Compass size={19} strokeWidth={2.3} /></span>
          <span>student<span className="brand-accent">ai</span><span className="brand-navigator"> navigator</span></span>
        </a>
        <nav className={`main-nav ${mobileMenu ? 'nav-open' : ''}`} aria-label="Main navigation">
          <button className={view === 'finder' || view === 'guide' ? 'nav-link active' : 'nav-link'} onClick={() => switchView('finder')}><Compass size={16} /> Find tools</button>
          <button className={view === 'learn' ? 'nav-link active' : 'nav-link'} onClick={() => switchView('learn')}><BookOpen size={16} /> Learn AI</button>
          <button className={view === 'interview' ? 'nav-link active' : 'nav-link'} onClick={() => switchView('interview')}><BriefcaseBusiness size={16} /> Interview prep</button>
          <button className={view === 'coach' ? 'nav-link active' : 'nav-link'} onClick={() => switchView('coach')}><MessageCircle size={16} /> Coach</button>
        </nav>
        <div className="top-actions">
          <button className="stage-select" aria-label="Select your stage" aria-haspopup="menu" aria-expanded={stageMenuOpen} onClick={() => setStageMenuOpen(!stageMenuOpen)}>
            <GraduationCap size={16} /><span>{stage}</span><ChevronDown size={14} />
          </button>
          <div className={`stage-menu ${stageMenuOpen ? 'stage-menu-open' : ''}`} role="menu">
            {stages.map((item) => <button key={item} role="menuitem" onClick={() => { setStage(item); setStageMenuOpen(false) }}>{item}</button>)}
          </div>
          <button className="icon-button theme-toggle" title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          <button className="icon-button mobile-menu-button" aria-label="Toggle navigation" aria-expanded={mobileMenu} onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X size={18} /> : <Menu size={18} />}</button>
        </div>
      </header>

      {view === 'finder' && <FinderView
        query={query} setQuery={setQuery} search={search} loading={loading} recommendation={recommendation}
        searchMessage={searchMessage} examples={examples} filteredTools={filteredTools} category={category}
        setCategory={setCategory} pricing={pricing} setPricing={setPricing} stage={stage} compareMode={compareMode}
        setCompareMode={setCompareMode} compareIds={compareIds} toggleCompare={toggleCompare}
        setView={switchView} onLearn={revealLearnGuide}
      />}
      {view === 'guide' && <GuideView activeGuide={activeGuide} loading={guideLoading} returnView={guideReturnView} onBack={() => switchView(guideReturnView === 'guide' ? 'finder' : guideReturnView)} completedGuide={completedGuide} setCompletedGuide={setCompletedGuide} />}
      {view === 'learn' && <LearnView tools={tools} onGuide={openGuide} onBack={() => switchView('finder')} />}
      {view === 'interview' && <InterviewView onCoach={() => switchView('coach')} />}
      {view === 'coach' && <CoachView />}
      {view === 'not-found' && <main className="not-found-page content-width"><div className="eyebrow muted">404 / PAGE NOT FOUND</div><h1>This page isn't here.</h1><p>Return to the tool finder to keep exploring.</p><button className="primary-small" onClick={() => switchView('finder')}>Go to tool finder <ArrowRight size={14} /></button></main>}

      <footer className="site-footer">
        <div className="footer-brand"><span className="brand-mark small"><Compass size={14} /></span><span>StudentAI Navigator</span></div>
        <p>Tool details and resources change often. Check official sites for current pricing and content. AI feedback is guidance, not a guarantee.</p>
        <button onClick={() => switchView('learn')}>Learn to use AI <ArrowRight size={14} /></button>
      </footer>
    </div>
  )
}

function FinderView({ query, setQuery, search, loading, recommendation, searchMessage, examples, filteredTools, category, setCategory, pricing, setPricing, stage, compareMode, setCompareMode, compareIds, toggleCompare, setView, onLearn }) {
  const [copied, setCopied] = useState('')
  const top = tools.find((tool) => tool.id === recommendation?.topPick)
  const alternatives = (recommendation?.alternatives || []).map((id) => tools.find((tool) => tool.id === id)).filter(Boolean)
  const comparedTools = compareIds.map((id) => tools.find((tool) => tool.id === id)).filter(Boolean)
  const selectCategory = (item) => item === 'How to Use AI' ? setView('learn') : item === 'Interview & Job Search' ? setView('interview') : setCategory(item)

  const copyPrompt = async (tool) => {
    try {
      await navigator.clipboard.writeText(tool.samplePrompt)
      setCopied(tool.id)
      window.setTimeout(() => setCopied(''), 1800)
    } catch {
      setCopied('copy-failed')
    }
  }

  return (
    <main id="home">
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> YOUR NEXT GOOD IDEA STARTS HERE</div>
          <h1>Make AI work<br /><span>for your next step.</span></h1>
          <p className="hero-description">Find the right tool for what you need to do. Learn how to use it well. Build skills that travel with you.</p>
          <div className="hero-proof"><span><Check size={14} /> Made for students</span><i /> <span><Check size={14} /> Free options first</span><i /> <span><Check size={14} /> No account needed</span></div>
        </div>
        <div className="search-panel">
          <label htmlFor="task-search">What do you need help with?</label>
          <form className="search-form" onSubmit={(event) => { event.preventDefault(); search() }}>
            <Search className="search-icon" size={20} />
            <input id="task-search" maxLength={500} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="A task, a subject, a goal..." />
            <button type="submit" disabled={loading} aria-label="Find a tool">{loading ? <span className="button-spinner" /> : <ArrowRight size={19} />}</button>
          </form>
          <div className="example-row"><span>TRY</span>{examples.map((item) => <button key={item} onClick={() => { setQuery(item); search(item) }}>{item}</button>)}</div>
          <div className="search-under-note"><Sparkles size={14} /> Get a useful starting point in seconds</div>
        </div>
        <div className="hero-index" aria-hidden="true">01 <span>/ 04</span></div>
        <div className="hero-graphic" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-core"><Sparkles size={28} /></div><span className="orbit-node node-a" /><span className="orbit-node node-b" /><span className="orbit-node node-c" /></div>
      </section>

      <section className="finder-section content-width" id="tool-finder">
        <div className="section-heading">
          <div><div className="eyebrow muted">THE TOOL FINDER</div><h2>Less scrolling. <span>More doing.</span></h2><p>One good tool can make the next step feel a lot smaller.</p></div>
          <button className={`compare-toggle ${compareMode ? 'selected' : ''}`} onClick={() => setCompareMode(!compareMode)}><GitCompare size={16} /> {compareMode ? 'Exit compare' : 'Compare tools'}</button>
        </div>
        {recommendation && top && <div className="recommendation-block">
          <div className="recommendation-heading"><span className="recommendation-label"><Sparkles size={15} /> YOUR BEST MATCH</span><span className="rec-query">for “{query}”</span></div>
          <p className="recommendation-reason">{recommendation.reason}</p>
          <div className="result-grid"><ToolCard tool={top} featured onLearn={onLearn} compareMode={compareMode} selected={compareIds.includes(top.id)} onCompare={toggleCompare} copied={copied} onCopy={copyPrompt} />{alternatives.map((tool) => <ToolCard key={tool.id} tool={tool} onLearn={onLearn} compareMode={compareMode} selected={compareIds.includes(tool.id)} onCompare={toggleCompare} copied={copied} onCopy={copyPrompt} />)}</div>
        </div>}
        {searchMessage && <p className="notice-inline" role="status">{searchMessage}</p>}
        <div className="browse-heading"><div><h3>Browse the toolkit</h3><span>{filteredTools.length} tools for {stage}</span></div><div className="filter-row"><label className="select-wrap"><SlidersHorizontal size={15} /><select aria-label="Filter by price" value={pricing} onChange={(event) => setPricing(event.target.value)}><option>Any price</option><option>Free</option><option>Freemium</option><option>Paid</option></select><ChevronDown size={13} /></label><label className="select-wrap category-filter"><select aria-label="Filter by category" value={category === 'Interview & Job Search' ? 'All tools' : category} onChange={(event) => selectCategory(event.target.value)}><option>All tools</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></label></div></div>
        <div className="category-tabs" role="tablist" aria-label="Tool categories">
          <button role="tab" aria-selected={category === 'All tools'} className={category === 'All tools' ? 'category-pill active' : 'category-pill'} onClick={() => setCategory('All tools')}>All tools</button>
          {categories.map((item) => <button role="tab" aria-selected={category === item} key={item} className={category === item ? 'category-pill active' : 'category-pill'} onClick={() => selectCategory(item)}>{item === 'Interview & Job Search' ? 'Interview prep' : item}</button>)}
        </div>
        {filteredTools.length ? <div className="result-grid browse-grid">{filteredTools.map((tool) => <ToolCard key={tool.id} tool={tool} onLearn={onLearn} compareMode={compareMode} selected={compareIds.includes(tool.id)} onCompare={toggleCompare} copied={copied} onCopy={copyPrompt} />)}</div> : <div className="empty-state"><Search size={23} /><h3>No tools in this combination</h3><p>Try another stage or price filter to widen your search.</p><button onClick={() => { setPricing('Any price'); setCategory('All tools') }}>Clear filters</button></div>}
      </section>

      {compareMode && <div className="compare-dock" role="region" aria-label="Tool comparison"><div><strong>Compare tools</strong><span>{compareIds.length} of 3 selected</span></div>{comparedTools.length ? <div className="compare-items">{comparedTools.map((tool) => <span key={tool.id}>{tool.name}<button aria-label={`Remove ${tool.name}`} onClick={() => toggleCompare(tool.id)}><X size={13} /></button></span>)}</div> : <p>Select up to three tools from the list.</p>}{comparedTools.length > 0 && <button className="compare-open" onClick={() => document.getElementById('comparison-table')?.scrollIntoView({ behavior: 'smooth' })}>Compare <ArrowRight size={14} /></button>}</div>}
      {compareMode && comparedTools.length > 0 && <section className="comparison-section content-width" id="comparison-table"><div className="eyebrow muted">SIDE BY SIDE</div><h2>Compare your shortlist</h2><div className="comparison-table" style={{ '--compare-count': comparedTools.length }}><div className="comparison-row comparison-header"><span>Tool</span>{comparedTools.map((tool) => <strong key={tool.id}>{tool.name}</strong>)}</div>{[['Category', (tool) => tool.category], ['Pricing', (tool) => tool.pricing], ['Best for', (tool) => tool.bestFor], ['Works for', (tool) => tool.stages.join(', ')]].map(([label, value]) => <div className="comparison-row" key={label}><span>{label}</span>{comparedTools.map((tool) => <p key={tool.id}>{value(tool)}</p>)}</div>)}</div></section>}

      <section className="learn-strip content-width"><div className="learn-strip-icon"><BookOpenCheck size={23} /></div><div><span className="eyebrow muted">A BETTER WAY TO USE IT</span><h2>Good tools need good questions.</h2><p>Learn the basics: prompting, model choice, pricing and safe study habits.</p></div><button onClick={() => setView('learn')}>Explore AI skills <ArrowRight size={16} /></button></section>
      <section className="stage-note content-width"><div className="stage-note-mark"><GraduationCap size={19} /></div><div><span>Made for where you are</span><p>Recommendations and practice paths adjust for <strong>{stage}</strong>. Change your stage any time from the top right.</p></div><button onClick={() => setView('interview')}>Explore job prep <ArrowRight size={15} /></button></section>
    </main>
  )
}

function ToolCard({ tool, featured, onLearn, compareMode, selected, onCompare, copied, onCopy }) {
  return <article className={`tool-card ${featured ? 'tool-card-featured' : ''}`}>
    <div className="tool-card-top"><span className="tool-category">{tool.category}</span><span className={`pricing-badge pricing-${tool.pricing.toLowerCase()}`}>{tool.pricing}</span></div>
    <div className="tool-name-row"><h3>{tool.name}</h3>{compareMode && <button className={`mini-compare ${selected ? 'is-selected' : ''}`} title={selected ? 'Remove from comparison' : 'Add to comparison'} aria-label={selected ? `Remove ${tool.name} from comparison` : `Add ${tool.name} to comparison`} onClick={() => onCompare(tool.id)}>{selected ? <Check size={15} /> : <GitCompare size={15} />}</button>}</div>
    <p className="tool-fit">{tool.bestFor}</p>
    <div className="tool-stages">{tool.stages.slice(0, 3).map((item) => <span key={item}>{item}</span>)}{tool.stages.length > 3 && <span>+{tool.stages.length - 3}</span>}</div>
    <div className="tool-steps"><span className="mini-label">GET STARTED</span><ol>{tool.howToUse.slice(0, 3).map((step, index) => <li key={step}><b>{String(index + 1).padStart(2, '0')}</b>{step}</li>)}</ol></div>
    <div className="sample-prompt"><div className="sample-prompt-top"><span>SAMPLE PROMPT</span><button onClick={() => onCopy(tool)} aria-label={copied === tool.id ? `Copied sample prompt for ${tool.name}` : `Copy sample prompt for ${tool.name}`} title={copied === tool.id ? 'Copied' : 'Copy prompt'}>{copied === tool.id ? <><Check size={14} /><span>Copied</span></> : <Copy size={14} />}</button></div><p>{tool.samplePrompt}</p>{copied === 'copy-failed' && <small>Clipboard access is unavailable here.</small>}</div>
    <div className="tool-card-actions"><a className="primary-small" href={tool.url} target="_blank" rel="noopener noreferrer">Open tool <ArrowUpRight size={15} /></a><button className="text-action" onClick={() => onLearn(tool)}>Learn this tool <ArrowRight size={14} /></button></div>
  </article>
}

function LearnView({ tools: catalog, onGuide, onBack }) {
  const [toolSearch, setToolSearch] = useState('')
  const matchingTools = useMemo(() => {
    const terms = toolSearch.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return catalog
    return catalog.map((tool, index) => {
      const searchable = [tool.name, tool.category, tool.bestFor, tool.learnGuide?.what, tool.learnGuide?.who, ...tool.tags].join(' ').toLowerCase()
      const matches = terms.filter((term) => searchable.includes(term)).length
      return { tool, index, matches }
    }).filter((item) => item.matches > 0)
      .sort((a, b) => b.matches - a.matches || a.index - b.index)
      .map(({ tool }) => tool)
  }, [catalog, toolSearch])
  const lessons = [
    { number: '01', title: 'Prompting basics', copy: 'Give a clear goal, add useful context, set constraints, and say what a good answer should look like.', icon: MessageCircle },
    { number: '02', title: 'Choose the right model', copy: 'Match the tool to the task: source-grounded study, long documents, images, code, or quick brainstorming.', icon: PanelsTopLeft },
    { number: '03', title: 'Free vs paid', copy: 'Start with a free tier. Compare limits, privacy terms and the actual features you need before paying.', icon: Target },
    { number: '04', title: 'Use AI safely for studies', copy: 'Do not submit generated work as your own. Follow course rules, verify facts, cite original sources and protect private data.', icon: Lightbulb },
  ]
  return <main className="learn-page content-width">
    <div className="page-kicker"><button className="back-button" onClick={onBack}><ArrowLeft size={15} /> Tool finder</button><span>LEARN THE CRAFT</span></div>
    <div className="learn-hero"><div><div className="eyebrow muted">HOW TO USE AI</div><h1>Better questions.<br /><span>Better thinking.</span></h1><p>AI can speed up a first draft. Your judgment makes the work yours.</p></div><div className="learn-hero-art" aria-hidden="true"><div className="art-ring ring-a" /><div className="art-ring ring-b" /><span><BookOpenCheck size={32} /></span></div></div>
    <div className="lesson-grid">{lessons.map(({ number, title, copy, icon: Icon }) => <article className="lesson-card" key={number}><div className="lesson-card-top"><span>{number}</span><Icon size={19} /></div><h2>{title}</h2><p>{copy}</p></article>)}</div>
    <section className="learn-tools"><div className="section-heading"><div><div className="eyebrow muted">YOUR FIELD GUIDE</div><h2>Learn the tools you use.</h2><p>Search by a subject or task to compare suitable tools.</p></div><span className="tool-count">{toolSearch.trim() ? `${matchingTools.length} matches` : `${catalog.length} guides`}</span></div><p className="pricing-key">Free: no payment for basic access. Freemium: free basics with optional paid upgrades. Paid: payment is required.</p><label className="learn-search" htmlFor="learn-tool-search"><Search size={17} /><input id="learn-tool-search" type="search" value={toolSearch} onChange={(event) => setToolSearch(event.target.value)} placeholder="Search a concept or task, e.g. study" aria-label="Search AI tools by concept or task" /></label>{matchingTools.length ? <div className="learn-tool-grid">{matchingTools.map((tool) => <button className="learn-tool-row" key={tool.id} onClick={() => onGuide(tool)}><span className="learn-tool-icon"><Sparkles size={16} /></span><span className="learn-tool-copy"><strong>{tool.name}</strong><small>{tool.bestFor}</small></span><ArrowRight size={15} /></button>)}</div> : <p className="learn-search-empty" role="status">No tools match that search. Try a subject like study, writing, or coding.</p>}</section>
  </main>
}

function GuideView({ activeGuide, loading, returnView, onBack, completedGuide, setCompletedGuide }) {
  if (!activeGuide) return <main className="content-width loading-page"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line short" /></main>
  const { tool, generated, fallback } = activeGuide
  const guide = { ...guideFallback(tool.name), ...activeGuide.guide }
  const checklist = completedGuide[tool.id] || []
  const steps = [
    ['Choose your task', 'Write down what you want to make, learn or decide.'],
    ['Try one prompt', 'Start with a single prompt and adjust the result in your own words.'],
    ['Check the output', 'Open sources, test the answer, and note anything uncertain.'],
  ]
  return <main className="guide-page content-width">
    <div className="page-kicker"><button className="back-button" onClick={onBack}><ArrowLeft size={15} /> {returnView === 'learn' ? 'Back to Learn AI' : 'Back to tools'}</button><span>{tool.category.toUpperCase()}</span></div>
    <div className="guide-hero"><div className="eyebrow muted">TOOL FIELD GUIDE</div><div className="guide-title-row"><div><h1>{tool.name}</h1><p>{tool.bestFor}</p></div><a href={tool.url} className="primary-small" target="_blank" rel="noopener noreferrer">{tool.external ? 'Find official site' : 'Open official site'} <ExternalLink size={15} /></a></div>{generated && <div className="generated-note"><Sparkles size={15} /> AI-generated guide, check the official docs.{fallback ? ' This is a general fallback guide.' : ''}</div>}</div>
    {loading ? <div className="guide-loading"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-block" /><div className="skeleton skeleton-block" /></div> : <>
      <div className="guide-intro-grid"><GuideSection title="What it is" text={guide.what} /><GuideSection title="Who it's for" text={guide.who} /></div>
      <div className="guide-columns"><GuideList title="Setup" items={guide.setup} numbered /><GuideList title="Your first result in 5 steps" items={guide.firstResult} numbered /></div>
      <section className="guide-section prompts-guide"><div className="guide-section-heading"><span className="guide-section-icon"><MessageCircle size={17} /></span><div><span className="eyebrow muted">START WITH THESE</span><h2>Five prompts to try</h2></div></div><div className="prompt-list">{guide.prompts.map((prompt, index) => <div className="prompt-list-item" key={`${tool.id}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{prompt}</p></div>)}</div></section>
      <div className="guide-columns"><GuideList title="Pro tips" items={guide.tips} /><GuideList title="Common mistakes" items={guide.mistakes} /></div>
      <div className="guide-columns guide-bottom"><GuideSection title="Free-tier notes" text={guide.freeTierNotes} /><div className="guide-section"><div className="guide-section-heading"><span className="guide-section-icon"><GitCompare size={17} /></span><div><span className="eyebrow muted">OTHER OPTIONS</span><h2>Best alternatives</h2></div></div><div className="alternative-tags">{guide.alternatives.length ? guide.alternatives.map((item) => <span key={item}>{item}</span>) : <span>Compare similar tools in the finder</span>}</div></div></div>
      <section className="guide-checklist"><div><span className="eyebrow">MAKE IT YOURS</span><h2>Try it checklist</h2><p>Keep a small record of what worked for you.</p></div><div className="checklist-items">{steps.map(([label, detail], index) => <label className="checklist-item" key={label}><input type="checkbox" checked={Boolean(checklist[index])} onChange={(event) => setCompletedGuide((current) => ({ ...current, [tool.id]: steps.map((_, itemIndex) => itemIndex === index ? event.target.checked : Boolean(current[tool.id]?.[itemIndex])) }))} /><span className="checkmark"><Check size={13} /></span><span><strong>{label}</strong><small>{detail}</small></span></label>)}</div></section>
    </>}
  </main>
}

function GuideSection({ title, text }) {
  return <section className="guide-section"><div className="guide-section-heading"><span className="guide-section-icon"><BookOpen size={17} /></span><div><span className="eyebrow muted">FIELD NOTES</span><h2>{title}</h2></div></div><p>{text}</p></section>
}

function GuideList({ title, items, numbered }) {
  return <section className="guide-section"><div className="guide-section-heading"><span className="guide-section-icon">{numbered ? <span className="numbered-icon">{items.length}</span> : <Lightbulb size={17} />}</span><div><span className="eyebrow muted">PRACTICAL GUIDE</span><h2>{title}</h2></div></div><ol className="guide-list">{items.map((item, index) => <li key={`${title}-${item}`}><span>{numbered ? String(index + 1).padStart(2, '0') : <Check size={13} />}</span><p>{item}</p></li>)}</ol></section>
}

function InterviewView({ onCoach }) {
  const [domainId, setDomainId] = useState(() => storage.get('sai-domain', 'software-development'))
  const domain = interviewData.domains.find((item) => item.id === domainId) || interviewData.domains[0]
  const [progress, setProgress] = useState(() => storage.get('sai-roadmap', {}))
  const [companyId, setCompanyId] = useState('amazon')
  const [problemId, setProblemId] = useState('')
  const [approach, setApproach] = useState('')
  const [answer, setAnswer] = useState('')
  const [voiceLanguage, setVoiceLanguage] = useState('en-IN')
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [evaluation, setEvaluation] = useState(null)
  const [evaluating, setEvaluating] = useState(false)
  const [evalError, setEvalError] = useState('')
  const [history, setHistory] = useState(() => storage.get('sai-eval-history', []))
  const [generatedProblem, setGeneratedProblem] = useState(null)
  const [problemLoading, setProblemLoading] = useState(false)
  const [problemMessage, setProblemMessage] = useState('')
  const company = interviewData.companies.find((item) => item.id === companyId) || interviewData.companies[0]
  const suitableProblems = interviewData.problems.filter((item) => item.domain === domainId || item.companies.includes(companyId))
  const selectedProblem = suitableProblems.find((item) => item.id === problemId) || generatedProblem || suitableProblems[0] || interviewData.problems[0]
  const historyChart = history.slice(-8)
  const averageScore = history.length ? (history.reduce((sum, item) => sum + item.score, 0) / history.length).toFixed(1) : '—'

  useEffect(() => storage.set('sai-domain', domainId), [domainId])
  useEffect(() => storage.set('sai-roadmap', progress), [progress])
  useEffect(() => storage.set('sai-eval-history', history), [history])

  const resetPractice = () => {
    setProblemId('')
    setGeneratedProblem(null)
    setEvaluation(null)
    setApproach('')
    setAnswer('')
    setEvalError('')
    setProblemMessage('')
  }

  const toggleRoadmap = (stageId) => setProgress((current) => ({ ...current, [domainId]: { ...current[domainId], [stageId]: !current[domainId]?.[stageId] } }))
  const completed = Object.values(progress[domainId] || {}).filter(Boolean).length

  const requestProblem = async () => {
    setProblemLoading(true)
    setProblemMessage('')
    const pool = interviewData.problems.filter((item) => item.companies.includes(companyId))
    const fallbackProblem = pool.find((item) => item.id !== generatedProblem?.id) || pool[0] || interviewData.problems[0]
    try {
      const result = await postJSON('/api/company-practice', { domain: domain.name, company: company.name, companyId, topics: company.topics })
      const incoming = result.problem
      if (!incoming || typeof incoming.title !== 'string' || typeof incoming.prompt !== 'string' || !Array.isArray(incoming.hints) || incoming.hints.length < 3 || !incoming.hints.every((hint) => typeof hint === 'string') || typeof incoming.solution !== 'string' || typeof incoming.complexity !== 'string') throw new Error('Invalid generated problem')
      setGeneratedProblem({ ...incoming, id: `generated-${incoming.title || 'problem'}`, domain: domainId, companies: [companyId] })
      setProblemId('')
      setEvaluation(null)
      setApproach('')
      setAnswer('')
      if (result.fallback) setProblemMessage('AI problem generation is unavailable. Showing a saved practice exercise instead.')
    } catch {
      setGeneratedProblem(fallbackProblem)
      setProblemId(fallbackProblem.id)
      setProblemMessage('Could not generate a new problem. Showing a saved practice exercise instead.')
    } finally {
      setProblemLoading(false)
    }
  }

  const evaluate = async (event) => {
    event.preventDefault()
    if (!approach.trim() || !answer.trim()) {
      setEvalError('Add both your approach and answer so the feedback can assess how you think.')
      return
    }
    setEvaluating(true)
    setEvalError('')
    try {
      let result
      try { result = await postJSON('/api/evaluate', { problem: selectedProblem.prompt, approach, answer }) } catch { result = null }
      const listKeys = ['strengths', 'gaps', 'jobLevelThinking', 'improvementPlan']
      if (!result?.scores || !evaluationScoreKeys.every((key) => Number.isFinite(result.scores[key]) && result.scores[key] >= 1 && result.scores[key] <= 10) || !listKeys.every((key) => Array.isArray(result[key]) && result[key].every((item) => typeof item === 'string')) || typeof result.followUp !== 'string') {
        result = evaluateFallback({ problem: selectedProblem.prompt, approach, answer })
      }
      setEvaluation(result)
      const score = Math.round(evaluationScoreKeys.reduce((total, key) => total + result.scores[key], 0) / evaluationScoreKeys.length)
      setHistory((current) => [...current, { score, date: new Date().toISOString().slice(0, 10), domain: domain.name, title: selectedProblem.title }].slice(-40))
    } finally {
      setEvaluating(false)
    }
  }

  return <main className="interview-page content-width">
    <div className="page-kicker"><span>CAREER LAB / INTERVIEW PREP</span><span className="local-save"><Check size={13} /> Progress saved on this device</span></div>
    {problemMessage && <p className="notice-inline" role="status">{problemMessage}</p>}
    <div className="interview-hero"><div><div className="eyebrow muted">A ROADMAP, NOT A CRAM PLAN</div><h1>Build your way<br /><span>to interview-ready.</span></h1><p>Pick a domain. Learn the foundations. Practice explaining how you think.</p></div><div className="interview-stat"><div className="stat-ring"><strong>{completed}</strong><span>/{domain.stages.length}</span></div><span>roadmap steps<br />completed</span></div></div>
    <section className="domain-section"><div className="section-heading compact"><div><div className="eyebrow muted">01 / PICK A DIRECTION</div><h2>Which role are you working toward?</h2></div><span className="domain-count">{interviewData.domains.length} learning paths</span></div><div className="domain-grid">{interviewData.domains.map((item) => <button key={item.id} className={`domain-card ${item.id === domainId ? 'active' : ''}`} onClick={() => { setDomainId(item.id); resetPractice() }}><span className="domain-icon">{item.id.includes('data') ? <PanelsTopLeft size={18} /> : item.id.includes('cyber') ? <Target size={18} /> : item.id.includes('aptitude') ? <MessageCircle size={18} /> : <Code2 size={18} />}</span><strong>{item.name}</strong><small>{item.duration}</small><ArrowRight size={15} /></button>)}</div></section>
    <section className="roadmap-section"><div className="section-heading compact"><div><div className="eyebrow muted">02 / YOUR LEARNING ROADMAP</div><h2>{domain.name}</h2><p>{domain.summary}</p></div><span className="duration-badge"><Clock3 size={14} /> {domain.duration}</span></div><div className="roadmap-list">{domain.stages.map((item, index) => { const done = Boolean(progress[domainId]?.[item.id]); return <article className={`roadmap-stage ${done ? 'complete' : ''}`} key={item.id}><button className="roadmap-stage-head" onClick={() => toggleRoadmap(item.id)} aria-label={`${done ? 'Mark incomplete' : 'Mark complete'}: ${item.name}`}><span className="roadmap-number">{done ? <Check size={14} /> : String(index + 1).padStart(2, '0')}</span><span className="roadmap-stage-title"><strong>{item.name}</strong><small><Clock3 size={12} /> {item.duration}</small></span><span className="roadmap-topics-count">{item.topics.length} topics</span><span className="roadmap-toggle">{done ? 'Complete' : 'Mark done'}</span></button><div className="roadmap-topics">{item.topics.map((topic) => <div className="roadmap-topic" key={topic}><span>{topic}</span><div className="resource-links">{domain.channels.filter((channel) => channel.topics.some((term) => topic.toLowerCase().includes(term.toLowerCase()) || term.toLowerCase().includes(topic.toLowerCase()))).slice(0, 2).map((channel) => <a href={channel.url} target="_blank" rel="noopener noreferrer" key={channel.name} title={`Visit ${channel.name}`}>{channel.name} <ExternalLink size={11} /></a>)}<a href={makeSearchUrl(`${topic} ${domain.name}`)} target="_blank" rel="noopener noreferrer">YouTube search <Search size={11} /></a></div></div>)}</div></article> })}</div><div className="resource-shelf"><span>FREE LEARNING RESOURCES</span>{domain.resources.map((resource) => <a href={resource.url} target="_blank" rel="noopener noreferrer" key={resource.name}>{resource.name} <ArrowUpRight size={13} /></a>)}</div></section>
    <section className="company-section"><div className="section-heading compact"><div><div className="eyebrow muted">03 / COMPANY-WISE PRACTICE</div><h2>Practice with a target in mind.</h2><p>Original exercises inspired by common interview skills, not copied questions.</p></div><label className="select-wrap company-select"><BriefcaseBusiness size={15} /><select value={companyId} onChange={(event) => { setCompanyId(event.target.value); resetPractice() }} aria-label="Select company">{interviewData.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={13} /></label></div><div className="company-content"><div className="company-rounds"><span className="mini-label">TYPICAL ROUNDS</span><ol>{company.rounds.map((round, index) => <li key={round}><span>{String(index + 1).padStart(2, '0')}</span>{round}</li>)}</ol><span className="mini-label topics-label">COMMON FOCUS AREAS</span><div className="topic-tags">{company.topics.map((topic) => <span key={topic}>{topic}</span>)}</div><a className="company-real-link" href={company.practiceUrl} target="_blank" rel="noopener noreferrer">Related practice and career resources <ExternalLink size={14} /></a><small>Round formats vary by role, location and hiring cycle.</small></div><div className="practice-problem"><div className="practice-problem-head"><label className="problem-select-label"><span className="difficulty-label">{selectedProblem.difficulty} PRACTICE</span>{!generatedProblem && <select aria-label="Choose practice problem" value={selectedProblem.id} onChange={(event) => { setProblemId(event.target.value); setEvaluation(null); setApproach(''); setAnswer('') }}>{suitableProblems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>}</label><button className="text-action" onClick={requestProblem} disabled={problemLoading}>{problemLoading ? <span className="button-spinner small-spinner" /> : <Sparkles size={14} />} New original problem</button></div><h3>{selectedProblem.title}</h3><p>{selectedProblem.prompt}</p><details><summary>Open hints <ChevronDown size={14} /></summary><ol>{selectedProblem.hints.map((hint) => <li key={hint}>{hint}</li>)}</ol></details><details><summary>Solution and complexity <ChevronDown size={14} /></summary><p>{selectedProblem.solution}</p><strong>{selectedProblem.complexity}</strong></details></div></div></section>
    <section className="evaluator-section"><div className="evaluator-heading"><div><div className="eyebrow">04 / THINKING EVALUATOR</div><h2>Show your thinking.<br /><span>Strengthen the next attempt.</span></h2><p>Write your plan before your answer. Feedback focuses on the reasoning behind it.</p></div><div className="evaluator-icon"><Lightbulb size={24} /></div></div><div className="evaluator-grid"><form className="evaluator-form" onSubmit={evaluate}><div className="selected-problem-line"><span>SELECTED PROBLEM</span><strong>{selectedProblem.title}</strong><span className="difficulty-label">{selectedProblem.difficulty}</span></div><label htmlFor="approach-input">1. How would you approach it?</label><textarea id="approach-input" rows="4" value={approach} onChange={(event) => setApproach(event.target.value)} placeholder="Clarify the requirements, describe a first approach, and call out assumptions..." /><label htmlFor="answer-input">2. Write your code or answer</label><textarea id="answer-input" rows="7" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Share your solution. For code, include the language and any tests you considered..." /><VoiceAnswerInput value={answer} onChange={setAnswer} language={voiceLanguage} onLanguageChange={setVoiceLanguage} onBusyChange={setVoiceBusy} /><div className="form-bottom"><span><Target size={14} /> Reasoning over speed</span><button type="submit" className="primary-button" disabled={evaluating || voiceBusy}>{evaluating ? <><span className="button-spinner" /> Reviewing</> : voiceBusy ? 'Transcribing' : <>Review my thinking <ArrowRight size={15} /></>}</button></div>{evalError && <p className="form-error" role="alert">{evalError}</p>}</form><div className="evaluation-panel">{evaluation ? <EvaluationResult result={evaluation} /> : <div className="evaluation-empty"><div className="evaluation-empty-icon"><Sparkles size={21} /></div><h3>Your feedback will appear here.</h3><p>We will look for clear assumptions, a deliberate approach, tested edge cases, and an explanation of complexity.</p><div className="score-preview"><span>Understanding</span><i /><span>Approach</span><i /><span>Clarity</span></div></div>}</div></div></section>
    <section className="progress-section"><div className="progress-heading"><div><div className="eyebrow muted">YOUR PRACTICE HISTORY</div><h2>Progress you can see.</h2></div><div className="average-score"><strong>{averageScore}</strong><span>average score</span></div></div>{historyChart.length ? <div className="progress-chart" role="img" aria-label="Recent thinking evaluator scores from 1 to 10">{historyChart.map((item, index) => <div className="chart-column" key={`${item.date}-${index}`}><span>{item.score}</span><i style={{ height: `${item.score * 10}%` }} /><small>{new Date(`${item.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>)}</div> : <div className="progress-empty"><ChartColumnIncreasingIcon />Your score history will appear after your first review.</div>}</section>
    <section className="coach-promo"><div className="coach-promo-mark"><MessageCircle size={22} /></div><div><div className="eyebrow muted">PRACTICE HOW YOU COMMUNICATE</div><h2>Good ideas deserve to be heard.</h2><p>Work on your answers, one conversation at a time.</p></div><button className="outline-button" onClick={onCoach}>Open communication coach <ArrowRight size={15} /></button></section>
  </main>
}

function ChartColumnIncreasingIcon() {
  return <span className="chart-empty-icon"><PanelsTopLeft size={19} /></span>
}

function EvaluationResult({ result }) {
  const metrics = [['Understanding', 'problemUnderstanding'], ['Approach', 'approachQuality'], ['Edge cases', 'edgeCases'], ['Correctness', 'codeCorrectness'], ['Complexity', 'complexity'], ['Clarity', 'clarity']]
  return <div className="evaluation-result"><div className="evaluation-result-head"><span><Check size={14} /> THINKING REVIEW</span><strong>{Math.round(Object.values(result.scores).reduce((sum, score) => sum + score, 0) / 6)}<small>/10</small></strong></div><div className="score-metrics">{metrics.map(([label, key]) => <div key={key}><span>{label}</span><strong>{result.scores[key]}/10</strong><i><b style={{ width: `${result.scores[key] * 10}%` }} /></i></div>)}</div><div className="feedback-list"><h4>What worked</h4>{result.strengths.map((item) => <p key={item}><Check size={13} /> {item}</p>)}<h4>Build next</h4>{result.gaps.map((item) => <p key={item}><ArrowRight size={13} /> {item}</p>)}</div><div className="job-thinking"><span className="mini-label">JOB-LEVEL THINKING</span>{result.jobLevelThinking.map((item) => <p key={item}>{item}</p>)}</div><div className="improvement-plan"><span className="mini-label">YOUR NEXT 3 STEPS</span><ol>{result.improvementPlan.map((item) => <li key={item}>{item}</li>)}</ol><p className="followup-problem"><strong>Follow-up:</strong> {result.followUp}</p></div>{result.note && <small className="feedback-note">{result.note}</small>}</div>
}

function CoachView() {
  const [scenario, setScenario] = useState(scenarios[0])
  const [transcript, setTranscript] = useState('')
  const [voiceLanguage, setVoiceLanguage] = useState('en-IN')
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState(() => storage.get('sai-coach-history', []))
  const [streak, setStreak] = useState(() => storage.get('sai-coach-streak', { count: 0, lastDate: '' }))
  const [sessionStartedAt, setSessionStartedAt] = useState(null)
  const [sessionSeconds, setSessionSeconds] = useState(0)
  const [timerNotice, setTimerNotice] = useState('')
  const [speechVoices, setSpeechVoices] = useState(() => typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis.getVoices() : [])
  const [selectedVoiceURI, setSelectedVoiceURI] = useState('')
  const [questionMuted, setQuestionMuted] = useState(false)
  const [questionPlayed, setQuestionPlayed] = useState(false)
  const defaultVoiceURI = speechVoices.find((voice) => voice.lang.toLowerCase().startsWith('en'))?.voiceURI || speechVoices[0]?.voiceURI || ''
  const question = scenario === 'Tell me about yourself' || scenario === 'Campus placement self-intro'
    ? 'Tell me about yourself, and what brings you to this role?'
    : scenario === 'Behavioral (STAR method)'
      ? 'Tell me about a time a project did not go to plan. What did you do?'
      : scenario === 'Explain a project'
        ? 'Choose a project you worked on. What problem did it solve, and what was your contribution?'
        : scenario === 'Group discussion'
          ? 'How would you respond if someone in a group discussion strongly disagreed with your idea?'
          : 'What is a challenge you have worked through, and what did you learn?'

  useEffect(() => storage.set('sai-coach-history', history), [history])
  useEffect(() => storage.set('sai-coach-streak', streak), [streak])
  useEffect(() => {
    if (!('speechSynthesis' in window)) return undefined
    const updateVoices = () => setSpeechVoices(window.speechSynthesis.getVoices())
    window.speechSynthesis.addEventListener('voiceschanged', updateVoices)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', updateVoices)
      window.speechSynthesis.cancel()
    }
  }, [])
  useEffect(() => {
    if (!sessionStartedAt) return undefined
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - sessionStartedAt) / 1000)
      setSessionSeconds(Math.min(seconds, 300))
      if (seconds >= 300) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [sessionStartedAt])
  const speakQuestion = () => {
    if (!('speechSynthesis' in window)) {
      setError('Voice playback is not supported here. Read the question below and type or record your answer.')
      return
    }
    if (questionMuted) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(question)
    utterance.voice = speechVoices.find((voice) => voice.voiceURI === (selectedVoiceURI || defaultVoiceURI)) || null
    utterance.rate = 0.94
    utterance.onend = () => setQuestionPlayed(true)
    window.speechSynthesis.speak(utterance)
  }

  const toggleQuestionMute = () => {
    if (!questionMuted) window.speechSynthesis?.cancel()
    setQuestionMuted((current) => !current)
  }

  const reviewAnswer = async (event) => {
    event.preventDefault()
    if (!transcript.trim()) { setError('Add an answer before requesting feedback.'); return }
    setBusy(true)
    setError('')
    let result
    try {
      result = await postJSON('/api/coach', { scenario, transcript })
      if (!Number.isFinite(result.score) || result.score < 1 || result.score > 10 || !result.feedback || !coachFeedbackKeys.every((key) => typeof result.feedback[key] === 'string') || typeof result.improvedSample !== 'string' || typeof result.exercise !== 'string') throw new Error('Feedback response was invalid')
    } catch {
      result = coachFallback({ scenario, transcript })
    }
    const today = new Date().toISOString().slice(0, 10)
    const duration = sessionStartedAt ? Math.floor((Date.now() - sessionStartedAt) / 1000) : 0
    const finishedFiveMinutes = duration >= 300
    setSessionSeconds(Math.min(duration, 300))
    setFeedback(result)
    setHistory((current) => [...current, { date: today, score: result.score, scenario }].slice(-40))
    if (finishedFiveMinutes) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      setStreak((current) => current.lastDate === today ? current : { count: current.lastDate === yesterday ? current.count + 1 : 1, lastDate: today })
      setTimerNotice('Five-minute practice complete. Your daily streak is up to date.')
    } else {
      setTimerNotice('Feedback saved. Complete five minutes of practice to count toward your daily streak.')
    }
    setBusy(false)
  }

  const trend = history.slice(-7)
  return <main className="coach-page content-width">
    <div className="page-kicker"><span>COMMUNICATION LAB / SPEAK WITH CLARITY</span><span className="local-save"><Check size={13} /> Practice saved on this device</span></div>
    <div className="coach-hero"><div><div className="eyebrow muted">YOUR PRACTICE PARTNER</div><h1>Find your voice.<br /><span>Keep it yours.</span></h1><p>Practice real interview moments. Get clear, specific feedback. Try again with one small change.</p></div><div className="coach-streak"><div className="streak-count"><span>{streak.count}</span><small>day{streak.count === 1 ? '' : 's'}</small></div><span>practice streak</span><small>Five focused minutes a day can build the habit.</small></div></div>
    <div className="coach-workspace">
      <section className="coach-session">
        <div className="coach-session-top"><div><div className="eyebrow muted">PRACTICE SESSION</div><h2>Choose a scenario.</h2></div><span className="session-number">01</span></div>
        <label htmlFor="scenario-select">WHAT WOULD YOU LIKE TO PRACTICE?</label>
        <div className="select-wrap scenario-select"><select id="scenario-select" value={scenario} onChange={(event) => { setScenario(event.target.value); setFeedback(null); setSessionStartedAt(null); setSessionSeconds(0); setTimerNotice('') }}>{scenarios.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></div>
        <div className="practice-timer"><div><strong>{String(Math.floor(sessionSeconds / 60)).padStart(2, '0')}:{String(sessionSeconds % 60).padStart(2, '0')}</strong><span>of 05:00 daily goal</span></div><div className="timer-track"><i style={{ width: `${Math.min(sessionSeconds / 300 * 100, 100)}%` }} /></div><button type="button" onClick={() => { setSessionStartedAt(Date.now()); setSessionSeconds(0); setTimerNotice('Keep practicing for five minutes to add this day to your streak.') }}><Clock3 size={13} /> {sessionStartedAt ? 'Restart timer' : 'Start 5-minute timer'}</button></div>
        {timerNotice && <p className="timer-notice" role="status">{timerNotice}</p>}
        <div className="question-card">
          <div className="question-card-top">
            <span><MessageCircle size={14} /> YOUR QUESTION</span>
            <div className="question-audio-controls">
              {speechVoices.length > 0 && <select aria-label="Question playback voice" value={selectedVoiceURI || defaultVoiceURI} onChange={(event) => setSelectedVoiceURI(event.target.value)}>{speechVoices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>)}</select>}
              <button type="button" onClick={speakQuestion} title={questionPlayed ? 'Replay question' : 'Read question aloud'}><Volume2 size={15} /> {questionPlayed ? 'Replay' : 'Listen'}</button>
              <button type="button" onClick={toggleQuestionMute} title={questionMuted ? 'Unmute question audio' : 'Mute question audio'}>{questionMuted ? <VolumeX size={15} /> : <Volume2 size={15} />} {questionMuted ? 'Unmute' : 'Mute'}</button>
            </div>
          </div>
          <p>{question}</p>
          <small>Take a breath, then answer as you would in the room.</small>
        </div>
        <form onSubmit={reviewAnswer}>
          <label htmlFor="answer-transcript">YOUR ANSWER</label>
          <textarea id="answer-transcript" rows="8" value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Type a response, or use the microphone to dictate..." spellCheck={false} />
          <VoiceAnswerInput value={transcript} onChange={setTranscript} language={voiceLanguage} onLanguageChange={setVoiceLanguage} onBusyChange={setVoiceBusy} />
          <div className="transcript-meta"><span>{transcript.trim() ? transcript.trim().split(/\s+/).length : 0} words</span><span>Edit your answer before feedback</span></div>
          <div className="coach-controls"><button className="primary-button" type="submit" disabled={busy || voiceBusy}>{busy ? <><span className="button-spinner" /> Reviewing</> : voiceBusy ? 'Transcribing' : <>Get feedback <ArrowRight size={15} /></>}</button></div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
        <div className="privacy-note"><Lightbulb size={15} /><p>Your practice stays in this browser. Avoid sharing sensitive personal details.</p></div>
      </section>
      <section className="coach-feedback"><div className="coach-feedback-head"><div><div className="eyebrow muted">YOUR REVIEW</div><h2>Thoughtful feedback.</h2></div>{feedback && <div className="coach-score"><strong>{feedback.score}</strong><span>/10</span></div>}</div>{feedback ? <div className="coach-feedback-content"><div className="coach-feedback-list">{Object.entries(feedback.feedback).map(([key, value]) => <div className="coach-feedback-item" key={key}><span>{titleCase(key)}</span><p>{value}</p></div>)}</div><div className="improved-answer"><span className="mini-label">A STRUCTURE TO MAKE YOUR OWN</span><p>{feedback.improvedSample}</p></div><div className="next-exercise"><span><Target size={14} /> NEXT EXERCISE</span><p>{feedback.exercise}</p></div>{feedback.note && <small className="feedback-note">{feedback.note}</small>}</div> : <div className="coach-feedback-empty"><div className="feedback-orbit"><div><Sparkles size={22} /></div><span className="feedback-orbit-dot dot-one" /><span className="feedback-orbit-dot dot-two" /></div><h3>Every answer is a draft.</h3><p>Once you practice, you will see feedback on structure, clarity, filler words, length, confidence, vocabulary and grammar.</p><div className="feedback-dimensions"><span>Structure</span><span>Clarity</span><span>Delivery</span><span>Grammar</span></div></div>}</section></div>
    <section className="coach-history"><div className="progress-heading"><div><div className="eyebrow muted">YOUR PRACTICE OVER TIME</div><h2>Small steps, visible growth.</h2></div><span className="history-count">{history.length} practice {history.length === 1 ? 'session' : 'sessions'}</span></div>{trend.length ? <div className="coach-trend">{trend.map((item, index) => <div key={`${item.date}-${index}`}><span>{item.score}</span><i style={{ height: `${item.score * 10}%` }} /><small>{new Date(`${item.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>)}</div> : <div className="progress-empty"><span className="chart-empty-icon"><BookOpen size={19} /></span>Your practice scores will appear after your first session.</div>}</section>
  </main>
}

export default App
