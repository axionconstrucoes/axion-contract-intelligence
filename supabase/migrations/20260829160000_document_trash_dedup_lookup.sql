-- ============================================================
-- 20260829160000_document_trash_dedup_lookup.sql
-- Deduplicação x lixeira: register_project_document_upload (migration
-- 20260825130000) já IMPEDE a duplicata (índice único parcial
-- document_versions_project_hash_unique_idx + checagem antecipada) —
-- isso vale também para um hash que hoje só existe num documento NA
-- LIXEIRA, então nenhuma duplicata é criada de qualquer forma. O que
-- faltava era a aplicação conseguir dizer AO USUÁRIO "esse conteúdo já
-- existe, e está na lixeira — restaure em vez de tentar de novo",
-- em vez de só "duplicado".
--
-- Deliberadamente NÃO reescreve register_project_document_upload (400+
-- linhas, migration 20260825130000) para não arriscar um erro de
-- transcrição numa function já em uso — em vez disso, uma function
-- pequena e nova que a aplicação chama quando recebe o erro
-- DUPLICATE_FILE_HASH, para descobrir QUAL documento bateu e se está
-- na lixeira.
-- ============================================================

create or replace function public.find_document_by_sha256(
  p_project_id uuid,
  p_sha256_hash text
)
returns table (
  document_id uuid,
  document_title text,
  document_kind text,
  is_trashed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Sessão não autenticada.';
  end if;

  -- Leitura, não escrita: mesma permissão de leitura de documentos do
  -- projeto (qualquer membership ACTIVE) — nunca restrita a
  -- ADMINISTRADOR, ao contrário das RPCs de lixeira acima (aqui não se
  -- vê CONTEÚDO da lixeira, só se confirma "esse hash já existe, é o
  -- documento X, está lá ou não" — suficiente para a UI de upload
  -- sugerir restaurar em vez de duplicar, sem vazar a listagem da
  -- lixeira para quem não é administrador).
  if not exists (
    select 1
    from public.project_memberships pm
    where pm.project_id = p_project_id
      and pm.user_id = v_user_id
      and pm.status = 'ACTIVE'
  ) then
    raise exception 'Você não é membro ativo deste projeto.';
  end if;

  if p_sha256_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid file hash';
  end if;

  return query
    select d.id, d.title, d.kind, d.deleted_at is not null
    from public.document_versions dv
    join public.documents d on d.id = dv.document_id
    where d.project_id = p_project_id
      and dv.sha256_hash = p_sha256_hash
    limit 1;
end;
$$;

alter function public.find_document_by_sha256(uuid, text) owner to postgres;
revoke all on function public.find_document_by_sha256(uuid, text) from public;
revoke all on function public.find_document_by_sha256(uuid, text) from anon;
grant execute on function public.find_document_by_sha256(uuid, text) to authenticated;

notify pgrst, 'reload schema';
