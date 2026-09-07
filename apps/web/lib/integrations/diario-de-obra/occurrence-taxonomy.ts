// Taxonomia estruturada de ocorrencias do Diario de Obra.
//
// A severidade de uma ocorrencia vem da CATEGORIA que o apontador da
// obra escolheu no formulario — nunca do texto que ele escreveu depois.
// Isso e' deliberado e e' a linha que separa este modulo de uma analise
// de linguagem: a categoria e' um campo estruturado, fechado, escolhido
// por um humano no momento do registro. A descricao e' prosa, varia por
// apontador, cita nome de pessoa e endereco de frente de servico, e nao
// e' lida por nada aqui.
//
// ZERO IA, ZERO LEXICO. Nao ha classificacao por palavra-chave, nao ha
// heuristica sobre a descricao, nao ha modelo. Ha uma tabela de 24
// entradas e uma normalizacao de texto.
//
// CATEGORIA DESCONHECIDA
//
// A lista do fornecedor pode crescer. Uma categoria que nao esta aqui
// vira UNKNOWN, severidade MEDIO e revisao humana — e o rotulo livre
// NAO e' guardado. Guardar o nome desconhecido pareceria util e seria
// a porta pela qual texto livre entraria no achado: nada garante que o
// fornecedor nao renomeie a categoria para algo que carregue conteudo.
//
// Nenhuma categoria produz CRITICO. O teto e' ALTO.

export type SeveridadeDeCategoria = "BAIXO" | "MEDIO" | "ALTO";

/** Codigo da categoria desconhecida. Nunca acompanha o rotulo livre. */
export const CATEGORIA_DESCONHECIDA = "UNKNOWN";

export interface CategoriaDeOcorrencia {
  /** Codigo estavel, ASCII, usado como identidade e evidencia. */
  code: string;
  severity: SeveridadeDeCategoria;
  /** Rotulo do fornecedor, como aparece no formulario. So documentacao. */
  rotulo: string;
}

/**
 * As 24 categorias do formulario, com a severidade acordada.
 *
 * A ordem e' por severidade e depois alfabetica, para que uma revisao
 * humana consiga conferir a lista contra o formulario sem procurar.
 */
export const CATEGORIAS_DE_OCORRENCIA: readonly CategoriaDeOcorrencia[] = Object.freeze([
  // ---------------------------------------------------------------
  // ALTO — impacto contratual, dano fisico ou parada de servico.
  // ---------------------------------------------------------------
  { code: "ADITIVOS", severity: "ALTO", rotulo: "Aditivos" },
  { code: "ALTERACAO_DE_PROJETO", severity: "ALTO", rotulo: "Alteração de projeto" },
  {
    code: "DANO_EM_ESTRUTURA_EXISTENTE",
    severity: "ALTO",
    rotulo: "Dano em estrutura existente - não mapeada",
  },
  { code: "DANO_EM_ESTRUTURA_NOVA", severity: "ALTO", rotulo: "Dano em estrutura nova" },
  { code: "DIA_PARADO", severity: "ALTO", rotulo: "Dia parado" },
  {
    code: "FISCALIZACAO_TRABALHISTA_AMBIENTAL",
    severity: "ALTO",
    rotulo: "Fiscalização trabalhista/meio ambiente",
  },
  { code: "SOLICITACAO_FORA_DO_ESCOPO", severity: "ALTO", rotulo: "Solicitação fora do escopo" },
  {
    code: "TALUDE_DANIFICADO_POR_CHUVA",
    severity: "ALTO",
    rotulo: "Taludes danificado devido fortes chuvas",
  },

  // ---------------------------------------------------------------
  // MEDIO — atrito de execucao: atrasa, encarece, exige decisao.
  // ---------------------------------------------------------------
  { code: "AGENTES_EXTERNOS", severity: "MEDIO", rotulo: "Agentes Externos" },
  { code: "CRONOGRAMA", severity: "MEDIO", rotulo: "Cronograma" },
  {
    code: "FALHA_MECANICA_DE_EQUIPAMENTO",
    severity: "MEDIO",
    rotulo: "Falha mecânica de Equipamento - Atraso e/ou Parada de Serviço",
  },
  { code: "FALTA_DE_EQUIPAMENTO", severity: "MEDIO", rotulo: "Falta de equipamento" },
  { code: "FALTA_DE_MATERIAL", severity: "MEDIO", rotulo: "Falta de material" },
  { code: "FALTA_DE_MAO_DE_OBRA", severity: "MEDIO", rotulo: "Falta de mão de obra" },
  {
    code: "IDENTIFICACAO_DE_ERRO_DE_PROJETO",
    severity: "MEDIO",
    rotulo: "Identificação de erro de projeto",
  },
  {
    code: "INCOMPATIBILIDADE_DE_PROJETOS",
    severity: "MEDIO",
    rotulo: "Incompatibilidade de projetos",
  },
  { code: "RETRABALHO", severity: "MEDIO", rotulo: "Retrabalho" },
  { code: "SOLICITACOES_DO_CLIENTE", severity: "MEDIO", rotulo: "Solicitações do cliente" },
  { code: "VISITA_DO_FISCAL", severity: "MEDIO", rotulo: "Visita do Fiscal" },
  { code: "VISITA_SEGURADORA", severity: "MEDIO", rotulo: "Visita seguradora" },

  // ---------------------------------------------------------------
  // BAIXO — rotina registrada. Informa, nao acusa.
  // ---------------------------------------------------------------
  { code: "DIA_CHUVOSO", severity: "BAIXO", rotulo: "Dia Chuvoso" },
  { code: "LIBERACAO_DE_MEDICAO", severity: "BAIXO", rotulo: "Liberação de Medição" },
  { code: "REUNIAO", severity: "BAIXO", rotulo: "Reunião" },
  { code: "VISITA_DO_PROJETISTA", severity: "BAIXO", rotulo: "Visita do projetista" },
]);

/** Todos os codigos aceitos, incluindo o desconhecido. */
export const CODIGOS_DE_CATEGORIA: readonly string[] = Object.freeze([
  ...CATEGORIAS_DE_OCORRENCIA.map((c) => c.code),
  CATEGORIA_DESCONHECIDA,
]);

/**
 * Normalizacao do rotulo antes da busca.
 *
 * NFD separa o acento da letra; a faixa de combinantes some; o resto
 * vira minuscula; toda pontuacao (barra, hifen, virgula, parenteses)
 * vira espaco; espacos colapsam. Assim "Fiscalização trabalhista/meio
 * ambiente", "FISCALIZACAO TRABALHISTA / MEIO AMBIENTE" e
 * "  fiscalizacao-trabalhista--meio-ambiente " chegam iguais.
 */
export function normalizarRotuloDeCategoria(valor: unknown): string {
  if (typeof valor !== "string") return "";

  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Indice de busca: rotulo normalizado -> categoria. */
const POR_ROTULO = new Map<string, CategoriaDeOcorrencia>(
  CATEGORIAS_DE_OCORRENCIA.map((c) => [normalizarRotuloDeCategoria(c.rotulo), c])
);

/**
 * Indice pelo PROPRIO codigo, normalizado.
 *
 * O fornecedor pode devolver o codigo em vez do rotulo, e um dado ja
 * canonico nao deveria cair em UNKNOWN so porque a busca so conhecia a
 * forma humana.
 */
const POR_CODIGO = new Map<string, CategoriaDeOcorrencia>(
  CATEGORIAS_DE_OCORRENCIA.map((c) => [normalizarRotuloDeCategoria(c.code), c])
);

export interface CategoriaResolvida {
  code: string;
  severity: SeveridadeDeCategoria;
  /** `true` quando a categoria nao esta na tabela. */
  desconhecida: boolean;
  /**
   * Identificador estruturado do tipo, quando a API o devolve. Entra na
   * identidade do achado; nunca e' texto.
   */
  tipoId: number | null;
  tipoRef: string | null;
}

/** Categoria desconhecida — sem rotulo, por decisao de seguranca. */
const DESCONHECIDA: Omit<CategoriaResolvida, "tipoId" | "tipoRef"> = Object.freeze({
  code: CATEGORIA_DESCONHECIDA,
  severity: "MEDIO",
  desconhecida: true,
});

function comoObjeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

/** Campos onde o tipo estruturado aparece, nas formas ja observadas. */
const CAMPOS_DE_TIPO = ["tipo", "tipoDeOcorrencia", "categoria", "classificacao"];

/** Dentro do objeto de tipo, onde mora o rotulo. */
const CAMPOS_DE_ROTULO = ["descricao", "nome", "label", "titulo", "value"];

/** ObjectId do fornecedor: 24 hexadecimais. */
const OBJECT_ID = /^[a-f0-9]{24}$/;

function lerIdentificador(tipo: Record<string, unknown>): { tipoId: number | null; tipoRef: string | null } {
  let tipoId: number | null = null;
  let tipoRef: string | null = null;

  for (const campo of ["id", "_id", "codigo", "code"]) {
    const bruto = tipo[campo];

    if (typeof bruto === "number" && Number.isInteger(bruto) && bruto >= 0) {
      tipoId ??= bruto;
      continue;
    }

    if (typeof bruto === "string") {
      const limpo = bruto.trim();

      if (OBJECT_ID.test(limpo)) {
        tipoRef ??= limpo;
        continue;
      }

      // Numero vindo como texto continua sendo numero.
      if (/^\d{1,9}$/.test(limpo)) tipoId ??= Number(limpo);
    }
  }

  return { tipoId, tipoRef };
}

/**
 * Resolve a categoria de UMA ocorrencia a partir do campo estruturado.
 *
 * Ocorrencia sem campo de tipo — ou com um tipo que nao esta na tabela —
 * e' UNKNOWN. A descricao NUNCA e' consultada, mesmo quando o tipo esta
 * ausente: procurar a categoria no texto seria exatamente a analise de
 * linguagem que este modulo existe para nao fazer.
 */
export function resolverCategoria(ocorrencia: unknown): CategoriaResolvida {
  const obj = comoObjeto(ocorrencia);

  if (!obj) return { ...DESCONHECIDA, tipoId: null, tipoRef: null };

  for (const campo of CAMPOS_DE_TIPO) {
    const bruto = obj[campo];

    if (typeof bruto === "string") {
      const chave = normalizarRotuloDeCategoria(bruto);
      const achada = POR_ROTULO.get(chave) ?? POR_CODIGO.get(chave);

      if (achada) {
        return {
          code: achada.code,
          severity: achada.severity,
          desconhecida: false,
          tipoId: null,
          tipoRef: null,
        };
      }

      // Campo de tipo presente e nao reconhecido: e' desconhecida, e a
      // busca para aqui. Nao se tenta outro campo nem a descricao.
      return { ...DESCONHECIDA, tipoId: null, tipoRef: null };
    }

    const tipo = comoObjeto(bruto);
    if (!tipo) continue;

    const { tipoId, tipoRef } = lerIdentificador(tipo);

    for (const interno of CAMPOS_DE_ROTULO) {
      const rotulo = tipo[interno];
      if (typeof rotulo !== "string") continue;

      const chave = normalizarRotuloDeCategoria(rotulo);
      const achada = POR_ROTULO.get(chave) ?? POR_CODIGO.get(chave);

      if (achada) {
        return {
          code: achada.code,
          severity: achada.severity,
          desconhecida: false,
          tipoId,
          tipoRef,
        };
      }
    }

    // Objeto de tipo presente, rotulo irreconhecivel. O identificador
    // estruturado e' preservado — ele nao e' texto, e e' o que permite
    // reconciliar o achado depois que a categoria for mapeada.
    return { ...DESCONHECIDA, tipoId, tipoRef };
  }

  return { ...DESCONHECIDA, tipoId: null, tipoRef: null };
}

export interface CategoriaAgrupada extends CategoriaResolvida {
  /** Quantas ocorrencias daquela categoria existem no RDO. */
  ocorrencias: number;
}

/**
 * Agrupa as ocorrencias de um RDO por categoria.
 *
 * Uma categoria distinta => um achado. Duas ocorrencias da MESMA
 * categoria => um achado com contagem 2. Colapsar categorias diferentes
 * na maior severidade perderia informacao acionavel: "falta de material"
 * e "dia parado" no mesmo dia sao dois problemas, com donos diferentes.
 *
 * A ordem de saida e' pelo codigo, para que o resultado seja
 * deterministico independente da ordem em que a API devolveu.
 */
export function agruparOcorrenciasPorCategoria(
  ocorrencias: unknown
): CategoriaAgrupada[] {
  if (!Array.isArray(ocorrencias)) return [];

  const porCodigo = new Map<string, CategoriaAgrupada>();

  for (const ocorrencia of ocorrencias) {
    const categoria = resolverCategoria(ocorrencia);

    // A identidade inclui o identificador estruturado quando ele existe:
    // duas categorias desconhecidas com ids diferentes sao coisas
    // diferentes, e agrupa-las esconderia uma delas.
    const chave = [categoria.code, categoria.tipoId ?? "", categoria.tipoRef ?? ""].join("|");
    const existente = porCodigo.get(chave);

    if (existente) {
      existente.ocorrencias += 1;
      continue;
    }

    porCodigo.set(chave, { ...categoria, ocorrencias: 1 });
  }

  return [...porCodigo.values()].sort((a, b) =>
    a.code === b.code
      ? (a.tipoId ?? 0) - (b.tipoId ?? 0)
      : a.code < b.code
        ? -1
        : 1
  );
}
