// Geração PURA da configuração de um stack Supabase local DESCARTÁVEL e identificado.
// Sem I/O e sem rede: testável (scripts/test-clean-local-stack-config.mjs).

export const DISPOSABLE_PREFIX = "acc-disposable-";
export const DEV_PROJECT_ID = "axion-contract-intelligence";

export function assertDisposableName(name) {
  if (typeof name !== "string" || !name.startsWith(DISPOSABLE_PREFIX) || !/^acc-disposable-[a-z0-9-]{3,30}$/.test(name)) {
    throw new Error(`Nome de stack recusado: precisa começar com "${DISPOSABLE_PREFIX}" (a-z, 0-9, hífen).`);
  }
  if (name === DEV_PROJECT_ID) throw new Error("Nome de stack recusado: é o projeto de desenvolvimento.");
}

export function assertSafeBasePort(basePort) {
  // O stack de desenvolvimento usa 54320–54329 e o descartável antigo 56322. A faixa permitida é 57000+.
  if (!Number.isInteger(basePort) || basePort < 57000 || basePort > 59990 || basePort % 10 !== 0) {
    throw new Error("Porta base recusada: use um múltiplo de 10 entre 57000 e 59990 (ex.: 57320).");
  }
}

/**
 * Deriva o config.toml do stack descartável a partir do config.toml do repositório: project_id único,
 * portas 5432x -> base+x, e serviços pesados desligados (studio, analytics, realtime, edge runtime,
 * e-mail local). Nunca inclui referência ao projeto remoto (isso vive em supabase/.temp, que não é copiado).
 */
export function buildDisposableConfig(repoConfigToml, name, basePort) {
  assertDisposableName(name);
  assertSafeBasePort(basePort);
  let toml = repoConfigToml.replace(/^project_id\s*=\s*".*"$/m, `project_id = "${name}"`);
  toml = toml.replace(/\b5432(\d)\b/g, (_, d) => String(basePort + Number(d)));
  for (const section of ["studio", "analytics", "realtime", "edge_runtime", "local_smtp"]) {
    toml = toml.replace(new RegExp(`(\\[${section}\\]\\s*(?:#[^\\n]*\\n\\s*)*enabled = )true`), "$1false");
  }
  return toml;
}

export const BOOTSTRAP_MIGRATION_VERSION = "00000000000001";
export const BOOTSTRAP_MIGRATION_FILE = `${BOOTSTRAP_MIGRATION_VERSION}_bootstrap_default_privileges.sql`;

/** Serviços excluídos de `supabase start` (o necessário fica: db, kong, gotrue, postgrest, storage). */
export const EXCLUDED_SERVICES = "studio,imgproxy,vector,logflare,edge-runtime,realtime,mailpit,postgres-meta,supavisor";
