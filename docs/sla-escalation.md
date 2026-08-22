# Matriz de Criticidade, SLA e Escalonamento

Este documento descreve a arquitetura da matriz configurável de
criticidade, prazos internos de resposta (SLA) e escalonamento
automático do ACC. Base para o futuro MANUAL PDF A4 retrato e
PowerPoint executivo.

## 1. Fluxo de escalonamento

```
RESPONSÁVEL → 1º ESCALÃO → 2º ESCALÃO → DIRETORIA
```

Uma ação sobe de nível quando o tempo sem ação (Relógio C, seção 3)
ultrapassa o configurado — nunca por decisão de IA (seção 10).

## 2. Matriz DEFAULT (seção 2 do requisito)

Valores exatos, usados quando um projeto ainda não configurou sua
própria regra (`apps/web/lib/sla/default-matrix.ts`):

| Risco | Prazo assumir | Até 2º escalão | Até Diretoria | Unidade |
| --- | --- | --- | --- | --- |
| BAIXO | 3 | +3 | +2 | dias úteis |
| MÉDIO | 1 | +1 | +1 | dias úteis |
| ALTO | 4 | +4 | +4 | horas úteis |
| CRÍTICO | 1 | +1 | +2 | horas corridas |

CRÍTICO usa horas **corridas** (não úteis) — o requisito descreve "1
hora"/"até 2 horas" sem o qualificador "útil" usado explicitamente para
BAIXO/MÉDIO/ALTO; risco crítico não deveria esperar o expediente.
Prazos de "responder"/"concluir" não são especificados na seção 2 —
ficam `null` nos defaults, nunca inventados.

**Cada projeto pode alterar tudo isso** em
`/[projectId]/acoes/configuracao` (seção 17) — as linhas gravadas em
`sla_matrix_rules` sempre têm prioridade sobre o default.

## 3. Três relógios distintos (seção 3)

| Relógio | Campo | O que mede |
| --- | --- | --- |
| A — Prazo contratual | `sla_actions.contractual_deadline` | Prazo do contrato/aditivo/notificação — nunca confundido com o SLA interno |
| B — SLA interno ACC | `assume_due_at` / `respond_due_at` / `complete_due_at` | Três prazos independentes, calculados uma única vez na criação a partir da matriz resolvida (nunca recalculados "para trás" se a matriz mudar depois) |
| C — Escalonamento | `escalation_2_after_value` / `board_after_value` da matriz | Tempo SEM AÇÃO necessário para subir de nível — contado a partir do checkpoint do Relógio B que venceu, não de `created_at` |

## 3.1. Timezone e horário útil

**Correção aplicada antes da publicação**: a primeira versão calculava
`BUSINESS_HOURS`/`BUSINESS_DAYS` com segunda-a-sexta 08:00–18:00
hardcoded em **UTC** — isso geraria escalonamentos incorretos para
projetos no Brasil (às 17:30 em São Paulo já são 20:30 UTC, fora da
janela 08:00–18:00 UTC, o que faria o motor tratar qualquer tarde
brasileira como "fora do expediente").

- **Timezone**: `apps/web/lib/sla/time-units.ts` usa `Intl.DateTimeFormat`
  (ICU, já disponível no runtime) para converter corretamente entre o
  instante UTC armazenado e o horário de parede na timezone configurada
  — nunca um offset fixo calculado manualmente. Isso cobre corretamente
  qualquer timezone IANA real, inclusive transições de horário de verão
  (testado explicitamente com `America/New_York`, embora
  `America/Sao_Paulo` não tenha DST desde 2019).
- **Default institucional**: `AXION_DEFAULT_BUSINESS_HOURS_CONFIG` =
  `America/Sao_Paulo`, 08:00–18:00 — nunca UTC como horário comercial.
- **Configuração por projeto**: tabela `sla_project_settings` (1:1 com
  `projects`), com `timezone` (identificador IANA), `business_day_start_hour`
  e `business_day_end_hour`. Configurável em `/[projectId]/acoes/configuracao`
  (ADMIN); `resolveBusinessHoursConfig()` usa a configuração do projeto
  quando existir, senão cai no default institucional — nunca inventa um
  valor.
- **Datas continuam em UTC no banco** (`timestamptz`) — só o *cálculo*
  de início/fim de expediente, horas úteis, dias úteis, vencimento e
  escalonamento passou a considerar a timezone configurada. `CLOCK_HOURS`
  e `CALENDAR_DAYS` permanecem deliberadamente independentes de
  timezone/horário comercial (uma hora corrida é uma hora corrida em
  qualquer fuso).
- **Fim de semana**: sábado e domingo nunca são dias úteis, em nenhuma
  timezone.
- **Feriados**: **não implementados nesta versão** — nem nacionais, nem
  regionais, nem municipais. O sistema nunca finge considerá-los; a UI
  de configuração mostra explicitamente "Feriados ainda não são
  considerados nesta versão." Uma evolução futura poderá integrar um
  calendário corporativo/regional real.

## 4. Arquitetura — o que já existia vs. o que foi criado

Antes de qualquer migration, mapeou-se `action_requests` (fundação
existente): modela "solicitação + resposta" (canal APP/EMAIL, assignees
N:N, resposta como entidade própria) — sem risco, área, escalonamento,
nível hierárquico nem os três relógios exigidos aqui. **Não é
"estrutura adequada"** para este requisito (a seção 6 só manda
reaproveitar *se* já houver estrutura adequada), então uma nova entidade
foi criada — mas com um vínculo opcional
(`sla_actions.related_action_request_id`) para quando uma Ação SLA
nascer de uma ActionRequest existente, nunca duplicando os dados dela.
Da mesma forma, `related_event_id`/`related_document_version_id`/
`related_esg_obligation_submission_id` reaproveitam
`contract_events`/`document_versions`/`esg_obligation_submissions` já
existentes — nenhum sistema de evidência novo foi criado.

Cinco tabelas novas
(`supabase/migrations/20260822054900_sla_escalation_foundation.sql` +
`20260822123400_sla_project_settings.sql`, esta última adicionada na
correção de timezone):

| Tabela | Papel |
| --- | --- |
| `sla_area_responsibles` | Área → Responsável Direto → 1º Escalão → 2º Escalão → Diretoria (seção 4) |
| `sla_matrix_rules` | Matriz configurável por projeto (+ opcionalmente por área) (seção 2/5) |
| `sla_actions` | A Ação/Tarefa sujeita à matriz (seção 6/7) |
| `sla_action_escalations` | Histórico append-only de cada transição de nível (seção 10) |
| `sla_project_settings` | Timezone + horário útil configurados por projeto (seção 3.1) |

RLS via `is_project_member`/`has_project_permission` (mesmos helpers de
sempre); auditoria via trigger `SECURITY DEFINER` (mesmo padrão de
`event_notes_foundation.sql`/`esg_obligations_foundation.sql`).

## 5. Responsáveis por área e escalão (seção 4)

`sla_area_responsibles`, uma linha por (projeto, área). As nove áreas
do requisito: DIRETORIA, ADMINISTRATIVO, COMERCIAL, FINANCEIRO,
ENGENHARIA, ORÇAMENTO, JURÍDICO, PLANEJAMENTO, ESG/SSMA. Cada nível
(direto/1º/2º/diretoria) é opcional — nem todo projeto/área terá os
quatro definidos; a ausência é tratada honestamente (nunca inventa um
responsável). Configurável em `/[projectId]/acoes/configuracao`.

## 6. Ação/Tarefa (`sla_actions`)

Todos os campos pedidos na seção 6 (`projectId`, `origem`, `título`,
`descrição`, `riskLevel`, `responsável`, `área`, `createdAt`, `dueAt`
[como três prazos, ver seção 3], `acknowledgedAt`, `completedAt`,
`currentEscalationLevel`, `status`, `contractualDeadline`, vínculos a
evidência/evento/documento). `origin` inclui `EXPERT_RECOMMENDATION`
(seção 14) com `originExpertId` — nunca inventado, `null` para qualquer
outra origem.

### Status (seção 7)

`PENDING`, `ACKNOWLEDGED`, `IN_PROGRESS`, `COMPLETED`, `OVERDUE`,
`ESCALATED`, `CANCELLED` — exatamente como pedido. Não reaproveita
`action_requests.status` (`OPEN`/`CLOSED`/`CANCELLED`, granularidade
insuficiente) nem nenhum enum de ESG — nenhuma duplicação, é um domínio
genuinamente novo.

## 7. Assumir / Concluir (seção 8/9)

- **"ASSUMIR AÇÃO"**: grava `acknowledged_at`/`acknowledged_by_user_id`,
  status vira `ACKNOWLEDGED`. Interrompe *apenas* o SLA de assumir — o
  prazo de conclusão continua correndo, exatamente como pedido.
- **"CONCLUIR AÇÃO"**: grava `completed_at`/`completed_by_user_id`/
  `completion_note`. `completion_note` é **sempre obrigatório**
  (constraint de banco) quando `completed_at` é preenchido — mínimo
  seguro que cobre a recomendação da seção 9 ("considerar exigir
  evidência ou comentário para ALTO/CRÍTICO") sem bloquear risco
  BAIXO/MÉDIO por uma exigência que pode não fazer sentido para toda
  ação. "Evidência" quando aplicável é sempre uma referência a algo que
  já existe (`related_event_id`/`related_document_version_id`) — nenhum
  novo sistema de upload foi criado para isto.

## 8. Escalonamento automático (seção 10/11)

`apps/web/lib/sla/compute-escalation.ts` — puro, determinístico, `now`
sempre injetado pelo caller. Nunca decide via IA se um prazo expirou.

Ordem dos checkpoints do Relógio B (o primeiro que se aplica vira a base
de contagem do Relógio C):

1. Não assumida até `assume_due_at` → `NO_ACKNOWLEDGMENT`
2. Assumida, `complete_due_at` vencido → `NOT_COMPLETED`
3. Assumida, `respond_due_at` vencido (sem `complete_due_at`) → `NOT_RESPONDED`

Gatilhos adicionais e independentes (seção 11): `CONTRACTUAL_DEADLINE_NEAR`
(≤ 24h, força ao menos 1º escalão), `CONTRACTUAL_DEADLINE_MISSED` (força
ao menos 2º escalão), `NEW_EVIDENCE_INCREASED_RISK` (sinal externo,
informado pelo caller — nunca inferido automaticamente pelo motor, força
ao menos 1º escalão).

### `escalate_sla_action` (RPC, único caminho para subir de nível)

Concorrência otimista: `p_expected_current_level` precisa bater com o
nível atual da ação, senão a chamada falha sem efeito — é isso que
impede escalonamento duplicado quando a varredura roda mais de uma vez
sobre a mesma ação. `current_escalation_level` é protegido contra
`UPDATE` direto por um trigger (`protect_sla_action_escalation_level`)
que só libera a mudança quando a própria RPC autoriza via
`set_config('acc.allow_escalation_update', ...)`.

### Disparo (limitação atual — seção 20/"Limitações")

Não existe agendador (cron) real nesta base de código. O motor roda sob
demanda: qualquer membro do projeto pode clicar "Verificar
escalonamentos" (`/[projectId]/acoes`, `processSlaEscalationsAction`),
que varre as ações abertas do projeto, calcula o nível recomendado e
aplica via `escalate_sla_action` — isso é aritmética de data, nunca uma
decisão privilegiada. A varredura automática por temporizador fica como
extensão futura (`FUTURE_SOURCE`).

## 9. E-mails de escalonamento (seção 12/13)

Mesmo padrão institucional ACC já implementado (branding + assunto +
badges — ver `docs/email-branding.md`):
`apps/web/lib/email/templates/sla-escalation-template.ts` reaproveita
`buildContractAlertSubject`/`alertRiskLevelLabels` (nunca duplica o
assunto/rótulo). Enviado por
`apps/web/lib/email/send-sla-escalation-email.ts`, chamado somente por
`processSlaEscalationsAction` — **nunca por um Expert**.

Distinção de governança (seção 13):

```
IA sugere ação (seção 14)
  → Motor ACC aplica a regra de SLA configurada (determinístico)
  → E-mail de escalonamento pode sair automaticamente (autorizado pelo sistema)
Humano decide conteúdo/ação quando uma decisão de fato é necessária
```

`sendContractAlertEmail` (turno anterior) exige confirmação humana
explícita porque o CONTEÚDO é uma decisão; `sendSlaEscalationEmail` é
disparado automaticamente pelo motor porque a autorização já é a regra
de SLA configurada por um ADMIN — nunca um Expert decidindo enviar algo.

## 10. Escalonamento e Experts (seção 14)

Um Expert (Diretor Comercial IA, Diretor de ESG IA, e os futuros
Consultor Jurídico IA/Diretor de Planejamento IA) pode gerar uma
recomendação que **origina** uma `sla_actions` com
`origin = 'EXPERT_RECOMMENDATION'` e `origin_expert_id` preenchido —
mas a partir daí a ação fica inteiramente sujeita à matriz de SLA, como
qualquer outra. Nenhum Expert tem acesso a `completeSlaActionAction`/
`escalate_sla_action`/`sendSlaEscalationEmail` — só humanos (via
Server Action autenticada) ou o motor determinístico.

## 11. CEO IA (seção 15)

Não implementado nesta fase, por instrução explícita. O que o CEO IA
precisará no futuro já é uma consulta direta e honesta sobre dados reais
já modelados aqui: riscos ALTO/CRÍTICO (`sla_actions.risk_level`),
tarefas vencidas (`status = 'OVERDUE'`), itens escalados à Diretoria
(`current_escalation_level = 'DIRETORIA'`) — nenhuma tabela nova será
necessária quando essa fase chegar.

## 12. Interface (seção 16/17)

`/[projectId]/acoes` — "Ações e Escalonamentos": ações abertas
(assumir/iniciar/concluir/reatribuir), visão gerencial (filtros por
risco/status/área/responsável/escalão, checkboxes, sem excesso de
informação) e histórico. `/[projectId]/acoes/configuracao` (ADMIN) —
"Matriz de SLA e Escalonamento": tabela editável RISCO → prazos → tempo
até 2º escalão/Diretoria, e os responsáveis por área/escalão.

## 13. Auditoria (seção 18)

`ACTION_CREATED`, `ACTION_ACKNOWLEDGED`, `ACTION_STARTED`,
`ACTION_COMPLETED`, `ACTION_OVERDUE`, `ACTION_ESCALATED`,
`ACTION_REASSIGNED`, `SLA_CONFIGURATION_UPDATED` — todos via trigger
`SECURITY DEFINER`, nunca com o conteúdo integral da ação no log.
`ACTION_ESCALATED` é sempre atribuído ao motor (`actor_type = 'SYSTEM'`,
`actor_user_id`/`actor_label` sempre `null` — ver "Bug corrigido"
abaixo), nunca a um usuário específico.

## 14. RLS (seção 19)

- **Ler**: qualquer membro do projeto.
- **Criar ação**: EDITOR/ADMIN, autoautoria.
- **Assumir/concluir**: o próprio responsável (EDITOR) OU ADMIN.
- **Reatribuir**: ADMIN.
- **Configurar matriz/responsáveis**: ADMIN.
- **Escalonar**: só via `escalate_sla_action` (RPC) — nenhuma policy de
  UPDATE direto permite mudar `current_escalation_level`. Nenhum Expert
  usa `service_role` para simular usuário.

## 15. Limitações de calendário (seção 20)

Não existe calendário corporativo de feriados nesta fase. "Dia
útil"/"hora útil" (`apps/web/lib/sla/time-units.ts`) consideram apenas
segunda a sexta, **no horário e timezone configurados do projeto**
(default `America/Sao_Paulo`, 08:00–18:00 — ver seção 3.1; nunca UTC
como horário comercial) — feriados nacionais/regionais/municipais
**não** são descontados. Isso é um comportamento mínimo seguro,
documentado explicitamente na UI de configuração ("Feriados ainda não
são considerados nesta versão."), não uma simulação de um calendário
completo que não existe. Um calendário de feriados real fica como
extensão futura.

## 16. Bug corrigido durante a implementação

`audit_log_entries` exige `actor_label IS NULL` quando
`actor_type = 'SYSTEM'` (constraint de `audit_foundation.sql`). Três
funções (`audit_sla_action_updated`, `escalate_sla_action`, e a
já commitada `review_esg_obligation_submission` da fase ESG) inseriam um
`actor_label` descritivo (`'sla-engine'`/`'esg_obligations'`) junto com
`actor_type = 'SYSTEM'`, violando a constraint — a operação inteira
falhava (nenhum escalonamento real e nenhum evento ESG de não-cumprimento
chegavam a ser aplicados). Descoberto por `scripts/test-sla-escalation.mjs`,
corrigido via `CREATE OR REPLACE FUNCTION` em
`20260822060313_fix_system_actor_audit_label.sql` (a migration ESG
original, já commitada em turno anterior, nunca foi editada em
retrospecto). Verificado manualmente contra o branch antes quebrado
(`NAO_CUMPRIDO` → criação de `contract_event`), com limpeza completa dos
dados de verificação.
