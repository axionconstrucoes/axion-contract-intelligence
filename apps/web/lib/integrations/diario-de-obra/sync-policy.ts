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
 * Fundo do baseline. A obra piloto comeca em 2020; um piso explicito
 * evita varrer decadas vazias quando a data de inicio nao for legivel.
 */
export const BASELINE_DATA_MINIMA = "2015-01-01";

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
