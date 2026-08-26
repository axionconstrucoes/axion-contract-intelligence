// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone
// (mesmo padrão de apps/web/lib/documents/multi-upload/sha256.ts, mas
// não reaproveitado diretamente daquele módulo — feature diferente,
// sem motivo para acoplar um import cruzado só por 5 linhas idênticas).
//
// O token BRUTO só existe em memória de quem monta o e-mail e na URL
// enviada ao destinatário — nunca em banco, auditoria ou log. Só o hash
// (sha256 hex) é persistido (email_alert_action_tokens.token_hash).

export async function hashEmailActionToken(rawToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawToken));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
