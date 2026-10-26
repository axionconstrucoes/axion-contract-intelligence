// Testes estruturais dos templates REAIS de alerta (individual e lote) após a
// definição final de cabeçalho/cores/bordas/botões. A medição de pixels no
// navegador é feita à parte (captura CDP); aqui validamos o HTML gerado.
//
// Uso: node scripts/test-alert-box-templates.mjs

import assert from "node:assert/strict";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { buildContractAlertEmail } = await import("../apps/web/lib/email/templates/contract-alert-template.ts");
const { buildContractAlertBatchEmail } = await import("../apps/web/lib/email/templates/contract-alert-batch-template.ts");
const style = await import("../apps/web/lib/email/templates/alert-box-style.ts");
const policy = await import("../apps/web/lib/alerts/repeat-policy.ts");

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

const SEVERITIES = ["CRITICA", "ALTA", "MEDIA", "BAIXA"];
const WORD = { CRITICA: "CRÍTICO", ALTA: "ALTO", MEDIA: "MÉDIO", BAIXA: "BAIXO" };
const BASE = "https://acc.exemplo.invalid";

function individual(severity, extra = {}) {
  return buildContractAlertEmail({
    recipientName: "Ana Souza",
    projectName: "NEWPORT - Galpão C100",
    severity,
    title: "Título do evento",
    summary: "Resumo do alerta.",
    relatedEventTitle: "Evento relacionado X",
    contractualBasis: null,
    confrontationBlocks: [
      {
        clauseNumber: "8.2",
        eventFinding: "achado",
        contractProvision: "provisão",
        conclusion: "conclusão",
        potentialImpact: "impacto",
        approvedByLine: "Aprovado por Fulana",
        detailUrl: `${BASE}/c/1`,
      },
    ],
    keyEvidence: [{ kind: "OTHER", url: `${BASE}/e/1`, sourceTypeLabel: "Cronograma", label: "Linha de base" }],
    potentialImpact: "Prazo",
    recommendedAction: null,
    responsibleName: "Bruno Lima",
    dueDate: null,
    eventUrl: `${BASE}/ev/1`,
    actionButtons: [{ action: "ACKNOWLEDGE", url: `${BASE}/email-actions/tok-1` }],
    hasInlineLogo: true,
    hasInlineInvertedLogo: true,
    ...extra,
  });
}

const batchItems = SEVERITIES.map((severity, i) => ({
  eventId: `ev-${i + 1}`,
  title: `Alerta ${severity}`,
  severity,
  riskDescription: `Descrição ${severity}`,
  clauseLabel: "Cláusula 8.2",
  clauseText: "Texto da cláusula",
  evidence: ["Evidência simples"],
  eventUrl: `${BASE}/ev/${i + 1}`,
  respondItemUrl: `${BASE}/lote/1#evento-ev-${i + 1}`,
  quickActionUrl: `${BASE}/alertas/acao/p/1/ev-${i + 1}`,
}));
const batch = buildContractAlertBatchEmail({
  recipientName: "Ana Souza",
  projectName: "NEWPORT - Galpão C100",
  batchUrl: `${BASE}/lote/1`,
  items: batchItems,
  hasInlineLogo: true,
  hasInlineInvertedLogo: true,
});

const boxes = (html) => html.split("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" bgcolor=\"").slice(1);

console.log("");
console.log("======================================");
console.log("CAIXAS DE ALERTA — TEMPLATES");
console.log("======================================");
console.log("");

check("política de repetição: 1/2/4/7 dias (24/48/96/168 h) e textos exatos 'Repete: …'", () => {
  assert.deepEqual(policy.REPEAT_INTERVAL_DAYS, { CRITICA: 1, ALTA: 2, MEDIA: 4, BAIXA: 7 });
  assert.deepEqual(policy.REPEAT_INTERVAL_HOURS, { CRITICA: 24, ALTA: 48, MEDIA: 96, BAIXA: 168 });
  assert.equal(policy.repeatNoticeText("CRITICA"), "Repete: a cada 1 dia até a conclusão.");
  assert.equal(policy.repeatNoticeText("ALTA"), "Repete: a cada 2 dias até a conclusão.");
  assert.equal(policy.repeatNoticeText("MEDIA"), "Repete: a cada 4 dias até a conclusão.");
  assert.equal(policy.repeatNoticeText("BAIXA"), "Repete: a cada 7 dias até a conclusão.");
  assert.equal(policy.inProgressConfirmationNotice("ALTA"), "Este alerta será repetido a cada 2 dias até a conclusão.");
  assert.equal(policy.forwardConfirmationNotice("CRITICA"), "O destinatário receberá este alerta a cada 1 dia até a conclusão.");
});

check("cores por risco: CRÍTICO vermelho/branco, ALTO amarelo escuro/branco, MÉDIO e BAIXO branco/preto", () => {
  const t = style.ALERT_TONES;
  assert.equal(t.CRITICA.background, "#DC2626");
  assert.equal(t.CRITICA.text, "#FFFFFF");
  assert.equal(t.ALTA.background, "#A16207");
  assert.equal(t.ALTA.text, "#FFFFFF");
  for (const s of ["MEDIA", "BAIXA"]) {
    assert.equal(t[s].background, "#FFFFFF");
    assert.equal(t[s].text, "#000000");
    assert.equal(t[s].logo, "maroon");
  }
  for (const s of ["CRITICA", "ALTA"]) assert.equal(t[s].logo, "inverted");
});

check("contraste do texto branco sobre o amarelo escuro do ALTO ≥ 4,5:1 (WCAG AA) e sobre o vermelho do CRÍTICO ≥ 4,5:1", () => {
  const alto = style.contrastRatio("#FFFFFF", style.ALTO_BACKGROUND);
  const crit = style.contrastRatio("#FFFFFF", style.CRITICO_BACKGROUND);
  console.log(`     contraste ALTO (#FFFFFF sobre ${style.ALTO_BACKGROUND}) = ${alto.toFixed(2)}:1 ; CRÍTICO (sobre ${style.CRITICO_BACKGROUND}) = ${crit.toFixed(2)}:1`);
  assert.ok(alto >= 4.5, `contraste ALTO ${alto}`);
  assert.ok(crit >= 4.5, `contraste CRÍTICO ${crit}`);
});

check("bordas: contínua de 2px, mais escura que o fundo nos coloridos e cinza médio nos brancos", () => {
  const t = style.ALERT_TONES;
  assert.ok(style.relativeLuminance(t.CRITICA.border) < style.relativeLuminance(t.CRITICA.background));
  assert.ok(style.relativeLuminance(t.ALTA.border) < style.relativeLuminance(t.ALTA.background));
  assert.equal(t.MEDIA.border, "#9CA3AF");
  assert.equal(t.BAIXA.border, "#9CA3AF");
  for (const s of SEVERITIES) {
    const html = style.buildAlertBoxHtml(s, "x");
    assert.match(html, new RegExp(`border:2px solid ${t[s].border}`));
    assert.match(html, /border-radius:8px/);
  }
});

check("cabeçalho: logo oficial à esquerda, 'RISCO …' na MESMA linha (mesma <tr>), centralizado, negrito, sem selo arredondado", () => {
  for (const s of SEVERITIES) {
    const h = style.buildAlertHeaderHtml(s, WORD[s], { maroon: true, inverted: true });
    assert.equal((h.match(/<tr>/g) ?? []).length, 1, "logo e classificação precisam estar na mesma linha de tabela");
    assert.ok(h.indexOf("<img") < h.indexOf(`RISCO ${WORD[s]}`), "logo antes (à esquerda) da classificação");
    assert.match(h, /valign="middle"[^>]*align="center"[^>]*text-align:center/);
    assert.match(h, /font-weight:bold/);
    assert.ok(!/border-radius:999px/.test(h), "sem selo arredondado");
    assert.ok(!/<br/.test(h));
    const cid = style.ALERT_TONES[s].logo === "inverted" ? "cid:acc-logo-inverted" : "cid:acc-logo-signature";
    assert.ok(h.includes(cid), `logo ${cid} para ${s}`);
    assert.match(h, /width="44" height="44"/);
  }
});

check("sem logo disponível o cabeçalho nunca referencia cid quebrado (só a classificação)", () => {
  const h = style.buildAlertHeaderHtml("CRITICA", "CRÍTICO", { maroon: true, inverted: false });
  assert.ok(!h.includes("cid:"));
  assert.ok(h.includes("RISCO CRÍTICO"));
});

check("e-mail individual: título do evento fica ABAIXO do cabeçalho; sem selo/banner antigo; saudação preservada", () => {
  for (const s of SEVERITIES) {
    const html = individual(s).html;
    assert.ok(html.indexOf(`RISCO ${WORD[s]}`) < html.indexOf("Título do evento"));
    assert.ok(html.includes("Olá, Ana Souza."));
    assert.ok(!html.includes("border-radius:999px"), "sem selo arredondado");
    assert.ok(!html.includes("repeating") && !html.includes("#facc15"), "faixa listrada antiga removida");
  }
});

check("e-mail individual: NÃO exibe 'Responsável' (html e texto) mesmo recebendo responsibleName", () => {
  for (const s of SEVERITIES) {
    const e = individual(s);
    assert.ok(!/Respons[aá]vel/.test(e.html), `html ${s}`);
    assert.ok(!/Respons[aá]vel/.test(e.text), `texto ${s}`);
    assert.ok(!e.html.includes("Bruno Lima") && !e.text.includes("Bruno Lima"));
  }
});

check("conteúdo contratual preservado: confronto, evidências, base, impacto, link do evento e botões com token", () => {
  const e = individual("ALTA");
  for (const needle of ["Confronto contratual — Cláusula 8.2", "achado", "provisão", "conclusão", "Aprovado por Fulana", "Evidências principais", "Linha de base", "Evento relacionado", "Impacto potencial", `${BASE}/ev/1`, `${BASE}/email-actions/tok-1`]) {
    assert.ok(e.html.includes(needle), needle);
  }
});

check("'Repete: …' só no individual quando repeatNotice=true; sempre em cada item do lote; nunca 'Lembrete'", () => {
  assert.ok(!individual("CRITICA").html.includes("Repete:"));
  for (const s of SEVERITIES) {
    const e = individual(s, { repeatNotice: true });
    assert.ok(e.html.includes(policy.repeatNoticeText(s)));
    assert.ok(e.text.includes(policy.repeatNoticeText(s)));
    assert.ok(!/Lembrete/i.test(e.html + e.text));
  }
  for (const s of SEVERITIES) assert.ok(batch.html.includes(policy.repeatNoticeText(s)), s);
  assert.ok(!/Lembrete/i.test(batch.html + batch.text));
});

check("lote: cada alerta tem a PRÓPRIA caixa e cor (quatro caixas; o lote não é pintado pelo mais grave)", () => {
  const parts = boxes(batch.html);
  assert.equal(parts.length, 4);
  const expected = ["#DC2626", "#A16207", "#FFFFFF", "#FFFFFF"];
  parts.forEach((p, i) => assert.ok(p.startsWith(expected[i]), `caixa ${i}: ${p.slice(0, 10)}`));
  assert.ok(batch.html.includes("background-color:#f3f4f6"), "fundo externo neutro");
  assert.ok(batch.html.includes("background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px"), "cartão externo branco");
});

check("lote: vínculos e links corretos por alerta (ver evento, ação por item, responder ao lote)", () => {
  batchItems.forEach((item, i) => {
    for (const a of ["RESOLVIDO", "EM_ANDAMENTO", "ENVIADO_PARA"]) {
      assert.ok(batch.html.includes(`${BASE}/alertas/acao/p/1/ev-${i + 1}?acao=${a}`), `${item.eventId} ${a}`);
    }
    assert.ok(batch.html.includes(`${item.eventUrl}"`));
  });
  assert.ok(batch.html.includes("RESPONDER AO ACC"));
  assert.ok(batch.html.includes("Olá, Ana Souza."));
});

check("botões: largura = texto 'EM ANDAMENTO' + 12px de cada lado; quatro botões com largura/altura idênticas; sem 100%/min-width", () => {
  assert.equal(style.EM_ANDAMENTO_TEXT_WIDTH_PX, 93);
  assert.equal(style.BUTTON_SIDE_PADDING_PX, 12);
  assert.equal(style.BUTTON_WIDTH_PX, 93 + 24);
  const w = style.BUTTON_WIDTH_PX;
  const h = style.BUTTON_HEIGHT_PX;
  const tables = batch.html.match(/<table class="acc-compact-btn"[^>]*>.*?<\/table>/gs) ?? [];
  assert.equal(tables.length, 16, "4 botões × 4 alertas");
  for (const t of tables) {
    assert.match(t, new RegExp(`width="${w}"`));
    assert.match(t, new RegExp(`<td width="${w}" height="${h}"`));
    assert.match(t, new RegExp(`display:block;width:${w}px;height:${h}px;line-height:${h}px;margin:0;padding:0;`));
    assert.ok(!/width:100%|min-width|padding:\d+px \d+px/.test(t), "nada que alargue o botão");
  }
  const labels = [...batch.html.matchAll(/white-space:nowrap;overflow:hidden;">([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(labels)].sort(), ["EM ANDAMENTO", "ENVIADO P/", "RESOLVIDO", "VER EVENTO"]);
});

check("botões: cores e funções preservadas (VER EVENTO amarelo, RESOLVIDO azul-marinho, EM ANDAMENTO verde, ENVIADO P/ laranja)", () => {
  for (const c of ["#FFD600", "#1B2A4A", "#15803D", "#F97316"]) assert.ok(batch.html.includes(`bgcolor="${c}"`), c);
});

check("texto puro do lote traz classificação e 'Repete' por alerta e não traz 'Responsável'", () => {
  assert.ok(batch.text.includes("RISCO CRÍTICO") && batch.text.includes("RISCO BAIXO"));
  assert.ok(!/Respons[aá]vel/.test(batch.text));
  for (const s of SEVERITIES) assert.ok(batch.text.includes(policy.repeatNoticeText(s)));
});

check("e-mail individual não expõe destinatários de outras pessoas", () => {
  const e = individual("MEDIA");
  const body = e.html.replace(/<style>.*?<\/style>/s, "").replace(/https?:\/\/[^"\s<]+/g, "");
  assert.ok(!/@/.test(body), "nenhum endereço de e-mail solto no corpo");
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
