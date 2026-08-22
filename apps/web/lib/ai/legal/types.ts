// Preparação da arquitetura para fontes normativas oficiais e citáveis.
// NENHUM corpus normativo real está versionado/ingerido no projeto ainda
// — nenhum artigo de lei é hardcoded aqui nem em nenhum Expert. Ver
// docs/ai/experts.md (seção "Base legal") para a estratégia de
// ingestão/versionamento/citação prevista.
//
// Fonte inicial prevista (ainda não implementada): Código Civil
// brasileiro. Memória geral do LLM NUNCA deve ser tratada como fonte
// legal oficial — quando não houver corpus versionado, todo Expert deve
// responder que a base legal oficial não está disponível (ver
// LEGAL_SOURCE_UNAVAILABLE_NOTICE abaixo).

/** Origem normativa suportada pela arquitetura — cresce conforme corpus real for ingerido. */
export type LegalSourceOrigin = "CODIGO_CIVIL";

/**
 * Uma fonte normativa oficial, citável e rastreável. Todo campo é
 * obrigatório precisamente porque uma citação legal sem proveniência
 * verificável não deve existir no sistema.
 */
export interface LegalSource {
  norma: string; // ex.: "Código Civil"
  fonte: string; // ex.: "Lei nº 10.406, de 10 de janeiro de 2002"
  origem: LegalSourceOrigin;
  versaoVigencia: string; // ex.: "Redação vigente em 2026" — nunca inferida, sempre registrada na ingestão
  dispositivo: string; // ex.: "Art. 421"
  referencia: string; // string de citação pronta para exibição
}

/** Como uma citação legal se relaciona com uma análise específica. */
export interface LegalCitation {
  source: LegalSource;
  relationToAnalysis: string;
}

/**
 * Mensagem padrão quando não há corpus normativo versionado disponível
 * para fundamentar uma resposta. Todo Expert deve usar exatamente esta
 * frase (ou equivalente) em vez de inventar dispositivo legal — nunca
 * tratar conhecimento geral do modelo como se fosse a fonte oficial.
 */
export const LEGAL_SOURCE_UNAVAILABLE_NOTICE =
  "Base legal oficial não está disponível: nenhum corpus normativo (ex.: Código Civil) está versionado/ingerido no projeto nesta fase. Nenhum dispositivo legal foi citado — consulte o Jurídico para fundamentação legal formal.";

/**
 * Estratégia de ingestão prevista (documentada aqui para orientar a
 * implementação futura — nenhuma parte está implementada):
 *
 * 1. Ingestão de um corpus normativo versionado (ex.: texto oficial do
 *    Código Civil) em uma tabela própria (`legal_sources` ou
 *    equivalente), com norma/fonte/dispositivo/vigência estruturados —
 *    nunca texto solto sem proveniência.
 * 2. Cada dispositivo ingerido recebe um identificador estável para
 *    citação (ver `referencia`), e uma vigência explícita — nunca
 *    presumir que um artigo lido pelo modelo em treinamento reflete a
 *    redação vigente.
 * 3. Busca/seleção de dispositivos relevantes para uma análise
 *    (retrieval) deve seguir o mesmo princípio de controle de
 *    volume/token do context builder (ver apps/web/lib/ai/context/) —
 *    nunca despejar o corpus inteiro no modelo.
 * 4. Toda citação usada em uma análise vira um `LegalCitation`
 *    rastreável, nunca uma menção solta em texto livre.
 */
