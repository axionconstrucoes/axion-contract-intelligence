// Trava de segurança da Fase B: impede que qualquer comando de aplicação de migrations/seed
// atinja o banco de PRODUÇÃO por engano. Puro (sem rede, sem I/O além do que o chamador passa).
//
// Regras (falham FECHADO):
//  1. confirmação explícita: ACC_HML_CONFIRM = "STAGING-ONLY-NOT-PRODUCTION";
//  2. a connection string vem de variável de ambiente (nunca de argumento) e NUNCA é impressa;
//  3. o project ref do alvo (extraído do host/usuário) precisa ser IGUAL a ACC_HML_PROJECT_REF;
//  4. a lista de refs de PRODUÇÃO (ACC_PROD_PROJECT_REF, separada por vírgula) é OBRIGATÓRIA e
//     o ref do alvo não pode constar dela (fail-closed: sem lista, recusa);
//  5. alvos que não sejam Supabase hospedado só são aceitos em loopback com allowLocal (testes).

import { createHash } from "node:crypto";

export const CONFIRM_PHRASE = "STAGING-ONLY-NOT-PRODUCTION";

export class GuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GuardError";
    this.code = code;
  }
}

const REF_PATTERN = /^[a-z0-9]{15,30}$/;

/** { kind: "hosted", ref } | { kind: "local" } | { kind: "unknown" } — sem devolver host/usuário/senha. */
export function classifyDbTarget(dbUrl) {
  let url;
  try {
    url = new URL(dbUrl);
  } catch {
    return { kind: "invalid" };
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) return { kind: "invalid" };
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return { kind: "local" };
  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(host);
  if (direct && REF_PATTERN.test(direct[1])) return { kind: "hosted", ref: direct[1] };
  const user = decodeURIComponent(url.username || "");
  const pooled = /^postgres\.([a-z0-9]+)$/.exec(user);
  if (/\.pooler\.supabase\.com$/.test(host) && pooled && REF_PATTERN.test(pooled[1])) return { kind: "hosted", ref: pooled[1] };
  return { kind: "unknown" };
}

export function parseRefList(value) {
  return Array.from(new Set(String(value ?? "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)));
}

/** Identificador seguro para log: nunca o ref completo. */
export function refFingerprint(ref) {
  return createHash("sha256").update(ref).digest("hex").slice(0, 8);
}

export function assertStagingTarget({ dbUrl, stagingRef, productionRefs, confirm, allowLocal = false }) {
  if (confirm !== CONFIRM_PHRASE) throw new GuardError("CONFIRM_MISSING", `Defina ACC_HML_CONFIRM="${CONFIRM_PHRASE}" para confirmar que o alvo é a HOMOLOGAÇÃO.`);
  if (!dbUrl) throw new GuardError("DB_URL_MISSING", "HML_DB_URL ausente (a connection string vem só de variável de ambiente).");
  const target = classifyDbTarget(dbUrl);
  if (target.kind === "invalid") throw new GuardError("DB_URL_INVALID", "HML_DB_URL inválida (esperado postgres://...).");
  if (target.kind === "local") {
    if (!allowLocal) throw new GuardError("LOCAL_NOT_ALLOWED", "Alvo local não é o banco de homologação (use allowLocal apenas em testes).");
    return { ok: true, kind: "local", fingerprint: "local" };
  }
  if (target.kind === "unknown") throw new GuardError("TARGET_NOT_SUPABASE", "Alvo não reconhecido como projeto Supabase hospedado — recusado.");
  const prod = (Array.isArray(productionRefs) ? productionRefs : parseRefList(productionRefs)).map((r) => r.toLowerCase());
  if (prod.length === 0) throw new GuardError("PROD_REFS_MISSING", "ACC_PROD_PROJECT_REF ausente: informe o(s) ref(s) de PRODUÇÃO para a trava poder recusá-los.");
  if (!stagingRef) throw new GuardError("STAGING_REF_MISSING", "ACC_HML_PROJECT_REF ausente.");
  if (prod.includes(target.ref)) throw new GuardError("TARGET_IS_PRODUCTION", "O alvo é o projeto de PRODUÇÃO — recusado.");
  if (stagingRef.toLowerCase() !== target.ref) throw new GuardError("STAGING_REF_MISMATCH", "O ref do alvo não coincide com ACC_HML_PROJECT_REF — recusado.");
  return { ok: true, kind: "hosted", fingerprint: refFingerprint(target.ref) };
}
