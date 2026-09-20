// Classificação DETERMINÍSTICA inicial de e-mails e anexos — pura, sem
// IA (a IA é extensão futura: quem quiser sobrepor esta sugestão deve
// registrar um evento de revisão, nunca alterar silenciosamente).
//
// Entradas: assunto, nome/MIME/extensão do arquivo, remetente,
// destinatários e o domínio do cliente do projeto. Saída: classificação
// + confiança + razões. Baixa confiança => UNCLASSIFIED /
// PENDING_HUMAN_REVIEW, preservando o original.
//
// Categorias de E-MAIL reutilizam documents.kind onde já existe
// categoria equivalente: ATA_REUNIAO, DIARIO_OBRA (RDO), ESG_SSMA
// (relatório diário SSMA/ESG), RELATORIO_SEMANAL (Planejamento).
// ALTERACAO_PROJETO é a única categoria realmente nova.
// "E-mails enviados ao cliente" NÃO é categoria: é o filtro transversal
// sentToClient (OUTBOUND + destinatário no domínio do cliente).

import { parseWorkWeekSubject } from "./parse-work-week-subject";

export type EmailDocumentClassification =
  | "ATA_REUNIAO"
  | "DIARIO_OBRA"
  | "ALTERACAO_PROJETO"
  | "ESG_SSMA"
  | "RELATORIO_SEMANAL"
  | "UNCLASSIFIED";

/**
 * Anexos: RELATORIO_SEMANAL_PLANEJAMENTO é a PLANILHA EXCEL do relatório
 * semanal (unidade documental inteira; as abas Curva S/Linha de Base/
 * Financeiro/Histograma/SSMA são componentes). Curva S nunca é
 * classificação de anexo — é uma aba dessa planilha.
 */
export type EmailAttachmentClassification = EmailDocumentClassification | "RELATORIO_SEMANAL_PLANEJAMENTO" | "CRONOGRAMA_MPP";

export type ClassificationStatus = "AUTO" | "CONFIRMED" | "PENDING_HUMAN_REVIEW" | "UNCLASSIFIED";

export interface ClassificationResult<T extends string> {
  classification: T;
  /** 0..1 — >= 0.8 AUTO; 0.5..0.8 PENDING_HUMAN_REVIEW; < 0.5 UNCLASSIFIED. */
  confidence: number;
  status: ClassificationStatus;
  reasons: string[];
}

const AUTO_THRESHOLD = 0.8;
const REVIEW_THRESHOLD = 0.5;

interface Pattern<T extends string> {
  classification: T;
  regex: RegExp;
  weight: number;
  label: string;
}

const SUBJECT_PATTERNS: Pattern<EmailDocumentClassification>[] = [
  { classification: "RELATORIO_SEMANAL", regex: /relat[óo]rio\s+semanal/i, weight: 0.9, label: "assunto contém 'Relatório Semanal'" },
  { classification: "ATA_REUNIAO", regex: /\bata\b|\batas\b|minuta\s+de\s+reuni[ãa]o|\bmom\b/i, weight: 0.85, label: "assunto contém 'Ata'/'MoM'" },
  { classification: "DIARIO_OBRA", regex: /\brdo\b|di[áa]rio\s+de\s+obra|relat[óo]rio\s+di[áa]rio\s+de\s+obra/i, weight: 0.9, label: "assunto contém 'RDO'/'Diário de Obra'" },
  { classification: "ESG_SSMA", regex: /\bssma\b|\besg\b|\bsms\b|seguran[çc]a\s+do\s+trabalho|meio\s+ambiente|\bhse\b/i, weight: 0.85, label: "assunto contém 'SSMA'/'ESG'" },
  { classification: "ALTERACAO_PROJETO", regex: /altera[çc][ãa]o\s+de\s+projeto|revis[ãa]o\s+de\s+projeto|\bas[- ]built\b|\bprojeto\s+revis(ad|ão)|\brev\.?\s*\d+\b.*projeto|\bdesenho/i, weight: 0.75, label: "assunto indica alteração/revisão de projeto" },
];

const FILE_PATTERNS: Pattern<EmailAttachmentClassification>[] = [
  { classification: "CRONOGRAMA_MPP", regex: /\.mpp$/i, weight: 0.98, label: "extensão .mpp" },
  // Planilha do relatório semanal (contém Curva S, Linha de Base, Financeiro, Histograma, SSMA).
  { classification: "RELATORIO_SEMANAL_PLANEJAMENTO", regex: /^(?=.*\.(xlsx|xlsm|xls)$)(?=.*(relat[óo]rio[\s_-]*semanal|weekly[\s_-]*report|curva[\s_-]*s(?=$|[^a-z])|(?:^|[^a-z])s[\s_-]*curve|\bw\d{1,3}\b|rs[\s_-]*w\d{1,3}))/i, weight: 0.9, label: "planilha do relatório semanal (Curva S / Linha de Base / Financeiro / Histograma / SSMA)" },
  { classification: "RELATORIO_SEMANAL", regex: /relat[óo]rio[\s_-]*semanal|weekly[\s_-]*report|\bw\d{1,3}\b/i, weight: 0.8, label: "nome do arquivo indica relatório semanal" },
  { classification: "ATA_REUNIAO", regex: /\bata\b|\bata[_-]|minuta|\bmom[_-]/i, weight: 0.8, label: "nome do arquivo indica ata" },
  { classification: "DIARIO_OBRA", regex: /\brdo\b|rdo[_-]|di[áa]rio[\s_-]*de[\s_-]*obra/i, weight: 0.85, label: "nome do arquivo indica RDO" },
  { classification: "ESG_SSMA", regex: /\bssma\b|ssma[_-]|\besg\b|esg[_-]|\bhse\b|\bdds\b/i, weight: 0.8, label: "nome do arquivo indica SSMA/ESG" },
  { classification: "ALTERACAO_PROJETO", regex: /\.dwg$|\.dxf$|\.rvt$|\.ifc$|rev[\s_-]?\d{1,2}\b|as[\s_-]?built|altera[çc][ãa]o/i, weight: 0.7, label: "arquivo de projeto/revisão" },
];

const MPP_MIME = new Set(["application/vnd.ms-project", "application/x-project", "application/msproject"]);

function statusFor(confidence: number): ClassificationStatus {
  if (confidence >= AUTO_THRESHOLD) return "AUTO";
  if (confidence >= REVIEW_THRESHOLD) return "PENDING_HUMAN_REVIEW";
  return "UNCLASSIFIED";
}

interface Winner<T extends string> {
  classification: T;
  confidence: number;
  reasons: string[];
}

function best<T extends string>(patterns: Pattern<T>[], text: string): Winner<T> | null {
  const matches = patterns.filter((pattern) => pattern.regex.test(text)).sort((a, b) => b.weight - a.weight);
  if (matches.length === 0) return null;
  const top = matches[0];
  const winner: Winner<T> = { classification: top.classification, confidence: top.weight, reasons: [top.label] };
  // Dois padrões fortes e divergentes (gap <= 0.1): ambiguidade => confiança
  // cai para a faixa de revisão humana, nunca decide sozinho.
  const rival = matches.find((pattern) => pattern.classification !== top.classification && pattern.weight >= top.weight - 0.1);
  if (rival) {
    winner.confidence = Math.min(winner.confidence, REVIEW_THRESHOLD + 0.1);
    winner.reasons.push(`conflito com: ${rival.label}`);
  }
  return winner;
}

export function domainOfAddress(address: string): string | null {
  const parts = address.trim().toLowerCase().split("@");
  return parts.length === 2 && parts[1] ? parts[1] : null;
}

export interface ClassifyEmailInput {
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  direction: "INBOUND" | "OUTBOUND" | null;
  attachmentFileNames: string[];
  clientDomains: string[];
  clientAddresses?: string[];
}

export interface EmailClassificationResult extends ClassificationResult<EmailDocumentClassification> {
  sentToClient: boolean;
  workWeekNumber: number | null;
  workWeekLabel: string | null;
  workWeekStatus: "IDENTIFIED" | "NOT_IDENTIFIED";
}

/** Filtro transversal: OUTBOUND e pelo menos um To/Cc no domínio/endereço do cliente. */
export function isSentToClient(input: Pick<ClassifyEmailInput, "direction" | "toAddresses" | "ccAddresses" | "clientDomains" | "clientAddresses">): boolean {
  if (input.direction !== "OUTBOUND") return false;
  const domains = new Set(input.clientDomains.map((domain) => domain.trim().toLowerCase()).filter(Boolean));
  const addresses = new Set((input.clientAddresses ?? []).map((address) => address.trim().toLowerCase()).filter(Boolean));
  return [...input.toAddresses, ...input.ccAddresses].some((address) => {
    const normalized = address.trim().toLowerCase();
    if (addresses.has(normalized)) return true;
    const domain = domainOfAddress(normalized);
    return domain !== null && domains.has(domain);
  });
}

export function classifyEmail(input: ClassifyEmailInput): EmailClassificationResult {
  const parsed = parseWorkWeekSubject(input.subject);
  const reasons: string[] = [];
  let classification: EmailDocumentClassification = "UNCLASSIFIED";
  let confidence = 0;

  const bySubject = best(SUBJECT_PATTERNS, input.subject);
  if (bySubject) {
    classification = bySubject.classification;
    confidence = bySubject.confidence;
    reasons.push(...bySubject.reasons);
  }

  // Anexos reforçam (nunca contradizem sozinhos o assunto forte).
  const fileHits = input.attachmentFileNames
    .map((name) => best(FILE_PATTERNS, name))
    .filter((hit): hit is NonNullable<typeof hit> => hit !== null);
  const emailLevelFileHits = fileHits.filter((hit) => hit.classification !== "CRONOGRAMA_MPP" && hit.classification !== "RELATORIO_SEMANAL_PLANEJAMENTO");
  if (emailLevelFileHits.length > 0) {
    const top = emailLevelFileHits.sort((a, b) => b.confidence - a.confidence)[0];
    if (classification === "UNCLASSIFIED") {
      classification = top.classification as EmailDocumentClassification;
      confidence = Math.min(top.confidence, 0.75);
      reasons.push(`sem sinal no assunto; ${top.reasons[0]}`);
    } else if (top.classification === classification) {
      confidence = Math.min(1, confidence + 0.05);
      reasons.push(`anexo confirma (${top.reasons[0]})`);
    } else {
      reasons.push(`anexo sugere ${top.classification} (${top.reasons[0]}) — mantida a classificação do assunto`);
    }
  }

  // Relatório semanal: .mpp + PDF/Curva S no mesmo e-mail reforçam; WNN também.
  if (classification === "RELATORIO_SEMANAL" || parsed.isWeeklyReport) {
    if (fileHits.some((hit) => hit.classification === "CRONOGRAMA_MPP" || hit.classification === "RELATORIO_SEMANAL_PLANEJAMENTO")) {
      classification = "RELATORIO_SEMANAL";
      confidence = Math.max(confidence, 0.9);
      reasons.push("pacote com .mpp/planilha do relatório semanal");
    }
    if (parsed.workWeekStatus === "IDENTIFIED") {
      confidence = Math.min(1, Math.max(confidence, 0.85) + 0.05);
      reasons.push(`semana da obra ${parsed.workWeekLabel}`);
    }
  }

  const status = statusFor(confidence);
  if (status === "UNCLASSIFIED") {
    classification = "UNCLASSIFIED";
    reasons.push("nenhum padrão determinístico com confiança suficiente");
  }

  return {
    classification,
    confidence: Math.round(confidence * 100) / 100,
    status,
    reasons,
    sentToClient: isSentToClient(input),
    workWeekNumber: parsed.workWeekNumber,
    workWeekLabel: parsed.workWeekLabel,
    workWeekStatus: parsed.workWeekStatus,
  };
}

export interface ClassifyAttachmentInput {
  fileName: string;
  mimeType: string;
  /** Classificação já decidida para o e-mail (contexto). */
  emailClassification: EmailDocumentClassification;
}

export function classifyAttachment(input: ClassifyAttachmentInput): ClassificationResult<EmailAttachmentClassification> {
  const name = input.fileName.trim();
  const lower = name.toLowerCase();

  if (lower.endsWith(".mpp") || MPP_MIME.has(input.mimeType.toLowerCase())) {
    return { classification: "CRONOGRAMA_MPP", confidence: 0.98, status: "AUTO", reasons: ["arquivo Microsoft Project"] };
  }

  // Planilha (xlsx/xls) dentro de um e-mail de relatório semanal => é a
  // planilha do relatório semanal, mesmo sem sinal no nome.
  const isSpreadsheet = /\.(xlsx|xlsm|xls)$/i.test(lower) || /spreadsheetml|ms-excel/i.test(input.mimeType);
  if (isSpreadsheet && input.emailClassification === "RELATORIO_SEMANAL") {
    return { classification: "RELATORIO_SEMANAL_PLANEJAMENTO", confidence: 0.9, status: "AUTO", reasons: ["planilha anexada a e-mail de relatório semanal"] };
  }

  const hit = best(FILE_PATTERNS, name);
  if (hit) {
    return { classification: hit.classification, confidence: hit.confidence, status: statusFor(hit.confidence), reasons: hit.reasons };
  }

  // Sem sinal no nome: herda a classificação do e-mail com confiança reduzida.
  if (input.emailClassification !== "UNCLASSIFIED") {
    return {
      classification: input.emailClassification,
      confidence: 0.6,
      status: "PENDING_HUMAN_REVIEW",
      reasons: [`sem sinal no nome do arquivo; herdado do e-mail (${input.emailClassification})`],
    };
  }

  return { classification: "UNCLASSIFIED", confidence: 0, status: "UNCLASSIFIED", reasons: ["nenhum padrão determinístico"] };
}
