// Reconstrução do CONSOLIDADO semanal (DIGEST) para retentativa de envio — PURO, sem I/O.
//
// O conteúdo do e-mail nunca é persistido por inteiro (ver types.ts). Para que uma retentativa
// reenvie exatamente o consolidado ORIGINAL (mesmos itens, estados, prazos e destinatário), o
// planejador grava em payload_summary.digestItems apenas metadados estruturados por item
// (caseKey, nível, estado, prazo e responsável — sem texto livre). Título, resumo, referência,
// área e origem vêm do registro do caso (risk_alert_cases) no momento da retentativa.
//
// Linhas antigas (anteriores a esta correção) só têm caseKeys: o consolidado é reconstruído como
// "em aberto" e sinalizado (reconstructedFromKeys) — a auditoria registra que o conteúdo original
// não estava disponível.

import { caseKeyOf } from "./collect-risk-cases";
import type { DigestContent, DigestItem, RecipientProfile, RiskCaseRecord } from "./types";

/** Ordem do consolidado: MÉDIO antes de BAIXO, prazo mais próximo, título (pt-BR). Fonte única (planejador + retentativa). */
export function compareDigestItems(a: DigestItem, b: DigestItem): number {
  return (
    (a.riskLevel === "MEDIUM" ? 0 : 1) - (b.riskLevel === "MEDIUM" ? 0 : 1) ||
    (a.deadlineAt ?? "9999").localeCompare(b.deadlineAt ?? "9999") ||
    a.title.localeCompare(b.title, "pt-BR")
  );
}

export interface StoredDigestItem {
  caseKey: string;
  riskLevel: "LOW" | "MEDIUM";
  state: DigestItem["state"];
  deadlineAt: string | null;
  responsibleUserId: string | null;
}

/** Metadados persistidos por item (payload_summary.digestItems). */
export function toStoredDigestItems(items: DigestItem[]): StoredDigestItem[] {
  return items.map((i) => ({ caseKey: i.caseKey, riskLevel: i.riskLevel, state: i.state, deadlineAt: i.deadlineAt, responsibleUserId: i.responsibleUserId ?? null }));
}

export interface RebuiltDigest {
  content: DigestContent;
  reconstructedFromKeys: boolean;
  droppedKeys: string[];
}

const STATES: ReadonlySet<string> = new Set(["NEW", "CHANGED", "OPEN", "CLOSED"]);

function parseStoredItems(value: unknown): StoredDigestItem[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: StoredDigestItem[] = [];
  for (const raw of value) {
    const r = raw as Partial<StoredDigestItem> | null;
    if (!r || typeof r.caseKey !== "string" || (r.riskLevel !== "LOW" && r.riskLevel !== "MEDIUM") || typeof r.state !== "string" || !STATES.has(r.state)) return null;
    parsed.push({ caseKey: r.caseKey, riskLevel: r.riskLevel, state: r.state as DigestItem["state"], deadlineAt: typeof r.deadlineAt === "string" ? r.deadlineAt : null, responsibleUserId: typeof r.responsibleUserId === "string" ? r.responsibleUserId : null });
  }
  return parsed;
}

export function rebuildDigestContent(input: { window: string; payloadSummary: Record<string, unknown>; cases: RiskCaseRecord[]; recipients: Map<string, RecipientProfile> }): RebuiltDigest | null {
  const byKey = new Map(input.cases.map((c) => [caseKeyOf(c), c]));
  let stored = parseStoredItems(input.payloadSummary.digestItems);
  let reconstructedFromKeys = false;
  if (!stored) {
    const keys = input.payloadSummary.caseKeys;
    if (!Array.isArray(keys) || keys.length === 0) return null;
    reconstructedFromKeys = true;
    stored = [];
    for (const key of keys) {
      const record = typeof key === "string" ? byKey.get(key) : undefined;
      if (record && (record.riskLevel === "LOW" || record.riskLevel === "MEDIUM")) {
        stored.push({ caseKey: key as string, riskLevel: record.riskLevel, state: record.status === "CLOSED" ? "CLOSED" : "OPEN", deadlineAt: null, responsibleUserId: null });
      }
    }
  }
  const items: DigestItem[] = [];
  const droppedKeys: string[] = [];
  for (const s of stored) {
    const record = byKey.get(s.caseKey);
    if (!record) {
      droppedKeys.push(s.caseKey);
      continue;
    }
    items.push({
      caseKey: s.caseKey,
      riskLevel: s.riskLevel,
      area: record.area,
      title: record.title,
      reference: record.reference,
      summary: record.summary,
      deadlineAt: s.deadlineAt,
      responsibleName: s.responsibleUserId ? (input.recipients.get(s.responsibleUserId)?.name ?? null) : null,
      responsibleUserId: s.responsibleUserId,
      originPath: record.originPath,
      slaActionId: record.slaActionId,
      state: s.state,
    });
  }
  const open = items.filter((i) => i.state !== "CLOSED").sort(compareDigestItems);
  const content: DigestContent = {
    kind: "DIGEST",
    window: input.window,
    mediumItems: open.filter((i) => i.riskLevel === "MEDIUM"),
    lowItems: open.filter((i) => i.riskLevel === "LOW"),
    closedItems: items.filter((i) => i.state === "CLOSED").sort(compareDigestItems),
  };
  if (content.mediumItems.length + content.lowItems.length + content.closedItems.length === 0) return null;
  return { content, reconstructedFromKeys, droppedKeys };
}
