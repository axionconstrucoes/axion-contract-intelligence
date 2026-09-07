// Politica de sincronizacao do Diario de Obra.
//
// Modulo puro: sem rede, sem banco, sem Supabase, sem IA. Decide o que
// PODE acontecer; quem executa e' o worker.
//
// FAIL-CLOSED EM TODAS AS BORDAS
//
// Interruptor ausente, vazio, com espaco ou diferente de "true" ⇒
// desligado. Nao existe default permissivo: uma variavel mal digitada
// nunca pode ligar uma ingestao.
//
// ZERO TOKEN DE LLM
//
// Nada aqui aciona IA, e nao ha caminho de codigo neste modulo — nem
// nos que ele governa — capaz de fazer isso. A analise por especialista
// e' etapa futura, com interruptor proprio que ainda nao existe.

const VALOR_LIGADO = "true";

export type DiarioSyncMode = "BASELINE" | "INCREMENTAL" | "RECONCILE";

/**
 * BASELINE   importacao historica controlada, por janelas, com
 *            checkpoint. Nao gera alteracao nem alerta.
 * INCREMENTAL janela movel curta; so busca detalhe de RDO novo ou
 *            alterado.
 * RECONCILE  varredura periodica do historico inteiro. PREPARADO, sem
 *            schedule nesta etapa — existe porque os filtros da API sao
 *            pela DATA DO RELATORIO, nao por `modified`: uma edicao
 *            feita hoje num RDO de dois anos atras fica fora da janela
 *            incremental e so a reconciliacao a encontraria.
 */
export const MODOS_VALIDOS: readonly DiarioSyncMode[] = Object.freeze([
  "BASELINE",
  "INCREMENTAL",
  "RECONCILE",
]);

/** Tetos de detalhe por execucao, por modo. */
export const MAX_DETALHES_BASELINE = 20;
export const MAX_DETALHES_INCREMENTAL = 10;

/** Janela movel do incremental, em dias de DATA DO RELATORIO. */
export const JANELA_INCREMENTAL_DIAS = 14;

/**
 * Piso ABSOLUTO do baseline, usado so quando a data de inicio do
 * projeto nao for legivel. Existe para que a varredura termine sempre.
 */
export const BASELINE_DATA_MINIMA = "2015-01-01";

/** Tamanho de cada janela do baseline, em dias. */
export const BASELINE_JANELA_DIAS = 90;

export interface DiarioSyncEnv {
  DIARIO_DE_OBRA_SYNC_ENABLED?: string;
}

export interface DecisaoDeSincronizacao {
  enabled: boolean;
  reason: string;
}

export function resolveDiarioSyncEnabled(env: DiarioSyncEnv): DecisaoDeSincronizacao {
  const bruto = (env.DIARIO_DE_OBRA_SYNC_ENABLED ?? "").trim();

  if (bruto === VALOR_LIGADO) {
    return { enabled: true, reason: "DIARIO_DE_OBRA_SYNC_ENABLED=true." };
  }

  return {
    enabled: false,
    reason:
      bruto === ""
        ? "DIARIO_DE_OBRA_SYNC_ENABLED ausente — sincronizacao desligada (fail-closed)."
        : 'DIARIO_DE_OBRA_SYNC_ENABLED diferente de "true" — sincronizacao desligada.',
  };
}

export function resolveModo(bruto: string | undefined): DiarioSyncMode | null {
  const valor = (bruto ?? "").trim().toUpperCase();
  return (MODOS_VALIDOS as readonly string[]).includes(valor)
    ? (valor as DiarioSyncMode)
    : null;
}

export function maxDetalhesPara(modo: DiarioSyncMode): number {
  return modo === "BASELINE" ? MAX_DETALHES_BASELINE : MAX_DETALHES_INCREMENTAL;
}

export interface Janela {
  inicio: string;
  fim: string;
}

function paraData(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function paraIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

export function somarDias(iso: string, dias: number): string {
  const d = paraData(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return paraIso(d);
}

export function diasEntre(inicio: string, fim: string): number {
  return Math.round((paraData(fim).getTime() - paraData(inicio).getTime()) / 86_400_000);
}

/** Janela movel do incremental, ancorada em uma data de referencia. */
export function janelaIncremental(hojeIso: string): Janela {
  return { inicio: somarDias(hojeIso, -(JANELA_INCREMENTAL_DIAS - 1)), fim: hojeIso };
}

/**
 * Janela do baseline — DECRESCENTE, a partir de hoje.
 *
 * A primeira execucao precisa trazer os RDOs MAIS RECENTES: eles sao os
 * que interessam a quem esta acompanhando a obra agora. Comecar num piso
 * historico e caminhar para frente gastaria dezenas de janelas vazias
 * antes de alcancar 2026 — e a primeira execucao entregaria nada.
 *
 * `proximaJanelaFim` vem do checkpoint da execucao anterior e aponta
 * para o dia imediatamente ANTERIOR a janela ja varrida.
 *
 * O `piso` corta a janela: nunca se varre antes do inicio do projeto.
 */
export function janelaBaseline(
  hojeIso: string,
  proximaJanelaFim: string | null | undefined,
  pisoIso: string
): Janela | null {
  const fim = proximaJanelaFim ?? hojeIso;

  // Ja varremos ate o piso: o historico acabou.
  if (fim < pisoIso) return null;

  const inicioBruto = somarDias(fim, -(BASELINE_JANELA_DIAS - 1));
  const inicio = inicioBruto < pisoIso ? pisoIso : inicioBruto;

  return { inicio, fim };
}

/**
 * Proximo `fim` do baseline: o dia anterior ao inicio da janela atual.
 * So deve ser gravado quando a janela terminou de verdade — cobertura
 * garantida e sem candidatos pendentes.
 */
export function proximaJanelaBaseline(janela: Janela): string {
  return somarDias(janela.inicio, -1);
}

/** O baseline terminou quando nao ha mais janela abaixo do piso. */
export function baselineConcluido(
  proximaJanelaFim: string | null | undefined,
  pisoIso: string
): boolean {
  return proximaJanelaFim !== null && proximaJanelaFim !== undefined && proximaJanelaFim < pisoIso;
}


/*
 * ESTADO DE RETOMADA DO BASELINE
 *
 * A versao anterior guardava so `proximaJanelaFim`, gravado apenas quando
 * a janela terminava. Um run que batia no teto de 20 nao gravava nada, e
 * o processo seguinte — outro processo, outra maquina, sem memoria —
 * relia `null` e recomecava de HOJE. Foi o que aconteceu no run
 * 34142741140: ele voltou a janela ja completa em vez de continuar a que
 * tinha 49 pendentes.
 *
 * A causa nao era o calculo da janela: era o checkpoint nao dizer QUAL
 * janela estava em curso. Agora ele diz, sempre.
 */
export interface CheckpointBaseline {
  /** Janela que este run processou. */
  currentWindowStart: string | null;
  currentWindowEnd: string | null;
  /** Por onde o PROXIMO processo retoma. `null` = acabou. */
  resumeWindowEnd: string | null;
  candidatesRemaining: number;
  coverageGuaranteed: boolean;
  baselineComplete: boolean;
  piso: string;
  totalNaOrigem: number;
}

/**
 * Le a retomada, aceitando checkpoints antigos.
 *
 * Ordem de prioridade e' deliberada:
 *
 *   resumeWindowEnd    formato novo, sempre correto;
 *   proximaJanelaFim   formato antigo, gravado SO quando a janela
 *                      terminou — significa "comece na anterior";
 *   janelaFimAtual /
 *   janelaFim          formato antigo de uma janela NAO terminada —
 *                      significa "continue nesta".
 *
 * `proximaJanelaFim` precisa vir ANTES de `janelaFim`: o checkpoint
 * legado do run 34142741140 tem os dois (2026-06-09 e 2026-09-07), e
 * preferir `janelaFim` reproduziria exatamente o defeito.
 */
export function lerRetomadaBaseline(
  checkpoint: Record<string, unknown> | null | undefined
): { resumeWindowEnd: string | null; baselineComplete: boolean } {
  if (!checkpoint) return { resumeWindowEnd: null, baselineComplete: false };

  if (checkpoint.baselineComplete === true) {
    return { resumeWindowEnd: null, baselineComplete: true };
  }

  const candidatos = [
    checkpoint.resumeWindowEnd,
    checkpoint.proximaJanelaFim,
    checkpoint.janelaFimAtual,
    checkpoint.janelaFim,
  ];

  for (const valor of candidatos) {
    if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      return { resumeWindowEnd: valor, baselineComplete: false };
    }
  }

  return { resumeWindowEnd: null, baselineComplete: false };
}

/**
 * Monta o checkpoint a partir do que ESTE run observou.
 *
 *   1. sobraram candidatos  -> retoma a MESMA janela;
 *   2. janela esgotada      -> retoma no dia anterior ao inicio dela;
 *   3. abaixo do piso       -> baseline completo, sem retomada.
 *
 * Cobertura incerta tambem mantem a janela: uma janela que nao pode ser
 * garantida nao pode ser dada por concluida.
 */
export function montarCheckpointBaseline(entrada: {
  janela: Janela;
  candidatesRemaining: number;
  coverageGuaranteed: boolean;
  piso: string;
  totalNaOrigem: number;
}): CheckpointBaseline {
  const { janela, candidatesRemaining, coverageGuaranteed, piso, totalNaOrigem } = entrada;

  const esgotada = candidatesRemaining === 0 && coverageGuaranteed;

  let resumeWindowEnd: string | null = esgotada
    ? somarDias(janela.inicio, -1)
    : janela.fim;

  let baselineComplete = false;

  if (resumeWindowEnd !== null && resumeWindowEnd < piso) {
    baselineComplete = true;
    resumeWindowEnd = null;
  }

  return {
    currentWindowStart: janela.inicio,
    currentWindowEnd: janela.fim,
    resumeWindowEnd,
    candidatesRemaining,
    coverageGuaranteed,
    baselineComplete,
    piso,
    totalNaOrigem,
  };
}

/**
 * Subdivisao de janela cheia.
 *
 * A API nao tem pagina, offset nem cursor: o unico controle e' `limite`.
 * Uma janela que devolve EXATAMENTE o limite pode estar truncada, e
 * tratar isso como cobertura completa perderia RDOs em silencio. Entao
 * a janela e' partida ao meio e cada metade e' varrida.
 */
export function subdividirJanela(janela: Janela): Janela[] {
  const total = diasEntre(janela.inicio, janela.fim);

  if (total <= 0) return [];

  const metade = Math.floor(total / 2);

  return [
    { inicio: janela.inicio, fim: somarDias(janela.inicio, metade) },
    { inicio: somarDias(janela.inicio, metade + 1), fim: janela.fim },
  ];
}

export type ResultadoDeJanela =
  | { tipo: "COMPLETA" }
  | { tipo: "SUBDIVIDIR"; partes: Janela[] }
  | { tipo: "FAIL_CLOSED"; motivo: string };

/**
 * Decide o que fazer com o resultado de uma janela.
 *
 * Um dia unico ainda cheio e' o fim da linha: nao ha como estreitar
 * mais, e a API nao oferece paginacao. Nesse caso a cobertura NAO pode
 * ser garantida, e a execucao para em fail-closed dizendo isso — nunca
 * finge que varreu tudo.
 */
export function avaliarJanela(janela: Janela, recebidos: number, limite: number): ResultadoDeJanela {
  if (recebidos < limite) return { tipo: "COMPLETA" };

  if (janela.inicio === janela.fim) {
    return {
      tipo: "FAIL_CLOSED",
      motivo:
        `A janela de um unico dia (${janela.inicio}) devolveu o lote cheio (${limite}). ` +
        "A API nao oferece paginacao e nao ha como estreitar mais: a cobertura completa " +
        "desta data NAO pode ser garantida.",
    };
  }

  return { tipo: "SUBDIVIDIR", partes: subdividirJanela(janela) };
}
