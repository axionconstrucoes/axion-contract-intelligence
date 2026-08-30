// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.
//
// Único validador de "destino interno seguro" usado no retorno pós-login
// (proxy.ts -> /login?next=... -> auth/callback/route.ts, único fluxo de
// login — Google-only, login/actions.ts por senha foi removido). Lista
// de permissão (nunca lista de bloqueio):
// só aceita um path relativo começando por exatamente uma "/", usando só
// caracteres normais de URL — qualquer coisa fora desse conjunto
// (barra dupla, "://", backslash, espaço, caractere de controle) é
// rejeitada por construção, não por um caso específico lembrado depois.
const SAFE_INTERNAL_PATH_PATTERN = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/;

export function isSafeInternalPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 2048) return false;
  // "//evil.com" e "/\evil.com" (alguns navegadores tratam "\" como "/")
  // são URLs absolutas disfarçadas de path relativo — nunca aceitas.
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  if (value.includes("\\")) return false;
  if (value.includes("://")) return false;
  return SAFE_INTERNAL_PATH_PATTERN.test(value);
}

// Devolve o próprio valor quando seguro, senão o fallback — nunca lança,
// nunca deixa a chamada seguir com um destino não validado por engano.
export function sanitizeInternalRedirect(value: unknown, fallback: string): string {
  return isSafeInternalPath(value) ? value : fallback;
}
