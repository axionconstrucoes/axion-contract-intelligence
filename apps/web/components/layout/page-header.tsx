// Cabeçalho padrão obrigatório de todas as telas internas do ACC:
// "AXION CONTROLE DE CONTRATOS — <Nome da aba>" — "AXION CONTROLE DE
// CONTRATOS" sempre preto/negrito, o nome da aba sempre vermelho-escuro
// institucional/negrito. Reutilizado por todas as páginas internas —
// nunca um <h1> avulso reimplementado por página.

export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h1 className="text-lg font-semibold">
        <span className="text-black dark:text-white">AXION CONTROLE DE CONTRATOS</span>
        <span className="text-black dark:text-white"> — </span>
        <span className="text-red-900 dark:text-red-500">{title}</span>
      </h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
