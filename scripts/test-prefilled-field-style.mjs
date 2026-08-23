// Testes da "Identificação visual de campos pré-preenchidos"
// (Integrações → Gmail/E-mails, e qualquer formulário futuro que
// reutilize este helper). A comparação real (valor atual == valor
// salvo) é lógica pura e testada de verdade aqui. O comportamento de
// re-render do componente (campo fica branco ao editar, volta a ficar
// verde após salvar) é verificado estruturalmente, já que este projeto
// não tem framework de teste de DOM — mesmo princípio já usado em toda
// esta suíte (ver scripts/test-feature-info.mjs). NUNCA chama a API
// Anthropic — este pacote é só UI/estilo.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-prefilled-field-style.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { PREFILLED_FIELD_CLASSNAME, PREFILLED_FIELD_TITLE, resolvePrefilledFieldProps, isFieldPrefilled } = await import(
  "../apps/web/lib/ui/prefilled-field-style"
);
const { ACC_FEATURE_HELP } = await import("../apps/web/lib/ui/feature-help");

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
console.log("CAMPOS PRÉ-PREENCHIDOS (Gmail/E-mails) — TESTES");
console.log("======================================");
console.log("");

// ---------------- lógica pura real ----------------

check("valor carregado do banco (igual ao salvo, não vazio) => verde", () => {
  assert(isFieldPrefilled("weg.net", "weg.net") === true);
});

check("campo vazio (nada digitado, nada salvo) => nunca verde", () => {
  assert(isFieldPrefilled("", "") === false, "vazio == vazio não deveria contar como 'pré-preenchido'");
  assert(isFieldPrefilled("", null) === false);
  assert(isFieldPrefilled("", undefined) === false);
});

check("usuário altera o valor (deixa de bater com o salvo) => branco", () => {
  assert(isFieldPrefilled("weg-editado.net", "weg.net") === false);
});

check("campo novo preenchido pelo usuário, mas nada foi salvo ainda => branco (nunca verde por coincidência)", () => {
  assert(isFieldPrefilled("cliente.com.br", null) === false);
  assert(isFieldPrefilled("cliente.com.br", "") === false);
});

check("resolvePrefilledFieldProps(true) usa a classe verde-claro documentada + title (nunca sólido forte)", () => {
  const props = resolvePrefilledFieldProps(true);
  assert(props.className === PREFILLED_FIELD_CLASSNAME);
  assert(props.title === PREFILLED_FIELD_TITLE);
  assert(/bg-green-50\b/.test(props.className), "deveria usar bg-green-50 (verde-claro)");
  assert(/border-green-400\b/.test(props.className), "deveria usar border-green-400");
  assert(!/bg-green-(500|600|700|800|900)\b/.test(props.className), "nunca verde sólido forte (500+)");
});

check("resolvePrefilledFieldProps(false) => sem classe verde, sem title (campo vazio é sempre fundo branco padrão)", () => {
  const props = resolvePrefilledFieldProps(false);
  assert(props.className === "");
  assert(props.title === undefined);
});

check("título nunca sugere validação/aprovação — só 'carregado do sistema'", () => {
  assert(!/valid|aprov|correto|sem risco/i.test(PREFILLED_FIELD_TITLE), `título não deveria sugerir validação: "${PREFILLED_FIELD_TITLE}"`);
  assert(/carregado|salvo/i.test(PREFILLED_FIELD_TITLE));
});

// ---------------- FeatureInfo / legenda ----------------

check("registry: gmail-prefilled-fields existe e explicitamente distingue 'salvo' de 'validado/aprovado'", () => {
  const def = ACC_FEATURE_HELP["gmail-prefilled-fields"];
  assert(def, "gmail-prefilled-fields ausente do registry");
  const allText = `${def.title} ${def.shortDescription} ${def.description}`;
  assert(/validad|aprovad/i.test(allText), "a explicação deveria deixar claro que verde não é validação/aprovação");
});

// ---------------- estrutural: comportamento de re-render (sem framework de DOM) ----------------

const formSource = readSource("apps/web/components/integrations/email-ingestion-config-form.tsx");

check("legenda 'Campos em verde já possuem informações salvas.' presente com FeatureInfo", () => {
  assert(formSource.includes("Campos em verde já possuem informações salvas."));
  assert(formSource.includes('helpId="gmail-prefilled-fields"'));
});

check("nenhum ícone de check/aprovação usado na legenda (evita sugerir validação)", () => {
  const legendMatch = formSource.match(/Campos em verde[\s\S]{0,300}/);
  assert(legendMatch, "legenda não encontrada");
  assert(!/CheckCircle|BadgeCheck|<Check\b/.test(legendMatch[0]), "legenda não deveria usar ícone de check/aprovação");
});

check("todos os campos relevantes (conta, período, datas, domínio, participante, anexos) usam a lógica de pré-preenchido", () => {
  assert(formSource.includes("accountPrefilled"), "Conta AXION deveria calcular estado pré-preenchido");
  assert(formSource.includes("windowModePrefilled"), "Período deveria calcular estado pré-preenchido");
  assert(formSource.includes("startAtPrefilled") && formSource.includes("endAtPrefilled"), "Datas deveriam calcular estado pré-preenchido");
  assert(formSource.includes("isRowPrefilled"), "Domínios/participantes deveriam calcular estado pré-preenchido por linha");
  assert(formSource.includes("includeAttachmentsPrefilled"), "Checkbox 'Incluir anexos' deveria calcular estado pré-preenchido");
});

check("hasSavedConfig nunca deixa um projeto novo (sem configuração) mostrar campos verdes por coincidência com o default de UI", () => {
  assert(formSource.includes("hasSavedConfig"), "deveria existir uma flag explícita distinguindo 'nada salvo ainda' de 'valor bate por acaso'");
  assert(/hasSavedConfig\s*&&\s*isFieldPrefilled/.test(formSource), "cada comparação escalar deveria ser condicionada a hasSavedConfig");
});

check("editar um campo tira o destaque verde (comparação em tempo real, não um snapshot congelado no primeiro render)", () => {
  // O valor comparado é sempre o estado ATUAL (emailAccountId/windowMode/...
  // /customStartAt/customEndAt), nunca uma cópia congelada — logo, editar
  // o input já reavalia isFieldPrefilled a cada render.
  assert(/isFieldPrefilled\(emailAccountId, savedSnapshot\.emailAccountId\)/.test(formSource));
  assert(/isFieldPrefilled\(customStartAt, savedSnapshot\.customStartAt\)/.test(formSource));
});

check("salvar com sucesso atualiza savedSnapshot para os valores atuais (campos voltam a ficar verdes) — sem useEffect (evita cascading renders)", () => {
  assert(formSource.includes("state.success"), "deveria reagir ao sucesso do Server Action");
  assert(formSource.includes("setSavedSnapshot({"), "deveria atualizar o snapshot salvo após sucesso");
  assert(
    !/from "react"[^;]*useEffect|useEffect\(/.test(formSource) && !/import\s*{\s*[^}]*\buseEffect\b/.test(formSource),
    "não deveria importar/usar useEffect para isso (setState síncrono em efeito causa cascading renders — usar ajuste durante a renderização)"
  );
});

check("sem regressão: FeatureInfo dos campos já existentes (conta/período/domínio/participantes/anexos) continuam presentes", () => {
  for (const helpId of ["gmail-account-connected", "gmail-ingestion-period", "gmail-client-domain", "gmail-participants", "gmail-include-attachments"]) {
    assert(formSource.includes(`helpId="${helpId}"`), `${helpId} deveria continuar renderizado (sem regressão)`);
  }
});

check("acessibilidade preservada: cor nunca é o único sinal — todo campo pré-preenchido também recebe um title (tooltip nativo lido por leitores de tela)", () => {
  assert(formSource.includes("accountPrefilled.title"));
  assert(formSource.includes("windowModePrefilled.title"));
  assert(formSource.includes("startAtPrefilled.title"));
  assert(formSource.includes("endAtPrefilled.title"));
});

check("checkbox 'Incluir anexos' usa contorno/área verde-clara discreta, nunca muda o componente global de checkbox", () => {
  const checkboxBlock = formSource.match(/Incluir anexos[\s\S]{0,20}|includeAttachmentsPrefilled[\s\S]{0,400}/g)?.join("\n") ?? "";
  assert(formSource.includes('type="checkbox"'), "deveria continuar sendo um checkbox nativo padrão");
  assert(/includeAttachmentsPrefilled[\s\S]*?border-green-400/.test(formSource), "deveria aplicar um contorno verde-claro condicionalmente");
  void checkboxBlock;
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
