// Deriva a lista de participantes (endereços de e-mail) a partir dos
// e-mails realmente vinculados como evidência aos eventos do projeto.
// ContractEvent não tem campo "participants" no schema — nunca inventado
// aqui; sempre derivado de emails.from_address/to_address reais.

import type { ContractEvent } from "@axion/types";
import type { TimelineEmailContext, TimelineParticipant } from "./types";

export function deriveParticipants(
  events: ContractEvent[],
  emailsById: Map<string, TimelineEmailContext>
): TimelineParticipant[] {
  const countByAddress = new Map<string, number>();

  for (const event of events) {
    const addressesInEvent = new Set<string>();

    for (const evidence of event.evidence) {
      if (!evidence.emailId) continue;
      const email = emailsById.get(evidence.emailId);
      if (!email) continue;

      for (const address of [email.from, ...email.to.split(",")]) {
        const trimmed = address.trim();
        if (trimmed) addressesInEvent.add(trimmed.toLowerCase());
      }
    }

    for (const address of addressesInEvent) {
      countByAddress.set(address, (countByAddress.get(address) ?? 0) + 1);
    }
  }

  return Array.from(countByAddress.entries())
    .map(([address, eventCount]) => ({ address, eventCount }))
    .sort((a, b) => b.eventCount - a.eventCount || a.address.localeCompare(b.address));
}
