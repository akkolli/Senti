# Senti v1 Goals

## Goal

Build Senti v1 into a decision-grade public-opinion intelligence product that turns real online evidence into an executive-ready insight brief.

Senti should be useful to executives, product managers, founders, marketers, analysts, and non-technical business users who need to understand what people think, why they think it, and what the business should do next. Engineers and researchers should still be able to drill into the raw evidence, rejected sources, source quality, model outputs, connector status, and data-quality diagnostics.

Senti must stop presenting prototype heuristics as intelligence. Final scores, insights, claims, answers, trends, and competitor conclusions must come from collected evidence analyzed by an LLM and tied back to citations.

## Non-Negotiable Principle

No evidence, no claim.

If evidence is weak, sparse, off-topic, unavailable, or not diverse enough, Senti must say that clearly instead of generating confident-sounding output.

## Product Promise

Given a topic, product, company, market, or competitor question, Senti should answer:

- What does the public currently think?
- What are the strongest positive and negative drivers?
- What pain points are repeated?
- What blocks adoption, purchase, renewal, or advocacy?
- Where do competitors win or lose?
- What should a product or business leader do next?
- How confident should the user be, and why?

## Target Users

The default experience is for:

- executives;
- PMs;
- founders;
- marketers;
- analysts;
- investors;
- MBA-style business decision makers;
- non-technical operators who need fast judgment from public evidence.

The advanced drilldown experience is for:

- engineers;
- researchers;
- data analysts;
- trust and safety reviewers;
- anyone auditing evidence quality or model behavior.

## Primary Output

Every completed report must produce an executive-ready intelligence brief with:

- executive summary;
- public opinion score with confidence;
- top 3-5 decision-relevant insights;
- top pain points;
- positive drivers;
- adoption blockers;
- competitor gaps or advantages;
- recommended actions;
- key evidence quotes;
- caveats and coverage limits.

Every major claim must be traceable to citations.

## Deliverable 1: Run Inputs

Each run must support:

- topic, product, company, or market name;
- optional aliases;
- optional competitors;
- optional audience or segment;
- optional region;
- optional time range;
- optional business question.

Region must either be fully implemented or removed. If implemented, it must affect query planning, source selection, language/country filters, confidence, and caveats.

## Deliverable 2: Real Data Collection

Tavily must become the primary collector.

For each run, Senti must generate separate query types for:

- broad public opinion;
- complaints;
- praise and positive reviews;
- pricing and value perception;
- alternatives;
- adoption blockers;
- competitor comparisons;
- support issues;
- buyer objections;
- churn or switching reasons;
- region-specific variants when region is enabled.

MVP collection target:

- collect 200-500 candidate sources per run;
- deduplicate to usable unique sources;
- require at least 75 relevant usable sources for a normal-confidence report;
- mark reports partial or low-confidence when source volume, quality, diversity, or coverage is weak.

Every collected source must store:

- URL;
- canonical URL;
- title;
- platform or source;
- source type;
- author if available;
- publish date if available;
- fetched date;
- originating query;
- snippet;
- raw text snapshot when available;
- language or region when detectable;
- source quality score;
- relevance status;
- dedupe hash;
- connector errors or limitations.

Deduplication must handle:

- duplicate URLs;
- canonical URL variants;
- repeated titles;
- syndicated articles;
- near-identical snippets;
- duplicate forum or comment content.

## Deliverable 3: Source Quality

Every source must be scored for:

- relevance;
- freshness;
- authority;
- specificity;
- originality;
- first-hand opinion value;
- source diversity contribution.

First-hand user opinion should weigh more than generic news summaries. Secondary reporting can support context, but it should not dominate the public-opinion signal.

## Deliverable 4: Remove Heuristic Analysis

Remove keyword and rule-based analysis from the final decision path.

The following must not power final reports:

- `heuristic-v1`;
- `retrieval-heuristic-v1`;
- word matching for sentiment;
- templated trend detection;
- fake competitor scoring;
- fake time-series trends;
- broad claims inferred from sparse or weak evidence.

## Deliverable 5: LLM Evidence Analysis

Use DeepSeek/OpenRouter for structured per-source or per-chunk analysis.

Each analyzed evidence item must produce structured JSON with:

- relevance;
- inclusion or rejection decision;
- rejection reason if off-topic;
- sentiment;
- stance;
- confidence;
- theme;
- audience or segment;
- pain point;
- positive driver;
- adoption blocker;
- competitor mention;
- feature mention;
- pricing or value signal;
- evidence quote or concise evidence snippet;
- citation URL;
- source quality;
- model name;
- prompt version.

Off-topic evidence must be rejected before synthesis and must not appear in the report.

## Deliverable 6: Evidence-Grounded Opinion Score

Replace the current score with an evidence-based score using:

- LLM sentiment and stance;
- source quality;
- source diversity;
- volume of relevant evidence;
- recency;
- agreement and disagreement across sources;
- connector failures;
- coverage gaps.

The score must include:

- numeric score;
- score label;
- confidence level;
- confidence explanation;
- evidence count;
- source diversity count;
- caveats.

## Deliverable 7: Executive Insights

Every report must include 3-5 top insights.

Each insight must include:

- title;
- plain-English explanation;
- business implication;
- confidence level;
- recommended action;
- supporting citations.

Insights must be written for business decision-making, not for debugging the pipeline.

## Deliverable 8: Pain Points, Drivers, And Blockers

Senti must clearly identify:

- repeated pain points;
- positive drivers;
- adoption blockers;
- buyer objections;
- churn or switching reasons;
- support and documentation gaps;
- pricing or packaging friction.

Each item must include:

- what people are saying;
- who appears affected;
- frequency or evidence strength;
- severity;
- product implication;
- representative citations.

## Deliverable 9: Competitor Intelligence

When competitors are provided or discovered, Senti must report:

- where the target wins;
- where competitors win;
- switching reasons;
- pricing and value perception;
- feature gaps;
- positioning gaps;
- citation-backed examples.

If competitor evidence is insufficient, Senti must explicitly say so instead of inventing a comparison.

## Deliverable 10: Follow-Up Q&A

Follow-up answers must use stored evidence only.

Answers must:

- cite sources;
- answer from the collected evidence;
- explain uncertainty;
- refuse unsupported claims;
- surface relevant pain points, objections, competitors, or recommendations when applicable.

If evidence is insufficient, the answer must say so directly.

## Deliverable 11: Modern, Charming UI

The UI should feel like a polished, ambitious YC company trying to earn attention at launch.

The product should feel:

- sharp;
- premium;
- fast;
- modern;
- charming;
- confident without being loud;
- executive-readable;
- trustworthy;
- memorable enough for a launch audience.

The first report screen must lead with:

- top insights;
- opinion score and confidence;
- biggest pain points;
- competitor gap;
- recommended actions;
- strongest evidence quotes;
- caveats.

The default experience should be simple enough for an MBA-style decision maker to understand immediately. The product should make the user feel like they received a polished intelligence brief, not a dump of pipeline state.

## Deliverable 12: Launch-Worthy Presentation

The release experience should grab attention quickly.

The first-run flow should make the value obvious within seconds:

- the user enters a company, product, or market;
- Senti shows that it is collecting real evidence;
- the final report opens with clear business implications;
- citations are visible enough to establish trust;
- deeper evidence is available without cluttering the main view.

The product should be demo-friendly for:

- Product Hunt;
- YC-style demo day audiences;
- founder and investor demos;
- PM and executive buyers;
- social launch clips;
- short sales calls.

The launch narrative should be:

> Ask what the market thinks. Get the evidence, the pain points, the competitor gaps, and the actions to take.

## Deliverable 13: Technical Drilldown

Engineers and researchers must be able to inspect:

- raw sources;
- rejected evidence;
- source quality;
- connector status;
- model outputs;
- scoring components;
- run events;
- data-quality diagnostics.

This drilldown must be secondary. It should not dominate the executive report.

## Deliverable 14: Remove Unsupported Prototype Claims

Remove or hide:

- `100k candidates`;
- fake region confidence;
- fake trends;
- fake historical comparisons;
- fake competitor scores;
- source coverage claims that are not true;
- any metric not backed by implemented logic;
- any report language that implies statistical survey validity.

## Deliverable 15: Evaluation

Add tests or checks for:

- known-topic runs;
- off-topic rejection;
- citation grounding;
- no-evidence/no-claim behavior;
- competitor sanity;
- deduplication;
- low-evidence confidence downgrades;
- source quality scoring;
- report caveats when collection is partial.

Also provide a human review checklist for validating whether a report is decision-grade.

## Deliverable 16: Prototype Data Cleanup

Existing reports are demo artifacts.

Provide a safe way to:

- wipe prototype run data;
- archive old runs;
- isolate old runs from serious evaluation;
- prevent polluted old data from affecting rebuilt reports.

## Things Not To Do

Do not:

- present keyword heuristics as real analysis;
- use `heuristic-v1` or `retrieval-heuristic-v1` in final outputs;
- generate claims without citations;
- let weak evidence produce confident recommendations;
- bury caveats when evidence is sparse;
- show connector/debug mechanics as the primary user experience;
- claim statistical representativeness;
- claim `100k candidates` unless the system truly processes that volume;
- fake region-aware analysis;
- fake historical trends;
- fake competitor comparisons;
- let Google News or Hacker News dominate the report when better public-opinion evidence is available;
- over-index on generic news summaries;
- treat off-topic chunks as evidence;
- store only summaries without source snapshots or retrievable evidence;
- make the UI feel like an internal admin panel;
- make the launch page feel generic, sterile, or forgettable;
- overload executives with raw tables before showing the answer;
- hide citations so deeply that trust is hard to establish;
- use vague recommendations like "improve product quality" without evidence-backed specifics;
- imply the product can replace proper market research when evidence coverage is weak.

## Definition Of Done

Senti v1 is done when a user can create a run, collect 200-500 real candidate sources, analyze relevant evidence with DeepSeek/OpenRouter, reject off-topic material, and receive a modern executive-ready report where every major claim is traceable to citations, confidence is explicit, weak evidence is caveated, and technical details are available only through drilldown.

