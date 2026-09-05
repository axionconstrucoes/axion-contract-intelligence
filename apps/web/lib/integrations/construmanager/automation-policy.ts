// Pacote D — politica da ingestao automatica de conteudo do Construmanager.
//
// Modulo puro de proposito: nenhuma rede, nenhum Supabase, sem
// diretiva de modulo restrito ao servidor. Toda a decisao de SE, QUANTO e ATE QUE TAMANHO a
// automacao pode agir mora aqui, onde e verificavel por teste sem
// depender de banco, de credencial ou do agendador.
//
// Regra que atravessa o arquivo inteiro: FAIL-CLOSED. Variavel ausente,
// vazia, mal formada ou fora de faixa NAO cai num default permissivo —
// desliga a automacao e diz por que. O modo perigoso exige uma
// afirmacao explicita e exata; o modo seguro e o que acontece sozinho.

/** Valor que liga a automacao. Qualquer outro mantem desligado. */
const ENABLED_VALUE = "true";

/** Valor que desliga o dry-run. Qualquer outro mantem dry-run ligado. */
const DRY_RUN_OFF_VALUE = "false";

/** Valor que aciona a parada de emergencia. */
const KILL_SWITCH_VALUE = "true";

/**
 * Teto absoluto de itens por rodada.
 *
 * Nao e opiniao: `claim_construmanager_content_targets` recusa
 * p_limit > 100, e o piloto mostrou ~12 s por arquivo. Um lote grande
 * estouraria o orcamento de tempo antes de terminar.
 */
export const MAX_ITEMS_CEILING = 50;

/**
 * Teto absoluto por arquivo: 2 GiB, o limite declarado do bucket.
 * Configurar acima disso seria pedir uma falha garantida no Storage.
 */
export const MAX_FILE_BYTES_CEILING = 2 * 1024 * 1024 * 1024;

/** Teto de tempo por rodada. O runner do agendador tem seu proprio limite. */
export const TIME_BUDGET_CEILING_MS = 4 * 60 * 60 * 1000;

/** Tentativas automaticas antes de exigir decisao humana. */
export const MAX_AUTO_ATTEMPTS = 3;

/**
 * Duracao do lease.
 *
 * Precisa ser maior que o pior download plausivel (o cliente usa timeout
 * de 15 min) e menor que o intervalo entre rodadas, para que um worker
 * morto libere o item antes da proxima execucao.
 */
export const LEASE_SECONDS = 20 * 60;

export interface AutomationConfig {
  enabled: boolean;
  dryRun: boolean;
  maxItems: number;
  maxFileBytes: number;
  timeBudgetMs: number;
  leaseSeconds: number;
  maxAutoAttempts: number;
}

export interface AutomationDecision {
  /** true somente quando TODAS as condicoes de seguranca foram atendidas. */
  enabled: boolean;
  /** Motivo legivel de a automacao estar desligada. null quando ligada. */
  reason: string | null;
  config: AutomationConfig;
}

export interface AutomationEnv {
  CONSTRUMANAGER_METADATA_SYNC_ENABLED?: string;
  CONSTRUMANAGER_VERSION_MONITORING_ENABLED?: string;
  CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED?: string;
  CONSTRUMANAGER_AUTO_DRY_RUN?: string;
  CONSTRUMANAGER_AUTO_MAX_ITEMS?: string;
  CONSTRUMANAGER_AUTO_MAX_FILE_BYTES?: string;
  CONSTRUMANAGER_AUTO_TIME_BUDGET_MS?: string;
  CONSTRUMANAGER_AUTO_KILL_SWITCH?: string;
}

const DISABLED_CONFIG: AutomationConfig = {
  enabled: false,
  // Dry-run ligado ate no config desligado: se algum caminho de codigo
  // ignorar `enabled` por engano, ainda assim nao grava nada.
  dryRun: true,
  maxItems: 0,
  maxFileBytes: 0,
  timeBudgetMs: 0,
  leaseSeconds: LEASE_SECONDS,
  maxAutoAttempts: MAX_AUTO_ATTEMPTS,
};

function parseBoundedInteger(
  raw: string | undefined,
  { min, max }: { min: number; max: number }
): number | null {
  if (raw === undefined) return null;

  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Somente digitos: "10abc", "1e3", " 10 " com sinal e afins sao
  // rejeitados em vez de virarem um numero por coincidencia do Number().
  if (!/^\d+$/.test(trimmed)) return null;

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return null;
  if (value < min || value > max) return null;

  return value;
}

/**
 * Resolve a configuracao da automacao a partir do ambiente.
 *
 * Devolve sempre uma decisao explicita — nunca lanca. O chamador nao
 * pode "esquecer" de tratar o erro e sair executando.
 */
export function resolveAutomationConfig(env: AutomationEnv): AutomationDecision {
  const off = (reason: string): AutomationDecision => ({
    enabled: false,
    reason,
    config: DISABLED_CONFIG,
  });

  // Kill switch tem precedencia sobre tudo, inclusive sobre a variavel
  // de habilitacao. E o botao de parada que nao exige entender o resto.
  if ((env.CONSTRUMANAGER_AUTO_KILL_SWITCH ?? "").trim() === KILL_SWITCH_VALUE) {
    return off("Kill switch acionado (CONSTRUMANAGER_AUTO_KILL_SWITCH=true).");
  }

  const enabledRaw = (env.CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED ?? "").trim();

  if (enabledRaw !== ENABLED_VALUE) {
    return off(
      enabledRaw === ""
        ? "CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED ausente — automacao desligada (fail-closed)."
        : "CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED diferente de \"true\" — automacao desligada."
    );
  }

  const maxItems = parseBoundedInteger(env.CONSTRUMANAGER_AUTO_MAX_ITEMS, {
    min: 1,
    max: MAX_ITEMS_CEILING,
  });

  if (maxItems === null) {
    return off(
      `CONSTRUMANAGER_AUTO_MAX_ITEMS ausente ou fora da faixa 1..${MAX_ITEMS_CEILING} — automacao desligada.`
    );
  }

  const maxFileBytes = parseBoundedInteger(env.CONSTRUMANAGER_AUTO_MAX_FILE_BYTES, {
    min: 1,
    max: MAX_FILE_BYTES_CEILING,
  });

  if (maxFileBytes === null) {
    return off(
      `CONSTRUMANAGER_AUTO_MAX_FILE_BYTES ausente ou fora da faixa 1..${MAX_FILE_BYTES_CEILING} — automacao desligada.`
    );
  }

  const timeBudgetMs = parseBoundedInteger(env.CONSTRUMANAGER_AUTO_TIME_BUDGET_MS, {
    min: 1000,
    max: TIME_BUDGET_CEILING_MS,
  });

  if (timeBudgetMs === null) {
    return off(
      `CONSTRUMANAGER_AUTO_TIME_BUDGET_MS ausente ou fora da faixa 1000..${TIME_BUDGET_CEILING_MS} — automacao desligada.`
    );
  }

  // Dry-run e o padrao. Sair dele exige o valor exato "false".
  const dryRun = (env.CONSTRUMANAGER_AUTO_DRY_RUN ?? "").trim() !== DRY_RUN_OFF_VALUE;

  return {
    enabled: true,
    reason: null,
    config: {
      enabled: true,
      dryRun,
      maxItems,
      maxFileBytes,
      timeBudgetMs,
      leaseSeconds: LEASE_SECONDS,
      maxAutoAttempts: MAX_AUTO_ATTEMPTS,
    },
  };
}

/**
 * Backoff exponencial entre tentativas automaticas.
 *
 * 1a falha -> 5 min, 2a -> 30 min, 3a -> esgotado (o chamador nao
 * reagenda). Nao ha jitter porque so existe um worker por vez: nao ha
 * rebanho para dispersar, e um valor deterministico e testavel.
 */
export function computeBackoffSeconds(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt <= 1) return 5 * 60;
  if (attempt === 2) return 30 * 60;
  return 2 * 60 * 60;
}

/**
 * Motivos de DECISAO HUMANA — reservados a anomalia real.
 *
 * Tamanho grande NAO esta aqui, e isso e deliberado: arquivo grande e
 * uma decisao de armazenamento ja tomada (fica no Construmanager), nao
 * uma pendencia que alguem precise resolver. Trata-lo como pendencia
 * produziria uma caixa de entrada permanentemente cheia de itens sem
 * acao possivel — o tipo de alerta que ensina a equipe a ignorar
 * alertas.
 */
export type HumanDecisionReason =
  | "TAMANHO_DESCONHECIDO"
  | "METADADOS_INCONSISTENTES"
  | "TENTATIVAS_AUTOMATICAS_ESGOTADAS";

/** Motivo da classificacao como referencia externa. */
export const EXTERNAL_REFERENCE_REASON = "ACIMA_DO_LIMITE_DE_ARMAZENAMENTO";

/**
 * Tres destinos possiveis, e apenas tres:
 *
 *   ELEGIVEL           entra na fila de download
 *   REFERENCIA_EXTERNA fica no Construmanager, por politica
 *   DECISAO_HUMANA     anomalia real, precisa de gente
 */
export type SizeClassification =
  | "ELEGIVEL"
  | "REFERENCIA_EXTERNA"
  | "DECISAO_HUMANA";

export interface SizePolicyVerdict {
  classification: SizeClassification;
  /** Atalho: true somente para ELEGIVEL. */
  eligible: boolean;
  reason: HumanDecisionReason | typeof EXTERNAL_REFERENCE_REASON | null;
  detail: string | null;
}

/**
 * Classifica um item pelo tamanho, a partir dos METADADOS ja
 * sincronizados — nunca de um download exploratorio.
 *
 * O arquivo grande e separado antes de qualquer byte trafegar: nao entra
 * na fila, nao consome tentativa, nao entra em backoff e nao bloqueia os
 * menores. Ele nao "falhou" — ele nao deve ser copiado.
 *
 * A comparacao e estritamente `>`: um arquivo com exatamente o tamanho
 * do limite ainda e elegivel. O limite e o maior tamanho aceito, nao o
 * primeiro rejeitado.
 */
export function evaluateSizePolicy(
  sizeBytes: number | null,
  maxFileBytes: number
): SizePolicyVerdict {
  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return {
      classification: "DECISAO_HUMANA",
      eligible: false,
      reason: "TAMANHO_DESCONHECIDO",
      detail:
        "Tamanho ausente ou invalido nos metadados: sem ele nao da para classificar nem estimar custo de disco e tempo.",
    };
  }

  if (sizeBytes > maxFileBytes) {
    return {
      classification: "REFERENCIA_EXTERNA",
      eligible: false,
      reason: EXTERNAL_REFERENCE_REASON,
      detail: `${sizeBytes} bytes excede o limite de armazenamento de ${maxFileBytes} bytes — o arquivo permanece no Construmanager.`,
    };
  }

  return { classification: "ELEGIVEL", eligible: true, reason: null, detail: null };
}

/**
 * Ainda ha orcamento de tempo para mais um item?
 *
 * Conservador de proposito: exige espaco para o item mais lento ja
 * observado, nao para o medio. Parar cedo devolve o lease e a fila
 * continua na proxima rodada; estourar o limite do runner mataria o
 * processo no meio de um upload.
 */
export function hasTimeBudgetFor(
  elapsedMs: number,
  timeBudgetMs: number,
  reserveMs: number
): boolean {
  return elapsedMs + reserveMs <= timeBudgetMs;
}

/** Reserva padrao por item: o piloto levou ~14 s; 3 min cobre folga larga. */
export const DEFAULT_ITEM_RESERVE_MS = 3 * 60 * 1000;

// ---------------------------------------------------------------------
// TRES PROCESSOS, TRES INTERRUPTORES INDEPENDENTES
// ---------------------------------------------------------------------
//
//   A. sincronizacao de metadados  -> CONSTRUMANAGER_METADATA_SYNC_ENABLED
//   B. deteccao de vigencia        -> CONSTRUMANAGER_VERSION_MONITORING_ENABLED
//   C. download de conteudo        -> CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED
//
// Nenhum habilita o outro, nem por omissao nem por heranca. Monitorar
// versoes com downloads DESLIGADOS e o modo de operacao esperado: saber
// que um projeto mudou de revisao nao exige — e nao deve exigir — ter a
// copia binaria do arquivo.
//
// O kill switch continua valendo para os tres: e a parada de emergencia
// que nao exige entender qual processo esta fazendo o que.

export interface ProcessDecision {
  enabled: boolean;
  reason: string | null;
}

function resolveIndependentSwitch(
  env: Record<string, string | undefined>,
  variable: string
): ProcessDecision {
  if ((env.CONSTRUMANAGER_AUTO_KILL_SWITCH ?? "").trim() === KILL_SWITCH_VALUE) {
    return {
      enabled: false,
      reason: "Kill switch acionado (CONSTRUMANAGER_AUTO_KILL_SWITCH=true).",
    };
  }

  const raw = (env[variable] ?? "").trim();

  if (raw !== ENABLED_VALUE) {
    return {
      enabled: false,
      reason:
        raw === ""
          ? `${variable} ausente — processo desligado (fail-closed).`
          : `${variable} diferente de "true" — processo desligado.`,
    };
  }

  return { enabled: true, reason: null };
}

/** A. Sincronizacao de metadados. Independente de B e de C. */
export function resolveMetadataSyncEnabled(
  env: Record<string, string | undefined>
): ProcessDecision {
  return resolveIndependentSwitch(env, "CONSTRUMANAGER_METADATA_SYNC_ENABLED");
}

/**
 * B. Monitoramento de versao vigente. Independente de A e de C.
 *
 * Em especial: NAO le CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED. Com os
 * downloads desligados, o monitoramento continua funcionando — que e
 * exatamente o cenario do IFC de 262,9 MiB, que nunca sera baixado e
 * mesmo assim precisa ser monitorado.
 */
export function resolveVersionMonitoringEnabled(
  env: Record<string, string | undefined>
): ProcessDecision {
  return resolveIndependentSwitch(env, "CONSTRUMANAGER_VERSION_MONITORING_ENABLED");
}
