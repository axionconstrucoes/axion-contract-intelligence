// Texto padrão para dado ausente (seção 19 — regra absoluta: zero dados
// fictícios). "NÃO DISPONÍVEL" = desconhecido/não modelado ainda;
// "AGUARDANDO FONTE" = depende de uma integração/fonte que ainda não
// foi conectada. Nunca renderizar 0 nesses casos.

export function ValuePlaceholder({ kind = "NAO_DISPONIVEL", note }: { kind?: "NAO_DISPONIVEL" | "AGUARDANDO_FONTE" | "NAO_CONFIGURADA"; note?: string }) {
  const label = kind === "AGUARDANDO_FONTE" ? "AGUARDANDO FONTE" : kind === "NAO_CONFIGURADA" ? "NÃO CONFIGURADA" : "NÃO DISPONÍVEL";
  return (
    <span className="inline-flex flex-col">
      <span className="text-sm font-semibold text-muted-foreground">{label}</span>
      {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
    </span>
  );
}

export function SourceLine({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground">Fonte: {text}</p>;
}
