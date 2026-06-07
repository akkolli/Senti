import { createClient } from 'npm:@insforge/sdk';

const INSFORGE_BASE_URL = Deno.env.get('INSFORGE_BASE_URL') ?? 'https://ntu9e7yu.us-west.insforge.app';
const TAVILY_API_KEY = Deno.env.get('TAVILY_API_KEY') ?? '';
const SCRAPINGBEE_API_KEY = Deno.env.get('SCRAPINGBEE_API_KEY') ?? '';
const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY') ?? '';
const DEEPSEEK_MODEL = Deno.env.get('DEEPSEEK_MODEL') ?? 'deepseek-v4-flash';
const PROMPT_VERSION = 'senti-evidence-v1.0';
const SCRAPINGBEE_FETCH_LIMIT_PER_QUERY = Number(Deno.env.get('SCRAPINGBEE_FETCH_LIMIT_PER_QUERY') ?? 6);
const SCRAPINGBEE_GOOGLE_PAGES_PER_QUERY = Number(Deno.env.get('SCRAPINGBEE_GOOGLE_PAGES_PER_QUERY') ?? 1);
const TAVILY_QUERY_CONCURRENCY = Number(Deno.env.get('TAVILY_QUERY_CONCURRENCY') ?? 3);
const SCRAPINGBEE_GOOGLE_QUERY_CONCURRENCY = Number(Deno.env.get('SCRAPINGBEE_GOOGLE_QUERY_CONCURRENCY') ?? 8);
const BLUESKY_QUERY_CONCURRENCY = Number(Deno.env.get('BLUESKY_QUERY_CONCURRENCY') ?? 4);

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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

type QuerySpec = {
  type: string;
  query: string;
  intent: string;
  region?: string;
  timeWindow?: string;
};

type SourceDoc = {
  url: string;
  canonicalUrl: string;
  platform: string;
  sourceFamily: string;
  externalId: string;
  title: string;
  author?: string;
  publishedAt?: string;
  text: string;
  snippet: string;
  status: string;
  originatingQuery: string;
  queryType: string;
  queryIntent: string;
  language?: string;
  region?: string;
  tavilyScore?: number;
  quality: SourceQuality;
  metadata?: Record<string, unknown>;
};

type SourceQuality = {
  relevance: number;
  freshness: number;
  authority: number;
  specificity: number;
  originality: number;
  firstHandOpinion: number;
  diversityContribution: number;
  overall: number;
};

type JobRecord = {
  id: string;
  run_id: string;
  job_type: string;
  source_family?: string;
  query_hash?: string;
  payload?: Record<string, unknown>;
  status: string;
  attempts?: number;
  locked_at?: string | null;
  created_at?: string;
};

type StoreResult = {
  stored: number;
  attempted: number;
  errors: string[];
};

type EvidenceItem = {
  chunkId: string;
  sourceId: string;
  title: string;
  url: string;
  platform: string;
  sourceFamily: string;
  publishedAt?: string | null;
  sourceQuality: number;
  text: string;
};

type LlmEvidence = {
  id: string;
  relevance: number;
  include: boolean;
  rejection_reason?: string;
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed' | 'unclear';
  stance: string;
  confidence: number;
  theme?: string;
  audience_segment?: string;
  pain_point?: string;
  positive_driver?: string;
  adoption_blocker?: string;
  competitor_mentions?: string[];
  feature_mentions?: string[];
  pricing_value_signal?: string;
  evidence_quote?: string;
};

type ClassifiedEvidence = {
  item: EvidenceItem;
  analysis: LlmEvidence;
};

type CollectorDescriptor = {
  name: string;
  sourceFamily: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function hash(input: string): string {
  let value = 0;
  for (let i = 0; i < input.length; i += 1) {
    value = Math.imul(31, value) + input.charCodeAt(i) | 0;
  }
  return Math.abs(value).toString(36);
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

function canonicalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|fbclid|gclid|mc_|igshid|ref|source)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    const normalized = url.toString().replace(/\/$/, '');
    return normalized.slice(0, 1500);
  } catch (_) {
    return rawUrl.slice(0, 1500);
  }
}

function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch (_) {
    return 'unknown';
  }
}

function sourceFamilyFor(url: string): string {
  const host = hostOf(url);
  if (/(reddit|news\.ycombinator|ycombinator|quora|stackexchange|stackoverflow|discourse|forum)/i.test(host)) return 'forum';
  if (/(x\.com|twitter|bsky|threads|facebook|instagram|tiktok|youtube|linkedin)/i.test(host)) return 'social';
  if (/(trustpilot|g2|capterra|producthunt|appstore|play\.google|steamcommunity)/i.test(host)) return 'review';
  if (/(news|nytimes|wsj|bloomberg|reuters|apnews|cnbc|forbes|fortune|techcrunch|theverge|wired|bbc|guardian|washingtonpost|latimes)/i.test(host)) return 'news';
  return 'web';
}

function splitChunks(text: string): string[] {
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  const chunks = [];
  for (let i = 0; i < cleaned.length; i += 1800) {
    chunks.push(cleaned.slice(i, i + 2200));
  }
  return chunks.slice(0, 4);
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

function isDuplicateError(error: unknown): boolean {
  const message = describeError(error).toLowerCase();
  return message.includes('duplicate') || message.includes('unique') || message.includes('already exists');
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

async function boundedMap<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

function timeRangeFor(windowLabel: string | undefined): string | undefined {
  if (windowLabel === 'now_72h') return 'week';
  if (windowLabel === 'recent_30d') return 'month';
  if (windowLabel === 'historic_12m') return 'year';
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

function googleDateRangeFor(windowLabel: string | undefined): string | undefined {
  if (windowLabel === 'now_72h') return 'past_week';
  if (windowLabel === 'recent_30d') return 'past_month';
  if (windowLabel === 'historic_12m') return 'past_year';
  return undefined;
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

function blueskySinceFor(windowLabel: string | undefined): string | undefined {
  const days = windowLabel === 'now_72h'
    ? 3
    : windowLabel === 'recent_30d'
      ? 30
      : windowLabel === 'historic_12m'
        ? 365
        : windowLabel === 'historic_5y'
          ? 365 * 5
          : 30;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function expectedSiteFromQuery(query: string): string | undefined {
  const match = query.match(/\bsite:([^\s)]+)/i);
  return match?.[1]?.replace(/^www\./i, '').toLowerCase();
}

function hostMatchesDomain(host: string, domain: string): boolean {
  const normalizedHost = host.replace(/^www\./i, '').toLowerCase();
  const normalizedDomain = domain.replace(/^www\./i, '').toLowerCase();
  if (normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`)) return true;
  if (normalizedDomain === 'x.com' && (normalizedHost === 'twitter.com' || normalizedHost.endsWith('.twitter.com'))) return true;
  if (normalizedDomain === 'twitter.com' && (normalizedHost === 'x.com' || normalizedHost.endsWith('.x.com'))) return true;
  if (normalizedDomain === 'youtube.com' && normalizedHost === 'youtu.be') return true;
  return false;
}

function isGoogleIndexedSocialUrl(rawUrl: string, spec: QuerySpec): boolean {
  const host = hostOf(rawUrl);
  if (host === 'google.com' || host.endsWith('.google.com')) return false;
  const expected = expectedSiteFromQuery(spec.query);
  if (expected) return hostMatchesDomain(host, expected);
  return googleIndexedSocialDomains.some((domain) => hostMatchesDomain(host, domain));
}

function collectorForSpec(spec: QuerySpec): CollectorDescriptor {
  if (spec.type === 'google_social_index') return { name: 'ScrapingBee Google', sourceFamily: 'social' };
  if (spec.type === 'bluesky_direct') return { name: 'Bluesky', sourceFamily: 'social' };
  return { name: 'Tavily', sourceFamily: 'web' };
}

function collectorLabel(queryPlan: QuerySpec[]): CollectorDescriptor {
  const descriptors = queryPlan.map(collectorForSpec);
  const first = descriptors[0] ?? { name: 'Tavily', sourceFamily: 'web' };
  if (descriptors.every((descriptor) => descriptor.name === first.name)) return first;
  return { name: 'Mixed collectors', sourceFamily: descriptors.some((descriptor) => descriptor.sourceFamily === 'social') ? 'social' : 'web' };
}

function scoreSourceQuality(input: {
  url: string;
  title: string;
  text: string;
  tavilyScore?: number;
  publishedAt?: string;
  queryType: string;
  seenFamilies: Set<string>;
}): SourceQuality {
  const host = hostOf(input.url);
  const family = sourceFamilyFor(input.url);
  const text = `${input.title} ${input.text}`.toLowerCase();
  const ageDays = input.publishedAt ? Math.max(0, (Date.now() - new Date(input.publishedAt).getTime()) / 86400000) : 365;
  const freshness = input.publishedAt ? clamp(1 - ageDays / 730) : 0.35;
  const firstHandOpinion = /(reddit|forum|community|review|trustpilot|g2|capterra|producthunt|appstore|play\.google|news\.ycombinator|bsky|twitter|x\.com|threads|youtube|tiktok|instagram|facebook|linkedin)/i.test(host)
    ? 0.95
    : /(i |we |my |our |bought|returned|switched|using|customer|owner|users|customers|complaint|review)/i.test(text)
      ? 0.72
      : 0.38;
  const specificity = clamp(input.text.length / 2200);
  const originality = /(syndicated|press release|wire service|sponsored)/i.test(text) ? 0.35 : 0.78;
  const authority = family === 'news' ? 0.68 : family === 'review' ? 0.76 : family === 'forum' || family === 'social' ? 0.62 : 0.5;
  const diversityContribution = input.seenFamilies.has(family) ? 0.5 : 0.85;
  const relevance = clamp(input.tavilyScore ?? 0.55);
  const overall = clamp(
    relevance * 0.26 +
      firstHandOpinion * 0.22 +
      specificity * 0.16 +
      freshness * 0.13 +
      originality * 0.11 +
      authority * 0.07 +
      diversityContribution * 0.05,
  );
  return { relevance, freshness, authority, specificity, originality, firstHandOpinion, diversityContribution, overall };
}

function tavilyMaxResults(target: number, queryCount: number): number {
  return Math.max(5, Math.min(20, Math.ceil(target / Math.max(1, queryCount))));
}

function collectionBudgetReached(run: any): boolean {
  const target = Number(run.target_candidates ?? 0);
  return target > 0 && Number(run.candidates_collected ?? 0) >= target;
}

function concurrencyForSpec(spec: QuerySpec): number {
  if (spec.type === 'google_social_index') return Math.max(1, SCRAPINGBEE_GOOGLE_QUERY_CONCURRENCY);
  if (spec.type === 'bluesky_direct') return Math.max(1, BLUESKY_QUERY_CONCURRENCY);
  return Math.max(1, TAVILY_QUERY_CONCURRENCY);
}

async function insertEvent(client: any, runId: string, eventType: string, message: string, metadata: Record<string, unknown> = {}) {
  await client.database.from('run_events').insert([{ run_id: runId, event_type: eventType, message, metadata }]);
}

async function tavilySearch(spec: QuerySpec, maxResults: number) {
  if (!TAVILY_API_KEY) {
    throw new Error('TAVILY_API_KEY is not configured.');
  }

  const body: Record<string, unknown> = {
    query: spec.query,
    search_depth: 'basic',
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
    include_favicon: true,
    topic: spec.type === 'support_issues' ? 'general' : 'general',
    include_usage: true,
  };
  const range = timeRangeFor(spec.timeWindow);
  if (range) body.time_range = range;
  const country = countryForRegion(spec.region);
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
    throw new Error(`Tavily ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function scrapePageText(url: string): Promise<{ text: string; status: 'full' | 'partial' | 'failed'; error?: string }> {
  if (!SCRAPINGBEE_API_KEY) {
    return { text: '', status: 'failed', error: 'SCRAPINGBEE_API_KEY is not configured.' };
  }
  const params = new URLSearchParams({
    api_key: SCRAPINGBEE_API_KEY,
    url,
    render_js: 'false',
    block_resources: 'true',
    return_page_text: 'true',
    timeout: '10000',
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'text/plain,*/*' },
    });
    if (!response.ok) {
      return { text: '', status: 'failed', error: `ScrapingBee ${response.status}` };
    }
    const text = cleanText(await response.text());
    return { text, status: text.length > 500 ? 'full' : text.length ? 'partial' : 'failed' };
  } catch (error) {
    return { text: '', status: 'failed', error: describeError(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function dateFromAny(value: unknown): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

async function scrapingBeeGoogleSearch(spec: QuerySpec, page: number) {
  if (!SCRAPINGBEE_API_KEY) {
    throw new Error('SCRAPINGBEE_API_KEY is not configured.');
  }
  const params = new URLSearchParams({
    api_key: SCRAPINGBEE_API_KEY,
    search: spec.query,
    search_type: 'classic',
    language: 'en',
    light_request: 'true',
    page: String(page),
  });
  const dateRange = googleDateRangeFor(spec.timeWindow);
  if (dateRange) params.set('date_range', dateRange);
  const countryCode = googleCountryCodeForRegion(spec.region);
  if (countryCode) params.set('country_code', countryCode);

  const response = await fetch(`https://app.scrapingbee.com/api/v1/store/google?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`ScrapingBee Google ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function googleOrganicResults(data: any): any[] {
  return Array.isArray(data?.organic_results) ? data.organic_results : [];
}

async function collectTavilyDocs(spec: QuerySpec, maxResults: number, seenFamilies: Set<string>): Promise<SourceDoc[]> {
  const data = await tavilySearch(spec, maxResults);
  const results = Array.isArray(data.results) ? data.results : [];
  const docs: SourceDoc[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const url = String(result.url ?? '').trim();
    const canonicalUrl = canonicalizeUrl(url);
    const tavilyText = cleanText(String(result.content ?? ''));
    const scraped = index < SCRAPINGBEE_FETCH_LIMIT_PER_QUERY ? await scrapePageText(canonicalUrl) : { text: '', status: 'failed' as const, error: 'ScrapingBee enrichment skipped for this lower-ranked result.' };
    const text = scraped.text || tavilyText;
    const snippet = tavilyText || text.slice(0, 500);
    const title = cleanText(String(result.title ?? canonicalUrl));
    const sourceFamily = sourceFamilyFor(canonicalUrl);
    const publishedAt = result.published_date ?? result.published_at ?? undefined;
    const quality = scoreSourceQuality({
      url: canonicalUrl,
      title,
      text: text || snippet,
      tavilyScore: Number(result.score ?? 0),
      publishedAt,
      queryType: spec.type,
      seenFamilies,
    });
    seenFamilies.add(sourceFamily);
    const doc: SourceDoc = {
      url,
      canonicalUrl,
      platform: hostOf(canonicalUrl),
      sourceFamily,
      externalId: canonicalUrl,
      title,
      publishedAt,
      text: text || snippet,
      snippet,
      status: scraped.status === 'full' ? 'full' : scraped.status === 'partial' ? 'partial' : 'snippet_only',
      originatingQuery: spec.query,
      queryType: spec.type,
      queryIntent: spec.intent,
      language: result.language,
      region: spec.region,
      tavilyScore: Number(result.score ?? 0),
      quality,
      metadata: {
        query: spec.query,
        queryType: spec.type,
        queryIntent: spec.intent,
        tavilyScore: result.score,
        favicon: result.favicon,
        sourceQuality: quality,
        tavilyRequestId: data.request_id,
        scrapingBeeStatus: scraped.status,
        scrapingBeeError: scraped.error,
      },
    };
    if (doc.canonicalUrl && (doc.text || doc.snippet)) docs.push(doc);
  }
  return docs;
}

async function collectGoogleIndexedSocialDocs(spec: QuerySpec, maxResults: number, seenFamilies: Set<string>): Promise<SourceDoc[]> {
  const docs: SourceDoc[] = [];
  const seenUrls = new Set<string>();
  const maxPages = Math.max(1, Math.min(3, SCRAPINGBEE_GOOGLE_PAGES_PER_QUERY));

  for (let page = 1; page <= maxPages && docs.length < maxResults; page += 1) {
    const data = await scrapingBeeGoogleSearch(spec, page);
    const results = googleOrganicResults(data);
    if (!results.length) break;

    for (const result of results) {
      if (docs.length >= maxResults) break;
      const url = String(result.url ?? result.link ?? '').trim();
      if (!url) continue;
      const canonicalUrl = canonicalizeUrl(url);
      if (seenUrls.has(canonicalUrl) || !isGoogleIndexedSocialUrl(canonicalUrl, spec)) continue;
      seenUrls.add(canonicalUrl);

      const googleSnippet = cleanText(String(result.description ?? result.snippet ?? ''));
      const scraped = docs.length < SCRAPINGBEE_FETCH_LIMIT_PER_QUERY ? await scrapePageText(canonicalUrl) : { text: '', status: 'failed' as const, error: 'ScrapingBee enrichment skipped for this lower-ranked result.' };
      const text = scraped.text || googleSnippet;
      if (!text) continue;

      const title = cleanText(String(result.title ?? canonicalUrl));
      const sourceFamily = sourceFamilyFor(canonicalUrl);
      const position = Number(result.position ?? docs.length + 1);
      const googleScore = clamp(0.9 - Math.max(0, position - 1) * 0.035, 0.35, 0.9);
      const publishedAt = dateFromAny(result.date_utc ?? result.date);
      const quality = scoreSourceQuality({
        url: canonicalUrl,
        title,
        text,
        tavilyScore: googleScore,
        publishedAt,
        queryType: spec.type,
        seenFamilies,
      });
      seenFamilies.add(sourceFamily);
      docs.push({
        url,
        canonicalUrl,
        platform: hostOf(canonicalUrl),
        sourceFamily,
        externalId: canonicalUrl,
        title,
        publishedAt,
        text,
        snippet: googleSnippet || text.slice(0, 500),
        status: scraped.status === 'full' ? 'full' : scraped.status === 'partial' ? 'partial' : 'snippet_only',
        originatingQuery: spec.query,
        queryType: spec.type,
        queryIntent: spec.intent,
        region: spec.region,
        tavilyScore: googleScore,
        quality,
        metadata: {
          query: spec.query,
          queryType: spec.type,
          queryIntent: spec.intent,
          collectionMethod: 'scrapingbee_google_search',
          googlePosition: position,
          googleDomain: result.domain,
          googleSearchPage: page,
          googleDate: result.date,
          googleDateUtc: result.date_utc,
          sourceQuality: quality,
          scrapingBeeStatus: scraped.status,
          scrapingBeeError: scraped.error,
        },
      });
    }
  }

  return docs;
}

function sanitizeBlueskyQuery(query: string): string {
  return cleanText(query)
    .replace(/\bsite:\S+/gi, ' ')
    .replace(/["“”]/g, ' ')
    .replace(/\bpast (72 hours|30 days|year|five years)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

async function blueskySearchPosts(spec: QuerySpec, maxResults: number) {
  const params = new URLSearchParams({
    q: sanitizeBlueskyQuery(spec.query),
    sort: 'latest',
    limit: String(Math.max(1, Math.min(100, maxResults))),
  });
  const since = blueskySinceFor(spec.timeWindow);
  if (since) params.set('since', since);

  const response = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Bluesky ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function blueskyPostUrl(post: any): string | null {
  const handle = String(post?.author?.handle ?? '').trim();
  const uri = String(post?.uri ?? '');
  const rkey = uri.split('/').filter(Boolean).pop();
  if (!handle || !rkey) return null;
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

async function collectBlueskyDocs(spec: QuerySpec, maxResults: number, seenFamilies: Set<string>): Promise<SourceDoc[]> {
  const data = await blueskySearchPosts(spec, maxResults);
  const posts = Array.isArray(data.posts) ? data.posts : [];
  const docs: SourceDoc[] = [];

  for (const post of posts) {
    if (docs.length >= maxResults) break;
    const url = blueskyPostUrl(post);
    if (!url) continue;
    const canonicalUrl = canonicalizeUrl(url);
    const record = post.record ?? {};
    const text = cleanText(String(record.text ?? ''));
    if (!text) continue;
    const handle = String(post.author?.handle ?? '');
    const sourceFamily = 'social';
    const title = cleanText(`Bluesky post by ${handle || 'unknown author'}`);
    const engagement = Number(post.likeCount ?? 0) + Number(post.repostCount ?? 0) + Number(post.replyCount ?? 0);
    const relevance = clamp(0.58 + Math.log10(engagement + 1) * 0.07, 0.45, 0.9);
    const publishedAt = dateFromAny(record.createdAt ?? post.indexedAt);
    const quality = scoreSourceQuality({
      url: canonicalUrl,
      title,
      text,
      tavilyScore: relevance,
      publishedAt,
      queryType: spec.type,
      seenFamilies,
    });
    seenFamilies.add(sourceFamily);
    docs.push({
      url,
      canonicalUrl,
      platform: 'bsky.app',
      sourceFamily,
      externalId: String(post.uri ?? canonicalUrl),
      title,
      author: handle,
      publishedAt,
      text,
      snippet: text.slice(0, 500),
      status: 'full',
      originatingQuery: spec.query,
      queryType: spec.type,
      queryIntent: spec.intent,
      language: Array.isArray(record.langs) ? record.langs[0] : undefined,
      region: spec.region,
      tavilyScore: relevance,
      quality,
      metadata: {
        query: spec.query,
        queryType: spec.type,
        queryIntent: spec.intent,
        collectionMethod: 'bluesky_public_appview',
        postUri: post.uri,
        postCid: post.cid,
        authorDid: post.author?.did,
        likeCount: post.likeCount,
        repostCount: post.repostCount,
        replyCount: post.replyCount,
        quoteCount: post.quoteCount,
        sourceQuality: quality,
      },
    });
  }

  return docs;
}

async function ensureSource(client: any, doc: SourceDoc) {
  const contentHash = hash(`${doc.canonicalUrl}:${doc.text || doc.snippet}`);
  const existing = await client.database
    .from('global_sources')
    .select('id')
    .eq('canonical_url', doc.canonicalUrl)
    .limit(1)
    .maybeSingle();

  if (existing.data?.id) {
    await client.database
      .from('global_sources')
      .update({
        last_seen_at: new Date().toISOString(),
        last_refreshed_at: new Date().toISOString(),
        metadata: doc.metadata ?? {},
      })
      .eq('id', existing.data.id);
    return { id: existing.data.id, contentHash };
  }

  const inserted = await client.database
    .from('global_sources')
    .insert([{
      canonical_url: doc.canonicalUrl,
      platform: doc.platform,
      source_family: doc.sourceFamily,
      external_id: doc.externalId || hash(doc.canonicalUrl),
      title: doc.title?.slice(0, 500) || doc.canonicalUrl,
      author_handle: doc.author,
      published_at: doc.publishedAt,
      content_hash: contentHash,
      language: doc.language ?? 'unknown',
      collection_status: doc.status,
      permission_level: doc.status === 'snippet_only' ? 'search_snippet_only' : 'public_indexed',
      engagement: {},
      metadata: doc.metadata ?? {},
      last_refreshed_at: new Date().toISOString(),
    }])
    .select('id')
    .maybeSingle();

  if (inserted.error || !inserted.data?.id) {
    const retry = await client.database.from('global_sources').select('id').eq('canonical_url', doc.canonicalUrl).limit(1).maybeSingle();
    if (retry.data?.id) return { id: retry.data.id, contentHash };
    throw inserted.error ?? new Error('Unable to insert source');
  }

  return { id: inserted.data.id, contentHash };
}

async function storeDocs(client: any, runId: string, connector: string, docs: SourceDoc[]): Promise<StoreResult> {
  let stored = 0;
  let attempted = 0;
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const doc of docs) {
    attempted += 1;
    const titleKey = cleanText(doc.title).toLowerCase().slice(0, 140);
    const snippetKey = hash(cleanText(doc.snippet || doc.text).toLowerCase().slice(0, 700));
    const dedupeKey = `${doc.canonicalUrl}|${titleKey}|${snippetKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    try {
      const source = await ensureSource(client, doc);
      const version = await client.database
        .from('source_versions')
        .insert([{
          source_id: source.id,
          raw_excerpt: (doc.snippet || doc.text).slice(0, 2000),
          normalized_text: doc.text.slice(0, 16000),
          content_hash: source.contentHash,
          metadata: {
            ...(doc.metadata ?? {}),
            canonicalUrl: doc.canonicalUrl,
            fetchedDate: new Date().toISOString(),
            originatingQuery: doc.originatingQuery,
            snippet: doc.snippet,
            language: doc.language,
            region: doc.region,
            dedupeHash: dedupeKey,
            sourceQualityScore: doc.quality.overall,
          },
        }])
        .select('id')
        .maybeSingle();
      if (version.error && !isDuplicateError(version.error)) {
        errors.push(`source_versions: ${describeError(version.error)}`);
      }

      const chunks = splitChunks(doc.text || doc.snippet);
      for (let index = 0; index < chunks.length; index += 1) {
        const chunkResult = await client.database.from('source_chunks').insert([{
          source_id: source.id,
          version_id: version.data?.id ?? null,
          chunk_index: index,
          chunk_text: chunks[index],
          token_estimate: Math.ceil(chunks[index].length / 4),
        }]);
        if (chunkResult.error && !isDuplicateError(chunkResult.error)) {
          errors.push(`source_chunks: ${describeError(chunkResult.error)}`);
        }
      }

      const candidateResult = await client.database.from('run_candidates').insert([{
        run_id: runId,
        source_id: source.id,
        query: doc.originatingQuery,
        query_hash: hash(`${connector}:${doc.originatingQuery}`),
        source_family: doc.sourceFamily,
        connector,
        candidate_status: 'collected',
        relevance_score: doc.quality.overall,
        cache_status: 'fresh',
        window_label: 'recent_30d',
      }]);
      if (candidateResult.error) {
        if (!isDuplicateError(candidateResult.error)) {
          errors.push(`run_candidates: ${describeError(candidateResult.error)}`);
        }
      } else {
        stored += 1;
      }
    } catch (error) {
      if (!isDuplicateError(error)) {
        errors.push(describeError(error));
      }
    }
  }
  return { stored, attempted, errors: unique(errors).slice(0, 8) };
}

function queryPlanFromPayload(job: JobRecord, run: any): QuerySpec[] {
  const fromPayload = Array.isArray(job.payload?.queryPlan) ? job.payload.queryPlan as QuerySpec[] : [];
  if (fromPayload.length) return fromPayload.filter((spec) => spec?.query);
  return [
    { type: 'broad_public_opinion', query: `${run.topic} public opinion reviews`, intent: 'broad public opinion', region: run.region, timeWindow: run.time_window },
    { type: 'complaints', query: `${run.topic} complaints problems`, intent: 'complaints and pain points', region: run.region, timeWindow: run.time_window },
    { type: 'praise_positive_reviews', query: `${run.topic} praise positive reviews`, intent: 'positive drivers', region: run.region, timeWindow: run.time_window },
    { type: 'pricing_value', query: `${run.topic} price worth it value`, intent: 'pricing and value perception', region: run.region, timeWindow: run.time_window },
    { type: 'adoption_blockers', query: `${run.topic} adoption blockers objections`, intent: 'adoption blockers', region: run.region, timeWindow: run.time_window },
  ];
}

async function processTavilyCollection(client: any, run: any, job: JobRecord) {
  if (collectionBudgetReached(run)) {
    await insertEvent(
      client,
      run.id,
      'collection_budget_reached',
      `Collection target reached with ${Number(run.candidates_collected ?? 0).toLocaleString()} candidate sources; skipping remaining collection work.`,
      { targetCandidates: run.target_candidates, collected: run.candidates_collected },
    );
    return;
  }

  const queryPlan = queryPlanFromPayload(job, run);
  const target = Number(job.payload?.targetCandidates ?? run.target_candidates ?? 350);
  const maxResults = Number(job.payload?.maxResultsPerQuery ?? tavilyMaxResults(target, queryPlan.length));
  const connector = collectorLabel(queryPlan);
  const connectorRun = await client.database
    .from('connector_runs')
    .insert([{ run_id: run.id, connector_name: connector.name, source_family: connector.sourceFamily, status: 'running', started_at: new Date().toISOString(), metadata: { queryCount: queryPlan.length, maxResults } }])
    .select('id')
    .maybeSingle();

  let attempted = 0;
  let collected = 0;
  const errors: string[] = [];
  const seenFamilies = new Set<string>();
  const connectorStats: Record<string, { attempted: number; collected: number }> = {};

  async function collectOne(spec: QuerySpec) {
    const specConnector = collectorForSpec(spec);
    const result = { connector: specConnector.name, attempted: maxResults, collected: 0, errors: [] as string[] };
    try {
      const docs = spec.type === 'google_social_index'
        ? await collectGoogleIndexedSocialDocs(spec, maxResults, seenFamilies)
        : spec.type === 'bluesky_direct'
          ? await collectBlueskyDocs(spec, maxResults, seenFamilies)
          : await collectTavilyDocs(spec, maxResults, seenFamilies);
      const storeResult = await storeDocs(client, run.id, specConnector.name, docs);
      result.collected = storeResult.stored;
      result.errors.push(...storeResult.errors);
    } catch (error) {
      result.errors.push(`${spec.type}: ${describeError(error).slice(0, 240)}`);
    }
    return result;
  }

  const specsByCollector = new Map<string, QuerySpec[]>();
  for (const spec of queryPlan) {
    const key = collectorForSpec(spec).name;
    specsByCollector.set(key, [...(specsByCollector.get(key) ?? []), spec]);
  }

  const collectorResults = await Promise.all(Array.from(specsByCollector.values()).map((specs) => {
    const concurrency = Math.min(Math.max(...specs.map(concurrencyForSpec)), specs.length);
    return boundedMap(specs, concurrency, collectOne);
  }));

  for (const result of collectorResults.flat()) {
    attempted += result.attempted;
    collected += result.collected;
    connectorStats[result.connector] ??= { attempted: 0, collected: 0 };
    connectorStats[result.connector].attempted += result.attempted;
    connectorStats[result.connector].collected += result.collected;
    errors.push(...result.errors);
  }

  const errorMessage = unique(errors).slice(0, 6).join(' | ') || null;
  const status = collected > 0 ? (errorMessage ? 'partial' : 'complete') : 'failed';
  await client.database
    .from('connector_runs')
    .update({
      status,
      fetched_count: collected,
      error_message: errorMessage,
      finished_at: new Date().toISOString(),
      metadata: { queryCount: queryPlan.length, maxResults, attempted, connectorStats },
    })
    .eq('id', connectorRun.data?.id);

  await client.database
    .from('research_runs')
    .update({
      status: 'collecting',
      progress_percent: collected > 0 ? 45 : 25,
      candidates_attempted: Number(run.candidates_attempted ?? 0) + attempted,
      candidates_collected: Number(run.candidates_collected ?? 0) + collected,
      readiness_label: collected > 0 ? 'evidence-arriving' : 'source-limited',
    })
    .eq('id', run.id);

  await insertEvent(
    client,
    run.id,
    'collection_complete',
    `${connector.name} collected ${collected.toLocaleString()} unique candidate sources from ${attempted.toLocaleString()} planned result slots.`,
    { attempted, collected, status, errors: unique(errors).slice(0, 6), connectorStats },
  );
}

async function processCache(client: any, run: any, job: JobRecord) {
  const queryPlan = queryPlanFromPayload(job, run).slice(0, 12);
  let reused = 0;
  for (const spec of queryPlan) {
    const existing = await client.database
      .from('global_sources')
      .select('id, source_family, metadata')
      .ilike('title', `%${String(spec.query).slice(0, 80)}%`)
      .limit(120);
    for (const source of existing.data ?? []) {
      try {
        await client.database.from('run_candidates').insert([{
          run_id: run.id,
          source_id: source.id,
          query: spec.query,
          query_hash: hash(`cache:${spec.query}`),
          source_family: source.source_family ?? 'cache',
          connector: 'Senti cache',
          candidate_status: 'reused',
          relevance_score: Number(source.metadata?.sourceQualityScore ?? 0.55),
          cache_status: 'cached',
          window_label: 'cached',
        }]);
        reused += 1;
      } catch (_) {
        // Duplicate cache links are expected across query variants.
      }
    }
  }
  await client.database
    .from('research_runs')
    .update({
      status: 'checking_cache',
      progress_percent: Math.max(Number(run.progress_percent ?? 0), 12),
      candidates_collected: Number(run.candidates_collected ?? 0) + reused,
    })
    .eq('id', run.id);
  await insertEvent(client, run.id, 'cache_checked', `Reused ${reused.toLocaleString()} cached source records.`, { reused });
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

function jsonRepairCandidates(text: string): string[] {
  const cleaned = stripJsonFences(text);
  const balanced = extractBalancedJsonObject(cleaned);
  const candidates = [cleaned, balanced].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.flatMap((candidate) => [
    candidate,
    candidate.replace(/,\s*([}\]])/g, '$1'),
  ]);
}

function parseJsonObject(text: string): any {
  for (const candidate of jsonRepairCandidates(text)) {
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // Try the next candidate.
    }
  }
  throw new Error('Model did not return valid JSON.');
}

async function deepSeekCompletion(messages: Array<{ role: 'system' | 'user'; content: string }>, maxTokens: number) {
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
  return String(content);
}

async function deepSeekJson(messages: Array<{ role: 'system' | 'user'; content: string }>, maxTokens = 2200) {
  const content = await deepSeekCompletion(messages, maxTokens);
  try {
    return parseJsonObject(content);
  } catch (error) {
    const repaired = await deepSeekCompletion([
      {
        role: 'system',
        content: 'Repair malformed JSON. Return only one valid JSON object. Preserve keys and values. Do not add commentary.',
      },
      {
        role: 'user',
        content: stripJsonFences(content).slice(0, 24000),
      },
    ], Math.max(1200, Math.min(5000, maxTokens)));
    try {
      return parseJsonObject(repaired);
    } catch (_) {
      throw error;
    }
  }
}

async function loadEvidenceItems(client: any, run: any): Promise<EvidenceItem[]> {
  const candidates = await client.database
    .from('run_candidates')
    .select('id, source_id, relevance_score, source_family')
    .eq('run_id', run.id)
    .order('relevance_score', { ascending: false })
    .limit(Math.max(500, Number(run.target_candidates ?? 350) * 2));

  const sourceIds = unique((candidates.data ?? []).map((candidate: any) => candidate.source_id).filter(Boolean));
  const sources: any[] = [];
  for (let i = 0; i < sourceIds.length; i += 100) {
    const sourceBatch = await client.database
      .from('global_sources')
      .select('id, title, canonical_url, platform, source_family, published_at, metadata')
      .in('id', sourceIds.slice(i, i + 100));
    sources.push(...(sourceBatch.data ?? []));
  }

  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const chunks: any[] = [];
  for (let i = 0; i < sourceIds.length; i += 100) {
    const chunkBatch = await client.database
      .from('source_chunks')
      .select('id, source_id, chunk_text')
      .in('source_id', sourceIds.slice(i, i + 100))
      .limit(1200);
    chunks.push(...(chunkBatch.data ?? []));
  }

  return chunks
    .map((chunk: any) => {
      const source = sourceMap.get(chunk.source_id);
      const quality = Number(source?.metadata?.sourceQuality?.overall ?? source?.metadata?.sourceQualityScore ?? 0.55);
      return {
        chunkId: chunk.id,
        sourceId: chunk.source_id,
        title: source?.title ?? '',
        url: source?.canonical_url ?? '',
        platform: source?.platform ?? '',
        sourceFamily: source?.source_family ?? '',
        publishedAt: source?.published_at ?? null,
        sourceQuality: quality,
        text: String(chunk.chunk_text ?? '').slice(0, 2200),
      };
    })
    .filter((item: EvidenceItem) => item.text.length > 60)
    .sort((a: EvidenceItem, b: EvidenceItem) => b.sourceQuality - a.sourceQuality)
    .slice(0, Math.max(200, Math.min(600, Number(run.target_candidates ?? 350) * 2)));
}

async function classifyBatch(run: any, items: EvidenceItem[], competitors: string[]): Promise<LlmEvidence[]> {
  const payload = items.map((item) => ({
    id: item.chunkId,
    title: item.title,
    url: item.url,
    platform: item.platform,
    source_family: item.sourceFamily,
    source_quality: item.sourceQuality,
    text: item.text,
  }));
  const result = await deepSeekJson([
    {
      role: 'system',
      content: [
        'You are Senti v1 evidence classifier.',
        'Return only strict JSON in this shape: {"items":[...]}',
        'Use every on-topic public signal: social posts, forum posts, reviews, article excerpts, launch commentary, pricing discussion, design reactions, buyer interest, and competitor mentions.',
        'Reject only unrelated text, navigation boilerplate, login walls, and source text that is clearly about another topic.',
        'For included evidence, extract a short quote or compact excerpt from the source text and keep every field grounded in that source.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        prompt_version: PROMPT_VERSION,
        topic: run.topic,
        aliases: run.aliases ?? [],
        competitors,
        region: run.region,
        instructions: {
          fields: [
            'id',
            'relevance number 0-1',
            'include boolean',
            'rejection_reason string when include=false',
            'sentiment positive|negative|neutral|mixed|unclear',
            'stance concise string',
            'confidence number 0-1',
            'theme concise string',
            'audience_segment string or null',
            'pain_point string or null',
            'positive_driver string or null',
            'adoption_blocker string or null',
            'competitor_mentions array',
            'feature_mentions array',
            'pricing_value_signal string or null',
            'evidence_quote short exact quote from text',
          ],
        },
        evidence: payload,
      }),
    },
  ], 4200);
  return Array.isArray(result.items) ? result.items : [];
}

function sentimentValue(sentiment: string): number {
  if (sentiment === 'positive') return 1;
  if (sentiment === 'negative') return -1;
  if (sentiment === 'mixed') return 0;
  return 0;
}

function confidenceLabel(relevantCount: number, sourceCount: number, familyCount: number, connectorFailures: number): 'high' | 'medium' | 'low' | 'insufficient' {
  if (relevantCount < 1 || sourceCount < 1) return 'low';
  if (relevantCount < 10 || sourceCount < 6) return 'low';
  if (relevantCount >= 150 && sourceCount >= 75 && familyCount >= 4 && connectorFailures === 0) return 'high';
  if (relevantCount >= 75 && sourceCount >= 35 && familyCount >= 3) return 'medium';
  return 'low';
}

function topCounts(values: Array<string | undefined | null>, limit = 8) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = String(value ?? '').trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label, count]) => ({ label, count }));
}

function topicMatcher(run: any): RegExp {
  const parts = [run.topic, ...(Array.isArray(run.aliases) ? run.aliases : [])]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(parts.length ? parts.join('|') : String(run.topic ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function quoteFromText(text: string): string {
  const cleaned = cleanText(text);
  const sentence = cleaned.split(/(?<=[.!?])\s+/).find((part) => part.length > 80) ?? cleaned;
  return sentence.slice(0, 320);
}

function fallbackEvidence(run: any, items: EvidenceItem[]): ClassifiedEvidence[] {
  const matcher = topicMatcher(run);
  const target = Math.max(10, Math.min(80, Number(run.target_candidates ?? 10) * 4));
  return items
    .filter((item) => matcher.test(`${item.title} ${item.text}`))
    .slice(0, target)
    .map((item) => ({
      item,
      analysis: {
        id: item.chunkId,
        relevance: Math.max(0.35, item.sourceQuality),
        include: true,
        sentiment: 'mixed',
        stance: 'Public source signal',
        confidence: Math.max(0.25, Math.min(0.65, item.sourceQuality)),
        theme: item.sourceFamily === 'forum' || item.sourceFamily === 'social' ? 'public reaction' : 'market coverage',
        audience_segment: item.sourceFamily === 'forum' || item.sourceFamily === 'social' ? 'public commenters' : 'market observers',
        competitor_mentions: [],
        feature_mentions: [],
        evidence_quote: quoteFromText(item.text),
      },
    }));
}

async function processAnalyze(client: any, run: any) {
  await client.database.from('comparison_insights').delete().eq('run_id', run.id);
  await client.database.from('trends').delete().eq('run_id', run.id);
  await client.database.from('opinion_scores').delete().eq('run_id', run.id);
  await client.database.from('question_answers').delete().eq('run_id', run.id);
  await client.database.from('run_evidence').delete().eq('run_id', run.id);

  const primary = await client.database
    .from('run_entities')
    .select('entity_id')
    .eq('run_id', run.id)
    .eq('role', 'primary')
    .limit(1)
    .maybeSingle();

  const comparisonEntitiesResult = await client.database
    .from('run_entities')
    .select('entity_id, role')
    .eq('run_id', run.id)
    .in('role', ['suggested', 'comparison'])
    .limit(8);
  const comparisonEntityIds = (comparisonEntitiesResult.data ?? []).map((row: any) => row.entity_id);
  const comparisonEntities = comparisonEntityIds.length
    ? await client.database.from('entities').select('id, canonical_name').in('id', comparisonEntityIds)
    : { data: [] };
  const competitorNames = (comparisonEntities.data ?? []).map((entity: any) => String(entity.canonical_name ?? '')).filter(Boolean);

  const items = await loadEvidenceItems(client, run);
  if (!DEEPSEEK_API_KEY) {
    await client.database
      .from('research_runs')
      .update({
        status: 'partial',
        progress_percent: 100,
        candidates_unique: unique(items.map((item) => item.sourceId)).length,
        candidates_relevant: 0,
        classified_count: 0,
        evidence_count: 0,
        citation_count: 0,
        readiness_label: 'model-unavailable',
        summary: 'Senti collected candidate sources. Configure DEEPSEEK_API_KEY to generate the interpreted source read.',
        caveats: 'LLM evidence analysis is unavailable in the function runtime.',
      })
      .eq('id', run.id);
    await insertEvent(client, run.id, 'analysis_blocked', 'DeepSeek evidence analysis is unavailable because DEEPSEEK_API_KEY is missing.', {});
    return;
  }

  const classified: ClassifiedEvidence[] = [];
  const classificationRows = [];
  const evidenceRows = [];
  const batchSize = 14;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    try {
      const analyses = await classifyBatch(run, batch, competitorNames);
      const analysisById = new Map(analyses.map((analysis) => [analysis.id, analysis]));
      for (const item of batch) {
        const analysis = analysisById.get(item.chunkId) ?? {
          id: item.chunkId,
          relevance: 0,
          include: false,
          rejection_reason: 'Model did not return an analysis for this item.',
          sentiment: 'unclear',
          stance: 'unclear',
          confidence: 0,
        } as LlmEvidence;
        const relevance = clamp(Number(analysis.relevance ?? 0));
        const confidence = clamp(Number(analysis.confidence ?? 0));
        classificationRows.push({
          chunk_id: item.chunkId,
          entity_id: primary.data?.entity_id ?? null,
          relevance_score: relevance,
          sentiment: analysis.sentiment ?? 'unclear',
          stance: analysis.stance ?? analysis.sentiment ?? 'unclear',
          theme: analysis.theme ?? null,
          driver_type: analysis.pain_point ? 'pain_point' : analysis.positive_driver ? 'positive_driver' : analysis.adoption_blocker ? 'adoption_blocker' : analysis.theme ?? 'evidence',
          severity: analysis.sentiment === 'negative' ? confidence : 0,
          confidence,
          model: DEEPSEEK_MODEL,
          metadata: {
            promptVersion: PROMPT_VERSION,
            include: Boolean(analysis.include),
            rejectionReason: analysis.rejection_reason,
            audienceSegment: analysis.audience_segment,
            painPoint: analysis.pain_point,
            positiveDriver: analysis.positive_driver,
            adoptionBlocker: analysis.adoption_blocker,
            competitorMentions: analysis.competitor_mentions ?? [],
            featureMentions: analysis.feature_mentions ?? [],
            pricingValueSignal: analysis.pricing_value_signal,
            evidenceQuote: analysis.evidence_quote,
            citationUrl: item.url,
            sourceQuality: item.sourceQuality,
          },
        });
        if (analysis.include && relevance >= 0.2 && confidence >= 0.1) {
          const evidenceQuote = analysis.evidence_quote || quoteFromText(item.text);
          classified.push({ item, analysis: { ...analysis, relevance, confidence, evidence_quote: evidenceQuote } });
          evidenceRows.push({
            run_id: run.id,
            source_id: item.sourceId,
            chunk_id: item.chunkId,
            entity_id: primary.data?.entity_id ?? null,
            evidence_tier: relevance >= 0.78 && confidence >= 0.65 ? 2 : 1,
            relevance_score: relevance,
            citation_grade: true,
            window_label: run.time_window ?? 'recent_30d',
          });
        }
      }
    } catch (error) {
      await insertEvent(client, run.id, 'analysis_batch_limited', `DeepSeek batch failed: ${describeError(error).slice(0, 240)}`, { offset: i });
    }
    await sleep(150);
  }

  if (classified.length === 0 && items.length > 0) {
    const fallback = fallbackEvidence(run, items);
    const existingEvidenceKeys = new Set(evidenceRows.map((row) => `${row.source_id}:${row.chunk_id}`));
    for (const row of fallback) {
      classified.push(row);
      const key = `${row.item.sourceId}:${row.item.chunkId}`;
      if (existingEvidenceKeys.has(key)) continue;
      existingEvidenceKeys.add(key);
      evidenceRows.push({
        run_id: run.id,
        source_id: row.item.sourceId,
        chunk_id: row.item.chunkId,
        entity_id: primary.data?.entity_id ?? null,
        evidence_tier: 1,
        relevance_score: row.analysis.relevance,
        citation_grade: true,
        window_label: run.time_window ?? 'recent_30d',
      });
    }
  }

  for (let i = 0; i < classificationRows.length; i += 500) {
    await client.database.from('source_classifications').insert(classificationRows.slice(i, i + 500));
  }
  for (let i = 0; i < evidenceRows.length; i += 500) {
    await client.database.from('run_evidence').insert(evidenceRows.slice(i, i + 500));
  }

  const uniqueSources = new Set(classified.map((row) => row.item.sourceId));
  const sourceFamilies = new Set(classified.map((row) => row.item.sourceFamily));
  const positive = classified.filter((row) => row.analysis.sentiment === 'positive').length;
  const negative = classified.filter((row) => row.analysis.sentiment === 'negative').length;
  const mixed = classified.filter((row) => row.analysis.sentiment === 'mixed').length;
  const neutral = classified.length - positive - negative - mixed;
  const weighted = classified.reduce((sum, row) => sum + sentimentValue(row.analysis.sentiment) * row.item.sourceQuality * row.analysis.confidence, 0);
  const weightSum = classified.reduce((sum, row) => sum + row.item.sourceQuality * row.analysis.confidence, 0);
  const sentimentBalance = weightSum ? Math.round(((weighted / weightSum) + 1) * 50) : 0;
  const qualityAverage = classified.length ? classified.reduce((sum, row) => sum + row.item.sourceQuality, 0) / classified.length : 0;
  const agreement = classified.length ? Math.max(positive, negative, mixed, neutral) / classified.length : 0;

  const connectors = await client.database.from('connector_runs').select('connector_name, status, error_message').eq('run_id', run.id);
  const connectorFailures = (connectors.data ?? []).filter((connector: any) => ['failed', 'partial'].includes(connector.status)).length;
  const confidence = confidenceLabel(classified.length, uniqueSources.size, sourceFamilies.size, connectorFailures);
  const confidenceReason = `${classified.length.toLocaleString()} usable evidence items from ${uniqueSources.size.toLocaleString()} sources across ${sourceFamilies.size.toLocaleString()} source families.`;
  const score = classified.length ? Math.round(sentimentBalance * 0.62 + qualityAverage * 100 * 0.18 + Math.min(100, uniqueSources.size / 75 * 100) * 0.12 + agreement * 100 * 0.08) : null;
  const scoreLabel = score == null ? 'unscored' : score >= 80 ? 'strongly favorable' : score >= 65 ? 'favorable' : score >= 50 ? 'mixed-positive' : score >= 40 ? 'mixed-negative' : score >= 20 ? 'unfavorable' : 'strongly unfavorable';

  const themes = topCounts(classified.map((row) => row.analysis.theme), 10);
  const painPoints = topCounts(classified.map((row) => row.analysis.pain_point), 8);
  const positiveDrivers = topCounts(classified.map((row) => row.analysis.positive_driver), 8);
  const adoptionBlockers = topCounts(classified.map((row) => row.analysis.adoption_blocker), 8);
  const pricingSignals = topCounts(classified.map((row) => row.analysis.pricing_value_signal), 8);
  const competitorMentions = topCounts(classified.flatMap((row) => row.analysis.competitor_mentions ?? []), 8);
  const citedSourceIds = Array.from(uniqueSources).slice(0, 30);

  if (primary.data?.entity_id) {
    await client.database.from('opinion_scores').insert([{
      run_id: run.id,
      entity_id: primary.data.entity_id,
      window_label: run.time_window ?? 'recent_30d',
      score,
      score_label: scoreLabel,
      confidence_label: confidence,
      confidence_reason: confidenceReason,
      sentiment_balance: sentimentBalance,
      momentum: 0,
      source_diversity: Math.min(100, Math.round(uniqueSources.size / 75 * 100)),
      complaint_risk_inverse: classified.length ? Math.max(0, 100 - Math.round(negative / classified.length * 100)) : 0,
      advocacy_intent: classified.length ? Math.min(100, Math.round(positive / classified.length * 100)) : 0,
      competitor_relative_position: competitorMentions.length ? 50 : 0,
      evidence_count: classified.length,
      source_origin_count: uniqueSources.size,
      component_json: {
        positive,
        negative,
        mixed,
        neutral,
        rejected: Math.max(0, classificationRows.length - classified.length),
        sourceQualityAverage: qualityAverage,
        agreement,
        themes,
        painPoints,
        positiveDrivers,
        adoptionBlockers,
        pricingSignals,
        competitorMentions,
        model: DEEPSEEK_MODEL,
        promptVersion: PROMPT_VERSION,
        coverageGaps: [],
      },
      cited_source_ids: citedSourceIds,
    }]);
  }

  for (const entity of comparisonEntities.data ?? []) {
    if (!primary.data?.entity_id) continue;
    const name = String(entity.canonical_name ?? '').toLowerCase();
    const matched = classified.filter((row) => (row.analysis.competitor_mentions ?? []).some((mention) => mention.toLowerCase().includes(name) || name.includes(mention.toLowerCase())));
    const matchedSources = new Set(matched.map((row) => row.item.sourceId));
    await client.database.from('comparison_insights').insert([{
      run_id: run.id,
      primary_entity_id: primary.data.entity_id,
      comparison_entity_id: entity.id,
      score_delta: null,
      strengths: [],
      weaknesses: [],
      summary: matched.length >= 8
        ? `${entity.canonical_name} appears in ${matched.length.toLocaleString()} collected evidence items, so the report can use those sources for qualitative competitor context.`
        : `${entity.canonical_name} did not appear prominently in the collected source set.`,
      cited_source_ids: Array.from(matchedSources).slice(0, 10),
    }]);
  }

  const trendRows = themes.slice(0, 8).map((theme) => {
    const related = classified.filter((row) => row.analysis.theme === theme.label);
    const relatedSources = unique(related.map((row) => row.item.sourceId));
    return {
      run_id: run.id,
      entity_id: primary.data?.entity_id ?? null,
      window_label: run.time_window ?? 'recent_30d',
      label: theme.label,
      description: `${theme.label} recurs across ${theme.count.toLocaleString()} LLM-included evidence items.`,
      direction: 'mixed',
      driver_type: 'recurring_theme',
      confidence_label: theme.count >= 20 && relatedSources.length >= 10 ? 'medium' : 'low',
      velocity: theme.count,
      source_count: relatedSources.length,
      cited_source_ids: relatedSources.slice(0, 10),
    };
  });
  if (trendRows.length) {
    await client.database.from('trends').insert(trendRows);
  }

  await createEvidenceAnswers(client, run, classified, confidence, confidenceReason);

  await client.database
    .from('research_runs')
    .update({
      status: 'analyzing',
      progress_percent: 82,
      candidates_unique: unique(items.map((item) => item.sourceId)).length,
      candidates_relevant: classified.length,
      classified_count: classificationRows.length,
      evidence_count: evidenceRows.length,
      citation_count: citedSourceIds.length,
      trend_count: trendRows.length,
      comparison_count: comparisonEntities.data?.length ?? 0,
      readiness_label: 'progressive-report-ready',
    })
    .eq('id', run.id);
  await insertEvent(client, run.id, 'analysis_complete', `DeepSeek analyzed ${classificationRows.length.toLocaleString()} chunks and kept ${classified.length.toLocaleString()} usable evidence items.`, { classified: classificationRows.length, included: classified.length });
}

async function createEvidenceAnswers(client: any, run: any, classified: ClassifiedEvidence[], confidence: string, confidenceReason: string) {
  const questions = await client.database
    .from('research_questions')
    .select('id, question_text')
    .eq('run_id', run.id)
    .eq('question_type', 'initial')
    .limit(20);
  if (!questions.data?.length) return;

  const evidence = classified.slice(0, 70).map((row, index) => ({
    n: index + 1,
    source_id: row.item.sourceId,
    url: row.item.url,
    platform: row.item.platform,
    sentiment: row.analysis.sentiment,
    theme: row.analysis.theme,
    pain_point: row.analysis.pain_point,
    positive_driver: row.analysis.positive_driver,
    adoption_blocker: row.analysis.adoption_blocker,
    pricing_value_signal: row.analysis.pricing_value_signal,
    competitor_mentions: row.analysis.competitor_mentions ?? [],
    quote: row.analysis.evidence_quote,
  }));
  const citationsByN = new Map(evidence.map((item) => [item.n, item.source_id]));
  const result = classified.length === 0 ? { answers: [] } : await deepSeekJson([
    {
      role: 'system',
      content: [
        'You are Senti v1 report analyst.',
        'Answer from the supplied evidence items.',
        'Every concrete claim must cite source numbers in citation_numbers.',
        'Interpret the collected sample directly. Do not refuse because the run is small.',
        'Omit questions with no direct source support instead of writing a lack-of-data answer.',
        'Return JSON: {"answers":[{"question_id":"...","answer":"...","confidence_label":"high|medium|low","citation_numbers":[1,2]}]}',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        topic: run.topic,
        region: run.region,
        confidence,
        confidenceReason,
        questions: questions.data.map((question: any) => ({ id: question.id, text: question.question_text })),
        evidence,
      }),
    },
  ], 3600);

  const byQuestion = new Map((Array.isArray(result.answers) ? result.answers : []).map((answer: any) => [answer.question_id, answer]));
  const rows = questions.data.flatMap((question: any) => {
    const answer = byQuestion.get(question.id);
    const citationNumbers = Array.isArray(answer?.citation_numbers) ? answer.citation_numbers.map(Number) : [];
    const citedSourceIds = unique(citationNumbers.map((number) => citationsByN.get(number)).filter(Boolean) as string[]).slice(0, 8);
    const content = String(answer?.answer ?? '').trim();
    if (!content || citedSourceIds.length === 0) return [];
    return [{
      run_id: run.id,
      question_id: question.id,
      answer: content,
      stance: 'evidence-grounded',
      sentiment: 'mixed',
      confidence_label: String(answer?.confidence_label ?? confidence),
      confidence_reason: confidenceReason,
      cited_source_ids: citedSourceIds,
      cited_chunk_ids: [],
      model: DEEPSEEK_MODEL,
    }];
  });
  await client.database.from('research_questions').update({ status: 'skipped' }).eq('run_id', run.id).eq('question_type', 'initial');
  if (rows.length) {
    await client.database.from('question_answers').insert(rows);
    await client.database.from('research_questions').update({ status: 'answered' }).in('id', rows.map((row: any) => row.question_id));
  }
}

async function processSynthesis(client: any, run: any) {
  const primary = await client.database
    .from('run_entities')
    .select('entity_id')
    .eq('run_id', run.id)
    .eq('role', 'primary')
    .limit(1)
    .maybeSingle();

  const score = await client.database
    .from('opinion_scores')
    .select('score, score_label, confidence_label, confidence_reason, evidence_count, source_origin_count, component_json')
    .eq('run_id', run.id)
    .eq('entity_id', primary.data?.entity_id ?? '')
    .eq('window_label', run.time_window ?? 'recent_30d')
    .limit(1)
    .maybeSingle();
  const answers = await client.database.from('question_answers').select('answer, cited_source_ids').eq('run_id', run.id).limit(12);
  const jobs = await client.database.from('worker_jobs').select('job_type, status, error_message').eq('run_id', run.id);
  const connectors = await client.database.from('connector_runs').select('connector_name, status, error_message').eq('run_id', run.id);
  const limitedConnectors = (connectors.data ?? []).filter((connector: any) => ['failed', 'partial'].includes(connector.status));
  const coverageGaps = [
    ...limitedConnectors.map((connector: any) => `${connector.connector_name} ${connector.status}`),
    ...((jobs.data ?? []).filter((job: any) => job.status === 'failed').map((job: any) => `${job.job_type} failed`)),
  ];
  const citedSourceIds = unique((answers.data ?? []).flatMap((answer: any) => answer.cited_source_ids ?? []));

  let summary = citedSourceIds.length
    ? `Senti found public signals for "${run.topic}", but the report summary could not be generated.`
    : `Senti collected sources for "${run.topic}" and is ready for a source-level read.`;
  if (citedSourceIds.length > 0) {
    try {
      const synthesis = await deepSeekJson([
        {
          role: 'system',
          content: 'Write a concise executive interpretation from the supplied source-backed answers. Interpret the collected sample directly. Do not refuse because the run is small. Return JSON: {"summary":"..."}',
        },
        {
          role: 'user',
          content: JSON.stringify({
            topic: run.topic,
            score: score.data,
            answers: (answers.data ?? []).map((answer: any) => answer.answer),
          }),
        },
      ], 900);
      if (synthesis.summary) summary = String(synthesis.summary);
    } catch (_) {
      summary = score.data?.score != null
        ? `Senti scores "${run.topic}" at ${score.data.score}/100 (${score.data.score_label}) from the collected public evidence.`
        : `Senti collected public evidence for "${run.topic}" and prepared the source read.`;
    }
  }

  const finalStatus = coverageGaps.length > 0 ? 'partial' : 'complete';
  const caveats = [
    `Scope: ${run.depth ?? 'standard'} run over collected public web sources.`,
    score.data?.confidence_reason ?? '',
    coverageGaps.length ? `Coverage limits: ${coverageGaps.slice(0, 6).join('; ')}.` : '',
  ].filter(Boolean).join(' ');

  await client.database
    .from('research_runs')
    .update({
      status: finalStatus,
      progress_percent: 100,
      summary,
      caveats,
      readiness_label: finalStatus === 'complete' ? 'complete' : 'source-limited',
    })
    .eq('id', run.id);
  await insertEvent(client, run.id, 'report_ready', 'Executive report is ready with LLM-analyzed public evidence and source references.', { summary, finalStatus });
}

function jobPriority(jobType: string): number {
  if (jobType === 'collect-cache') return 10;
  if (jobType === 'collect-tavily') return 20;
  if (jobType === 'analyze') return 30;
  if (jobType === 'synthesize') return 40;
  return 99;
}

function terminal(job?: JobRecord): boolean {
  return !!job && ['complete', 'failed'].includes(job.status);
}

function complete(job?: JobRecord): boolean {
  return !!job && job.status === 'complete';
}

function jobByType(jobs: JobRecord[], jobType: string): JobRecord | undefined {
  return jobs.find((job) => job.job_type === jobType);
}

function jobIsReady(job: JobRecord, jobs: JobRecord[]): boolean {
  if (job.job_type === 'collect-cache') return true;

  const cache = jobByType(jobs, 'collect-cache');
  if (job.job_type === 'collect-tavily') return terminal(cache);

  const tavilyJobs = jobs.filter((candidate) => candidate.job_type === 'collect-tavily');
  if (job.job_type === 'analyze') return terminal(cache) && tavilyJobs.length > 0 && tavilyJobs.every(terminal);

  const analyze = jobByType(jobs, 'analyze');
  if (job.job_type === 'synthesize') return complete(analyze);

  return false;
}

async function selectNextJob(client: any, run: any): Promise<{ status: 'ready'; job: JobRecord } | { status: 'busy' | 'idle' | 'waiting'; message: string }> {
  const runId = run.id;
  const jobsResult = await client.database.from('worker_jobs').select('*').eq('run_id', runId);
  const jobs = (jobsResult.data ?? []) as JobRecord[];
  if (!jobs.length) return { status: 'idle', message: 'No worker jobs exist for this run.' };

  const now = Date.now();
  for (const job of jobs) {
    if (job.status === 'running') {
      const lockedAt = job.locked_at ? new Date(job.locked_at).getTime() : now;
      if (now - lockedAt < 120_000) return { status: 'busy', message: `${job.job_type} is already running.` };
      await client.database.from('worker_jobs').update({ status: 'retrying', error_message: 'Recovered stale running job.' }).eq('id', job.id);
    }
  }

  if (collectionBudgetReached(run)) {
    const pendingCollectionJobs = jobs.filter((job) => job.job_type === 'collect-tavily' && ['queued', 'retrying'].includes(job.status));
    if (pendingCollectionJobs.length) {
      await client.database
        .from('worker_jobs')
        .update({
          status: 'complete',
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .in('id', pendingCollectionJobs.map((job) => job.id));
      await insertEvent(
        client,
        runId,
        'collection_budget_reached',
        `Collection target reached with ${Number(run.candidates_collected ?? 0).toLocaleString()} candidate sources; skipped ${pendingCollectionJobs.length.toLocaleString()} remaining collection jobs.`,
        { targetCandidates: run.target_candidates, collected: run.candidates_collected, skippedJobs: pendingCollectionJobs.length },
      );
      for (const job of pendingCollectionJobs) job.status = 'complete';
    }
  }

  const next = jobs
    .filter((job) => ['queued', 'retrying'].includes(job.status))
    .filter((job) => jobIsReady(job, jobs))
    .sort((a, b) => jobPriority(a.job_type) - jobPriority(b.job_type) || String(a.created_at).localeCompare(String(b.created_at)))[0];

  if (next) {
    const claimed = await client.database
      .from('worker_jobs')
      .update({
        status: 'running',
        locked_at: new Date().toISOString(),
        locked_by: `edge-${crypto.randomUUID()}`,
        attempts: Number(next.attempts ?? 0) + 1,
      })
      .eq('id', next.id)
      .select('*')
      .maybeSingle();
    if (claimed.data) return { status: 'ready', job: claimed.data };
  }

  const pending = jobs.filter((job) => ['queued', 'retrying'].includes(job.status));
  return pending.length ? { status: 'waiting', message: 'Jobs are waiting for dependencies.' } : { status: 'idle', message: 'No runnable jobs.' };
}

async function markJob(client: any, job: JobRecord, status: 'complete' | 'failed', errorMessage?: string) {
  await client.database
    .from('worker_jobs')
    .update({
      status,
      error_message: errorMessage ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);
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
  if (!runId) return json({ error: 'runId is required' }, 400);

  const run = await client.database.from('research_runs').select('*').eq('id', runId).maybeSingle();
  if (run.error || !run.data?.id) return json({ error: 'Run not found' }, 404);

  const selected = await selectNextJob(client, run.data);
  if (selected.status !== 'ready') return json({ status: selected.status, message: selected.message });

  const job = selected.job;
  try {
    if (job.job_type === 'collect-cache') await processCache(client, run.data, job);
    else if (job.job_type === 'collect-tavily') await processTavilyCollection(client, run.data, job);
    else if (job.job_type === 'analyze') await processAnalyze(client, run.data);
    else if (job.job_type === 'synthesize') await processSynthesis(client, run.data);
    else throw new Error(`Unknown job type: ${job.job_type}`);
    await markJob(client, job, 'complete');
    return json({ status: 'processed', jobType: job.job_type });
  } catch (error) {
    const message = describeError(error);
    await markJob(client, job, 'failed', message.slice(0, 500));
    await insertEvent(client, runId, 'worker_job_failed', `${job.job_type} failed: ${message.slice(0, 240)}`, { jobType: job.job_type });
    await client.database
      .from('research_runs')
      .update({ status: 'partial', readiness_label: 'source-limited', caveats: `A worker job failed: ${job.job_type}. ${message.slice(0, 240)}` })
      .eq('id', runId);
    return json({ status: 'failed', jobType: job.job_type, error: message }, 500);
  }
}
