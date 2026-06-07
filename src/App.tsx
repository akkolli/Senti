import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowRight,
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  Filter,
  Gauge,
  Layers3,
  Loader2,
  LogOut,
  Play,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  User,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  Radar,
  RadarChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { insforge } from './lib/insforge'
import type { Answer, ConnectorRun, OpinionScore, RunSnapshot, RunStatus, Source } from './lib/types'
import { compactNumber, formatDate, fullNumber, statusColor } from './lib/format'

type AuthState = {
  user: any
  loading: boolean
}

const chartColors = ['#5f7355', '#c59b43', '#3d8c95', '#c85f4a', '#637381', '#151719']
const timeWindowLabels: Record<string, string> = {
  now_72h: '72 hours',
  recent_30d: '30 days',
  historic_12m: '12 months',
}
const depthLabels: Record<string, string> = {
  mini: 'Mini',
  large: 'Large',
  giant: 'Giant',
  quick: 'Quick',
  standard: 'Standard',
  deep: 'Deep',
}

const runPhases: Record<string, { eyebrow: string; title: string; detail: string }> = {
  starting: {
    eyebrow: 'Starting',
    title: 'Opening the research channel',
    detail: 'Senti is creating the run and preparing the evidence workers.',
  },
  queued: {
    eyebrow: 'Queued',
    title: 'Holding a clean slot',
    detail: 'The run is waiting for the worker loop to pick up the next stage.',
  },
  planning: {
    eyebrow: 'Planning',
    title: 'Mapping search intent',
    detail: 'The topic is being normalized into aliases, source families, and report questions.',
  },
  checking_cache: {
    eyebrow: 'Cache',
    title: 'Checking prior evidence',
    detail: 'Stored public sources are being reviewed before new collection starts.',
  },
  collecting: {
    eyebrow: 'Collecting',
    title: 'Pulling public signals',
    detail: 'Connectors are collecting candidate sources and rejecting low-quality matches.',
  },
  analyzing: {
    eyebrow: 'Analyzing',
    title: 'Scoring evidence',
    detail: 'Senti is classifying sentiment, extracting themes, and attaching citations.',
  },
  ready: {
    eyebrow: 'Composing',
    title: 'Assembling the report',
    detail: 'The final brief is being stitched together from collected public sources.',
  },
  complete: {
    eyebrow: 'Ready',
    title: 'Report ready',
    detail: 'The progress surface is becoming the results workspace.',
  },
  partial: {
    eyebrow: 'Ready',
    title: 'Source read ready',
    detail: 'The collected source set is ready to inspect.',
  },
  failed: {
    eyebrow: 'Stopped',
    title: 'Run stopped',
    detail: 'The worker could not finish this run. Review the latest event and try a new search.',
  },
}

function useAuth(): AuthState & { refresh: () => Promise<void> } {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setLoading(true)
    const { data } = await insforge.auth.getCurrentUser()
    setUser(data?.user ?? null)
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  return { user, loading, refresh }
}

function Shell({ user, children }: { user: any; children: ReactNode }) {
  const navigate = useNavigate()

  async function signOut() {
    await insforge.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-fog text-ink">
      <header className="sticky top-0 z-20 border-b border-ink/10 bg-fog/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between px-5 py-3">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-ink text-white">
              <Sparkles size={18} />
            </div>
          </Link>
          <nav className="flex items-center gap-2">
            <Link className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-white" to="/">
              <BarChart3 size={16} />
              Runs
            </Link>
            <Link className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-white" to="/settings">
              <Settings size={16} />
              Settings
            </Link>
            <div className="hidden items-center gap-2 border-l border-ink/10 pl-3 text-sm text-steel md:flex">
              <User size={16} />
              {user?.email ?? 'Signed in'}
            </div>
            <button className="rounded-md border border-ink/10 bg-white p-2 hover:bg-ink hover:text-white" onClick={signOut} aria-label="Sign out">
              <LogOut size={16} />
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1680px] px-5 py-5">{children}</main>
    </div>
  )
}

function App() {
  const auth = useAuth()

  if (auth.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-fog text-ink">
        <div className="rounded-md border border-ink/10 bg-white px-4 py-3 shadow-panel">Loading Senti...</div>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage onAuth={auth.refresh} user={auth.user} />} />
      <Route
        path="/"
        element={auth.user ? <Shell user={auth.user}><DashboardPage /></Shell> : <Navigate to="/login" replace />}
      />
      <Route
        path="/runs/:runId"
        element={auth.user ? <Shell user={auth.user}><RunPage /></Shell> : <Navigate to="/login" replace />}
      />
      <Route
        path="/settings"
        element={auth.user ? <Shell user={auth.user}><SettingsPage /></Shell> : <Navigate to="/login" replace />}
      />
    </Routes>
  )
}

function LoginPage({ user, onAuth }: { user: any; onAuth: () => Promise<void> }) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (user) navigate('/')
  }, [navigate, user])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setMessage('')
    const result = mode === 'signin'
      ? await insforge.auth.signInWithPassword({ email, password })
      : await insforge.auth.signUp({ email, password, name, redirectTo: `${window.location.origin}/login` })

    if (result.error) {
      setMessage(result.error.message ?? 'Authentication failed')
      return
    }
    if (result.data?.requireEmailVerification) {
      setMessage('Check your email for the verification code or link, then sign in.')
      return
    }
    await onAuth()
    navigate('/')
  }

  async function oauth(provider: 'google' | 'github') {
    await insforge.auth.signInWithOAuth(provider, { redirectTo: window.location.origin })
  }

  return (
    <div className="min-h-screen bg-fog px-5 py-8 text-ink">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_420px]">
        <section className="flex min-h-[640px] flex-col justify-between rounded-md border border-ink/10 bg-white p-8 shadow-panel">
          <div>
            <div className="mb-8 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-ink text-white">
                <Sparkles size={20} />
              </div>
              <div>
                <div className="text-xl font-semibold">Senti</div>
                <div className="text-sm text-steel">Public opinion, scored from cited evidence.</div>
              </div>
            </div>
            <div className="max-w-3xl">
              <h1 className="text-4xl font-semibold leading-tight md:text-5xl">Ask what the market thinks. Get the evidence, pain points, competitor gaps, and actions.</h1>
              <p className="mt-5 max-w-2xl text-lg text-steel">
                Senti turns Tavily web evidence, Google-indexed social results, direct Bluesky posts, and stored public sources into an executive-ready source read.
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              ['10-10,000 target', 'Candidate source target per run.'],
              ['LLM analyzed', 'DeepSeek extracts themes, opinions, and source-backed details.'],
              ['Source-first', 'Mini runs interpret the sources they collect.'],
            ].map(([title, text]) => (
              <div key={title} className="rounded-md border border-ink/10 p-4">
                <div className="font-semibold">{title}</div>
                <div className="mt-1 text-sm text-steel">{text}</div>
              </div>
            ))}
          </div>
        </section>
        <form onSubmit={submit} className="rounded-md border border-ink/10 bg-white p-6 shadow-panel">
          <div className="mb-6 flex rounded-md bg-fog p-1">
            <button type="button" onClick={() => setMode('signin')} className={`flex-1 rounded px-3 py-2 text-sm ${mode === 'signin' ? 'bg-white shadow-panel' : 'text-steel'}`}>
              Sign in
            </button>
            <button type="button" onClick={() => setMode('signup')} className={`flex-1 rounded px-3 py-2 text-sm ${mode === 'signup' ? 'bg-white shadow-panel' : 'text-steel'}`}>
              Create account
            </button>
          </div>
          {mode === 'signup' && (
            <label className="mb-4 block text-sm font-medium">
              Name
              <input className="mt-1 w-full rounded-md border border-ink/10 px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
          )}
          <label className="mb-4 block text-sm font-medium">
            Email
            <input className="mt-1 w-full rounded-md border border-ink/10 px-3 py-2" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label className="mb-4 block text-sm font-medium">
            Password
            <input className="mt-1 w-full rounded-md border border-ink/10 px-3 py-2" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          {message && <div className="mb-4 rounded-md border border-coral/30 bg-coral/10 p-3 text-sm text-coral">{message}</div>}
          <button className="flex w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-2.5 font-medium text-white hover:bg-ink/90" type="submit">
            <Play size={16} />
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <div className="my-5 h-px bg-ink/10" />
          <div className="grid gap-2">
            <button type="button" onClick={() => oauth('google')} className="rounded-md border border-ink/10 px-4 py-2 text-sm hover:bg-fog">Continue with Google</button>
            <button type="button" onClick={() => oauth('github')} className="rounded-md border border-ink/10 px-4 py-2 text-sm hover:bg-fog">Continue with GitHub</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DashboardPage() {
  const navigate = useNavigate()
  const [topic, setTopic] = useState('')
  const [depth, setDepth] = useState('standard')
  const [timeWindow, setTimeWindow] = useState('recent_30d')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  async function startRun(event: FormEvent) {
    event.preventDefault()
    const cleanTopic = topic.trim()
    if (!cleanTopic) return
    setStarting(true)
    setError('')
    const { data, error: invokeError } = await insforge.functions.invoke('start-research-run', {
      body: { topic: cleanTopic, region: 'Global', depth, timeWindow },
    })
    if (invokeError || !data?.runId) {
      setStarting(false)
      setError(invokeError?.message ?? 'Unable to start run')
      return
    }
    navigate(`/runs/${data.runId}`)
  }

  return (
    <div className={`senti-home ${starting ? 'is-launching' : ''}`}>
      <section className="senti-orbit" aria-label="Start research">
        <div className="senti-brand-mark">
          <Sparkles size={24} />
        </div>
        <div className="senti-search-heading">
          <h1>Senti</h1>
        </div>
        <form onSubmit={startRun} className="senti-search-form">
          <div className="senti-search-bar">
            <Search className="senti-search-icon" size={24} />
            <input
              aria-label="Research topic"
              autoComplete="off"
              autoFocus
              className="senti-search-input"
              disabled={starting}
              placeholder="Nike"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
            />
            <button className="senti-search-submit" disabled={starting || !topic.trim()} type="submit" aria-label="Start research">
              {starting ? <Loader2 size={22} className="animate-spin" /> : <ArrowRight size={22} />}
            </button>
          </div>
          <div className="senti-option-row" aria-label="Research settings">
            <label className="senti-option-control">
              <Layers3 size={15} />
              <select value={depth} disabled={starting} onChange={(event) => setDepth(event.target.value)} aria-label="Depth">
                <option value="mini">Mini · 10</option>
                <option value="standard">Standard · 100</option>
                <option value="large">Large · 1,000</option>
                <option value="giant">Giant · 10,000</option>
              </select>
            </label>
            <label className="senti-option-control">
              <Clock size={15} />
              <select value={timeWindow} disabled={starting} onChange={(event) => setTimeWindow(event.target.value)} aria-label="Time window">
                <option value="now_72h">72 hours</option>
                <option value="recent_30d">30 days</option>
                <option value="historic_12m">12 months</option>
              </select>
            </label>
          </div>
          {error && <div className="senti-error">{error}</div>}
          {starting && (
            <div className="senti-launch-panel">
              <div className="senti-launch-line" />
              <div>
                <div className="text-sm font-semibold">Creating run</div>
                <div className="mt-1 text-sm text-steel">Opening the evidence stream.</div>
              </div>
            </div>
          )}
        </form>
      </section>
    </div>
  )
}

function isReportReady(status: RunStatus | undefined) {
  return status === 'complete' || status === 'partial'
}

function RunProgressScreen({ snapshot, booting = false }: { snapshot: RunSnapshot | null; booting?: boolean }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const run = snapshot?.run
  const status = run?.status ?? 'starting'
  const phase = runPhases[status] ?? runPhases.starting
  const progress = booting ? 7 : Math.max(8, Math.min(100, Number(run?.progress_percent ?? 14)))
  const latestEvent = snapshot?.events?.[snapshot.events.length - 1]
  const done = isReportReady(run?.status)
  const failed = run?.status === 'failed'
  const connectors = snapshot?.connectors ?? []
  const jobs = snapshot?.jobs ?? []
  const activeJobs = jobs.filter((job) => !['complete', 'failed'].includes(job.status)).length
  const completedConnectors = connectors.filter((connector) => connector.status === 'complete').length
  const statusMessage = latestEvent?.message ?? phase.detail

  const statTiles = [
    { label: 'Collected', value: compactNumber(run?.candidates_collected) },
    { label: 'Analyzed', value: compactNumber(run?.classified_count) },
    { label: 'Evidence', value: compactNumber(run?.evidence_count) },
    { label: 'Citations', value: compactNumber(run?.citation_count) },
  ]

  return (
    <section className={`senti-progress-shell ${done ? 'is-done' : ''} ${failed ? 'is-failed' : ''}`} aria-live="polite">
      <div className="senti-progress-hero">
        <div className="senti-progress-glow" />
        <div className="senti-progress-core">
          <div className="senti-progress-kicker">
            <span>{phase.eyebrow}</span>
            <span>{fullNumber(progress)}%</span>
          </div>
          <h1>{run?.topic ?? 'Preparing Senti'}</h1>
          <p>{phase.title}</p>
          <div className="senti-progress-track" aria-label="Run progress">
            <div style={{ width: `${progress}%` }} />
          </div>
          <div className="senti-progress-actions">
            <div className="senti-progress-status">
              <Loader2 size={16} className={done || failed ? '' : 'animate-spin'} />
              <span>{statusMessage}</span>
            </div>
            <button type="button" onClick={() => setDetailsOpen((open) => !open)}>
              {detailsOpen ? 'Hide details' : 'Evidence details'}
            </button>
          </div>
        </div>
      </div>

      {detailsOpen && (
        <section className="senti-progress-details">
          <div className="senti-details-header">
            <div className="senti-panel-heading">
              <Database size={17} />
              <span>Evidence details</span>
            </div>
            <span>{completedConnectors} connectors complete · {activeJobs} jobs active</span>
          </div>
          <div className="senti-stat-grid">
            {statTiles.map((tile) => (
              <div key={tile.label} className="senti-stat-tile">
                <span>{tile.label}</span>
                <strong>{tile.value}</strong>
              </div>
            ))}
          </div>
          <div className="senti-connector-strip">
            {connectors.length === 0 ? (
              <div className="senti-connector-pill">Connectors warming</div>
            ) : (
              connectors.slice(0, 5).map((connector) => (
                <div key={connector.id} className="senti-connector-pill">
                  <span>{connector.connector_name}</span>
                  <strong>{connector.status}</strong>
                </div>
              ))
            )}
          </div>
          <div className="senti-progress-footnote">
            {depthLabels[run?.depth ?? 'standard'] ?? 'Standard'} · {timeWindowLabels[run?.time_window ?? 'recent_30d'] ?? '30 days'}
          </div>
        </section>
      )}
    </section>
  )
}

function RunPage() {
  const { runId } = useParams()
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [question, setQuestion] = useState('')
  const [chatAnswer, setChatAnswer] = useState<any>(null)
  const [selectedSource, setSelectedSource] = useState<Source | null>(null)
  const [showResults, setShowResults] = useState(false)
  const processingRef = useRef(false)

  const loadStatus = useCallback(async () => {
    if (!runId) return
    const { data } = await insforge.functions.invoke('run-status', { body: { runId } })
    if (data?.run) setSnapshot(data)
    setLoading(false)
  }, [runId])

  const processNext = useCallback(async () => {
    if (!runId || processingRef.current) return
    processingRef.current = true
    try {
      await insforge.functions.invoke('process-worker-job', { body: { runId } })
      await loadStatus()
    } finally {
      processingRef.current = false
    }
  }, [loadStatus, runId])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    const status = snapshot?.run?.status
    if (!status) return
    if (['complete', 'failed', 'partial'].includes(status)) return
    const timer = window.setInterval(() => {
      void processNext()
    }, 2500)
    return () => window.clearInterval(timer)
  }, [processNext, snapshot?.run?.status])

  useEffect(() => {
    const status = snapshot?.run?.status
    if (!isReportReady(status)) {
      setShowResults(false)
      return
    }
    setShowResults(false)
    const timer = window.setTimeout(() => setShowResults(true), 900)
    return () => window.clearTimeout(timer)
  }, [runId, snapshot?.run?.status])

  async function ask(event: FormEvent) {
    event.preventDefault()
    if (!question.trim() || !runId) return
    const { data } = await insforge.functions.invoke('ask-report-question', { body: { runId, question } })
    setChatAnswer(data)
    setQuestion('')
  }

  if (loading || !snapshot) {
    return <RunProgressScreen snapshot={snapshot} booting />
  }

  if (!isReportReady(snapshot.run.status) || !showResults) {
    return <RunProgressScreen snapshot={snapshot} />
  }

  const primaryScore = getPrimaryScore(snapshot)
  const sourcesById = new Map(snapshot.sources.map((source) => [source.id, source]))

  return (
    <div className="senti-results-reveal senti-results-page">
      <ResultsHero snapshot={snapshot} score={primaryScore} />
      <InsightsPanel snapshot={snapshot} />
      <section className="senti-results-grid">
        <div className="senti-results-main">
          <QuestionsPanel questions={snapshot.questions} answers={snapshot.answers} sourcesById={sourcesById} onSource={setSelectedSource} />
        </div>
        <aside className="senti-results-side">
          <EvidencePanel sources={snapshot.sources} evidence={snapshot.evidence} onSource={setSelectedSource} selectedSource={selectedSource} />
          <ChatPanel question={question} setQuestion={setQuestion} ask={ask} answer={chatAnswer} />
        </aside>
      </section>
      <DiagnosticsPanel snapshot={snapshot} />
    </div>
  )
}

function ResultsHero({ snapshot, score }: { snapshot: RunSnapshot; score?: OpinionScore }) {
  const run = snapshot.run
  const productImage = productImageFor(snapshot)
  const runLabel = depthLabels[run.depth] ?? run.depth
  return (
    <section className="senti-report-hero">
      <div className="senti-report-hero-top">
        <div>
          <div className="senti-report-eyebrow">{runLabel} evidence read</div>
          <h1>{run.topic}</h1>
          <p>{run.summary ?? 'Senti is preparing a source read.'}</p>
        </div>
        <span className={`senti-report-status ${statusColor(run.status)}`}>{run.status}</span>
      </div>
      <div className="senti-report-visual" aria-label="Product image">
        {productImage ? (
          <img src={productImage} alt="" />
        ) : (
          <div className="senti-report-visual-fallback">
            <Sparkles size={30} />
            <span>{run.topic.slice(0, 24)}</span>
          </div>
        )}
      </div>
      <div className="senti-report-meter">
        <div style={{ width: `${Math.max(0, Math.min(100, Number(run.progress_percent ?? 0)))}%` }} />
      </div>
      <div className="senti-report-stats">
        <Metric label="Public opinion score" value={score?.score == null ? '—' : `${score.score}/100`} />
        <Metric label="Read type" value={runLabel} />
        <Metric label="Collected" value={`${compactNumber(run.candidates_collected)} / ${compactNumber(run.target_candidates)}`} />
        <Metric label="Sources" value={compactNumber(snapshot.sources.length || run.candidates_collected)} />
      </div>
    </section>
  )
}

function imageUrlFromMetadata(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null
  const keys = ['image', 'imageUrl', 'thumbnail', 'thumbnailUrl', 'ogImage', 'candidateImage']
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value
  }
  for (const key of ['images', 'image_urls']) {
    const value = metadata[key]
    if (Array.isArray(value)) {
      const found = value.find((item) => typeof item === 'string' && /^https?:\/\//i.test(item))
      if (found) return String(found)
    }
  }
  return null
}

function productImageFor(snapshot: RunSnapshot): string | null {
  for (const source of snapshot.sources) {
    const image = imageUrlFromMetadata(source.metadata)
    if (image) return image
  }
  return null
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-ink/10 p-3">
      <div className="text-xs text-steel">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  )
}

type InsightCount = {
  label: string
  count: number
}

function countList(value: unknown, limit = 6): InsightCount[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return { label: item, count: 1 }
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const label = String(record.label ?? record.name ?? '').trim()
      if (!label) return null
      return { label, count: Number(record.count ?? record.value ?? record.source_count ?? 1) }
    })
    .filter((item): item is InsightCount => !!item)
    .slice(0, limit)
}

function sourceSignalCounts(snapshot: RunSnapshot): InsightCount[] {
  const patterns: Array<[RegExp, string]> = [
    [/\b(price|pricing|expensive|cost|worth|value|\$|€)\b/i, 'price and value'],
    [/\b(design|styling|aesthetic|looks|backlash|criticize|criticism|brutal)\b/i, 'design reaction'],
    [/\b(demand|booked|orders|sell|sales|interest|customer)\b/i, 'customer demand'],
    [/\b(ev|electric|battery|range|charging)\b/i, 'electric transition'],
    [/\b(rival|competitor|mclaren|porsche|lamborghini|tesla|aston martin)\b/i, 'competitor context'],
    [/\b(review|opinion|thoughts|reaction|unpopular)\b/i, 'public reaction'],
  ]
  const counts = new Map<string, number>()
  for (const source of snapshot.sources) {
    const text = `${source.title ?? ''} ${source.platform ?? ''}`
    for (const [pattern, label] of patterns) {
      if (pattern.test(text)) counts.set(label, (counts.get(label) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6)
}

function sourceFamilyCounts(snapshot: RunSnapshot): InsightCount[] {
  const counts = new Map<string, number>()
  for (const source of snapshot.sources) {
    const label = source.source_family || source.platform || 'source'
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return Array.from(counts.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6)
}

function topSourceTitles(snapshot: RunSnapshot): InsightCount[] {
  return snapshot.sources
    .slice(0, 6)
    .map((source) => ({ label: source.title ?? source.canonical_url, count: 1 }))
}

function sentimentRead(score: OpinionScore | undefined, snapshot: RunSnapshot): { label: string; detail: string } {
  const positive = Number(score?.component_json?.positive ?? 0)
  const negative = Number(score?.component_json?.negative ?? 0)
  const mixed = Number(score?.component_json?.mixed ?? 0) + Number(score?.component_json?.neutral ?? 0)
  if (!score || positive + negative + mixed === 0) {
    return {
      label: 'Source read',
      detail: `${fullNumber(snapshot.sources.length || snapshot.run.candidates_collected)} public sources collected for this run.`,
    }
  }
  if (negative > positive && negative >= mixed) {
    return { label: 'Negative tilt', detail: `${fullNumber(negative)} negative evidence items vs. ${fullNumber(positive)} positive.` }
  }
  if (positive > negative && positive >= mixed) {
    return { label: 'Positive tilt', detail: `${fullNumber(positive)} positive evidence items vs. ${fullNumber(negative)} negative.` }
  }
  return { label: 'Mixed signal', detail: `${fullNumber(mixed)} mixed or neutral evidence items.` }
}

function InsightsPanel({ snapshot }: { snapshot: RunSnapshot }) {
  const score = getPrimaryScore(snapshot)
  const sentiment = sentimentRead(score, snapshot)
  const themes = countList(score?.component_json?.themes, 8)
  const sourceSignals = sourceSignalCounts(snapshot)
  const sourceFamilies = sourceFamilyCounts(snapshot)
  const topSources = topSourceTitles(snapshot)
  const pros = countList(score?.component_json?.positiveDrivers, 6)
  const painPoints = countList(score?.component_json?.painPoints, 6)
  const blockers = countList(score?.component_json?.adoptionBlockers, 6)
  const pricing = countList(score?.component_json?.pricingSignals, 6)
  const competitors = countList(score?.component_json?.competitorMentions, 3)
  const cons = [...painPoints, ...blockers, ...pricing].slice(0, 8)
  const comparisonEntityById = new Map(snapshot.comparisonEntities.map((entity) => [entity.id, entity]))
  const comparisonRows = snapshot.comparisons
    .map((comparison) => ({
      ...comparison,
      name: comparisonEntityById.get(comparison.comparison_entity_id)?.canonical_name ?? 'Competitor',
    }))
    .filter((comparison) => comparison.summary && !/too little|insufficient/i.test(comparison.summary))
    .slice(0, 3)

  const hasInsights = themes.length || sourceSignals.length || sourceFamilies.length || topSources.length || pros.length || cons.length || competitors.length || comparisonRows.length
  if (!hasInsights && !score) return null

  return (
    <section className="senti-insights">
      <div className="senti-insight-lead">
        <div className="senti-insight-eyebrow">Interpretation</div>
        <h2>{sentiment.label}</h2>
        <p>{sentiment.detail}</p>
      </div>
      <div className="senti-insight-grid">
        {(themes.length > 0 || sourceSignals.length > 0) && (
          <InsightCard title="Top signals" items={themes.length ? themes : sourceSignals} />
        )}
        {sourceFamilies.length > 0 && !themes.length && (
          <InsightCard title="Source mix" items={sourceFamilies} />
        )}
        {pros.length > 0 && (
          <InsightCard title="Pros found" items={pros} />
        )}
        {cons.length > 0 && (
          <InsightCard title="Cons and risks" items={cons} />
        )}
        {competitors.length > 0 && (
          <InsightCard title="Competitors mentioned" items={competitors} />
        )}
        {!pros.length && !cons.length && topSources.length > 0 && (
          <InsightCard title="Collected sources" items={topSources} />
        )}
      </div>
      {comparisonRows.length > 0 && (
        <div className="senti-competitor-strip">
          <div className="senti-insight-eyebrow">Competitor read</div>
          <div className="senti-competitor-grid">
            {comparisonRows.map((comparison) => (
              <article key={comparison.id}>
                <h3>{comparison.name}</h3>
                <p>{comparison.summary}</p>
                {[...comparison.strengths, ...comparison.weaknesses].slice(0, 3).length > 0 && (
                  <ul>
                    {[...comparison.strengths, ...comparison.weaknesses].slice(0, 3).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function InsightCard({ title, items }: { title: string; items: InsightCount[] }) {
  return (
    <article className="senti-insight-card">
      <h3>{title}</h3>
      <div className="senti-insight-list">
        {items.map((item) => (
          <div key={item.label} className="senti-insight-item">
            <span>{item.label}</span>
            <strong>{fullNumber(item.count)}</strong>
          </div>
        ))}
      </div>
    </article>
  )
}

function Timeline({ events, jobs }: { events: RunSnapshot['events']; jobs: RunSnapshot['jobs'] }) {
  return (
    <section className="rounded-md border border-ink/10 bg-white p-4 shadow-panel">
      <div className="mb-3 flex items-center gap-2 font-semibold">
        <TrendingUp size={17} />
        Live timeline
      </div>
      <div className="max-h-[360px] space-y-3 overflow-auto pr-1">
        {events.map((event) => (
          <div key={event.id} className="border-l-2 border-cyan pl-3">
            <div className="text-sm font-medium">{event.message}</div>
            <div className="mt-1 text-xs text-steel">{formatDate(event.created_at)} · {event.event_type}</div>
          </div>
        ))}
        {events.length === 0 && <div className="text-sm text-steel">Waiting for run events.</div>}
      </div>
      <div className="mt-4 grid gap-2">
        {jobs.map((job) => (
          <div key={job.id} className="flex items-center justify-between rounded-md bg-fog px-3 py-2 text-xs">
            <span>{job.job_type}</span>
            <span className={`rounded px-2 py-1 ${statusColor(job.status)}`}>{job.status}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function DiagnosticsPanel({ snapshot }: { snapshot: RunSnapshot }) {
  return (
    <details className="senti-diagnostics">
      <summary>
        <span>Diagnostics</span>
        <span>{snapshot.connectors.length} connector runs · {snapshot.jobs.length} worker jobs</span>
      </summary>
      <div className="senti-diagnostics-grid">
        <Timeline events={snapshot.events} jobs={snapshot.jobs} />
        <ConnectorPanel connectors={snapshot.connectors} jobs={snapshot.jobs} />
        <div className="senti-diagnostics-wide">
          <PlotGrid snapshot={snapshot} />
        </div>
      </div>
    </details>
  )
}

function ConnectorPanel({ connectors, jobs }: { connectors: ConnectorRun[]; jobs: RunSnapshot['jobs'] }) {
  const mandatory = ['Tavily', 'ScrapingBee Google', 'Bluesky', 'Senti cache']
  const actual = new Map(connectors.map((connector) => [connector.connector_name, connector]))

  return (
    <section className="rounded-md border border-ink/10 bg-white p-4 shadow-panel">
      <div className="mb-3 flex items-center gap-2 font-semibold">
        <Filter size={17} />
        Collection coverage
      </div>
      <div className="grid gap-2">
        {mandatory.map((name) => {
          const connector = actual.get(name)
          const status = connector?.status ?? (jobs.some((job) => job.status !== 'complete') ? 'queued' : 'cached_only')
          return (
            <div key={name} className="flex items-start justify-between gap-3 rounded-md border border-ink/10 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div>{name}</div>
                {connector?.error_message && (
                  <div className="mt-1 truncate text-xs text-coral" title={connector.error_message}>
                    {connector.error_message}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <span className={`rounded px-2 py-1 text-xs ${statusColor(status)}`}>{status}</span>
                {connector && <div className="mt-1 text-[11px] text-steel">{compactNumber(connector.fetched_count)} fetched</div>}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function PlotGrid({ snapshot }: { snapshot: RunSnapshot }) {
  const run = snapshot.run
  const score = getPrimaryScore(snapshot)
  const funnelData = [
    { name: 'Target', value: run.target_candidates },
    { name: 'Attempted', value: run.candidates_attempted },
    { name: 'Collected', value: run.candidates_collected },
    { name: 'Unique', value: run.candidates_unique },
    { name: 'Relevant', value: run.candidates_relevant },
    { name: 'Classified', value: run.classified_count },
    { name: 'Evidence', value: run.evidence_count },
  ]
  const sourceMix = Object.entries(snapshot.sources.reduce<Record<string, number>>((acc, source) => {
    acc[source.source_family] = (acc[source.source_family] ?? 0) + 1
    return acc
  }, {})).map(([name, value]) => ({ name, value }))
  const sentimentData = [
    { name: 'Positive', value: score?.component_json?.positive ?? 0 },
    { name: 'Negative', value: score?.component_json?.negative ?? 0 },
    { name: 'Neutral/Mixed', value: score?.component_json?.neutral ?? 0 },
  ]
  const componentData = score ? [
    { name: 'Sentiment', value: score.sentiment_balance },
    { name: 'Diversity', value: score.source_diversity },
    { name: 'Complaint risk', value: score.complaint_risk_inverse },
    { name: 'Advocacy', value: score.advocacy_intent },
  ] : []
  const themeData = snapshot.trends.map((trend) => ({ name: trend.label, value: trend.source_count || trend.velocity, sources: trend.source_count }))
  const coverageData = snapshot.connectors.map((connector) => ({ name: connector.connector_name, fetched: connector.fetched_count, reused: connector.reused_count }))
  const freshnessData = freshnessBuckets(snapshot.sources)
  const confidenceMatrix = snapshot.connectors.map((connector) => ({
    name: connector.connector_name.slice(0, 12),
    fetched: Math.min(100, connector.fetched_count),
    status: connector.status === 'complete' ? 100 : connector.status === 'partial' ? 55 : connector.status === 'failed' ? 8 : 25,
  }))

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ChartCard title="Candidate funnel" icon={<Database size={17} />}>
        <BarPlot data={funnelData} />
      </ChartCard>
      <ChartCard title="Source-family mix" icon={<Filter size={17} />}>
        <PiePlot data={sourceMix.length ? sourceMix : [{ name: 'pending', value: 1 }]} />
      </ChartCard>
      <ChartCard title="Score components" icon={<Gauge size={17} />}>
        <RadarPlot data={componentData} />
      </ChartCard>
      <ChartCard title="Sentiment volume" icon={<BarChart3 size={17} />}>
        <BarPlot data={sentimentData} />
      </ChartCard>
      <ChartCard title="Recurring evidence themes" icon={<TrendingUp size={17} />}>
        <BarPlot data={themeData.length ? themeData : [{ name: 'pending', value: 0 }]} />
      </ChartCard>
      <ChartCard title="Connector coverage" icon={<CheckCircle2 size={17} />}>
        <StackedBarPlot data={coverageData.length ? coverageData : [{ name: 'pending', fetched: 0, reused: 0 }]} />
      </ChartCard>
      <ChartCard title="Evidence freshness" icon={<Sparkles size={17} />}>
        <AreaPlot data={freshnessData} />
      </ChartCard>
      <ChartCard title="Source confidence matrix" icon={<ShieldAlert size={17} />}>
        <MatrixPlot data={confidenceMatrix.length ? confidenceMatrix : [{ name: 'pending', fetched: 0, status: 0 }]} />
      </ChartCard>
      <ChartCard title="Citation coverage" icon={<ExternalLink size={17} />}>
        <BarPlot data={[
          { name: 'Evidence', value: run.evidence_count },
          { name: 'Citations', value: run.citation_count },
          { name: 'Themes', value: run.trend_count },
        ]} />
      </ChartCard>
    </div>
  )
}

function getPrimaryScore(snapshot: RunSnapshot) {
  const primary = snapshot.runEntities.find((entity) => entity.role === 'primary')
  return snapshot.scores.find((score) => score.entity_id === primary?.entity_id) ?? snapshot.scores[0]
}

function ChartCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-md border border-ink/10 bg-white p-4 shadow-panel">
      <div className="mb-3 flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </div>
      <div className="h-64">{children}</div>
    </section>
  )
}

function BarPlot({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e5df" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={compactNumber} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value) => fullNumber(Number(value))} />
        <Bar dataKey="value" fill="#3d8c95" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function PiePlot({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={86} paddingAngle={2}>
          {data.map((_, index) => <Cell key={index} fill={chartColors[index % chartColors.length]} />)}
        </Pie>
        <Tooltip formatter={(value) => fullNumber(Number(value))} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  )
}

function RadarPlot({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={data}>
        <PolarGrid />
        <PolarAngleAxis dataKey="name" tick={{ fontSize: 11 }} />
        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
        <Radar dataKey="value" fill="#5f7355" fillOpacity={0.35} stroke="#5f7355" />
        <Tooltip />
      </RadarChart>
    </ResponsiveContainer>
  )
}

function StackedBarPlot({ data }: { data: Array<{ name: string; fetched: number; reused: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e5df" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={compactNumber} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="fetched" stackId="a" fill="#3d8c95" />
        <Bar dataKey="reused" stackId="a" fill="#c59b43" />
      </BarChart>
    </ResponsiveContainer>
  )
}

function AreaPlot({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e5df" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={compactNumber} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Area type="monotone" dataKey="value" stroke="#c85f4a" fill="#c85f4a" fillOpacity={0.25} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function MatrixPlot({ data }: { data: Array<{ name: string; fetched: number; status: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e5df" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="status" fill="#c59b43" radius={[4, 4, 0, 0]} />
        <Line type="monotone" dataKey="fetched" stroke="#151719" />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function freshnessBuckets(sources: Source[]) {
  const buckets = [
    { name: '72h', value: 0 },
    { name: '30d', value: 0 },
    { name: '12m', value: 0 },
    { name: '5y+', value: 0 },
    { name: 'unknown', value: 0 },
  ]
  const now = Date.now()
  for (const source of sources) {
    if (!source.published_at) {
      buckets[4].value += 1
      continue
    }
    const ageDays = (now - new Date(source.published_at).getTime()) / 86400000
    if (ageDays <= 3) buckets[0].value += 1
    else if (ageDays <= 30) buckets[1].value += 1
    else if (ageDays <= 365) buckets[2].value += 1
    else buckets[3].value += 1
  }
  return buckets
}

function QuestionsPanel({ questions, answers, sourcesById, onSource }: { questions: RunSnapshot['questions']; answers: Answer[]; sourcesById: Map<string, Source>; onSource: (source: Source) => void }) {
  const answersByQuestion = new Map(answers.map((answer) => [answer.question_id, answer]))
  const supportedQuestions = questions.filter((question) => {
    const answer = answersByQuestion.get(question.id)
    return !!answer?.cited_source_ids?.length
  })
  if (!supportedQuestions.length) {
    return null
  }
  return (
    <section className="rounded-md border border-ink/10 bg-white p-5 shadow-panel">
      <div className="mb-4 flex items-center gap-2 font-semibold">
        <Bot size={17} />
        Executive brief
      </div>
      <div className="grid gap-3">
        {supportedQuestions.map((question) => {
          const answer = answersByQuestion.get(question.id)
          return (
            <article key={question.id} className="rounded-md border border-ink/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold">{question.question_text}</h3>
                <span className={`rounded px-2 py-1 text-xs ${statusColor(answer?.confidence_label ?? question.status)}`}>{answer?.confidence_label ?? question.status}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-steel">{answer?.answer}</p>
              {answer?.cited_source_ids?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {answer.cited_source_ids.slice(0, 5).map((id) => {
                    const source = sourcesById.get(id)
                    if (!source) return null
                    return (
                      <button key={id} onClick={() => onSource(source)} className="rounded border border-ink/10 px-2 py-1 text-xs hover:border-cyan">
                        {source.platform}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function EvidencePanel({ sources, selectedSource, onSource }: { sources: Source[]; evidence: RunSnapshot['evidence']; selectedSource: Source | null; onSource: (source: Source) => void }) {
  const visible = sources.slice(0, 80)
  return (
    <section className="rounded-md border border-ink/10 bg-white p-4 shadow-panel">
      <div className="mb-3 flex items-center gap-2 font-semibold">
        <ExternalLink size={17} />
        Sources
      </div>
      {selectedSource && (
        <div className="mb-3 rounded-md border border-cyan/40 bg-cyan/10 p-3 text-sm">
          <div className="font-semibold">{selectedSource.title ?? selectedSource.canonical_url}</div>
          <div className="mt-1 text-xs text-steel">{selectedSource.platform} · {formatDate(selectedSource.published_at)}</div>
          <a className="mt-2 inline-flex items-center gap-1 text-xs text-cyan" href={selectedSource.canonical_url} target="_blank" rel="noreferrer">
            Open source <ExternalLink size={12} />
          </a>
        </div>
      )}
      <div className="max-h-[520px] space-y-2 overflow-auto pr-1">
        {visible.map((source) => (
          <button key={source.id} onClick={() => onSource(source)} className="w-full rounded-md border border-ink/10 p-3 text-left text-sm hover:border-cyan">
            <div className="line-clamp-2 font-medium">{source.title ?? source.canonical_url}</div>
            <div className="mt-1 flex items-center justify-between gap-2 text-xs text-steel">
              <span>{source.platform}</span>
              <span>{formatDate(source.published_at)}</span>
            </div>
          </button>
        ))}
        {visible.length === 0 && <div className="rounded-md border border-dashed border-ink/20 p-5 text-center text-sm text-steel">Sources will appear once collection starts.</div>}
      </div>
    </section>
  )
}

function ChatPanel({ question, setQuestion, ask, answer }: { question: string; setQuestion: (value: string) => void; ask: (event: FormEvent) => void; answer: any }) {
  return (
    <section className="rounded-md border border-ink/10 bg-white p-4 shadow-panel">
      <div className="mb-3 flex items-center gap-2 font-semibold">
        <Bot size={17} />
        Follow-up
      </div>
      <form onSubmit={ask} className="grid gap-3">
        <textarea className="min-h-24 rounded-md border border-ink/10 px-3 py-2 text-sm" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about price, reactions, competitors, risks..." />
        <button className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white">Ask Senti</button>
      </form>
      {answer && (
        <div className="mt-4 rounded-md bg-fog p-3 text-sm leading-6">
          {answer.answer}
          {answer.citations?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {answer.citations.map((source: Source) => (
                <a key={source.id} className="rounded border border-ink/10 bg-white px-2 py-1 text-xs" href={source.canonical_url} target="_blank" rel="noreferrer">
                  {source.platform}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

function SettingsPage() {
  const [cleanupMessage, setCleanupMessage] = useState('')
  const connectors = [
    ['Tavily', 'Primary source collector for public web evidence'],
    ['ScrapingBee Google', 'Runs Google-indexed social site searches and fetches page text snapshots'],
    ['ScrapingBee page fetch', 'Fetches page text snapshots for Tavily and Google-discovered URLs'],
    ['Bluesky', 'Direct public AppView search for Bluesky posts'],
    ['Senti cache', 'Reuses prior sources but marks them separately'],
    ['DeepSeek', 'Structured evidence analysis and cited synthesis'],
    ['Restricted social platforms', 'Represented through public indexed results and direct public APIs'],
  ]
  async function archivePrototypeRuns() {
    setCleanupMessage('')
    const { data, error } = await insforge.database.rpc('archive_prototype_runs')
    if (error) {
      setCleanupMessage(error.message ?? 'Unable to archive prototype runs.')
      return
    }
    setCleanupMessage(`${fullNumber(Number(data ?? 0))} prototype runs archived and excluded from evaluation.`)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
      <section className="rounded-md border border-ink/10 bg-white p-5 shadow-panel">
        <h1 className="text-2xl font-semibold">Connector status</h1>
        <p className="mt-1 text-sm text-steel">Senti labels source coverage by actual collection quality and refuses unsupported claims.</p>
        <div className="mt-5 grid gap-3">
          {connectors.map(([name, status]) => (
            <div key={name} className="flex items-center justify-between rounded-md border border-ink/10 p-4">
              <div className="font-medium">{name}</div>
              <div className="text-sm text-steel">{status}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-md border border-ink/10 bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle size={18} />
          Source policy
        </div>
        <p className="mt-3 text-sm leading-6 text-steel">
          This implementation uses public APIs and public/indexed sources. It does not include private login scraping, CAPTCHA bypassing, credential reuse, or rate-limit evasion.
        </p>
        <div className="mt-5 border-t border-ink/10 pt-5">
          <div className="font-semibold">Prototype data cleanup</div>
          <p className="mt-2 text-sm leading-6 text-steel">
            Archive old heuristic runs so they stay out of serious evaluation and rebuilt reports.
          </p>
          <button onClick={archivePrototypeRuns} className="mt-4 rounded-md bg-ink px-4 py-2 text-sm font-medium text-white">
            Archive prototype runs
          </button>
          {cleanupMessage && <div className="mt-3 rounded-md bg-fog p-3 text-sm text-steel">{cleanupMessage}</div>}
        </div>
      </section>
    </div>
  )
}

export default App
