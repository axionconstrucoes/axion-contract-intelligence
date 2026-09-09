-- Persistência imutável dos formulários e fotos do aplicativo SSMA.
-- O Supabase é a fonte autoritativa; o Google Drive será um espelho
-- assíncrono posterior, por isso cada foto nasce com drive_sync_status=PENDING.

create table public.ssma_form_submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  checklist_slug text not null check (checklist_slug in (
    'dda', 'dds', 'fotos-diarias', 'apr', 'pt', 'integracao',
    'almoxarifado', 'riscos-apontados', 'limpeza', 'outros', 'remessa-bota-fora'
  )),
  checklist_number integer not null check (checklist_number between 1 and 11),
  checklist_title text not null,
  drive_folder_name text not null,
  occurred_at timestamptz not null,
  technician_user_id uuid not null references public.profiles(id) on delete restrict,
  field_values jsonb not null default '{}'::jsonb
    check (jsonb_typeof(field_values) = 'object' and octet_length(field_values::text) <= 65536),
  checklist_values jsonb not null
    check (jsonb_typeof(checklist_values) = 'object' and octet_length(checklist_values::text) <= 8192),
  risk_level text check (risk_level is null or risk_level in ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),
  status text not null default 'UPLOADING' check (status in ('UPLOADING', 'SUBMITTED')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'UPLOADING' and submitted_at is null) or (status = 'SUBMITTED' and submitted_at is not null))
);

create index ssma_form_submissions_project_created_idx
  on public.ssma_form_submissions(project_id, created_at desc);

create index ssma_form_submissions_risk_idx
  on public.ssma_form_submissions(project_id, risk_level)
  where status = 'SUBMITTED' and risk_level is not null;

create table public.ssma_submission_photos (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  submission_id uuid not null references public.ssma_form_submissions(id) on delete cascade,
  action_label text not null check (
    action_label in ('Tirar foto', 'Anexar foto', 'Anexar foto da lista', 'Capturar assinatura',
      'Foto antes', 'Foto depois', 'Foto da carga', 'Anexar comprovante')
  ),
  storage_bucket text not null default 'project-documents' check (storage_bucket = 'project-documents'),
  storage_path text not null,
  original_file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 15728640),
  sha256_hash text not null check (sha256_hash ~ '^[0-9a-f]{64}$'),
  drive_sync_status text not null default 'PENDING' check (drive_sync_status in ('PENDING', 'SYNCED', 'FAILED')),
  drive_file_id text,
  drive_synced_at timestamptz,
  drive_sync_error text,
  uploaded_by_user_id uuid not null references public.profiles(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  unique(storage_bucket, storage_path),
  unique(submission_id, sha256_hash)
);

create index ssma_submission_photos_submission_idx
  on public.ssma_submission_photos(submission_id, uploaded_at);

alter table public.ssma_form_submissions enable row level security;
alter table public.ssma_submission_photos enable row level security;

create policy "ssma_submissions_select_active_members"
  on public.ssma_form_submissions for select to authenticated
  using (public.is_project_member(project_id));

create policy "ssma_photos_select_active_members"
  on public.ssma_submission_photos for select to authenticated
  using (public.is_project_member(project_id));

-- A escrita de metadados ocorre exclusivamente pelas RPCs abaixo.
revoke insert, update, delete on public.ssma_form_submissions from authenticated;
revoke insert, update, delete on public.ssma_submission_photos from authenticated;
grant select on public.ssma_form_submissions to authenticated;
grant select on public.ssma_submission_photos to authenticated;

create or replace function public.can_upload_ssma_photo_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_parts text[] := storage.foldername(p_name);
  v_project_id uuid;
  v_submission_id uuid;
begin
  if cardinality(v_parts) < 3 or v_parts[2] <> 'ssma' then return false; end if;
  if v_parts[1] !~ '^[0-9a-fA-F-]{36}$' or v_parts[3] !~ '^[0-9a-fA-F-]{36}$' then return false; end if;
  v_project_id := v_parts[1]::uuid;
  v_submission_id := v_parts[3]::uuid;
  return public.is_project_member(v_project_id) and exists (
    select 1 from public.ssma_form_submissions s
    where s.id = v_submission_id
      and s.project_id = v_project_id
      and s.technician_user_id = auth.uid()
      and s.status = 'UPLOADING'
  );
exception when invalid_text_representation then
  return false;
end;
$$;

revoke all on function public.can_upload_ssma_photo_object(text) from public;
grant execute on function public.can_upload_ssma_photo_object(text) to authenticated;

create policy "ssma_storage_insert_own_uploading_submission"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-documents'
    and public.can_upload_ssma_photo_object(name)
  );

create or replace function public.create_ssma_form_submission(
  p_project_id uuid,
  p_checklist_slug text,
  p_checklist_number integer,
  p_checklist_title text,
  p_drive_folder_name text,
  p_occurred_at timestamptz,
  p_field_values jsonb,
  p_checklist_values jsonb,
  p_risk_level text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_submission_id uuid;
  v_expected_number integer;
  v_expected_title text;
  v_expected_folder text;
  v_expected_checks text[];
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_ACCESS_DENIED'; end if;
  if jsonb_typeof(p_field_values) <> 'object' or jsonb_typeof(p_checklist_values) <> 'object' then
    raise exception 'INVALID_FORM_PAYLOAD';
  end if;
  if exists (select 1 from jsonb_each_text(p_checklist_values) where value not in ('FEITO', 'NA')) then
    raise exception 'INVALID_CHECKLIST_VALUE';
  end if;

  select expected_number, expected_title, expected_folder, expected_checks
  into v_expected_number, v_expected_title, v_expected_folder, v_expected_checks
  from (values
    ('dda', 1, 'DDA', '01 - DIÁLOGO DIÁRIO DE SEGURANÇA - DDA (FOTOS)', array['DDA realizado','Registro dos participantes']),
    ('dds', 2, 'DDS', '02 - DIÁLOGO SEMANAL DE SEGURANÇA - DDS (FOTOS)', array['DDS realizado','Registro dos participantes']),
    ('fotos-diarias', 3, 'Fotos diárias de segurança', '03 - FOTOS DIÁRIAS DE SEGURANÇA', array['Condição registrada']),
    ('apr', 4, 'APR — Análise preliminar de risco', '04 - ANÁLISE PRELIMINAR DE RISCO - APR', array['Trabalho em altura','Eletricidade','Movimentação de cargas']),
    ('pt', 5, 'Permissão de trabalho — PT', '05 - PERMISSÃO DE TRABALHO - PT', array['Área isolada','EPI verificado','Equipamentos inspecionados']),
    ('integracao', 6, 'Lista de integração', '06 - LISTA DE INTEGRAÇÃO', array['Normas de segurança','Uso de EPI','Riscos da obra']),
    ('almoxarifado', 7, 'Organização do almoxarifado', '08 - ORGANIZAÇÃO DO ALMOXARIFADO', array['Materiais identificados','Empilhamento seguro','Corredores desobstruídos','Produtos químicos segregados','Extintores acessíveis']),
    ('riscos-apontados', 8, 'Riscos apontados', '09 - RISCOS APONTADOS', array['Área sinalizada']),
    ('limpeza', 9, 'Limpeza da obra', '10 - LIMPEZA DA OBRA', array['Resíduos recolhidos','Rotas desobstruídas','Materiais organizados','Coleta seletiva realizada','Área sem materiais cortantes']),
    ('outros', 10, 'Outros registros', '11 - OUTROS', array['Registro conferido']),
    ('remessa-bota-fora', 11, 'Remessa para bota-fora', '07 - REMESSAS PARA BOTA-FORA', array['Carga conferida','Destino autorizado'])
  ) as approved(slug, expected_number, expected_title, expected_folder, expected_checks)
  where slug = p_checklist_slug;

  if v_expected_number is null
    or p_checklist_number <> v_expected_number
    or btrim(p_checklist_title) <> v_expected_title
    or btrim(p_drive_folder_name) <> v_expected_folder
    or (select array_agg(key order by key) from jsonb_object_keys(p_checklist_values) as key)
      is distinct from (select array_agg(item order by item) from unnest(v_expected_checks) as item)
  then raise exception 'INVALID_CHECKLIST_DEFINITION'; end if;

  insert into public.ssma_form_submissions (
    project_id, checklist_slug, checklist_number, checklist_title,
    drive_folder_name, occurred_at, technician_user_id,
    field_values, checklist_values, risk_level
  ) values (
    p_project_id, p_checklist_slug, v_expected_number, v_expected_title,
    v_expected_folder, p_occurred_at, v_user_id,
    p_field_values, p_checklist_values, p_risk_level
  ) returning id into v_submission_id;

  return v_submission_id;
end;
$$;

create or replace function public.register_ssma_submission_photo(
  p_photo_id uuid,
  p_submission_id uuid,
  p_action_label text,
  p_storage_path text,
  p_original_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_sha256_hash text
)
returns uuid
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_user_id uuid := auth.uid();
  v_submission public.ssma_form_submissions%rowtype;
  v_expected_prefix text;
begin
  select * into v_submission from public.ssma_form_submissions where id = p_submission_id for update;
  if v_submission.id is null then raise exception 'SUBMISSION_NOT_FOUND'; end if;
  if v_user_id is null or v_submission.technician_user_id <> v_user_id then raise exception 'SUBMISSION_ACCESS_DENIED'; end if;
  if v_submission.status <> 'UPLOADING' then raise exception 'SUBMISSION_ALREADY_FINALIZED'; end if;

  v_expected_prefix := v_submission.project_id::text || '/ssma/' || p_submission_id::text || '/' || p_photo_id::text || '-';
  if left(p_storage_path, length(v_expected_prefix)) <> v_expected_prefix then raise exception 'INVALID_STORAGE_PATH'; end if;
  if p_mime_type not in ('image/jpeg', 'image/png') then raise exception 'INVALID_PHOTO_TYPE'; end if;
  if p_file_size_bytes <= 0 or p_file_size_bytes > 15728640 then raise exception 'INVALID_PHOTO_SIZE'; end if;
  if p_sha256_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_PHOTO_HASH'; end if;
  if (select count(*) from public.ssma_submission_photos where submission_id = p_submission_id) >= 20 then
    raise exception 'PHOTO_LIMIT_EXCEEDED';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'project-documents' and name = p_storage_path
  ) then raise exception 'STORAGE_OBJECT_NOT_FOUND'; end if;

  insert into public.ssma_submission_photos (
    id, project_id, submission_id, action_label, storage_path,
    original_file_name, mime_type, file_size_bytes, sha256_hash, uploaded_by_user_id
  ) values (
    p_photo_id, v_submission.project_id, p_submission_id, btrim(p_action_label), p_storage_path,
    p_original_file_name, p_mime_type, p_file_size_bytes, lower(p_sha256_hash), v_user_id
  );
  return p_photo_id;
end;
$$;

create or replace function public.discard_unregistered_ssma_photo(
  p_submission_id uuid,
  p_storage_path text
)
returns boolean
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_submission public.ssma_form_submissions%rowtype;
  v_prefix text;
begin
  select * into v_submission from public.ssma_form_submissions where id = p_submission_id;
  if v_submission.id is null or v_submission.technician_user_id <> auth.uid() or v_submission.status <> 'UPLOADING' then
    return false;
  end if;
  v_prefix := v_submission.project_id::text || '/ssma/' || p_submission_id::text || '/';
  if left(p_storage_path, length(v_prefix)) <> v_prefix then return false; end if;
  if exists (select 1 from public.ssma_submission_photos where storage_path = p_storage_path) then return false; end if;
  delete from storage.objects where bucket_id = 'project-documents' and name = p_storage_path;
  return found;
end;
$$;

create or replace function public.finalize_ssma_form_submission(p_submission_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission public.ssma_form_submissions%rowtype;
begin
  select * into v_submission from public.ssma_form_submissions where id = p_submission_id for update;
  if v_submission.id is null then raise exception 'SUBMISSION_NOT_FOUND'; end if;
  if v_submission.technician_user_id <> auth.uid() then raise exception 'SUBMISSION_ACCESS_DENIED'; end if;
  if v_submission.status = 'SUBMITTED' then return v_submission.id; end if;

  update public.ssma_form_submissions
  set status = 'SUBMITTED', submitted_at = now()
  where id = p_submission_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  ) values (
    v_submission.project_id, 'USER', auth.uid(), null,
    'SSMA_FORM_SUBMITTED', 'SSMA_FORM_SUBMISSION', v_submission.id::text,
    format('Formulário SSMA "%s" enviado com %s foto(s).', v_submission.checklist_title,
      (select count(*) from public.ssma_submission_photos where submission_id = v_submission.id))
  );
  return v_submission.id;
end;
$$;

revoke all on function public.create_ssma_form_submission(uuid,text,integer,text,text,timestamptz,jsonb,jsonb,text) from public;
revoke all on function public.register_ssma_submission_photo(uuid,uuid,text,text,text,text,bigint,text) from public;
revoke all on function public.discard_unregistered_ssma_photo(uuid,text) from public;
revoke all on function public.finalize_ssma_form_submission(uuid) from public;
grant execute on function public.create_ssma_form_submission(uuid,text,integer,text,text,timestamptz,jsonb,jsonb,text) to authenticated;
grant execute on function public.register_ssma_submission_photo(uuid,uuid,text,text,text,text,bigint,text) to authenticated;
grant execute on function public.discard_unregistered_ssma_photo(uuid,text) to authenticated;
grant execute on function public.finalize_ssma_form_submission(uuid) to authenticated;
