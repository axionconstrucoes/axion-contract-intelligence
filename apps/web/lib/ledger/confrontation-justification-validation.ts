// Validação compartilhada e determinística da justificativa de
// aprovação/rejeição de um candidato de confrontação Evento x Cláusula.
// Puro, sem I/O — deliberadamente sem "server-only": é chamada tanto pelo
// componente cliente (ConfrontationReviewForms, para feedback imediato)
// quanto pelo Server Action (única fonte de verdade — o cliente nunca é
// suficiente sozinho, pode ser contornado). Mesma função nos dois lados:
// nenhuma regra duplicada/divergente entre cliente e servidor.
//
// Nunca depende só de required/minLength do HTML: comprimento mínimo é só
// UM dos dois sinais — o outro é uma lista de frases genéricas conhecidas
// (vistas no e-mail real do piloto: "Confronto humano aprovado" sem nome
// de revisor, "aprovado", "de acordo") que tecnicamente passam num
// minLength baixo mas não explicam nada. Nunca usa IA para gerar/completar
// a justificativa — só rejeita o que já foi digitado quando insuficiente.

export interface JustificationValidationResult {
  valid: boolean;
  error: string | null;
}

// Mesma frase pedida para aparecer na interface como explicação
// persistente (não só como erro pós-tentativa) — texto exato do
// requisito.
export const CONFRONTATION_JUSTIFICATION_HELP_TEXT =
  "A relação foi aprovada, mas a conclusão não descreve qual condição contratual coincide, diverge ou exige ação.";

export const MIN_JUSTIFICATION_LENGTH = 20;

// Frases genéricas observadas (aprovação e rejeição) — comparação é feita
// sem acento/case/pontuação final, então "Aprovado.", "APROVADO", "aprovado"
// são todas pegas pela mesma entrada "aprovado".
const GENERIC_PHRASES = [
  "aprovado",
  "de acordo",
  "possivel relacao",
  "confronto humano aprovado",
  "rejeitado",
  "nao se aplica",
  "ok",
  "confirmado",
  "correto",
  "sim",
];

const COMBINING_DIACRITICS_PATTERN = /[̀-ͯ]/g;

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(COMBINING_DIACRITICS_PATTERN, "");
}

function normalizeForGenericCheck(value: string): string {
  return stripAccents(value.toLowerCase().trim()).replace(/[.!?;,]+$/g, "").trim();
}

// Verdadeiro apenas quando a justificativa INTEIRA é (ou se resume a) uma
// das frases genéricas — nunca rejeita um texto real só porque ele CONTÉM
// a palavra "aprovado" em algum ponto de uma frase mais longa e específica.
function isGenericJustification(normalized: string): boolean {
  return GENERIC_PHRASES.some((phrase) => normalized === phrase);
}

export function validateConfrontationJustification(rawValue: string): JustificationValidationResult {
  const value = rawValue.trim();

  if (!value) {
    return { valid: false, error: "Informe uma justificativa específica — este campo é obrigatório." };
  }

  if (value.length < MIN_JUSTIFICATION_LENGTH) {
    return {
      valid: false,
      error: `A justificativa precisa explicar a decisão com mais detalhe (mínimo de ${MIN_JUSTIFICATION_LENGTH} caracteres).`,
    };
  }

  if (isGenericJustification(normalizeForGenericCheck(value))) {
    return { valid: false, error: CONFRONTATION_JUSTIFICATION_HELP_TEXT };
  }

  return { valid: true, error: null };
}
