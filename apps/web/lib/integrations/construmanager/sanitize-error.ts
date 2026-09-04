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

// A rota ListaMestra/List devolve, em requisição malformada, o stack
// trace COMPLETO do SQL Server: System.Data.SqlClient.SqlException,
// nomes de tabela/coluna, ClientConnectionId e o caminho das classes
// internas do fornecedor. Nada disso pode chegar à UI nem ao banco.
//
// Além do que sanitizeIntegrationConnectionError já cobre, aqui a
// mensagem é cortada no primeiro sinal de stack trace e substituída por
// um texto estável e acionável.
const SQL_LEAK_MARKERS =
  /(System\.Data\.SqlClient|SqlException|ClientConnectionId|at System\.|at Construmanager|Error Number:\s*\d+|Entity\.Core|EntityCommandDefinition|inner exception)/i;

export function sanitizeConstrumanagerApiError(error: unknown): string {
  const base = sanitizeIntegrationConnectionError(error);

  if (SQL_LEAK_MARKERS.test(base)) {
    return "A API do Construmanager rejeitou a consulta de metadados. Detalhe técnico omitido por segurança.";
  }

  // Defesa em profundidade: qualquer quebra de linha indica resposta
  // multi-linha do fornecedor (stack trace é sempre multi-linha).
  const firstLine = base.split(/\r?\n/)[0].trim();

  return firstLine.slice(0, 500) || "Falha ao consultar metadados do Construmanager.";
}

// Pacote C: o download real manipula arquivos temporários locais, e um
// erro de sistema de arquivos (ENOENT, EACCES, EBUSY) carrega o caminho
// absoluto na mensagem. Esse caminho não é segredo, mas expõe layout de
// infraestrutura e polui download_error — a migration exige que ele
// nunca seja gravado.
//
// Aditiva de propósito: envolve o sanitizador da API em vez de alterá-lo,
// para não mexer no comportamento já testado dos Pacotes A e B.
const FILESYSTEM_PATH_MARKERS =
  /(?:[A-Za-z]:\\[^\s'"]+|\/(?:tmp|var|home|users|private)\/[^\s'"]+)/gi;

export function sanitizeConstrumanagerContentError(error: unknown): string {
  const base = sanitizeConstrumanagerApiError(error);

  const withoutPaths = base.replace(FILESYSTEM_PATH_MARKERS, "[caminho local omitido]");

  return (
    withoutPaths.slice(0, 500) ||
    "Falha ao baixar o conteúdo do Construmanager."
  );
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
