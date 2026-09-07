// Painel de monitoramento do Construmanager — escopo somente metadados.
//
// Substitui o painel de download. A integração deixou de transferir
// desenhos: ela observa a obra e informa o que mudou. Por isso a tela
// não tem "preparar conteúdo", não tem "baixar" e não destaca uma fila
// de pendentes — aquela fila media progresso de um trabalho que não
// existe mais, e deixá-la em evidência sugeriria uma pendência real.
//
// O conteúdo já armazenado antes da decisão continua no Storage e
// aparece aqui, discreto: escondê-lo criaria uma inconsistência entre o
// que a tela afirma e o que o banco guarda.
//
// ZERO DE FALHA NÃO É ZERO DE RESULTADO
//
// Quando a última tentativa falha, esta tela mostra os últimos totais
// CONFIRMADOS e diz, separadamente, que a verificação mais recente não
// concluiu. Mostrar "0 documentos" porque uma chamada falhou seria
// afirmar que o acervo esvaziou.

import { formatDateTime } from "@/lib/labels";
import type { ConstrumanagerMetadataOverview } from "@/lib/integrations/construmanager/get-metadata-overview";

export const MONITORING_SCOPE_NOTE =
  "Esta integração monitora informações dos documentos. Nenhum desenho é transferido para o ACC.";

export const STALE_TOTALS_NOTE =
  "A verificação mais recente não concluiu. Os números abaixo são da última verificação confirmada.";

export function ConstrumanagerMonitoringPanel({
  overview,
}: {
  overview: ConstrumanagerMetadataOverview | null;
}) {
  if (!overview) {
    return (
      <div className="flex flex-col gap-1.5 rounded-md border bg-background/60 p-2">
        <p className="text-xs font-semibold text-foreground">
          Monitoramento do Construmanager
        </p>
        <p className="text-xs text-muted-foreground">
          Nenhuma verificação registrada ainda.
        </p>
        <p className="text-xs text-muted-foreground">{MONITORING_SCOPE_NOTE}</p>
      </div>
    );
  }

  const indicadores: Array<{ rotulo: string; valor: string }> = [
    {
      rotulo: "Arquivos monitorados",
      valor: String(overview.storedDocuments),
    },
    {
      rotulo: "Última verificação",
      valor: overview.lastConfirmedSyncAt
        ? formatDateTime(overview.lastConfirmedSyncAt)
        : "—",
    },
    {
      rotulo: "Novos uploads",
      valor: String(overview.documentsCreated),
    },
    {
      rotulo: "Novas revisões",
      valor: String(overview.newRevisions),
    },
  ];

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-background/60 p-2">
      <p className="text-xs font-semibold text-foreground">
        Monitoramento do Construmanager
      </p>

      {/* O aviso vem ANTES dos números: quem lê precisa saber que eles
          são de antes, não do agora. */}
      {overview.showingPreviousTotals ? (
        <p className="text-xs font-bold text-amber-700">{STALE_TOTALS_NOTE}</p>
      ) : null}

      <dl className="grid gap-1 text-xs sm:grid-cols-2">
        {indicadores.map((indicador) => (
          <div key={indicador.rotulo}>
            <dt className="text-muted-foreground">{indicador.rotulo}:</dt>
            <dd className="text-foreground">{indicador.valor}</dd>
          </div>
        ))}
      </dl>

      {overview.newRevisions > 0 ? (
        <p className="text-xs font-bold text-amber-700">
          {overview.newRevisions} revisão(ões) vigente(s) nova(s) para revisar.
        </p>
      ) : null}

      {/* Documento conhecido que a listagem não devolveu. Nunca é
          excluído automaticamente: some da origem é diferente de deixar
          de existir, e a diferença é uma decisão humana. */}
      {overview.notReturnedInLastCheck > 0 ? (
        <p className="text-xs font-bold text-destructive">
          {overview.notReturnedInLastCheck} documento(s) conhecido(s) não
          retornado(s) na última verificação — requer revisão humana. Nada foi
          excluído.
        </p>
      ) : null}

      {overview.legacyStoredContent > 0 ? (
        <p className="text-xs text-muted-foreground">
          {overview.legacyStoredContent} conteúdo(s) anteriormente armazenado(s),
          preservado(s).
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">{MONITORING_SCOPE_NOTE}</p>
    </div>
  );
}
