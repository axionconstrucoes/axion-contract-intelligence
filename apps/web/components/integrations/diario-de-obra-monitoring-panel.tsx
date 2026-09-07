// Painel do Diario de Obra — SOMENTE AGREGADOS.
//
// A tela mostra numero, data e contagem. Nao mostra a descricao de uma
// ocorrencia, o nome de quem assinou o RDO, o endereco da frente de
// servico, um link para foto ou qualquer midia. Quem precisa do teor de
// um registro abre o Diario de Obra, onde ele ja esta e onde o controle
// de acesso e' do fornecedor.
//
// A restricao nao e' so de tela: o leitor entrega apenas numeros, a
// view do banco converte as colecoes de texto em contagem antes de
// devolver, e a evidencia dos achados e' recusada pelo banco se
// carregar texto livre. Tres barreiras para a mesma regra.
//
// ZERO IA — E DITO NA TELA
//
// `AVISO_IA_DESATIVADA` aparece no rodape do painel. Nao e' decoracao:
// e' a afirmacao de que esta area nao consome token, verificavel por
// quem opera o sistema sem precisar ler codigo.

import { formatDate, formatDateTime } from "@/lib/labels";
import type { DiarioDeObraMonitoringOverview } from "@/lib/integrations/diario-de-obra/get-monitoring-overview";

/**
 * Afirmacao exigida em tela. Constante exportada, e nao literal solto,
 * para que o teste possa garantir que ela continua la depois de
 * qualquer refatoracao do painel.
 */
export const AVISO_IA_DESATIVADA = "Análise por IA desativada — 0 tokens";

export const DIARIO_PANEL_TITULO = "Monitoramento do Diário de Obra";

export const DIARIO_SEM_SINCRONIZACAO =
  "Nenhuma sincronização registrada ainda.";

export const DIARIO_ESCOPO_NOTE =
  "Este painel mostra apenas agregados. Nenhum conteúdo de RDO, nome, endereço ou mídia é exibido ou transferido para o ACC.";

export const DIARIO_TOTAIS_ANTERIORES_NOTE =
  "A sincronização mais recente não concluiu. Os números abaixo são da última execução confirmada.";

function ou(valor: string | null | undefined): string {
  return valor && valor.trim() !== "" ? valor : "—";
}

function faixa(inicio: string | null, fim: string | null): string {
  if (!inicio || !fim) return "—";
  return inicio === fim ? formatDate(inicio) : `${formatDate(inicio)} a ${formatDate(fim)}`;
}

export function DiarioDeObraMonitoringPanel({
  overview,
}: {
  overview: DiarioDeObraMonitoringOverview | null;
}) {
  if (!overview) {
    return (
      <div className="flex flex-col gap-1.5 rounded-md border bg-background/60 p-2">
        <p className="text-xs font-semibold text-foreground">{DIARIO_PANEL_TITULO}</p>
        <p className="text-xs text-muted-foreground">{DIARIO_SEM_SINCRONIZACAO}</p>
        <p className="text-xs text-muted-foreground">{DIARIO_ESCOPO_NOTE}</p>
        <p className="text-xs font-medium text-muted-foreground">{AVISO_IA_DESATIVADA}</p>
      </div>
    );
  }

  const agregados = overview.agregados;
  const achados = overview.achados;
  const integridade = agregados.integridade;

  // Integração existente sem status declarado ainda é uma conexão: a
  // tela diz "Configurada" em vez de um travessão, que se leria como
  // ausência de origem.
  const conexao = overview.conectado
    ? (overview.statusDaIntegracao?.trim() || "Configurada")
    : "Não configurada";

  const indicadores: Array<{ rotulo: string; valor: string }> = [
    { rotulo: "Conexão", valor: conexao },
    {
      rotulo: "Última sincronização",
      valor: overview.ultimaSincronizacaoAt
        ? `${formatDateTime(overview.ultimaSincronizacaoAt)} · ${ou(overview.ultimaSincronizacaoModo)} · ${ou(overview.ultimaSincronizacaoStatus)}`
        : "—",
    },
    { rotulo: "Total de RDOs", valor: String(agregados.totalDeRdos) },
    {
      rotulo: "Faixa histórica",
      valor: faixa(agregados.primeiraData, agregados.ultimaData),
    },
    {
      rotulo: "Último RDO",
      valor: agregados.ultimoRdoData
        ? `nº ${agregados.ultimoRdoNumero ?? "—"} · ${formatDate(agregados.ultimoRdoData)}`
        : "—",
    },
    {
      rotulo: "Novos e alterados",
      valor: `${overview.novos} novo(s) · ${overview.alterados} alterado(s)`,
    },
    {
      rotulo: "Ocorrências",
      valor: `${agregados.ocorrenciasRegistradas} em ${agregados.rdosComOcorrencia} RDO(s)`,
    },
    {
      rotulo: "Clima impraticável",
      valor: `${agregados.rdosComClimaImpraticavel} RDO(s) · ${agregados.turnosImpraticaveis} turno(s)`,
    },
    {
      rotulo: "Efetivo mediano",
      valor:
        agregados.efetivoMediano === null
          ? "—"
          : `${agregados.efetivoMediano} (${agregados.rdosComEfetivoLegivel} RDO(s) legível(is))`,
    },
    { rotulo: "RDOs sem foto", valor: String(agregados.rdosSemFoto) },
    { rotulo: "Edições tardias", valor: String(agregados.edicoesTardias) },
    {
      rotulo: "Integridade",
      valor:
        `${integridade.numerosDuplicados} nº duplicado(s) · ` +
        `${integridade.datasDuplicadas} data(s) duplicada(s) · ` +
        `${integridade.saltosDeNumeracao} salto(s) · ` +
        `${integridade.diasSemRdo} dia(s) sem RDO`,
    },
    {
      rotulo: "Achados por severidade",
      valor:
        `${achados.abertosPorSeveridade.ALTO} alto · ` +
        `${achados.abertosPorSeveridade.MEDIO} médio · ` +
        `${achados.abertosPorSeveridade.BAIXO} baixo`,
    },
  ];

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-background/60 p-2">
      <p className="text-xs font-semibold text-foreground">{DIARIO_PANEL_TITULO}</p>

      {/* O aviso vem ANTES dos numeros: quem le precisa saber que eles
          sao de antes, e nao do agora. */}
      {overview.mostrandoTotaisAnteriores ? (
        <p className="text-xs font-bold text-amber-700">{DIARIO_TOTAIS_ANTERIORES_NOTE}</p>
      ) : null}

      <dl className="grid gap-1 text-xs sm:grid-cols-2">
        {indicadores.map((indicador) => (
          <div key={indicador.rotulo}>
            <dt className="text-muted-foreground">{indicador.rotulo}:</dt>
            <dd className="text-foreground">{indicador.valor}</dd>
          </div>
        ))}
      </dl>

      {achados.aguardandoRevisaoHumana > 0 ? (
        <p className="text-xs font-bold text-amber-700">
          {achados.aguardandoRevisaoHumana} achado(s) aguardando revisão humana. O
          sistema aponta; a conclusão é de quem revisa.
        </p>
      ) : null}

      {/* Erro sanitizado na origem: diz QUAL invariante quebrou, nunca
          com que valor. Escondê-lo faria a tela afirmar normalidade. */}
      {overview.ultimaSincronizacaoErro ? (
        <p className="text-xs font-bold text-destructive">
          Última execução: {overview.ultimaSincronizacaoErro}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">{DIARIO_ESCOPO_NOTE}</p>
      <p className="text-xs font-medium text-muted-foreground">{AVISO_IA_DESATIVADA}</p>
    </div>
  );
}
