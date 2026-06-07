import { createClient } from 'npm:@insforge/sdk';

const INSFORGE_BASE_URL = Deno.env.get('INSFORGE_BASE_URL') ?? 'https://ntu9e7yu.us-west.insforge.app';
const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY') ?? '';
const DEEPSEEK_MODEL = Deno.env.get('DEEPSEEK_MODEL') ?? 'deepseek-v4-flash';

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

function stripJsonFences(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function parseJsonObject(text: string): any {
  const cleaned = stripJsonFences(text);
  const candidates = [cleaned, extractBalancedJsonObject(cleaned)].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates.flatMap((value) => [value, value.replace(/,\s*([}\]])/g, '$1')])) {
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // Try the next candidate.
    }
  }
  throw new Error('Model did not return valid JSON.');
}

async function deepSeekCompletion(messages: Array<{ role: 'system' | 'user'; content: string }>, maxTokens = 1400) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is not configured for this function runtime.');
  }
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      temperature: 0.1,
      stream: false,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });
  if (!response.ok) {
    throw new Error(`DeepSeek ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned an empty response.');
  return String(content);
}

async function deepSeekJson(messages: Array<{ role: 'system' | 'user'; content: string }>, maxTokens = 1400) {
  const content = await deepSeekCompletion(messages, maxTokens);
  try {
    return parseJsonObject(content);
  } catch (error) {
    const repaired = await deepSeekCompletion([
      { role: 'system', content: 'Repair malformed JSON. Return only one valid JSON object. Preserve keys and values. Do not add commentary.' },
      { role: 'user', content: stripJsonFences(content).slice(0, 18000) },
    ], Math.max(1200, maxTokens));
    try {
      return parseJsonObject(repaired);
    } catch (_) {
      throw error;
    }
  }
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  const userToken = authHeader ? authHeader.replace('Bearer ', '') : null;
  const client = createClient({ baseUrl: INSFORGE_BASE_URL, edgeFunctionToken: userToken });
  const { data: userData, error: userError } = await client.auth.getCurrentUser();
  if (userError || !userData?.user?.id) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const runId = String(body.runId ?? '').trim();
  const question = String(body.question ?? '').trim();
  if (!runId || !question) return json({ error: 'runId and question are required' }, 400);

  const run = await client.database.from('research_runs').select('id, topic, summary, caveats').eq('id', runId).maybeSingle();
  if (run.error || !run.data?.id) return json({ error: 'Run not found' }, 404);

  await client.database.from('chat_messages').insert([{ run_id: runId, user_id: userData.user.id, role: 'user', content: question }]);

  const candidates = await client.database
    .from('run_candidates')
    .select('source_id, relevance_score')
    .eq('run_id', runId)
    .order('relevance_score', { ascending: false })
    .limit(160);
  const evidence = await client.database
    .from('run_evidence')
    .select('source_id, chunk_id, relevance_score')
    .eq('run_id', runId)
    .order('relevance_score', { ascending: false })
    .limit(160);

  const sourceIds = unique([
    ...(evidence.data ?? []).map((row: any) => row.source_id),
    ...(candidates.data ?? []).map((row: any) => row.source_id),
  ].filter(Boolean));
  const evidenceChunkIds = unique((evidence.data ?? []).map((row: any) => row.chunk_id).filter(Boolean));
  const chunks = evidenceChunkIds.length
    ? await client.database.from('source_chunks').select('id, source_id, chunk_text').in('id', evidenceChunkIds.slice(0, 160))
    : sourceIds.length
      ? await client.database.from('source_chunks').select('id, source_id, chunk_text').in('source_id', sourceIds.slice(0, 160)).limit(240)
      : { data: [] };
  const chunkIds = unique((chunks.data ?? []).map((row: any) => row.id).filter(Boolean));
  const sources = sourceIds.length
    ? await client.database.from('global_sources').select('id, canonical_url, title, platform, source_family, published_at').in('id', sourceIds.slice(0, 120))
    : { data: [] };
  const classifications = chunkIds.length
    ? await client.database.from('source_classifications').select('chunk_id, sentiment, stance, theme, confidence, metadata').in('chunk_id', chunkIds.slice(0, 120))
    : { data: [] };

  const sourceMap = new Map((sources.data ?? []).map((source: any) => [source.id, source]));
  const classificationMap = new Map((classifications.data ?? []).map((classification: any) => [classification.chunk_id, classification]));
  const evidencePack = (chunks.data ?? []).slice(0, 70).map((chunk: any, index: number) => {
    const source = sourceMap.get(chunk.source_id);
    const classification = classificationMap.get(chunk.id);
    return {
      n: index + 1,
      source_id: chunk.source_id,
      title: source?.title,
      url: source?.canonical_url,
      platform: source?.platform,
      source_family: source?.source_family,
      sentiment: classification?.sentiment,
      theme: classification?.theme,
      quote: classification?.metadata?.evidenceQuote,
      text: String(chunk.chunk_text ?? '').slice(0, 1400),
    };
  });

  if (evidencePack.length === 0) {
    const answer = 'I can answer once source text has been collected for this run.';
    await client.database.from('chat_messages').insert([{
      run_id: runId,
      user_id: userData.user.id,
      role: 'assistant',
      content: answer,
      cited_source_ids: [],
      model: DEEPSEEK_MODEL,
    }]);
    return json({ answer, citations: [], citedSourceIds: [] });
  }

  try {
    const result = await deepSeekJson([
      {
        role: 'system',
        content: [
          'You answer Senti follow-up questions from stored run evidence only.',
          'Use every supplied source excerpt, including news, forums, reviews, and social snippets.',
          'Do not refuse because the run is small. Answer as much as the supplied sources support.',
          'Cite source numbers for concrete claims.',
          'Return JSON: {"answer":"...","citation_numbers":[1,2],"confidence_label":"high|medium|low","uncertainty":"..."}',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          topic: run.data.topic,
          question,
          runSummary: run.data.summary,
          runCaveats: run.data.caveats,
          evidence: evidencePack,
        }),
      },
    ]);
    const citationNumbers = Array.isArray(result.citation_numbers) ? result.citation_numbers.map(Number) : [];
    const citedSourceIds = unique(citationNumbers.map((number) => evidencePack.find((item) => item.n === number)?.source_id).filter(Boolean) as string[]).slice(0, 8);
    const fallbackSourceIds = evidencePack.slice(0, 3).map((item) => item.source_id).filter(Boolean);
    const finalCitedSourceIds = citedSourceIds.length ? citedSourceIds : unique(fallbackSourceIds as string[]).slice(0, 3);
    const answer = result.answer
      ? String(result.answer)
      : evidencePack.slice(0, 4).map((item) => `${item.title ?? item.platform}: ${String(item.text ?? '').slice(0, 220)}`).join('\n\n');
    const citations = finalCitedSourceIds.map((id) => sourceMap.get(id)).filter(Boolean);

    await client.database.from('chat_messages').insert([{
      run_id: runId,
      user_id: userData.user.id,
      role: 'assistant',
      content: answer,
      cited_source_ids: finalCitedSourceIds,
      model: DEEPSEEK_MODEL,
    }]);

    return json({ answer, citations, citedSourceIds: finalCitedSourceIds, confidence: result.confidence_label, uncertainty: result.uncertainty });
  } catch (error) {
    const answer = evidencePack.slice(0, 5).map((item) => `${item.title ?? item.platform}: ${String(item.text ?? '').slice(0, 260)}`).join('\n\n') || `The answer model was unavailable: ${error instanceof Error ? error.message : String(error)}`;
    await client.database.from('chat_messages').insert([{
      run_id: runId,
      user_id: userData.user.id,
      role: 'assistant',
      content: answer,
      cited_source_ids: evidencePack.slice(0, 3).map((item) => item.source_id).filter(Boolean),
      model: DEEPSEEK_MODEL,
    }]);
    const citedSourceIds = evidencePack.slice(0, 3).map((item) => item.source_id).filter(Boolean);
    return json({ answer, citations: citedSourceIds.map((id) => sourceMap.get(id)).filter(Boolean), citedSourceIds });
  }
}
