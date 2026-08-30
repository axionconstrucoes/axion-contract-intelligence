-- ============================================================
-- 20260830100000_close_security_definer_search_path_gaps.sql
--
-- Fecha o achado de auditoria de 2026-08-30: 38 funções
-- SECURITY DEFINER já aplicadas no remoto (via migrations
-- históricas anteriores) com `search_path = public` (ou
-- `public, storage`), herdado do default `ALTER FUNCTION ...
-- SET search_path` implícito de cada `CREATE FUNCTION` — nunca
-- corrigido explicitamente até agora.
--
-- Confirmado por auditoria estática (scripts/sql/run-security-
-- definer-search-path-audit.mjs) que as 38 funções já usam
-- exclusivamente referências qualificadas com `public.` em todo
-- o corpo (zero SQL dinâmico, zero referência não qualificada) —
-- portanto a correção é só `ALTER FUNCTION ... SET search_path
-- = ''`, sem `CREATE OR REPLACE` e sem qualquer mudança de
-- lógica.
--
-- Adicionalmente, restringe a ACL de 21 funções cujo grant de
-- EXECUTE é mais amplo do que o uso legítimo:
--   - 20 funções trigger (nunca chamadas diretamente por nenhum
--     papel, só disparadas pelo próprio Postgres) — revoga
--     PUBLIC/anon/authenticated/service_role, mantém só postgres
--     (owner, dono do trigger).
--   - register_document_version_file — auditoria de código e
--     histórico Git confirmou ZERO chamador em qualquer lugar
--     (nem frontend, nem scripts, nem outra função SQL); revoga
--     anon e authenticated, mantém só postgres/service_role.
--
-- Nenhuma migration histórica é editada. Nenhuma função é
-- recriada (owner, SECURITY DEFINER e corpo permanecem
-- byte-idênticos). Cada assinatura é validada antes de qualquer
-- alteração — a migration inteira falha e não aplica nada
-- parcialmente se uma assinatura esperada não existir.
--
-- NOTA: escalate_sla_action recebe aqui SOMENTE o ajuste de
-- search_path. A correção do problema de autorização (papéis
-- abaixo de GESTOR/GERENTE conseguindo escalar) é tratada em
-- migration separada: 20260830100500_restrict_sla_escalation_to_
-- project_managers.sql — mudança de lógica, não de search_path/ACL.
-- ============================================================

begin;

-- ---------- 1. search_path = '' nas 38 funções ----------
-- Cada assinatura é validada via to_regprocedure antes de
-- qualquer ALTER; se qualquer uma não existir, a exceção aborta
-- a transação inteira (nada é aplicado parcialmente).

do $$
declare
  v_signatures text[] := array[
    -- 20 funções trigger
    'public.audit_additional_proposal_created()',
    'public.audit_additional_proposal_linked()',
    'public.audit_additional_proposal_updated()',
    'public.audit_ai_finding_created()',
    'public.audit_ai_finding_status_changed()',
    'public.audit_esg_obligation_created()',
    'public.audit_esg_obligation_evidence_created()',
    'public.audit_esg_obligation_submission_created()',
    'public.audit_event_clause_confrontation_candidate_created()',
    'public.audit_event_note_created()',
    'public.audit_project_startup_transitions()',
    'public.audit_sla_action_created()',
    'public.audit_sla_action_updated()',
    'public.audit_sla_configuration_updated()',
    'public.audit_timeline_export_created()',
    'public.sync_document_version_principal_file()',
    'public.validate_esg_evidence_same_project()',
    'public.validate_esg_obligation_same_project()',
    'public.validate_esg_submission_same_project()',
    'public.validate_event_clause_same_project()',
    -- 18 funções RPC
    'public.disconnect_email_account(uuid)',
    'public.escalate_sla_action(uuid, text, text, text)',
    'public.is_unregistered_project_document_object(text)',
    'public.promote_email_attachment_to_document(uuid, text, text, date, text, text)',
    'public.register_clause_extraction_candidate(uuid, uuid, text, text, text, numeric, text, text, text, integer, text)',
    'public.register_document_version_file(uuid, text, text, text, text, bigint, text, text, text, uuid)',
    'public.register_email_account(text, text)',
    'public.register_email_thread_event_candidate(uuid, text, text, text, integer, text[], text, uuid[])',
    'public.register_email_triage_screening(uuid, text, boolean, text, integer, text[], jsonb)',
    'public.register_event_clause_confrontation_candidate(uuid, uuid, text, text, text, text, text, numeric, text, text, text)',
    'public.register_project_document_upload(uuid, uuid, uuid, text, text, text, date, text, text, text, text, text, text, bigint, text, text)',
    'public.review_clause_extraction_candidate(uuid, text, text, text, text, text)',
    'public.review_email_thread_event_candidate(uuid, text, text, text, text)',
    'public.review_esg_obligation_submission(uuid, text, text)',
    'public.review_event_clause_confrontation_candidate(uuid, text, text)',
    'public.save_integration_origin(uuid, text, text, text, text, text, text, text, text, text)',
    'public.save_project_email_ingestion_config(uuid, uuid, text, timestamptz, timestamptz, jsonb, jsonb, boolean, boolean)',
    'public.start_email_sync_run(uuid)'
  ];
  v_sig text;
  v_count integer := 0;
begin
  if array_length(v_signatures, 1) <> 38 then
    raise exception 'Lista de assinaturas esperada tem % elementos, esperado 38 — migration abortada.', array_length(v_signatures, 1);
  end if;

  foreach v_sig in array v_signatures loop
    if to_regprocedure(v_sig) is null then
      raise exception 'Assinatura esperada não encontrada no schema: % — migration abortada, nada aplicado.', v_sig;
    end if;
    v_count := v_count + 1;
  end loop;

  if v_count <> 38 then
    raise exception 'Validação de assinaturas incompleta (% de 38) — migration abortada.', v_count;
  end if;

  foreach v_sig in array v_signatures loop
    execute format('alter function %s set search_path = %L', v_sig, '');
  end loop;
end $$;

-- ---------- 2. Restringe ACL das 20 funções trigger ----------
-- Nunca chamadas diretamente por nenhum papel de aplicação — só
-- disparadas pelo próprio motor via trigger. Mantém apenas o
-- owner (postgres).

do $$
declare
  v_trigger_fns text[] := array[
    'public.audit_additional_proposal_created()',
    'public.audit_additional_proposal_linked()',
    'public.audit_additional_proposal_updated()',
    'public.audit_ai_finding_created()',
    'public.audit_ai_finding_status_changed()',
    'public.audit_esg_obligation_created()',
    'public.audit_esg_obligation_evidence_created()',
    'public.audit_esg_obligation_submission_created()',
    'public.audit_event_clause_confrontation_candidate_created()',
    'public.audit_event_note_created()',
    'public.audit_project_startup_transitions()',
    'public.audit_sla_action_created()',
    'public.audit_sla_action_updated()',
    'public.audit_sla_configuration_updated()',
    'public.audit_timeline_export_created()',
    'public.sync_document_version_principal_file()',
    'public.validate_esg_evidence_same_project()',
    'public.validate_esg_obligation_same_project()',
    'public.validate_esg_submission_same_project()',
    'public.validate_event_clause_same_project()'
  ];
  v_sig text;
begin
  foreach v_sig in array v_trigger_fns loop
    if to_regprocedure(v_sig) is null then
      raise exception 'Assinatura esperada não encontrada no schema: % — migration abortada.', v_sig;
    end if;
    execute format('revoke all on function %s from public', v_sig);
    execute format('revoke all on function %s from anon', v_sig);
    execute format('revoke all on function %s from authenticated', v_sig);
    execute format('revoke all on function %s from service_role', v_sig);
  end loop;
end $$;

-- ---------- 3. register_document_version_file: revoga anon e authenticated ----------
-- Auditoria de código/histórico confirmou zero chamador
-- legítimo em qualquer lugar (nem app, nem script, nem outra
-- função SQL). Mantém postgres (owner) e service_role, para uso
-- futuro server-side caso a feature seja conectada a um fluxo
-- real.

revoke all on function public.register_document_version_file(uuid, text, text, text, text, bigint, text, text, text, uuid) from anon;
revoke all on function public.register_document_version_file(uuid, text, text, text, text, bigint, text, text, text, uuid) from authenticated;

commit;
