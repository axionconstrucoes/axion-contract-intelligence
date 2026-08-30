// Bloco 3 (rodada "produção") — "por projeto, somente 1 Contrato-base
// ativo" — teste real (trigger de verdade no Postgres, nunca
// reimplementação em JS) contra a stack descartável. Achado real desta
// rodada que motivou esta regra: o projeto remoto AXION-DEV-001 tinha 2
// CONTRATO_BASE com conteúdo idêntico.
//
// Uso:
//   ACC_SINGLE_CB_TEST_DB_CONTAINER="supabase_db_acc-disposable-20260829" \
//   ACC_SINGLE_CB_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE=true \
//     node scripts/sql/run-single-active-contract-base-test.mjs

import { spawnSync } from "node:child_process";

const EXACT_DB_CONTAINER = "supabase_db_acc-disposable-20260829";

if (process.env.ACC_SINGLE_CB_TEST_DB_CONTAINER !== EXACT_DB_CONTAINER) {
  console.error(`ACC_SINGLE_CB_TEST_DB_CONTAINER precisa ser exatamente "${EXACT_DB_CONTAINER}".`);
  process.exit(1);
}
if (process.env.ACC_SINGLE_CB_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE !== "true") {
  console.error('ACC_SINGLE_CB_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE precisa ser exatamente "true".');
  process.exit(1);
}

function psql(sql, { expectError = false } = {}) {
  const result = spawnSync(
    "docker",
    ["exec", "-i", EXACT_DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "--no-psqlrc", "--quiet", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" }
  );
  if (expectError) {
    if (result.status === 0) throw new Error("esperava erro do Postgres, mas o statement teve sucesso");
    return result.stderr;
  }
  if (result.status !== 0) throw new Error(`psql falhou (exit ${result.status}): ${result.stderr}`);
  return result.stdout;
}

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}

console.log("");
console.log("======================================");
console.log("CONTRATO-BASE ÚNICO ATIVO POR PROJETO (trigger real)");
console.log("======================================");
console.log("");

const PROJECT = "88888888-8888-4888-8888-888888899901";
const CB1 = "88888888-8888-4888-8888-888888899902";
const CB2 = "88888888-8888-4888-8888-888888899903";
const CB3 = "88888888-8888-4888-8888-888888899906";
const ADT1 = "88888888-8888-4888-8888-888888899904";
const ADT2 = "88888888-8888-4888-8888-888888899905";

psql(`
  insert into public.projects (id, code, name, client, status, location, start_date, baseline_end_date) values
    ('${PROJECT}', 'SINGLE-CB-TEST', 'Projeto (teste automatizado single contrato-base)', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2026-12-31')
  on conflict (id) do nothing;
`);

check("primeiro CONTRATO_BASE do projeto: PERMITIDO", () => {
  psql(`insert into public.documents (id, project_id, kind, title) values ('${CB1}', '${PROJECT}', 'CONTRATO_BASE', 'Contrato base 1') on conflict (id) do nothing;`);
  const row = psql(`select count(*) from public.documents where id = '${CB1}';`);
  if (!row.includes(" 1")) throw new Error("documento não foi inserido");
});

check("segundo CONTRATO_BASE no MESMO projeto enquanto o primeiro está ativo: RECUSADO (SINGLE_ACTIVE_CONTRACT_BASE)", () => {
  const stderr = psql(`insert into public.documents (id, project_id, kind, title) values ('${CB2}', '${PROJECT}', 'CONTRATO_BASE', 'Contrato base 2 duplicado');`, { expectError: true });
  if (!stderr.includes("SINGLE_ACTIVE_CONTRACT_BASE")) throw new Error(`mensagem inesperada: ${stderr}`);
  const row = psql(`select count(*) from public.documents where id = '${CB2}';`);
  if (!row.includes(" 0")) throw new Error("o documento recusado não deveria ter sido inserido");
});

check("múltiplos ADITIVO no mesmo projeto: SEMPRE permitidos, sem limite (regra é exclusiva de CONTRATO_BASE)", () => {
  psql(`insert into public.documents (id, project_id, kind, title) values ('${ADT1}', '${PROJECT}', 'ADITIVO', 'Aditivo 1'), ('${ADT2}', '${PROJECT}', 'ADITIVO', 'Aditivo 2') on conflict (id) do nothing;`);
  const row = psql(`select count(*) from public.documents where project_id = '${PROJECT}' and kind = 'ADITIVO';`);
  if (!row.includes(" 2")) throw new Error(`esperava 2 aditivos, obtido: ${row}`);
});

check("depois de enviar o CONTRATO_BASE ativo para a lixeira, um NOVO CONTRATO_BASE passa a ser PERMITIDO", () => {
  psql(`update public.documents set deleted_at = now() where id = '${CB1}';`);
  psql(`insert into public.documents (id, project_id, kind, title) values ('${CB3}', '${PROJECT}', 'CONTRATO_BASE', 'Contrato base novo pós-trash') on conflict (id) do nothing;`);
  const row = psql(`select count(*) from public.documents where id = '${CB3}';`);
  if (!row.includes(" 1")) throw new Error("o novo contrato-base deveria ter sido aceito, já que o antigo não está mais ativo");
});

check("restaurar o CONTRATO_BASE antigo agora que já existe um novo ATIVO: RECUSADO (nunca 2 ativos ao mesmo tempo)", () => {
  const stderr = psql(`update public.documents set deleted_at = null where id = '${CB1}';`, { expectError: true });
  if (!stderr.includes("SINGLE_ACTIVE_CONTRACT_BASE")) throw new Error(`mensagem inesperada: ${stderr}`);
  const row = psql(`select deleted_at is not null as ainda_na_lixeira from public.documents where id = '${CB1}';`);
  if (!row.includes(" t")) throw new Error("o documento antigo deveria continuar na lixeira (restauração recusada)");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");
if (failed > 0) process.exit(1);
