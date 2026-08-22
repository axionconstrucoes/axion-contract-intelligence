import "server-only";

// URL base da aplicação (protocolo + host), usada para montar links
// absolutos em e-mails — nunca inferida de um request (workers/scripts
// não têm isso), nunca inventada. Falha fechado em produção; em
// desenvolvimento assume localhost:3000, que é onde `next dev` roda por
// padrão neste projeto.
export function getAppBaseUrl(): string {
  const configured = process.env.AXION_APP_BASE_URL;
  if (configured && configured.trim()) {
    return configured.trim().replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3000";
  }

  throw new Error(
    "AXION_APP_BASE_URL não configurado — necessário para montar links absolutos em e-mails (ex.: botão RESPONDER AO ACC)."
  );
}
