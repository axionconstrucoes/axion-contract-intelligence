// Autenticação das rotas de cron — PURA (sem "server-only" para ser
// testável por script Node). O segredo só é aceito no header
// `Authorization: Bearer <CRON_SECRET>`: query string, cookies ou outros
// headers nunca autenticam. Comparação em tempo constante; o header nunca
// é registrado nem devolvido.

import { timingSafeEqual } from "node:crypto";

export function isCronRequestAuthorized(request: Pick<Request, "headers">, cronSecret: string | undefined): boolean {
  const expectedSecret = cronSecret?.trim();
  if (!expectedSecret) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const presented = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(expectedSecret);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}
