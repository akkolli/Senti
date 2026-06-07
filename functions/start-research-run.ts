import { createClient } from 'npm:@insforge/sdk';

const INSFORGE_BASE_URL = Deno.env.get('INSFORGE_BASE_URL') ?? 'https://ntu9e7yu.us-west.insforge.app';
const TAVILY_API_KEY = Deno.env.get('TAVILY_API_KEY') ?? '';
const SCRAPINGBEE_API_KEY = Deno.env.get('SCRAPINGBEE_API_KEY') ?? '';
const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY') ?? '';
const DEEPSEEK_MODEL = Deno.env.get('DEEPSEEK_MODEL') ?? 'deepseek-v4-flash';
const DISCOVERY_PROMPT_VERSION = 'senti-entity-discovery-v1.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const baselineQuestions = [
  'What does the public currently think?',
  'What are the strongest positive drivers?',
  'What are the strongest negative drivers and pain points?',
  'What blocks adoption, purchase, renewal, or advocacy?',
  'Where do named competitors win or lose?',
  'What pricing or value objections appear?',
  'What support, documentation, or product gaps appear?',
  'What should a product or business leader do next?',
  'How confident should the user be, and why?',
  'Which collected signals deserve follow-up?',
];

const googleIndexedSocialDomains = [
  'reddit.com',
  'youtube.com',
  'news.ycombinator.com',
  'producthunt.com',
  'x.com',
  'twitter.com',
  'threads.net',
  'tiktok.com',
  'instagram.com',
  'facebook.com',
  'linkedin.com',
];

const socialIntentPhrases = [
  { phrase: 'review user review owner review customer review reviews complaints praise alternatives worth it', intent: 'user/owner reviews, complaints, praise, and alternatives' },
  { phrase: 'hands on review owner review long term review customer reviews', intent: 'first-hand and long-term reviews' },
  { phrase: 'problems frustrations disappointed regret', intent: 'complaints and frustrations' },
  { phrase: 'love recommend best switched from', intent: 'positive drivers and switching stories' },
  { phrase: 'expensive price value worth it', intent: 'pricing and value perception' },
  { phrase: 'support bugs reliability documentation', intent: 'support, bug, and reliability issues' },
];

const priorityReviewDomains = [
  'reddit.com',
  'youtube.com',
  'tiktok.com',
];

type DiscoverySource = {
  collector: string;
  query: string;
  title: string;
  url: string;
  snippet: string;
};

type EntityDiscovery = {
  aliases: string[];
  competitors: string[];
  sources: DiscoverySource[];
  errors: string[];
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function cleanText(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function describeError(error: unknown): string {
  if (!error) return '';
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return String(record.message ?? record.error ?? record.details ?? JSON.stringify(error));
  }
  return String(error);
}

function parseJsonObject(text: string): any {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Model did not return valid JSON.');
  }
}

async function deepSeekJson(messages: Array<{ role: 'system' | 'user'; content: string }>, maxTokens = 1800) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is not configured.');
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
  return parseJsonObject(content);
}

function timeRangeFor(windowLabel: string | undefined): string | undefined {
  if (windowLabel === 'now_72h') return 'week';
  if (windowLabel === 'recent_30d') return 'month';
  if (windowLabel === 'historic_12m') return 'year';
  return undefined;
}

function googleDateRangeFor(windowLabel: string | undefined): string | undefined {
  if (windowLabel === 'now_72h') return 'past_week';
  if (windowLabel === 'recent_30d') return 'past_month';
  if (windowLabel === 'historic_12m') return 'past_year';
  return undefined;
}

function countryForRegion(region: string | undefined): string | undefined {
  if (!region) return undefined;
  const normalized = region.toLowerCase().trim();
  const countries: Record<string, string> = {
    us: 'united states',
    usa: 'united states',
    'u.s.': 'united states',
    'united states': 'united states',
    uk: 'united kingdom',
    'u.k.': 'united kingdom',
    'united kingdom': 'united kingdom',
    canada: 'canada',
    australia: 'australia',
    germany: 'germany',
    france: 'france',
    india: 'india',
    japan: 'japan',
    singapore: 'singapore',
    brazil: 'brazil',
    mexico: 'mexico',
  };
  return countries[normalized];
}

function googleCountryCodeForRegion(region: string | undefined): string | undefined {
  if (!region) return undefined;
  const normalized = region.toLowerCase().trim();
  const countries: Record<string, string> = {
    us: 'us',
    usa: 'us',
    'u.s.': 'us',
    'united states': 'us',
    uk: 'gb',
    'u.k.': 'gb',
    'united kingdom': 'gb',
    canada: 'ca',
    australia: 'au',
    germany: 'de',
    france: 'fr',
    india: 'in',
    japan: 'jp',
    singapore: 'sg',
    brazil: 'br',
    mexico: 'mx',
  };
  return countries[normalized];
}

function uniqueNames(items: string[], blocked: string[] = [], limit = 8): string[] {
  const seen = new Set(blocked.map((item) => item.toLowerCase().trim()).filter(Boolean));
  const generic = new Set(['competitors', 'alternatives', 'reviews', 'pricing', 'support', 'reddit', 'youtube', 'google']);
  const out: string[] = [];
  for (const item of items) {
    const cleaned = cleanText(item).replace(/^[\s"'`.,;:()[\]-]+|[\s"'`.,;:()[\]-]+$/g, '');
    const key = cleaned.toLowerCase();
    if (!cleaned || cleaned.length < 2 || cleaned.length > 80 || generic.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= limit) break;
  }
  return out;
}

function modelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return String((item as Record<string, unknown>).name ?? '');
      return '';
    })
    .filter(Boolean);
}

function slugHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(i) | 0;
  }
  return Math.abs(hash).toString(36);
}

async function tavilyDiscoverySearch(query: string, region: string, timeWindow: string): Promise<DiscoverySource[]> {
  if (!TAVILY_API_KEY) return [];
  const body: Record<string, unknown> = {
    query,
    search_depth: 'basic',
    max_results: 5,
    include_answer: false,
    include_raw_content: false,
    topic: 'general',
  };
  const range = timeRangeFor(timeWindow);
  if (range) body.time_range = range;
  const country = countryForRegion(region);
  if (country) body.country = country;

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TAVILY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Tavily discovery ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map((result: any) => ({
    collector: 'Tavily',
    query,
    title: cleanText(String(result.title ?? '')),
    url: String(result.url ?? ''),
    snippet: cleanText(String(result.content ?? '')).slice(0, 700),
  })).filter((source: DiscoverySource) => source.url && (source.title || source.snippet));
}

async function scrapingBeeGoogleDiscoverySearch(query: string, region: string, timeWindow: string): Promise<DiscoverySource[]> {
  if (!SCRAPINGBEE_API_KEY) return [];
  const params = new URLSearchParams({
    api_key: SCRAPINGBEE_API_KEY,
    search: query,
    search_type: 'classic',
    language: 'en',
    light_request: 'true',
    page: '1',
  });
  const dateRange = googleDateRangeFor(timeWindow);
  if (dateRange) params.set('date_range', dateRange);
  const countryCode = googleCountryCodeForRegion(region);
  if (countryCode) params.set('country_code', countryCode);

  const response = await fetch(`https://app.scrapingbee.com/api/v1/store/google?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`ScrapingBee Google discovery ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  const results = Array.isArray(data.organic_results) ? data.organic_results : [];
  return results.slice(0, 8).map((result: any) => ({
    collector: 'ScrapingBee Google',
    query,
    title: cleanText(String(result.title ?? '')),
    url: String(result.url ?? ''),
    snippet: cleanText(String(result.description ?? '')).slice(0, 700),
  })).filter((source: DiscoverySource) => source.url && (source.title || source.snippet));
}

async function collectDiscoverySources(topic: string, region: string, timeWindow: string): Promise<{ sources: DiscoverySource[]; errors: string[] }> {
  const errors: string[] = [];
  const sources: DiscoverySource[] = [];
  const tavilyQueries = [
    `${topic} official name aliases acronym`,
    `${topic} competitors alternatives reviews`,
    `${topic} vs competitors switching reasons`,
  ];
  const googleQueries = [
    `site:reddit.com "${topic}" review user review owner review alternatives competitors`,
    `site:producthunt.com "${topic}" review user review alternatives competitors`,
    `site:g2.com "${topic}" customer review reviews competitors alternatives`,
  ];

  for (const query of tavilyQueries) {
    try {
      sources.push(...await tavilyDiscoverySearch(query, region, timeWindow));
    } catch (error) {
      errors.push(describeError(error).slice(0, 220));
    }
  }
  for (const query of googleQueries) {
    try {
      sources.push(...await scrapingBeeGoogleDiscoverySearch(query, region, timeWindow));
    } catch (error) {
      errors.push(describeError(error).slice(0, 220));
    }
  }

  const seen = new Set<string>();
  return {
    sources: sources.filter((source) => {
      const key = source.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 28),
    errors: Array.from(new Set(errors)).slice(0, 6),
  };
}

async function discoverAliasesAndCompetitors(topic: string, region: string, timeWindow: string): Promise<EntityDiscovery> {
  const { sources, errors } = await collectDiscoverySources(topic, region, timeWindow);
  if (!sources.length) {
    return { aliases: [], competitors: [], sources, errors: [...errors, 'No discovery sources were available.'] };
  }
  if (!DEEPSEEK_API_KEY) {
    return { aliases: [], competitors: [], sources, errors: [...errors, 'DEEPSEEK_API_KEY is not configured for entity discovery.'] };
  }

  try {
    const result = await deepSeekJson([
      {
        role: 'system',
        content: [
          'You are Senti entity discovery.',
          'Use only the supplied research snippets.',
          'Identify aliases and direct competitors or substitutes for public-opinion research.',
          'Do not invent names from general knowledge. If evidence is weak, return fewer items.',
          'Return strict JSON: {"aliases":[{"name":"...","confidence":0-1,"source_urls":["..."]}],"competitors":[{"name":"...","confidence":0-1,"source_urls":["..."]}]}',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          promptVersion: DISCOVERY_PROMPT_VERSION,
          topic,
          region,
          timeWindow,
          sources: sources.map((source, index) => ({
            n: index + 1,
            collector: source.collector,
            query: source.query,
            title: source.title,
            url: source.url,
            snippet: source.snippet,
          })),
        }),
      },
    ], 1800);

    const aliases = uniqueNames(modelNames(result.aliases), [topic], 8);
    const competitors = uniqueNames(modelNames(result.competitors), [topic, ...aliases], 8);
    return { aliases, competitors, sources, errors };
  } catch (error) {
    return { aliases: [], competitors: [], sources, errors: [...errors, describeError(error).slice(0, 220)] };
  }
}

function normalizedRunSize(depth: string): string {
  const normalized = depth.toLowerCase().trim();
  if (normalized === 'quick') return 'mini';
  if (normalized === 'deep') return 'large';
  if (['mini', 'standard', 'large', 'giant'].includes(normalized)) return normalized;
  return 'standard';
}

function targetForDepth(depth: string): number {
  const size = normalizedRunSize(depth);
  if (size === 'mini') return 10;
  if (size === 'large') return 1000;
  if (size === 'giant') return 10000;
  return 100;
}

function searchCountForDepth(depth: string): number | null {
  const size = normalizedRunSize(depth);
  if (size === 'mini') return 6;
  if (size === 'large') return 120;
  if (size === 'giant') return 600;
  return 24;
}

function resultBoundsForDepth(depth: string): { min: number; max: number } {
  const size = normalizedRunSize(depth);
  if (size === 'mini') return { min: 2, max: 4 };
  if (size === 'giant') return { min: 8, max: 20 };
  if (size === 'large') return { min: 6, max: 14 };
  return { min: 4, max: 8 };
}

function timeWindowPhrase(timeWindow: string): string {
  if (timeWindow === 'now_72h') return 'past 72 hours';
  if (timeWindow === 'historic_12m') return 'past year';
  if (timeWindow === 'historic_5y') return 'past five years';
  return 'past 30 days';
}

function buildQueryPlan(input: {
  topic: string;
  aliases: string[];
  competitors: string[];
  region: string;
  timeWindow: string;
}) {
  const { topic, aliases, competitors, region, timeWindow } = input;
  const regionEnabled = region.toLowerCase() !== 'global';
  const regionPrefix = regionEnabled ? `${region} ` : '';
  const windowPhrase = timeWindowPhrase(timeWindow);
  const subjectNames = Array.from(new Set([topic, ...aliases])).filter(Boolean).slice(0, 6);
  const baseSubjects = subjectNames.length ? subjectNames : [topic];
  const specs: Array<{ type: string; query: string; intent: string; region?: string; timeWindow: string }> = [];

  const add = (type: string, query: string, intent: string) => {
    const cleaned = query.replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    specs.push({
      type,
      query: cleaned,
      intent,
      region: regionEnabled ? region : undefined,
      timeWindow,
    });
  };

  for (const subject of baseSubjects) {
    add('product_image', `${regionPrefix}${subject} official product image photo exterior launch ${windowPhrase}`, 'product image and launch visuals');
    add('broad_public_opinion', `${regionPrefix}${subject} public opinion review user reviews discussion ${windowPhrase}`, 'broad public opinion');
    for (const domain of priorityReviewDomains) {
      add('google_social_index', `site:${domain} "${subject}" review user review owner review customer reviews complaints praise worth it ${windowPhrase}`, `Google-indexed user review evidence from ${domain}`);
    }
    add('complaints', `${regionPrefix}${subject} review complaints problems frustrations reddit forum ${windowPhrase}`, 'complaints and pain points');
    add('praise_positive_reviews', `${regionPrefix}${subject} review praise positive reviews love recommend ${windowPhrase}`, 'praise and positive drivers');
    add('pricing_value', `${regionPrefix}${subject} price expensive worth it value pricing objections ${windowPhrase}`, 'pricing and value perception');
    add('alternatives', `${regionPrefix}${subject} alternatives competitors switch from switch to comparison ${windowPhrase}`, 'alternatives and switching reasons');
    add('adoption_blockers', `${regionPrefix}${subject} adoption blockers why not buy renew churn objections ${windowPhrase}`, 'adoption blockers and buyer objections');
    add('support_issues', `${regionPrefix}${subject} support issues documentation bugs reliability complaints ${windowPhrase}`, 'support and product gaps');
    add('bluesky_direct', `${subject} review user review owner review reviews complaints praise alternatives worth it`, 'direct Bluesky public posts');
    for (const domain of googleIndexedSocialDomains) {
      add('google_social_index', `site:${domain} "${subject}" review user review owner review customer reviews complaints praise alternatives worth it ${windowPhrase}`, `Google-indexed social evidence from ${domain}`);
    }
  }

  for (const competitor of competitors.slice(0, 8)) {
    add('competitor_comparisons', `${regionPrefix}${topic} vs ${competitor} review reviews complaints switching reasons ${windowPhrase}`, 'competitor comparison');
    add('competitor_comparisons', `${regionPrefix}${competitor} alternative to ${topic} review why switch ${windowPhrase}`, 'competitor win/loss evidence');
    add('bluesky_direct', `${topic} ${competitor} review comparison switching complaints praise`, 'direct Bluesky competitor evidence');
    for (const domain of googleIndexedSocialDomains.slice(0, 6)) {
      add('google_social_index', `site:${domain} "${topic}" "${competitor}" review user review comparison switching ${windowPhrase}`, `Google-indexed competitor evidence from ${domain}`);
    }
  }

  if (regionEnabled) {
    add('region_specific', `${topic} ${region} customers review user reviews complaints praise ${windowPhrase}`, 'region-specific public opinion');
  }

  return specs;
}

function expandQueryPlan(input: {
  basePlan: Array<{ type: string; query: string; intent: string; region?: string; timeWindow: string }>;
  topic: string;
  aliases: string[];
  competitors: string[];
  region: string;
  timeWindow: string;
  desiredCount: number | null;
}) {
  const { basePlan, topic, aliases, competitors, region, timeWindow, desiredCount } = input;
  if (!desiredCount || basePlan.length >= desiredCount) return basePlan.slice(0, desiredCount ?? basePlan.length);

  const regionEnabled = region.toLowerCase() !== 'global';
  const regionPrefix = regionEnabled ? `${region} ` : '';
  const windowPhrase = timeWindowPhrase(timeWindow);
  const subjects = Array.from(new Set([topic, ...aliases])).filter(Boolean).slice(0, 8);
  const plan = [...basePlan];
  const seen = new Set(plan.map((item) => item.query.toLowerCase()));

  const add = (type: string, query: string, intent: string) => {
    if (plan.length >= desiredCount) return;
    const cleaned = query.replace(/\s+/g, ' ').trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    plan.push({ type, query: cleaned, intent, region: regionEnabled ? region : undefined, timeWindow });
  };

  const contexts = [
    'review',
    'customer review',
    'user review',
    'owner review',
    'long term review',
    'reddit',
    'forum',
    'customer reviews',
    'user reviews',
    'community discussion',
    'youtube comments',
    'hacker news',
    'product hunt',
    'twitter x',
    'trustpilot',
    'g2',
    'support forum',
    'support complaints',
    'pricing discussion',
    'switching stories',
    'buyer objections',
    'return reason',
    'renewal churn',
  ];

  for (const subject of subjects) {
    for (const domain of googleIndexedSocialDomains) {
      for (const socialIntent of socialIntentPhrases) {
        add('google_social_index', `site:${domain} "${subject}" ${socialIntent.phrase} ${windowPhrase}`, `Google-indexed social evidence from ${domain}: ${socialIntent.intent}`);
        if (plan.length >= desiredCount) break;
      }
      if (plan.length >= desiredCount) break;
    }
    if (plan.length >= desiredCount) break;
  }

  for (const subject of subjects) {
    for (const socialIntent of socialIntentPhrases.slice(1)) {
      add('bluesky_direct', `${subject} ${socialIntent.phrase}`, `direct Bluesky evidence: ${socialIntent.intent}`);
      if (plan.length >= desiredCount) break;
    }
    if (plan.length >= desiredCount) break;
  }

  for (const subject of subjects) {
    for (const context of contexts) {
      add('product_image', `${regionPrefix}${subject} official product image photo exterior launch ${context} ${windowPhrase}`, 'product image and launch visuals');
      add('broad_public_opinion', `${regionPrefix}${subject} ${context} public opinion ${windowPhrase}`, 'broad public opinion');
      add('complaints', `${regionPrefix}${subject} ${context} complaints problems frustrations ${windowPhrase}`, 'complaints and pain points');
      add('praise_positive_reviews', `${regionPrefix}${subject} ${context} praise recommend love ${windowPhrase}`, 'praise and positive drivers');
      add('pricing_value', `${regionPrefix}${subject} ${context} price expensive worth it value ${windowPhrase}`, 'pricing and value perception');
      add('adoption_blockers', `${regionPrefix}${subject} ${context} why not buy adoption blocker objection ${windowPhrase}`, 'adoption blockers and buyer objections');
      add('support_issues', `${regionPrefix}${subject} ${context} support issues bugs documentation reliability ${windowPhrase}`, 'support and product gaps');
      if (plan.length >= desiredCount) break;
    }
    if (plan.length >= desiredCount) break;
  }

  for (const competitor of competitors.slice(0, 8)) {
    for (const context of contexts.slice(0, 12)) {
      add('competitor_comparisons', `${regionPrefix}${topic} vs ${competitor} ${context} switching reasons ${windowPhrase}`, 'competitor comparison');
      add('competitor_comparisons', `${regionPrefix}${competitor} alternative to ${topic} ${context} win lose ${windowPhrase}`, 'competitor win/loss evidence');
      if (plan.length >= desiredCount) break;
    }
    if (plan.length >= desiredCount) break;
  }

  return plan.slice(0, desiredCount);
}

function sourceFamilyForQueryType(type: string): string {
  return ['google_social_index', 'bluesky_direct'].includes(type) ? 'social' : 'web';
}

function collectorKeyForQueryType(type: string): string {
  if (type === 'google_social_index') return 'scrapingbee_google';
  if (type === 'bluesky_direct') return 'bluesky';
  return 'tavily';
}

function collectionBatchSize(type: string, depth: string): number {
  const size = normalizedRunSize(depth);
  if (type === 'google_social_index') {
    if (size === 'giant') return 10;
    if (size === 'large') return 8;
    if (size === 'mini') return 3;
    return 5;
  }
  if (type === 'bluesky_direct') return size === 'mini' ? 2 : size === 'standard' ? 3 : 5;
  if (size === 'giant') return 6;
  if (size === 'large') return 5;
  if (size === 'mini') return 2;
  return 3;
}

function buildCollectionGroups(plan: Array<{ type: string; query: string; intent: string; region?: string; timeWindow: string }>, depth: string) {
  const groups: Array<Array<{ type: string; query: string; intent: string; region?: string; timeWindow: string }>> = [];
  let current: Array<{ type: string; query: string; intent: string; region?: string; timeWindow: string }> = [];
  let currentKey = '';
  let currentLimit = 1;

  for (const spec of plan) {
    const key = collectorKeyForQueryType(spec.type);
    const limit = collectionBatchSize(spec.type, depth);
    if (current.length && (key !== currentKey || current.length >= currentLimit)) {
      groups.push(current);
      current = [];
    }
    currentKey = key;
    currentLimit = limit;
    current.push(spec);
  }
  if (current.length) groups.push(current);
  return groups;
}

async function ensureEntity(client: any, name: string, type = 'topic', aliases: string[] = []) {
  const existing = await client.database
    .from('entities')
    .select('id, canonical_name')
    .ilike('canonical_name', name)
    .eq('entity_type', type)
    .limit(1)
    .maybeSingle();

  if (existing.data?.id) {
    return existing.data;
  }

  const inserted = await client.database
    .from('entities')
    .insert([{ canonical_name: name, entity_type: type, aliases }])
    .select('id, canonical_name')
    .maybeSingle();

  if (!inserted.error && inserted.data?.id) {
    return inserted.data;
  }

  const retried = await client.database
    .from('entities')
    .select('id, canonical_name')
    .ilike('canonical_name', name)
    .eq('entity_type', type)
    .limit(1)
    .maybeSingle();

  if (retried.data?.id) {
    return retried.data;
  }

  throw inserted.error ?? new Error(`Unable to create entity ${name}`);
}

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  const userToken = authHeader ? authHeader.replace('Bearer ', '') : null;
  const client = createClient({ baseUrl: INSFORGE_BASE_URL, edgeFunctionToken: userToken });
  const { data: userData, error: userError } = await client.auth.getCurrentUser();

  if (userError || !userData?.user?.id) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const topic = String(body.topic ?? '').trim();
  if (!topic) {
    return json({ error: 'A topic is required.' }, 400);
  }

  const requestedAliases = normalizeList(body.aliases);
  const requestedComparisonInput = normalizeList(body.comparisonEntities ?? body.competitors);
  const region = String(body.region ?? 'Global').trim() || 'Global';
  const timeWindow = String(body.timeWindow ?? 'recent_30d');
  const depth = normalizedRunSize(String(body.depth ?? 'standard'));
  const targetCandidates = targetForDepth(depth);
  const discovery = await discoverAliasesAndCompetitors(topic, region, timeWindow);
  const aliases = uniqueNames([...requestedAliases, ...discovery.aliases], [topic], 8);
  const comparisons = uniqueNames([...requestedComparisonInput, ...discovery.competitors], [topic, ...aliases], 8);
  const discoveryCaveat = discovery.errors.length
    ? 'Entity discovery was source-limited; Senti used the topic plus any model-supported aliases or competitors it could verify.'
    : `Senti generated ${aliases.length.toLocaleString()} aliases and ${comparisons.length.toLocaleString()} comparison entities from public research before planning collection.`;

  const primary = await ensureEntity(client, topic, 'topic', aliases);
  const queryPlan = expandQueryPlan({
    basePlan: buildQueryPlan({ topic, aliases, competitors: comparisons, region, timeWindow }),
    topic,
    aliases,
    competitors: comparisons,
    region,
    timeWindow,
    desiredCount: searchCountForDepth(depth),
  });

  const runInsert = await client.database
    .from('research_runs')
    .insert([{
      user_id: userData.user.id,
      topic,
      aliases,
      region,
      time_window: timeWindow,
      depth,
      target_candidates: targetCandidates,
      status: 'planning',
      progress_percent: 3,
      readiness_label: 'collecting',
      caveats: [
        region.toLowerCase() === 'global'
          ? 'Senti measures public web opinion signals, not statistically representative survey results.'
          : `Region is enabled for ${region}; Senti will bias query planning toward that region and interpret the collected evidence in that scope.`,
        discoveryCaveat,
      ].join(' '),
    }])
    .select('id, topic, status')
    .maybeSingle();

  if (runInsert.error || !runInsert.data?.id) {
    return json({ error: runInsert.error?.message ?? 'Failed to create run' }, 500);
  }

  const runId = runInsert.data.id;
  const comparisonEntities = [];
  for (const name of comparisons) {
    comparisonEntities.push(await ensureEntity(client, name, 'topic', []));
  }

  await client.database.from('run_entities').insert([
    { run_id: runId, entity_id: primary.id, role: 'primary', source: 'user', rank: 0 },
    ...comparisonEntities.map((entity: any, index: number) => ({
      run_id: runId,
      entity_id: entity.id,
      role: 'comparison',
      source: requestedComparisonInput.includes(entity.canonical_name) ? 'user' : 'entity-discovery',
      rank: index + 1,
    })),
  ]);

  await client.database.from('research_questions').insert(
    baselineQuestions.map((question, index) => ({
      run_id: runId,
      question_text: question,
      question_type: 'initial',
      priority: index + 1,
      status: 'queued',
    })),
  );

  const resultBounds = resultBoundsForDepth(depth);
  const maxResultsPerQuery = Math.max(resultBounds.min, Math.min(resultBounds.max, Math.ceil(targetCandidates / Math.max(1, queryPlan.length))));
  const queryGroups = buildCollectionGroups(queryPlan, depth);
  const jobs = [
    { job_type: 'collect-cache', source_family: 'cache', query_hash: slugHash(`${runId}:cache`), payload: { queryPlan, targetCandidates } },
    ...queryGroups.map((group, index) => ({
      job_type: 'collect-tavily',
      source_family: group.some((spec) => sourceFamilyForQueryType(spec.type) === 'social') ? 'social' : 'web',
      query_hash: slugHash(`${runId}:tavily:${index}`),
      payload: { queryPlan: group, targetCandidates, maxResultsPerQuery, region, timeWindow, batchIndex: index, batchCount: queryGroups.length },
    })),
    { job_type: 'analyze', source_family: 'analysis', query_hash: slugHash(`${runId}:analyze`), payload: { topic, comparisons, region, timeWindow } },
    { job_type: 'synthesize', source_family: 'analysis', query_hash: slugHash(`${runId}:synthesize`), payload: { topic, comparisons, region, timeWindow } },
  ].map((job) => ({ run_id: runId, ...job }));

  await client.database.from('worker_jobs').insert(jobs);
  await client.database.from('run_events').insert([
    {
      run_id: runId,
      event_type: 'run_created',
      message: `Created Senti run for "${topic}" with a ${targetCandidates.toLocaleString()} source collection target.`,
      metadata: { comparisons, aliases, region, timeWindow, depth, queryTypes: Array.from(new Set(queryPlan.map((query) => query.type))) },
    },
    {
      run_id: runId,
      event_type: 'questions_created',
      message: 'Generated baseline opinion, driver, blocker, competitor, confidence, and decision questions.',
      metadata: { questionCount: baselineQuestions.length },
    },
    {
      run_id: runId,
      event_type: 'entity_discovery_complete',
      message: `Generated ${aliases.length.toLocaleString()} aliases and ${comparisons.length.toLocaleString()} comparison entities from ${discovery.sources.length.toLocaleString()} research snippets.`,
      metadata: {
        aliases,
        comparisons,
        errors: discovery.errors,
        model: DEEPSEEK_MODEL,
        promptVersion: DISCOVERY_PROMPT_VERSION,
        sourceCount: discovery.sources.length,
        sources: discovery.sources.slice(0, 12),
      },
    },
    {
      run_id: runId,
      event_type: 'jobs_queued',
      message: 'Queued cache reuse, Tavily web collection, ScrapingBee Google social collection, Bluesky direct collection, LLM evidence analysis, and synthesis jobs.',
      metadata: { jobCount: jobs.length, queryCount: queryPlan.length, queryTypes: Array.from(new Set(queryPlan.map((query) => query.type))) },
    },
  ]);

  return json({ runId, status: 'planning', aliases, comparisons }, 201);
}
