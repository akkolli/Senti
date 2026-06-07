# Senti v1 Evaluation Checklist

Use this checklist on real runs before treating a report as decision-grade.

## Automated Gate

Run:

```bash
npm run lint
npm run build
npm run check:senti
```

The static gate checks that the product path uses Tavily and DeepSeek, does not reference the old heuristic report models, keeps the MVP source target at 200-500, requires evidence quotes and citations, downgrades low evidence, and keeps prototype cleanup functions available.

## Known-Topic Runs

Run at least three known topics:

- one consumer product with abundant public reviews;
- one B2B or developer product with forum evidence;
- one sparse or niche topic.

Pass criteria:

- candidate collection attempts cover broad opinion, complaints, praise, pricing/value, alternatives, adoption blockers, competitor comparison, support issues, and buyer objections;
- the normal-confidence report has at least 75 relevant usable sources;
- sparse topics end in partial or low-confidence status rather than confident recommendations.

## Evidence Grounding

For each top claim, verify:

- the claim has visible citations;
- cited sources are relevant to the topic;
- the quoted evidence actually supports the claim;
- off-topic or generic news summaries are rejected or caveated;
- the report never uses source volume alone as proof of sentiment.

## No-Evidence/No-Claim Behavior

Ask follow-up questions that the run evidence cannot answer.

Pass criteria:

- Senti says the evidence is insufficient;
- Senti does not use outside knowledge;
- Senti explains uncertainty and cites only stored run sources when it answers.

## Competitor Sanity

Run with named competitors.

Pass criteria:

- competitor claims are based on direct citations;
- insufficient competitor evidence is stated plainly;
- no numeric competitor score is shown unless enough direct evidence exists and the scoring method is implemented.

## Deduplication

Inspect raw sources and evidence.

Pass criteria:

- duplicate URLs, UTM variants, repeated titles, syndicated snippets, and near-identical content do not dominate evidence;
- reused cached records are labeled separately from fresh Tavily results.

## Source Quality

Inspect source-quality metadata.

Pass criteria:

- first-hand forum/review/user opinion is weighted above generic summaries;
- freshness, specificity, originality, authority, and diversity contribution are present;
- generic news can support context but does not dominate the opinion signal.

## Partial Report Caveats

Force a partial run by using a narrow topic or missing connector credentials.

Pass criteria:

- report status is partial or low-confidence;
- caveats name collection/model limitations;
- recommendations are narrow and explicitly tied to evidence coverage.

## Executive Readability

Have a non-technical reviewer read only the first report screen.

Pass criteria:

- they can identify the public opinion score, confidence, top insights, pain points, blockers, competitor limits, recommended actions, strongest evidence, and caveats without opening the technical drilldown;
- technical artifacts are available but secondary.
