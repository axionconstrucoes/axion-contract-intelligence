import "server-only";

import { createFixtureProposalDriveLookupClient } from "./fixture-client";
import type { ProposalDriveLookupClient } from "./types";

// Fail-closed: a fixture determinística (dados de exemplo, ex. "AXN CP
// 617") só pode existir fora de produção — nunca aparecer como se fosse
// real para um usuário de produção. Mesmo idioma fail-closed já usado
// em pilot-outbound-guard.ts (só um valor exato libera o caminho menos
// restrito; qualquer outra coisa, incluindo ausência/erro de leitura,
// mantém o modo seguro). NODE_ENV "production" é sempre definido pelo
// próprio Next.js em `next build`/`next start` (o comando real usado em
// deploy) — nunca depende de uma variável nova que alguém possa
// esquecer de configurar.
//
// Cliente real ainda não existe (ver histórico deste arquivo/relatório
// anterior: precisaria estender lib/drive/drive-client.ts com
// listagem + Google Sheets API, nenhuma das duas implementada). Por
// isso, em produção, esta função retorna null — nunca finge que uma
// integração real está disponível.
export function isProposalDriveFixtureAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function getProposalDriveLookupClient(): ProposalDriveLookupClient | null {
  if (!isProposalDriveFixtureAllowed()) return null;
  return createFixtureProposalDriveLookupClient();
}
