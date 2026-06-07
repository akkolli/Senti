create extension if not exists vector;
create extension if not exists pgcrypto;

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  entity_type text not null default 'topic',
  category text,
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.research_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  aliases text[] not null default '{}',
  region text not null default 'Global',
  time_window text not null default 'recent_30d',
  depth text not null default 'standard',
  status text not null default 'queued',
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  target_candidates integer not null default 350,
  candidates_attempted integer not null default 0,
  candidates_collected integer not null default 0,
  candidates_unique integer not null default 0,
  candidates_relevant integer not null default 0,
  classified_count integer not null default 0,
  evidence_count integer not null default 0,
  citation_count integer not null default 0,
  trend_count integer not null default 0,
  comparison_count integer not null default 0,
  summary text,
  caveats text,
  readiness_label text not null default 'collecting',
  data_origin text not null default 'production',
  archived_at timestamptz,
  evaluation_excluded boolean not null default false,
  cleanup_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.run_entities (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  role text not null check (role in ('primary', 'comparison', 'suggested')),
  source text not null default 'system',
  rank integer not null default 0,
  created_at timestamptz not null default now(),
  unique (run_id, entity_id, role)
);

create table public.global_sources (
  id uuid primary key default gen_random_uuid(),
  canonical_url text not null,
  platform text not null,
  source_family text not null,
  external_id text,
  title text,
  author_handle text,
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_refreshed_at timestamptz,
  content_hash text,
  language text not null default 'en',
  collection_status text not null default 'full',
  permission_level text not null default 'public_indexed',
  engagement jsonb not null default '{}',
  metadata jsonb not null default '{}',
  unique (platform, external_id),
  unique (canonical_url, content_hash)
);

create table public.source_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.global_sources(id) on delete cascade,
  fetched_at timestamptz not null default now(),
  raw_excerpt text,
  normalized_text text,
  snapshot_url text,
  snapshot_key text,
  content_hash text,
  metadata jsonb not null default '{}'
);

create table public.source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.global_sources(id) on delete cascade,
  version_id uuid references public.source_versions(id) on delete set null,
  chunk_index integer not null default 0,
  chunk_text text not null,
  token_estimate integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.source_embeddings (
  id uuid primary key default gen_random_uuid(),
  chunk_id uuid not null references public.source_chunks(id) on delete cascade,
  embedding vector(1536),
  embedding_model text not null default 'openai/text-embedding-3-small',
  created_at timestamptz not null default now(),
  unique (chunk_id, embedding_model)
);

create table public.source_classifications (
  id uuid primary key default gen_random_uuid(),
  chunk_id uuid not null references public.source_chunks(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete set null,
  relevance_score numeric not null default 0,
  sentiment text not null default 'unclear',
  stance text not null default 'unclear',
  theme text,
  driver_type text,
  severity numeric not null default 0,
  confidence numeric not null default 0,
  model text not null default 'deepseek-v4-flash',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.entity_mentions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.global_sources(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  mention_text text not null,
  confidence numeric not null default 0.5,
  created_at timestamptz not null default now()
);

create table public.run_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  source_id uuid references public.global_sources(id) on delete cascade,
  query text not null,
  query_hash text not null,
  source_family text not null,
  connector text not null,
  candidate_status text not null default 'collected',
  relevance_score numeric not null default 0,
  cache_status text not null default 'fresh',
  window_label text not null default 'recent_30d',
  created_at timestamptz not null default now(),
  unique (run_id, source_id, query_hash)
);

create table public.run_evidence (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  source_id uuid not null references public.global_sources(id) on delete cascade,
  chunk_id uuid references public.source_chunks(id) on delete set null,
  entity_id uuid references public.entities(id) on delete set null,
  evidence_tier integer not null default 1,
  relevance_score numeric not null default 0,
  citation_grade boolean not null default false,
  window_label text not null default 'recent_30d',
  created_at timestamptz not null default now(),
  unique (run_id, source_id, chunk_id)
);

create table public.research_questions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  question_text text not null,
  question_type text not null default 'initial' check (question_type in ('initial', 'emergent', 'user', 'cached')),
  priority integer not null default 0,
  status text not null default 'queued',
  reason text,
  cited_source_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.question_answers (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  question_id uuid references public.research_questions(id) on delete cascade,
  answer text not null,
  stance text not null default 'unclear',
  sentiment text not null default 'unclear',
  confidence_label text not null default 'low',
  confidence_reason text not null default 'Insufficient source diversity.',
  cited_source_ids uuid[] not null default '{}',
  cited_chunk_ids uuid[] not null default '{}',
  model text not null default 'deepseek-v4-flash',
  created_at timestamptz not null default now()
);

create table public.opinion_scores (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  window_label text not null,
  score integer,
  score_label text not null default 'insufficient',
  confidence_label text not null default 'low',
  confidence_reason text not null default 'Insufficient evidence.',
  sentiment_balance integer not null default 0,
  momentum integer not null default 0,
  source_diversity integer not null default 0,
  complaint_risk_inverse integer not null default 0,
  advocacy_intent integer not null default 0,
  competitor_relative_position integer not null default 0,
  evidence_count integer not null default 0,
  source_origin_count integer not null default 0,
  component_json jsonb not null default '{}',
  cited_source_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (run_id, entity_id, window_label)
);

create table public.trends (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete set null,
  window_label text not null default 'recent_30d',
  label text not null,
  description text not null,
  direction text not null default 'unknown' check (direction in ('rising', 'falling', 'stable', 'mixed', 'unknown')),
  driver_type text not null default 'theme',
  confidence_label text not null default 'low',
  velocity numeric not null default 0,
  source_count integer not null default 0,
  cited_source_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.comparison_insights (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  primary_entity_id uuid not null references public.entities(id) on delete cascade,
  comparison_entity_id uuid not null references public.entities(id) on delete cascade,
  score_delta integer,
  strengths text[] not null default '{}',
  weaknesses text[] not null default '{}',
  summary text not null default '',
  cited_source_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (run_id, primary_entity_id, comparison_entity_id)
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  cited_source_ids uuid[] not null default '{}',
  model text,
  created_at timestamptz not null default now()
);

create table public.connector_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  connector_name text not null,
  source_family text not null,
  query text,
  status text not null default 'queued',
  fetched_count integer not null default 0,
  reused_count integer not null default 0,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  metadata jsonb not null default '{}'
);

create table public.run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.worker_jobs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.research_runs(id) on delete cascade,
  job_type text not null,
  source_family text,
  query_hash text,
  payload jsonb not null default '{}',
  status text not null default 'queued',
  attempts integer not null default 0,
  locked_at timestamptz,
  locked_by text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, job_type, source_family, query_hash)
);

create index idx_research_runs_user_created on public.research_runs(user_id, created_at desc);
create unique index idx_entities_unique_lower_name on public.entities(lower(canonical_name), entity_type);
create index idx_run_events_run_created on public.run_events(run_id, created_at);
create index idx_worker_jobs_status on public.worker_jobs(status, created_at);
create index idx_run_candidates_run on public.run_candidates(run_id, source_family, candidate_status);
create index idx_run_evidence_run on public.run_evidence(run_id, evidence_tier, citation_grade);
create index idx_sources_family_seen on public.global_sources(source_family, last_seen_at desc);
create index idx_sources_url_hash on public.global_sources(canonical_url, content_hash);
create unique index idx_source_chunks_unique_text on public.source_chunks(source_id, chunk_index, md5(chunk_text));
create index idx_source_classifications_chunk on public.source_classifications(chunk_id);
create index idx_source_embeddings_vector on public.source_embeddings using hnsw (embedding vector_cosine_ops);
create unique index idx_entity_mentions_unique_text on public.entity_mentions(source_id, entity_id, lower(mention_text));

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_entities_updated_at
before update on public.entities
for each row execute function public.touch_updated_at();

create trigger touch_research_runs_updated_at
before update on public.research_runs
for each row execute function public.touch_updated_at();

create trigger touch_worker_jobs_updated_at
before update on public.worker_jobs
for each row execute function public.touch_updated_at();

create or replace function public.match_source_chunks(
  query_embedding vector(1536),
  input_run_id uuid,
  match_count int default 12,
  match_threshold float default 0.72
) returns table (
  chunk_id uuid,
  source_id uuid,
  chunk_text text,
  canonical_url text,
  title text,
  platform text,
  source_family text,
  similarity float
)
language sql
stable
as $$
  select
    sc.id as chunk_id,
    gs.id as source_id,
    sc.chunk_text,
    gs.canonical_url,
    gs.title,
    gs.platform,
    gs.source_family,
    1 - (se.embedding <=> query_embedding) as similarity
  from public.run_evidence re
  join public.source_chunks sc on sc.id = re.chunk_id
  join public.source_embeddings se on se.chunk_id = sc.id
  join public.global_sources gs on gs.id = sc.source_id
  join public.research_runs rr on rr.id = re.run_id
  where re.run_id = input_run_id
    and rr.user_id = auth.uid()
    and 1 - (se.embedding <=> query_embedding) > match_threshold
  order by se.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.claim_worker_job(worker_name text)
returns setof public.worker_jobs
language plpgsql
as $$
begin
  return query
  with next_job as (
    select id
    from public.worker_jobs
    where status in ('queued', 'retrying')
    order by created_at
    limit 1
    for update skip locked
  )
  update public.worker_jobs w
  set status = 'running',
      locked_at = now(),
      locked_by = worker_name,
      attempts = attempts + 1,
      updated_at = now()
  from next_job
  where w.id = next_job.id
  returning w.*;
end;
$$;

alter table public.entities enable row level security;
alter table public.research_runs enable row level security;
alter table public.run_entities enable row level security;
alter table public.global_sources enable row level security;
alter table public.source_versions enable row level security;
alter table public.source_chunks enable row level security;
alter table public.source_embeddings enable row level security;
alter table public.source_classifications enable row level security;
alter table public.entity_mentions enable row level security;
alter table public.run_candidates enable row level security;
alter table public.run_evidence enable row level security;
alter table public.research_questions enable row level security;
alter table public.question_answers enable row level security;
alter table public.opinion_scores enable row level security;
alter table public.trends enable row level security;
alter table public.comparison_insights enable row level security;
alter table public.chat_messages enable row level security;
alter table public.connector_runs enable row level security;
alter table public.run_events enable row level security;
alter table public.worker_jobs enable row level security;

create policy "users can read global entities" on public.entities for select using (true);
create policy "users can create entities" on public.entities for insert with check (auth.uid() is not null);

create policy "users own runs" on public.research_runs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "users read run entities" on public.run_entities for select using (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
);
create policy "users write run entities" on public.run_entities for all using (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
) with check (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
);

create policy "authenticated users read global sources" on public.global_sources for select using (auth.uid() is not null);
create policy "authenticated users create global sources" on public.global_sources for insert with check (auth.uid() is not null);
create policy "authenticated users update global sources" on public.global_sources for update using (auth.uid() is not null);

create policy "authenticated users read source versions" on public.source_versions for select using (auth.uid() is not null);
create policy "authenticated users write source versions" on public.source_versions for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "authenticated users read source chunks" on public.source_chunks for select using (auth.uid() is not null);
create policy "authenticated users write source chunks" on public.source_chunks for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "authenticated users read source embeddings" on public.source_embeddings for select using (auth.uid() is not null);
create policy "authenticated users write source embeddings" on public.source_embeddings for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "authenticated users read classifications" on public.source_classifications for select using (auth.uid() is not null);
create policy "authenticated users write classifications" on public.source_classifications for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "authenticated users read entity mentions" on public.entity_mentions for select using (auth.uid() is not null);
create policy "authenticated users write entity mentions" on public.entity_mentions for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "users own run candidates" on public.run_candidates for all using (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
) with check (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
);

create policy "users own run evidence" on public.run_evidence for all using (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
) with check (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
);

create policy "users own questions" on public.research_questions for all using (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
) with check (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
);

create policy "users own answers" on public.question_answers for all using (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
) with check (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
);

create policy "users own scores" on public.opinion_scores for all using (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
) with check (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
);

create policy "users own trends" on public.trends for all using (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
) with check (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
);

create policy "users own comparisons" on public.comparison_insights for all using (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
) with check (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
);

create policy "users own chats" on public.chat_messages for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "users own connector runs" on public.connector_runs for all using (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
) with check (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
);

create policy "users own events" on public.run_events for all using (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
) with check (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
);

create policy "users own worker jobs" on public.worker_jobs for all using (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
) with check (
  exists (select 1 from public.research_runs rr where rr.id = run_id and rr.user_id = auth.uid())
);
