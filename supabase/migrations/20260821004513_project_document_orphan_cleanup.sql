-- ============================================================
-- Project Document Orphan Cleanup
--
-- Uploaded objects are immutable after registration.
-- EDITOR/ADMIN may remove only an object that has NOT yet
-- been registered as a document_version.
-- ============================================================

create or replace function
public.is_unregistered_project_document_object(
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select not exists (
    select 1
    from public.document_versions dv
    where dv.storage_bucket = 'project-documents'
      and dv.file_path = p_object_name
  );
$$;

revoke all
on function public.is_unregistered_project_document_object(text)
from public;

revoke all
on function public.is_unregistered_project_document_object(text)
from anon;

grant execute
on function public.is_unregistered_project_document_object(text)
to authenticated;


drop policy if exists
  "project_documents_storage_delete_unregistered_editors"
  on storage.objects;

create policy
  "project_documents_storage_delete_unregistered_editors"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'project-documents'

  and public.has_project_permission(
    ((storage.foldername(name))[1])::uuid,
    'EDITOR'
  )

  and public.is_unregistered_project_document_object(name)
);
