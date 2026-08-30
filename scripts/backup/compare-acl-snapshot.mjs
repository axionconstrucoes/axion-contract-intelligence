// Compara dois snapshots gerados por capture-acl-snapshot.mjs —
// tipicamente o snapshot da ORIGEM (remoto, no momento do backup) e o
// snapshot de um alvo RESTAURADO — e falha (exit 1) se qualquer função
// de public divergir em ACL/owner/SECURITY DEFINER/search_path, ou se
// o pg_default_acl do schema divergir.
//
// Nunca imprime segredo: os snapshots já não contêm nenhum (ver
// capture-acl-snapshot.mjs — só metadados de ACL, nunca dados).
//
// Uso:
//   node scripts/backup/compare-acl-snapshot.mjs <snapshot-origem.json> <snapshot-alvo.json>

import { readFileSync } from "node:fs";

const [originPath, targetPath] = process.argv.slice(2);
if (!originPath || !targetPath) {
  console.error("Uso: node compare-acl-snapshot.mjs <snapshot-origem.json> <snapshot-alvo.json>");
  process.exit(1);
}

function load(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function keyOf(fn) {
  return `${fn.schema}.${fn.function_name}(${fn.identity_args})`;
}

function main() {
  const origin = load(originPath);
  const target = load(targetPath);

  console.log("");
  console.log("======================================");
  console.log("COMPARAÇÃO DE ACL — origem vs. alvo restaurado");
  console.log("======================================");
  console.log(`Origem: ${origin.project_ref} (${origin.captured_at}), ${origin.function_count} funções`);
  console.log(`Alvo:   ${target.project_ref} (${target.captured_at}), ${target.function_count} funções`);
  console.log("");

  const originByKey = new Map(origin.functions.map((f) => [keyOf(f), f]));
  const targetByKey = new Map(target.functions.map((f) => [keyOf(f), f]));

  const allKeys = new Set([...originByKey.keys(), ...targetByKey.keys()]);
  const diffs = [];

  for (const key of allKeys) {
    const o = originByKey.get(key);
    const t = targetByKey.get(key);

    if (!o) {
      // Existe só no alvo: esperado para funções criadas por migrations
      // ainda pendentes no momento em que o snapshot de origem foi
      // capturado — não é uma divergência de ACL, é uma função nova.
      continue;
    }
    if (!t) {
      diffs.push({ key, field: "presença", origin: "existe", target: "AUSENTE no alvo restaurado" });
      continue;
    }
    if (o.owner !== t.owner) {
      diffs.push({ key, field: "owner", origin: o.owner, target: t.owner });
    }
    if (o.normalized_acl !== t.normalized_acl) {
      diffs.push({ key, field: "ACL", origin: o.normalized_acl, target: t.normalized_acl });
    }
    if (o.security_definer !== t.security_definer) {
      diffs.push({ key, field: "SECURITY DEFINER", origin: String(o.security_definer), target: String(t.security_definer) });
    }
    if (o.search_path !== t.search_path) {
      diffs.push({ key, field: "search_path", origin: o.search_path, target: t.search_path });
    }
  }

  // default_acl: comparação por (schema, object_type).
  const originDefault = new Map(origin.default_acl.map((d) => [`${d.schema}.${d.object_type}`, d.normalized_default_acl]));
  const targetDefault = new Map(target.default_acl.map((d) => [`${d.schema}.${d.object_type}`, d.normalized_default_acl]));
  const defaultKeys = new Set([...originDefault.keys(), ...targetDefault.keys()]);
  const defaultDiffs = [];
  for (const key of defaultKeys) {
    const o = originDefault.get(key) ?? "<ausente>";
    const t = targetDefault.get(key) ?? "<ausente>";
    if (o !== t) {
      defaultDiffs.push({ key, origin: o, target: t });
    }
  }

  if (diffs.length === 0) {
    console.log(`OK   ${allKeys.size - diffs.length} funções comparadas, ACL/owner/SECURITY DEFINER/search_path idênticos (funções só no alvo, novas, ignoradas corretamente)`);
  } else {
    console.log(`FAIL ${diffs.length} divergência(s) de ACL:`);
    for (const d of diffs) {
      console.log(`     ${d.key} — ${d.field}: origem="${d.origin}" alvo="${d.target}"`);
    }
  }

  console.log("");
  if (defaultDiffs.length === 0) {
    console.log("OK   pg_default_acl idêntico entre origem e alvo");
  } else {
    console.log(`FAIL pg_default_acl diverge:`);
    for (const d of defaultDiffs) {
      console.log(`     ${d.key} — origem="${d.origin}" alvo="${d.target}"`);
    }
  }

  console.log("");
  console.log("======================================");
  const allOk = diffs.length === 0 && defaultDiffs.length === 0;
  console.log(allOk ? "RESULTADO: PASS" : "RESULTADO: FAIL");
  console.log("======================================");

  if (!allOk) {
    process.exit(1);
  }
}

main();
