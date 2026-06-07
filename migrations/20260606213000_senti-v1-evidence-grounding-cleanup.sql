alter table public.research_runs
  alter column target_candidates set default 350;

alter table public.research_runs
  add column if not exists data_origin text not null default 'production',
  add column if not exists archived_at timestamptz,
  add column if not exists evaluation_excluded boolean not null default false,
  add column if not exists cleanup_reason text;

alter table public.source_classifications
  alter column model set default 'deepseek-v4-flash';

alter table public.question_answers
  alter column model set default 'deepseek-v4-flash';

update public.research_runs rr
set
  data_origin = 'prototype',
  evaluation_excluded = true,
  cleanup_reason = coalesce(cleanup_reason, 'Pre-Senti v1 prototype artifact; excluded from evaluation until re-run with LLM evidence analysis.')
where
  rr.target_candidates > 500
  or exists (
    select 1
    from public.run_evidence re
    join public.source_classifications sc on sc.chunk_id = re.chunk_id
    where re.run_id = rr.id
      and sc.model in ('heuristic-v1', 'retrieval-heuristic-v1')
  )
  or exists (
    select 1
    from public.question_answers qa
    where qa.run_id = rr.id
      and qa.model in ('heuristic-v1', 'retrieval-heuristic-v1')
  );

create or replace function public.archive_prototype_runs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  archived_count integer;
begin
  update public.research_runs rr
  set
    archived_at = coalesce(rr.archived_at, now()),
    data_origin = 'prototype',
    evaluation_excluded = true,
    cleanup_reason = coalesce(rr.cleanup_reason, 'Archived because this run predates Senti v1 evidence-grounded analysis.')
  where rr.user_id = auth.uid()
    and (
      rr.target_candidates > 500
      or exists (
        select 1
        from public.run_evidence re
        join public.source_classifications sc on sc.chunk_id = re.chunk_id
        where re.run_id = rr.id
          and sc.model in ('heuristic-v1', 'retrieval-heuristic-v1')
      )
      or exists (
        select 1
        from public.question_answers qa
        where qa.run_id = rr.id
          and qa.model in ('heuristic-v1', 'retrieval-heuristic-v1')
      )
    );

  get diagnostics archived_count = row_count;
  return archived_count;
end;
$$;

create or replace function public.wipe_archived_run(input_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.research_runs rr
    where rr.id = input_run_id
      and rr.user_id = auth.uid()
      and rr.evaluation_excluded = true
      and rr.archived_at is not null
  ) then
    raise exception 'Run must be archived and owned by the current user before wiping.';
  end if;

  delete from public.research_runs
  where id = input_run_id
    and user_id = auth.uid()
    and evaluation_excluded = true
    and archived_at is not null;
end;
$$;

grant execute on function public.archive_prototype_runs() to authenticated;
grant execute on function public.wipe_archived_run(uuid) to authenticated;
