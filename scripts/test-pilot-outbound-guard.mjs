// Testes da trava global de e-mail do piloto (ACC_OUTBOUND_MODE /
// ACC_PILOT_RECIPIENT). Cobre tanto o comportamento real da função
// pura applyPilotOutboundGuard (via env explícito, nunca mutando
// process.env global) quanto verificação ESTRUTURAL (leitura de
// código-fonte) contra os pontos de bypass listados no requisito —
// mesmo padrão já usado em scripts/test-feature-info.mjs e
// scripts/test-global-test-mode-banner.mjs. NENHUM teste aqui faz
// chamada de rede: o caminho de bloqueio do GmailEmailProvider é
// testado de verdade (a trava dispara antes de qualquer chamada à API
// do Gmail); o caminho de sucesso do GmailEmailProvider é verificado
// apenas estruturalmente, para nunca arriscar um envio real.
//
// Uso:
//   node scripts/test-pilot-outbound-guard.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { applyPilotOutboundGuard, resolveOutboundMode, isValidEmailAddress, ACC_EXPECTED_PILOT_RECIPIENT, PILOT_SUBJECT_PREFIX } =
  await import("../apps/web/lib/email/pilot-outbound-guard");
const { EmailSendError } = await import("../apps/web/lib/email/email-provider");
const { FakeEmailProvider } = await import("../apps/web/lib/email/fake-email-provider");
// GmailEmailProvider NUNCA é importado aqui, propositalmente: o arquivo
// tem "server-only" (mesmo padrão que impede qualquer script Node
// standalone de importá-lo, inclusive este) — sua cobertura é só
// estrutural (leitura de código-fonte) abaixo, nunca dinâmica, para
// nunca arriscar uma tentativa real de chamada à API do Gmail.

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

async function checkAsync(name, fn) {
  try {
    await fn();
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

async function assertThrowsEmailSendError(fn, message) {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof EmailSendError, `${message} — esperava EmailSendError, obteve ${error?.constructor?.name}: ${error?.message}`);
    return;
  }
  throw new Error(`${message} — deveria ter lançado, mas não lançou`);
}

const VALID_PILOT_ENV = { outboundMode: "pilot", pilotRecipient: "reynaldo@axion.com.br" };
const PRODUCTION_ENV = { outboundMode: "production", pilotRecipient: undefined };

const baseInput = {
  to: "cliente-real@empresa-do-cliente.com.br",
  subject: "Alerta contratual",
  text: "corpo do e-mail",
  correlationId: "test-correlation-id",
};

console.log("");
console.log("======================================");
console.log("TRAVA GLOBAL DE E-MAIL DO PILOTO — TESTES");
console.log("======================================");
console.log("");

// --- Comportamento fail-closed da resolução de modo ---

check('resolveOutboundMode: ausente/"pilot"/vazio/inválido mantêm PILOT; só "production" exato libera', () => {
  assert(resolveOutboundMode({}) === "PILOT", "ausente deveria ser PILOT");
  assert(resolveOutboundMode({ outboundMode: "pilot" }) === "PILOT");
  assert(resolveOutboundMode({ outboundMode: "" }) === "PILOT");
  assert(resolveOutboundMode({ outboundMode: "PRODUCTION" }) === "PILOT", 'caixa diferente ("PRODUCTION") não deveria contar como o valor exato');
  assert(resolveOutboundMode({ outboundMode: "Production" }) === "PILOT");
  assert(resolveOutboundMode({ outboundMode: "producao" }) === "PILOT");
  assert(resolveOutboundMode({ outboundMode: "production" }) === "PRODUCTION", 'valor exato "production" deveria liberar');
});

// --- Destinatário original substituído ---

check("destinatário original é substituído por reynaldo@axion.com.br em modo piloto", () => {
  const guarded = applyPilotOutboundGuard(baseInput, VALID_PILOT_ENV);
  assert(guarded.to === ACC_EXPECTED_PILOT_RECIPIENT, `to obtido: "${guarded.to}"`);
  assert(guarded.to !== baseInput.to);
});

check("destinatário original preservado SOMENTE no objeto de metadados do chamador, nunca no resultado do guard", () => {
  const guarded = applyPilotOutboundGuard(baseInput, VALID_PILOT_ENV);
  const serialized = JSON.stringify(guarded);
  assert(!serialized.includes(baseInput.to), "o e-mail original não deveria aparecer em nenhum campo do objeto reescrito");
});

// --- Assunto ---

check("assunto recebe o prefixo [TESTE CONTROLADO] uma única vez", () => {
  const guarded = applyPilotOutboundGuard(baseInput, VALID_PILOT_ENV);
  assert(guarded.subject === `${PILOT_SUBJECT_PREFIX}${baseInput.subject}`, `subject obtido: "${guarded.subject}"`);
});

check("assunto já prefixado não duplica o prefixo", () => {
  const alreadyPrefixed = { ...baseInput, subject: `${PILOT_SUBJECT_PREFIX}Alerta contratual` };
  const guarded = applyPilotOutboundGuard(alreadyPrefixed, VALID_PILOT_ENV);
  assert(guarded.subject === `${PILOT_SUBJECT_PREFIX}Alerta contratual`, `subject obtido: "${guarded.subject}"`);
  assert((guarded.subject.match(/\[TESTE CONTROLADO\]/g) ?? []).length === 1, "prefixo apareceu mais de uma vez");
});

// --- CC / BCC / Reply-To ---

check("Reply-To é removido em modo piloto", () => {
  const withReplyTo = { ...baseInput, replyTo: "cliente-real@empresa-do-cliente.com.br" };
  const guarded = applyPilotOutboundGuard(withReplyTo, VALID_PILOT_ENV);
  assert(!guarded.replyTo, `replyTo deveria estar vazio/ausente, obtido: "${guarded.replyTo}"`);
});

check("CC/BCC (mesmo que adicionados dinamicamente ao input) são removidos em modo piloto", () => {
  const withCcBcc = { ...baseInput, cc: ["outro-cliente@empresa.com"], bcc: ["copia-oculta@empresa.com"] };
  const guarded = applyPilotOutboundGuard(withCcBcc, VALID_PILOT_ENV);
  assert(guarded.cc === undefined, "cc deveria ter sido removido");
  assert(guarded.bcc === undefined, "bcc deveria ter sido removido");
});

// --- Bloqueio fail-closed por configuração ausente/inválida ---

await checkAsync("modo piloto sem ACC_PILOT_RECIPIENT configurado bloqueia o envio", async () => {
  await assertThrowsEmailSendError(
    () => applyPilotOutboundGuard(baseInput, { outboundMode: "pilot", pilotRecipient: undefined }),
    "recipient ausente deveria bloquear"
  );
});

await checkAsync("modo piloto com ACC_PILOT_RECIPIENT vazio bloqueia o envio", async () => {
  await assertThrowsEmailSendError(
    () => applyPilotOutboundGuard(baseInput, { outboundMode: "pilot", pilotRecipient: "   " }),
    "recipient vazio deveria bloquear"
  );
});

await checkAsync("destinatário piloto com endereço inválido (sem @/domínio) bloqueia o envio", async () => {
  await assertThrowsEmailSendError(
    () => applyPilotOutboundGuard(baseInput, { outboundMode: "pilot", pilotRecipient: "nao-e-um-email" }),
    "endereço inválido deveria bloquear"
  );
});

await checkAsync("destinatário piloto diferente de reynaldo@axion.com.br (mas válido) bloqueia o envio", async () => {
  await assertThrowsEmailSendError(
    () => applyPilotOutboundGuard(baseInput, { outboundMode: "pilot", pilotRecipient: "outro-usuario@axion.com.br" }),
    "endereço piloto diferente do autorizado deveria bloquear"
  );
});

check("destinatário piloto com caixa diferente (Reynaldo@Axion.com.br) ainda é aceito e normalizado", () => {
  const guarded = applyPilotOutboundGuard(baseInput, { outboundMode: "pilot", pilotRecipient: "Reynaldo@Axion.com.br" });
  assert(guarded.to === ACC_EXPECTED_PILOT_RECIPIENT);
});

check("isValidEmailAddress: validação básica de formato", () => {
  assert(isValidEmailAddress("reynaldo@axion.com.br") === true);
  assert(isValidEmailAddress("sem-arroba-nem-dominio") === false);
  assert(isValidEmailAddress("sem-dominio@") === false);
  assert(isValidEmailAddress("") === false);
});

// --- Modo produção preserva o destinatário original ---

check("modo production (valor exato) preserva to/subject/cc/bcc/replyTo originais, sem exigir ACC_PILOT_RECIPIENT", () => {
  const withExtras = { ...baseInput, replyTo: "resposta@empresa.com", cc: ["a@b.com"], bcc: ["c@d.com"] };
  const guarded = applyPilotOutboundGuard(withExtras, PRODUCTION_ENV);
  assert(guarded.to === withExtras.to);
  assert(guarded.subject === withExtras.subject);
  assert(guarded.replyTo === withExtras.replyTo);
  assert(guarded.cc === withExtras.cc);
  assert(guarded.bcc === withExtras.bcc);
});

// --- Sem desligamento automático por data ---

check("guard não referencia relógio/data para decidir modo (só variáveis de ambiente)", () => {
  const guardSource = readSource("apps/web/lib/email/pilot-outbound-guard.ts");
  assert(!/new Date\(\)|Date\.now\(\)/.test(guardSource), "guard nunca deveria consultar data/hora para decidir se está em modo piloto");
});

// --- FakeEmailProvider aplica a mesma regra (via process.env real, sem rede) ---

await checkAsync("FakeEmailProvider bloqueia em modo piloto sem destinatário configurado (nenhuma rede envolvida)", async () => {
  const previousMode = process.env.ACC_OUTBOUND_MODE;
  const previousRecipient = process.env.ACC_PILOT_RECIPIENT;
  process.env.ACC_OUTBOUND_MODE = "pilot";
  delete process.env.ACC_PILOT_RECIPIENT;
  try {
    const provider = new FakeEmailProvider();
    await assertThrowsEmailSendError(() => provider.send(baseInput), "FakeEmailProvider deveria bloquear");
  } finally {
    process.env.ACC_OUTBOUND_MODE = previousMode;
    process.env.ACC_PILOT_RECIPIENT = previousRecipient;
  }
});

await checkAsync("FakeEmailProvider aplica a reescrita completa quando o piloto está corretamente configurado (nenhuma rede envolvida)", async () => {
  const previousMode = process.env.ACC_OUTBOUND_MODE;
  const previousRecipient = process.env.ACC_PILOT_RECIPIENT;
  process.env.ACC_OUTBOUND_MODE = "pilot";
  process.env.ACC_PILOT_RECIPIENT = "reynaldo@axion.com.br";
  try {
    const provider = new FakeEmailProvider();
    const result = await provider.send(baseInput);
    assert(result.provider === "FAKE");
  } finally {
    process.env.ACC_OUTBOUND_MODE = previousMode;
    process.env.ACC_PILOT_RECIPIENT = previousRecipient;
  }
});

check("convenção de falha simulada do FakeEmailProvider continua funcionando independente do modo piloto (checada sobre o input bruto)", () => {
  const source = readSource("apps/web/lib/email/fake-email-provider.ts");
  const forcedFailureIdx = source.indexOf("FAKE_FORCED_FAILURE_RECIPIENT");
  const guardCallIdx = source.indexOf("applyPilotOutboundGuard(input)");
  assert(forcedFailureIdx !== -1 && guardCallIdx !== -1, "não encontrou os dois pontos esperados no arquivo");
  assert(forcedFailureIdx < guardCallIdx, "a checagem de falha simulada precisa continuar ANTES do guard, sobre o input bruto");
});

// --- GmailEmailProvider aplica a mesma regra: cobertura 100% estrutural
// (o arquivo tem "server-only" — não é importável por um script Node
// standalone, mesmo padrão que já impedia isso antes desta trava; nunca
// arriscar uma tentativa real de chamada à API do Gmail neste teste) ---

check("estrutural: GmailEmailProvider chama applyPilotOutboundGuard ANTES do try/catch que envolve gmail.users.messages.send", () => {
  const source = readSource("apps/web/lib/email/gmail-email-provider.ts");
  const guardCallIdx = source.indexOf("applyPilotOutboundGuard(input)");
  const networkCallIdx = source.indexOf("gmail.users.messages.send(");
  assert(guardCallIdx !== -1, "chamada ao guard não encontrada em GmailEmailProvider");
  assert(networkCallIdx !== -1, "chamada de rede não encontrada em GmailEmailProvider");
  assert(guardCallIdx < networkCallIdx, "o guard precisa ser chamado antes da chamada de rede, nunca depois");
});

check("estrutural: GmailEmailProvider constrói o MIME a partir do resultado do guard (guardedInput), nunca do input bruto", () => {
  const source = readSource("apps/web/lib/email/gmail-email-provider.ts");
  assert(source.includes("buildMimeMessage(\n        guardedInput,") || /buildMimeMessage\(\s*guardedInput,/.test(source), "buildMimeMessage deveria receber guardedInput, não input");
  assert(!/buildMimeMessage\(\s*input,/.test(source), "buildMimeMessage não deveria mais receber o input bruto diretamente");
});

// --- Destinatário original preservado somente em auditoria/metadados (nos 3 fluxos reais) ---

check("os três fluxos de envio reais persistem input.recipientEmail (destinatário original) em emails/notification_*, nunca algo derivado do resultado do provider", () => {
  const files = [
    "apps/web/lib/email/send-sla-escalation-email.ts",
    "apps/web/lib/email/send-contract-alert-email.ts",
    "apps/web/lib/email/action-request-notification-core.ts",
  ];
  for (const file of files) {
    const source = readSource(file);
    assert(source.includes("to_address: input.recipientEmail"), `${file}: emails.to_address deveria vir de input.recipientEmail`);
  }
});

// --- Cobertura estrutural contra bypass ---

function listFilesRecursive(dir, extensions) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      result.push(...listFilesRecursive(full, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      result.push(full);
    }
  }
  return result;
}

const allSourceFiles = [
  ...listFilesRecursive(path.join(repoRoot, "apps/web"), [".ts", ".tsx"]),
  ...listFilesRecursive(path.join(repoRoot, "scripts"), [".mjs"]),
];

check("bypass 1/4 — toda classe que implementa EmailProvider chama applyPilotOutboundGuard no próprio send()", () => {
  const implementers = allSourceFiles.filter((file) => readFileSync(file, "utf8").includes("implements EmailProvider"));
  assert(implementers.length >= 2, `esperava pelo menos GmailEmailProvider e FakeEmailProvider, encontrado ${implementers.length}`);
  for (const file of implementers) {
    const source = readFileSync(file, "utf8");
    assert(
      source.includes("applyPilotOutboundGuard("),
      `${path.relative(repoRoot, file)} implementa EmailProvider mas não chama applyPilotOutboundGuard — bypass possível`
    );
  }
});

check("bypass 2/4 — nenhum arquivo fora de gmail-email-provider.ts chama a API real do Gmail (gmail.users.messages.send)", () => {
  const offenders = allSourceFiles.filter((file) => {
    const base = path.basename(file);
    // Exclui este próprio script de teste: ele referencia a string
    // "gmail.users.messages.send(" em código de verificação/mensagens
    // de assert, nunca chama a API de verdade.
    if (base === "gmail-email-provider.ts" || base === "test-pilot-outbound-guard.mjs") return false;
    return readFileSync(file, "utf8").includes("gmail.users.messages.send(");
  });
  assert(offenders.length === 0, `chamada direta à API do Gmail fora do provider autorizado: ${offenders.map((f) => path.relative(repoRoot, f)).join(", ")}`);

  const authorizedCount = (readFileSync(path.join(repoRoot, "apps/web/lib/email/gmail-email-provider.ts"), "utf8").match(/gmail\.users\.messages\.send\(/g) ?? []).length;
  assert(authorizedCount === 1, `esperava exatamente 1 chamada real em gmail-email-provider.ts, encontrado ${authorizedCount}`);
});

check("bypass 3/4 — se SendEmailInput ganhar cc/bcc no futuro, o guard precisa referenciá-los (tripwire contra regressão silenciosa)", () => {
  const emailProviderSource = readSource("apps/web/lib/email/email-provider.ts");
  const hasCcOrBccField = /\bcc\??:\s*string/.test(emailProviderSource) || /\bbcc\??:\s*string/.test(emailProviderSource);
  const guardSource = readSource("apps/web/lib/email/pilot-outbound-guard.ts");
  if (hasCcOrBccField) {
    assert(/\bcc\b/.test(guardSource) && /\bbcc\b/.test(guardSource), "SendEmailInput ganhou cc/bcc mas pilot-outbound-guard.ts não os referencia — atualize o guard antes de prosseguir");
  }
  // Sempre verdadeiro hoje (defesa já implementada preventivamente):
  assert(guardSource.includes("delete guarded.cc") && guardSource.includes("delete guarded.bcc"), "guard deveria já remover cc/bcc defensivamente, mesmo antes de existirem no tipo");
});

check("bypass 4/4 — nenhum arquivo de PRODUÇÃO fora de gmail-email-provider.ts chama buildMimeMessage (construção direta do MIME sem guard)", () => {
  // Scripts test-*.mjs (testes unitários puros do construtor de MIME, ex.:
  // test-acc-email-branding.mjs) e generate-*.mjs (geradores de prévia
  // estável, ex.: generate-alert-email-preview.mjs — grava só em disco,
  // nunca chama provider.send/rede) podem chamar buildMimeMessage()
  // diretamente — isso nunca envia nada (retorna só uma string) e não é
  // um bypass real, porque o bypass 2/4 já garante que
  // gmail.users.messages.send só existe dentro de gmail-email-provider.ts.
  // Aqui o que importa é nenhum arquivo de código de PRODUÇÃO (fora de
  // scripts/test-*.mjs e scripts/generate-*.mjs) montar MIME sem guard.
  const offenders = allSourceFiles.filter((file) => {
    const base = path.basename(file);
    if (base === "gmail-email-provider.ts" || base === "mime-message.ts") return false;
    if (base.startsWith("test-") || base.startsWith("generate-")) return false;
    return /\bbuildMimeMessage\(/.test(readFileSync(file, "utf8"));
  });
  assert(offenders.length === 0, `construção de MIME fora do provider autorizado: ${offenders.map((f) => path.relative(repoRoot, f)).join(", ")}`);
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
