# Comprovação de Obrigações ESG/SSMA + Diretor de ESG IA

Este documento descreve a arquitetura da Comprovação de Obrigações
ESG/SSMA do ACC e do Expert oficial "Diretor de ESG IA" (`esg-director`).

## 1. Escopo (deliberadamente estreito)

O foco é estritamente contratual:

```
OBRIGAÇÃO CONTRATUAL → PRAZO → COMPROVAÇÃO → EVIDÊNCIA → STATUS →
RISCO DE PENALIDADE → AÇÃO RECOMENDADA
```

**Fora de escopo nesta fase** (podem virar fases futuras, mas não fazem
parte deste lote): ESG corporativo genérico, sustentabilidade sem vínculo
contratual, programas sociais sem obrigação contratual, gestão ambiental
ampla não exigida pelo contrato, indicadores corporativos sem
consequência contratual, análise ampla de saúde ocupacional, gestão
operacional de segurança do trabalho, Lean/produção, processos de RH.

Uma obrigação só recebe atenção do Diretor de ESG IA quando seu
descumprimento pode gerar multa, penalidade, retenção, suspensão,
paralisação, atraso, custo adicional, responsabilização, perda de
direito, obrigação de comunicação ou risco de disputa.

## 2. Modelagem — o que já existia vs. o que foi criado

Antes de criar qualquer tabela, mapeou-se o que já existia:
`projects`, `contract_events`/`event_evidence`, `documents`/
`document_versions`, `clauses`, `event_notes`, `audit_log_entries`,
`project_memberships`, os helpers `is_project_member`/
`has_project_permission`, e o Storage (`project-documents`). Nada disso
foi duplicado.

Três entidades novas (migração
`supabase/migrations/20260822050000_esg_obligations_foundation.sql`):

| Tabela | Papel |
| --- | --- |
| `esg_obligations` | Item de checklist configurável por projeto — a obrigação em si |
| `esg_obligation_submissions` | Uma comprovação registrada para um período de referência |
| `esg_obligation_evidence` | Arquivos (fotos/documentos/planilhas) anexados a uma comprovação |

Evidências reaproveitam o bucket `project-documents` já existente e suas
policies de Storage (`20260821004108_project_document_upload_foundation.sql`)
— nenhuma policy nova de Storage foi necessária, só a convenção de path
`<projectId>/esg-evidence/<obligationId>/<submissionId>/<evidenceId>-<nome>`.

### `esg_obligations` (checklist)

Campos principais: `title`, `category` (DDS, INTEGRACAO_SEGURANCA,
TREINAMENTO, INSPECAO, RELATORIO, DOCUMENTACAO_TERCEIROS,
REGISTRO_ACIDENTE_INCIDENTE, DESTINACAO_RESIDUOS, COMPROVANTE_AMBIENTAL,
LICENCA, CERTIFICADO, PERMISSAO, ENTREGA_EPI, DOCUMENTO_CLIENTE,
FOTO_CAMPO, OUTRO), `periodicity` (UNICA, DIARIA, SEMANAL, QUINZENAL,
MENSAL, POR_EVENTO, POR_MARCO, PERSONALIZADA — só modelagem, nenhum
scheduler foi implementado), origem contratual (`source_document_version_id`
+ `clause_id` estruturados, OU `source_reference` em texto livre quando
não há cláusula extraída no sistema), `required_evidence_description`,
`penalty_description`, `responsible_label`/`responsible_user_id`. Cada
projeto tem seu próprio checklist — não existe uma lista global rígida.

### `esg_obligation_submissions` (comprovação)

Um registro por período/data de referência. `status` é um dos seis
valores exigidos: `CUMPRIDO`, `CUMPRIDO_PARCIALMENTE`, `PENDENTE`,
`NAO_CUMPRIDO`, `NAO_APLICAVEL`, `DISPENSADO`. Uma constraint de banco
exige `justification` preenchida quando o status é `NAO_APLICAVEL` ou
`DISPENSADO` — impossível contornar pela aplicação. Campos de DDS
(`tema`, `publico`, `numeroParticipantes`) vivem em `dds_details jsonb`
— deliberadamente flexível em vez de uma tabela paralela por categoria
("não é sistema completo de gestão de DDS").

`risk_level` é sempre calculado deterministicamente (seção 4) antes do
INSERT — nunca uma estimativa de IA.

### `esg_obligation_evidence`

Imutável (sem UPDATE/DELETE) — uma correção nunca sobrescreve uma
evidência anterior, sempre um novo arquivo (`replaces_evidence_id`
aponta para o que foi substituído, mas o anterior permanece intacto).
Preserva nome original, MIME type, tamanho, autor e vínculo à submissão/
obrigação/projeto.

## 3. RLS e permissões

Reaproveita integralmente `is_project_member`/`has_project_permission`
(nenhuma tabela/role nova). Mapeamento de papéis do requisito para os
níveis reais do sistema (`VIEWER`/`EDITOR`/`ADMIN`):

- **Técnico de Segurança / responsável autorizado** = `EDITOR` no
  projeto — pode configurar o checklist, preencher comprovações e
  anexar evidências (sempre autoautoria: `filled_by_user_id`/
  `uploaded_by_user_id` = `auth.uid()`, impersonação bloqueada pela RLS).
- **Revisão/ajuste de status** = `ADMIN` — via a RPC
  `review_esg_obligation_submission` (`SECURITY DEFINER`), nunca por
  UPDATE direto do usuário comum (não há policy UPDATE para
  `esg_obligation_submissions` fora da RPC).
- **Experts** — só leitura/sugestão. Nenhum Expert usa `service_role`
  para simular usuário; o Diretor de ESG IA nunca escreve nessas tabelas.

## 4. Regras determinísticas antes da IA

`apps/web/lib/esg/compute-obligation-risk.ts` — puro, sem I/O, `today`
sempre injetado pelo caller (nunca `new Date()` interno, para manter o
cálculo determinístico e testável). Resumo das regras:

| Situação | Risco |
| --- | --- |
| CUMPRIDO + evidência obrigatória presente | LOW (OK) |
| CUMPRIDO sem evidência obrigatória | acima de LOW (ATENÇÃO) |
| PENDENTE próximo ao prazo (≤ 7 dias) | MEDIUM |
| PENDENTE ou qualquer status ativo com prazo vencido | HIGH (nunca abaixo) |
| NAO_CUMPRIDO | HIGH, ou CRITICAL quando há penalidade contratual descrita |
| NAO_APLICAVEL / DISPENSADO (com justificativa) | LOW |
| Reincidência (registro anterior HIGH/CRITICAL) | eleva o risco do novo registro |

O Diretor de ESG IA **complementa a interpretação, nunca substitui ou
recalcula esse resultado** — a instrução do Expert (`identity.ts`) proíbe
isso explicitamente.

## 5. Níveis de risco e exibição

Reaproveita `ExpertSeverity` (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`, já
existente em `apps/web/lib/ai/types.ts`) como o tipo canônico de risco —
convertido para `AlertSeverity` via `confrontationSeverityToAlertSeverity`
(já existente) para reaproveitar o componente `SeverityBadge` sem
duplicar paleta visual. Sempre cor + texto. Nota: `SeverityBadge` usa
fundo tinturado (15% de opacidade) em vez de fundo sólido vermelho/texto
branco para CRÍTICO — o requisito pediu explicitamente "não implementar
frontend-design nesta etapa", então o componente compartilhado não foi
alterado; um ajuste visual específico fica para uma fase de design.

## 6. Diretor de ESG IA (`esg-director`)

Usa a AI Expert Foundation existente — nenhuma arquitetura paralela:

```
apps/web/lib/ai/experts/esg-director/
├── identity.ts                  # missão, limites, governança (versionado)
├── fake-esg-query-enrichment.ts # heurística específica do fake provider
├── query.ts                     # answerEsgDirectorQuery — reusa os context builders genéricos
└── index.ts                     # barrel
```

Só consulta conversacional (`ExpertQueryResponse`) nesta fase — sem
`generateAssessment`/`ExpertAssessment` dedicado, porque uma obrigação
ESG/SSMA é, por natureza, um dado de nível de **projeto** (o checklist
inteiro), não de um único evento; `AiProviderRequest.context` continua
tipado como `EventAnalysisContext` e não foi alterado — estender esse
contrato para aceitar `ProjectAnalysisContext` também ficaria fora do
escopo mínimo pedido e arriscaria o Diretor Comercial IA.

`ProjectAnalysisContext` (`apps/web/lib/ai/context/types.ts`) ganhou
`esgObligations: ContextEsgObligationSummary[]` — o registro mais
recente de cada obrigação ativa, com `riskLevel` sempre vindo do cálculo
determinístico. Reaproveitado por `buildProjectAnalysisContext`, sem
duplicar a leitura de `apps/web/lib/esg/esg-obligations-data.ts`.

### Governança (idêntica ao padrão do ACC)

```
IA ANALISA → IA SUGERE → IA PODE REDIGIR →
HUMANO REVISA → HUMANO APROVA OU REJEITA →
SISTEMA EXECUTA SOMENTE O AUTORIZADO
```

O Expert nunca: aprova a própria recomendação, altera status definitivo
sozinho, envia e-mail automaticamente, declara obrigação cumprida sem
validação humana, assume compromisso pela AXION, apaga evidências, ou
altera contrato. `requiresHumanReview` é sempre `true` — invariante de
tipo, validado (nunca aceito como `false`). Rascunhos (`rascunhoSugerido`)
sempre `status: "DRAFT_PENDING_REVIEW"` — nunca enviados pelo Expert.

### Consulta

Reaproveita a Server Action `apps/web/lib/ai/esg-query-action.ts`
(mesmo padrão de `expert-query-action.ts`) e o componente
`ExpertQueryPanel` — generalizado com props `title`/`action`/
`initialState` (com defaults do Diretor Comercial IA, preservando 100%
de compatibilidade com os dois usos existentes) para ser reutilizável
por qualquer Expert Query, sem duplicar ~200 linhas de JSX.

**Nota de implementação**: um arquivo `"use server"` só pode exportar
funções assíncronas — um `const` de estado inicial (objeto simples)
exportado dali quebra o build **sempre que o arquivo for importado, direta
ou indiretamente, a partir de um Server Component** (não só quando o
valor é efetivamente usado). Por isso `esg-query-action.ts` não exporta
mais um `initialAskEsgDirectorState` — a página monta o estado inicial
inline (`{ response: null, error: null }`).

## 7. Event Ledger — só fatos relevantes

A RPC `review_esg_obligation_submission` (a única forma de revisar/
ajustar status — `ADMIN`) cria um `contract_events` real **somente**
quando:

- o novo status é `NAO_CUMPRIDO` (categoria `RESPONSABILIDADES`);
- o risco calculado da submissão é `HIGH`/`CRITICAL` (categoria
  `PENALIDADES`);
- o status passa a `CUMPRIDO`/`CUMPRIDO_PARCIALMENTE` e o registro
  anterior da mesma obrigação era `CRITICAL` (evento "obrigação crítica
  regularizada").

Cumprimento rotineiro (`CUMPRIDO` sem risco anterior relevante) nunca
gera evento — testado explicitamente em
`scripts/test-esg-obligations.mjs`.

## 8. Timeline Contratual/Jurídico

Nenhum código foi adicionado para "excluir" ESG/SSMA do Timeline — a
exclusão é uma consequência direta da seção 7: como só se cria um
`contract_event` real para os casos contratualmente relevantes acima
(nunca para toda submissão ESG/SSMA), o Timeline (que já lista todos os
`contract_events` do projeto, sem filtro adicional) nunca recebe ruído
de comprovações rotineiras.

## 9. Auditoria

Triggers `SECURITY DEFINER` (mesmo padrão de `event_notes_foundation.sql`):

| Ação | Disparo |
| --- | --- |
| `ESG_OBLIGATION_CREATED` | INSERT em `esg_obligations` |
| `ESG_OBLIGATION_STATUS_UPDATED` | INSERT em `esg_obligation_submissions` (registro da comprovação) |
| `ESG_OBLIGATION_REVIEWED` | Execução da RPC de revisão (ADMIN) |
| `CONTRACT_EVENT_CREATED` | Quando a revisão gera um evento relevante (seção 7) |

Nenhum log de auditoria grava o conteúdo integral da comprovação — só
IDs, status e contagens.

## 10. Multiidioma

Uma obrigação pode referenciar um `document_versions` cujo idioma
original já é rastreado (`source_language`, ver
`docs/multilingual-documents.md`, adicionado na fase anterior). Nenhuma
tradução é exigida antes da análise — o campo já é `null`-safe e nunca
bloqueia a criação/consulta de uma obrigação.

## 11. UI (funcional, sem polimento visual desta fase)

`/[projectId]/esg` — quatro abas:

1. **Minhas pendências** — "o que falta comprovar", sem excesso de
   informação (`EsgTechnicianPendingList`).
2. **Visão gerencial** — totais por status/risco + filtros por período,
   status, risco, categoria e responsável (`EsgManagerialSummary`).
3. **Checklist do projeto** — configurar obrigações (EDITOR/ADMIN),
   histórico de comprovações por obrigação, registrar nova comprovação
   com upload de evidências (`EsgObligationForm`, `EsgSubmissionForm`),
   revisão (ADMIN, `EsgReviewForm`).
4. **Diretor de ESG IA** — consulta conversacional (`ExpertQueryPanel`).

## 12. Limitações conhecidas

- Nenhum scheduler gera submissões periodicamente — a modelagem
  (`periodicity`) está pronta, mas cada registro é criado manualmente.
- `SeverityBadge` não usa fundo sólido vermelho/texto branco para
  CRÍTICO (ver seção 5) — ajuste de design fica para fase futura.
- O upload real de evidências (client-side, Storage) não é exercitado
  pelo teste automatizado (mesma limitação já documentada para
  `resolve-evidence-files.ts` em `docs/timeline-export.md`) — validado
  por leitura de código e pelo padrão já usado em
  `document-upload-form.tsx`.
