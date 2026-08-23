// VOLUME POR FONTE DE INFORMAÇÃO (seção 14) — uma linha por mailbox
// AXION real (getEmailAccounts, nunca uma linha inventada por endereço
// só porque apareceu em algum email), mais uma linha por fonte
// genérica configurada (sourceDefinitions). Dedup do total (mesma
// mensagem em duas mailboxes) por provider_message_id — quando ausente,
// cada e-mail é sua própria chave (nunca colapsado com outro por
// engano).
//
// Nenhuma contagem é inventada: fontes genéricas não têm, hoje, nenhuma
// coluna de itens recebidos/processados/considerados/pendentes no
// banco — por isso essas 4 colunas são sempre NÃO DISPONÍVEL para elas
// (distinto de "0", que só é usado quando a contagem É real e deu
// zero — caso do e-mail).
//
// Puro, sem I/O.

import type { SourceDefinition, SourceType } from "@axion/types";
import type { EmailVolumeRow } from "./compute-email-summary";
import type { EmailProcessingSets } from "./resolve-email-processing-sets";
import { isWithinTimeRange, type ResolvedTimeRange } from "./resolve-time-range";

export type VolumeCount = number | "NAO_DISPONIVEL" | "NAO_CONFIGURADA";

export interface SourceVolumeRow {
  source: string;
  specificOrigin: string;
  contentType: string;
  received: VolumeCount;
  processed: VolumeCount;
  considered: VolumeCount;
  pending: VolumeCount;
  lastSyncAt: string | "NAO_CONFIGURADA" | null;
}

export interface SourceVolumeTotals {
  totalReceived: number;
  totalProcessed: number;
  totalConsidered: number;
  totalPending: number;
}

function dedupKey(row: EmailVolumeRow): string {
  return row.providerMessageId ?? `email:${row.id}`;
}

export function computeEmailMailboxVolumeRows(
  accounts: { emailAddress: string }[],
  emailRows: EmailVolumeRow[],
  sets: EmailProcessingSets,
  range: ResolvedTimeRange,
  latestSyncAt: string | null
): { rows: SourceVolumeRow[]; totals: SourceVolumeTotals } {
  const receivedInRange = emailRows.filter((row) => row.direction === "INBOUND" && isWithinTimeRange(row.sentAt, range));

  const rows: SourceVolumeRow[] = accounts.map((account) => {
    const mailboxRows = receivedInRange.filter((row) => row.mailboxAddress === account.emailAddress);
    const processed = mailboxRows.filter((row) => sets.processedEmailIds.has(row.id)).length;
    const considered = mailboxRows.filter((row) => sets.consideredEmailIds.has(row.id)).length;

    return {
      source: "E-mail Corporativo (Google Workspace)",
      specificOrigin: account.emailAddress,
      contentType: "E-mails",
      received: mailboxRows.length,
      processed,
      considered,
      pending: mailboxRows.length - processed,
      lastSyncAt: latestSyncAt,
    };
  });

  const uniqueReceivedKeys = new Set(receivedInRange.map(dedupKey));
  const uniqueProcessedKeys = new Set(receivedInRange.filter((row) => sets.processedEmailIds.has(row.id)).map(dedupKey));
  const uniqueConsideredKeys = new Set(receivedInRange.filter((row) => sets.consideredEmailIds.has(row.id)).map(dedupKey));

  return {
    rows,
    totals: {
      totalReceived: uniqueReceivedKeys.size,
      totalProcessed: uniqueProcessedKeys.size,
      totalConsidered: uniqueConsideredKeys.size,
      totalPending: uniqueReceivedKeys.size - uniqueProcessedKeys.size,
    },
  };
}

export interface GenericIntegrationConfigForVolume {
  sourceType: SourceType;
  externalSystemReference: string | null;
  externalProjectReference: string | null;
  lastSyncAt: string | null;
}

/** "Configurada" exige origem preenchida por humano ou já ter sincronizado alguma vez — nunca só a linha PENDENTE default. */
function isConfigured(config: GenericIntegrationConfigForVolume | undefined): boolean {
  if (!config) return false;
  return Boolean(config.externalSystemReference || config.externalProjectReference || config.lastSyncAt);
}

export function computeGenericSourceVolumeRows(
  sources: SourceDefinition[],
  configs: GenericIntegrationConfigForVolume[]
): SourceVolumeRow[] {
  return sources
    .filter((source) => source.type !== "EMAIL")
    .map((source) => {
      const config = configs.find((c) => c.sourceType === source.type);
      const configured = isConfigured(config);

      return {
        source: source.label,
        specificOrigin: configured ? (config!.externalSystemReference ?? config!.externalProjectReference ?? "Origem ainda não definida") : "NÃO CONFIGURADA",
        contentType: source.description,
        received: configured ? "NAO_DISPONIVEL" : "NAO_CONFIGURADA",
        processed: configured ? "NAO_DISPONIVEL" : "NAO_CONFIGURADA",
        considered: configured ? "NAO_DISPONIVEL" : "NAO_CONFIGURADA",
        pending: configured ? "NAO_DISPONIVEL" : "NAO_CONFIGURADA",
        lastSyncAt: configured ? (config!.lastSyncAt ?? null) : "NAO_CONFIGURADA",
      } satisfies SourceVolumeRow;
    });
}
