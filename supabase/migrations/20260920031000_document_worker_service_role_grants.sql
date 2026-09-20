grant select, update
on table public.document_versions
to service_role;

grant select
on table public.documents
to service_role;

grant select, insert, update, delete
on table public.document_extractions
to service_role;

grant select, insert, update, delete
on table public.document_text_segments
to service_role;

grant select, insert, update, delete
on table public.schedule_versions
to service_role;

grant select, insert, update, delete
on table public.schedule_activities
to service_role;

grant select, insert, update, delete
on table public.schedule_task_relations
to service_role;

grant insert
on table public.audit_log_entries
to service_role;
