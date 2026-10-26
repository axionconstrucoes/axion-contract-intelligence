// Puro, sem I/O — partes do CORPO de um alerta (título-link, descrição, cláusula, evidência,
// "Repete", confronto) usadas pelo e-mail individual e pelo de lote, para que os dois fiquem
// IDÊNTICOS: um único tamanho de fonte; só o peso diferencia (título black; cláusula, evidência
// e "Repete" em negrito; descrição em regular).

import type { AlertSeverity } from "@axion/types";

import { repeatNoticeText } from "@/lib/alerts/repeat-policy";
import { PENDING_CONFIRMATION } from "@/lib/alerts/alert-source-links";
import type { ContractConfrontationBlock } from "@/lib/email/build-confrontation-block";
import { EVIDENCE_EMAIL_DIRECTION_LABELS } from "@/lib/email/evidence-email-direction";
import type { ContractAlertEvidenceItem } from "@/lib/email/templates/contract-alert-template";
import { ALERT_TONES, escapeAttr, panelStyle, textStyle } from "@/lib/email/templates/alert-box-style";

const esc = escapeAttr;

/** Título do alerta COMO LINK para o evento no ACC (substitui o botão VER EVENTO). */
export function alertTitleHtml(title: string, eventUrl: string, severity: AlertSeverity): string {
  const tone = ALERT_TONES[severity];
  return `<p style="margin:0 0 8px 0;${textStyle("black", tone.text, "word-break:break-word;", true)}"><a href="${esc(eventUrl)}" target="_blank" rel="noopener noreferrer" title="Abrir o evento no ACC" style="${textStyle("black", tone.text, "text-decoration:underline;", true)}">${esc(title)}</a></p>`;
}

export function alertDescriptionHtml(text: string, severity: AlertSeverity): string {
  const tone = ALERT_TONES[severity];
  return `<p style="margin:0 0 12px 0;${textStyle("regular", tone.text, "word-break:break-word;")}">${esc(text)}</p>`;
}

/**
 * Cláusula impactada: número e título em negrito, SEM cabeçalho separado. Sem referência
 * verificável: "Cláusula: Pendente de confirmação" — nunca uma cláusula inventada.
 */
export function alertClauseHtml(clause: { label: string | null; text?: string | null } | null, severity: AlertSeverity): string {
  const tone = ALERT_TONES[severity];
  if (!clause || !clause.label) {
    return `<p style="margin:0 0 12px 0;${textStyle("bold", tone.text)}">Cláusula: ${PENDING_CONFIRMATION}</p>`;
  }
  const quote = clause.text
    ? `<p style="margin:4px 0 0 0;padding:2px 0 2px 10px;border-left:3px solid ${tone.dark ? "#FFFFFF" : "#9ca3af"};${textStyle("regular", tone.text)}">&ldquo;${esc(clause.text)}&rdquo;</p>`
    : "";
  return `<div style="margin:0 0 12px 0;"><p style="margin:0;${textStyle("bold", tone.text, "word-break:break-word;")}">${esc(clause.label)}</p>${quote}</div>`;
}

export function alertClauseText(clause: { label: string | null; text?: string | null } | null): string {
  if (!clause || !clause.label) return `Cláusula: ${PENDING_CONFIRMATION}`;
  return clause.text ? `${clause.label}\n"${clause.text}"` : clause.label;
}

function evidenceLinkHtml(label: string, url: string, severity: AlertSeverity): string {
  const tone = ALERT_TONES[severity];
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="${textStyle("bold", tone.link, "text-decoration:underline;word-break:break-word;")}">${esc(label)}</a>`;
}

/** Evidências como LINKS em negrito para a origem no ACC; sem referência verificável: "Pendente de confirmação". */
export function alertEvidenceHtml(items: readonly ContractAlertEvidenceItem[], severity: AlertSeverity): string {
  const tone = ALERT_TONES[severity];
  if (items.length === 0) {
    return `<p style="margin:0 0 12px 0;${textStyle("bold", tone.text)}">Evidência: ${PENDING_CONFIRMATION}</p>`;
  }
  const rows = items.map((item) => {
    if (typeof item === "string") {
      const pending = item.includes(PENDING_CONFIRMATION) ? item : `${item} — ${PENDING_CONFIRMATION}`;
      return `<p style="margin:0 0 6px 0;${textStyle("bold", tone.text, "word-break:break-word;")}">Evidência: ${esc(pending)}</p>`;
    }
    if (item.kind === "EMAIL") {
      const direction = EVIDENCE_EMAIL_DIRECTION_LABELS[item.direction];
      return `<p style="margin:0 0 6px 0;${textStyle("bold", tone.text)}">Evidência: ${evidenceLinkHtml(`${direction} — ${item.subject} (${item.date})`, item.url, severity)}</p><p style="margin:0 0 6px 0;${textStyle("regular", tone.text, "word-break:break-word;")}">De: ${esc(item.from)} · Para: ${esc(item.to)}</p>`;
    }
    return `<p style="margin:0 0 6px 0;${textStyle("bold", tone.text)}">Evidência: ${evidenceLinkHtml(`${item.sourceTypeLabel}: ${item.label}`, item.url, severity)}</p>`;
  });
  return `<div style="margin:0 0 12px 0;">${rows.join("")}</div>`;
}

export function alertEvidenceText(items: readonly ContractAlertEvidenceItem[]): string {
  if (items.length === 0) return `Evidência: ${PENDING_CONFIRMATION}`;
  return items
    .map((item) => {
      if (typeof item === "string") return `Evidência: ${item.includes(PENDING_CONFIRMATION) ? item : `${item} — ${PENDING_CONFIRMATION}`}`;
      if (item.kind === "EMAIL") {
        return `Evidência: ${EVIDENCE_EMAIL_DIRECTION_LABELS[item.direction]} — ${item.subject} (${item.date}) — De: ${item.from} — Para: ${item.to} — ${item.url}`;
      }
      return `Evidência: ${item.sourceTypeLabel}: ${item.label} — ${item.url}`;
    })
    .join("\n");
}

export function alertRepeatHtml(severity: AlertSeverity): string {
  const tone = ALERT_TONES[severity];
  return `<p style="margin:12px 0 0 0;${textStyle("bold", tone.text)}">${esc(repeatNoticeText(severity))}</p>`;
}

/** Linha "rótulo: valor" (rótulo em negrito, valor regular). */
export function alertFieldRowHtml(label: string, value: string | null, severity: AlertSeverity): string {
  if (!value) return "";
  const tone = ALERT_TONES[severity];
  return `<p style="margin:0 0 6px 0;${textStyle("regular", tone.text, "word-break:break-word;")}"><span style="${textStyle("bold", tone.text)}">${esc(label)}:</span> ${esc(value)}</p>`;
}

/** Confronto contratual (painel branco; mesma fonte/tamanho; títulos em negrito). */
export function alertConfrontationHtml(block: ContractConfrontationBlock, severity: AlertSeverity): string {
  const panel = panelStyle(severity) || "border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;background-color:#fafafa;";
  const dark = "#111111";
  const part = (title: string, value: string) =>
    `<p style="margin:0 0 2px 0;${textStyle("bold", "#7F1D1D")}">${esc(title)}</p><p style="margin:0 0 8px 0;${textStyle("regular", dark, "word-break:break-word;")}">${esc(value)}</p>`;
  return `<div style="margin:0 0 12px 0;${panel}"><p style="margin:0 0 8px 0;${textStyle("bold", "#7F1D1D")}">Confronto contratual — Cláusula ${esc(block.clauseNumber)}</p>${part("O que foi identificado no evento", block.eventFinding)}${part("O que o contrato estabelece", block.contractProvision)}${part("Conclusão do confronto", block.conclusion)}${part("Possível impacto", block.potentialImpact)}<p style="margin:0 0 4px 0;${textStyle("bold", "#7F1D1D")}">${esc(block.approvedByLine)}</p><a href="${esc(block.detailUrl)}" style="${textStyle("bold", "#7F1D1D", "text-decoration:underline;")}">Ver confronto completo no ACC</a></div>`;
}
