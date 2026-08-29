// Cabeçalho padrão obrigatório de todas as telas internas do ACC — só o
// nome da aba, em vermelho-escuro institucional/negrito. "AXION CONTROLE
// DE CONTRATOS" NÃO é repetido aqui: a marca já aparece uma única vez, na
// sidebar (ver app-sidebar.tsx) — repeti-la em cada cabeçalho de página
// era redundante. Reutilizado por todas as páginas internas — nunca um
// <h1> avulso reimplementado por página.

// `actions` (opcional) — conteúdo alinhado à direita do título (ex.:
// botão de atalho para o Dashboard), só quando a página realmente
// precisa; a maioria das páginas não passa nada aqui e o layout
// continua idêntico ao anterior.
export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-red-900 dark:text-red-500">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
