
alter table public.emails
  add column if not exists project_scope_status text not null default 'IN_SCOPE',
  add column if not exists project_scope_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'emails_project_scope_status_check'
      and conrelid = 'public.emails'::regclass
  ) then
    alter table public.emails
      add constraint emails_project_scope_status_check
      check (project_scope_status in ('IN_SCOPE','OUT_OF_SCOPE','REVIEW'));
  end if;
end $$;

create index if not exists emails_project_scope_status_idx
  on public.emails(project_id, project_scope_status);

create or replace function public.search_email_document_registry(
  p_project_id uuid,
  p_query text default null,
  p_classification text default null,
  p_sent_to_client boolean default null,
  p_direction text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_sender text default null,
  p_recipient text default null,
  p_work_week integer default null,
  p_classification_status text default null,
  p_intake_status text default null,
  p_risk text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  email_id uuid,
  subject text,
  from_address text,
  to_address text,
  sent_at timestamptz,
  direction text,
  mailbox_address text,
  document_classification text,
  classification_status text,
  classification_confidence numeric,
  work_week_number integer,
  work_week_label text,
  work_week_status text,
  sent_to_client boolean,
  attachment_count bigint,
  intake_id uuid,
  intake_status text,
  risk_classification text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select e.*
    from public.emails e
    where e.project_id = p_project_id
      and e.project_scope_status = 'IN_SCOPE'
      and (
        p_classification is null
        or (
          p_classification = 'UNCLASSIFIED'
          and (
            e.document_classification is null
            or e.document_classification = 'UNCLASSIFIED'
          )
        )
        or e.document_classification = p_classification
      )
      and (
        p_sent_to_client is null
        or coalesce(e.sent_to_client, false) = p_sent_to_client
      )
      and (p_direction is null or e.direction = p_direction)
      and (p_from is null or e.sent_at >= p_from)
      and (p_to is null or e.sent_at <= p_to)
      and (
        p_sender is null
        or e.from_address ilike '%' || p_sender || '%'
      )
      and (
        p_recipient is null
        or e.to_address ilike '%' || p_recipient || '%'
      )
      and (
        p_work_week is null
        or e.work_week_number = p_work_week
      )
      and (
        p_classification_status is null
        or e.classification_status = p_classification_status
      )
      and (
        p_query is null
        or btrim(p_query) = ''
        or e.subject ilike '%' || p_query || '%'
        or e.from_address ilike '%' || p_query || '%'
        or e.to_address ilike '%' || p_query || '%'
        or coalesce(e.work_week_label, '') ilike '%' || p_query || '%'
        or coalesce(e.body_text, '') ilike '%' || p_query || '%'
        or exists (
          select 1
          from public.email_attachments ea
          where ea.email_id = e.id
            and ea.original_file_name ilike '%' || p_query || '%'
        )
        or exists (
          select 1
          from public.email_attachments ea
          join public.document_extractions de
            on de.document_version_id = ea.document_version_id
          where ea.email_id = e.id
            and de.text_content ilike '%' || p_query || '%'
        )
        or exists (
          select 1
          from public.email_attachments ea
          join public.schedule_versions sv
            on sv.document_version_id = ea.document_version_id
          join public.schedule_activities sa
            on sa.schedule_version_id = sv.id
          where ea.email_id = e.id
            and sa.name ilike '%' || p_query || '%'
        )
        or exists (
          select 1
          from public.weekly_report_workbooks wb
          join public.weekly_report_sheets ws
            on ws.workbook_id = wb.id
          where wb.email_id = e.id
            and (
              ws.data::text ilike '%' || p_query || '%'
              or coalesce(ws.original_sheet_name, '')
                ilike '%' || p_query || '%'
            )
        )
      )
  ),
  enriched as (
    select
      b.id as email_id,
      b.subject,
      b.from_address,
      b.to_address,
      b.sent_at,
      b.direction,
      b.mailbox_address,
      b.document_classification,
      b.classification_status,
      b.classification_confidence,
      b.work_week_number,
      b.work_week_label,
      b.work_week_status,
      b.sent_to_client,
      (
        select count(*)
        from public.email_attachments ea
        where ea.email_id = b.id
      ) as attachment_count,
      i.id as intake_id,
      i.status as intake_status,
      (
        select c.risk_classification
        from public.schedule_version_comparisons c
        join public.schedule_versions sv
          on sv.id = c.current_schedule_version_id
        where sv.document_version_id = i.document_version_id
        order by case c.risk_classification
          when 'CRITICAL' then 0
          when 'HIGH' then 1
          when 'REVIEW_REQUIRED' then 2
          when 'MEDIUM' then 3
          else 4
        end
        limit 1
      ) as risk_classification
    from base b
    left join lateral (
      select
        w.id,
        w.status,
        w.document_version_id
      from public.weekly_schedule_email_intakes w
      where w.email_id = b.id
      order by w.created_at desc
      limit 1
    ) i on true
  )
  select
    en.*,
    count(*) over () as total_count
  from enriched en
  where
    (p_intake_status is null or en.intake_status = p_intake_status)
    and
    (p_risk is null or en.risk_classification = p_risk)
  order by en.sent_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.search_email_document_registry(
  uuid, text, text, boolean, text, timestamptz, timestamptz,
  text, text, integer, text, text, text, integer, integer
) from public, anon;

grant execute on function public.search_email_document_registry(
  uuid, text, text, boolean, text, timestamptz, timestamptz,
  text, text, integer, text, text, text, integer, integer
) to authenticated, service_role;
