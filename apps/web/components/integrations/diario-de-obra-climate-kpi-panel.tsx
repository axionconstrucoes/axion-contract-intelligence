// Painel do KPI "Disponibilidade operacional por clima e catastrofes".
//
// SO NUMERO, DATA E PERCENTUAL. Nenhuma descricao de ocorrencia, nome de
// pessoa, endereco ou midia chega aqui — a view do banco ja devolve so
// contagem e booleano, e `climate-kpi.ts` so soma e divide.
//
// ZERO IA — E DITO NA TELA
//
// `AVISO_IA_DESATIVADA_CLIMA` aparece no rodape, igual ao painel de
// monitoramento geral do Diario de Obra: a afirmacao precisa ser
// verificavel por quem le, sem abrir codigo.

import { formatDate } from "@/lib/labels";
import type { ClimaKpiDoPeriodo } from "@/lib/integrations/diario-de-obra/climate-kpi";
import { formatarNumeroPtBr, formatarPercentualPtBr } from "@/lib/integrations/diario-de-obra/format-numero-pt-br";

export const DIARIO_CLIMA_KPI_TITULO = "Disponibilidade operacional por clima e catástrofes";

export const DIARIO_CLIMA_KPI_SEM_DADOS =
  "Nenhum RDO com data legível ainda para calcular este KPI.";

export const DIARIO_CLIMA_KPI_NOTA_RESIDUAL =
  "Candidatos residuais não reduzem o KPI sem confirmação humana";

export const AVISO_IA_DESATIVADA_CLIMA = "Análise por IA desativada — 0 tokens";

function formatarDias(valor: number): string {
  return Number.isInteger(valor) ? String(valor) : formatarNumeroPtBr(valor);
}

function faixa(inicio: string | null, fim: string | null): string {
  if (!inicio || !fim) return "—";
  return inicio === fim ? formatDate(inicio) : `${formatDate(inicio)} a ${formatDate(fim)}`;
}

export function DiarioDeObraClimateKpiPanel({
  overview,
}: {
  overview: ClimaKpiDoPeriodo | null;
}) {
  if (!overview) {
    return (
      <div className="flex flex-col gap-1.5 rounded-md border bg-background/60 p-2">
        <p className="text-xs font-semibold text-foreground">{DIARIO_CLIMA_KPI_TITULO}</p>
        <p className="text-xs text-muted-foreground">{DIARIO_CLIMA_KPI_SEM_DADOS}</p>
        <p className="text-xs font-medium text-muted-foreground">{AVISO_IA_DESATIVADA_CLIMA}</p>
      </div>
    );
  }

  const indicadores: Array<{ rotulo: string; valor: string }> = [
    { rotulo: "Período analisado", valor: faixa(overview.periodoInicio, overview.periodoFim) },
    { rotulo: "Dias/RDOs monitorados", valor: String(overview.diasMonitorados) },
    { rotulo: "Turnos monitorados", valor: String(overview.turnosMonitorados) },
    {
      rotulo: "Dias equivalentes perdidos por chuva direta",
      valor: `${formatarDias(overview.diasEquivalentesPerdidosPorChuvaDireta)} (${overview.turnosPerdidosPorChuvaDireta} turno(s))`,
    },
    {
      rotulo: "Dias equivalentes confirmados por catástrofe",
      valor: `${formatarDias(overview.diasEquivalentesConfirmadosPorCatastrofe)} (${overview.turnosPerdidosPorCatastrofe} turno(s))`,
    },
    { rotulo: "Candidatos a efeito residual", valor: String(overview.candidatosEfeitoResidual) },
    {
      rotulo: "Disponibilidade operacional confirmada",
      valor: formatarPercentualPtBr(overview.disponibilidadeConfirmadaPercentual),
    },
    {
      rotulo: "Ocorrências catastróficas sem paralisação confirmada",
      valor: String(overview.ocorrenciasCatastroficasSemParalisacaoConfirmada),
    },
    {
      rotulo: "Cobertura dos dados climáticos",
      valor:
        `${formatarPercentualPtBr(overview.coberturaClimaticaPercentual)} ` +
        `(${overview.diasComClimaLegivel}/${overview.diasMonitorados} dia(s))`,
    },
  ];

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-background/60 p-2">
      <p className="text-xs font-semibold text-foreground">{DIARIO_CLIMA_KPI_TITULO}</p>

      <dl className="grid gap-1 text-xs sm:grid-cols-2">
        {indicadores.map((indicador) => (
          <div key={indicador.rotulo}>
            <dt className="text-muted-foreground">{indicador.rotulo}:</dt>
            <dd className="text-foreground">{indicador.valor}</dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-muted-foreground">{DIARIO_CLIMA_KPI_NOTA_RESIDUAL}</p>
      <p className="text-xs font-medium text-muted-foreground">{AVISO_IA_DESATIVADA_CLIMA}</p>
    </div>
  );
}
