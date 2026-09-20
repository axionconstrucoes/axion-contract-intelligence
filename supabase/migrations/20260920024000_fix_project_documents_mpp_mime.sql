-- Corrige drift do bucket project-documents em produção.
-- Mantém a allowlist existente e garante suporte a Microsoft Project (.mpp).

update storage.buckets
set allowed_mime_types =
  case
    when allowed_mime_types is null then
      array['application/vnd.ms-project']::text[]
    when 'application/vnd.ms-project' = any(allowed_mime_types) then
      allowed_mime_types
    else
      array_append(allowed_mime_types, 'application/vnd.ms-project')
  end
where id = 'project-documents';
