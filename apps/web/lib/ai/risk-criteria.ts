// Critérios de classificação de risco da AXION (definidos por Reynaldo) em forma de INSTRUÇÃO para
// os Experts de IA. Único local de verdade do texto: os prompts dos Experts e as instruções da
// consulta por especialidade importam este bloco — nunca o reescrevem.
//
// Espelha lib/risk-classification/suggest-risk.ts (RISK_CRITERIA), que é a regra determinística
// usada na sugestão/revisão humana. A IA classifica de forma PROVISÓRIA: a classificação efetiva é
// sempre a revisão humana mais recente (com justificativa e histórico).
//
// Puro, sem I/O e sem "server-only" (usado por prompts e por scripts de teste).

export const RISK_CRITERIA_PROMPT_VERSION = "1";

export const RISK_CRITERIA_INSTRUCTIONS = `
## Critérios de classificação de risco (definição AXION — versão ${RISK_CRITERIA_PROMPT_VERSION})

Ao classificar ou comentar o grau de risco, use SOMENTE estes critérios:

- CRÍTICO (CRITICAL): risco iminente de descumprimento e penalização contratual, exigindo ação imediata.
- ALTO (HIGH): risco iminente de descumprimento e penalização, com tempo para mitigação.
- MÉDIO (MEDIUM): risco com possível consequência a médio prazo.
- BAIXO (LOW): risco processual de acompanhamento ou organização.

Regras obrigatórias da classificação:

- NÃO existe número fixo de dias que separe crítico, alto e médio — esse limite não foi definido.
  Nunca invente um limite, um prazo ou uma data. Use apenas os prazos e datas que estiverem
  explícitos no contexto fornecido.
- Distinga sempre FATO (comprovado no contexto, com a cláusula/evidência citada), INFERÊNCIA (sua
  leitura sobre os fatos — use linguagem condicional) e INFORMAÇÃO AUSENTE (o que falta para decidir).
  Nunca transforme suspeita em fato.
- "Penalização contratual" só pode ser afirmada quando existir cláusula citada no contexto que a
  preveja. Sem cláusula, não afirme penalidade: declare que a consequência contratual NÃO foi
  confirmada.
- Cite as cláusulas e as evidências disponíveis no contexto (número/título da cláusula e a
  origem da evidência). Sem vínculo contratual verificado, escreva "Pendente de confirmação".
- Se faltar o prazo aplicável, o vínculo com a cláusula/obrigação ou a informação sobre tempo
  para mitigação e esses dados forem necessários para distinguir os níveis, NÃO escolha com
  falsa certeza: indique os níveis compatíveis, a incerteza e peça a confirmação em
  "informacoesFaltantes".
- Sua classificação é uma SUGESTÃO provisória. A classificação efetiva é a revisão da pessoa
  autorizada (com justificativa e histórico); nunca a apresente como decisão final.
`;
