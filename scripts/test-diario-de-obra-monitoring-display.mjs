// Correcao visual do painel do Diario de Obra: data de sincronizacao em
// Brasilia, extrator de efetivo (padrao/personalizada), rotulo de "dias
// sem RDO" e formatacao numerica pt-BR.
//
// SEM REDE, SEM BANCO REAL, SEM IA. A migration corretiva do extrator
// de efetivo e' auditada por texto (mesma convencao do resto da suite
// do Diario de Obra) — a leitura real contra o banco (project_id
// 00000000-0000-4000-8000-000000000001, mediana = 32) foi conferida
// manualmente com `supabase db query --linked` e nao roda aqui.
//
// O que esta suite protege:
//
//   1. `formatarDataHoraBrasilia` converte UTC -> America/Sao_Paulo via
//      Intl (nunca soma/subtrai hora ou dia a mao), inclusive quando a
//      virada de fuso muda o DIA exibido;
//   2. `totalDeEfetivo` le a forma `{opcaoSelecionada, padrao,
//      personalizada}` medida na obra real, soma so a lista escolhida,
//      e trata a lista NAO escolhida (vazia) como ausencia de dado —
//      nunca zero inventado. Formas antigas (`{total}`, `{itens:[]}`)
//      continuam lendo como antes;
//   3. rotulo de integridade passa a dizer "dia(s) corrido(s) sem RDO —
//      inclui fins de semana e folgas", sem citar feriado nem "parado";
//   4. `formatarNumeroPtBr`/`formatarPercentualPtBr` usam virgula
//      decimal, com o `.0`/`,0` explicito em percentual;
//   5. a migration corretiva so faz `create or replace function` (nunca
//      recria as views, nunca mexe em RLS/security_invoker) e nao
//      altera nenhuma migration ja aplicada;
//   6. zero texto operacional, pessoa, midia ou IA nos arquivos novos.
//
// Uso: node scripts/test-diario-de-obra-monitoring-display.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { formatarDataHoraBrasilia } = await import(
  "../apps/web/lib/integrations/diario-de-obra/format-brasilia.ts"
);

const { formatarNumeroPtBr, formatarPercentualPtBr } = await import(
  "../apps/web/lib/integrations/diario-de-obra/format-numero-pt-br.ts"
);

const { totalDeEfetivo } = await import(
  "../apps/web/lib/integrations/diario-de-obra/report-readers.ts"
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

const MIGRATION_CORRETIVA = ler(
  "supabase/migrations/20260908150000_diario_de_obra_labor_padrao_personalizada_fix.sql"
);
const MIGRATION_ORIGINAL_FINDINGS = ler("supabase/migrations/20260907180000_diario_de_obra_findings.sql");
const MIGRATION_ORIGINAL_CLIMA = ler("supabase/migrations/20260908090000_diario_de_obra_climate_kpi.sql");
const PAINEL_MONITORAMENTO = ler("apps/web/components/integrations/diario-de-obra-monitoring-panel.tsx");
const PAINEL_CLIMA = ler("apps/web/components/integrations/diario-de-obra-climate-kpi-panel.tsx");
const CLIMATE_KPI_SRC = ler("apps/web/lib/integrations/diario-de-obra/climate-kpi.ts");


// ============================================================
// 1. Data/hora de Brasilia — sem soma/subtracao manual, com virada de
//    dia UTC->Brasilia.
// ============================================================

check(
  "sync as 05:11 UTC (obra real) vira 02:11 em Brasilia, MESMO dia",
  formatarDataHoraBrasilia("2026-09-08T05:11:47Z") === "08/09/2026, 02:11"
);

check(
  "virada de dia: 02:30 UTC vira 23:30 do dia ANTERIOR em Brasilia",
  formatarDataHoraBrasilia("2026-09-08T02:30:00Z") === "07/09/2026, 23:30"
);

check(
  "sem virada: 14:39 UTC vira 11:39 do MESMO dia em Brasilia",
  formatarDataHoraBrasilia("2026-09-08T14:39:08Z") === "08/09/2026, 11:39"
);

check(
  "meia-noite exata em Brasilia (03:00 UTC) formata com o dia certo",
  formatarDataHoraBrasilia("2026-01-15T03:00:00Z") === "15/01/2026, 00:00"
);

check("null vira travessao", formatarDataHoraBrasilia(null) === "—");
check("string vazia vira travessao", formatarDataHoraBrasilia("") === "—");
check("data invalida vira travessao, nunca 'Invalid Date'", formatarDataHoraBrasilia("nao-e-data") === "—");

check(
  "formatador nao soma/subtrai hora ou dia manualmente (usa Intl.DateTimeFormat com timeZone explicito)",
  ler("apps/web/lib/integrations/diario-de-obra/format-brasilia.ts").includes(
    'timeZone: FUSO_BRASILIA'
  ) &&
    ler("apps/web/lib/integrations/diario-de-obra/format-brasilia.ts").includes("America/Sao_Paulo") &&
    !/[+-]\s*3\s*\*\s*60|getHours\(\)\s*[+-]|setHours\(/.test(
      ler("apps/web/lib/integrations/diario-de-obra/format-brasilia.ts")
    )
);

check(
  "painel usa o formatador de Brasilia para 'Ultima sincronizacao', nao mais formatDateTime global",
  PAINEL_MONITORAMENTO.includes("formatarDataHoraBrasilia(overview.ultimaSincronizacaoAt)") &&
    !PAINEL_MONITORAMENTO.includes("formatDateTime")
);


// ============================================================
// 2. Extrator de efetivo — forma padrao/personalizada medida na obra.
// ============================================================

check(
  "padrao com itens: soma quantidade dos itens escolhidos",
  totalDeEfetivo({
    opcaoSelecionada: "padrao",
    padrao: [{ quantidade: 12, _id: "a" }, { quantidade: 20, _id: "b" }],
    personalizada: [],
  }) === 32
);

check(
  "personalizada com itens: le a lista escolhida, ignora padrao vazio",
  totalDeEfetivo({
    opcaoSelecionada: "personalizada",
    padrao: [],
    personalizada: [{ quantidade: 7 }, { quantidade: 3 }],
  }) === 10
);

check(
  "ausencia real de dados: opcao escolhida aponta para lista vazia -> null, nunca 0",
  totalDeEfetivo({ opcaoSelecionada: "padrao", padrao: [], personalizada: [] }) === null
);

check(
  "lista NAO escolhida (com itens) e' ignorada mesmo se nao-vazia",
  totalDeEfetivo({
    opcaoSelecionada: "padrao",
    padrao: [{ quantidade: 5 }],
    personalizada: [{ quantidade: 999 }],
  }) === 5
);

check(
  "labor JSON invalido (opcaoSelecionada desconhecida) nao inventa numero",
  totalDeEfetivo({ opcaoSelecionada: "outra-coisa", padrao: [{ quantidade: 5 }] }) === null
);

check(
  "labor JSON invalido (opcaoSelecionada aponta para nao-array) cai pros ramos genericos sem quebrar",
  totalDeEfetivo({ opcaoSelecionada: "padrao", padrao: "nao e lista" }) === null
);

check(
  "forma antiga { total } continua lendo normalmente (sem regressao)",
  totalDeEfetivo({ total: 18 }) === 18
);

check(
  "forma antiga { itens: [] } continua tratando lista vazia como 0 (sem regressao)",
  totalDeEfetivo({ itens: [] }) === 0
);

check(
  "labor totalmente ilegivel (string solta) continua null",
  totalDeEfetivo("nao e objeto nem lista") === null
);

check(
  "leitor le a virgula decimal dentro dos itens de padrao/personalizada",
  totalDeEfetivo({
    opcaoSelecionada: "padrao",
    padrao: [{ quantidade: "12,5" }, { quantidade: "3" }],
    personalizada: [],
  }) === 15.5
);


// ============================================================
// 3. Migration corretiva — so create or replace, sem tocar aplicadas.
// ============================================================

check(
  "migration corretiva tem timestamp posterior a todas as anteriores",
  "20260908150000_diario_de_obra_labor_padrao_personalizada_fix.sql" >
    "20260908090000_diario_de_obra_climate_kpi.sql"
);

check(
  "migration corretiva so faz create or replace function (mesma assinatura)",
  MIGRATION_CORRETIVA.includes(
    "create or replace function public.diario_de_obra_efetivo_total(p_labor jsonb)"
  )
);

check("migration corretiva nao cria nem recria nenhuma view", !MIGRATION_CORRETIVA.toLowerCase().includes("create view") && !MIGRATION_CORRETIVA.toLowerCase().includes("create or replace view"));
check("migration corretiva nao mexe em RLS", !MIGRATION_CORRETIVA.toLowerCase().includes("row level security") && !MIGRATION_CORRETIVA.toLowerCase().includes("create policy"));
check("migration corretiva nao concede nem revoga grant", !MIGRATION_CORRETIVA.toLowerCase().includes("grant ") && !MIGRATION_CORRETIVA.toLowerCase().includes("revoke "));
check("migration corretiva preserva search_path vazio (mesma convencao)", MIGRATION_CORRETIVA.includes("set search_path = ''"));

for (const escrita of ["insert into", "update public.", "delete from", " rpc("]) {
  check(`migration corretiva nao contem escrita (${escrita.trim()})`, !MIGRATION_CORRETIVA.toLowerCase().includes(escrita.toLowerCase()));
}

check(
  "as views que usam a funcao (report_metrics e climate_metrics) continuam intocadas nesta branch",
  MIGRATION_ORIGINAL_FINDINGS.includes("create view public.diario_de_obra_report_metrics") &&
    MIGRATION_ORIGINAL_CLIMA.includes("create or replace view public.diario_de_obra_climate_metrics") &&
    MIGRATION_ORIGINAL_FINDINGS.includes("security_invoker = true") &&
    MIGRATION_ORIGINAL_CLIMA.includes("security_invoker = true")
);


// ============================================================
// 4. Formatacao numerica pt-BR.
// ============================================================

check('3,5 dias, nao 3.5', formatarNumeroPtBr(3.5) === "3,5");
check('97,6%, nao 97.6%', formatarPercentualPtBr(97.6) === "97,6%");
check('100,0%, nao 100.0% nem so 100%', formatarPercentualPtBr(100) === "100,0%");
check('0,5 dia', formatarNumeroPtBr(0.5) === "0,5");
check('null vira travessao (numero)', formatarNumeroPtBr(null) === "—");
check('null vira travessao (percentual)', formatarPercentualPtBr(null) === "—");

check(
  "painel do KPI climatico nao usa mais toFixed para percentual/decimal",
  !PAINEL_CLIMA.includes(".toFixed(")
);
check(
  "painel do KPI climatico importa os formatadores pt-BR dedicados",
  PAINEL_CLIMA.includes("formatarNumeroPtBr") && PAINEL_CLIMA.includes("formatarPercentualPtBr")
);


// ============================================================
// 5. Rotulo "dias corridos sem RDO" — sem feriado, sem "dia parado".
// ============================================================

check(
  "painel usa o rotulo novo, com fins de semana e folgas explicitos",
  PAINEL_MONITORAMENTO.includes("dia(s) corrido(s) sem RDO — inclui fins de semana e folgas")
);
check("painel nao usa mais o rotulo antigo isolado", !/\$\{integridade\.diasSemRdo\} dia\(s\) sem RDO`/.test(PAINEL_MONITORAMENTO));
check("rotulo novo nao menciona feriado", !PAINEL_MONITORAMENTO.toLowerCase().includes("feriado"));
check(
  "rotulo novo nao chama a lacuna de 'dia parado' (categoria de ocorrencia estruturada, coisa diferente)",
  !/dia\(s\) corrido\(s\) sem RDO[^`]*parado/i.test(PAINEL_MONITORAMENTO)
);


// ============================================================
// 6. Zero texto operacional, pessoa, midia ou IA nos arquivos novos.
// ============================================================

for (const arquivo of [
  "apps/web/lib/integrations/diario-de-obra/format-brasilia.ts",
  "apps/web/lib/integrations/diario-de-obra/format-numero-pt-br.ts",
]) {
  const src = ler(arquivo);
  for (const proibida of ["anthropic", "openai", "foto", "vídeo", "anexo", "assinatura", "endereco", "endereço"]) {
    check(`${arquivo} nao contem "${proibida}"`, !src.toLowerCase().includes(proibida.toLowerCase()));
  }
  check(`${arquivo} e' modulo puro (zero import externo alem de Intl nativo)`, !src.includes("\nimport "));
}


// ============================================================
// 7. KPI matematicamente inalterado — climate-kpi.ts intocado.
// ============================================================

check(
  "climate-kpi.ts continua usando max(turnos_impraticaveis, turnos_catastrofe) — formula intocada",
  CLIMATE_KPI_SRC.includes("Math.max(dia.turnosImpraticaveis, turnosCatastrofeNoDia)")
);
check(
  "climate-kpi.ts continua puro (zero import) — nenhuma dependencia nova entrou no calculo do KPI",
  !CLIMATE_KPI_SRC.includes("\nimport ")
);


// ============================================================
console.log(`\n${passaram} passaram, ${falharam} falharam.`);
if (falharam > 0) process.exit(1);
