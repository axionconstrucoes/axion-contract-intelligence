// Correção de layout/apresentação do e-mail de Alerta de Contrato,
// motivada pelo primeiro envio real em modo piloto:
//   1. corpo estreito demais -> max-width ~820px, duas colunas
//   2. logo ACC ausente -> outputFileTracingIncludes (asset não
//      rastreado pelo build serverless da Vercel)
//   3. links de evidência gmail:// quebrados -> HTTPS + âncora estável
//   4. botões em coluna vertical à direita, título/legenda sempre
//      visível (sem depender de hover), fallback mobile
//
// A segunda rodada pós-piloto (mojibake, logo no cabeçalho, tipografia,
// confronto contratual estruturado com justificativa obrigatória,
// evidências RECEBIDA/ENVIADA, nome real do revisor) está em
// scripts/test-alert-email-mime-confront-evidence.mjs — não duplicada
// aqui.
//
// Puro/estrutural, sem stack Supabase local disponível neste ambiente
// (sem Docker) — mesmo padrão de scripts/test-email-actions.mjs e
// scripts/test-alert-recipient-selection.mjs: lógica pura executada de
// verdade quando possível, checagens estruturais no código-fonte quando
// exigem I/O real (banco) que não está disponível aqui.
//
// Uso:
//   node scripts/test-alert-email-layout-evidence-links.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
function readSource(relativePath) {
  // Normaliza CRLF -> LF (Windows/core.autocrlf): as verificações multilinha usam LF.
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));
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
console.log("ALERTA DE CONTRATO — layout/logo/evidências/aprovador (pós-piloto)");
console.log("======================================");
console.log("");

const { buildContractAlertEmail } = await import("../apps/web/lib/email/templates/contract-alert-template.ts");
const { renderEmailActionButtonsHtml, renderEmailActionButtonsText } = await import(
  "../apps/web/lib/email-actions/render-buttons.ts"
);
const { EMAIL_ALERT_ACTION_DESCRIPTIONS, EMAIL_ALERT_ACTION_TYPES } = await import(
  "../apps/web/lib/email-actions/types.ts"
);
const { evidenceAnchorId } = await import("../apps/web/lib/ledger/evidence-anchor.ts");
const { ACC_EMAIL_LOGO_CID, buildAccEmailSignatureHtml } = await import(
  "../apps/web/lib/email/branding/acc-email-signature.ts"
);
const { buildMimeMessage } = await import("../apps/web/lib/email/mime-message.ts");

const baseAlertInput = {
  recipientName: "Bruna",
  projectName: "WEG Fábrica de Arames",
  severity: "ALTA",
  title: "Possível atraso na entrega da estrutura",
  summary: "O cliente notificou atraso de 20 dias.",
  relatedEventTitle: "Notificação de atraso — 05/01/2026",
  contractualBasis: "Cláusula 5.2 — Prazo de execução",
  confrontationBlocks: [],
  hasInlineLogo: false,
  keyEvidence: [
    {
      kind: "OTHER",
      url: "https://app.axion.com.br/proj-1/ledger/evt-1#evidencia-ev-1",
      sourceTypeLabel: "Diário de Obra",
      label: "Notificação de Atraso Contratual",
    },
    "Evidência sem link (compatibilidade — texto simples)",
  ],
  potentialImpact: "Impacto Potencial",
  recommendedAction: null,
  responsibleName: null,
  dueDate: null,
  eventUrl: "https://app.axion.com.br/proj-1/ledger/evt-1",
  actionButtons: [
    { action: "ACKNOWLEDGE", url: "https://app.axion.com.br/email-actions/tok-ack" },
    { action: "RESPOND", url: "https://app.axion.com.br/email-actions/tok-respond" },
  ],
};

// ---------- 1. sem href gmail:// / evidências HTTPS + âncora ----------

check("evidenceAnchorId: âncora estável e única, mesma convenção usada na página e no e-mail", () => {
  assert(evidenceAnchorId("ev-1") === "evidencia-ev-1");
  assert(evidenceAnchorId("ev-2") !== evidenceAnchorId("ev-1"), "âncoras de evidências diferentes precisam ser diferentes");
});

check("HTML do e-mail NUNCA contém href=\"gmail://...\"", () => {
  const { html } = buildContractAlertEmail(baseAlertInput);
  assert(!/href="gmail:\/\//i.test(html), "href gmail:// não pode existir no HTML do e-mail");
  assert(!/href='gmail:\/\//i.test(html), "href gmail:// (aspas simples) não pode existir no HTML do e-mail");
});

check("evidência com url vira <a href=https> apontando para a âncora do evento (nunca texto solto auto-linkificável)", () => {
  const { html } = buildContractAlertEmail(baseAlertInput);
  assert(
    html.includes('href="https://app.axion.com.br/proj-1/ledger/evt-1#evidencia-ev-1"'),
    "href HTTPS da evidência ausente ou incorreto"
  );
  assert(html.includes("Notificação de Atraso Contratual"), "rótulo da evidência ausente");
});

check("evidência em texto simples (sem url, compatibilidade) continua renderizando como antes, sem virar link quebrado", () => {
  const { html } = buildContractAlertEmail(baseAlertInput);
  assert(html.includes("Evidência sem link (compatibilidade — texto simples)"));
  assert(
    !new RegExp(`<a[^>]*>Evidência sem link`).test(html),
    "evidência sem url não deveria ser envolvida por <a>"
  );
});

check("versão texto do e-mail também nunca expõe gmail://", () => {
  const { text } = buildContractAlertEmail(baseAlertInput);
  assert(!/gmail:\/\//i.test(text), "texto puro não pode conter gmail://");
  assert(text.includes("https://app.axion.com.br/proj-1/ledger/evt-1#evidencia-ev-1"));
});

check("send-alert-actions.ts: constrói keyEvidence com evidenceAnchorId + eventUrl, nunca embutindo e.locator (gmail://...) no link", () => {
  const source = readSource("apps/web/app/[projectId]/ledger/[eventId]/send-alert-actions.ts");
  assert(source.includes('import { evidenceAnchorId } from "@/lib/ledger/evidence-anchor";'));
  assert(source.includes("evidenceAnchorId(e.id)"));
  assert(source.includes("`${eventUrl}#${evidenceAnchorId(e.id)}`"));
  // O localizador só é PASSADO ao construtor de links (que apenas extrai um número de página explícito);
  // nunca é concatenado em URL — ver scripts/test-alert-box-templates.mjs (localizador gmail:// nunca vaza).
  const locatorUses = source.match(/e\.locator/g) ?? [];
  assert(locatorUses.length === 1 && /locator: e\.locator \?\? null,/.test(source) && source.includes("buildEvidenceItem({"), "e.locator só entra como parâmetro de buildEvidenceItem");
});

check("EvidenceViewer: renderiza id=evidenceAnchorId(evidence.id) — a página do evento expõe as âncoras que o e-mail referencia", () => {
  const source = readSource("apps/web/components/ledger/evidence-viewer.tsx");
  assert(source.includes('import { evidenceAnchorId } from "@/lib/ledger/evidence-anchor";'));
  assert(source.includes("id={evidence.id ? evidenceAnchorId(evidence.id) : undefined}"));
});

// ---------- 2. logo ACC (causa real: asset não rastreado pelo build) ----------

check("next.config.ts: outputFileTracingIncludes garante explicitamente que public/branding/acc-logo.png entra no bundle serverless (hardening documentado contra a classe de bug de asset ausente na Vercel)", () => {
  const source = readSource("apps/web/next.config.ts");
  assert(source.includes("outputFileTracingIncludes"));
  assert(source.includes("public/branding/acc-logo.png"));
});

check("Content-ID do MIME e cid: do HTML da assinatura são EXATAMENTE o mesmo valor (ACC_EMAIL_LOGO_CID, fonte única)", () => {
  const signatureHtml = buildAccEmailSignatureHtml(true);
  const cidMatch = signatureHtml.match(/cid:([^"]+)"/);
  assert(cidMatch, "cid: não encontrado no HTML da assinatura");
  const cidInHtml = cidMatch[1];

  const raw = buildMimeMessage(
    {
      to: "cliente@exemplo.com",
      subject: "Assunto",
      text: "Texto.",
      html: "<p>HTML.</p>",
      inlineImages: [{ cid: ACC_EMAIL_LOGO_CID, filename: "acc-logo.png", mimeType: "image/png", contentBase64: "aGVsbG8=" }],
      correlationId: "corr-cid-match",
    },
    "reynaldo@axion.com.br",
    "<corr-cid-match@axion.com.br>"
  );
  const contentIdMatch = raw.match(/Content-ID: <([^>]+)>/);
  assert(contentIdMatch, "header Content-ID não encontrado no MIME");
  const cidInMime = contentIdMatch[1];

  assert(cidInHtml === ACC_EMAIL_LOGO_CID, `cid: do HTML (${cidInHtml}) deveria ser ACC_EMAIL_LOGO_CID`);
  assert(cidInMime === ACC_EMAIL_LOGO_CID, `Content-ID do MIME (${cidInMime}) deveria ser ACC_EMAIL_LOGO_CID`);
  assert(cidInHtml === cidInMime, `cid: do HTML ("${cidInHtml}") e Content-ID do MIME ("${cidInMime}") precisam corresponder exatamente`);
});

// ---------- 3. "APROVADO POR <NOME>" — ver test-alert-email-mime-confront-evidence.mjs (buildConfrontationBlock, reviewer resolution) ----------

// ---------- 4. layout: largura, colunas, botões verticais, fallback mobile ----------

const templateSource = readSource("apps/web/lib/email/templates/contract-alert-template.ts");

check("largura ampliada: max-width do cartão principal entre 800 e 860px (era 600px fixo) — distinto do breakpoint do @media mobile", () => {
  const match = templateSource.match(/width:100%;max-width:\s*(\d+)px/);
  assert(match, "max-width do cartão principal não encontrado no template");
  const value = Number(match[1]);
  assert(value >= 800 && value <= 860, `max-width ${value}px fora da faixa 800-860px pedida`);
  assert(!/width="600"/.test(templateSource), "a largura fixa antiga de 600px não deveria mais existir");
});

check("estrutura principal usa <table> (Gmail/Outlook) — não depende só de flex/grid", () => {
  assert(!/display:\s*flex/.test(templateSource), "não deveria usar display:flex na estrutura do e-mail");
  assert(!/display:\s*grid/.test(templateSource), "não deveria usar display:grid na estrutura do e-mail");
  assert((templateSource.match(/<table/g) ?? []).length >= 4, "estrutura deveria continuar baseada em múltiplas <table>");
});

check("duas colunas no desktop: coluna de conteúdo à esquerda e coluna ESTREITA e branca dos botões à direita", () => {
  assert(templateSource.includes('class="acc-content-col"'));
  assert(templateSource.includes('class="acc-actions-col"'));
  const { html } = buildContractAlertEmail({
    ...baseAlertInput,
    quickActionUrls: {
      RESOLVIDO: "https://app.axion.com.br/alertas/acao/p/b/e?acao=RESOLVIDO",
      EM_ANDAMENTO: "https://app.axion.com.br/alertas/acao/p/b/e?acao=EM_ANDAMENTO",
      ENVIADO_PARA: "https://app.axion.com.br/alertas/acao/p/b/e?acao=ENVIADO_PARA",
    },
  });
  assert(html.indexOf('class="acc-content-col"') < html.indexOf('class="acc-actions-col"'), "coluna de conteúdo deveria vir antes (à esquerda) da coluna de ações no HTML");
  assert(/class="acc-actions-panel"[^>]*bgcolor="#FFFFFF"/.test(html), "coluna dos botões branca");
});

check("mobile: media query empilha as colunas e ocupa largura total (não depende de JS)", () => {
  assert(/@media only screen and \(max-width:\s*\d+px\)/.test(templateSource));
  assert(/\.acc-content-col,\s*\.acc-actions-col\s*\{[^}]*display:block !important;[^}]*width:100% !important;/.test(templateSource));
  assert(!/<script/i.test(templateSource), "e-mail nunca pode conter <script>");
});

check("texto/tabelas quebram sem overflow: word-break:break-word nos elementos de texto principais", () => {
  const occurrences = (templateSource.match(/word-break:break-word/g) ?? []).length;
  assert(occurrences >= 3, `esperado word-break:break-word em pelo menos 3 pontos, encontrado ${occurrences}`);
});

check("nenhum <script> em nenhum template de e-mail (contract-alert e sla-escalation)", () => {
  const slaSource = readSource("apps/web/lib/email/templates/sla-escalation-template.ts");
  assert(!/<script/i.test(templateSource));
  assert(!/<script/i.test(slaSource));
});

// ---------- 5. botões: mantém ações/tokens, título/legenda sempre visível ----------

check("renderEmailActionButtonsHtml: cada botão vira bloco de largura 100% (pilha vertical), nunca inline-block lado a lado", () => {
  const html = renderEmailActionButtonsHtml(baseAlertInput.actionButtons);
  assert(html.includes("display:block;width:100%"), "botões deveriam ser display:block;width:100% para empilhar verticalmente");
  assert(!html.includes("display:inline-block"), "não deveria mais usar display:inline-block (lado a lado)");
});

check("renderEmailActionButtonsHtml: title/aria-label descritivos em cada botão + legenda SEMPRE visível (não depende de hover)", () => {
  const html = renderEmailActionButtonsHtml(baseAlertInput.actionButtons);
  for (const action of ["ACKNOWLEDGE", "RESPOND"]) {
    const description = EMAIL_ALERT_ACTION_DESCRIPTIONS[action];
    assert(html.includes(`title="${description}"`), `title descritivo ausente para ${action}`);
    assert(html.includes(description), `legenda visível (não-hover) ausente para ${action}`);
  }
  assert(html.includes('aria-label="'), "aria-label ausente");
});

check("EMAIL_ALERT_ACTION_DESCRIPTIONS cobre as 4 ações do MVP, sem string vazia", () => {
  for (const action of EMAIL_ALERT_ACTION_TYPES) {
    assert(typeof EMAIL_ALERT_ACTION_DESCRIPTIONS[action] === "string" && EMAIL_ALERT_ACTION_DESCRIPTIONS[action].length > 0);
  }
});

check("renderEmailActionButtonsHtml continua exatamente 1 <a> por botão — nenhum link extra introduzido pela legenda", () => {
  const html = renderEmailActionButtonsHtml(baseAlertInput.actionButtons);
  assert((html.match(/<a /g) ?? []).length === 2, "deveria continuar exatamente 1 <a> por botão");
});

check("renderEmailActionButtonsText permanece IDÊNTICO ('RÓTULO: url', sem legenda) — fallback de texto puro não muda", () => {
  const text = renderEmailActionButtonsText([{ action: "SET_DEADLINE", url: "https://app.axion.com.br/email-actions/tok3" }]);
  assert(text === "DEFINIR PRAZO: https://app.axion.com.br/email-actions/tok3", `formato do texto puro não pode mudar, obtido: "${text}"`);
});

// DEFINIÇÃO FINAL: o TÍTULO do alerta é o link do evento (substitui o botão "Abrir evento no ACC").
check("o TÍTULO do alerta é o link para o evento no ACC, com title descritivo", () => {
  const { html } = buildContractAlertEmail(baseAlertInput);
  assert(/<a href="https:\/\/app\.axion\.com\.br\/proj-1\/ledger\/evt-1"[^>]*title="Abrir o evento no ACC"/.test(html), "título deveria ser link do evento");
  assert(!html.includes("Abrir evento no ACC"), "botão separado removido");
});

check("as 5 ações exigidas continuam presentes e com a MESMA url/token (nada de autorização/expiração/uso único alterado aqui)", () => {
  const { html, text } = buildContractAlertEmail(baseAlertInput);
  assert(html.includes(baseAlertInput.eventUrl), "link do evento (título)");
  assert(html.includes("DAR CIÊNCIA") && html.includes("tok-ack"));
  assert(html.includes("RESPONDER AO ACC") && html.includes("tok-respond"));
  assert(text.includes("DAR CIÊNCIA: https://app.axion.com.br/email-actions/tok-ack"));
  assert(text.includes("RESPONDER AO ACC: https://app.axion.com.br/email-actions/tok-respond"));
});

check("issueEmailAlertActionButtons (autorização/expiração/uso único/auditoria/guard de piloto) não foi tocado por esta correção de layout", () => {
  const issueTokensSource = readSource("apps/web/lib/email-actions/issue-tokens.ts");
  const confirmSource = readSource("apps/web/lib/email-actions/confirm-action.ts");
  assert(issueTokensSource.includes("resolveEffectiveRecipient"), "issue-tokens.ts deveria continuar usando a fonte única do guard de piloto");
  assert(confirmSource.includes("hashEmailActionToken"), "confirm-action.ts deveria continuar hasheando o token");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
