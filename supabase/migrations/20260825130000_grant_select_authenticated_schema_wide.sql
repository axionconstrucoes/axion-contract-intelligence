-- ============================================================
-- 20260825130000_grant_select_authenticated_schema_wide.sql
--
-- Extensao deliberada do escopo minimo das migrations anteriores
-- (20260825100000 e 20260825100500), documentada aqui em vez de
-- silenciosa: ao validar as Tarefas 4 e 5 (matriz de permissoes,
-- pipeline de e-mail) o MESMO gap de GRANT ausente (RLS + policy de
-- SELECT, sem o GRANT explicito correspondente para authenticated —
-- ver a explicacao completa em 20260825100000) reapareceu
-- repetidamente, em praticamente toda tabela nova do schema.
--
-- Confirmado por auditoria (consulta abaixo, rodada no banco local):
--   select c.relname
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r'
--     and c.relrowsecurity = true
--     and not has_table_privilege('authenticated', c.oid, 'SELECT');
-- retornou 53 tabelas — todas com RLS habilitado e pelo menos uma
-- policy de SELECT ja escrita e funcionando, apenas sem o GRANT
-- SELECT que permite a policy ser alcancada.
--
-- Por que conceder de uma vez, em vez de tabela por tabela conforme
-- cada teste tropeca no gap (como as duas migrations anteriores
-- fizeram): o padrao e claramente ambiental, nao uma decisao de
-- design por tabela — o projeto Supabase hospedado (usado por este
-- app em producao/dev remoto) recebe GRANT SELECT/INSERT/UPDATE/
-- DELETE em anon/authenticated/service_role automaticamente na
-- criacao da plataforma (fora de qualquer migration versionada); um
-- `supabase start`/`db reset` local nao reproduz esse bootstrap. Sem
-- este GRANT amplo, cada nova tabela criada localmente ficaria
-- inacessivel para authenticated ate alguem lembrar de adicionar o
-- GRANT individualmente — o que already aconteceu (ver historico:
-- document_version_files foi a unica tabela recente que recebeu o
-- GRANT junto da sua propria migration; todas as outras 53 nao).
--
-- Isto NAO enfraquece RLS: cada uma das 53 tabelas mantem suas
-- policies de SELECT linha-a-linha inalteradas — o GRANT so permite
-- que a consulta alcance a avaliacao da policy (exatamente a mesma
-- garantia documentada em 20260825100000). Nada e concedido a anon.
-- Nenhum INSERT/UPDATE/DELETE e concedido aqui — ver excecao pontual
-- abaixo (event_notes), com necessidade comprovada por teste.
-- ============================================================

grant select on public.action_request_assignees to authenticated;
grant select on public.action_request_responses to authenticated;
grant select on public.action_requests to authenticated;
grant select on public.additional_proposal_drive_sources to authenticated;
grant select on public.ai_curation_runs to authenticated;
grant select on public.ai_findings to authenticated;
grant select on public.clause_extraction_candidates to authenticated;
grant select on public.clauses to authenticated;
grant select on public.contract_change_action_requests to authenticated;
grant select on public.contract_change_events to authenticated;
grant select on public.contract_change_evidence to authenticated;
grant select on public.contract_changes to authenticated;
grant select on public.contract_events to authenticated;
grant select on public.corporate_policy_terms to authenticated;
grant select on public.document_extractions to authenticated;
grant select on public.document_text_segments to authenticated;
grant select on public.email_accounts to authenticated;
grant select on public.email_attachments to authenticated;
grant select on public.email_thread_event_candidate_emails to authenticated;
grant select on public.email_thread_event_candidates to authenticated;
grant select on public.email_triage_results to authenticated;
grant select on public.emails to authenticated;
grant select on public.esg_obligation_evidence to authenticated;
grant select on public.esg_obligation_submissions to authenticated;
grant select on public.esg_obligations to authenticated;
grant select on public.event_ai_assessments to authenticated;
grant select on public.event_categories to authenticated;
grant select on public.event_clause_confrontation_candidates to authenticated;
grant select on public.event_cross_references to authenticated;
grant select on public.event_evidence to authenticated;
grant select on public.event_notes to authenticated;
grant select on public.notification_email_deliveries to authenticated;
grant select on public.notification_recipients to authenticated;
grant select on public.notifications to authenticated;
grant select on public.project_additional_proposal_links to authenticated;
grant select on public.project_additional_proposals to authenticated;
grant select on public.project_email_ingestion_configs to authenticated;
grant select on public.project_email_ingestion_domains to authenticated;
grant select on public.project_email_ingestion_mailboxes to authenticated;
grant select on public.project_email_ingestion_participants to authenticated;
grant select on public.project_email_ingestion_sync_runs to authenticated;
grant select on public.project_integrations to authenticated;
grant select on public.project_packages to authenticated;
grant select on public.project_relevance_identifiers to authenticated;
grant select on public.schedule_activities to authenticated;
grant select on public.schedule_versions to authenticated;
grant select on public.sla_action_escalations to authenticated;
grant select on public.sla_actions to authenticated;
grant select on public.sla_area_responsibles to authenticated;
grant select on public.sla_matrix_rules to authenticated;
grant select on public.sla_project_settings to authenticated;
grant select on public.timeline_exports to authenticated;
grant select on public.user_policy_acknowledgement_emails to authenticated;
grant select on public.user_policy_acknowledgements to authenticated;

-- ------------------------------------------------------------
-- event_notes: tambem precisa de INSERT para authenticated.
-- Necessidade comprovada diretamente (Tarefa 4, teste "Colaborador
-- consegue criar anotacao"): a policy
-- "event_notes_insert_editor_self_authored" ja exige
-- has_project_permission(..., 'EDITOR') E author_user_id = auth.uid()
-- — sem o GRANT INSERT de base, a tentativa falha com "permission
-- denied for table event_notes" em vez de ser avaliada pela policy.
-- Nenhum UPDATE/DELETE concedido: event_notes nao tem policy para
-- essas operacoes (anotacoes sao append-only pela UI atual).
-- ------------------------------------------------------------

grant insert on public.event_notes to authenticated;
