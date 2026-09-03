import { Avatar } from "@/components/ui/avatar";
import { LogoutButton } from "@/components/auth/logout-button";
import { getProjects } from "@/lib/data";
import { ProjectSwitcher } from "./project-switcher";

export async function TopBar({ projectId }: { projectId: string }) {
  const projects = await getProjects();
  const currentProject = projects.find((p) => p.id === projectId);

  return (
    // Grade de 2 colunas no mobile (título · avatar+sair) que vira 3
    // colunas (espaçador · título · grupo da direita) a partir de sm.
    // As duas colunas 1fr do desktop são SEMPRE iguais entre si (regra
    // do CSS Grid), então o título fica realmente centralizado na
    // largura do cabeçalho — não só "no meio do espaço sobrando" como
    // aconteceria com flexbox — independentemente da largura do grupo
    // da direita (nome de projeto curto ou longo).
    <header className="grid shrink-0 grid-cols-2 items-center gap-x-3 gap-y-2 border-b border-border bg-white px-4 py-2 text-foreground shadow-sm sm:h-14 sm:grid-cols-[1fr_auto_1fr] sm:py-0">
      {/* Espaçador: só existe em sm+, com a mesma largura (1fr) do grupo
          da direita — é o que garante a centralização real do título. */}
      <div aria-hidden="true" className="hidden sm:block" />

      {/* Nome da marca por extenso agora vive aqui, centralizado — a
          sidebar mantém só o símbolo (ver app-sidebar.tsx). Uma única
          linha (truncate) em vez de permitir quebra, para nunca colidir
          verticalmente com o grupo da direita. */}
      <h1 className="col-start-1 row-start-1 min-w-0 truncate text-center text-sm font-bold uppercase tracking-wide text-foreground sm:col-start-2">
        AXION Controle de Contratos
      </h1>

      {/* Em telas < sm, este wrapper é "contents": some do layout e seus
          2 filhos abaixo viram itens diretos da grade do header (grupo
          seletor+código+contrato na linha 2, largura cheia; avatar/sair
          na linha 1, ao lado do título). A partir de sm, o wrapper vira
          um flex normal e passa a ocupar sozinho a 3ª coluna, com os 2
          filhos lado a lado — seletor+código+contrato primeiro,
          avatar/sair por último, exatamente a ordem aprovada para o
          canto direito. */}
      <div className="contents sm:col-start-3 sm:row-start-1 sm:flex sm:items-center sm:justify-end sm:gap-3">
        <div className="col-span-2 row-start-2 flex flex-wrap items-center gap-x-2 gap-y-1 sm:col-span-1 sm:row-start-1 sm:flex-nowrap sm:min-w-0">
          {/* min-w-24: nunca encolhe abaixo de um tamanho legível (evita
              o seletor virar só a setinha quando a sidebar não recolhida
              automaticamente sobra pouquíssimo espaço num celular
              estreito) — se código/contrato+seletor não cabem lado a
              lado nessa largura mínima, o wrap acima joga código/contrato
              para uma linha própria em vez de espremer o seletor a ponto
              de esconder o nome do projeto. Código e número do contrato
              nunca usam "hidden" — só truncam/quebram (nunca somem
              definitivamente, exigência explícita). */}
          <ProjectSwitcher
            projects={projects}
            currentProjectId={projectId}
            className="min-w-24 flex-1 sm:max-w-[7rem] sm:flex-initial lg:max-w-[10rem] xl:max-w-[16rem]"
          />
          {currentProject?.code && <span className="shrink-0 text-xs text-muted-foreground">{currentProject.code}</span>}
          {currentProject?.contractNumber && (
            <span className="shrink-0 text-xs text-muted-foreground">Contrato {currentProject.contractNumber}</span>
          )}
        </div>

        <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-3">
          <Avatar>AS</Avatar>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
