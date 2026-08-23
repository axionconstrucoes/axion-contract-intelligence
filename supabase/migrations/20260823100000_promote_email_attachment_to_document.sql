-- ============================================================
-- 20260823100000_promote_email_attachment_to_document.sql
-- RPC de promoção interativa de anexo de e-mail a documento — a mesma
-- lógica de apps/web/lib/email/attachments/link-email-attachment-to-document.ts,
-- mas invocável por um usuário autenticado (EDITOR/ADMIN) via
-- supabase.rpc(), não só por um client service-role de script.
--
-- Por quê uma função nova em vez de reaproveitar o client de sessão
-- diretamente: documents/document_versions/email_attachments não têm
-- policy de INSERT/UPDATE para "authenticated" (só SELECT — ver
-- 20260818195206_project_documents_foundation.sql e
-- 20260823060000_email_attachment_ingestion_foundation.sql). O padrão já
-- estabelecido neste projeto para permitir uma escrita privilegiada e
-- auditada a partir do navegador é uma função SECURITY DEFINER validando
-- permissão internamente — exatamente como
-- register_project_document_upload já faz para upload manual. Nenhuma
-- policy de INSERT/UPDATE ampla foi adicionada a essas tabelas.
--
-- Nunca re-upload, nunca duplica o objeto do Storage (reaproveita
-- file_path/storage_bucket do anexo já ingerido). Idempotente: anexo já
-- promovido devolve o document_version_id existente. A classificação
-- (kind/título/data/autor/resumo) é sempre decidida pelo humano que
-- chama esta função — a IA nunca escolhe sozinha.
-- ============================================================

create or replace function public.promote_email_attachment_to_document(
  p_attachment_id uuid,
  p_kind text,
  p_document_title text,
  p_document_date date,
  p_author text,
  p_summary text
)
returns table (document_id uuid, document_version_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid;
  v_attachment record;
  v_document_id uuid;
  v_document_version_id uuid;
begin
  v_actor_user_id := auth.uid();

  if v_actor_user_id is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if nullif(trim(p_document_title), '') is null then
    raise exception 'Título do documento é obrigatório.';
  end if;

  if nullif(trim(p_author), '') is null then
    raise exception 'Autor/emissor é obrigatório.';
  end if;

  if nullif(trim(p_summary), '') is null then
    raise exception 'Resumo é obrigatório.';
  end if;

  select ea.id, ea.project_id, ea.storage_bucket, ea.storage_path, ea.original_file_name,
         ea.mime_type, ea.file_size_bytes, ea.source_language, ea.document_version_id
    into v_attachment
    from public.email_attachments ea
    where ea.id = p_attachment_id;

  if v_attachment.id is null then
    raise exception 'Anexo (id=%) não encontrado.', p_attachment_id;
  end if;

  if not public.has_project_permission(v_attachment.project_id, 'EDITOR') then
    raise exception 'Permissão EDITOR ou ADMIN necessária para incorporar este anexo aos Documentos.';
  end if;

  -- Idempotente: já promovido? nunca cria um segundo document_version para o mesmo anexo.
  if v_attachment.document_version_id is not null then
    select dv.id, dv.document_id
      into v_document_version_id, v_document_id
      from public.document_versions dv
      where dv.id = v_attachment.document_version_id;

    if v_document_version_id is not null then
      return query select v_document_id, v_document_version_id;
      return;
    end if;
  end if;

  insert into public.documents (project_id, kind, title)
  values (v_attachment.project_id, p_kind, p_document_title)
  returning id into v_document_id;

  insert into public.document_versions (
    document_id, version_label, version_index, document_date, source_type,
    author, summary, file_path, storage_bucket, original_file_name, mime_type,
    file_size_bytes, processing_status, source_language
  ) values (
    v_document_id, 'v1', 1, p_document_date, 'EMAIL',
    p_author, p_summary,
    -- Reaproveita o MESMO objeto de Storage já salvo na ingestão — nunca re-upload.
    v_attachment.storage_path, v_attachment.storage_bucket,
    v_attachment.original_file_name, v_attachment.mime_type, v_attachment.file_size_bytes,
    -- Entra na mesma fila de extração de texto já existente — nenhum pipeline novo.
    'AWAITING_PROCESSING', v_attachment.source_language
  )
  returning id into v_document_version_id;

  update public.email_attachments
    set document_version_id = v_document_version_id,
        processing_status = 'PROCESSED',
        processing_error = null
    where id = p_attachment_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  ) values (
    v_attachment.project_id, 'USER', v_actor_user_id, null,
    'EMAIL_ATTACHMENT_PROCESSED', 'EMAIL_ATTACHMENT', p_attachment_id::text,
    format('Anexo "%s" promovido a documento (kind=%s, document_version_id=%s).', v_attachment.original_file_name, p_kind, v_document_version_id)
  );

  return query select v_document_id, v_document_version_id;
end;
$$;

revoke all
on function public.promote_email_attachment_to_document(uuid, text, text, date, text, text)
from public;

revoke all
on function public.promote_email_attachment_to_document(uuid, text, text, date, text, text)
from anon;

grant execute
on function public.promote_email_attachment_to_document(uuid, text, text, date, text, text)
to authenticated;
