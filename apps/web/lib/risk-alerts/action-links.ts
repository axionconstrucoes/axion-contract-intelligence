// Links de ação do e-mail — puro. Token curto/aleatório, expirável,
// persistido SÓ como hash; o link abre a página AUTENTICADA do alerta
// com a ação pré-selecionada. GET nunca altera estado: a ação só ocorre
// em POST (server action) revalidado server-side (RPC).

import { createHash, randomBytes } from "node:crypto";

import type { AlertActionType } from "./types";

export const ACTION_LINK_TTL_HOURS = 72;
export const EMAIL_ACTION_TYPES: Exclude<AlertActionType, "RESOLUTION_CONFIRMED">[] = ["RESOLVED", "TAKING_ACTION", "FORWARD", "EXPERT_CONSULTATION", "OTHER"];

export function generateActionToken(): string {
  return randomBytes(18).toString("base64url"); // 24 chars, imprevisível
}

export function hashActionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function actionLinkExpiry(nowIso: string, ttlHours: number = ACTION_LINK_TTL_HOURS): string {
  return new Date(new Date(nowIso).getTime() + ttlHours * 3_600_000).toISOString();
}

/** /{projectId}/alertas/{caseId}?acao=X&t=<token> — rota interna; sem estado alterado por GET. */
export function buildActionLink(baseUrl: string, projectId: string, caseId: string, action: AlertActionType, token: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  return `${clean}/${projectId}/alertas/${caseId}?acao=${encodeURIComponent(action)}&t=${encodeURIComponent(token)}`;
}

export function isActionTokenValid(link: { expiresAt: string; usedAt: string | null } | null, nowIso: string): boolean {
  return Boolean(link && !link.usedAt && link.expiresAt > nowIso);
}
