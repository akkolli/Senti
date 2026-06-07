import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function filesUnder(dir) {
  const out = []
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name)
    const absolute = join(root, path)
    if (statSync(absolute).isDirectory()) out.push(...filesUnder(path))
    else if (/\.(ts|tsx|sql|md)$/.test(name)) out.push(path)
  }
  return out
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const startRun = read('functions/start-research-run.ts')
const worker = read('functions/process-worker-job.ts')
const ask = read('functions/ask-report-question.ts')
const app = read('src/App.tsx')
const cleanupMigration = read('migrations/20260606213000_senti-v1-evidence-grounding-cleanup.sql')
const productFiles = [...filesUnder('functions'), ...filesUnder('src')].map((file) => [file, read(file)])

for (const [file, body] of productFiles) {
  assert(!body.includes('heuristic-v1'), `${file} still references heuristic-v1`)
  assert(!body.includes('retrieval-heuristic-v1'), `${file} still references retrieval-heuristic-v1`)
  assert(!body.includes('100k'), `${file} still advertises 100k candidates`)
  assert(!body.includes('100000'), `${file} still contains a 100000 candidate target`)
}

assert(startRun.includes('broad_public_opinion'), 'run input planning must include broad public opinion queries')
assert(startRun.includes('complaints'), 'run input planning must include complaint queries')
assert(startRun.includes('praise_positive_reviews'), 'run input planning must include praise queries')
assert(startRun.includes('pricing_value'), 'run input planning must include pricing/value queries')
assert(startRun.includes('adoption_blockers'), 'run input planning must include adoption blocker queries')
assert(startRun.includes('competitor_comparisons'), 'run input planning must include competitor comparison queries')
assert(startRun.includes('support_issues'), 'run input planning must include support issue queries')
assert(startRun.includes('targetForDepth') && startRun.includes('return 500') && startRun.includes('return 200'), 'source targets must stay in the 200-500 MVP range')
assert(startRun.includes('searchCountForDepth') && startRun.includes("depth === 'standard'") && startRun.includes('return 100'), 'standard/default runs must plan 100 searches')

assert(worker.includes('TAVILY_API_KEY'), 'worker must read TAVILY_API_KEY')
assert(worker.includes('https://api.tavily.com/search'), 'worker must call Tavily search')
assert(worker.includes('SCRAPINGBEE_API_KEY'), 'worker must read SCRAPINGBEE_API_KEY')
assert(worker.includes('https://app.scrapingbee.com/api/v1/'), 'worker must call ScrapingBee for page snapshots')
assert(worker.includes('DEEPSEEK_API_KEY'), 'worker must read DEEPSEEK_API_KEY')
assert(worker.includes('https://api.deepseek.com/chat/completions'), 'worker must call DeepSeek chat completions')
assert(worker.includes('rejection_reason'), 'worker must store off-topic rejection reasons')
assert(worker.includes('evidence_quote'), 'worker must extract evidence quotes')
assert(worker.includes('Fewer than 75 relevant usable sources'), 'worker must downgrade confidence below the normal-confidence evidence threshold')
assert(worker.includes('sourceQuality'), 'worker must score source quality')
assert(worker.includes('Coverage limits'), 'worker must surface partial collection caveats')

assert(ask.includes('stored run evidence only') || ask.includes('stored evidence'), 'follow-up Q&A must be constrained to stored evidence')
assert(ask.includes('No evidence, no claim'), 'follow-up Q&A must enforce no-evidence/no-claim behavior')
assert(ask.includes('citation_numbers'), 'follow-up Q&A must require citations')

assert(!app.includes('Now vs historic'), 'UI must not show fake historical comparisons')
assert(!app.includes('Competitor score leaderboard'), 'UI must not show fake competitor score leaderboards')
assert(!app.includes('100k target'), 'UI must not advertise unsupported candidate volume')
assert(app.includes('Executive brief'), 'report UI must lead with an executive brief')

assert(cleanupMigration.includes('archive_prototype_runs'), 'cleanup migration must provide prototype archive function')
assert(cleanupMigration.includes('wipe_archived_run'), 'cleanup migration must provide guarded wipe function')

console.log('Senti v1 static checks passed.')
