import { createClient } from 'npm:@insforge/sdk';

const INSFORGE_BASE_URL = Deno.env.get('INSFORGE_BASE_URL') ?? 'https://ntu9e7yu.us-west.insforge.app';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function queryByIds(client: any, table: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = [];
  for (let i = 0; i < ids.length; i += 100) {
    const result = await client.database.from(table).select('*').in('id', ids.slice(i, i + 100));
    rows.push(...(result.data ?? []));
  }
  return rows;
}

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  const userToken = authHeader ? authHeader.replace('Bearer ', '') : null;
  const client = createClient({ baseUrl: INSFORGE_BASE_URL, edgeFunctionToken: userToken });
  const { data: userData, error: userError } = await client.auth.getCurrentUser();
  if (userError || !userData?.user?.id) return json({ error: 'Unauthorized' }, 401);

  const url = new URL(req.url);
  let runId = url.searchParams.get('runId') ?? '';
  if (!runId && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    runId = String(body.runId ?? '');
  }
  if (!runId) return json({ error: 'runId is required' }, 400);

  const [run, events, connectors, questions, answers, scores, trends, entities, jobs, evidence, candidates, comparisons] = await Promise.all([
    client.database.from('research_runs').select('*').eq('id', runId).maybeSingle(),
    client.database.from('run_events').select('*').eq('run_id', runId).order('created_at', { ascending: true }).limit(100),
    client.database.from('connector_runs').select('*').eq('run_id', runId).order('created_at', { ascending: true }).limit(100),
    client.database.from('research_questions').select('*').eq('run_id', runId).order('priority', { ascending: true }).limit(50),
    client.database.from('question_answers').select('*').eq('run_id', runId).order('created_at', { ascending: true }).limit(50),
    client.database.from('opinion_scores').select('*').eq('run_id', runId).order('created_at', { ascending: false }).limit(20),
    client.database.from('trends').select('*').eq('run_id', runId).order('velocity', { ascending: false }).limit(20),
    client.database.from('run_entities').select('*').eq('run_id', runId).order('rank', { ascending: true }).limit(20),
    client.database.from('worker_jobs').select('id, job_type, source_family, status, attempts, error_message, created_at, updated_at').eq('run_id', runId).order('created_at', { ascending: true }).limit(1000),
    client.database.from('run_evidence').select('id, source_id, chunk_id, relevance_score, citation_grade, evidence_tier, created_at').eq('run_id', runId).order('relevance_score', { ascending: false }).limit(1000),
    client.database.from('run_candidates').select('id, source_id, query, source_family, connector, candidate_status, relevance_score, cache_status, window_label, created_at').eq('run_id', runId).order('relevance_score', { ascending: false }).limit(1000),
    client.database.from('comparison_insights').select('*').eq('run_id', runId).order('created_at', { ascending: true }).limit(20),
  ]);

  if (run.error || !run.data) return json({ error: 'Run not found' }, 404);

  const entityRows = await queryByIds(client, 'entities', Array.from(new Set((entities.data ?? []).map((row: any) => row.entity_id))));
  const sourceIds = Array.from(new Set([
    ...(evidence.data ?? []).map((row: any) => row.source_id),
    ...(candidates.data ?? []).map((row: any) => row.source_id),
  ].filter(Boolean)));
  const sourceRows = await queryByIds(client, 'global_sources', sourceIds);
  const comparisonEntityRows = await queryByIds(client, 'entities', Array.from(new Set((comparisons.data ?? []).map((row: any) => row.comparison_entity_id).filter(Boolean))));
  const chunkRows = [];
  for (let i = 0; i < sourceIds.length; i += 100) {
    const result = await client.database
      .from('source_chunks')
      .select('id, source_id, chunk_text, token_estimate')
      .in('source_id', sourceIds.slice(i, i + 100))
      .limit(1200);
    chunkRows.push(...(result.data ?? []));
  }
  const chunkIds = Array.from(new Set([
    ...(evidence.data ?? []).map((row: any) => row.chunk_id),
    ...chunkRows.map((row: any) => row.id),
  ].filter(Boolean))).slice(0, 1000);
  const classificationRows = chunkIds.length
    ? await client.database
      .from('source_classifications')
      .select('chunk_id, relevance_score, sentiment, stance, theme, confidence, model, metadata')
      .in('chunk_id', chunkIds)
    : { data: [] };

  return json({
    run: run.data,
    events: events.data ?? [],
    connectors: connectors.data ?? [],
    questions: questions.data ?? [],
    answers: answers.data ?? [],
    scores: scores.data ?? [],
    trends: trends.data ?? [],
    runEntities: entities.data ?? [],
    entities: entityRows,
    jobs: jobs.data ?? [],
    evidence: evidence.data ?? [],
    candidates: candidates.data ?? [],
    sources: sourceRows,
    chunks: chunkRows.slice(0, 1000),
    classifications: classificationRows.data ?? [],
    comparisons: comparisons.data ?? [],
    comparisonEntities: comparisonEntityRows,
  });
}
