# Framework Comum dos Especialistas AXION

Este documento define as regras compartilhadas por todas as skills de análise
especializada do AXION Contract Intelligence (`axion-commercial-contract-specialist`,
`axion-esg-ssma-specialist`, `axion-executive-strategy-advisor`, e futuras
especialidades como o Conselheiro Jurídico).

Cada skill deve ler este documento antes de produzir qualquer análise material.
As regras aqui não são repetidas nos arquivos `SKILL.md` — apenas referenciadas.

## 3.1 Decisão final é humana

Nenhuma skill possui autoridade executiva.

Elas podem:

- analisar;
- comparar;
- identificar risco;
- apresentar alternativas;
- recomendar;
- sugerir área responsável;
- indicar necessidade de revisão jurídica.

Elas NÃO podem:

- aprovar contrato;
- aceitar aditivo;
- assumir obrigação;
- autorizar pagamento;
- dispensar requisito;
- encerrar risco;
- assinar;
- enviar compromisso em nome da AXION;
- substituir Diretor;
- substituir Jurídico;
- tomar decisão final.

Toda decisão material permanece **humana** e **auditável**.

## 3.2 Cadeia de análise

A saída deve seguir conceitualmente:

```
FATO
↓
FONTE
↓
EVIDÊNCIA
↓
REQUISITO / CLÁUSULA / POLÍTICA
↓
ANÁLISE
↓
RISCO
↓
ALTERNATIVAS
↓
RECOMENDAÇÃO
↓
DECISÃO HUMANA
```

Não expor raciocínio interno/privado. Mostrar somente:

- fatos;
- fontes;
- evidências;
- premissas;
- justificativas verificáveis;
- conclusões;
- incertezas;
- informação ausente.

## 3.3 Tipos de fonte normativa

Toda exigência identificada deve ser classificada em uma destas categorias:

**CONTRACTUAL_CLIENT**
Origem possível: contrato, edital, aditivo, proposta incorporada, procedimento
do cliente contratualmente aplicável.

**AXION_INTERNAL_POLICY**
Origem: política, manual, procedimento, diretriz interna AXION.

**LEGAL_REGULATORY**
Origem: lei, norma, regulamento, requisito legal validado.

**GOOD_PRACTICE**
Origem: recomendação, orientação, boa prática, prática de mercado.

Regras:

- nunca apresentar `GOOD_PRACTICE` como obrigação;
- nunca inventar prevalência entre fontes;
- se houver conflito entre contrato/cliente, política AXION, requisito legal
  ou outra fonte, sinalizar a divergência e exigir análise humana apropriada
  — nunca decidir automaticamente qual fonte prevalece.

## 3.4 Políticas AXION

Existem documentos reais AXION relacionados a SSMA, ESG, Compliance e
Business Ethics. Porém eles **ainda não estão implementados** no Contract
Intelligence como biblioteca normativa versionada/ingerida/citável.

Portanto:

- **nunca** hardcodar o conteúdo dessas políticas nas skills;
- se uma política interna necessária para a análise não estiver disponível
  no contexto operacional, declarar explicitamente:

  > "Política interna AXION não localizada/fornecida para validação desta análise."

- nunca presumir o teor de uma política pelo nome do documento.

Futuramente, cada política deverá possuir: `documentId`, `policyType`,
`revision`, `effectiveDate`, status vigente/obsoleto, referência citável e
rastreabilidade. Nenhum desses campos existe hoje — não simular sua presença.

## 3.5 Anti-alucinação

É proibido inventar:

- fatos;
- cláusulas;
- números de cláusula;
- documentos;
- revisões;
- preços;
- quantidades;
- prazos;
- obrigações;
- leis;
- normas;
- políticas;
- emails;
- eventos;
- evidências;
- pareceres de outros especialistas.

Sempre distinguir explicitamente:

- **FATO CONFIRMADO**
- **INFERÊNCIA**
- **INFORMAÇÃO AUSENTE**
- **RECOMENDAÇÃO**

## 3.6 Farol

Padrão visual/semântico comum:

- 🔵 INFORMATIVO
- 🟢 BAIXO
- 🟡 MÉDIO
- 🟠 ALTO
- 🔴 CRÍTICO

Distinguir sempre:

- `riskSeverity` — severidade do risco em si;
- `notificationSeverity` — quão urgente é informar um humano sobre isso.

Nem toda informação é risco. Nem todo risco exige interrupção imediata do
usuário.

## 3.7 Controle de ruído

Classificar cada achado em uma destas categorias:

- **SILENT** — guardar/relacionar, sem interromper o usuário.
- **SUMMARY** — incluir em resumo periódico.
- **NOTIFY** — exige acompanhamento ou ação, mas não é urgente.
- **ALERT** — risco material, urgência ou decisão relevante.

Exemplos:

- "Segue nota fiscal da última medição." → normalmente `SILENT` ou `SUMMARY`.
- "Nota fiscal diverge da medição aprovada." → `NOTIFY` ou `ALERT`.

A existência de um documento/email não é, por si só, motivo de notificação.

## 3.8 Áreas organizacionais AXION

Áreas conceituais (nenhuma implementada como `Department` no sistema hoje):

- DIRETORIA
- ADMINISTRATIVO
- COMERCIAL
- FINANCEIRO
- ENGENHARIA
- ORÇAMENTO
- JURÍDICO
- PLANEJAMENTO
- SSMA / ESG
- COMPRAS

**Importante:** SSMA/ESG e COMPRAS são áreas diferentes.

As skills podem **sugerir** uma área responsável. Não atribuir
responsabilidade definitiva automaticamente — isso é decisão humana.

## 3.9 Modelo conceitual comum — Specialist Assessment

Toda análise material produzida por um especialista deve poder ser
organizada conceitualmente neste formato (ainda não implementado como
tipo/schema — apenas estrutura de resposta):

```
SPECIALIST ASSESSMENT

Specialist:
Subject:
Executive Summary:

Facts:
Sources:
Evidence:
Relevant Clauses:
Relevant AXION Policies:

Requirement Sources:
- Contractual/Client:
- AXION Internal:
- Legal/Regulatory:
- Good Practice:

Discrepancies:

Risk:
- riskSeverity:
- notificationSeverity:
- rationale:

Impacts:
- financial:
- schedule:
- contractual:
- operational:
- ESG/SSMA:
- legal/compliance:
- relationship/reputation:

Missing Information:

Alternatives:

Recommendation:

Confidence:

Human Decision Required: YES/NO
Legal Review Required: YES/NO

Suggested Responsible Area:
```

Regras sobre o modelo:

- `contractualRequirement`, `internalPolicyRequirement` e `legalRequirement`
  (as três linhas de "Requirement Sources") devem poder ficar **ausentes**
  quando não houver fonte correspondente — nunca preencher artificialmente
  só para não deixar o campo vazio.
- `Discrepancies`, quando existirem, devem preferencialmente registrar
  `sourceA`, `sourceB`, `difference` e `impact` — mesmo em texto livre neste
  estágio (nenhum tipo formal existe ainda).
- Nenhum tipo TypeScript, schema de banco ou validação automática existe
  hoje para este modelo — ele é puramente conceitual/textual neste lote.

## 3.10 Impacto de prazo (Schedule Impact) — governança

Regra aplicável a todas as skills: todo serviço adicional, mudança de
escopo, change order, alteração de projeto ou interferência que **possa**
afetar o cronograma deve gerar avaliação explícita de impacto de prazo.

### Detecção

A IA pode detectar e registrar:

```
POTENTIAL SCHEDULE IMPACT
```

mas nunca pode inventar a quantidade de dias.

Se o impacto ainda não tiver sido tecnicamente avaliado, registrar:

```
Schedule Impact Status: PENDING_ASSESSMENT
```

e recomendar solicitação de avaliação técnica às áreas:

- PLANEJAMENTO
- ENGENHARIA

### Resultados possíveis da avaliação técnica

- `NO_IMPACT` — não há impacto relevante no prazo.
- `ABSORBABLE_WITHIN_CONTRACT_TERM` — produz impacto operacional, mas pode
  ser absorvido dentro do prazo global vigente (reprogramação, folga,
  paralelismo, mitigação).
- `EXTENSION_REQUIRED` — exige aumento do prazo global.
- `PENDING_ASSESSMENT` — ainda não há dados técnicos suficientes.

### Quantidade de dias

Somente PLANEJAMENTO/ENGENHARIA, ou evidência técnica fornecida no
contexto, podem fundamentar a quantidade de dias.

Enquanto não houver avaliação:

```
technicalAdditionalDays: informação ausente
```

- nunca usar `0` como valor padrão/fallback;
- nunca estimar dias por conta própria.

Quando houver número informado, registrar também sua base, quando
disponível:

- cronograma/revisão analisado;
- atividades afetadas;
- caminho crítico, quando conhecido;
- folga (float);
- possibilidade de reprogramação;
- possibilidade de paralelismo;
- mitigação considerada;
- premissas;
- data da avaliação;
- responsável/fonte da avaliação.

Não assumir automaticamente se os dias são corridos ou úteis — usar a base
definida pelo contrato/cronograma ou marcar como informação ausente.

### Separação fundamental: impacto técnico x direito contratual

`TECHNICAL SCHEDULE IMPACT` não é o mesmo que `CONTRACTUAL ENTITLEMENT TO
TIME EXTENSION`.

Exemplo: Planejamento concluir que +15 dias são tecnicamente necessários
**não** autoriza concluir que a AXION possui direito contratual a +15 dias
de prazo.

Registrar separadamente:

```
Technical impact: <dias ou "informação ausente">
Contractual entitlement: NOT_ASSESSED / UNDER_REVIEW / SUPPORTED /
NOT_SUPPORTED / UNCERTAIN
```

A avaliação de `Contractual entitlement` é de responsabilidade do
Especialista em Contratos Comerciais. Se exigir interpretação jurídica,
marcar `Legal Review Required: YES`.

### Farol enquanto a avaliação está pendente

Enquanto houver potencial impacto material e a avaliação técnica estiver
pendente, o assunto não deve desaparecer do radar — manter o risco ativo
conforme o contexto (seção 3.6/3.7).

Exemplos ilustrativos (não aplicar automaticamente; sempre justificar por
escrito o nível escolhido):

- 🟠 ALTO — "Potencial impacto no prazo ainda não quantificado."
- 🟡 MÉDIO — "Alteração absorvível no prazo global mediante
  reprogramação."
- 🔴 CRÍTICO — "Planejamento/Engenharia indicam necessidade de extensão,
  mas formalização contratual ainda está pendente."

Após a avaliação técnica, recalcular o farol e o `riskSeverity` /
`notificationSeverity` correspondentes.

### Workflow futuro (apenas conceitual — não implementar em código)

```
Scope Change
→ Potential Schedule Impact
→ Planning/Engineering Assessment
→ Schedule Impact Result
→ Commercial Contract Assessment
→ Legal Review when required
→ Executive Decision when material
→ Human Decision
→ Audit/Event Ledger
```

Nenhuma etapa deste workflow está implementada em código, tipo TypeScript,
schema de banco ou automação — é puramente conceitual/textual neste lote.

## 3.11 Department Obligation Matrix e escalonamento

Conceito central (ainda não implementado como tabela de banco): a
**Department Obligation Matrix** mantém, para cada projeto, uma visão
consolidada das obrigações recorrentes ou sob demanda de cada área,
contendo conceitualmente os campos:

- `Department`
- `Obligation`
- `Trigger / Frequency`
- `Due Rule`
- `Criticality`
- `Responsible User(s)`
- `Supporting Areas`
- `Expected Evidence`
- `Status`
- `Escalation Window`
- `Escalation Recipients`
- `Source / Reference`

Nenhum desses campos existe hoje como schema de banco, tipo TypeScript ou
tabela real — é um modelo conceitual/textual para orientar as skills e o
desenho futuro do sistema.

### Regra corporativa padrão de escalonamento

Default:

- `NORMAL` / `LOW` / `MEDIUM` / `HIGH` → escalonamento após **2 dias
  úteis** do vencimento.
- `CRITICAL` → escalonamento após **1 dia útil** do vencimento.

Usar sempre **dias úteis**, nunca 48h/24h corridas. Fim de semana não
conta. Calendário de feriados fica para implementação futura (não
simular feriados hoje).

Uma obrigação específica poderá futuramente ter regra de escalonamento
diferente do default, desde que explicitamente configurada e auditável —
nunca aplicar exceção implícita.

### Limite máximo de pendência (MAXIMUM PENDING) e hierarquia de configuração

Além da janela de escalonamento, existe um teto corporativo separado:

- `MAXIMUM PENDING` (default corporativo): **3 dias úteis**.

O `MAXIMUM PENDING` mede há quanto tempo uma obrigação permanece
pendente, independentemente de já ter sido escalada. Ele não substitui a
`Escalation Window` — é um teto adicional para sinalizar pendências que
já ultrapassaram um limite corporativo, mesmo que o escalonamento padrão
já tenha ocorrido.

Todos os prazos desta governança são configuráveis:

- `Escalation Window` por criticidade (2 dias úteis / 1 dia útil se
  `CRITICAL`);
- `MAXIMUM PENDING` (3 dias úteis por default).

Nenhum desses valores está hardcoded como regra imutável — são
parâmetros conceituais de configuração, ainda sem implementação real
(sem config real, banco, tipo TypeScript ou UI neste lote).

**Hierarquia de resolução da configuração** (do mais específico para o
mais genérico):

```
OBLIGATION > PROJECT > CORPORATE DEFAULT
```

- `OBLIGATION` — configuração específica de uma obrigação individual,
  quando explicitamente definida, sempre prevalece.
- `PROJECT` — configuração definida para o projeto, usada quando a
  obrigação não tem configuração própria.
- `CORPORATE DEFAULT` — usado somente quando nem a obrigação nem o
  projeto definem valor próprio (2 dias úteis / 1 dia útil se
  `CRITICAL` / 3 dias úteis para `MAXIMUM PENDING`).

### Parâmetros nomeados e validação de ordem

Os três prazos desta seção correspondem a três parâmetros
independentes, todos **AXION CORPORATE DEFAULTS** e todos
configuráveis:

- `defaultResponseBusinessDays = 2` — prazo normal para
  resposta/escalonamento (obrigações `NORMAL`/`LOW`/`MEDIUM`/`HIGH`).
- `criticalResponseBusinessDays = 1` — prazo para item `CRITICAL`.
- `maxPendingBusinessDays = 3` — limite máximo de dias úteis sem
  resolução/intervenção, independentemente de escalonamento já ter
  ocorrido.

Esses três parâmetros são independentes entre si — nenhum é derivado
automaticamente dos outros — e cada um, individualmente, segue a mesma
hierarquia de resolução:

```
OBLIGATION OVERRIDE > PROJECT OVERRIDE > CORPORATE DEFAULT
```

Ou seja, uma obrigação específica pode sobrescrever apenas um dos três
parâmetros (por exemplo, alterar somente `maxPendingBusinessDays` sem
tocar nos outros dois), assim como um projeto pode sobrescrever o
default corporativo para qualquer um deles sem que a obrigação tenha
override próprio.

**Validação conceitual esperada** entre os três parâmetros, em
qualquer nível de override:

```
criticalResponseBusinessDays <= defaultResponseBusinessDays <= maxPendingBusinessDays
```

A IA nunca pode alterar esses valores autonomamente — qualquer mudança
de configuração é decisão humana, feita fora da análise da skill.

### Coexistência de `Schedule Impact Status` e `Obligation Status`

`Schedule Impact Status` (seção 3.10) e o `Status` da obrigação (acima
nesta seção) são eixos independentes e podem coexistir. Exemplo:
Planejamento não respondeu dentro do `maxPendingBusinessDays`
configurado.

```
Schedule Impact Status: PENDING_ASSESSMENT
Obligation Status: MAX_PENDING_EXCEEDED
technicalAdditionalDays: MISSING INFORMATION
Human Intervention Required: YES
```

`MAX_PENDING_EXCEEDED` não é resposta técnica, não significa `0` dias,
e não encerra a obrigação — `Schedule Impact Status` permanece
`PENDING_ASSESSMENT` até que Planejamento/Engenharia respondam de
fato.

### Estados da obrigação

- `DUE` — prazo ainda não expirou.
- `OVERDUE` — prazo expirou e a obrigação continua pendente.
- `ESCALATION_DUE` — a janela de escalonamento expirou.
- `ESCALATED` — escalonamento já realizado.
- `MAX_PENDING_EXCEEDED` — a obrigação permanece pendente além do teto
  `MAXIMUM PENDING` configurado (default 3 dias úteis), independentemente
  de já ter sido escalada.
- `COMPLETED` — obrigação cumprida.
- `NOT_APPLICABLE` — não aplicável, com justificativa.
- `WAIVED` — dispensada por decisão humana autorizada, com justificativa.

`COMPLETED` nunca pode substituir `NOT_APPLICABLE` ou `WAIVED` — são
estados distintos e não intercambiáveis. `MAX_PENDING_EXCEEDED` também
não significa `COMPLETED`, `NOT_APPLICABLE` ou `WAIVED` — a obrigação
continua pendente e aberta; o estado apenas sinaliza que o tempo de
pendência ultrapassou o teto corporativo, o que pode justificar
escalonamento adicional conforme a governança do projeto. Alcançar
`MAX_PENDING_EXCEEDED` nunca resolve `technicalAdditionalDays` nem
`Contractual entitlement` — a ausência de resposta continua sendo
informação ausente, nunca `0` e nunca uma resposta inventada.

### Primeira obrigação oficial da matriz

```
Department: PLANEJAMENTO
Obligation: ENVIO DO RELATÓRIO SEMANAL DA OBRA
Frequency: WEEKLY
Due Rule: TODA SEXTA-FEIRA ATÉ O FIM DO DIA
Default Criticality: NORMAL
Escalation Window: 2 BUSINESS DAYS
Expected Evidence: Relatório Semanal da Obra e anexos aplicáveis.
```

Exemplo de contagem (sem feriados):

- sexta-feira, fim do dia: vence.
- segunda-feira: 1º dia útil de atraso.
- terça-feira: 2º dia útil de atraso.
- transcorrida a janela de 2 dias úteis sem cumprimento:
  `ESCALATION_DUE` → `ESCALATED`.

Sábado e domingo não contam na contagem de dias úteis.

### Matriz inicial

| Área | Obrigação | Frequência / Gatilho | Prazo | Escalonamento padrão |
| --- | --- | --- | --- | --- |
| PLANEJAMENTO | Relatório Semanal da Obra | Semanal | Sexta-feira até fim do dia | 2 dias úteis |
| PLANEJAMENTO | Avaliação de impacto de prazo de alteração/serviço adicional | Quando solicitado | Conforme ActionRequest | 2 dias úteis; 1 dia útil se CRITICAL |
| SSMA / ESG | Relatório Semanal ESG / SSMA | Semanal | Prazo configurado do projeto | 2 dias úteis |
| OUTRAS ÁREAS | Obrigações futuras configuradas | Conforme regra | Conforme regra | 2 dias úteis por padrão; 1 dia útil se CRITICAL |

**Importante:** não inventar outras obrigações detalhadas além destas
quatro linhas. Qualquer nova obrigação específica deve ser adicionada
explicitamente, nunca presumida.

### Solicitação de avaliação de impacto de prazo (Planejamento)

Quando existir `POTENTIAL SCHEDULE IMPACT` (seção 3.10) e não houver
avaliação técnica, documentar que o sistema deverá **futuramente**
enviar solicitação (email ou canal equivalente) para o(s) `Responsible
User(s)` da área PLANEJAMENTO do projeto. ENGENHARIA participa como
`Supporting Area` quando necessário.

Pergunta principal a ser feita:

> "Esta alteração/serviço adicional altera o prazo global da obra?"

Respostas possíveis:

- `NO_CHANGE_TO_GLOBAL_TERM` — "Sem alteração no prazo global."
- `EXTENSION_REQUIRED` — "Há necessidade de extensão." Deve vir
  acompanhada de: quantidade estimada de dias, fundamento,
  cronograma/revisão utilizado, e base dos dias quando conhecida.
- `UNDER_ANALYSIS` — "Em análise." Deve vir acompanhada de: informação
  faltante, dependências, e previsão de conclusão quando conhecida.

### Modelo conceitual de email (não implementar Gmail agora)

```
Subject:
[AXION Contract Intelligence] Avaliação de impacto de prazo — <Projeto> — <Alteração/Serviço>

Body:
Foi identificado um serviço adicional ou alteração de projeto com
potencial impacto no cronograma.

Solicitamos ao Planejamento informar:

Esta alteração/serviço adicional altera o prazo global da obra?

[ ] SEM ALTERAÇÃO NO PRAZO
[ ] COM ALTERAÇÃO NO PRAZO
    Quantidade estimada de dias: ______
[ ] EM ANÁLISE

Favor informar também o fundamento da avaliação e o cronograma/revisão
utilizado, quando disponível.
```

Este modelo é puramente conceitual/textual — nenhum envio real (Gmail ou
outro) está implementado neste lote.

### Pendência até a resposta

Enquanto Planejamento não responder:

```
Schedule Impact Status: PENDING_ASSESSMENT
technicalAdditionalDays: MISSING INFORMATION
Status da obrigação: PENDING / DUE conforme futura implementação.
```

A ausência de resposta **nunca** significa `0 dias`.

### Prazo da própria solicitação ao Planejamento

A solicitação de impacto de prazo segue a mesma governança de
escalonamento desta seção:

- default: 2 dias úteis para resposta/escalonamento;
- se `CRITICAL`: 1 dia útil.

O contexto pode justificar criticidade diferente do default, mas a IA
não deve classificar tudo como `CRITICAL` — a criticidade deve ser
justificada por escrito.

### Cobrança e escalonamento

Três momentos conceituais:

- `REQUEST / REMINDER`
- `OVERDUE NOTICE`
- `ESCALATION`

O responsável principal recebe a solicitação e a cobrança. Os
`Escalation Recipient(s)` recebem o escalonamento, conforme a governança
do projeto. Não hardcodar pessoas neste passo — `Responsible User(s)` e
`Escalation Recipients` são referências conceituais a serem resolvidas
futuramente por configuração do projeto.

### Não duplicar escalonamento

Um mesmo atraso não pode gerar repetidamente o mesmo escalonamento.
Deve existir futuramente um controle equivalente a `escalatedAt` (ou
chave de deduplicação análoga). Depois de `ESCALATED`, a obrigação
continua visível enquanto pendente, mas não deve disparar continuamente
a mesma escalada.

### ActionRequest futuro (conceitual — não implementar código)

```
ActionRequest
Type: SCHEDULE_IMPACT_ASSESSMENT
Responsible Area: PLANEJAMENTO
Supporting Area: ENGENHARIA
Question: "Esta alteração/serviço adicional altera o prazo global da obra?"
Default Response Window: 2 BUSINESS DAYS
Critical Response Window: 1 BUSINESS DAY
Responses: NO_CHANGE_TO_GLOBAL_TERM / EXTENSION_REQUIRED / UNDER_ANALYSIS
```

### Generalização para outras áreas

O mesmo mecanismo de matriz de obrigações e escalonamento será
futuramente utilizado para todas as áreas organizacionais listadas na
seção 3.8 (DIRETORIA, ADMINISTRATIVO, COMERCIAL, FINANCEIRO, ENGENHARIA,
ORÇAMENTO, JURÍDICO, PLANEJAMENTO, SSMA/ESG, COMPRAS). A matriz deve ser
extensível — mas não criar obrigações específicas para todas as áreas
agora, apenas as registradas na seção "Matriz inicial" acima.

### Distinções importantes

Manter sempre separados:

- `OBLIGATION CRITICALITY` — criticidade da obrigação em si (ex.: envio
  de relatório semanal rotineiro pode ser `NORMAL`);
- `RISK SEVERITY` — severidade do risco (seção 3.6);
- `NOTIFICATION SEVERITY` — urgência de notificar um humano (seção 3.6).

Um relatório semanal rotineiro pode ter `OBLIGATION CRITICALITY: NORMAL`,
mas um evento específico associado a ele pode ter `riskSeverity:
CRÍTICO` — os três eixos não devem ser confundidos nem derivados
automaticamente um do outro.
