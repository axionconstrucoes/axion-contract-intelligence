// Normalizacao e hash canonico do RDO.
//
// POR QUE UM HASH, SE JA EXISTE `modified`
//
// A API devolve `modified` (confirmado no run 34136744223, embora a
// documentacao publica nao o mostre). Ele diz que ALGUEM SALVOU — nao
// que algo mudou. Abrir e salvar sem alterar nada move o `modified`, e
// tratar isso como alteracao encheria o rastro de mudancas que nao
// existiram. O hash e' a segunda confirmacao: `modified` seleciona
// candidatos, o hash decide.
//
// O QUE SAI ANTES DO HASH
//
// Tudo que muda sem o conteudo mudar: URL (temporaria e assinada),
// `linkPdf`, `t` de anticache, `log`, `logomarca`, assinaturas e campos
// de geracao. Uma URL que expira e e' reemitida nao pode virar
// "alteracao do diario".
//
// O QUE FICA
//
// Data, numero, status, clima, horarios, mao de obra, equipamentos,
// materiais, atividades, ocorrencias, comentarios e checklist — o
// conteudo operacional pelo qual alguem tomaria uma decisao.

import { createHash } from "node:crypto";

/** Campos removidos em qualquer profundidade antes do hash. */
export const CAMPOS_IGNORADOS_NO_HASH: readonly string[] = Object.freeze([
  "url",
  "urlminiatura",
  "urlfoto",
  "linkpdf",
  "link",
  "assinaturaseletronicaurl",
  "assinaturasmanualurl",
  "logomarca",
  "log",
  "t",
  "cache",
  "geradoem",
  "generatedat",
  "expiresat",
  "expiraem",
  "token",
]);

/** Colecoes cujo conteudo semantico interessa. */
export const COLECOES_DO_RDO: readonly string[] = Object.freeze([
  "activities",
  "occurrences",
  "comments",
  "checklist",
  "equipment",
]);

export interface RelatorioNormalizado {
  providerReportId: string;
  providerWorkId: string;
  reportNumber: number | null;
  referenceDate: string | null;
  referenceEndDate: string | null;
  weekday: string | null;
  statusId: number | null;
  statusLabel: string | null;
  sourceCreatedAt: string | null;
  sourceModifiedAt: string | null;
  contentHash: string;
  weather: unknown;
  workHours: unknown;
  labor: unknown;
  equipment: unknown;
  materials: unknown;
  activities: unknown;
  occurrences: unknown;
  comments: unknown;
  checklist: unknown;
  photoCount: number;
  videoCount: number;
  attachmentCount: number;
}

function ehTexto(valor: unknown): valor is string {
  return typeof valor === "string";
}

/** Espacos e quebras de linha nao sao conteudo. */
export function normalizarTexto(valor: unknown): string {
  if (!ehTexto(valor)) return "";
  return valor.replace(/\s+/g, " ").trim();
}

/**
 * A API devolve datas em DD/MM/AAAA e DD/MM/AAAA HH:mm. ISO e' o unico
 * formato que ordena e compara sem ambiguidade.
 */
export function parseDataBrasileira(valor: unknown): string | null {
  if (!ehTexto(valor)) return null;

  const limpo = valor.trim();
  if (!limpo) return null;

  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(limpo);
  if (!m) return null;

  const [, dia, mes, ano, hora, minuto, segundo] = m;

  if (hora === undefined) return `${ano}-${mes}-${dia}`;

  return `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo ?? "00"}`;
}

/** Somente a parte de data, para janelas e para `reference_date`. */
export function apenasData(valor: unknown): string | null {
  const iso = parseDataBrasileira(valor);
  return iso ? iso.slice(0, 10) : null;
}

function paraNumero(valor: unknown): number | null {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function contar(valor: unknown): number {
  return Array.isArray(valor) ? valor.length : 0;
}

/**
 * Canonicaliza recursivamente:
 *
 *   - remove os campos que nao sao conteudo (URL, log, logo, cache…);
 *   - normaliza espacos de todo texto;
 *   - converte data brasileira para ISO;
 *   - ORDENA chaves de objeto e itens de colecao.
 *
 * A ordenacao das colecoes e' o ponto delicado: a API nao promete ordem
 * estavel entre chamadas, e sem isso a mesma atividade em posicao
 * diferente viraria "alteracao". Ordenamos pela forma serializada, que
 * e' deterministica e nao depende de campo especifico existir.
 */
export function canonicalizar(valor: unknown): unknown {
  if (valor === null || valor === undefined) return null;

  if (Array.isArray(valor)) {
    const itens = valor.map((item) => canonicalizar(item));
    return itens
      .map((item) => ({ item, chave: JSON.stringify(item) }))
      .sort((a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0))
      .map((entrada) => entrada.item);
  }

  if (typeof valor === "object") {
    const origem = valor as Record<string, unknown>;
    const destino: Record<string, unknown> = {};

    for (const chave of Object.keys(origem).sort()) {
      if (CAMPOS_IGNORADOS_NO_HASH.includes(chave.toLowerCase())) continue;
      destino[chave] = canonicalizar(origem[chave]);
    }

    return destino;
  }

  if (typeof valor === "string") {
    const comoData = parseDataBrasileira(valor);
    if (comoData) return comoData;

    const texto = normalizarTexto(valor);

    // Um valor que E' inteiramente uma URL e' localizador de midia, nao
    // conteudo: sai, mesmo sob uma chave desconhecida. Isso cobre o caso
    // de uma foto aninhada dentro de atividade, ocorrencia ou checklist
    // com um nome de campo que nao esta na lista.
    if (/^https?:\/\/\S+$/.test(texto)) return "";

    // Texto que apenas CONTEM uma URL e' preservado inteiro. Uma
    // ocorrencia que cita um link e conteudo operacional legitimo, e
    // apaga-lo mudaria o significado do que foi registrado na obra.
    return texto;
  }

  return valor;
}

/**
 * Hash do conteudo SEMANTICO. Ordem estavel, sem URL, sem log, sem
 * campo de cache — duas leituras do mesmo RDO inalterado produzem o
 * mesmo hash, mesmo com `modified` diferente.
 */
export function calcularHashCanonico(partes: Record<string, unknown>): string {
  const canonico = canonicalizar(partes);
  return createHash("sha256").update(JSON.stringify(canonico), "utf8").digest("hex");
}

/**
 * Converte o detalhe cru da API no registro que vai ao banco.
 *
 * Nenhum campo proibido atravessa: `linkPdf`, `logomarca`, `log`,
 * `galeriaDeFotos`, `videos` e `anexos` viram CONTAGEM, e as URLs somem
 * na canonicalizacao. O payload cru nunca e' persistido.
 */
export function normalizarRelatorio(
  detalhe: Record<string, unknown>,
  resumo: Record<string, unknown> = {}
): RelatorioNormalizado {
  const status = (detalhe.status ?? resumo.status ?? {}) as Record<string, unknown>;
  const obra = (detalhe.obra ?? resumo.obra ?? {}) as Record<string, unknown>;

  const semantico = {
    data: apenasData(detalhe.data ?? resumo.data),
    dataFim: apenasData(detalhe.dataFim ?? resumo.dataFim),
    numero: paraNumero(detalhe.numero ?? resumo.numero),
    statusId: paraNumero(status.id),
    clima: detalhe.clima ?? null,
    horarioDeTrabalho: detalhe.horarioDeTrabalho ?? null,
    maoDeObra: detalhe.maoDeObra ?? null,
    equipamentos: detalhe.equipamentos ?? null,
    controleDeMaterial: detalhe.controleDeMaterial ?? null,
    atividades: detalhe.atividades ?? null,
    ocorrencias: detalhe.ocorrencias ?? null,
    comentarios: detalhe.comentarios ?? null,
    checklist: detalhe.checklist ?? null,
  };

  return {
    providerReportId: String(detalhe._id ?? resumo._id ?? ""),
    providerWorkId: String(obra._id ?? ""),
    reportNumber: paraNumero(detalhe.numero ?? resumo.numero),
    referenceDate: apenasData(detalhe.data ?? resumo.data),
    referenceEndDate: apenasData(detalhe.dataFim ?? resumo.dataFim),
    weekday: normalizarTexto(detalhe.diaDaSemana ?? resumo.diaDaSemana) || null,
    statusId: paraNumero(status.id),
    statusLabel: normalizarTexto(status.descricao) || null,
    sourceCreatedAt: parseDataBrasileira(detalhe.created ?? resumo.created),
    sourceModifiedAt: parseDataBrasileira(detalhe.modified ?? resumo.modified),
    contentHash: calcularHashCanonico(semantico),

    weather: canonicalizar(detalhe.clima ?? {}),
    workHours: canonicalizar(detalhe.horarioDeTrabalho ?? {}),
    labor: canonicalizar(detalhe.maoDeObra ?? {}),
    equipment: canonicalizar(detalhe.equipamentos ?? []),
    materials: canonicalizar(detalhe.controleDeMaterial ?? {}),
    activities: canonicalizar(detalhe.atividades ?? []),
    occurrences: canonicalizar(detalhe.ocorrencias ?? []),
    comments: canonicalizar(detalhe.comentarios ?? []),
    checklist: canonicalizar(detalhe.checklist ?? []),

    // Midia so como numero. Um contador nao e' midia.
    photoCount: contar(detalhe.galeriaDeFotos),
    videoCount: contar(detalhe.videos),
    attachmentCount: contar(detalhe.anexos),
  };
}

/**
 * Candidato = RDO novo, ou RDO cujo `modified` avancou.
 *
 * Sem `modified` conhecido dos dois lados, o RDO entra como candidato:
 * na duvida, buscar o detalhe custa uma chamada; supor que nada mudou
 * custa uma alteracao perdida.
 */
export function ehCandidato(
  resumo: { _id?: unknown; modified?: unknown },
  conhecido: { provider_report_id: string; source_modified_at: string | null } | undefined
): boolean {
  if (!conhecido) return true;

  const novo = parseDataBrasileira(resumo.modified);
  if (!novo || !conhecido.source_modified_at) return true;

  return new Date(novo).getTime() > new Date(conhecido.source_modified_at).getTime();
}
