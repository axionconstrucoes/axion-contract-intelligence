// Testes do estado do botão [Salvar configuração] (Integrações →
// Gmail/E-mails) — oculto quando não há alteração pendente, visível
// assim que houver diferença entre valor salvo e valor atual. Lógica
// pura testada de verdade (isEmailIngestionConfigDirty); comportamento
// de re-render/erro/sucesso verificado estruturalmente (sem framework
// de DOM neste projeto — mesmo princípio de toda a suíte). NUNCA chama
// a API Anthropic — este pacote é só UI/estado de formulário.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-save-config-button-state.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { isEmailIngestionConfigDirty } = await import("../apps/web/lib/email/inbound/ingestion-controls/compute-config-dirty");

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
console.log("BOTÃO [SALVAR CONFIGURAÇÃO] — TESTES");
console.log("======================================");
console.log("");

function makeValues(overrides) {
  return {
    emailAccountId: "acc-1",
    windowMode: "FROM_NOW",
    customStartAt: "",
    customEndAt: "",
    includeAttachments: true,
    domains: [{ domain: "weg.net", domainRole: "CLIENT", enabled: true }],
    participants: [],
    ...overrides,
  };
}

// ---------------- lógica pura real (isEmailIngestionConfigDirty) ----------------

check("configuração existente sem alterações => botão oculto (dirty = false)", () => {
  const saved = makeValues({});
  const current = makeValues({});
  assert(isEmailIngestionConfigDirty(current, saved, true) === false);
});

check("alteração de 1 campo (domínio) => botão aparece (dirty = true)", () => {
  const saved = makeValues({});
  const current = makeValues({ domains: [{ domain: "weg.net-editado", domainRole: "CLIENT", enabled: true }] });
  assert(isEmailIngestionConfigDirty(current, saved, true) === true);
});

check("alteração revertida ao valor salvo => botão desaparece (dirty = false de novo)", () => {
  const saved = makeValues({});
  const editedThenReverted = makeValues({}); // usuário digitou algo e depois voltou ao valor original
  assert(isEmailIngestionConfigDirty(editedThenReverted, saved, true) === false, "reverter para o valor salvo deveria zerar o estado dirty");
});

check("projeto sem configuração (hasSavedConfig=false) => botão sempre aparece, mesmo com valores 'iguais'", () => {
  const saved = makeValues({});
  const current = makeValues({});
  assert(isEmailIngestionConfigDirty(current, saved, false) === true, "sem configuração persistida, o botão nunca deveria ficar oculto");
});

check("mudar conta AXION selecionada torna dirty", () => {
  const saved = makeValues({ emailAccountId: "acc-1" });
  const current = makeValues({ emailAccountId: "acc-2" });
  assert(isEmailIngestionConfigDirty(current, saved, true) === true);
});

check("mudar período (windowMode) torna dirty", () => {
  const saved = makeValues({ windowMode: "FROM_NOW" });
  const current = makeValues({ windowMode: "FROM_PROJECT_START" });
  assert(isEmailIngestionConfigDirty(current, saved, true) === true);
});

check("datas customizadas só contam quando windowMode = CUSTOM (evita falso 'dirty' com datas obsoletas em outros modos)", () => {
  const saved = makeValues({ windowMode: "FROM_NOW", customStartAt: "", customEndAt: "" });
  const current = makeValues({ windowMode: "FROM_NOW", customStartAt: "2026-01-01", customEndAt: "" }); // valor residual, não visível na UI
  assert(isEmailIngestionConfigDirty(current, saved, true) === false, "datas não visíveis (windowMode != CUSTOM) não deveriam disparar dirty");
});

check("datas customizadas contam quando windowMode = CUSTOM", () => {
  const saved = makeValues({ windowMode: "CUSTOM", customStartAt: "2026-01-01", customEndAt: "" });
  const current = makeValues({ windowMode: "CUSTOM", customStartAt: "2026-02-01", customEndAt: "" });
  assert(isEmailIngestionConfigDirty(current, saved, true) === true);
});

check("mudar 'Incluir anexos' torna dirty", () => {
  const saved = makeValues({ includeAttachments: true });
  const current = makeValues({ includeAttachments: false });
  assert(isEmailIngestionConfigDirty(current, saved, true) === true);
});

check("adicionar um participante torna dirty", () => {
  const saved = makeValues({ participants: [] });
  const current = makeValues({ participants: [{ emailAddress: "contato@cliente.com.br", roleNote: "", enabled: true }] });
  assert(isEmailIngestionConfigDirty(current, saved, true) === true);
});

check("remover um domínio torna dirty", () => {
  const saved = makeValues({ domains: [{ domain: "weg.net", domainRole: "CLIENT", enabled: true }] });
  const current = makeValues({ domains: [] });
  assert(isEmailIngestionConfigDirty(current, saved, true) === true);
});

// ---------------- estrutural: comportamento de UI (sem framework de DOM) ----------------

const formSource = readSource("apps/web/components/integrations/email-ingestion-config-form.tsx");

check("botão só aparece quando isDirty é verdadeiro; 'Configuração salva' aparece quando não há pendência", () => {
  assert(formSource.includes("isDirty ? ("), "deveria condicionar a renderização do botão a isDirty");
  assert(formSource.includes("Salvar configuração"));
  assert(formSource.includes("Configuração salva"));
});

check("mensagem 'Configuração salva' nunca tem aparência de alerta (não usa text-destructive nem role=alert)", () => {
  const savedMessageBlock = formSource.match(/Configuração salva[\s\S]{0,5}/);
  assert(savedMessageBlock, "mensagem não encontrada");
  const surrounding = formSource.slice(Math.max(0, formSource.indexOf("Configuração salva") - 120), formSource.indexOf("Configuração salva"));
  assert(!/text-destructive|role="alert"/.test(surrounding), "mensagem de sucesso não deveria usar estilo de alerta/erro");
  assert(/text-muted-foreground/.test(surrounding), "mensagem deveria ser discreta (text-muted-foreground), não chamativa");
});

check("erro de salvamento: savedSnapshot só é atualizado quando state.success — falha nunca pinta campos de verde nem esconde o botão", () => {
  assert(/if \(state\.success\) \{[\s\S]*?setSavedSnapshot/.test(formSource), "savedSnapshot só deveria mudar em caso de sucesso");
  assert(!/state\.error[\s\S]{0,80}setSavedSnapshot/.test(formSource), "erro nunca deveria atualizar o snapshot salvo");
});

check("isDirty é recalculado a partir do estado ATUAL (emailAccountId/windowMode/.../domains/participants), nunca de um valor congelado", () => {
  assert(/isEmailIngestionConfigDirty\(\s*\{\s*emailAccountId,\s*windowMode,\s*customStartAt,\s*customEndAt,\s*includeAttachments,\s*domains,\s*participants\s*\}/.test(
    formSource.replace(/\s+/g, " ")
  ));
});

check("botões ADICIONAR (domínio/participante) continuam disponíveis independentemente de isDirty — nunca condicionados a ele", () => {
  const addButtonsSource = formSource.match(/\+ Adicionar/g) ?? [];
  assert(addButtonsSource.length >= 1, "botões + Adicionar deveriam existir (dentro de ListEditor)");
  // ListEditor (onde "+ Adicionar" vive) não recebe isDirty como prop — nunca condicionado ao estado do Salvar.
  const listEditorFnMatch = formSource.match(/function ListEditor[\s\S]*$/);
  assert(listEditorFnMatch, "ListEditor não encontrado");
  assert(!/isDirty/.test(listEditorFnMatch[0]), "ListEditor (botões Adicionar/Remover) nunca deveria depender de isDirty");
});

check("botão 'Adicionar conta de e-mail AXION' (fora deste form) também não depende de isDirty desta configuração", () => {
  const accountsPanelSource = readSource("apps/web/components/integrations/email-accounts-panel.tsx");
  assert(!/isDirty/.test(accountsPanelSource), "o painel de contas é independente do estado dirty da configuração do projeto");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
