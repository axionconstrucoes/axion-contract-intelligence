import type { DocumentKind } from "@axion/types";

// Único ponto de decisão da aparência visual do cartão de documento —
// não representa risco, severidade, processamento ou resultado de
// análise (essas cores continuam vindo de
// apps/web/components/shared/badges.tsx e --risk-media/--severity-* em
// globals.css, nunca daqui).
//
// REGRA VISUAL FINAL (substitui integralmente todo esquema anterior,
// incluindo o marrom de ADITIVO) — aplicada ao CARTÃO INTEIRO, não só à
// faixa do cabeçalho, sempre uma das três cores abaixo (nunca mais um
// caso "neutro" branco/preto):
//
//   BORDÔ  — contrato-base, aditivo, e qualquer documento que seja um
//            ANEXO CONTRATUAL formalmente incorporado (a condição de
//            anexo contratual PREVALECE sobre o tipo original: uma
//            proposta comercial, cronograma ou especificação
//            incorporada ao contrato/aditivo fica bordô, não laranja).
//   VERDE  — relatório semanal SEM vínculo contratual.
//   LARANJA — especificações, atas, editais e todos os demais
//            documentos não contratuais.
//
// "Anexo contratual" (parâmetro isContractualAttachment) exige um
// vínculo real e persistido — nunca inferido pelo nome/título. Esse
// vínculo ainda não existe no schema (ver relatório: nenhuma tabela ou
// coluna representa parent_document_id/contract_id/aditivo_id hoje —
// só o enum de classificação da IA de confronto tem
// "INCORPORATED_CONTRACT_DOCUMENT", que é uma opinião da IA sobre uma
// fonte do cliente, não um vínculo estrutural documento-a-documento).
// Por isso nenhum chamador real desta função pode hoje passar
// isContractualAttachment=true — o parâmetro existe só para não exigir
// uma segunda reescrita quando esse vínculo for modelado; até lá, a
// classificação reduz-se a `kind` puro.
//
// Vermelho institucional (bordô) reaproveita os MESMOS tokens de marca
// já usados em toda a aplicação
// (--color-brand-sidebar/--color-brand-sidebar-foreground,
// globals.css) — nunca uma segunda cor "vermelha" inventada à parte.
//
// Contraste do CONTEÚDO (metadados/versões/botões/links) dentro da
// caixa colorida: page.tsx envolve esse conteúdo num painel claro opaco
// (contentPanelClassName) — garante contraste AA para toda a UI
// existente (badges, DocumentDownloadButton, hover/foco) sem precisar
// reescrever cada elemento nested; título e badge de tipo, que ficam
// FORA desse painel, usam as cores claras definidas abaixo.
//
// Toda visualização de documento cadastrado na página Documentos deve
// chamar esta função em vez de reimplementar a regra.
const BORDO_KINDS: readonly DocumentKind[] = ["CONTRATO_BASE", "ADITIVO"];

// RELATORIO_SEMANAL (fluxo original) e RELATORIO (fluxo de upload
// múltiplo, migration 20260825130000) são o mesmo conceito de
// "relatório" vindo de dois fluxos de upload diferentes — nenhum outro
// campo no schema os distingue (ver relatório: DocumentKind não tem uma
// terceira variante). Tratados como equivalentes aqui até que o schema
// diferencie relatório semanal de outro tipo de relatório.
const GREEN_KINDS: readonly DocumentKind[] = ["RELATORIO_SEMANAL", "RELATORIO"];

const BORDO: ReadonlySet<string> = new Set(BORDO_KINDS);
const GREEN: ReadonlySet<string> = new Set(GREEN_KINDS);

export type DocumentKindCardAppearance = {
  // Aplicado ao CARTÃO INTEIRO (fundo + borda + cor de texto base). Uma
  // das três cores da regra vigente — nunca mais um caso neutro.
  cardClassName: string;
  // Aplicado só ao título — negrito/alto contraste extra sobre o fundo
  // colorido.
  titleClassName: string;
  badgeClassName: string;
  // Painel claro opaco (bg-card + texto padrão) que envolve
  // CardContent — garante contraste AA para todo o conteúdo (versões,
  // badges, botões, hover/foco) sem precisar reescrever cada elemento
  // individualmente.
  contentPanelClassName: string;
};

const BORDO_APPEARANCE: DocumentKindCardAppearance = {
  cardClassName: "border-2 border-brand-sidebar bg-brand-sidebar text-brand-sidebar-foreground",
  titleClassName: "font-bold text-brand-sidebar-foreground",
  badgeClassName: "border-white/50 bg-transparent text-brand-sidebar-foreground",
  contentPanelClassName: "rounded-md bg-card p-2 text-card-foreground",
};

const GREEN_APPEARANCE: DocumentKindCardAppearance = {
  cardClassName: "border-2 border-emerald-900 bg-emerald-700 text-white",
  titleClassName: "font-bold text-white",
  badgeClassName: "border-white/50 bg-transparent text-white",
  contentPanelClassName: "rounded-md bg-card p-2 text-card-foreground",
};

const ORANGE_APPEARANCE: DocumentKindCardAppearance = {
  cardClassName: "border-2 border-orange-900 bg-orange-700 text-white",
  titleClassName: "font-bold text-white",
  badgeClassName: "border-white/50 bg-transparent text-white",
  contentPanelClassName: "rounded-md bg-card p-2 text-card-foreground",
};

export function getDocumentKindCardAppearance(
  kind: string | null | undefined,
  options?: {
    // Vínculo real de "anexo contratual formalmente incorporado" —
    // NUNCA inferido pelo nome/título do documento pelo chamador. Hoje
    // nenhum caller real tem essa informação persistida (ver
    // comentário no topo do arquivo) — este parâmetro existe só para
    // não exigir reescrever esta função quando o vínculo for modelado.
    isContractualAttachment?: boolean;
  }
): DocumentKindCardAppearance {
  // A condição de anexo contratual prevalece sobre o tipo original.
  if (options?.isContractualAttachment) {
    return BORDO_APPEARANCE;
  }

  if (typeof kind === "string" && BORDO.has(kind)) {
    return BORDO_APPEARANCE;
  }

  if (typeof kind === "string" && GREEN.has(kind)) {
    return GREEN_APPEARANCE;
  }

  // "Especificações, atas, editais e todos os demais documentos não
  // contratuais" — inclui também kind ausente/desconhecido (nunca
  // silenciosamente neutro).
  return ORANGE_APPEARANCE;
}
