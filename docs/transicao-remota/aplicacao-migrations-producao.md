# Aplicação das migrations em produção (27/10/2026) e reversão

> Projeto Supabase de produção (o mesmo usado por `acc.axion.com.br`): `plbcvwostmdmdmrziwmd`
> (nome no painel termina em "-dev", mas é o projeto que o site em produção consulta; confirmado pelo código
> público entregue pelo site). Nenhuma credencial neste documento.

## 1. O que foi feito

1. **Backup disponível antes da aplicação:** backups físicos diários do Supabase (7 retidos; o mais recente de
   26/10/2026 08:19 UTC). PITR **desativado**. Cópias adicionais, fora do repositório, em
   `~/acc-recuperacao-producao/`: esquema `public` (sem dados) e o histórico de migrations anterior ao reparo.
2. **Histórico alinhado ao repositório** (só a tabela `supabase_migrations.schema_migrations`; nenhum dado nem
   esquema): as versões abaixo existiam no remoto com outro número e conteúdo equivalente (diferenças só em
   `COMMENT ON` e num seed de assunto de e-mail que o remoto não tem).

   | Remoto (revertida no histórico) | Repositório (marcada como aplicada) |
   |---|---|
   | 20261010215929 `email_full_body_storage` | 20261010220000 |
   | 20261010225024 `email_inline_images` | 20261010224500 |
   | 20261010235634 `email_project_scope_status` + 20261010235900 `filter_email_registry_in_scope` | 20261011003000 `email_project_scope_filter` |
   | 20261011010403 `email_ingestion_configurable_project_scope` | 20261011011500 |
   | 20261011011035 `email_project_scope_admin` | 20261011014500 |

3. **Aplicadas, nesta ordem (`supabase db push`)**: `20261014190000` (a função `create_project_workspace` já
   existia em produção com corpo idêntico, então foi um `create or replace` sem efeito), `20261027120000`,
   `…130000`, `…140000`, `…150000`, `…160000`, `20261028120000`, `20261028130000`.
4. **Verificação posterior (leitura):** 117 versões sem divergência com o repositório; 9 tabelas novas com RLS
   ligada e vazias; 16 funções `SECURITY DEFINER` com `search_path` vazio; bucket `project-documents` privado,
   aceita `image/jpeg` e `image/png` (limite 50 MB), o que atende as fotos do SSMA.

Todas as migrations são **aditivas** (tabelas, índices, funções, triggers, políticas novas). Nenhuma remove ou
altera dados ou colunas existentes, e o código anterior de produção não as usa.

## 2. Como reverter

**Preferível:** não reverter; as estruturas novas não afetam o código anterior. Se for necessário:

- **Reversão lógica (remove só o que foi criado, em ordem inversa).** Executar em transação, no SQL Editor:

```sql
begin;
-- SSMA
drop table if exists public.ssma_corrective_action_events, public.ssma_corrective_actions,
  public.ssma_field_record_photos, public.ssma_field_records cascade;
drop policy if exists "ssma_field_storage_insert" on storage.objects;
drop function if exists public.can_upload_ssma_field_photo_object(text);
drop function if exists public.ssma_field_record_submit(uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz,text,uuid,date);
drop function if exists public.ssma_field_record_register_photo(uuid,uuid,uuid,text,text,text,text,bigint,text);
drop function if exists public.ssma_corrective_action_update(uuid,text,text,uuid);
-- classificação de risco
drop trigger if exists project_delivery_items_log_risk_change on public.project_delivery_items;
drop function if exists public.project_delivery_items_log_risk_change();
drop function if exists public.review_risk_classification(text, uuid, text, text, text, jsonb);
drop table if exists public.risk_classification_reviews cascade;
drop function if exists public.risk_classification_reviews_immutable();
-- providências e alertas
drop trigger if exists project_delivery_items_log_end_date_change on public.project_delivery_items;
drop function if exists public.project_delivery_items_log_end_date_change();
drop function if exists public.delivery_item_respond(uuid, text, uuid, text, text);
drop function if exists public.save_contract_alert_batch_item_response(uuid, uuid, text, uuid);
drop table if exists public.project_delivery_item_events, public.project_delivery_items cascade;
drop function if exists public.delivery_items_seed_checklist(uuid), public.delivery_item_add_custom(uuid, text, text),
  public.delivery_item_update_fields(uuid, jsonb), public.delivery_item_change_status(uuid, text, text, text),
  public.project_delivery_items_set_updated_at();
drop table if exists public.alert_followup_events, public.alert_followups cascade;
drop function if exists public.alert_followup_open(uuid, text, uuid, text, uuid, timestamptz),
  public.alert_followup_claim_due(integer, timestamptz), public.alert_followup_mark_sent(uuid, uuid, timestamptz, timestamptz),
  public.alert_followup_mark_failed(uuid, uuid, text, timestamptz), public.alert_followup_release(uuid, uuid),
  public.alert_followup_apply_action, public.alert_followups_set_updated_at();
commit;
```

  Depois, no terminal: `supabase migration repair --linked --status reverted 20261014190000 20261027120000 20261027130000 20261027140000 20261027150000 20261027160000 20261028120000 20261028130000`.
  Confira antes os nomes exatos das funções no esquema (`pg_proc`) e se `save_contract_alert_batch_item_response`
  tinha uma versão anterior em produção: nesse caso restaure a definição anterior em vez de apagá-la (a cópia do
  esquema anterior está em `~/acc-recuperacao-producao/prod-public-schema.sql`).
- **Reversão do histórico alinhado:** `supabase migration repair --linked --status reverted <versões do repositório>`
  e `--status applied <versões do remoto>` (tabela do item 2 acima, sentido inverso).
- **Desastre:** restaurar o backup diário pelo painel do Supabase (Database → Backups). Isso substitui o banco
  inteiro e perde tudo o que foi gravado depois do backup (até ~24 h, pois não há PITR). Última opção.
