// Puro, sem I/O — regras da tabela "Providências e pendências para entrega" de cada obra e do
// motor de alertas D−60 / prazos individuais. A persistência (project_delivery_items, migration
// 20261027130000) implementa a MESMA semântica em SQL; este módulo é a especificação executável,
// testada em scripts/test-delivery-items.mjs.
//
// Princípios:
//  - NÃO inventa datas, responsáveis nem comprovações: tudo começa vazio ("A definir").
//  - O checklist inicial NÃO comprova obrigação da construtora: `applicabilityConfirmed` começa
//    falso e a aplicabilidade/responsabilidade contratual precisa ser confirmada por pessoa.
//  - Upload de evidência sozinho NUNCA conclui. Concluir exige confirmação autorizada + evidência
//    ou justificativa; "não aplicável" exige justificativa; ambos ficam no histórico.
//  - Grau de risco é escolhido por item — nunca "crítico" por padrão.

import type { AlertSeverity } from "@axion/types";

export type DeliveryPhase = "INICIO" | "ENTREGA";
export type DeliveryStatus = "PENDENTE" | "EM_ANDAMENTO" | "CONCLUIDO" | "NAO_APLICAVEL";
export type DependencyKind = "CLIENTE" | "CONCESSIONARIA" | "TERCEIRO";

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  PENDENTE: "Pendente",
  EM_ANDAMENTO: "Em andamento",
  CONCLUIDO: "Concluído",
  NAO_APLICAVEL: "Não aplicável",
};

export const DELIVERY_PHASE_LABELS: Record<DeliveryPhase, string> = {
  INICIO: "Início da obra",
  ENTREGA: "Entrega",
};

export const DEPENDENCY_LABELS: Record<DependencyKind, string> = {
  CLIENTE: "Cliente",
  CONCESSIONARIA: "Concessionária",
  TERCEIRO: "Terceiro",
};

export interface DeliveryItem {
  id: string;
  title: string;
  phase: DeliveryPhase;
  /** Origem: item do checklist inicial (chave estável) ou providência específica da obra. */
  checklistKey: string | null;
  /** Data limite de finalização (AAAA-MM-DD) — null = "A definir". */
  deadline: string | null;
  /** Prazo interno antecipado (opcional). */
  internalDeadline: string | null;
  /** Responsável INTERNO (colaborador ativo da obra) — null = "A definir". */
  responsibleUserId: string | null;
  dependencyKind: DependencyKind | null;
  dependencyName: string | null;
  status: DeliveryStatus;
  /** Grau de risco escolhido para o item; null = ainda não definido. */
  risk: AlertSeverity | null;
  evidence: string | null;
  justification: string | null;
  blocksDelivery: boolean;
  /** Aplicabilidade e responsabilidade contratual confirmadas por uma pessoa. */
  applicabilityConfirmed: boolean;
  /** Número do CNO (só para o item de CNO). */
  cnoNumber: string | null;
}

export interface ChecklistTemplateItem {
  key: string;
  title: string;
  phase: DeliveryPhase;
}

// Checklist inicial configurável — ponto de partida, não obrigação comprovada.
export const DEFAULT_DELIVERY_CHECKLIST: readonly ChecklistTemplateItem[] = [
  { key: "CNO", title: "Inscrição da obra no CNO — matrícula da obra no INSS", phase: "INICIO" },
  { key: "AS_BUILT", title: "As-built", phase: "ENTREGA" },
  { key: "DATABOOK", title: "Databook — consolidação final", phase: "ENTREGA" },
  { key: "CATALOGOS_MANUAIS", title: "Catálogos e manuais", phase: "ENTREGA" },
  { key: "TERMOS_GARANTIA", title: "Termos de garantia", phase: "ENTREGA" },
  { key: "NOTAS_FISCAIS_DATABOOK", title: "Notas fiscais pertinentes ao databook", phase: "ENTREGA" },
  { key: "ISS", title: "Quitação/regularização do ISS", phase: "ENTREGA" },
  { key: "AVCB", title: "AVCB — Auto de Vistoria do Corpo de Bombeiros", phase: "ENTREGA" },
  { key: "AGUA_PEDIDO", title: "Água: pedido protocolado", phase: "ENTREGA" },
  { key: "AGUA_LIGACAO", title: "Água: ligação efetivada", phase: "ENTREGA" },
  { key: "ESGOTO_PEDIDO", title: "Esgoto: pedido protocolado", phase: "ENTREGA" },
  { key: "ESGOTO_LIGACAO", title: "Esgoto: ligação efetivada", phase: "ENTREGA" },
  { key: "ENERGIA_PEDIDO", title: "Energia: pedido protocolado", phase: "ENTREGA" },
  { key: "ENERGIA_LIGACAO", title: "Energia: ligação efetivada", phase: "ENTREGA" },
];

/** Linhas iniciais do checklist: nada preenchido, nada confirmado, nada concluído. */
export function buildInitialChecklist(
  idFor: (key: string) => string,
  template: readonly ChecklistTemplateItem[] = DEFAULT_DELIVERY_CHECKLIST
): DeliveryItem[] {
  return template.map((t) => ({
    id: idFor(t.key),
    title: t.title,
    phase: t.phase,
    checklistKey: t.key,
    deadline: null,
    internalDeadline: null,
    responsibleUserId: null,
    dependencyKind: null,
    dependencyName: null,
    status: "PENDENTE",
    risk: null,
    evidence: null,
    justification: null,
    blocksDelivery: false,
    applicabilityConfirmed: false,
    cnoNumber: null,
  }));
}

// ---------- datas (somente AAAA-MM-DD, dias corridos, UTC) ----------

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDay(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new Error(`Data inválida: ${value}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return formatDay(parseDay(day) + days * DAY_MS);
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((parseDay(toDay) - parseDay(fromDay)) / DAY_MS);
}

// ---------- transições (regras de estado) ----------

export class DeliveryRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryRuleError";
  }
}

export interface TransitionInput {
  to: DeliveryStatus;
  /** true quando quem confirma tem autorização para concluir (gestor/gerente/administrador). */
  actorCanConclude: boolean;
  evidence?: string | null;
  justification?: string | null;
}

export interface HistoryEntry {
  kind: "STATUS" | "FIELD" | "EVIDENCE" | "END_DATE_CHANGED" | "CREATED";
  at: string;
  actorUserId: string | null;
  detail: string;
}

const blank = (v: string | null | undefined) => !v || v.trim().length === 0;

/**
 * Valida e aplica a mudança de situação. Concluído: confirmação autorizada + evidência OU
 * justificativa. Não aplicável: justificativa obrigatória. Registrar evidência, por si só, não é
 * uma transição (ver attachEvidence).
 */
export function changeStatus(
  item: DeliveryItem,
  input: TransitionInput,
  actorUserId: string,
  nowIso: string
): { item: DeliveryItem; history: HistoryEntry } {
  const to = input.to;
  if (to === item.status) throw new DeliveryRuleError("A providência já está nesta situação.");

  let evidence = item.evidence;
  let justification = item.justification;

  if (to === "CONCLUIDO") {
    if (!input.actorCanConclude) throw new DeliveryRuleError("Concluir exige confirmação de um usuário autorizado (gestor, gerente ou administrador).");
    const ev = input.evidence ?? item.evidence;
    const just = input.justification;
    if (blank(ev) && blank(just)) throw new DeliveryRuleError("Concluir exige evidência/documento/protocolo ou uma justificativa.");
    evidence = blank(ev) ? item.evidence : (ev as string).trim();
    justification = blank(just) ? item.justification : (just as string).trim();
  } else if (to === "NAO_APLICAVEL") {
    if (blank(input.justification)) throw new DeliveryRuleError("Não aplicável exige justificativa.");
    justification = (input.justification as string).trim();
  }

  const next: DeliveryItem = { ...item, status: to, evidence, justification };
  const detail = `${DELIVERY_STATUS_LABELS[item.status]} → ${DELIVERY_STATUS_LABELS[to]}${blank(input.justification) ? "" : `: ${input.justification!.trim()}`}`;
  return { item: next, history: { kind: "STATUS", at: nowIso, actorUserId, detail } };
}

/** Upload/registro de evidência NUNCA altera a situação. */
export function attachEvidence(item: DeliveryItem, evidence: string, actorUserId: string, nowIso: string): { item: DeliveryItem; history: HistoryEntry } {
  if (blank(evidence)) throw new DeliveryRuleError("Informe a evidência, documento ou protocolo.");
  return {
    item: { ...item, evidence: evidence.trim() },
    history: { kind: "EVIDENCE", at: nowIso, actorUserId, detail: "Evidência registrada (a situação não foi alterada)." },
  };
}

/** Responsável interno precisa ser colaborador ATIVO da obra. */
export function assignResponsible(item: DeliveryItem, userId: string | null, activeMemberUserIds: ReadonlySet<string>): DeliveryItem {
  if (userId !== null && !activeMemberUserIds.has(userId)) {
    throw new DeliveryRuleError("O responsável interno precisa ser um colaborador ativo da obra.");
  }
  return { ...item, responsibleUserId: userId };
}

export function setDependency(item: DeliveryItem, kind: DependencyKind | null, name: string | null): DeliveryItem {
  if (kind !== null && blank(name)) throw new DeliveryRuleError("Informe quem é a parte externa (cliente, concessionária ou terceiro).");
  // O responsável interno pelo acompanhamento é mantido: a dependência não o substitui.
  return { ...item, dependencyKind: kind, dependencyName: kind ? name!.trim() : null };
}

/** Aplicável = não está como "não aplicável". Itens não confirmados continuam aplicáveis para alerta? Ver isAlertEligible. */
export function isOpen(item: DeliveryItem): boolean {
  return item.status === "PENDENTE" || item.status === "EM_ANDAMENTO";
}

// ---------- destaques da tabela ----------

export type DeliveryFlag =
  | "SEM_RESPONSAVEL"
  | "SEM_PRAZO"
  | "PROXIMO_VENCIMENTO"
  | "VENCIDO"
  | "CONCLUIDO"
  | "NAO_APLICAVEL"
  | "BLOQUEIA_ENTREGA"
  | "APLICABILIDADE_A_CONFIRMAR"
  | "RISCO_A_DEFINIR";

export const NEAR_DEADLINE_DAYS = 7;

export function effectiveDeadline(item: DeliveryItem): string | null {
  return item.deadline;
}

export function deliveryFlags(item: DeliveryItem, today: string): DeliveryFlag[] {
  const flags: DeliveryFlag[] = [];
  if (item.status === "CONCLUIDO") flags.push("CONCLUIDO");
  if (item.status === "NAO_APLICAVEL") flags.push("NAO_APLICAVEL");
  if (isOpen(item)) {
    if (!item.responsibleUserId) flags.push("SEM_RESPONSAVEL");
    if (!item.deadline) flags.push("SEM_PRAZO");
    else {
      const left = daysBetween(today, item.deadline);
      if (left < 0) flags.push("VENCIDO");
      else if (left <= NEAR_DEADLINE_DAYS) flags.push("PROXIMO_VENCIMENTO");
    }
    if (item.blocksDelivery) flags.push("BLOQUEIA_ENTREGA");
    if (!item.applicabilityConfirmed) flags.push("APLICABILIDADE_A_CONFIRMAR");
    if (!item.risk) flags.push("RISCO_A_DEFINIR");
  }
  return flags;
}

// ---------- marco de 60 dias e prazos individuais ----------

export const DELIVERY_ALERT_WINDOW_DAYS = 60;

export type AlertPhaseState =
  | "NAO_APLICAVEL_AO_ALERTA" // concluído / não aplicável / fase de início tratada à parte
  | "SEM_DATA_FINAL"
  | "AGUARDANDO_JANELA"
  | "ALERTA"
  | "VENCIDO";

export interface DeliveryAlertSchedule {
  state: AlertPhaseState;
  /** Dia em que o primeiro alerta é devido (AAAA-MM-DD) ou null. */
  alertStart: string | null;
  /** Por que o alerta começa nesse dia. */
  basis: "D_MENOS_60" | "PRAZO_INDIVIDUAL" | null;
  message: string;
}

/**
 * Calendário de alertas de UMA providência de ENTREGA.
 *  - D−60: 60 dias corridos ANTES do término previsto da obra, para todo item aplicável aberto.
 *  - Prazo individual anterior à janela: o alerta começa no vencimento individual... antes da
 *    janela significa que o início é o MENOR entre D−60 e o prazo individual: se o prazo vence
 *    ANTES de D−60, o alerta nasce pelo vencimento, sem aguardar D−60.
 *  - Depois do término (ou do prazo individual) a situação é VENCIDO até conclusão/dispensa.
 *  - Sem data final da obra: não há cálculo possível (nem alerta D−60); prazo individual continua valendo.
 *  - Stateless: ativar o item DENTRO da janela já o torna devido na próxima execução.
 */
export function deliveryAlertSchedule(
  item: Pick<DeliveryItem, "phase" | "status" | "deadline">,
  projectEndDay: string | null,
  today: string
): DeliveryAlertSchedule {
  if (!isOpen(item as DeliveryItem)) {
    return { state: "NAO_APLICAVEL_AO_ALERTA", alertStart: null, basis: null, message: "Item encerrado (concluído ou não aplicável)." };
  }
  if (item.phase !== "ENTREGA") {
    return { state: "NAO_APLICAVEL_AO_ALERTA", alertStart: null, basis: null, message: "Providência de início: acompanhada por prazo próprio, sem janela D−60." };
  }

  const windowStart = projectEndDay ? addDays(projectEndDay, -DELIVERY_ALERT_WINDOW_DAYS) : null;
  let alertStart: string | null = null;
  let basis: DeliveryAlertSchedule["basis"] = null;

  if (windowStart && item.deadline) {
    if (parseDay(item.deadline) < parseDay(windowStart)) {
      alertStart = item.deadline;
      basis = "PRAZO_INDIVIDUAL";
    } else {
      alertStart = windowStart;
      basis = "D_MENOS_60";
    }
  } else if (windowStart) {
    alertStart = windowStart;
    basis = "D_MENOS_60";
  } else if (item.deadline) {
    alertStart = item.deadline;
    basis = "PRAZO_INDIVIDUAL";
  }

  if (!alertStart) {
    return { state: "SEM_DATA_FINAL", alertStart: null, basis: null, message: "Preencha a data final da obra (ou o prazo da providência) para calcular a janela de alertas." };
  }

  const overdueByItem = item.deadline !== null && parseDay(item.deadline) < parseDay(today);
  const overdueByEnd = projectEndDay !== null && parseDay(projectEndDay) < parseDay(today);
  if (overdueByItem || overdueByEnd) {
    return { state: "VENCIDO", alertStart, basis, message: "Prazo vencido — permanece vencida até conclusão ou dispensa justificada." };
  }
  if (parseDay(today) >= parseDay(alertStart)) {
    return { state: "ALERTA", alertStart, basis, message: basis === "PRAZO_INDIVIDUAL" ? "Alerta pelo prazo individual." : "Dentro da janela de 60 dias antes do término." };
  }
  return { state: "AGUARDANDO_JANELA", alertStart, basis, message: `Alertas começam em ${alertStart}.` };
}

/** Itens de ENTREGA com alerta DEVIDO hoje (ALERTA ou VENCIDO), para a próxima execução. */
export function selectDueDeliveryAlerts(
  items: readonly DeliveryItem[],
  projectEndDay: string | null,
  today: string
): Array<{ item: DeliveryItem; schedule: DeliveryAlertSchedule; severity: AlertSeverity; riskDefaulted: boolean }> {
  const due = [];
  for (const item of items) {
    const schedule = deliveryAlertSchedule(item, projectEndDay, today);
    if (schedule.state !== "ALERTA" && schedule.state !== "VENCIDO") continue;
    // Grau de risco: o escolhido; sem escolha, MÉDIO (nunca crítico por padrão) e o item é sinalizado.
    due.push({ item, schedule, severity: item.risk ?? ("MEDIA" as AlertSeverity), riskDefaulted: item.risk === null });
  }
  return due;
}

/**
 * Mudança do término previsto: recalcula marcos FUTUROS. Atrasos já registrados (prazo individual
 * vencido) continuam VENCIDOS — nada é apagado — e o histórico recebe o registro da mudança.
 */
export function recalculateAfterEndDateChange(
  items: readonly DeliveryItem[],
  oldEnd: string | null,
  newEnd: string | null,
  today: string,
  actorUserId: string | null,
  nowIso: string
): { schedules: Array<{ itemId: string; before: DeliveryAlertSchedule; after: DeliveryAlertSchedule }>; history: HistoryEntry } {
  const schedules = items.map((item) => ({
    itemId: item.id,
    before: deliveryAlertSchedule(item, oldEnd, today),
    after: deliveryAlertSchedule(item, newEnd, today),
  }));
  return {
    schedules,
    history: { kind: "END_DATE_CHANGED", at: nowIso, actorUserId, detail: `Término previsto: ${oldEnd ?? "sem data"} → ${newEnd ?? "sem data"}. Marcos futuros recalculados; atrasos registrados preservados.` },
  };
}

// ---------- CNO (providência de INÍCIO) ----------

// Fonte OFICIAL consultada (Receita Federal, gov.br/receitafederal/.../construcao-civil/cno/cno):
// "no prazo de 30 (trinta) dias contados do início das atividades de construção". A página não cita
// o número da norma; por isso o prazo continua CONFIGURÁVEL (prazo interno antecipado e dias
// legais) e o cálculo só é DEFINITIVO com o início das atividades confirmado e sem divergência.
export const CNO_DEFAULT_DEADLINE_DAYS = 30;
export const CNO_OFFICIAL_SOURCE_URL = "https://www.gov.br/receitafederal/pt-br/assuntos/construcao-civil/cno/cno";

export interface CnoDeadline {
  deadline: string | null;
  /** false enquanto o início da obra não estiver confirmado — o cálculo não é definitivo. */
  definitive: boolean;
  /** true quando há mais de uma data de início candidata (ex.: cadastro x histórico). */
  divergent: boolean;
  basis: string;
}

export function computeCnoDeadline(input: {
  constructionStartDay: string | null;
  startConfirmed: boolean;
  internalDeadline?: string | null;
  deadlineDays?: number;
  /** Datas de início candidatas conhecidas (ex.: cadastro e histórico). Mais de uma distinta = divergência. */
  startCandidates?: readonly string[];
}): CnoDeadline {
  const candidates = Array.from(new Set((input.startCandidates ?? []).filter(Boolean)));
  if (candidates.length > 1) {
    // Nunca escolhe uma data por conta própria: sem decisão sobre o início não há prazo legal calculado.
    return {
      deadline: input.internalDeadline ?? null,
      definitive: false,
      divergent: true,
      basis: `Início da obra DIVERGENTE (${candidates.join(" × ")}): prazo legal NÃO calculado até a decisão sobre a data de início das atividades de construção.`,
    };
  }
  if (!input.constructionStartDay) {
    return { deadline: input.internalDeadline ?? null, definitive: false, divergent: false, basis: "Sem data de início da obra: prazo legal não calculado." };
  }
  const days = input.deadlineDays ?? CNO_DEFAULT_DEADLINE_DAYS;
  const legal = addDays(input.constructionStartDay, days);
  const deadline = input.internalDeadline && parseDay(input.internalDeadline) < parseDay(legal) ? input.internalDeadline : legal;
  return {
    deadline,
    definitive: input.startConfirmed,
    divergent: false,
    basis: input.startConfirmed
      ? `Início das atividades confirmado + ${days} dias (Receita Federal, CNO).`
      : `ESTIMADO: início das atividades não confirmado + ${days} dias (Receita Federal, CNO).`,
  };
}

/** Só propõe nova inscrição se não houver CNO informado nem item concluído. */
export function shouldProposeCnoRegistration(cnoItem: Pick<DeliveryItem, "status" | "cnoNumber" | "evidence">): boolean {
  if (!blank(cnoItem.cnoNumber)) return false;
  if (cnoItem.status === "CONCLUIDO") return false;
  if (cnoItem.status === "NAO_APLICAVEL") return false;
  return true;
}

/**
 * Alertas do CNO NÃO esperam a janela de 60 dias da entrega: ausência de responsável, proximidade
 * do prazo e atraso valem desde já.
 */
export function cnoAlertReasons(item: DeliveryItem, today: string): Array<"SEM_RESPONSAVEL" | "PROXIMO_PRAZO" | "ATRASADO"> {
  if (!isOpen(item)) return [];
  const reasons: Array<"SEM_RESPONSAVEL" | "PROXIMO_PRAZO" | "ATRASADO"> = [];
  if (!item.responsibleUserId) reasons.push("SEM_RESPONSAVEL");
  if (item.deadline) {
    const left = daysBetween(today, item.deadline);
    if (left < 0) reasons.push("ATRASADO");
    else if (left <= NEAR_DEADLINE_DAYS) reasons.push("PROXIMO_PRAZO");
  }
  return reasons;
}
