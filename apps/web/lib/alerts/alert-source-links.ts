// Puro, sem I/O — referências VERIFICÁVEIS de cláusula e evidência usadas nos e-mails de alerta.
//
// Regras:
//  - nada é inventado: só vira link o que tem identificador real (versão de documento, e-mail
//    ou evidência do evento); sem referência verificável o texto é "Pendente de confirmação";
//  - o link abre no ACC (exige login e respeita a participação na obra — as páginas de destino
//    já aplicam RLS), nunca em endereço externo/gmail://;
//  - página só entra no link quando o localizador da evidência a informa de forma explícita
//    ("pág. 12", "página 12", "p. 12"); caso contrário abre o documento sem página.

import type { ContractAlertEvidenceItem } from "@/lib/email/templates/contract-alert-template";
import { evidenceAnchorId } from "@/lib/ledger/evidence-anchor";

export const PENDING_CONFIRMATION = "Pendente de confirmação";

/** Página explícita num localizador de evidência (1–4 dígitos); null se não houver. */
export function parseEvidencePage(locator: string | null | undefined): number | null {
  if (!locator) return null;
  const m = /(?:\bp[áa]g(?:ina)?\.?|\bp\.)\s*(\d{1,4})\b/i.exec(locator);
  if (!m) return null;
  const page = Number(m[1]);
  return Number.isInteger(page) && page > 0 ? page : null;
}

export interface EvidenceLinkInput {
  baseUrl: string;
  projectId: string;
  eventId: string;
  evidenceId: string | null;
  documentVersionId: string | null;
  emailId: string | null;
  locator: string | null;
  label: string;
  sourceTypeLabel: string;
}

/**
 * Evidência como link para a ORIGEM no ACC:
 *  - documento → visualizador da versão (com a página quando o localizador a informa);
 *  - mensagem de e-mail → cartão da evidência na página do evento (âncora estável);
 *  - sem identificador verificável → item sem link, marcado como pendente de confirmação.
 */
export function buildEvidenceItem(input: EvidenceLinkInput): ContractAlertEvidenceItem {
  const base = input.baseUrl.replace(/\/+$/, "");

  if (input.documentVersionId) {
    const page = parseEvidencePage(input.locator);
    const url = `${base}/${input.projectId}/documentos/versoes/${input.documentVersionId}${page ? `?paginaGlobal=${page}#original` : ""}`;
    return { kind: "OTHER", url, sourceTypeLabel: input.sourceTypeLabel, label: page ? `${input.label} (pág. ${page})` : input.label };
  }

  if (input.emailId && input.evidenceId) {
    return {
      kind: "OTHER",
      url: `${base}/${input.projectId}/ledger/${input.eventId}#${evidenceAnchorId(input.evidenceId)}`,
      sourceTypeLabel: input.sourceTypeLabel,
      label: input.label,
    };
  }

  return `${input.sourceTypeLabel}: ${input.label} — ${PENDING_CONFIRMATION}`;
}

export function formatClauseLabel(number: string | null | undefined, title: string | null | undefined): string | null {
  const n = (number ?? "").trim();
  const t = (title ?? "").trim();
  if (!n && !t) return null;
  if (!n) return t;
  return t ? `Cláusula ${n} – ${t}` : `Cláusula ${n}`;
}

/** Resumo curto do texto da cláusula (sem cortar no meio de palavra). */
export function summarizeClauseText(text: string | null | undefined, max = 280): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 120 ? cut.lastIndexOf(" ") : max).trimEnd()}…`;
}
