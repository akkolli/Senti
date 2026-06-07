grant usage on schema public to authenticated;

grant select, insert, update, delete on
  public.entities,
  public.research_runs,
  public.run_entities,
  public.global_sources,
  public.source_versions,
  public.source_chunks,
  public.source_embeddings,
  public.source_classifications,
  public.entity_mentions,
  public.run_candidates,
  public.run_evidence,
  public.research_questions,
  public.question_answers,
  public.opinion_scores,
  public.trends,
  public.comparison_insights,
  public.chat_messages,
  public.connector_runs,
  public.run_events,
  public.worker_jobs
to authenticated;

grant execute on function public.match_source_chunks(vector(1536), uuid, int, float) to authenticated;
grant execute on function public.claim_worker_job(text) to authenticated;
