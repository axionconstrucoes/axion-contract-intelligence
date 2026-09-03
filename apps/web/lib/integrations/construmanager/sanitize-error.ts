// Funções puras extraídas de app/[projectId]/integracoes/actions.ts —
// um módulo "use server" só pode exportar funções async (restrição do
// Next.js), então esta lógica fica aqui para poder ser testada
// isoladamente sem precisar de sessão Supabase nem de rede real.

// Construmanager é acessado ao vivo (Login/Auth + Obra/List) — nunca
// deixar vazar Bearer token ou credencial no erro devolvido à UI/gravado
// no banco (last_connection_error). Truncado em 500 chars: mensagens da
// API de terceiro podem ser verbosas.
export function sanitizeIntegrationConnectionError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  return raw
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/token\s*[:=]\s*\S+/gi, "token=[REDACTED]")
    .slice(0, 500);
}

// ATENCAO = falha transitória (rede/infra do fornecedor) — vale nova
// tentativa depois; ERRO = configuração/credencial errada, não some
// sozinho.
export function classifyConstrumanagerConnectionFailure(
  message: string
): "ATENCAO" | "ERRO" {
  if (
    /timed out|timeout|aborted|fetch failed|ECONNRESET|ENOTFOUND/i.test(message) ||
    /HTTP 429\b/i.test(message) ||
    /HTTP 5\d\d\b/i.test(message)
  ) {
    return "ATENCAO";
  }

  return "ERRO";
}
