// Área NOVAS VERSÕES VIGENTES do painel Construmanager.
//
// Existe porque gravar só em audit_log_entries não atende ao requisito
// de *sabermos* que uma nova versão está vigente: ninguém abre o log de
// auditoria todo dia. A transição precisa aparecer onde a pessoa já
// olha.
//
// Somente leitura. Nenhuma ação, nenhum botão de reconhecimento — o ACC
// ainda não tem mecanismo seguro de ciência humana para este fluxo, e
// improvisar um aqui criaria uma ação remota sem lastro no modelo de
// permissões. Quando existir, ele é acoplado a esta lista.
//
// Não classifica a mudança como erro: nova versão vigente é evento
// operacional, e a análise de impacto (custo, prazo, escopo, qualidade,
// segurança, obrigações contratuais) é humana.

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/labels";
import type {
  ConstrumanagerVersionTransition,
  ConstrumanagerVersionTransitionsResult,
  TransitionContentStatus,
} from "@/lib/integrations/construmanager/get-version-transitions";

/**
 * Destaque da novidade: âmbar sólido, texto branco, negrito.
 *
 * Cor própria, deliberadamente fora da família de status de conteúdo —
 * não é verde (armazenado), não é amarelo (pendente), não é vermelho
 * (erro) e não é azul-escuro (referência externa). Uma nova revisão não
 * é nenhum desses estados: é um acontecimento que pede leitura humana.
 */
export const VERSION_TRANSITION_BADGE_CLASS =
  "border-transparent bg-amber-600 text-white font-bold";

/**
 * Aviso de indisponibilidade: vermelho sólido, branco, negrito.
 *
 * Vermelho de propósito, e não âmbar: a novidade é um acontecimento a
 * ler; a indisponibilidade é uma falha a corrigir. Confundir as duas
 * cores faria a equipe tratar um problema de infraestrutura como se
 * fosse notícia de obra.
 */
export const VERSION_MONITORING_UNAVAILABLE_CLASS =
  "border-transparent bg-red-600 text-white font-bold";

const CONTENT_STATUS_LABEL: Record<TransitionContentStatus, string> = {
  ARMAZENADO_NO_ACC: "Armazenado no ACC",
  PENDENTE: "Pendente",
  SOMENTE_NO_CONSTRUMANAGER: "Somente no Construmanager",
};

const CONTENT_STATUS_CLASS: Record<TransitionContentStatus, string> = {
  ARMAZENADO_NO_ACC: "border-transparent bg-green-600 text-white font-bold",
  PENDENTE: "border-transparent bg-yellow-400 text-black font-bold",
  SOMENTE_NO_CONSTRUMANAGER: "border-transparent bg-blue-900 text-white font-bold",
};

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

function TransitionRow({ item }: { item: ConstrumanagerVersionTransition }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <Badge className={cn(VERSION_TRANSITION_BADGE_CLASS)}>
        NOVA VERSÃO VIGENTE
      </Badge>

      <span className="text-foreground">
        {item.documentName ?? "(documento sem nome)"}
      </span>

      <span className="text-muted-foreground">#{item.objectId}</span>

      {/* A transição em si: de onde veio, para onde foi. */}
      <span className="font-mono text-foreground">
        rev {item.previousRevision ?? "—"} → {item.newRevision}
      </span>

      <Badge className={cn(CONTENT_STATUS_CLASS[item.contentStatus])}>
        {CONTENT_STATUS_LABEL[item.contentStatus]}
      </Badge>

      {item.authorName ? (
        <span className="text-muted-foreground">{item.authorName}</span>
      ) : null}

      {item.sizeBytes !== null ? (
        <span className="text-muted-foreground">{formatBytes(item.sizeBytes)}</span>
      ) : null}

      {item.folderPath ? (
        <span className="text-muted-foreground" title={item.folderPath}>
          {item.folderPath}
        </span>
      ) : null}

      <span className="text-muted-foreground">
        detectado em {formatDateTime(item.detectedAt)}
      </span>
    </li>
  );
}

export function ConstrumanagerVersionTransitions({
  result,
}: {
  result: ConstrumanagerVersionTransitionsResult | null;
}) {
  // ESTADO C — a consulta falhou. Nunca fingir lista vazia: num
  // monitoramento, silêncio significa "está tudo bem", e é exatamente
  // essa a mentira que uma falha escondida contaria.
  if (result === null || result.status === "INDISPONIVEL") {
    return (
      <div className="flex flex-col gap-1.5 rounded-md border bg-background/60 p-2">
        <Badge className={cn(VERSION_MONITORING_UNAVAILABLE_CLASS)}>
          MONITORAMENTO DE VERSÕES INDISPONÍVEL
        </Badge>
        <p className="text-xs text-muted-foreground">
          Não foi possível verificar novas versões vigentes agora. Isto não
          significa que não existam. O detalhe técnico foi registrado no
          servidor.
        </p>
      </div>
    );
  }

  const items = result.items;

  // ESTADO B — sucesso sem itens: a área some. Um bloco vazio permanente
  // ensinaria a equipe a ignorar a região da tela onde a novidade vai
  // aparecer.
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-background/60 p-2">
      <p className="text-xs font-bold text-foreground">
        NOVAS VERSÕES VIGENTES · {items.length}
      </p>

      <ul className="flex flex-col gap-0.5 text-xs">
        {items.map((item) => (
          <TransitionRow key={item.id} item={item} />
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">
        Mudança de versão documental segundo os metadados oficiais do
        Construmanager. Sem download não é possível afirmar se o conteúdo
        binário difere. Requer análise humana de impacto.
      </p>
    </div>
  );
}
