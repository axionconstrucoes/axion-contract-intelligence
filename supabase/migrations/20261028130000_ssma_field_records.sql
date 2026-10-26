-- ============================================================
-- 20261028130000_ssma_field_records.sql
-- Registros de campo SSMA (ocorrência / inspeção) enviados pelo PWA, com ações corretivas.
--
-- PROPOSTA — NÃO APLICADA em banco real. Aditiva: não altera as tabelas/RPCs dos formulários
-- existentes (ssma_form_submissions, 20260909143000). Depende de public.profiles, public.projects,
-- public.is_project_member(uuid), public.has_project_permission(uuid, text) e do Storage
-- (bucket project-documents, storage.foldername).
--
-- Princípios:
--   - O id do registro e o id de cada foto são gerados NO APARELHO (UUID): reenviar a mesma fila é
--     idempotente (a RPC devolve o registro existente em vez de duplicar).
--   - Autoria = auth.uid() no servidor, e o aparelho precisa declarar o usuário esperado
--     (p_claimed_user_id); se a sessão mudou (troca de conta), o envio é recusado (USER_MISMATCH).
--   - O horário real da criação no aparelho (client_created_at) é preservado; received_at é o horário
--     do servidor. Nunca se sobrescreve um pelo outro.
--   - Escrita só por RPC (SECURITY DEFINER); leitura por membro ATIVO da obra (RLS).
--   - Conclusão de ação corretiva exige evidência (foto) ou justificativa, conforme a permissão.
-- ============================================================

create table public.ssma_field_records (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('OCORRENCIA', 'INSPECAO')),
  category text not null check (char_length(btrim(category)) between 1 and 80),
  description text not null check (char_length(btrim(description)) between 3 and 4000),
  location text not null check (char_length(btrim(location)) between 1 and 200),
  occurred_at timestamptz not null,
  client_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  risk_level text not null check (risk_level in ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),
  responsible_user_id uuid references public.profiles(id) on delete restrict,
  due_date date,
  reported_by_user_id uuid not null references public.profiles(id) on delete restrict,
  check (responsible_user_id is null or due_date is not null)
);

create index ssma_field_records_project_idx on public.ssma_field_records(project_id, occurred_at desc);

create table public.ssma_field_record_photos (
  id uuid primary key,
  record_id uuid not null references public.ssma_field_records(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  purpose text not null default 'REGISTRO' check (purpose in ('REGISTRO', 'EVIDENCIA_ACAO')),
  storage_bucket text not null default 'project-documents' check (storage_bucket = 'project-documents'),
  storage_path text not null,
  original_file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 15728640),
  sha256_hash text not null check (sha256_hash ~ '^[0-9a-f]{64}$'),
  uploaded_by_user_id uuid not null references public.profiles(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  unique (storage_bucket, storage_path),
  unique (record_id, sha256_hash)
);

create index ssma_field_record_photos_record_idx on public.ssma_field_record_photos(record_id, uploaded_at);

create table public.ssma_corrective_actions (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null unique references public.ssma_field_records(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  responsible_user_id uuid not null references public.profiles(id) on delete restrict,
  due_date date not null,
  status text not null default 'ABERTA' check (status in ('ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA')),
  concluded_at timestamptz,
  concluded_by_user_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((status = 'CONCLUIDA') = (concluded_at is not null))
);

create index ssma_corrective_actions_project_idx on public.ssma_corrective_actions(project_id, status, due_date);

-- Histórico imutável do andamento.
create table public.ssma_corrective_action_events (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.ssma_corrective_actions(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('CRIADA', 'ANDAMENTO', 'CONCLUIDA')),
  note text,
  evidence_photo_id uuid references public.ssma_field_record_photos(id) on delete restrict,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index ssma_corrective_action_events_action_idx on public.ssma_corrective_action_events(action_id, created_at);

alter table public.ssma_field_records enable row level security;
alter table public.ssma_field_record_photos enable row level security;
alter table public.ssma_corrective_actions enable row level security;
alter table public.ssma_corrective_action_events enable row level security;

create policy "ssma_field_records_select_members" on public.ssma_field_records
  for select to authenticated using (public.is_project_member(project_id));
create policy "ssma_field_record_photos_select_members" on public.ssma_field_record_photos
  for select to authenticated using (public.is_project_member(project_id));
create policy "ssma_corrective_actions_select_members" on public.ssma_corrective_actions
  for select to authenticated using (public.is_project_member(project_id));
create policy "ssma_corrective_action_events_select_members" on public.ssma_corrective_action_events
  for select to authenticated using (public.is_project_member(project_id));

revoke insert, update, delete on public.ssma_field_records from authenticated;
revoke insert, update, delete on public.ssma_field_record_photos from authenticated;
revoke insert, update, delete on public.ssma_corrective_actions from authenticated;
revoke insert, update, delete on public.ssma_corrective_action_events from authenticated;
grant select on public.ssma_field_records to authenticated;
grant select on public.ssma_field_record_photos to authenticated;
grant select on public.ssma_corrective_actions to authenticated;
grant select on public.ssma_corrective_action_events to authenticated;

-- ------------------------------------------------------------
-- Upload no Storage: caminho {obra}/ssma-registros/{registro}/{foto}-{arquivo}. Só quem pode anexar
-- ao registro: o autor, o responsável pela ação ou um gestor da obra.
-- ------------------------------------------------------------
create or replace function public.can_upload_ssma_field_photo_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_parts text[] := storage.foldername(p_name);
  v_project_id uuid;
  v_record_id uuid;
begin
  if cardinality(v_parts) < 3 or v_parts[2] <> 'ssma-registros' then return false; end if;
  if v_parts[1] !~ '^[0-9a-fA-F-]{36}$' or v_parts[3] !~ '^[0-9a-fA-F-]{36}$' then return false; end if;
  v_project_id := v_parts[1]::uuid;
  v_record_id := v_parts[3]::uuid;
  return public.is_project_member(v_project_id) and exists (
    select 1 from public.ssma_field_records r
    where r.id = v_record_id
      and r.project_id = v_project_id
      and (
        r.reported_by_user_id = auth.uid()
        or r.responsible_user_id = auth.uid()
        or public.has_project_permission(r.project_id, 'GESTOR')
      )
  );
exception when invalid_text_representation then
  return false;
end;
$$;

revoke all on function public.can_upload_ssma_field_photo_object(text) from public;
grant execute on function public.can_upload_ssma_field_photo_object(text) to authenticated;

create policy "ssma_field_storage_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-documents' and public.can_upload_ssma_field_photo_object(name));

-- ------------------------------------------------------------
-- Envio idempotente do registro.
-- ------------------------------------------------------------
create or replace function public.ssma_field_record_submit(
  p_claimed_user_id uuid,
  p_id uuid,
  p_project_id uuid,
  p_kind text,
  p_category text,
  p_description text,
  p_location text,
  p_occurred_at timestamptz,
  p_client_created_at timestamptz,
  p_risk_level text,
  p_responsible_user_id uuid default null,
  p_due_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.ssma_field_records%rowtype;
  v_action_id uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_claimed_user_id is distinct from v_user then raise exception 'USER_MISMATCH'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_ACCESS_DENIED'; end if;
  -- Perfil somente leitura (LEITURA) consulta, mas não registra.
  if exists (
    select 1 from public.project_memberships m
    where m.project_id = p_project_id and m.user_id = v_user and m.permission = 'LEITURA'
  ) then raise exception 'READ_ONLY_MEMBER'; end if;

  select * into v_existing from public.ssma_field_records where id = p_id;
  if found then
    -- Reenvio da mesma fila: devolve o registro já gravado sem alterar nada.
    if v_existing.reported_by_user_id = v_user and v_existing.project_id = p_project_id then
      return v_existing.id;
    end if;
    raise exception 'RECORD_ID_CONFLICT';
  end if;

  if p_occurred_at > now() + interval '1 day' or p_client_created_at > now() + interval '1 day' then
    raise exception 'INVALID_FUTURE_DATE';
  end if;
  if p_responsible_user_id is not null then
    if p_due_date is null then raise exception 'DUE_DATE_REQUIRED'; end if;
    if not exists (
      select 1 from public.project_memberships m
      where m.project_id = p_project_id and m.user_id = p_responsible_user_id and m.status = 'ACTIVE'
        and m.permission <> 'LEITURA'
    ) then raise exception 'RESPONSIBLE_NOT_PROJECT_MEMBER'; end if;
  end if;

  insert into public.ssma_field_records (
    id, project_id, kind, category, description, location, occurred_at, client_created_at,
    risk_level, responsible_user_id, due_date, reported_by_user_id
  ) values (
    p_id, p_project_id, p_kind, btrim(p_category), btrim(p_description), btrim(p_location),
    p_occurred_at, p_client_created_at, p_risk_level, p_responsible_user_id, p_due_date, v_user
  );

  if p_responsible_user_id is not null then
    insert into public.ssma_corrective_actions (record_id, project_id, responsible_user_id, due_date)
    values (p_id, p_project_id, p_responsible_user_id, p_due_date)
    returning id into v_action_id;
    insert into public.ssma_corrective_action_events (action_id, project_id, kind, actor_user_id, note)
    values (v_action_id, p_project_id, 'CRIADA', v_user, 'Ação corretiva aberta com o registro.');
  end if;

  return p_id;
end;
$$;

-- ------------------------------------------------------------
-- Registro idempotente de foto (já enviada ao Storage).
-- ------------------------------------------------------------
create or replace function public.ssma_field_record_register_photo(
  p_claimed_user_id uuid,
  p_photo_id uuid,
  p_record_id uuid,
  p_purpose text,
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
  v_user uuid := auth.uid();
  v_record public.ssma_field_records%rowtype;
  v_existing public.ssma_field_record_photos%rowtype;
  v_prefix text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_claimed_user_id is distinct from v_user then raise exception 'USER_MISMATCH'; end if;

  select * into v_record from public.ssma_field_records where id = p_record_id;
  if not found then raise exception 'RECORD_NOT_FOUND'; end if;
  if not public.is_project_member(v_record.project_id) then raise exception 'PROJECT_ACCESS_DENIED'; end if;
  if not (
    v_record.reported_by_user_id = v_user
    or v_record.responsible_user_id = v_user
    or public.has_project_permission(v_record.project_id, 'GESTOR')
  ) then raise exception 'RECORD_ACCESS_DENIED'; end if;
  if p_purpose = 'REGISTRO' and v_record.reported_by_user_id <> v_user then raise exception 'RECORD_ACCESS_DENIED'; end if;
  if p_purpose not in ('REGISTRO', 'EVIDENCIA_ACAO') then raise exception 'INVALID_PHOTO_PURPOSE'; end if;

  select * into v_existing from public.ssma_field_record_photos where id = p_photo_id;
  if found then
    if v_existing.record_id = p_record_id and v_existing.uploaded_by_user_id = v_user then return v_existing.id; end if;
    raise exception 'PHOTO_ID_CONFLICT';
  end if;

  v_prefix := v_record.project_id::text || '/ssma-registros/' || p_record_id::text || '/' || p_photo_id::text || '-';
  if left(p_storage_path, length(v_prefix)) <> v_prefix then raise exception 'INVALID_STORAGE_PATH'; end if;
  if p_mime_type not in ('image/jpeg', 'image/png') then raise exception 'INVALID_PHOTO_TYPE'; end if;
  if p_file_size_bytes <= 0 or p_file_size_bytes > 15728640 then raise exception 'INVALID_PHOTO_SIZE'; end if;
  if p_sha256_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_PHOTO_HASH'; end if;
  if (select count(*) from public.ssma_field_record_photos where record_id = p_record_id) >= 30 then
    raise exception 'PHOTO_LIMIT_EXCEEDED';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'project-documents' and name = p_storage_path) then
    raise exception 'STORAGE_OBJECT_NOT_FOUND';
  end if;

  insert into public.ssma_field_record_photos (
    id, record_id, project_id, purpose, storage_path, original_file_name, mime_type,
    file_size_bytes, sha256_hash, uploaded_by_user_id
  ) values (
    p_photo_id, p_record_id, v_record.project_id, p_purpose, p_storage_path, p_original_file_name,
    p_mime_type, p_file_size_bytes, lower(p_sha256_hash), v_user
  );
  return p_photo_id;
end;
$$;

-- ------------------------------------------------------------
-- Andamento e conclusão da ação corretiva.
-- Permissão: o responsável ou um gestor/gerente/administrador da obra.
-- Conclusão: o responsável (colaborador) precisa de FOTO de evidência; gestor+ pode concluir com
-- foto OU justificativa (mín. 10 caracteres). Nada é concluído sem registro correspondente.
-- ------------------------------------------------------------
create or replace function public.ssma_corrective_action_update(
  p_action_id uuid,
  p_event text,
  p_note text default null,
  p_evidence_photo_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_action public.ssma_corrective_actions%rowtype;
  v_is_manager boolean;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce(p_event, '') not in ('ANDAMENTO', 'CONCLUIDA') then raise exception 'INVALID_EVENT'; end if;

  select * into v_action from public.ssma_corrective_actions where id = p_action_id for update;
  if not found then raise exception 'ACTION_NOT_FOUND'; end if;
  if not public.is_project_member(v_action.project_id) then raise exception 'PROJECT_ACCESS_DENIED'; end if;

  v_is_manager := coalesce(public.has_project_permission(v_action.project_id, 'GESTOR'), false);
  if not (v_is_manager or coalesce(v_action.responsible_user_id = v_user, false)) then
    raise exception 'ACTION_ACCESS_DENIED';
  end if;
  if v_action.status = 'CONCLUIDA' then raise exception 'ACTION_ALREADY_CONCLUDED'; end if;

  if p_event = 'ANDAMENTO' then
    if v_note is null then raise exception 'NOTE_REQUIRED'; end if;
    update public.ssma_corrective_actions set status = 'EM_ANDAMENTO' where id = p_action_id;
    insert into public.ssma_corrective_action_events (action_id, project_id, kind, note, actor_user_id)
    values (p_action_id, v_action.project_id, 'ANDAMENTO', v_note, v_user);
    return;
  end if;

  if p_evidence_photo_id is not null then
    if not exists (
      select 1 from public.ssma_field_record_photos p
      where p.id = p_evidence_photo_id and p.record_id = v_action.record_id and p.purpose = 'EVIDENCIA_ACAO'
    ) then raise exception 'EVIDENCE_NOT_FOUND'; end if;
  elsif not v_is_manager then
    raise exception 'EVIDENCE_REQUIRED';
  elsif v_note is null or char_length(v_note) < 10 then
    raise exception 'JUSTIFICATION_REQUIRED';
  end if;

  update public.ssma_corrective_actions
  set status = 'CONCLUIDA', concluded_at = now(), concluded_by_user_id = v_user
  where id = p_action_id;
  insert into public.ssma_corrective_action_events (action_id, project_id, kind, note, evidence_photo_id, actor_user_id)
  values (p_action_id, v_action.project_id, 'CONCLUIDA', v_note, p_evidence_photo_id, v_user);
end;
$$;

revoke all on function public.ssma_field_record_submit(uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz,text,uuid,date) from public;
revoke all on function public.ssma_field_record_register_photo(uuid,uuid,uuid,text,text,text,text,bigint,text) from public;
revoke all on function public.ssma_corrective_action_update(uuid,text,text,uuid) from public;
grant execute on function public.ssma_field_record_submit(uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz,text,uuid,date) to authenticated;
grant execute on function public.ssma_field_record_register_photo(uuid,uuid,uuid,text,text,text,text,bigint,text) to authenticated;
grant execute on function public.ssma_corrective_action_update(uuid,text,text,uuid) to authenticated;
