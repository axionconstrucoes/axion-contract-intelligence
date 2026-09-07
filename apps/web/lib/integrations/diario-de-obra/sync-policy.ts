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

/**
 * Teto do RECONCILE.
 *
 * Igual ao incremental, e nao ao baseline, de proposito: a reconciliacao
 * roda sobre historico ja importado, onde o esperado e' encontrar POUCO
 * ou NADA. Um teto alto ali nao aceleraria nada e so ampliaria o
 * estrago de um engano — a varredura avanca por janelas, e cada execucao
 * retoma onde a anterior parou.
 */
export const MAX_DETALHES_RECONCILE = 10;

/** Janela movel do incremental, em dias de DATA DO RELATORIO. */
export const JANELA_INCREMENTAL_DIAS = 14;

/**
 * Piso ABSOLUTO do baseline, usado so quando a data de inicio do
 * projeto nao for legivel. Existe para que a varredura termine sempre.
 */
export const BASELINE_DATA_MINIMA = "2015-01-01";

/** Tamanho de cada janela do baseline, em dias. */
export const BASELINE_JANELA_DIAS = 90;

/**
 * Tamanho de cada janela do RECONCILE, em dias.
 *
 * Mesmo tamanho do baseline porque a limitacao e' a mesma: a API filtra
 * pela DATA DO RELATORIO e devolve no maximo o lote pedido. Janela maior
 * viria truncada e exigiria subdivisao de qualquer forma.
 */
export const RECONCILE_JANELA_DIAS = 90;

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
  if (modo === "BASELINE") return MAX_DETALHES_BASELINE;
  if (modo === "RECONCILE") return MAX_DETALHES_RECONCILE;
  return MAX_DETALHES_INCREMENTAL;
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

/*
 * RECONCILIACAO
 *
 * POR QUE ELA PRECISA EXISTIR
 *
 * A API filtra pela DATA DO RELATORIO, nao por `modified`. Uma edicao
 * feita hoje num RDO de dois anos atras nao aparece em NENHUMA janela
 * incremental: o RDO continua datado de dois anos atras. Sem
 * reconciliacao, essa edicao seria invisivel para sempre — e edicao
 * tardia de diario e' exatamente o que interessa auditar.
 *
 * COMO ELA DIFERE DO BASELINE
 *
 * O baseline TERMINA: chegou ao piso, acabou. A reconciliacao e'
 * CICLICA: chegou ao piso, o ciclo fecha e o proximo comeca de hoje.
 * Por isso `cicloCompleto` nao para nada — ele so reinicia a contagem.
 *
 * Fora isso o mecanismo e' o mesmo, e deliberadamente: janela
 * decrescente, `_id` e `modified` da listagem escolhem candidatos, o
 * detalhe so e' buscado para candidato, o hash confirma a mudanca, o
 * checkpoint permite retomar noutro processo e o upsert garante
 * idempotencia. Zero midia, zero IA — nao ha caminho para nenhuma das
 * duas em nenhum modo.
 */

/** Janela decrescente generica: e' a mesma matematica do baseline. */
function janelaDecrescente(
  hojeIso: string,
  proximaJanelaFim: string | null | undefined,
  pisoIso: string,
  tamanhoDias: number
): Janela | null {
  const fim = proximaJanelaFim ?? hojeIso;

  if (fim < pisoIso) return null;

  const inicioBruto = somarDias(fim, -(tamanhoDias - 1));

  return { inicio: inicioBruto < pisoIso ? pisoIso : inicioBruto, fim };
}

/**
 * Janela do RECONCILE — decrescente, como a do baseline.
 *
 * `proximaJanelaFim` nulo significa "comece de hoje": ou e' a primeira
 * reconciliacao, ou a anterior fechou o ciclo.
 */
export function janelaReconcile(
  hojeIso: string,
  proximaJanelaFim: string | null | undefined,
  pisoIso: string
): Janela | null {
  return janelaDecrescente(hojeIso, proximaJanelaFim, pisoIso, RECONCILE_JANELA_DIAS);
}

export interface CheckpointReconcile {
  modo: "RECONCILE";
  /** Janela que este run processou. */
  currentWindowStart: string | null;
  currentWindowEnd: string | null;
  /** Por onde o PROXIMO processo retoma. `null` = recomeca de hoje. */
  resumeWindowEnd: string | null;
  candidatesRemaining: number;
  coverageGuaranteed: boolean;
  /** O ciclo alcancou o piso nesta execucao. */
  cicloCompleto: boolean;
  /** Quantas varreduras completas do historico ja aconteceram. */
  ciclosConcluidos: number;
  piso: string;
  totalNaOrigem: number;
}

export interface RetomadaReconcile {
  resumeWindowEnd: string | null;
  ciclosConcluidos: number;
}

/**
 * Le a retomada do RECONCILE.
 *
 * `cicloCompleto` nao encerra nada: ele zera a retomada para que a
 * proxima execucao recomece de hoje. E' a diferenca essencial em
 * relacao a `lerRetomadaBaseline`, onde `baselineComplete` significa
 * "nao ha mais o que fazer".
 */
export function lerRetomadaReconcile(
  checkpoint: Record<string, unknown> | null | undefined
): RetomadaReconcile {
  const ciclos =
    typeof checkpoint?.ciclosConcluidos === "number" && checkpoint.ciclosConcluidos >= 0
      ? checkpoint.ciclosConcluidos
      : 0;

  if (!checkpoint || checkpoint.cicloCompleto === true) {
    return { resumeWindowEnd: null, ciclosConcluidos: ciclos };
  }

  const valor = checkpoint.resumeWindowEnd;

  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return { resumeWindowEnd: valor, ciclosConcluidos: ciclos };
  }

  return { resumeWindowEnd: null, ciclosConcluidos: ciclos };
}

/**
 * Monta o checkpoint do RECONCILE a partir do que ESTE run observou.
 *
 *   1. sobraram candidatos  -> retoma a MESMA janela;
 *   2. janela esgotada      -> retoma no dia anterior ao inicio dela;
 *   3. abaixo do piso       -> ciclo completo; a proxima recomeca de hoje.
 *
 * Cobertura incerta tambem mantem a janela: uma janela que nao pode ser
 * garantida nao pode ser dada por varrida.
 */
export function montarCheckpointReconcile(entrada: {
  janela: Janela;
  candidatesRemaining: number;
  coverageGuaranteed: boolean;
  piso: string;
  totalNaOrigem: number;
  ciclosConcluidos: number;
}): CheckpointReconcile {
  const {
    janela,
    candidatesRemaining,
    coverageGuaranteed,
    piso,
    totalNaOrigem,
    ciclosConcluidos,
  } = entrada;

  const esgotada = candidatesRemaining === 0 && coverageGuaranteed;

  let resumeWindowEnd: string | null = esgotada ? somarDias(janela.inicio, -1) : janela.fim;

  let cicloCompleto = false;

  if (resumeWindowEnd !== null && resumeWindowEnd < piso) {
    cicloCompleto = true;
    resumeWindowEnd = null;
  }

  return {
    modo: "RECONCILE",
    currentWindowStart: janela.inicio,
    currentWindowEnd: janela.fim,
    resumeWindowEnd,
    candidatesRemaining,
    coverageGuaranteed,
    cicloCompleto,
    ciclosConcluidos: ciclosConcluidos + (cicloCompleto ? 1 : 0),
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
