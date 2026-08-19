import "server-only";

export type EmailProviderName = "fake" | "gmail";

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  senderEmail: string;
}

// DEFAULT "fake" — nunca cai silenciosamente para fake se "gmail" foi
// explicitamente escolhido e a config estiver incompleta (ver loadGmailConfig).
export function resolveEmailProviderName(): EmailProviderName {
  const raw = (process.env.AXION_EMAIL_PROVIDER ?? "fake").trim().toLowerCase();

  if (raw === "fake" || raw === "gmail") {
    return raw;
  }

  throw new Error(
    `AXION_EMAIL_PROVIDER inválido: "${raw}". Valores permitidos: "fake" ou "gmail".`
  );
}

// FAIL CLOSED: lança erro imediatamente se qualquer variável estiver
// ausente — nunca completa parcialmente, nunca loga os valores.
export function loadGmailConfig(): GmailConfig {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_GMAIL_REFRESH_TOKEN;
  const senderEmail = process.env.GOOGLE_GMAIL_SENDER_EMAIL;

  const missing: string[] = [];
  if (!clientId) missing.push("GOOGLE_GMAIL_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_GMAIL_CLIENT_SECRET");
  if (!refreshToken) missing.push("GOOGLE_GMAIL_REFRESH_TOKEN");
  if (!senderEmail) missing.push("GOOGLE_GMAIL_SENDER_EMAIL");

  if (missing.length > 0) {
    throw new Error(
      `Configuração do GmailEmailProvider incompleta — variáveis ausentes: ${missing.join(", ")}. AXION_EMAIL_PROVIDER=gmail não pode operar sem configuração completa (fail closed).`
    );
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    refreshToken: refreshToken!,
    senderEmail: senderEmail!,
  };
}
