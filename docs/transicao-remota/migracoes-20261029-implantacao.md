# Migrations de 29/10/2026 — lease da outbox e auditoria do worker (ordem de implantação)

> **Nada foi aplicado em nenhum banco remoto.** Este documento descreve o que cada migration faz, a ordem segura de
> implantação e como verificar/reverter. A aplicação em produção exige autorização expressa.

## O que cada migration faz

| Migration | Mudança | Tipo |
|---|---|---|
| `20261029100000_risk_alert_outbox_send_claim.sql` | `alter table public.risk_alert_outbox add column if not exists claimed_at timestamptz` | **Aditiva**, idempotente; sem novo status, sem mudança de constraint, sem backfill |
| `20261029110000_sla_action_audit_service_role_actor.sql` | `create or replace function public.audit_sla_action_updated()` — ator de `ACTION_STARTED`/`ACTION_REASSIGNED` quando `auth.uid()` é nulo | Troca de função (mesmo nome/assinatura/gatilho), idempotente |

## Por que existem

1. **Lease (`claimed_at`)** — a reivindicação anterior só comparava `attempt_count`. Um segundo ciclo que começa *depois* que o
   primeiro reivindicou, mas antes de ele terminar o envio, reivindicava a mesma linha e enviava em duplicidade. A coluna
   permite um *lease*: só um ciclo envia, e um ciclo que morreu no meio libera a linha quando o lease (10 min) expira.
2. **Auditoria do worker** — o worker (service role) aplica ações de resposta por e-mail via `record_risk_alert_action`;
   sem `auth.uid()`, a auditoria `ACTION_STARTED`/`ACTION_REASSIGNED` violava `audit_log_entries_check` e a transação inteira
   falhava (a resposta caía em revisão humana).

## Compatibilidade código × migration

| Código | Migration ausente | Migration presente |
|---|---|---|
| **Anterior** (PR #124) | funciona como hoje | funciona (a coluna nova é ignorada; as telas leem a outbox com colunas explícitas) |
| **Novo** (este PR) | **falha fechada**: a reivindicação falha e **nada é enviado** (nenhum duplicado; as linhas ficam `PENDING` e são enviadas depois da migration) — provado em `test:staging-seed` G2 | funciona |

Consequência: **aplicar `20261029100000` ANTES de publicar o código novo** (ou imediatamente depois, aceitando o intervalo sem envio).
A migration de auditoria é independente; sem ela, apenas as respostas por e-mail que viram "TOMANDO PROVIDÊNCIAS" / "ENVIAR P/" seguem
caindo em revisão humana (comportamento atual).

## Ordem recomendada

1. Homologação: aplicar as duas migrations (roteiro `fase-b-roteiro-homologacao.md`), conferir com as consultas abaixo e repetir o ciclo.
2. Produção (**somente com autorização**): `20261029100000` → `20261029110000` → publicar o código. Fora de horário de ciclo (os ciclos são horários; o consolidado é na quarta, 07:00 local).
3. Depois: um ciclo manual `?dryRun=1` e acompanhar `attempt_count`/`claimed_at`.

## Verificações (somente leitura)

```sql
-- coluna criada, sem lease preso
select column_name from information_schema.columns where table_name = 'risk_alert_outbox' and column_name = 'claimed_at';
select count(*) as leases_vigentes from public.risk_alert_outbox where claimed_at is not null;      -- esperado ~0 entre ciclos
select status, count(*) from public.risk_alert_outbox group by status order by 1;
-- função de auditoria atualizada
select pg_get_functiondef('public.audit_sla_action_updated()'::regprocedure) like '%v_started_actor%' as atualizada;
```

## Reversão

- Lease: reverter o código para a versão anterior **antes** de qualquer remoção; depois, se necessário, `alter table public.risk_alert_outbox drop column claimed_at;` (a coluna é nula e não é referenciada pelo código anterior).
- Auditoria: reaplicar a definição de `audit_sla_action_updated()` de `20260822060313_fix_system_actor_audit_label.sql` (com ela, respostas do worker voltam a falhar na auditoria).
- Não há dados a restaurar: nenhuma das migrations altera linhas existentes.

## Testes que cobrem

- `test:alert-sim` (G5/G5b, H1b, H4): lease em ciclos escalonados, predicado SQL.
- `test:sql` → `test-sla-audit-service-role-sql.mjs`: auditoria (worker, usuário, reatribuição); 4 verificações falham sem a migration.
- `test:staging-seed` (branch de homologação) G1–G3: ordem código/migration, preservação de dados, idempotência.
