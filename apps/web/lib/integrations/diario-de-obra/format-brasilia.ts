// Formatacao de instante para o painel do Diario de Obra, em Brasilia.
//
// POR QUE UM FORMATADOR PROPRIO, E NAO `formatDateTime` de `lib/labels`
//
// `formatDateTime` usa `toLocaleString("pt-BR", {...})` SEM `timeZone`
// explicito: o resultado usa o fuso do PROCESSO que roda o codigo — em
// producao, o runtime serverless roda em UTC. Um sync run as 02:11 em
// Brasilia (05:11 UTC) aparecia como "05:11", com o rotulo pt-BR mas a
// hora de Londres, e perto da virada de meia-noite ISSO TROCA O DIA
// exibido. `lib/labels` e' usado em 29 arquivos fora do Diario de Obra;
// consertar o formatador global esta fora do escopo desta correcao.
//
// Modulo puro: sem rede, sem banco, sem IA. So `Intl`, que ja sabe
// converter fuso — nenhuma soma ou subtracao manual de hora ou dia.

const FUSO_BRASILIA = "America/Sao_Paulo";

const FORMATADOR_DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_BRASILIA,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Formata um instante ISO (UTC) como data e hora de Brasilia.
 *
 * `null`/vazio devolve "—": ausencia de carimbo nao e' meia-noite de
 * 1970, e' ausencia.
 */
export function formatarDataHoraBrasilia(iso: string | null | undefined): string {
  if (!iso) return "—";

  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return "—";

  return FORMATADOR_DATA_HORA.format(instante);
}
