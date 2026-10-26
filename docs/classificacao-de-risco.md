# Classificação de risco (CRÍTICO / ALTO / MÉDIO / BAIXO)

> **Migration preparada e NÃO aplicada:** `supabase/migrations/20261028120000_risk_classification_reviews.sql`
> (depois de `20261027150000`). Testada só em PostgreSQL descartável (PGlite). Enquanto não for aplicada,
> o código se comporta como antes (a leitura do histórico tolera a tabela ausente).

## 1. Critérios adotados (definidos por Reynaldo)

| Nível | Critério |
|---|---|
| **CRÍTICO** | Risco iminente de descumprimento e penalização contratual, com necessidade de ação imediata. |
| **ALTO** | Risco iminente de descumprimento e penalização, mas ainda existe tempo para mitigação. |
| **MÉDIO** | Risco com possível consequência a médio prazo. |
| **BAIXO** | Risco processual, relacionado ao acompanhamento e à organização. |

**Não existe um número de dias que separe crítico, alto e médio** — esse limite não foi definido e o código
não o inventa. Recorrência (inalterada): crítico 1 dia, alto 2, médio 4, baixo 7 (`lib/alerts/repeat-policy.ts`).

## 2. ANTES — como a classificação funcionava

| Aspecto | Alertas contratuais (eventos do ledger) | Providências (tabela de entrega) |
|---|---|---|
| **Origem** | `event_ai_assessments.severity` (`BAIXA/MEDIA/ALTA/CRITICA`, 1 linha por evento, `supabase/migrations/20260818224157_event_ledger_foundation.sql`). No código da aplicação só `applyScheduleDelayAssessmentToEvent` grava essa tabela (`lib/ai/experts/planning-director/apply-schedule-delay-assessment.ts`); as demais linhas vêm de seed/fluxos externos ao `apps/web`. | Campo `risk` de `project_delivery_items`, escolhido por pessoa (`delivery_item_update_fields`, migration `20261027130000`). |
| **Regra** | Atraso de cronograma: `derive-schedule-delay-severity.ts` (ALTA por padrão; CRÍTICA só com prazo ultrapassado **e** recuperação IMPROVÁVEL estruturada; nunca rebaixa). Demais severidades vêm do provedor de IA (`ExpertSeverity LOW…CRITICAL`, `lib/ai/types.ts`, mapeada por `confrontationSeverityToAlertSeverity` em `lib/labels.ts`). Diário de Obra: regras fixas por tipo (`lib/integrations/diario-de-obra/finding-rules.ts`). ESG/SSMA: regra determinística (`lib/esg/compute-obligation-risk.ts`, que usa uma janela fixa de 7 dias — domínio SSMA, não alterado aqui). | Sem escolha: MÉDIO (`selectDueDeliveryAlerts` em `lib/delivery/delivery-items.ts`), nunca crítico por padrão, item sinalizado "risco a definir". |
| **Uso de IA** | Sim: o provedor propõe `severity` no `ExpertAssessment`; os prompts **não** trazem os critérios de crítico/alto/médio/baixo — a gravidade não tinha definição escrita. | Não. |
| **Justificativa/evidência** | O resumo da IA e `contractualBasis/evidenceRefs` existem na avaliação, mas a severidade não guardava justificativa própria nem referência. | Nenhuma. |
| **Edição humana** | **Não havia**: nenhum caminho para uma pessoa corrigir o grau de um evento. | Sim, pelo campo "Grau de risco" do editor — sem justificativa e com o histórico apenas "Campos atualizados: risk" (sem valor anterior/novo). |
| **Efeito na recorrência** | `alert_followups.severity` gravada na abertura; não mudava. | Idem. |

## 3. AGORA — sugestão + revisão humana

### 3.1 Sugestão (`apps/web/lib/risk-classification/`)
`suggest-risk.ts` é puro (sem I/O, sem IA). Entradas: natureza (descumprimento contratual × processual), obrigação
e cláusula verificada, consequência/penalidade **com cláusula**, prazo (vencido / a vencer / sem prazo /
desconhecido), iminência, tempo para mitigação e evidências.

Regras:

1. Natureza processual → **BAIXO**.
2. Descumprimento iminente (ou prazo **já vencido**, único fato derivado) com penalidade apoiada em cláusula:
   sem tempo para mitigar → **CRÍTICO**; com tempo → **ALTO**.
3. Descumprimento iminente **sem** penalidade confirmada em cláusula → **MÉDIO** (não se afirma penalização) e o que
   confirmar é listado.
4. Descumprimento não iminente → **MÉDIO**.
5. Faltou dado que distinga níveis (natureza, iminência, tempo de mitigação) → **sem nível**: devolve os níveis
   possíveis (ex.: "entre Alto e Crítico"), incerteza alta e o que confirmar. Nada é escolhido por palpite.

Cada sugestão traz `basis` separado em **FATO** (com referência verificável), **INFERÊNCIA** (aplicação do critério) e
**RECOMENDAÇÃO** (o que confirmar), `missingInformation`, `uncertainty` e `requiresHumanReview: true`.
"Iminência" e "tempo para mitigação" são **declarados** por pessoa autorizada — nunca deduzidos de dias.
Penalidade só entra como fato com descrição **e** cláusula verificada confirmada pela pessoa.

### 3.2 Revisão humana (migration `20261028120000`)
- `risk_classification_reviews`: histórico **append-only** (gatilho impede UPDATE/DELETE, inclusive do service role)
  com grau anterior/novo, grau e retrato da sugestão, **justificativa obrigatória**, referência e revisor.
- `review_risk_classification(...)`: exige gestor/gerente/administrador **da obra dona do registro** (a obra vem do
  evento/providência, nunca do navegador), justificativa e grau diferente do atual.
- A classificação da IA **nunca é sobrescrita**; o grau efetivo é a revisão mais recente
  (`lib/risk-classification/reviewed-severity.ts`, aplicado em `lib/data.ts` e no produtor de lotes).
- A revisão ajusta o acompanhamento recorrente **aberto** ao intervalo do novo grau (1/2/4/7 dias) sem alterar o
  próximo lembrete já agendado.
- Alterações **diretas** do risco de uma providência (API/tabela) também entram no histórico, marcadas "sem
  justificativa informada". O editor da tabela deixou de ter o select de risco; o grau muda pelo painel com justificativa.
- Providências podem chegar a CRÍTICO por revisão; o padrão sem escolha continua MÉDIO.

### 3.3 Interface
`components/risk/risk-review-panel.tsx` — critérios, sugestão ao vivo (fato/inferência/recomendação com links),
formulário de revisão e histórico. Aparece no detalhe do evento (`/[projectId]/ledger/[eventId]`) e no editor de
cada providência. Apenas gestor/gerente/administrador revisa; os demais só leem.

## 3.1 Critérios nos prompts de IA e integração no fluxo (rodada seguinte)

**Prompts.** O texto dos quatro critérios está em `apps/web/lib/ai/risk-criteria.ts`
(`RISK_CRITERIA_INSTRUCTIONS`, v1) e é incluído nas instruções dos cinco Experts — CEO v3, Comercial v4,
ESG v3, Jurídico v5 e Planejamento v5 — e na consulta por especialidade
(`lib/ai/alert-consult/specialties.ts`, `CONSULT_RISK_CRITERIA_TEXT`). O bloco: não existe limite fixo de
dias (nunca inventar); distinguir fato × inferência × informação ausente; citar cláusulas e evidências do
contexto; "penalização" só com a cláusula que a prevê; sem prazo/vínculo contratual, indicar os níveis
compatíveis e pedir confirmação em `informacoesFaltantes`; a classificação da IA é provisória e a efetiva é
a revisão humana. O ESG continua com o risco ESG calculado por regra determinística (os critérios apenas
orientam a interpretação). Teste: `scripts/test-risk-criteria-integration.mjs`.

**A sugestão é usada no fluxo? (evidência no teste acima)**

| Ponto do fluxo | Situação |
|---|---|
| Painel de revisão do evento (`ledger/[eventId]`) e de cada providência | já existia: sugestão pelos critérios + revisão com justificativa e histórico |
| Grau efetivo em leitura/lista de eventos (`lib/data.ts`), no envio manual e no produtor de lotes | já existia: usa a revisão humana mais recente |
| Revisão de providência → grau da providência e intervalo do acompanhamento | já existia (SQL `review_risk_classification`) |
| **Aviso antes do envio manual do alerta** (`EventRiskPreSendNotice`, `lib/risk-classification/pre-send-notice.ts`) | **novo**: mostra o grau atual, se é automático ou revisado e, sem revisão, o que falta confirmar. Não bloqueia nem altera nada |
| **Criação de providência** (`delivery-admin-controls.tsx`) | **novo**: texto explicando que nasce MÉDIO provisório e como obter sugestão/revisão |

Não há criação de eventos por IA em `apps/web` fora do atraso de cronograma (regra
`derive-schedule-delay-severity.ts`, sem limiar de dias). Fora do escopo e não alterados: as heurísticas por
categoria de `scripts/event-clause-confrontation-analyzer.mjs` (`inferSeverity`) e as regras do Diário de
Obra (`finding-rules.ts`, que usam janelas de dias para edição tardia, não para separar níveis de risco).

**ADMINISTRATIVO → Documentação e Entrega: NÃO mapeado.** A área `ADMINISTRATIVO` existe no cadastro
(`MembershipArea`, formulário de membros, constraint SQL e `SlaArea`), mas nenhum documento nem tela define o
seu escopo (o framework só a lista entre as áreas conceituais), então a correspondência com "Documentação e
Entrega" seria suposição. A pré-seleção continua `Geral` e o usuário escolhe manualmente. Para mapear,
basta uma decisão sua e uma linha em `preselectSpecialtyForArea`.

## 4. Limitações
- Eventos não têm prazo cadastrado: a pessoa informa o status do prazo. Providências usam o prazo do registro.
- Providências não têm vínculo cláusula↔obrigação: sem esse vínculo a sugestão tende a "indeterminada" e pede a
  confirmação (honesto, não omissão).
- A sugestão é determinística sobre dados declarados/verificados; **não** usa IA e não lê contrato sozinha.
- Os prompts de IA continuam sem os critérios escritos; a classificação original da IA permanece como está e é
  tratada como ponto de partida a revisar (não foi alterada).
- Migration não aplicada; SQL validado em PGlite (stub mínimo do Supabase), não no schema real.
- Testes: `npm run test:scripts` (`scripts/test-risk-classification.mjs`, 15) e `npm run test:sql`
  (`scripts/test-risk-classification-sql.mjs`, 10).
