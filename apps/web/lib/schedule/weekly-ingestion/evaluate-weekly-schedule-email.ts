// Regra de autorização da ingestão automática do cronograma semanal —
// PURA (sem I/O), executável tanto pelo Next.js quanto por
// scripts/test-weekly-schedule-email-ingestion.mjs.
//
// Ordem de avaliação (cada passo grava a regra que decidiu):
//   1. janela de monitoramento do projeto (fora => IGNORED_OUTSIDE_WINDOW);
//   2. existe pelo menos um anexo .mpp? (não => IGNORED_NO_MPP — um
//      e-mail comum do Planejamento nunca vira "rejeição");
//   3. domínio corporativo do remetente (config.senderDomain);
//   4. pelo menos um To/Cc no domínio/endereço do cliente configurado;
//   5. remetente: profile existe -> membership no projeto ACTIVE ->
//      área autorizada -> escalão SEGUNDO A MATRIZ de responsabilidades
//      (resolveUserResponsibilityTier) dentro dos escalões habilitados
//      pelo projeto (authorizedTiers). Matriz ausente/ambígua =>
//      PENDING_HUMAN_REVIEW. Planejador válido em OUTRO projeto mas sem
//      vínculo neste => PENDING_HUMAN_REVIEW (nunca autoriza, nunca
//      descarta a evidência);
//   6. identificação inequívoca do .mpp (um só, ou regex do projeto
//      casando exatamente um) — senão PENDING_HUMAN_REVIEW.
//
// Deduplicação por SHA-256 NÃO acontece aqui (exige download) — ver
// ingest-weekly-schedule-email.ts.

import type {
  EmailAttachmentDescriptor,
  MppAttachmentSelection,
  SenderAuthorizationOutcome,
  SenderProjectStanding,
  SenderResolution,
  WeeklyScheduleEmailCandidate,
  WeeklyScheduleEmailDecision,
  WeeklyScheduleIngestionConfig,
} from "./types";

const MPP_MIME_TYPES = new Set(["application/vnd.ms-project", "application/x-project", "application/msproject"]);

export function domainOf(address: string): string | null {
  const parts = address.trim().toLowerCase().split("@");
  return parts.length === 2 && parts[1] ? parts[1] : null;
}

export function isMppAttachment(attachment: Pick<EmailAttachmentDescriptor, "fileName" | "mimeType">): boolean {
  const name = attachment.fileName.trim().toLowerCase();
  if (name.endsWith(".mpp")) return true;
  return MPP_MIME_TYPES.has(attachment.mimeType.trim().toLowerCase()) && !name.endsWith(".xml");
}

export function isWithinMonitoringWindow(
  sentAt: string,
  window: Pick<WeeklyScheduleIngestionConfig, "monitoringStartAt" | "monitoringEndAt">
): boolean {
  const sent = new Date(sentAt).getTime();
  if (Number.isNaN(sent)) return false;
  if (window.monitoringStartAt && sent < new Date(window.monitoringStartAt).getTime()) return false;
  if (window.monitoringEndAt && sent > new Date(window.monitoringEndAt).getTime()) return false;
  return true;
}

/** true quando ALGUM To/Cc casa com um domínio ou endereço do cliente configurado. */
export function hasClientRecipient(
  candidate: Pick<WeeklyScheduleEmailCandidate, "toAddresses" | "ccAddresses">,
  config: Pick<WeeklyScheduleIngestionConfig, "clientRecipientDomains" | "clientRecipientAddresses" | "requireClientRecipient">
): boolean {
  if (!config.requireClientRecipient) return true;

  const domains = new Set(config.clientRecipientDomains.map((domain) => domain.trim().toLowerCase()).filter(Boolean));
  const addresses = new Set(config.clientRecipientAddresses.map((address) => address.trim().toLowerCase()).filter(Boolean));
  if (domains.size === 0 && addresses.size === 0) return false;

  return [...candidate.toAddresses, ...candidate.ccAddresses]
    .map((address) => address.trim().toLowerCase())
    .some((address) => {
      if (addresses.has(address)) return true;
      const domain = domainOf(address);
      return domain !== null && domains.has(domain);
    });
}

export function evaluateSenderAuthorization(
  candidate: Pick<WeeklyScheduleEmailCandidate, "fromAddress">,
  config: Pick<WeeklyScheduleIngestionConfig, "projectId" | "senderDomain" | "authorizedArea" | "authorizedTiers">,
  sender: SenderResolution
): SenderAuthorizationOutcome {
  const fromDomain = domainOf(candidate.fromAddress);
  if (fromDomain !== config.senderDomain.trim().toLowerCase()) {
    return {
      kind: "REJECTED",
      userId: sender.userId,
      tier: null,
      rule: "SENDER_DOMAIN_NOT_CORPORATE",
      reasons: [`Remetente fora do domínio corporativo configurado (${config.senderDomain}).`],
    };
  }

  if (!sender.userId) {
    return {
      kind: "REJECTED",
      userId: null,
      tier: null,
      rule: "SENDER_NOT_REGISTERED",
      reasons: ["Remetente não possui usuário cadastrado no ACC."],
    };
  }

  const authorizedTiers = new Set<string>(config.authorizedTiers);
  const qualifies = (standing: SenderProjectStanding) =>
    standing.membershipStatus === "ACTIVE" && standing.area === config.authorizedArea && authorizedTiers.has(standing.tier);

  const here = sender.standings.find((standing) => standing.projectId === config.projectId);

  if (!here) {
    const elsewhere = sender.standings.filter(qualifies);
    if (elsewhere.length > 0) {
      return {
        kind: "REVIEW",
        userId: sender.userId,
        tier: null,
        rule: "PLANNER_WITHOUT_PROJECT_LINK",
        reasons: [
          `Usuário é ${config.authorizedArea} de 1º/2º escalão em ${elsewhere.length} outro(s) projeto(s), mas não tem vínculo com este projeto.`,
        ],
      };
    }
    return {
      kind: "REJECTED",
      userId: sender.userId,
      tier: null,
      rule: "SENDER_NOT_PROJECT_MEMBER",
      reasons: ["Remetente não é membro deste projeto nem planejador autorizado em outro projeto."],
    };
  }

  if (here.membershipStatus !== "ACTIVE") {
    return {
      kind: "REJECTED",
      userId: sender.userId,
      tier: here.tier,
      rule: "SENDER_MEMBERSHIP_NOT_ACTIVE",
      reasons: [`Membership do remetente neste projeto não está ACTIVE (${here.membershipStatus}).`],
    };
  }

  if (here.area !== config.authorizedArea) {
    return {
      kind: "REJECTED",
      userId: sender.userId,
      tier: here.tier,
      rule: "SENDER_AREA_NOT_AUTHORIZED",
      reasons: [`Área do remetente (${here.area ?? "não informada"}) difere da área autorizada (${config.authorizedArea}).`],
    };
  }

  // Escalão: SOMENTE a Matriz de responsabilidades e prazos decide.
  if (here.tier === "NOT_CONFIGURED") {
    return {
      kind: "REVIEW",
      userId: sender.userId,
      tier: here.tier,
      rule: "MATRIX_NOT_CONFIGURED",
      reasons: [`Matriz de responsabilidades e prazos sem definição para ${config.authorizedArea}: ${here.tierReason}`],
    };
  }
  if (here.tier === "AMBIGUOUS") {
    return {
      kind: "REVIEW",
      userId: sender.userId,
      tier: here.tier,
      rule: "MATRIX_AMBIGUOUS",
      reasons: [`Matriz de responsabilidades e prazos ambígua para o remetente: ${here.tierReason}`],
    };
  }
  if (here.tier === "NOT_AUTHORIZED" || !authorizedTiers.has(here.tier)) {
    return {
      kind: "REJECTED",
      userId: sender.userId,
      tier: here.tier,
      rule: "SENDER_TIER_NOT_AUTHORIZED",
      reasons: [
        `Escalão do remetente segundo a Matriz (${here.tier}: ${here.tierReason}) fora dos escalões habilitados (${config.authorizedTiers.join("/")}).`,
      ],
    };
  }

  return { kind: "AUTHORIZED", userId: sender.userId, tier: here.tier };
}

export function selectMppAttachment(
  attachments: EmailAttachmentDescriptor[],
  config: Pick<WeeklyScheduleIngestionConfig, "attachmentNamePattern">
): MppAttachmentSelection {
  const candidates = attachments.filter(isMppAttachment);
  if (candidates.length === 0) return { kind: "NONE" };
  if (candidates.length === 1) return { kind: "SELECTED", attachment: candidates[0], candidates, how: "ONLY_MPP" };

  // Regra institucional do pacote semanal: quando há mais de um
  // .mpp e exatamente um deles é o cronograma principal (nome contém
  // "cronograma"), seleciona-o. Arquivos auxiliares como "Estratificação
  // de Tarefas Futuras" permanecem como evidência, mas não viram a versão
  // oficial do cronograma semanal.
  const cronogramaNamed = candidates.filter((candidate) => /(^|[^a-z])cronograma([^a-z]|$)/i.test(candidate.fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
  if (cronogramaNamed.length === 1) {
    return { kind: "SELECTED", attachment: cronogramaNamed[0], candidates, how: "NAME_PATTERN" };
  }

  const pattern = config.attachmentNamePattern?.trim();
  if (pattern) {
    let regex: RegExp | null = null;
    try {
      regex = new RegExp(pattern, "i");
    } catch {
      regex = null;
    }
    if (regex) {
      const matched = candidates.filter((candidate) => regex.test(candidate.fileName));
      if (matched.length === 1) return { kind: "SELECTED", attachment: matched[0], candidates, how: "NAME_PATTERN" };
      return {
        kind: "AMBIGUOUS",
        candidates,
        reasons: [
          `E-mail traz ${candidates.length} anexos .mpp e o padrão de nome do projeto casou ${matched.length} deles (esperado exatamente 1).`,
        ],
      };
    }
    return {
      kind: "AMBIGUOUS",
      candidates,
      reasons: [`E-mail traz ${candidates.length} anexos .mpp e o padrão de nome configurado é inválido.`],
    };
  }

  return {
    kind: "AMBIGUOUS",
    candidates,
    reasons: [`E-mail traz ${candidates.length} anexos .mpp e o projeto não configura padrão de nome para desambiguar.`],
  };
}

export function evaluateWeeklyScheduleEmail(
  candidate: WeeklyScheduleEmailCandidate,
  config: WeeklyScheduleIngestionConfig,
  sender: SenderResolution
): WeeklyScheduleEmailDecision {
  const selection = selectMppAttachment(candidate.attachments, config);
  const mppCandidates = selection.kind === "NONE" ? [] : selection.candidates;

  if (!isWithinMonitoringWindow(candidate.sentAt, config)) {
    return {
      status: "IGNORED_OUTSIDE_WINDOW",
      rule: "OUTSIDE_MONITORING_WINDOW",
      reasons: ["Mensagem fora da janela de monitoramento do projeto."],
      senderUserId: sender.userId,
      senderTier: null,
      selectedAttachment: null,
      mppCandidates,
    };
  }

  if (selection.kind === "NONE") {
    return {
      status: "IGNORED_NO_MPP",
      rule: "NO_MPP_ATTACHMENT",
      reasons: ["Mensagem sem anexo .mpp."],
      senderUserId: sender.userId,
      senderTier: null,
      selectedAttachment: null,
      mppCandidates,
    };
  }

  const authorization = evaluateSenderAuthorization(candidate, config, sender);

  if (authorization.kind === "REJECTED") {
    return {
      status: "REJECTED_UNAUTHORIZED_SENDER",
      rule: authorization.rule,
      reasons: authorization.reasons,
      senderUserId: authorization.userId,
      senderTier: authorization.tier,
      selectedAttachment: null,
      mppCandidates,
    };
  }

  if (!hasClientRecipient(candidate, config)) {
    return {
      status: "REJECTED_RECIPIENT_MISMATCH",
      rule: "NO_CLIENT_RECIPIENT",
      reasons: ["Nenhum destinatário To/Cc pertence ao domínio/endereço do cliente configurado para o projeto."],
      senderUserId: authorization.userId,
      senderTier: authorization.tier,
      selectedAttachment: null,
      mppCandidates,
    };
  }

  if (authorization.kind === "REVIEW") {
    return {
      status: "PENDING_HUMAN_REVIEW",
      rule: authorization.rule,
      reasons: authorization.reasons,
      senderUserId: authorization.userId,
      senderTier: authorization.tier,
      selectedAttachment: null,
      mppCandidates,
    };
  }

  if (selection.kind === "AMBIGUOUS") {
    return {
      status: "PENDING_HUMAN_REVIEW",
      rule: "AMBIGUOUS_MPP_ATTACHMENTS",
      reasons: selection.reasons,
      senderUserId: authorization.userId,
      senderTier: authorization.tier,
      selectedAttachment: null,
      mppCandidates,
    };
  }

  return {
    status: "AUTHORIZED_AUTO",
    rule: "AUTHORIZED_PLANNER_TIER",
    reasons: [
      `Remetente ACTIVE na área ${config.authorizedArea}, ${authorization.tier === "FIRST_TIER" ? "1º escalão" : "2º escalão"} segundo a Matriz de responsabilidades, vinculado ao projeto; destinatário do cliente confirmado; anexo .mpp identificado por ${selection.how === "ONLY_MPP" ? "ser o único .mpp" : "padrão de nome do projeto"}.`,
    ],
    senderUserId: authorization.userId,
    senderTier: authorization.tier,
    selectedAttachment: selection.attachment,
    mppCandidates,
  };
}
