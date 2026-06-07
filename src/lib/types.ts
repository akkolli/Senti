export type RunStatus =
  | 'queued'
  | 'planning'
  | 'checking_cache'
  | 'collecting'
  | 'analyzing'
  | 'ready'
  | 'complete'
  | 'failed'
  | 'partial'

export type ResearchRun = {
  id: string
  topic: string
  aliases: string[]
  region: string
  time_window: string
  depth: string
  status: RunStatus
  progress_percent: number
  target_candidates: number
  candidates_attempted: number
  candidates_collected: number
  candidates_unique: number
  candidates_relevant: number
  classified_count: number
  evidence_count: number
  citation_count: number
  trend_count: number
  comparison_count: number
  summary: string | null
  caveats: string | null
  readiness_label: string
  data_origin: string
  archived_at: string | null
  evaluation_excluded: boolean
  cleanup_reason: string | null
  created_at: string
  updated_at: string
}

export type RunEvent = {
  id: string
  event_type: string
  message: string
  metadata: Record<string, unknown>
  created_at: string
}

export type ConnectorRun = {
  id: string
  connector_name: string
  source_family: string
  status: string
  fetched_count: number
  reused_count: number
  error_message: string | null
}

export type OpinionScore = {
  id: string
  entity_id: string
  window_label: string
  score: number | null
  score_label: string
  confidence_label: string
  confidence_reason: string
  sentiment_balance: number
  momentum: number
  source_diversity: number
  complaint_risk_inverse: number
  advocacy_intent: number
  competitor_relative_position: number
  evidence_count: number
  source_origin_count: number
  component_json: Record<string, unknown> & { positive?: number; negative?: number; neutral?: number; mixed?: number }
}

export type Trend = {
  id: string
  label: string
  description: string
  direction: string
  driver_type: string
  confidence_label: string
  velocity: number
  source_count: number
  cited_source_ids: string[]
}

export type Question = {
  id: string
  question_text: string
  question_type: string
  priority: number
  status: string
}

export type Answer = {
  id: string
  question_id: string
  answer: string
  confidence_label: string
  confidence_reason: string
  cited_source_ids: string[]
}

export type Source = {
  id: string
  canonical_url: string
  platform: string
  source_family: string
  title: string | null
  author_handle: string | null
  published_at: string | null
  collection_status: string
  metadata?: Record<string, unknown>
}

export type RunEntity = {
  id: string
  entity_id: string
  role: 'primary' | 'comparison' | 'suggested'
  rank: number
}

export type Entity = {
  id: string
  canonical_name: string
  entity_type: string
  category: string | null
}

export type ComparisonInsight = {
  id: string
  comparison_entity_id: string
  score_delta: number | null
  strengths: string[]
  weaknesses: string[]
  summary: string
  cited_source_ids: string[]
}

export type WorkerJob = {
  id: string
  job_type: string
  source_family: string
  status: string
  attempts: number
  error_message: string | null
}

export type RunCandidate = {
  id: string
  source_id: string
  query: string
  source_family: string
  connector: string
  candidate_status: string
  relevance_score: number
  cache_status: string
  window_label: string
}

export type SourceChunk = {
  id: string
  source_id: string
  chunk_text: string
  token_estimate: number
}

export type RunSnapshot = {
  run: ResearchRun
  events: RunEvent[]
  connectors: ConnectorRun[]
  questions: Question[]
  answers: Answer[]
  scores: OpinionScore[]
  trends: Trend[]
  runEntities: RunEntity[]
  entities: Entity[]
  jobs: WorkerJob[]
  evidence: Array<{ id: string; source_id: string; chunk_id?: string; relevance_score: number; citation_grade: boolean }>
  candidates: RunCandidate[]
  sources: Source[]
  chunks: SourceChunk[]
  comparisons: ComparisonInsight[]
  comparisonEntities: Entity[]
}
