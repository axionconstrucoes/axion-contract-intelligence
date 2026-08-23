// Distingue CLIENT_COMMUNICATION de INTERNAL_AXION_COMMUNICATION
// (seção 10 do requisito de ingestão Gmail) — nunca trata comunicação
// interna AXION↔AXION como manifestação do cliente, mas também nunca a
// exclui da ingestão só por ser interna (ela pode ser documentalmente
// relevante). Função pura, reutiliza os endereços já extraídos por
// evaluateGmailMessagePolicy (apps/web/lib/email/inbound/gmail-inbound-policy.ts)
// — nunca uma segunda extração de endereços.

import type { CommunicationScope } from "./types";

export function classifyCommunicationScope(participantAddresses: string[], axionDomain: string): CommunicationScope {
  const normalizedAxionDomain = axionDomain.toLowerCase();

  const allInternal = participantAddresses.every((address) => {
    const domain = address.split("@")[1]?.toLowerCase();
    return domain === normalizedAxionDomain;
  });

  return allInternal ? "INTERNAL_AXION_COMMUNICATION" : "CLIENT_COMMUNICATION";
}
