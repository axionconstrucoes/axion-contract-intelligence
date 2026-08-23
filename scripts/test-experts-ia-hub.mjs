// Testes do hub "Experts IA" (navegação + página central) —
// verificação estrutural/de dados, sem depender de renderização React
// nem de rede. Confirma: reutilização de apps/web/lib/ai/expert-definitions/
// como única fonte de verdade (nenhuma lista duplicada de nomes/missão);
// os 5 Experts oficiais aparecem; status ativo/em implantação bate com
// `ExpertDefinition.status`; só os 2 Experts implementados têm link de
// acesso; labels da barra lateral renomeados sem alterar rotas/hrefs.
//
// NUNCA chama a API Anthropic real.
//
// Uso:
//   node scripts/test-experts-ia-hub.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { ALL_OFFICIAL_EXPERT_DEFINITIONS } = await import("../apps/web/lib/ai/expert-definitions/definitions");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
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

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

console.log("");
console.log("======================================");
console.log("EXPERTS IA — HUB E NAVEGAÇÃO — TESTES");
console.log("======================================");
console.log("");

check("os 5 Experts oficiais estão disponíveis em ALL_OFFICIAL_EXPERT_DEFINITIONS (fonte única para o hub)", () => {
  assert(ALL_OFFICIAL_EXPERT_DEFINITIONS.length === 5);
  const ids = ALL_OFFICIAL_EXPERT_DEFINITIONS.map((e) => e.expertId).sort();
  assert(
    JSON.stringify(ids) === JSON.stringify(["ceo", "commercial-director", "esg-director", "legal-consultant", "planning-director"].sort())
  );
});

check("commercial-director e esg-director são os únicos com status IMPLEMENTED (Ativo) — os outros 3 são PLANNED (Em implantação)", () => {
  const implemented = ALL_OFFICIAL_EXPERT_DEFINITIONS.filter((e) => e.status === "IMPLEMENTED").map((e) => e.expertId).sort();
  const planned = ALL_OFFICIAL_EXPERT_DEFINITIONS.filter((e) => e.status === "PLANNED").map((e) => e.expertId).sort();
  assert(JSON.stringify(implemented) === JSON.stringify(["commercial-director", "esg-director"]));
  assert(JSON.stringify(planned) === JSON.stringify(["ceo", "legal-consultant", "planning-director"].sort()));
});

check("cada ExpertDefinition tem nome e missão não vazios (dados exibidos no card vêm sempre daqui, nunca duplicados na página)", () => {
  for (const expert of ALL_OFFICIAL_EXPERT_DEFINITIONS) {
    assert(expert.expertName.trim().length > 0, `${expert.expertId} sem expertName`);
    assert(expert.mission.trim().length > 0, `${expert.expertId} sem mission`);
  }
});

check("página experts-ia/page.tsx reutiliza ALL_OFFICIAL_EXPERT_DEFINITIONS — nunca uma lista de Experts duplicada/hardcoded", () => {
  const source = readSource("apps/web/app/[projectId]/experts-ia/page.tsx");
  assert(source.includes("ALL_OFFICIAL_EXPERT_DEFINITIONS"), "página deveria importar a lista oficial de apps/web/lib/ai/expert-definitions/");
  assert(source.includes('from "@/lib/ai/expert-definitions"'), "import deveria vir da fonte de verdade única");
  assert(!/CEO IA.*Diretor Comercial IA.*Consultor Jurídico IA/s.test(source), "nomes dos 5 Experts não deveriam estar hardcoded na página");
});

check("página experts-ia só oferece link de acesso (\"Abrir Expert\") para commercial-director e esg-director — os 3 planejados não têm href", () => {
  const source = readSource("apps/web/app/[projectId]/experts-ia/page.tsx");
  assert(source.includes('"commercial-director": (projectId) => `/${projectId}/dashboard`'));
  assert(source.includes('"esg-director": (projectId) => `/${projectId}/esg`'));
  assert(!source.includes('"ceo":'), "CEO IA não deveria ter link de acesso — ainda não é operacional");
  assert(!source.includes('"legal-consultant":'), "Consultor Jurídico IA não deveria ter link de acesso");
  assert(!source.includes('"planning-director":'), "Diretor de Planejamento IA não deveria ter link de acesso");
});

check("página experts-ia nunca conecta um novo LLM nem chama providers (não importa nada de lib/ai/providers/)", () => {
  const source = readSource("apps/web/app/[projectId]/experts-ia/page.tsx");
  assert(!source.includes("lib/ai/providers"), "hub é só navegação/apresentação — nunca deveria importar providers");
  assert(!source.includes("resolveAiProviderForExpert"), "hub não deveria resolver nenhum provider diretamente");
  assert(!source.includes("Anthropic"), "hub não deveria referenciar Anthropic diretamente");
});

check('barra lateral: "Revisão Contratual" e "Revisão de Cláusulas" viraram "Análise Contratual"/"Análise de Cláusulas" — sem alterar as rotas (href)', () => {
  const source = readSource("apps/web/components/layout/app-sidebar.tsx");
  assert(source.includes('label: "Análise Contratual"'));
  assert(source.includes('label: "Análise de Cláusulas"'));
  assert(!source.includes('label: "Revisão Contratual"'), "label antigo não deveria mais existir");
  assert(!source.includes('label: "Revisão de Cláusulas"'), "label antigo não deveria mais existir");
  assert(source.includes('href: "revisao-contratual"'), "rota/diretório técnico não pode ter sido renomeado");
  assert(source.includes('href: "revisao-clausulas"'), "rota/diretório técnico não pode ter sido renomeado");
});

check('barra lateral: nova entrada "Experts IA" aponta para experts-ia', () => {
  const source = readSource("apps/web/components/layout/app-sidebar.tsx");
  assert(source.includes('href: "experts-ia", label: "Experts IA"'));
});

check("os diretórios de rota técnicos revisao-contratual/revisao-clausulas continuam existindo sem renomeação", () => {
  const contratual = readSource("apps/web/app/[projectId]/revisao-contratual/page.tsx");
  const clausulas = readSource("apps/web/app/[projectId]/revisao-clausulas/page.tsx");
  assert(contratual.length > 0);
  assert(clausulas.length > 0);
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
