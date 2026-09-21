// Credenciais OAuth DEDICADAS da caixa que recebe as respostas aos
// alertas de risco (piloto: axion@axion.com.br) — puro, sem I/O.
//
// A fase `replies` do worker usa EXCLUSIVAMENTE ACC_RISK_ALERTS_INBOUND_*:
// nunca cai para GOOGLE_GMAIL_INBOUND_* (credenciais do Gmail Inbound Sync,
// que pertencem a outra caixa e não podem ser tocadas). Regras fail-closed:
//   - qualquer variável ausente/vazia  => SKIPPED_NOT_CONFIGURED (a fase é
//     pulada; as demais fases do job seguem normalmente);
//   - perfil Gmail autenticado ≠ caixa configurada => fase BLOQUEADA;
//   - override de entrega do projeto ≠ caixa configurada => projeto pulado
//     (as respostas chegariam a uma caixa que este worker não lê).
// Nenhum valor (token, client secret, Authorization) é devolvido em
// mensagens: só NOMES de variáveis e motivos.
//
// Escopo OAuth mínimo: a fase só executa users.getProfile,
// users.messages.list, users.messages.get e users.threads.get — todas de
// leitura => https://www.googleapis.com/auth/gmail.readonly. Nenhum label
// é alterado e nada é enviado por esta credencial.

export const RISK_ALERTS_INBOUND_ENV = {
  clientId: "ACC_RISK_ALERTS_INBOUND_CLIENT_ID",
  clientSecret: "ACC_RISK_ALERTS_INBOUND_CLIENT_SECRET",
  refreshToken: "ACC_RISK_ALERTS_INBOUND_REFRESH_TOKEN",
  mailbox: "ACC_RISK_ALERTS_INBOUND_MAILBOX",
} as const;

export const RISK_ALERTS_INBOUND_GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export interface RiskAlertInboundCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Caixa normalizada (lowercase). */
  mailbox: string;
}

export type RiskAlertInboundResolution =
  | { ok: true; credentials: RiskAlertInboundCredentials }
  | { ok: false; status: "SKIPPED_NOT_CONFIGURED"; missing: string[] };

const MAILBOX_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Lê SOMENTE as variáveis dedicadas do ambiente informado; sem fallback. */
export function resolveRiskAlertInboundCredentials(env: Record<string, string | undefined>): RiskAlertInboundResolution {
  const read = (name: string) => (env[name] ?? "").trim();
  const missing = Object.values(RISK_ALERTS_INBOUND_ENV).filter((name) => read(name) === "");
  const mailbox = read(RISK_ALERTS_INBOUND_ENV.mailbox).toLowerCase();
  if (missing.length === 0 && !MAILBOX_PATTERN.test(mailbox)) missing.push(RISK_ALERTS_INBOUND_ENV.mailbox);
  if (missing.length > 0) return { ok: false, status: "SKIPPED_NOT_CONFIGURED", missing };
  return {
    ok: true,
    credentials: {
      clientId: read(RISK_ALERTS_INBOUND_ENV.clientId),
      clientSecret: read(RISK_ALERTS_INBOUND_ENV.clientSecret),
      refreshToken: read(RISK_ALERTS_INBOUND_ENV.refreshToken),
      mailbox,
    },
  };
}

/** true somente quando o e-mail do perfil autenticado é exatamente a caixa configurada. */
export function inboundProfileMatchesMailbox(profileEmail: string | null | undefined, mailbox: string): boolean {
  const profile = (profileEmail ?? "").trim().toLowerCase();
  return profile !== "" && profile === mailbox.trim().toLowerCase();
}

export type OverrideCompatibility = { ok: true } | { ok: false; status: "BLOCKED_OVERRIDE_MISMATCH" };

/** Projeto com override de entrega: as respostas só podem ser lidas se o override for a própria caixa dedicada. */
export function checkOverrideCompatibility(mailbox: string, overrideEmail: string | null | undefined): OverrideCompatibility {
  const override = (overrideEmail ?? "").trim().toLowerCase();
  if (override === "" || override === mailbox.trim().toLowerCase()) return { ok: true };
  return { ok: false, status: "BLOCKED_OVERRIDE_MISMATCH" };
}
