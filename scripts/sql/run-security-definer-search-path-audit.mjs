// Auditoria de segurança REAL (não simulada) de toda function
// SECURITY DEFINER de public, contra o banco de uma stack descartável
// já com as 11 migrations pendentes aplicadas — roda depois delas, não
// antes, para pegar as funções novas também.
//
// Verifica, para CADA function SECURITY DEFINER de public:
//   - owner esperado (postgres);
//   - search_path não contém "public", "$user" nem nenhum outro
//     schema gravável — idealmente vazio (search_path="");
//   - qualquer exceção precisa estar no ALLOWLIST abaixo, com motivo
//     documentado e comprovadamente seguro (corpo inteiro qualificado
//     — nunca "porque sim").
// E, separadamente, que as 3 trigger functions corrigidas nesta rodada
// não têm EXECUTE concedido a public/anon/authenticated/service_role
// — só o owner, que não precisa de GRANT explícito.
//
// SEGURANÇA DE AMBIENTE — mesmo padrão dos demais runners deste
// diretório: container EXATO desta execução e confirmação explícita,
// nunca a stack local real do projeto nem o remoto.
//
// Uso (só depois de ter a stack descartável, com as 11 migrations
// pendentes já aplicadas, rodando):
//   ACC_SECDEF_AUDIT_DB_CONTAINER="<nome do container>" \
//   ACC_SECDEF_AUDIT_I_UNDERSTAND_THIS_IS_DISPOSABLE=true \
//     node scripts/sql/run-security-definer-search-path-audit.mjs

import { spawnSync } from "node:child_process";

const container = process.env.ACC_SECDEF_AUDIT_DB_CONTAINER;
if (!container) {
  console.error('Defina ACC_SECDEF_AUDIT_DB_CONTAINER="<nome exato do container>".');
  process.exit(1);
}
if (process.env.ACC_SECDEF_AUDIT_I_UNDERSTAND_THIS_IS_DISPOSABLE !== "true") {
  console.error('ACC_SECDEF_AUDIT_I_UNDERSTAND_THIS_IS_DISPOSABLE precisa ser exatamente "true".');
  process.exit(1);
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

function psql(sql) {
  const result = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "--no-psqlrc", "--quiet", "-t", "-A", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`psql falhou (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("|"));
}

// Schemas graváveis por roles de aplicação (anon/authenticated) num
// projeto Supabase padrão — nenhum deve aparecer no search_path de uma
// function SECURITY DEFINER, porque um objeto plantado ali por um
// desses roles poderia ser resolvido no lugar do objeto real
// pretendido, caso alguma referência não-qualificada exista no corpo.
const WRITABLE_OR_DANGEROUS_SCHEMAS = ["public", "\"$user\"", "pg_temp"];

// Exceções documentadas — vazio hoje: as 2 únicas functions que
// tinham search_path=public (amend_event_clause_confrontation_review_
// note, trigger_project_email_backfill) foram corrigidas nesta rodada
// para search_path='' depois de revisão integral do corpo (nenhuma
// referência não-qualificada existia — ver diff da migration
// correspondente). Qualquer entrada futura aqui precisa de um motivo
// específico, nunca um bypass genérico.
const ALLOWLIST = {
  // "nome_da_function/assinatura": "motivo específico e comprovado",
};

const EXPECTED_OWNER = "postgres";

function main() {
  console.log("");
  console.log("======================================");
  console.log("AUDITORIA — SECURITY DEFINER / search_path / owner (public)");
  console.log("======================================");
  console.log("");

  const rows = psql(`
    select
      p.proname,
      pg_get_function_identity_arguments(p.oid),
      pg_get_userbyid(p.proowner),
      coalesce((select cfg from unnest(p.proconfig) cfg where cfg like 'search_path=%'), '<not set>')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef = true
    order by p.proname, 2;
  `);

  check(`encontrou ao menos uma function SECURITY DEFINER em public (sanity check — ${rows.length} encontradas)`, () => {
    if (rows.length === 0) throw new Error("nenhuma function SECURITY DEFINER encontrada — stack parece vazia/errada");
  });

  for (const [proname, args, owner, searchPath] of rows) {
    const key = `${proname}/${args}`;

    check(`${key}: owner é "${EXPECTED_OWNER}"`, () => {
      if (owner !== EXPECTED_OWNER) {
        throw new Error(`owner inesperado: "${owner}" (esperado "${EXPECTED_OWNER}")`);
      }
    });

    check(`${key}: search_path não contém schema gravável/perigoso (atual: ${searchPath})`, () => {
      const isEmpty = searchPath === 'search_path=""' || searchPath === "search_path=''";
      if (isEmpty) return;

      const containsDangerous = WRITABLE_OR_DANGEROUS_SCHEMAS.some((s) => searchPath.includes(s));
      if (!containsDangerous) return;

      const allowlistReason = ALLOWLIST[key];
      if (allowlistReason) {
        console.log(`     (permitido via ALLOWLIST documentado: ${allowlistReason})`);
        return;
      }

      throw new Error(
        `search_path="${searchPath}" inclui schema gravável/perigoso e NÃO está no ALLOWLIST documentado — corrija para search_path='' (qualificando todo o corpo) ou documente a exceção com motivo comprovado`
      );
    });
  }

  // Trigger functions corrigidas: nenhuma pode ter EXECUTE concedido a
  // public/anon/authenticated/service_role — o mecanismo de trigger
  // nunca depende disso, então qualquer grant aqui seria superfície
  // desnecessária. Inclui as 3 da rodada anterior (migrations ainda
  // pendentes) + as 20 achadas na auditoria de 2026-08-30 (já
  // aplicadas no remoto, corrigidas por 20260830100000).
  const TRIGGER_FUNCTIONS = [
    "audit_document_relation_created",
    "audit_document_version_client_response_created",
    "enforce_single_active_contract_base",
    "audit_additional_proposal_created",
    "audit_additional_proposal_linked",
    "audit_additional_proposal_updated",
    "audit_ai_finding_created",
    "audit_ai_finding_status_changed",
    "audit_esg_obligation_created",
    "audit_esg_obligation_evidence_created",
    "audit_esg_obligation_submission_created",
    "audit_event_clause_confrontation_candidate_created",
    "audit_event_note_created",
    "audit_project_startup_transitions",
    "audit_sla_action_created",
    "audit_sla_action_updated",
    "audit_sla_configuration_updated",
    "audit_timeline_export_created",
    "sync_document_version_principal_file",
    "validate_esg_evidence_same_project",
    "validate_esg_obligation_same_project",
    "validate_esg_submission_same_project",
    "validate_event_clause_same_project",
  ];
  const FORBIDDEN_GRANTEES = ["public", "anon", "authenticated", "service_role"];

  for (const fn of TRIGGER_FUNCTIONS) {
    check(`${fn}(): sem EXECUTE para public/anon/authenticated/service_role`, () => {
      const aclRows = psql(`
        select coalesce(
          (select string_agg(distinct split_part(a.acl::text, '/', 1), ',') from unnest(p.proacl) as a(acl)),
          ''
        )
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = '${fn}';
      `);
      const acl = aclRows[0]?.[0] ?? "";
      // Cada token vem como "role=perms" (aclitem sem a parte "/grantor",
      // já removida no SQL) — extrai só o nome do role antes do "=", senão
      // a comparação abaixo nunca bate com nada (bug encontrado e corrigido
      // em 2026-08-30: FORBIDDEN_GRANTEES.includes("anon=X") é sempre
      // falso, o que tornava este check vacuamente OK mesmo com grant real).
      const grantedRoles = acl.split(",").filter(Boolean).map((r) => r.split("=")[0]);
      const forbidden = grantedRoles.filter((r) => FORBIDDEN_GRANTEES.includes(r));
      if (forbidden.length > 0) {
        throw new Error(`EXECUTE indevido concedido a: ${forbidden.join(", ")} (ACL completa: ${acl || "<vazia>"})`);
      }
    });
  }

  // register_document_version_file: ACL mínima determinada pela
  // investigação de 2026-08-30 (zero chamador legítimo em qualquer
  // lugar) — deve manter postgres/service_role, nunca anon/authenticated.
  check("register_document_version_file(...): sem EXECUTE para anon/authenticated", () => {
    const aclRows = psql(`
      select coalesce(
        (select string_agg(distinct split_part(a.acl::text, '/', 1), ',') from unnest(p.proacl) as a(acl)),
        ''
      )
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'register_document_version_file';
    `);
    const acl = aclRows[0]?.[0] ?? "";
    const grantedRoles = acl.split(",").filter(Boolean).map((r) => r.split("=")[0]);
    const forbidden = grantedRoles.filter((r) => r === "anon" || r === "authenticated");
    if (forbidden.length > 0) {
      throw new Error(`EXECUTE indevido concedido a: ${forbidden.join(", ")} (ACL completa: ${acl || "<vazia>"})`);
    }
    if (!grantedRoles.includes("service_role")) {
      throw new Error(`service_role deveria manter EXECUTE (ACL completa: ${acl || "<vazia>"})`);
    }
  });

  console.log("");
  console.log("======================================");
  console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
  console.log("======================================");

  if (failed > 0) {
    process.exit(1);
  }
}

main();
