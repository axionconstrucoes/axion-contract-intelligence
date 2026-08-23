// Classificação semântica de nome de pasta (seção 2 do requisito) —
// nunca por string exata: reconhece variações de prefixo numérico
// ("01_", "02_"), acentuação, plural/singular e sinônimos comuns.

import type { SemanticFolderCategory } from "./types";

const COMBINING_DIACRITICS = /[̀-ͯ]/g;

function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "") // remove acentos (marcas diacríticas combinantes, após NFD)
    .toLowerCase()
    .replace(/^\d+[_\-.\s]*/, "") // remove prefixo numérico ("01_", "02 - ")
    .trim();
}

// Ordem importa: categorias mais específicas primeiro para evitar que
// "planilha" genérico capture "planilha cliente" como AXION por engano.
const RULES: { category: SemanticFolderCategory; keywords: string[] }[] = [
  { category: "RECEBIDOS_CLIENTE", keywords: ["recebidos cliente", "recebido do cliente", "recebido cliente", "recebidos do cliente"] },
  { category: "PLANILHA_CLIENTE", keywords: ["planilha cliente", "planilhas cliente", "quantitativo cliente", "quantitativos cliente"] },
  { category: "PLANILHA_AXION", keywords: ["planilha orcamentaria", "planilha orcamento", "orcamento", "planilhas", "planilha"] },
  { category: "PROPOSTA", keywords: ["proposta comercial", "proposta"] },
  { category: "CRONOGRAMA", keywords: ["cronograma"] },
];

/**
 * Devolve a categoria semântica de uma pasta, ou null quando nenhuma
 * regra reconhece o nome — nunca uma classificação forçada/adivinhada.
 */
export function classifyFolderName(folderName: string): SemanticFolderCategory | null {
  const normalized = normalize(folderName);
  if (!normalized) return null;

  for (const rule of RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.category;
    }
  }
  return null;
}
