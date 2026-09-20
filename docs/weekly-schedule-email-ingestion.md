# Registro documental por e-mail, cronograma semanal (.mpp) e Relatório Semanal em Excel

Este documento descreve como o ACC (1) registra e classifica os envios
documentais por e-mail, (2) captura automaticamente o cronograma semanal
(.mpp) enviado pelo Planejamento ao cliente, (3) lê com segurança a
PLANILHA EXCEL do relatório semanal (abas Curva S, Linha de Base,
Financeiro, Histograma e SSMA) e (4) compara versões (semana anterior e
baseline oficial) com classificação de risco por limites do projeto —
tudo com evidência, idempotência e revisão humana auditada.

**A Curva S vem exclusivamente da planilha Excel.** O PDF do relatório
pode existir como complemento, mas nunca é fonte da Curva S.

**Princípios**: tudo é configuração por projeto (nenhum remetente,
domínio de cliente ou limite de risco fixo em código); a fonte é sempre a
caixa corporativa AXION já monitorada (nunca uma caixa do cliente);
nenhuma versão anterior é sobrescrita; toda decisão grava a regra que a
produziu; classificação/risco sem base suficiente ⇒ revisão humana,
nunca LOW automático.

## 0. Feature flag `ACC_WEEKLY_REPORTS_ENABLED` (trava de deployment)

Tudo o que este documento descreve está atrás de **uma única flag
server-side**, `ACC_WEEKLY_REPORTS_ENABLED`
(`apps/web/lib/feature-flags/weekly-reports.ts` → `isWeeklyReportsEnabled`).

- **Fail-closed**: só o valor exato `"true"` habilita. Ausente, vazio,
  `"false"`, `"1"`, `"TRUE"` ou qualquer outro valor = desligado. Nunca é
  `NEXT_PUBLIC_*`.
- **Por quê**: as funcionalidades dependem da migration
  `20260920120000_weekly_schedule_email_ingestion_foundation.sql`. O código
  pode ir para produção antes da migration sem quebrar nada, porque com a
  flag desligada **nenhuma tabela/função nova é consultada**.
- **O que a flag controla** (mesma decisão em todos os pontos):
  - item de menu **Financeiro** (layout server-side → `hiddenHrefs`) e a
    rota `/[projectId]/financeiro` (estado controlado
    `financial-feature-disabled`, sem consulta);
  - aba **Registro por e-mail** em Documentos (não renderiza e não chama
    `search_email_document_registry`);
  - páginas `/documentos/emails/[emailId]` e `.../anexos/[attachmentId]`
    (404);
  - loaders `searchEmailDocumentRegistry`, `getEmailDocumentDetail`,
    `loadFinancialDashboard` (recusam/retornam vazio — defesa em
    profundidade) e todas as server actions de revisão/correção;
  - nota do escalão de Planejamento em Usuários e permissões;
  - scripts `weekly-schedule-email-ingest.mjs` e
    `configure-weekly-schedule-ingestion.mjs` (encerram com código 0 sem
    tocar no banco) e o workflow `weekly-schedule-email-ingestion.yml`
    (`if: vars.ACC_WEEKLY_REPORTS_ENABLED == 'true'` — variável de
    repositório, não segredo).
- **O que NÃO muda**: Documentos, Cláusulas, Cronograma, Anexos de E-mail,
  Experts, Jurídico, SLA e todas as páginas antigas funcionam igual com a
  flag desligada.
- **Ordem de ativação**: aplicar a migration no banco do ambiente →
  definir `ACC_WEEKLY_REPORTS_ENABLED=true` no Vercel (server-side) e a
  variável de repositório no GitHub → novo deploy. Desligar é o caminho
  inverso e é imediato.
- Chave documentada em `apps/web/.env.example`; testes em
  `scripts/test-weekly-reports-feature-flag.mjs`.

## 1. Fonte oficial do escalão

A **"Matriz de responsabilidades e prazos"** (aba *Usuários e
permissões*) = `public.sla_area_responsibles`:

| Interface | Coluna |
|---|---|
| Nível 1 · Responsável | `responsible_direct_user_id` |
| Nível 1 · Corresponsável | `secondary_responsible_user_id` |
| Nível 2 · Gerência | `escalation_1_user_id` |
| Nível 3 · Diretoria | `board_user_id` |
| (legado, não exposto) | `escalation_2_user_id` |

`apps/web/lib/sla/resolve-user-responsibility-tier.ts` é a **única**
tradução usuário → escalão: `FIRST_TIER`, `SECOND_TIER`,
`NOT_AUTHORIZED`, `AMBIGUOUS` (mesma pessoa em N1 e N2, ou só no campo
legado), `NOT_CONFIGURED`. A configuração do projeto
(`authorized_tiers`) apenas habilita/bloqueia escalões — nunca redefine.
Nenhuma tabela guarda escalão paralelo. A aba Usuários mostra, derivado
da própria matriz, quem de Planejamento está no 1º/2º escalão.

Remetente aceito automaticamente somente quando: profile existe;
membership `ACTIVE` neste projeto; área `PLANEJAMENTO`; escalão
`FIRST_TIER`/`SECOND_TIER` pela Matriz e habilitado; domínio corporativo
configurado; pelo menos um To/Cc no domínio/endereço do cliente; dentro
da janela de monitoramento; anexo `.mpp` identificado sem ambiguidade.
Matriz ausente/ambígua, planejador sem vínculo com o projeto ou vários
`.mpp` sem padrão ⇒ `PENDING_HUMAN_REVIEW`.

## 2. Arquitetura reaproveitada

| Necessidade | Já existia | Uso |
|---|---|---|
| Mensagens | `public.emails` + `scripts/gmail-inbound-sync.mjs` | Só mensagens já sincronizadas são candidatas |
| Bytes de anexos | `email_attachments` + `ingestEmailAttachmentsForMessage` | Único caminho de download/SHA-256/Storage |
| Documento/versão | `documents`/`document_versions` (índice único `(project_id, sha256_hash)`) | Nova versão `AWAITING_PROCESSING` no documento `CRONOGRAMA_REVISAO` alvo |
| Extração MPP | `scripts/process-document-version.mjs` (MPXJ) → `schedule_versions/activities/task_relations` | Nenhum parser novo |
| Usuários | `project_memberships`, `profiles`, `sla_area_responsibles` | Autorização |
| Janela | `project_email_ingestion_configs` / `projects.start_date` | Herdada |
| Auditoria | `audit_log_entries` (`SYSTEM`) | Toda decisão/artefato |

## 3. Migration `20260920120000_weekly_schedule_email_ingestion_foundation.sql`

- `emails` (+colunas): `document_classification`, `classification_status`,
  `classification_confidence/reasons`, `work_week_number/label/status`,
  `sent_to_client` (filtro transversal), `provider_labels`.
- `email_attachments` (+colunas): `suggested_classification`,
  `confirmed_classification`, confiança/motivos.
- `project_weekly_schedule_ingestion_configs` — regra por projeto
  (`authorized_area`, `authorized_tiers`, `sender_domain`, domínios/
  endereços do cliente, prazo/fuso, janela, `attachment_name_pattern`,
  destinatários de alerta). Colunas técnicas fora do GRANT por coluna.
- `project_schedule_risk_thresholds` — limites por dimensão (MPP e Curva S).
- `project_schedule_baselines` — baseline oficial com histórico (uma ativa
  por projeto; RPC `set_project_schedule_baseline`, ADMINISTRADOR,
  justificativa obrigatória, anterior nunca apagada).
- `weekly_schedule_email_intakes` — evidência de cada envio avaliado
  (caixa monitorada, direção, labels, message_id, thread_id, remetente,
  To/Cc, assunto, data, semana civil e da obra, anexos com SHA-256,
  escalão pela Matriz, regra, versão criada). `UNIQUE (project_id,
  gmail_message_id)`. Status inclui `RECEIVED_DUPLICATE` (envio válido
  com `.mpp` já conhecido: **conta como recebimento**, sem versão nova).
- `schedule_version_comparisons` — `PREVIOUS_WEEKLY` / `OFFICIAL_BASELINE`
  (`UNIQUE (current, type)`), métricas, risco e `missing_thresholds`.
- `weekly_report_workbooks` — a PLANILHA (unidade documental
  `RELATORIO_SEMANAL_PLANEJAMENTO`): SHA-256, formato real (assinatura),
  índice de todas as abas (nome original + índice), relatório de segurança
  (macros/links/conexões detectados e ignorados, fórmulas sem valor),
  status (`EXTRACTED | PARTIAL | PENDING_HUMAN_REVIEW |
  LEGACY_FORMAT_REVIEW_REQUIRED | INVALID_FILE | FAILED`); `UNIQUE
  (email_attachment_id)`.
- `weekly_report_sheets` — uma linha por categoria (`CURVA_S`,
  `LINHA_BASE`, `FINANCEIRO`, `HISTOGRAMA`, `SSMA`): status (`EXTRACTED |
  MISSING_SHEET | AMBIGUOUS_SHEET | PENDING_HUMAN_REVIEW | HUMAN_MAPPED |
  HUMAN_VALIDATED | FAILED`), nome original e índice da aba, candidatas,
  `source_locator` (cabeçalho, faixa, colunas), método, confiança, `data`,
  data de corte, métricas, cruzamentos, risco, alertas, `expert_id`;
  `UNIQUE (workbook_id, category)`.
- `weekly_schedule_ingestion_alerts` — `MISSING_WEEKLY_SCHEDULE`,
  `MISSING_WEEKLY_REPORT_WORKBOOK`, `MISSING_S_CURVE`,
  `S_CURVE_MPP_DIVERGENCE`, `BASELINE_SHEET_DIVERGENCE` (`UNIQUE (project,
  semana, kind)`).
- `email_document_review_events` — decisão, campo, valor anterior/novo,
  justificativa, usuário, data, `reprocess_result`.
- RPCs SECURITY DEFINER: `review_weekly_schedule_intake` (APPROVE, REJECT,
  SET_WORK_WEEK, SELECT_ATTACHMENT, LINK_PROJECT, SET_CLASSIFICATION,
  REPROCESS — ADMINISTRADOR), `confirm_email_document_classification`
  (permissão de edição = `can_manage_project_documents`: ADMINISTRADOR ou
  GERENTE), `map_weekly_report_sheet` (idem — mapeamento manual de aba não
  localizada/ambígua), `validate_weekly_report_sheet_values` (idem; para a
  aba FINANCEIRO também `can_edit_project_financial_data`),
  `set_project_schedule_baseline` (ADMINISTRADOR). Nenhum papel fora do
  modelo (ADMINISTRADOR, GERENTE, COLABORADOR, LEITURA) é usado.
- `search_email_document_registry` — SECURITY INVOKER (RLS), paginada,
  ordenada por data; busca em assunto, arquivo, remetente, destinatários,
  WNN, texto extraído, atividades MPP e dados/nomes das abas da planilha.
- RLS: SELECT por `is_project_member` em todas as tabelas; escrita
  operacional só service role; nenhum `GRANT UPDATE` amplo.

## 4. Fluxo operacional (`scripts/weekly-schedule-email-ingest.mjs`, horário)

1. **Gmail Inbound Sync** (existente) grava metadados em `emails`.
2. `intake`: query Gmail mínima (`from:<domínio> has:attachment filename:mpp
   after:…`), cruza com `emails`, baixa cabeçalhos + o `.mpp` selecionado,
   decide (`evaluate-weekly-schedule-email.ts`) e grava a evidência.
3. `promote`: intakes `APPROVED_HUMAN_REVIEW` sem versão são promovidos a
   partir dos anexos já ingeridos (idempotente); resultado volta ao evento
   de revisão.
4. `compare`: versões `EXTRACTED` ⇒ comparações e risco
   (`compare-schedule-versions.ts`, `classify-schedule-risk.ts`).
5. `classify`: classificação determinística de e-mails/anexos
   (`classify-email-document.ts`, parser WNN `parse-work-week-subject.ts`).
6. `workbook`: leitura segura da planilha (`weekly-report/read-workbook.ts`),
   identificação tolerante das abas (`identify-sheets.ts`), extração por
   aba (`extract-sheets.ts`), análise/cruzamentos/risco
   (`analyze-sheets.ts`) e roteamento aos Experts; XLS legado ⇒
   `LEGACY_FORMAT_REVIEW_REQUIRED`; mapeamentos/validações humanas são
   preservados e reprocessados de forma idempotente.
7. `alerts`: ausência do cronograma / da Curva S após o prazo semanal.
8. **MPP Document Worker** (existente, 5 min) processa a versão
   (`AWAITING_PROCESSING → PROCESSING → PROCESSED`; `schedule_versions.
   extraction_status → EXTRACTED | FAILED`).

## 5. Interface

- **Documentos › Registro por e-mail**: dropdown *Classificação* (Todos,
  Atas, Diário de Obra/RDO, Alterações de projetos, SSMA/ESG, Relatório
  semanal, E-mails enviados ao cliente, Não classificados, Pendentes de
  revisão), busca e filtros server-side (GET), lista compacta paginada,
  linha clicável.
- **Detalhe do e-mail** (`/[projectId]/documentos/emails/[emailId]`):
  metadados completos, todos os anexos do `message_id` (abrir/baixar com
  fallback seguro por formato), decisão da ingestão, cronograma MPP +
  comparações, **Relatório Semanal (Excel)** com seções Resumo, Curva S
  (gráfico SVG, valores, desvio em p.p., cumprimento, tendência, risco,
  inconsistências com o MPP), Linha de Base (comparação com a baseline
  oficial), Financeiro, Histograma, SSMA, Dados de origem (abas, faixas,
  segurança) e Arquivo original; cada seção mostra aba original, corte,
  status, confiança, alertas e Expert responsável; aba ausente ⇒ "Aba não
  localizada" + mapeamento humano; outros envios da mesma semana da obra,
  revisão humana, baseline oficial, histórico auditado.
- **Viewer** (`…/anexos/[attachmentId]`): PDF em `iframe sandbox`,
  imagem em `img`, demais só metadados + download controlado. URL
  assinada de curta duração com o client de sessão (RLS).
- **Usuários**: nota com o 1º/2º escalão de Planejamento derivado da matriz.
- **Barra lateral**: "Análise Contratual" e "Análise de Cláusulas"
  removidas do menu (Expert Jurídico é o ponto único); rotas, páginas,
  APIs, dados, permissões e ajuda preservados.

## 6. Relatório Semanal em Excel — como cada aba é tratada

**Unidade documental**: o arquivo Excel inteiro é o anexo
`RELATORIO_SEMANAL_PLANEJAMENTO`; aparece uma única vez no pacote semanal
(junto do PDF, do MPP e demais anexos do mesmo `message_id`/WNN) e, ao
abrir, expõe as cinco seções. O original permanece no Storage (SHA-256
conferido antes da leitura) e disponível para download.

**Detecção das abas** (`identify-sheets.ts`): nome normalizado (sem
caixa, acentos, espaços, hífens, underscores) casado com regras por
categoria — `curvas*`, `linhadebase|linhabase|baseline`, `financ*|
curvafinanceira|avancofinanceiro|financial`, `histograma*|maodeobra|
efetivo|workforce`, `ssma|esg|seguranca*|hse|ehs`. Sem candidata ⇒
`MISSING_SHEET`; duas ou mais ⇒ `AMBIGUOUS_SHEET` (revisão humana);
correspondência exata única prevalece sobre parciais. Nome original,
índice, faixas, data, hash e método sempre preservados.

**Segurança** (`read-workbook.ts`): valida extensão, MIME, assinatura
real (PK = XLSX; D0CF11E0 = XLS legado) e tamanho; lista as entradas do
pacote para detectar `vbaProject.bin`, `externalLinks`, `connections.xml`/
`queryTables` — apenas reportados, nunca executados/seguidos; exceljs lê
somente o XML armazenado: fórmulas viram texto (evidência) e o valor usado
é o resultado cached; sem cached ⇒ "não disponível" (nunca recalculado);
hyperlinks viram texto; erros viram null. XLS legado não é aberto como
XLSX: `LEGACY_FORMAT_REVIEW_REQUIRED`.

**Extração** (`extract-sheets.ts`, sobre o grid de valores):
- *Curva S*: cabeçalhos tipados (`classifySeriesHeader`) — planejado,
  realizado, projetado/forecast, replanejado/recuperação, físico ×
  financeiro separados por unidade —, coluna de período, data de corte.
- *Linha de Base*: tabela de atividades/marcos (início/término/% planejado)
  e/ou série planejada por período; armazenada como
  `WEEKLY_REPORT_BASELINE_SHEET`.
- *Financeiro*: só colunas identificadas (previsto, realizado, acumulados,
  medido, faturado, recebido, custo, receita, desembolso, variação);
  unidade pelos cabeçalhos; campos ausentes ficam nulos.
- *Histograma*: período/categoria/previsto/realizado/quantidade/unidade;
  tipo de recurso inferido só com evidência (mão de obra, equipamentos,
  equipes) — senão `UNKNOWN`.
- *SSMA*: indicadores por cabeçalho real (horas trabalhadas, efetivo,
  acidentes com/sem afastamento, incidentes, quase acidentes, desvios,
  treinamentos, inspeções, ações abertas/concluídas, ambientais); layout
  em colunas ou indicador-por-linha.

**Análise** (`analyze-sheets.ts`): Curva S — desvio em p.p., cumprimento,
avanço semanal, tendência, velocidade, projeção; confronto com MPP atual/
anterior (comparação existente), baseline oficial, aba Linha de Base e
data de corte. Linha de Base — comparação com a `OFFICIAL_SCHEDULE_BASELINE`
(data final, marcos), com a Curva S (percentuais planejados) e com a
semana anterior (alteração retroativa/replanejamento) — **nunca substitui
a baseline oficial**; mudança exige revisão humana com justificativa,
usuário, data, histórico e permissão. Financeiro — previsto × realizado,
desvio absoluto/percentual, tendência, evolução acumulada; valores nunca
misturados com percentuais físicos. Histograma — previsto × realizado,
falta/excesso, tendência, compatibilidade com o avanço físico e com
atividades críticas; indício de insuficiência de recursos para
recuperação. SSMA — últimos valores e tendência por indicador; ocorrências
geram alerta.

**Risco**: limites do projeto por dimensão (`S_CURVE_*`,
`FINANCIAL_DEVIATION_PERCENT`, `HISTOGRAM_SHORTFALL_PERCENT`,
`BASELINE_SHEET_DIVERGENCE_DAYS`); sem limites ou baixa confiança ⇒
`REVIEW_REQUIRED` informando os limites ausentes.

**Roteamento** (Experts existentes; nenhum novo): Curva S, Linha de Base e
Histograma → `planning-director`; Financeiro → `commercial-director`; SSMA
→ `esg-director` (a aba SSMA permanece componente do relatório semanal —
não é `RELATORIO_DIARIO_SSMA_ESG`); síntese multidisciplinar → `ceo`
(consolidador; preserva a origem de cada conclusão; não substitui decisão
humana).

**Armazenamento/exibição**: `weekly_report_workbooks` + `weekly_report_sheets`
(§3); seção "Relatório Semanal (Excel)" no detalhe do e-mail (§5).

## 6b. Dashboard FINANCEIRO (`/[projectId]/financeiro`)

**Fonte única**: relatório semanal válido → `weekly_report_workbooks` →
`weekly_report_sheets` com `category = FINANCEIRO` (dados, métricas,
locator, confiança, alertas, `expert_id`). Nenhuma tabela nova, nenhum
snapshot duplicado, nenhum PDF ou valor digitado em paralelo.

**Acesso** (`lib/financial/access.ts` = SQL seção 12b da migration):

- **Visualizar** (`evaluateFinancialDashboardAccess` =
  `can_view_project_financial_dashboard`): membership **ACTIVE** no projeto
  **e** uma destas condições: papel **ADMINISTRADOR**; papel **GERENTE**;
  área **DIRETORIA**; área **FINANCEIRO**. Nenhuma outra área (COMERCIAL,
  PLANEJAMENTO, …) dá acesso por si só.
- **Corrigir/validar valores** (`evaluateFinancialEditAccess` =
  `can_edit_project_financial_data`): precisa visualizar **e** ter a
  permissão de edição do modelo existente (`can_manage_project_documents`
  = ADMINISTRADOR ou GERENTE). Perfis **LEITURA** e **COLABORADOR** nunca
  corrigem, mesmo quando visualizam pela área.
- **Legado**: `GESTOR` é o valor antigo de GERENTE (rótulo "Gerente"). É
  normalizado para GERENTE em um único helper
  (`lib/users/project-permission.ts` → `normalizeProjectPermission`) e o
  SQL o trata como GERENTE; não é oferecido na UI.
- A mesma decisão (`getProjectFinancialAccess` → `canView`/`canEdit`)
  alimenta o item do menu (layout server-side → `hiddenHrefs`), a rota
  (acesso negado), o loader (`canEdit` no modelo), a action, a RPC e a RLS
  da aba FINANCEIRO (`weekly_report_sheets`). Nunca por nome/e-mail.
  `scripts/test-financial-dashboard.mjs` (itens 3b/3c) avalia a expressão
  SQL lida da migration sobre a mesma tabela-verdade da função TS.

**Seleção de versão** (`build-financial-dashboard.ts`): por padrão a
versão válida mais recente (semana WNN maior; dentro da semana, e-mail
mais recente); filtros de semana, versão, período e série; versões da
mesma semana são preservadas, a mais recente é a válida e as demais ficam
"substituídas" — nunca somadas. Acumulados vêm da coluna acumulada da
própria aba (nunca soma de semanas).

**Cards** (só quando o dado existe; ausência = "Dado não disponível"):
previsto/realizado/desvio do período, previsto/realizado/desvio
acumulado, cumprimento, medido, faturado, recebido, saldo a receber,
custo, receita, resultado e margem (estes dois só com custo e receita na
mesma aba/moeda). Unidade/moeda vem dos cabeçalhos da aba.

**Gráficos** (SVG, sem biblioteca nova; lacunas nunca viram zero):
previsto × realizado, acumulados, medido × faturado × recebido, receita ×
custo, desvio por período, evolução do desvio (anterior × atual);
forecast só quando existir coluna reconhecida na fonte (hoje não é
inventada).

**Tabela**: só colunas existentes, desvio absoluto/percentual, unidade,
confiança e origem (aba!faixa), pesquisa/ordenação/paginação server-side.

**Alterações desde o relatório anterior**: novo período, planejado/
realizado alterado, alteração retroativa (anterior à data de corte do
relatório anterior), redução de realizado, acumulado/medição/faturamento/
recebimento/custo/receita alterados, unidade alterada, total incompatível
com composição — cada uma com métrica, período, anterior, atual,
diferença, fontes e classificação (MÉDIO/ALTO/REVISÃO).

**Cruzamento Financeiro × Curva S × MPP**: cumprimento financeiro ×
físico (p.p.), tendências, custo com avanço estagnado, faturado sem
recebimento, caminho crítico/prazo × deterioração financeira, datas de
corte divergentes — sempre fato / diferença / possível interpretação /
revisão humana, sem causalidade automática.

**Validação humana**: `correctFinancialValueAction` reutiliza a RPC
genérica `validate_weekly_report_sheet_values` (permissão de edição +
`can_edit_project_financial_data`; a action também checa `canEdit` antes):
valor original preservado (`previous_value` do evento +
`data.original`), correções listadas em `data.corrections`, usuário/data/
justificativa auditados, status `HUMAN_VALIDATED` e recálculo idempotente
pelo worker.

**Expert**: aba FINANCEIRO → `commercial-director`; consolidação → `ceo`.

## 7. Limitações / dependências (Google Workspace e operação)

- A mensagem do planejador precisa **chegar à caixa monitorada**
  (`GOOGLE_GMAIL_INBOUND_MAILBOX`): caixa compartilhada do ACC em cópia ou a
  própria caixa como remetente. Ler a pasta *Sent* de cada planejador
  exige Domain-Wide Delegation aprovada — a arquitetura aceita (registra
  `mailbox_address`/`provider_labels`/direção), mas nenhuma credencial é
  inventada e nenhuma leitura irrestrita foi implementada.
- `project_email_ingestion_domains` precisa incluir o domínio corporativo
  e o do cliente para o inbound sync gravar a mensagem.
- Entrega dos alertas por e-mail (`notified_at`) é etapa posterior (o
  provider de e-mail é `server-only`).
- Não afirmamos que todas as caixas AXION são monitoradas: só as
  configuradas em `project_email_ingestion_mailboxes`.

## 8. Testes

- `node scripts/test-weekly-reports-feature-flag.mjs` (flag ausente/false/true,
  gating de menu/aba/rotas/loaders/actions/scripts/workflow, páginas antigas)
- `node scripts/test-weekly-schedule-email-ingestion.mjs` (24)
- `node scripts/test-financial-dashboard.mjs` (32 itens do dashboard financeiro)
- `node scripts/test-email-document-registry.mjs` (68 checks: escalão,
  duplicidade, classificação, WNN, anexos, relatório semanal em Excel —
  cinco abas, tolerância de nomes, MISSING/AMBIGUOUS, fórmulas sem valor,
  macros/links ignorados, Curva S só do Excel, confronto com MPP, Linha de
  Base × baseline oficial, financeiro separado, histograma sem presunção,
  SSMA semanal, roteamento, vínculo ao message_id, XLS legado, original
  disponível, idempotência —, busca, menu, segurança)
