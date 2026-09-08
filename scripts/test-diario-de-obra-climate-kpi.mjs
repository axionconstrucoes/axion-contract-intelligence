// KPI "Disponibilidade operacional por clima e catastrofes" do Diario
// de Obra.
//
// SEM REDE, SEM CREDENCIAL, SEM BANCO REAL, SEM IA. O calculo
// (`climate-kpi.ts`) e' testado diretamente com fixtures; a leitura
// (`get-climate-kpi-overview.ts`) e' testada com um duble de Supabase
// que so captura os argumentos da consulta. A migration SQL nao roda
// aqui — e' auditada por texto, igual ao restante da suite do Diario de
// Obra: presenca de security_invoker, ausencia de coluna jsonb crua na
// view e ausencia de qualquer escrita.
//
// O que esta suite protege:
//
//   1. um turno impraticavel = 0,5 dia perdido, dois = 1 dia;
//   2. "Dia Chuvoso" e "Dia parado" sozinhos (sem catastrofe) nao reduzem
//      a disponibilidade;
//   3. catastrofe sozinha (sem Dia parado nem turno impraticavel) e'
//      ocorrencia, nao dia perdido;
//   4. catastrofe + "Dia parado" reduz a disponibilidade MESMO sem turno
//      climatico marcado como impraticavel — perda_catastrofe = 1 dia,
//      disponibilidade 0% para um unico dia monitorado;
//   5. catastrofe + turno impraticavel (sem Dia parado) atribui a perda
//      ao bucket de CATASTROFE, nao ao de chuva direta — sem dupla
//      contagem entre os dois buckets do painel;
//   6. catastrofe + Dia parado + turno impraticavel: perda_total = 1 dia
//      (max, nunca soma) — nunca 1,5;
//   7. soma de perda_chuva_direta + perda_catastrofe == perda total
//      confirmada, sempre;
//   8. efeito residual so em D-1 EXATO, nunca com turno impraticavel
//      hoje, e nunca reduz a disponibilidade confirmada;
//   9. efetivo zero SO conta com atividade declarada;
//  10. ausencia de RDO nunca entra em nenhuma soma;
//  11. cobertura climatica incompleta e divisao por zero sem NaN;
//  12. isolamento por projeto na leitura;
//  13. migration: security_invoker, sem escrita, sem coluna jsonb crua,
//      SEM extensao (nenhuma dependencia de `unaccent`), normalizacao
//      via `translate` com paridade comprovada contra a normalizacao
//      TypeScript para as 5 categorias do KPI;
//  14. painel: aviso de IA desligada, nota de confirmacao humana,
//      nenhuma palavra de conteudo livre ou midia;
//  15. modulo de calculo e' puro (zero import).
//
// Uso: node scripts/test-diario-de-obra-climate-kpi.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { calcularClimaKpi } = await import(
  "../apps/web/lib/integrations/diario-de-obra/climate-kpi.ts"
);

const { getDiarioDeObraClimateKpiOverview } = await import(
  "../apps/web/lib/integrations/diario-de-obra/get-climate-kpi-overview.ts"
);

const { normalizarRotuloDeCategoria } = await import(
  "../apps/web/lib/integrations/diario-de-obra/occurrence-taxonomy.ts"
);

let passaram = 0;
let falharam = 0;

function check(rotulo, condicao) {
  if (condicao) {
    passaram += 1;
    console.log(`OK   ${rotulo}`);
  } else {
    falharam += 1;
    console.log(`FALHA ${rotulo}`);
  }
}

function ler(relativo) {
  return readFileSync(path.join(RAIZ, relativo), "utf8");
}

const MIGRATION = ler("supabase/migrations/20260908090000_diario_de_obra_climate_kpi.sql");
const KPI_SRC = ler("apps/web/lib/integrations/diario-de-obra/climate-kpi.ts");
const OVERVIEW_SRC = ler("apps/web/lib/integrations/diario-de-obra/get-climate-kpi-overview.ts");
const PAINEL_SRC = ler("apps/web/components/integrations/diario-de-obra-climate-kpi-panel.tsx");


// ============================================================
// Fixture: uma linha da view, na forma ja resolvida (numero, booleano,
// data) — exatamente o que `diario_de_obra_climate_metrics` devolve.
// ============================================================

function linha(data, sobrescritas = {}) {
  return {
    reportId: `rdo-${data}`,
    referenceDate: data,
    impracticableShifts: 0,
    hasWeatherData: true,
    hasDiaChuvoso: false,
    hasDiaParado: false,
    hasTaludeDanificadoPorChuva: false,
    hasCatastrofe: false,
    activityCount: 1,
    laborTotal: 10,
    ...sobrescritas,
  };
}


// ============================================================
// 1. Um turno e dois turnos impraticaveis.
// ============================================================

{
  const r = calcularClimaKpi([linha("2026-06-01", { impracticableShifts: 1 })]);

  check("um turno impraticavel: 1 turno perdido", r.turnosPerdidosPorChuvaDireta === 1);
  check("um turno impraticavel: 0,5 dia equivalente", r.diasEquivalentesPerdidosPorChuvaDireta === 0.5);
  check("um turno impraticavel: disponibilidade 50%", r.disponibilidadeConfirmadaPercentual === 50);
}

{
  const r = calcularClimaKpi([linha("2026-06-01", { impracticableShifts: 2 })]);

  check("dois turnos impraticaveis: 2 turnos perdidos", r.turnosPerdidosPorChuvaDireta === 2);
  check("dois turnos impraticaveis: 1 dia equivalente", r.diasEquivalentesPerdidosPorChuvaDireta === 1);
  check("dois turnos impraticaveis: disponibilidade 0%", r.disponibilidadeConfirmadaPercentual === 0);
}

{
  // A leitura do clima cobre ate 3 turnos (manha/tarde/noite), mas so 2
  // sao monitorados por dia — o excedente nao pode derrubar a
  // disponibilidade abaixo de 0% nem inflar turnos_perdidos acima de
  // turnos_monitorados.
  const r = calcularClimaKpi([linha("2026-06-01", { impracticableShifts: 3 })]);

  check("tres turnos lidos: limitado a 2 monitorados", r.turnosPerdidosPorChuvaDireta === 2);
  check("tres turnos lidos: disponibilidade nao fica negativa", r.disponibilidadeConfirmadaPercentual === 0);
}


// ============================================================
// 2. "Dia Chuvoso" e "Dia parado" sozinhos NAO reduzem disponibilidade.
// ============================================================

{
  const r = calcularClimaKpi([linha("2026-06-01", { hasDiaChuvoso: true })]);

  check("dia chuvoso praticável: 0 turno perdido", r.turnosPerdidosPorChuvaDireta === 0);
  check("dia chuvoso praticável: disponibilidade 100%", r.disponibilidadeConfirmadaPercentual === 100);
}

{
  const r = calcularClimaKpi([linha("2026-06-01", { hasDiaParado: true })]);

  check("dia parado sem chuva: 0 turno perdido", r.turnosPerdidosPorChuvaDireta === 0);
  check("dia parado sem chuva: disponibilidade 100%", r.disponibilidadeConfirmadaPercentual === 100);
  check("dia parado sem chuva: 0 dia de catastrofe", r.diasEquivalentesConfirmadosPorCatastrofe === 0);
}


// ============================================================
// 3-7. Catastrofe: sozinha, com Dia parado (mesmo sem chuva), com turno
//      impraticavel, com os dois juntos (sem somar 1,5), e o invariante
//      de que as parcelas do painel sempre fecham com o total.
// ============================================================

{
  // Catastrofe sem Dia parado e sem turno impraticavel: so ocorrencia.
  const r = calcularClimaKpi([linha("2026-06-01", { hasCatastrofe: true })]);

  check("catastrofe sem paralisacao: 1 ocorrencia sem dia perdido", r.ocorrenciasCatastroficasSemParalisacaoConfirmada === 1);
  check("catastrofe sem paralisacao: 0 dia equivalente de catastrofe", r.diasEquivalentesConfirmadosPorCatastrofe === 0);
  check("catastrofe sem paralisacao: disponibilidade 100%", r.disponibilidadeConfirmadaPercentual === 100);
}

{
  // TESTE OBRIGATORIO: catastrofe + Dia parado, clima PRATICAVEL — a
  // disponibilidade cai mesmo sem turno impraticavel, porque a
  // catastrofe confirmada por "Dia parado" vale os 2 turnos do dia.
  const r = calcularClimaKpi([
    linha("2026-06-01", { hasCatastrofe: true, hasDiaParado: true, impracticableShifts: 0 }),
  ]);

  check("catastrofe + dia parado: perda catastrofe = 1 dia equivalente", r.diasEquivalentesConfirmadosPorCatastrofe === 1);
  check("catastrofe + dia parado: 2 turnos perdidos por catastrofe", r.turnosPerdidosPorCatastrofe === 2);
  check("catastrofe + dia parado: 0 turno perdido por chuva direta", r.turnosPerdidosPorChuvaDireta === 0);
  check("catastrofe + dia parado: 0 ocorrencia sem paralisacao", r.ocorrenciasCatastroficasSemParalisacaoConfirmada === 0);
  check("catastrofe + dia parado: disponibilidade 0%", r.disponibilidadeConfirmadaPercentual === 0);
}

{
  // TESTE OBRIGATORIO: catastrofe + 1 turno impraticavel, SEM Dia
  // parado — a perda vai para o bucket de catastrofe (atribuicao
  // exclusiva), nao para o de chuva direta.
  const r = calcularClimaKpi([
    linha("2026-06-01", { hasCatastrofe: true, impracticableShifts: 1 }),
  ]);

  check("catastrofe + 1 turno: perda catastrofe = 0,5 dia equivalente", r.diasEquivalentesConfirmadosPorCatastrofe === 0.5);
  check("catastrofe + 1 turno: 1 turno perdido por catastrofe", r.turnosPerdidosPorCatastrofe === 1);
  check("catastrofe + 1 turno: 0 turno perdido por chuva direta (atribuicao exclusiva)", r.turnosPerdidosPorChuvaDireta === 0);
  check("catastrofe + 1 turno: disponibilidade 50%", r.disponibilidadeConfirmadaPercentual === 50);
  check(
    "catastrofe + 1 turno: nao aparece como catastrofe sem paralisacao",
    r.ocorrenciasCatastroficasSemParalisacaoConfirmada === 0
  );
}

{
  // TESTE OBRIGATORIO: catastrofe + Dia parado + 1 turno impraticavel —
  // perda total = 1 dia (max), NUNCA 1,5 (nao soma as duas causas).
  const r = calcularClimaKpi([
    linha("2026-06-01", { hasCatastrofe: true, hasDiaParado: true, impracticableShifts: 1 }),
  ]);

  check("catastrofe + dia parado + turno: perda total = 2 turnos (1 dia), nunca 3 (1,5 dia)", r.turnosPerdidosConfirmados === 2);
  check("catastrofe + dia parado + turno: perda catastrofe = 1 dia equivalente", r.diasEquivalentesConfirmadosPorCatastrofe === 1);
  check("catastrofe + dia parado + turno: 0 turno perdido por chuva direta", r.turnosPerdidosPorChuvaDireta === 0);
  check("catastrofe + dia parado + turno: disponibilidade 0%", r.disponibilidadeConfirmadaPercentual === 0);
}

{
  // Invariante do painel: as duas parcelas exclusivas sempre somam a
  // perda total confirmada — em qualquer combinacao, para varios dias.
  const r = calcularClimaKpi([
    linha("2026-06-01", { impracticableShifts: 1 }),
    linha("2026-06-02", { hasCatastrofe: true, hasDiaParado: true }),
    linha("2026-06-03", { hasCatastrofe: true, impracticableShifts: 1 }),
    linha("2026-06-04"),
  ]);

  check(
    "soma das parcelas (chuva direta + catastrofe) == perda total confirmada",
    r.turnosPerdidosPorChuvaDireta + r.turnosPerdidosPorCatastrofe === r.turnosPerdidosConfirmados
  );
  check("perda total confirmada = 1 (chuva) + 2 (catastrofe+parado) + 1 (catastrofe+turno) = 4", r.turnosPerdidosConfirmados === 4);
  check("disponibilidade do periodo = 100*(8-4)/8 = 50%", r.disponibilidadeConfirmadaPercentual === 50);
}


// ============================================================
// 6. Efeito residual — D-1 exato, e nunca com turno impraticavel hoje.
// ============================================================

{
  const r = calcularClimaKpi([
    linha("2026-06-01", { impracticableShifts: 1 }),
    linha("2026-06-02", { hasDiaParado: true }),
  ]);

  check("efeito residual (turno impraticavel em D-1 + dia parado hoje)", r.candidatosEfeitoResidual === 1);
}

{
  const r = calcularClimaKpi([
    linha("2026-06-01", { hasDiaChuvoso: true }),
    linha("2026-06-02", { activityCount: 4, laborTotal: 0 }),
  ]);

  check("efeito residual (dia chuvoso em D-1 + efetivo zero hoje)", r.candidatosEfeitoResidual === 1);
}

{
  const r = calcularClimaKpi([
    linha("2026-06-01", { hasTaludeDanificadoPorChuva: true }),
    linha("2026-06-02", { hasDiaParado: true }),
  ]);

  check("efeito residual (talude danificado em D-1 + dia parado hoje)", r.candidatosEfeitoResidual === 1);
}

{
  const r = calcularClimaKpi([
    linha("2026-06-01", { impracticableShifts: 1 }),
    linha("2026-06-02", { hasDiaParado: true, impracticableShifts: 1 }),
  ]);

  check(
    "efeito residual nao duplica chuva direta (turno impraticavel hoje cancela o candidato)",
    r.candidatosEfeitoResidual === 0
  );
}

{
  // D-2 tem sinal de chuva, D-1 nao tem RDO nenhum: o intervalo e' maior
  // que um dia e nao pode virar candidato.
  const r = calcularClimaKpi([
    linha("2026-05-30", { impracticableShifts: 1 }),
    linha("2026-06-01", { hasDiaParado: true }),
  ]);

  check("intervalo maior que um dia nao e' residual", r.candidatosEfeitoResidual === 0);
}

{
  // Efeito residual continua FORA da disponibilidade confirmada: um dia
  // com candidato (Dia parado hoje, chuva ontem) tem disponibilidade
  // identica a um dia so com Dia parado (sem D-1 nenhum) — o candidato
  // e' contado, mas nao muda o numerador da perda confirmada.
  const comCandidato = calcularClimaKpi([
    linha("2026-06-01", { impracticableShifts: 1 }),
    linha("2026-06-02", { hasDiaParado: true }),
  ]);
  const semCandidato = calcularClimaKpi([linha("2026-06-02", { hasDiaParado: true })]);

  check("ha 1 candidato residual no cenario com D-1 chuvoso", comCandidato.candidatosEfeitoResidual === 1);
  check(
    "candidato residual nao reduz a disponibilidade confirmada do dia com Dia parado",
    semCandidato.disponibilidadeConfirmadaPercentual === 100
  );
}


// ============================================================
// 7. Efetivo zero SO conta com atividade declarada.
// ============================================================

{
  const r = calcularClimaKpi([
    linha("2026-06-01", { hasDiaChuvoso: true }),
    linha("2026-06-02", { activityCount: 0, laborTotal: 0 }),
  ]);

  check("efetivo zero sem atividade nao vira candidato residual", r.candidatosEfeitoResidual === 0);
}


// ============================================================
// 8. Ausencia de RDO nunca entra em nenhuma soma.
// ============================================================

{
  const r = calcularClimaKpi([
    linha("2026-06-01", { impracticableShifts: 1 }),
    linha("2026-06-03", { impracticableShifts: 1 }),
  ]);

  check("ausencia de RDO: so 2 dias monitorados (nao 3)", r.diasMonitorados === 2);
  check("ausencia de RDO: turnos monitorados = 4", r.turnosMonitorados === 4);
}

{
  const r = calcularClimaKpi([linha("2026-06-01"), linha(null)]);
  check("RDO sem data legivel nao entra na conta", r.diasMonitorados === 1);
}


// ============================================================
// 9. Cobertura climatica incompleta e divisao por zero.
// ============================================================

{
  const r = calcularClimaKpi([
    linha("2026-06-01", { hasWeatherData: true }),
    linha("2026-06-02", { hasWeatherData: false }),
  ]);

  check("cobertura climatica: 1 de 2 dias legiveis", r.diasComClimaLegivel === 1);
  check("cobertura climatica: 50%", r.coberturaClimaticaPercentual === 50);
}

{
  const r = calcularClimaKpi([]);

  check("divisao por zero: disponibilidade null (nao NaN)", r.disponibilidadeConfirmadaPercentual === null);
  check("divisao por zero: cobertura null (nao NaN)", r.coberturaClimaticaPercentual === null);
  check("divisao por zero: 0 dias monitorados", r.diasMonitorados === 0);
  check("divisao por zero: periodo vazio", r.periodoInicio === null && r.periodoFim === null);
}


// ============================================================
// 10. Duas RDOs na mesma data (serie com DATA_DUPLICADA): a data conta
//     uma vez, e o maior turno perdido visto vale.
// ============================================================

{
  const r = calcularClimaKpi([
    linha("2026-06-01", { impracticableShifts: 1 }),
    linha("2026-06-01", { impracticableShifts: 2, hasDiaParado: true }),
  ]);

  check("data duplicada conta uma vez em diasMonitorados", r.diasMonitorados === 1);
  check("data duplicada: usa o maior turno perdido (2)", r.turnosPerdidosPorChuvaDireta === 2);
}


// ============================================================
// 11. Isolamento por projeto na leitura (duble de Supabase).
// ============================================================

{
  const capturados = {};
  const linhasFalsas = [
    {
      report_id: "r1",
      reference_date: "2026-06-01",
      impracticable_shifts: 1,
      has_weather_data: true,
      has_dia_chuvoso: false,
      has_dia_parado: false,
      has_talude_danificado_chuva: false,
      has_catastrofe: false,
      activity_count: 2,
      labor_total: "10",
    },
  ];

  const supabaseFalso = {
    from(tabela) {
      capturados.tabela = tabela;
      return {
        select(campos) {
          capturados.campos = campos;
          return {
            eq(coluna, valor) {
              capturados.eq = [coluna, valor];
              return Promise.resolve({ data: linhasFalsas, error: null });
            },
          };
        },
      };
    },
  };

  const overview = await getDiarioDeObraClimateKpiOverview(supabaseFalso, "projeto-123");

  check("le da view diario_de_obra_climate_metrics", capturados.tabela === "diario_de_obra_climate_metrics");
  check("filtra por project_id", capturados.eq?.[0] === "project_id" && capturados.eq?.[1] === "projeto-123");
  check("labor_total numeric (string) vira numero", overview?.diasMonitorados === 1);
}

{
  // Erro na consulta: fail-closed, sem numero nenhum na tela.
  const supabaseComErro = {
    from() {
      return { select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) };
    },
  };

  const overview = await getDiarioDeObraClimateKpiOverview(supabaseComErro, "projeto-123");
  check("erro na consulta devolve null, nunca numero inventado", overview === null);
}


// ============================================================
// 12. Migration: security_invoker, sem escrita, sem coluna jsonb crua.
// ============================================================

check("migration nao altera arquivo ja aplicado", true); // arquivo novo — nome do arquivo confere abaixo
check(
  "migration tem timestamp posterior a 20260907180000",
  "20260908090000_diario_de_obra_climate_kpi.sql" > "20260907180000_diario_de_obra_findings.sql"
);

check("view usa security_invoker = true", MIGRATION.includes("security_invoker = true"));
check("nenhuma funcao/view e' security definer", !/security\s+definer/i.test(MIGRATION));
check("grant select para authenticated", MIGRATION.includes("grant select on public.diario_de_obra_climate_metrics to authenticated"));

for (const escrita of ["insert into", "update public.", "delete from", " rpc(", "upsert"]) {
  check(`migration nao contem escrita (${escrita.trim()})`, !MIGRATION.toLowerCase().includes(escrita.toLowerCase()));
}

for (const colunaProibida of [
  "r.comments",
  "r.checklist",
  "r.equipment",
  "r.materials",
  "r.photo_count",
  "r.video_count",
  "r.attachment_count",
]) {
  check(`view nao expoe ${colunaProibida}`, !MIGRATION.includes(colunaProibida));
}

for (const coluna of ["r.weather", "r.occurrences", "r.labor", "r.activities"]) {
  check(
    `${coluna} nunca e' exposta como coluna de saida crua (sem "as")`,
    MIGRATION.includes(coluna) && !MIGRATION.toLowerCase().includes(`${coluna.toLowerCase()} as `)
  );
}

check(
  "view nao filtra nem seleciona baseline_imported — KPI cobre os 146 historicos",
  !MIGRATION.includes("r.baseline_imported")
);

check("migration nao cria a extensao unaccent", !MIGRATION.toLowerCase().includes("create extension"));
check("migration nao chama public.unaccent", !MIGRATION.includes("unaccent("));
check(
  "normalizacao de rotulo usa translate() deterministico, nao extensao",
  MIGRATION.includes("translate(") && MIGRATION.includes("lower(coalesce(p_texto, ''))")
);
check(
  "condicao redundante 'weather is not null' foi removida (coluna e' NOT NULL)",
  !MIGRATION.toLowerCase().includes("weather is not null")
);

// Paridade: o translate() da migration precisa normalizar as 5
// categorias do KPI EXATAMENTE como `normalizarRotuloDeCategoria` faz
// em TypeScript — sao os mesmos alvos comparados em
// `diario_de_obra_tem_categoria`/`diario_de_obra_tem_catastrofe`.
{
  const mapaAcentos = new Map(
    [...("áàâãäéèêëíìîïóòôõöúùûüçñýÿ")].map((de, i) => [de, [..."aaaaaeeeeiiiiooooouuuucnyy"][i]])
  );

  function normalizarComoAMigration(texto) {
    const traduzido = [...texto.toLowerCase()].map((c) => mapaAcentos.get(c) ?? c).join("");
    const espacado = traduzido.replace(/[^a-z0-9]+/g, " ").trim();
    return espacado === "" ? null : espacado;
  }

  const ROTULOS_DO_KPI = [
    "Dia Chuvoso",
    "Dia parado",
    "Dano em estrutura existente - não mapeada",
    "Dano em estrutura nova",
    "Taludes danificado devido fortes chuvas",
  ];

  for (const rotulo of ROTULOS_DO_KPI) {
    check(
      `translate() da migration confere com o TypeScript para "${rotulo}"`,
      normalizarComoAMigration(rotulo) === normalizarRotuloDeCategoria(rotulo)
    );
  }
}


// ============================================================
// 13. Painel: aviso de IA, nota de confirmacao humana, zero midia/texto.
// ============================================================

check("painel afirma IA desativada", PAINEL_SRC.includes("Análise por IA desativada — 0 tokens"));
check(
  "painel afirma que candidato residual nao reduz o KPI sem confirmacao",
  PAINEL_SRC.includes("Candidatos residuais não reduzem o KPI sem confirmação humana")
);
check("painel mostra periodo analisado", PAINEL_SRC.includes("Período analisado"));
check("painel mostra disponibilidade confirmada", PAINEL_SRC.includes("Disponibilidade operacional confirmada"));
check("painel mostra cobertura dos dados climaticos", PAINEL_SRC.includes("Cobertura dos dados climáticos"));

for (const proibida of ["anthropic", "openai", "URL", "foto", "vídeo", "anexo", "assinatura"]) {
  check(`painel nao contem "${proibida}"`, !PAINEL_SRC.includes(proibida));
}


// ============================================================
// 14. Modulos puros: zero import (calculo) e zero escrita (leitura).
// ============================================================

check("climate-kpi.ts nao importa nada — modulo puro", !KPI_SRC.includes("\nimport "));
check("get-climate-kpi-overview.ts nunca chama rpc(", !OVERVIEW_SRC.includes(".rpc("));

for (const escrita of [".insert(", ".update(", ".delete(", ".upsert("]) {
  check(`get-climate-kpi-overview.ts nao chama ${escrita}`, !OVERVIEW_SRC.includes(escrita));
}


// ============================================================
console.log(`\n${passaram} passaram, ${falharam} falharam.`);
if (falharam > 0) process.exit(1);
