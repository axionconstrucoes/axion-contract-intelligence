// Rateio determinístico do orçamento de contexto entre os documentos
// contratuais de uma análise.
//
// O problema que isto resolve: com um laço ingênuo ("cada documento come
// o que sobrou"), a minuta mais recente consumia os 120 mil caracteres
// inteiros e o aditivo seguinte entrava com texto vazio — o Expert
// concluía sobre uma base contratual que ele não recebeu.
//
// Regra, em duas passagens e sem aleatoriedade:
//   1. cota igual para todos (budget / n), com piso de MIN_USEFUL_CHARS
//      para que todo documento legível tenha pelo menos um trecho útil;
//   2. quem precisa de menos que a própria cota devolve a sobra, que é
//      redistribuída entre os que ainda querem mais — repetindo até não
//      haver mais sobra ou ninguém mais querer.
//
// Função pura: nenhuma I/O, nenhum acesso a banco. É o que permite
// testar o rateio sem rede.

/**
 * Piso por documento. Abaixo disto o trecho não sustenta nenhuma
 * interpretação jurídica — é melhor omitir o documento inteiro (e
 * declarar a omissão) do que fingir que ele foi analisado.
 */
export const MIN_USEFUL_CHARS = 2000;

export interface BudgetCandidate {
  /** Identificador estável — usado só para devolver a alocação. */
  id: string;
  /** Tamanho do texto COMPLETO do documento. */
  characterCount: number;
}

export interface BudgetAllocation {
  id: string;
  /** Quantos caracteres este documento pode ocupar (0 = omitido). */
  allowedCharacters: number;
  included: boolean;
}

export interface BudgetPlan {
  allocations: BudgetAllocation[];
  includedCount: number;
  omittedCount: number;
}

/**
 * Distribui `budget` caracteres entre os candidatos, na ordem recebida
 * (a ordem é a prioridade: documento mais recente primeiro).
 */
export function planContractualBudget(
  candidates: readonly BudgetCandidate[],
  budget: number
): BudgetPlan {
  if (candidates.length === 0 || budget <= 0) {
    return {
      allocations: candidates.map((candidate) => ({
        id: candidate.id,
        allowedCharacters: 0,
        included: false,
      })),
      includedCount: 0,
      omittedCount: candidates.length,
    };
  }

  // 1. Quantos documentos cabem com o piso útil? Os que não couberem são
  //    omitidos de forma declarada, nunca incluídos com um fiapo de texto.
  const maxDocuments = Math.max(1, Math.floor(budget / MIN_USEFUL_CHARS));
  const admitted = candidates.slice(0, maxDocuments).filter((candidate) => candidate.characterCount > 0);
  const admittedIds = new Set(admitted.map((candidate) => candidate.id));

  // 2. Cota igual inicial.
  const allocation = new Map<string, number>();
  const baseQuota = Math.floor(budget / admitted.length);
  for (const candidate of admitted) {
    allocation.set(candidate.id, Math.min(baseQuota, candidate.characterCount));
  }

  // 3. Redistribuição da sobra, em passes determinísticos. Cada passe dá
  //    a sobra igualmente a quem ainda quer mais; termina quando não há
  //    sobra ou ninguém quer mais (convergência garantida: o total
  //    alocado só cresce e é limitado pelo budget).
  for (let pass = 0; pass < admitted.length + 1; pass += 1) {
    const used = admitted.reduce((sum, candidate) => sum + (allocation.get(candidate.id) ?? 0), 0);
    let leftover = budget - used;
    if (leftover <= 0) break;

    const hungry = admitted.filter(
      (candidate) => (allocation.get(candidate.id) ?? 0) < candidate.characterCount
    );
    if (hungry.length === 0) break;

    const share = Math.floor(leftover / hungry.length);
    if (share <= 0) {
      // Sobra menor que o número de famintos: entrega de um em um, na
      // ordem de prioridade, para não desperdiçar caracteres.
      for (const candidate of hungry) {
        if (leftover <= 0) break;
        allocation.set(candidate.id, (allocation.get(candidate.id) ?? 0) + 1);
        leftover -= 1;
      }
      break;
    }

    for (const candidate of hungry) {
      const current = allocation.get(candidate.id) ?? 0;
      allocation.set(candidate.id, Math.min(candidate.characterCount, current + share));
    }
  }

  const allocations: BudgetAllocation[] = candidates.map((candidate) => {
    const allowed = admittedIds.has(candidate.id) ? (allocation.get(candidate.id) ?? 0) : 0;
    return {
      id: candidate.id,
      allowedCharacters: allowed,
      // Texto vazio nunca entra: incluído só com conteúdo de fato.
      included: allowed > 0,
    };
  });

  const includedCount = allocations.filter((item) => item.included).length;

  return {
    allocations,
    includedCount,
    omittedCount: allocations.length - includedCount,
  };
}
