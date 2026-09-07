// Leitores tolerantes do RDO normalizado.
//
// A API devolve as colecoes com forma variavel por modelo de relatorio:
// o clima ora e' uma string por turno, ora um objeto com `praticavel`;
// a mao de obra ora e' `{ total }`, ora uma lista de itens com
// `quantidade`. Cada leitor aqui entende as formas observadas e devolve
// `null` quando NAO consegue ler.
//
// `null` NUNCA vira alerta. Fail-closed no alerta e' o certo: um alerta
// emitido por leitura errada custa mais caro que um alerta nao emitido,
// porque ensina a equipe a desconfiar de todos os outros.
//
// Modulo puro: sem rede, sem banco, sem IA, sem crypto. Existe separado
// das regras porque o PAINEL tambem precisa destas leituras, e a tela
// nao deve carregar o grafo de dependencias da avaliacao de achados.

/** Turnos observados no modelo de relatorio da obra. */
export const TURNOS_DO_RDO: readonly string[] = Object.freeze(["manha", "tarde", "noite"]);

/** Limite acima do qual a edicao de um RDO e' considerada tardia. */
export const DIAS_PARA_EDICAO_TARDIA = 30;

export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function comoNumero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  if (typeof valor === "string" && valor.trim() !== "") {
    // A API usa virgula decimal em alguns campos numericos.
    const n = Number(valor.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

export function comoObjeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

export function comoLista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

/** Marca de impraticabilidade dentro de um turno. */
function turnoImpraticavel(valor: unknown): boolean {
  if (typeof valor === "string") return semAcento(valor).includes("impratic");

  const obj = comoObjeto(valor);
  if (!obj) return false;

  // `praticavel: false` e `impraticavel: true` sao a mesma afirmacao
  // escrita nos dois sentidos; o modelo de relatorio decide qual usa.
  if (obj.praticavel === false) return true;
  if (obj.impraticavel === true) return true;

  for (const campo of ["condicao", "condicoes", "status", "situacao", "descricao"]) {
    const texto = obj[campo];
    if (typeof texto === "string" && semAcento(texto).includes("impratic")) return true;
  }

  return false;
}

/**
 * Quantos turnos do dia foram impraticaveis.
 *
 * O sinalizador de DIA (`clima.praticavel === false`) sem nenhuma marca
 * por turno conta como UM turno, nao tres: sabemos que o dia teve
 * impraticabilidade, nao quantos turnos dela. Contar tres elevaria a
 * severidade de MEDIO para ALTO com base em suposicao.
 */
export function contarTurnosImpraticaveis(clima: unknown): number {
  const obj = comoObjeto(clima);
  if (!obj) return 0;

  let turnos = 0;

  for (const turno of TURNOS_DO_RDO) {
    if (turnoImpraticavel(obj[turno])) turnos += 1;
  }

  if (turnos === 0 && obj.praticavel === false) return 1;

  return turnos;
}

/**
 * Efetivo total do dia. `null` quando a forma nao e' legivel — e sem
 * leitura nao ha alerta nem entrada na mediana.
 */
export function totalDeEfetivo(labor: unknown): number | null {
  if (Array.isArray(labor)) {
    let total = 0;
    let leu = false;

    for (const item of labor) {
      const obj = comoObjeto(item);
      if (!obj) continue;

      for (const campo of ["quantidade", "efetivo", "total", "qtd"]) {
        const n = comoNumero(obj[campo]);
        if (n !== null) {
          total += n;
          leu = true;
          break;
        }
      }
    }

    // Colecao vazia e' leitura valida: nenhum efetivo lancado.
    return leu || labor.length === 0 ? total : null;
  }

  const obj = comoObjeto(labor);
  if (!obj) return null;

  for (const campo of ["total", "efetivo", "totalEfetivo", "quantidade"]) {
    const n = comoNumero(obj[campo]);
    if (n !== null) return n;
  }

  const itens = obj.itens ?? obj.funcionarios ?? obj.equipes;
  if (Array.isArray(itens)) return totalDeEfetivo(itens);

  return null;
}

/** Percentual de uma atividade, quando declarado. */
function percentualDaAtividade(atividade: Record<string, unknown>): number | null {
  for (const campo of [
    "percentual",
    "porcentagem",
    "percentualConcluido",
    "percentualExecutado",
    "avanco",
  ]) {
    const n = comoNumero(atividade[campo]);
    if (n !== null) return n;
  }

  return null;
}

/** `true` quando o status da atividade afirma conclusao. */
function atividadeConcluida(atividade: Record<string, unknown>): boolean {
  for (const campo of ["status", "situacao", "estado"]) {
    const valor = atividade[campo];

    if (typeof valor === "string" && semAcento(valor).includes("conclu")) return true;

    const obj = comoObjeto(valor);
    if (obj) {
      for (const interno of ["descricao", "nome", "label"]) {
        const texto = obj[interno];
        if (typeof texto === "string" && semAcento(texto).includes("conclu")) return true;
      }
    }
  }

  return atividade.concluida === true || atividade.concluido === true;
}

/**
 * Atividades em 100% cujo status nao acompanha.
 *
 * Isto NAO le a descricao da atividade: le o percentual (numero) e o
 * status (enum do fornecedor). O texto da atividade nunca e' comparado,
 * classificado ou copiado.
 */
export function contarAtividades100SemConclusao(atividades: unknown): number {
  let total = 0;

  for (const item of comoLista(atividades)) {
    const obj = comoObjeto(item);
    if (!obj) continue;

    if (percentualDaAtividade(obj) === 100 && !atividadeConcluida(obj)) total += 1;
  }

  return total;
}

/**
 * Dias entre a data de referencia e a ultima edicao. `null` sem uma
 * delas — e sem os dois carimbos nao ha o que afirmar.
 */
export function diasAteEdicao(
  referenceDate: string | null,
  sourceModifiedAt: string | null
): number | null {
  if (!referenceDate || !sourceModifiedAt) return null;

  const referencia = Date.parse(`${referenceDate.slice(0, 10)}T00:00:00Z`);
  const edicao = Date.parse(`${sourceModifiedAt.slice(0, 10)}T00:00:00Z`);

  if (!Number.isFinite(referencia) || !Number.isFinite(edicao)) return null;

  return Math.round((edicao - referencia) / 86_400_000);
}
