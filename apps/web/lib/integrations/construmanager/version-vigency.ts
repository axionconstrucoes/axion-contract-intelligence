// Deteccao de NOVA VERSAO VIGENTE no Construmanager.
//
// Modulo puro: nenhuma rede, nenhum Supabase, nenhum download. A regra
// mora aqui para ser exercida por teste sobre dados reais, e nao
// auditada por leitura de SQL.
//
// ---------------------------------------------------------------------
// A REGRA, DERIVADA DO PAYLOAD REAL (nao de suposicao)
// ---------------------------------------------------------------------
//
// Do fixture da obra WEG 34164, o par cabeca/versao do mesmo documento:
//
//   { id: 37272424, nome: "WLI-Topografia.dwg",     super: 37271962,
//     versoes: "01", isVersao: 0, isContemVersao: true  }
//   { id: 39274704, nome: "WLI-Topografia(00).dwg", super: 37272424,
//     versoes: "00", isVersao: 1, isContemVersao: false }
//
// Disso decorre, com evidencia:
//
//   1. VIGENCIA e' `isVersao = 0`. A linha vigente e' o documento; as de
//      `isVersao = 1` sao historico. Nao se infere vigencia por nome,
//      por data nem por magnitude de id.
//
//   2. A REVISAO VIGENTE e' `cad_objects_versoes` da linha vigente
//      ("01" acima). E' o campo factual da API — `revision` na tabela.
//
//   3. A IDENTIDADE DOCUMENTAL e' `cad_objects_id` da linha vigente, e
//      ela e' ESTAVEL entre revisoes: quando a revisao 01 substituiu a
//      00, a cabeca CONSERVOU o id 37272424 e o conteudo anterior foi
//      arquivado num id NOVO (39274704). Por isso a transicao aparece
//      como MUDANCA DE `revision` no MESMO `construmanager_object_id` —
//      e nao como um id novo.
//
//   4. O VINCULO historico e' `cad_objects_super` da versao apontando
//      para o `cad_objects_id` da cabeca. Nunca por proximidade de id.
//
// LIMITE QUE PRECISA FICAR EXPLICITO
//
//   Sem download nao e' possivel afirmar que duas revisoes tem conteudo
//   binario diferente — so o SHA-256 diria isso. E' possivel afirmar que
//   houve MUDANCA DE VERSAO DOCUMENTAL segundo os metadados oficiais do
//   Construmanager. As duas afirmacoes nao sao a mesma coisa, e o alerta
//   nao deve confundi-las.

/** Estado vigente observado de um documento, entre sincronizacoes. */
export interface VigencyObservation {
  /** cad_objects_id da linha vigente. Estavel entre revisoes. */
  objectId: number;
  /** cad_objects_versoes da linha vigente. */
  revision: string | null;
  name: string | null;
  sourceCreatedAt: string | null;
  authorName: string | null;
  sizeBytes: number | null;
  folderPath: string | null;
}

export type VigencyOutcome =
  /** Nunca vista antes: registra a linha de base, NAO alerta. */
  | "PRIMEIRA_OBSERVACAO"
  /** Revisao vigente mudou: alerta uma vez. */
  | "NOVA_VERSAO_VIGENTE"
  /** Nada mudou. */
  | "SEM_MUDANCA"
  /** Cadeia incoerente — precisa de gente, nao de alerta de versao. */
  | "CADEIA_INCONSISTENTE";

export interface VigencyVerdict {
  outcome: VigencyOutcome;
  previousRevision: string | null;
  newRevision: string | null;
  detail: string | null;
}

/**
 * Normaliza a revisao para COMPARACAO — nunca para exibicao.
 *
 * "01", "1" e " 01 " sao a mesma revisao para a API; tratar como
 * diferentes produziria um alerta falso a cada sincronizacao. O valor
 * exibido no alerta continua sendo o original, sem normalizacao.
 */
export function normalizeRevisionForComparison(revision: string | null): string {
  if (typeof revision !== "string") return "";
  const trimmed = revision.trim();
  if (trimmed === "") return "";
  // Zeros a esquerda sao formatacao, nao conteudo.
  const withoutLeadingZeros = trimmed.replace(/^0+(?=\d)/, "");
  return withoutLeadingZeros.toUpperCase();
}

/**
 * Compara o estado anterior (ultima vigencia registrada) com o estado
 * recem-sincronizado e decide se houve transicao.
 *
 * `previous === null` significa documento nunca observado: e' a primeira
 * carga, nao uma troca de versao. Alertar aqui encheria a caixa de
 * entrada com 192 "novidades" que sao apenas o acervo existente.
 */
export function evaluateVigency(
  previous: VigencyObservation | null,
  current: VigencyObservation
): VigencyVerdict {
  if (!Number.isInteger(current.objectId) || current.objectId <= 0) {
    return {
      outcome: "CADEIA_INCONSISTENTE",
      previousRevision: previous?.revision ?? null,
      newRevision: current.revision,
      detail: "Identificador do documento vigente ausente ou invalido nos metadados.",
    };
  }

  if (previous === null) {
    return {
      outcome: "PRIMEIRA_OBSERVACAO",
      previousRevision: null,
      newRevision: current.revision,
      detail: null,
    };
  }

  // A identidade documental e' estavel: se ela mudou para o mesmo
  // documento monitorado, os metadados estao incoerentes com o modelo
  // da API — nao e' uma transicao de versao, e' um problema.
  if (previous.objectId !== current.objectId) {
    return {
      outcome: "CADEIA_INCONSISTENTE",
      previousRevision: previous.revision,
      newRevision: current.revision,
      detail: `Identidade documental mudou de ${previous.objectId} para ${current.objectId}: a cabeca deveria conservar o id entre revisoes.`,
    };
  }

  const antes = normalizeRevisionForComparison(previous.revision);
  const agora = normalizeRevisionForComparison(current.revision);

  if (antes === agora) {
    return {
      outcome: "SEM_MUDANCA",
      previousRevision: previous.revision,
      newRevision: current.revision,
      detail: null,
    };
  }

  // Revisao sumiu: nao da para afirmar transicao a partir de ausencia.
  if (agora === "") {
    return {
      outcome: "CADEIA_INCONSISTENTE",
      previousRevision: previous.revision,
      newRevision: current.revision,
      detail: "Revisao vigente ausente nos metadados novos.",
    };
  }

  return {
    outcome: "NOVA_VERSAO_VIGENTE",
    previousRevision: previous.revision,
    newRevision: current.revision,
    detail: null,
  };
}

/** Como o conteudo do documento e' preservado pelo ACC, no momento do alerta. */
export type ContentAvailability = "ARMAZENADO_NO_ACC" | "SOMENTE_NO_CONSTRUMANAGER";

export function describeContentAvailability(
  availability: ContentAvailability
): string {
  return availability === "ARMAZENADO_NO_ACC"
    ? "Conteudo armazenado no ACC."
    : "Conteudo somente no Construmanager (acima do limite de armazenamento).";
}

export interface VigencyAlertInput {
  workName: string | null;
  documentName: string | null;
  previousRevision: string | null;
  newRevision: string | null;
  previousObjectId: number | null;
  newObjectId: number;
  sourceCreatedAt: string | null;
  authorName: string | null;
  sizeBytes: number | null;
  folderPath: string | null;
  detectedAt: string;
  availability: ContentAvailability;
}

/**
 * Texto do alerta NOVA VERSAO VIGENTE.
 *
 * Campo ausente e' OMITIDO, nunca preenchido com "(desconhecido)" nem
 * inventado: o alerta e' evidencia, e evidencia com lacuna honesta vale
 * mais que evidencia completa e falsa.
 *
 * Nao afirma que o conteudo mudou — afirma que a versao documental
 * mudou. A distincao esta escrita no proprio texto.
 */
export function buildVigencyAlertDetail(input: VigencyAlertInput): string {
  const partes: string[] = [];

  if (input.workName) partes.push(`Obra: ${input.workName}`);
  if (input.documentName) partes.push(`Documento: ${input.documentName}`);

  partes.push(
    `Revisao: ${input.previousRevision ?? "(sem revisao anterior)"} -> ${
      input.newRevision ?? "(sem revisao)"
    }`
  );

  if (input.previousObjectId !== null) {
    partes.push(`Identificador: ${input.previousObjectId} -> ${input.newObjectId}`);
  } else {
    partes.push(`Identificador: ${input.newObjectId}`);
  }

  if (input.sourceCreatedAt) partes.push(`Data da versao: ${input.sourceCreatedAt}`);
  if (input.authorName) partes.push(`Autor: ${input.authorName}`);
  if (input.sizeBytes !== null) partes.push(`Tamanho: ${input.sizeBytes} bytes`);
  if (input.folderPath) partes.push(`Pasta: ${input.folderPath}`);

  partes.push(`Detectado pelo ACC em ${input.detectedAt}`);
  partes.push(describeContentAvailability(input.availability));

  partes.push(
    "Mudanca de VERSAO DOCUMENTAL segundo os metadados oficiais do Construmanager. " +
      "Sem download nao e possivel afirmar se o conteudo binario difere. " +
      "Requer analise humana de impacto (custo, prazo, escopo, qualidade, seguranca, obrigacoes contratuais)."
  );

  return partes.join(" | ");
}

/** Acao registrada no audit log para a transicao de vigencia. */
export const VIGENCY_AUDIT_ACTION = "CONSTRUMANAGER_NOVA_VERSAO_VIGENTE";
