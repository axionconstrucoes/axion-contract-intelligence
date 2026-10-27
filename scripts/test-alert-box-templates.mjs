// Testes estruturais dos templates REAIS de alerta (individual e lote) — definição final de
// cabeçalho "RISCO | OBRA", cores, bordas, tipografia única, título-link, cláusula, evidência e
// três botões. A medição de pixels no navegador é feita à parte (captura CDP); aqui validamos o
// HTML gerado.
//
// Uso: node scripts/test-alert-box-templates.mjs

import assert from "node:assert/strict";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const sub = await import("../apps/web/lib/email/templates/contract-alert-template.ts");
const { buildContractAlertEmail } = sub;
const { buildContractAlertBatchEmail, buildContractAlertBatchSubject } = await import("../apps/web/lib/email/templates/contract-alert-batch-template.ts");
const style = await import("../apps/web/lib/email/templates/alert-box-style.ts");
const policy = await import("../apps/web/lib/alerts/repeat-policy.ts");
const grouping = await import("../apps/web/lib/alerts/batch-grouping.ts");
const pilot = await import("../apps/web/lib/email/pilot-outbound-guard.ts");
const links = await import("../apps/web/lib/alerts/alert-source-links.ts");

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
const QUICK = {
  RESOLVIDO: `${BASE}/alertas/acao/p/b/e?acao=RESOLVIDO`,
  EM_ANDAMENTO: `${BASE}/alertas/acao/p/b/e?acao=EM_ANDAMENTO`,
  ENVIADO_PARA: `${BASE}/alertas/acao/p/b/e?acao=ENVIADO_PARA`,
};

function individual(severity, extra = {}) {
  return buildContractAlertEmail({
    recipientName: "Ana Souza",
    projectName: "NEWPORT - Galpão C100 — Goiânia · 0079",
    severity,
    title: "Título do evento",
    summary: "Descrição do alerta.",
    relatedEventTitle: "Evento relacionado X",
    contractualBasis: null,
    confrontationBlocks: [
      { clauseNumber: "8.2", eventFinding: "achado", contractProvision: "provisão", conclusion: "conclusão", potentialImpact: "impacto", approvedByLine: "Aprovado por Fulana", detailUrl: `${BASE}/c/1` },
    ],
    impactedClause: { label: "Cláusula 8.2 – Prazos e Cronograma", text: "Texto da cláusula." },
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

const PROJECT_A = "NEWPORT - Galpão C100 — Goiânia · 0079";
const PROJECT_B = "Edifício Mirante — Campinas · 0112";
const projects = [PROJECT_A, PROJECT_A, PROJECT_A, PROJECT_A];
const batchItems = SEVERITIES.map((severity, i) => ({
  eventId: `ev-${i + 1}`,
  projectName: projects[i],
  title: `Alerta ${severity}`,
  severity,
  riskDescription: `Descrição ${severity}`,
  clauseLabel: i < 3 ? "Cláusula 8.2 – Prazos e Cronograma" : null,
  clauseText: i < 2 ? "Texto da cláusula" : null,
  evidence: i === 3 ? [] : [{ kind: "OTHER", url: `${BASE}/e/${i}`, sourceTypeLabel: "Cronograma", label: "Linha de base" }],
  eventUrl: `${BASE}/ev/${i + 1}`,
  respondItemUrl: `${BASE}/lote/1#evento-ev-${i + 1}`,
  quickActionUrl: `${BASE}/alertas/acao/p/1/ev-${i + 1}`,
}));
const batch = buildContractAlertBatchEmail({
  recipientName: "Ana Souza",
  projectName: "Obra padrão",
  batchUrl: `${BASE}/lote/1`,
  items: batchItems,
  hasInlineLogo: true,
  hasInlineInvertedLogo: true,
});

const boxes = (html) => html.split('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="').slice(1);

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
});

check("cores por risco (semáforo): CRÍTICO vermelho/branco/logo invertido; ALTO amarelo/preto/logo vinho; MÉDIO e BAIXO branco/preto/logo vinho", () => {
  const t = style.ALERT_TONES;
  assert.equal(t.CRITICA.background, "#CC0000");
  assert.equal(t.CRITICA.text, "#FFFFFF");
  assert.equal(t.CRITICA.logo, "inverted");
  assert.equal(t.ALTA.background, "#FFC700");
  assert.equal(t.ALTA.text, "#000000");
  assert.equal(t.ALTA.logo, "maroon");
  for (const s of ["MEDIA", "BAIXA"]) {
    assert.equal(t[s].background, "#FFFFFF");
    assert.equal(t[s].text, "#000000");
    assert.equal(t[s].logo, "maroon");
  }
});

check("contraste: branco sobre o vermelho do CRÍTICO e preto sobre o amarelo do ALTO ≥ 4,5:1 (WCAG AA); links e rótulos idem", () => {
  const crit = style.contrastRatio("#FFFFFF", style.CRITICO_BACKGROUND);
  const alto = style.contrastRatio("#000000", style.ALTO_BACKGROUND);
  console.log(`     contraste CRÍTICO (#FFFFFF sobre ${style.CRITICO_BACKGROUND}) = ${crit.toFixed(2)}:1 ; ALTO (#000000 sobre ${style.ALTO_BACKGROUND}) = ${alto.toFixed(2)}:1`);
  assert.ok(crit >= 4.5, `contraste CRÍTICO ${crit}`);
  assert.ok(alto >= 4.5, `contraste ALTO ${alto}`);
  for (const s of SEVERITIES) {
    const tone = style.ALERT_TONES[s];
    for (const c of [tone.text, tone.muted, tone.link, tone.label]) assert.ok(style.contrastRatio(c, tone.background) >= 4.5, `${s} ${c}`);
  }
});

check("bordas: contínua de 2px, mais escura que o fundo nos coloridos e cinza médio nos brancos; cantos arredondados", () => {
  const t = style.ALERT_TONES;
  assert.ok(style.relativeLuminance(t.CRITICA.border) < style.relativeLuminance(t.CRITICA.background));
  assert.ok(style.relativeLuminance(t.ALTA.border) < style.relativeLuminance(t.ALTA.background));
  assert.equal(t.MEDIA.border, "#9CA3AF");
  for (const s of SEVERITIES) {
    const html = style.buildAlertBoxHtml(s, "x");
    assert.match(html, new RegExp(`border:2px solid ${t[s].border}`));
    assert.match(html, /border-radius:8px/);
  }
});

check("cabeçalho: logo à esquerda e 'RISCO [NÍVEL] | [OBRA]' na MESMA linha (mesma <tr>), centralizado e em negrito, sem selo arredondado", () => {
  for (const s of SEVERITIES) {
    const h = style.buildAlertHeaderHtml(s, WORD[s], "Obra Teste", { maroon: true, inverted: true });
    assert.equal((h.match(/<tr>/g) ?? []).length, 1, "logo e classificação na mesma linha de tabela");
    assert.ok(h.indexOf("<img") < h.indexOf(`RISCO ${WORD[s]} | Obra Teste`), "logo antes (à esquerda) do texto");
    assert.match(h, /valign="middle"[^>]*align="center"[^>]*text-align:center/);
    assert.match(h, /font-weight:700/);
    assert.ok(!/border-radius:999px/.test(h) && !/<br/.test(h));
    const cid = style.ALERT_TONES[s].logo === "inverted" ? "cid:acc-logo-inverted" : "cid:acc-logo-signature";
    assert.ok(h.includes(cid), `logo ${cid} para ${s}`);
    assert.match(h, /width="44" height="44"/);
  }
});

check("cabeçalho: nome de obra longo QUEBRA linha dentro da célula (sem sobrepor o logo) e é escapado", () => {
  const long = "Complexo Industrial & Logístico <Grande> ".repeat(6);
  const h = style.buildAlertHeaderHtml("MEDIA", "MÉDIO", long, { maroon: true, inverted: true });
  assert.match(h, /word-break:break-word;overflow-wrap:anywhere/);
  assert.ok(h.includes("Complexo Industrial &amp; Logístico &lt;Grande&gt;"));
  assert.ok(h.indexOf("<img") < h.indexOf("RISCO MÉDIO"));
});

check("sem logo disponível o cabeçalho nunca referencia cid quebrado (só o texto)", () => {
  const h = style.buildAlertHeaderHtml("CRITICA", "CRÍTICO", "Obra", { maroon: true, inverted: false });
  assert.ok(!h.includes("cid:"));
  assert.ok(h.includes("RISCO CRÍTICO | Obra"));
});

check("OBRA: um e-mail por obra; cada caixa mostra RISCO [NÍVEL] | [OBRA] com a obra do alerta; sem obra própria usa a padrão", () => {
  for (const item of batchItems) assert.ok(batch.html.includes(`RISCO ${WORD[item.severity]} | ${item.projectName}`), item.projectName);
  const noProject = buildContractAlertBatchEmail({ recipientName: null, projectName: "Obra padrão", batchUrl: `${BASE}/l`, hasInlineLogo: true, items: [{ ...batchItems[0], projectName: undefined }] });
  assert.ok(noProject.html.includes("RISCO CRÍTICO | Obra padrão"));
  assert.ok(batch.text.includes(`RISCO ALTO | ${PROJECT_A}`));
});

check("ASSUNTO: crítico -> '[RISCO CRÍTICO] OBRA | N alertas | ACC'; sem crítico e com alto -> '[RISCO ALTO] …'; só médio/baixo -> 'OBRA | N alertas | ACC' sem risco", () => {
  const at = (sevs) => buildContractAlertBatchSubject("Obra padrão", batchItems.filter((it) => sevs.includes(it.severity)));
  assert.equal(at(["CRITICA", "ALTA", "MEDIA", "BAIXA"]), `[RISCO CRÍTICO] ${PROJECT_A} | 4 alertas | ACC`);
  assert.equal(at(["CRITICA"]), `[RISCO CRÍTICO] ${PROJECT_A} | 1 alerta | ACC`);
  assert.equal(at(["ALTA", "MEDIA", "BAIXA"]), `[RISCO ALTO] ${PROJECT_A} | 3 alertas | ACC`);
  assert.equal(at(["MEDIA", "BAIXA"]), `${PROJECT_A} | 2 alertas | ACC`);
  assert.equal(at(["BAIXA"]), `${PROJECT_A} | 1 alerta | ACC`);
  for (const sevs of [["MEDIA", "BAIXA"], ["MEDIA"], ["BAIXA"]]) assert.ok(!/RISCO|CRÍTICO|ALTO|MÉDIO|BAIXO/i.test(at(sevs)), `sem risco no assunto: ${at(sevs)}`);
  assert.equal(batch.subject, `[RISCO CRÍTICO] ${PROJECT_A} | 4 alertas | ACC`);
});

check("lote só com MÉDIO e BAIXO: assunto sem risco, caixas brancas, cada alerta com o próprio risco no corpo", () => {
  const only = buildContractAlertBatchEmail({ recipientName: "Ana", projectName: "Obra padrão", batchUrl: `${BASE}/lote/2`, hasInlineLogo: true, items: batchItems.filter((it) => it.severity === "MEDIA" || it.severity === "BAIXA") });
  assert.equal(only.subject, `${PROJECT_A} | 2 alertas | ACC`);
  assert.ok(only.html.includes("RISCO MÉDIO |") && only.html.includes("RISCO BAIXO |"));
  assert.ok(!only.html.includes("#CC0000") && !only.html.includes("#FFC700"));
});

check("NUNCA mistura obras: dois projetos para o mesmo destinatário geram DOIS e-mails separados, cada um com o assunto correto; misturar é recusado", () => {
  const mk = (project, sev, n) => ({ ...batchItems[0], eventId: `x${n}`, projectName: project, severity: sev, title: `T${n}`, eventUrl: `${BASE}/ev/${n}`, respondItemUrl: `${BASE}/l#e${n}`, quickActionUrl: `${BASE}/a/${n}` });
  const all = [mk(PROJECT_A, "ALTA", 1), mk(PROJECT_B, "MEDIA", 2), mk(PROJECT_A, "BAIXA", 3), mk(PROJECT_B, "CRITICA", 4)];
  // agrupamento do produtor: (projeto, destinatário)
  const groups = grouping.groupByProjectAndRecipient(all.map((it) => ({ projectId: it.projectName, recipientId: "ana", item: it })));
  assert.equal(groups.length, 2);
  const mails = groups.map((g) => buildContractAlertBatchEmail({ recipientName: "Ana", projectName: g.projectId, batchUrl: `${BASE}/lote`, hasInlineLogo: true, items: g.items.map((x) => x.item) }));
  assert.deepEqual(mails.map((m) => m.subject).sort(), [`[RISCO ALTO] ${PROJECT_A} | 2 alertas | ACC`, `[RISCO CRÍTICO] ${PROJECT_B} | 2 alertas | ACC`].sort());
  for (const m of mails) {
    const names = [PROJECT_A, PROJECT_B].filter((n) => m.html.includes(`| ${n}`));
    assert.equal(names.length, 1, "cada e-mail traz uma única obra");
  }
  assert.throws(() => buildContractAlertBatchEmail({ recipientName: null, projectName: "x", batchUrl: `${BASE}/l`, hasInlineLogo: true, items: all }), /não pode misturar obras/);
});

check("TIPOGRAFIA: corpo padrão único de 14px; SÓ o cabeçalho 'RISCO | OBRA' (negrito) e o título (black) usam corpo maior (16px)", () => {
  const first = boxes(batch.html)[0];
  const sizes = new Set(Array.from(first.matchAll(/font-size:(\d+px)/g)).map((m) => m[1]));
  assert.deepEqual([...sizes].sort(), ["14px", "16px"]);
  assert.ok(/class="acc-box-risk"[^>]*font-size:16px[^>]*font-weight:700/.test(first) || /class="acc-box-risk"[^>]*font-weight:700[^>]*font-size:16px/.test(first), "cabeçalho 16px negrito");
  assert.ok(/<a [^>]*font-size:16px[^>]*font-weight:700|<a [^>]*font-weight:700[^>]*font-size:16px/.test(first), "título 16px negrito");
  const rest = first.replace(/class="acc-box-risk"[^>]*>[^<]*/, "").replace(/<p style="margin:0 0 8px 0;[^"]*font-size:16px[^"]*"><a [^>]*>[^<]*<\/a><\/p>/, "");
  assert.ok(!/font-size:16px/.test(rest.replace(/<style[\s\S]*?<\/style>/g, "")) , "demais textos continuam em 14px");
  assert.ok(!/font-weight:\s*(800|900)|Arial Black/.test(first), "nenhum peso black/900 nem Arial Black no alerta");
  assert.ok(/<a [^>]*font-weight:700[^>]*>Alerta CRITICA<\/a>/.test(first), "título é link");
  assert.ok(/font-weight:400;color:#FFFFFF;[^"]*">Descrição CRITICA/.test(first), "descrição regular");
  assert.ok(/font-weight:700;color:#FFFFFF;[^"]*">Cláusula 8\.2 – Prazos e Cronograma</.test(first), "cláusula em negrito");
  assert.ok(/font-weight:700;color:#FFFFFF;[^"]*">Repete: a cada 1 dia até a conclusão\.</.test(first), "Repete em negrito");
  assert.ok(/<a [^>]*font-weight:700[^>]*>Cronograma: Linha de base<\/a>/.test(first), "evidência (link) em negrito");
  const ind = individual("MEDIA", { repeatNotice: true }).html;
  const indBox = ind.slice(ind.indexOf("border:2px solid"), ind.indexOf('<td style="padding:16px 24px;border-top'));
  assert.deepEqual([...new Set(Array.from(indBox.matchAll(/font-size:(\d+px)/g)).map((m) => m[1]))].sort(), ["14px", "16px"]);
});

check("o TÍTULO é o link do evento (VER EVENTO não existe mais) — individual e lote", () => {
  for (const html of [batch.html, individual("ALTA").html]) {
    assert.ok(!html.includes("VER EVENTO"));
    assert.ok(!html.includes('bgcolor="#FFD600"'));
  }
  batchItems.forEach((item) => assert.ok(batch.html.includes(`href="${item.eventUrl}"`), item.eventId));
  assert.ok(individual("ALTA").html.includes(`href="${BASE}/ev/1"`));
  assert.ok(!batch.text.includes("VER EVENTO") && !individual("ALTA").text.includes("VER EVENTO"));
});

check("CLÁUSULA: número e título em negrito sem cabeçalho separado; sem referência verificável: 'Pendente de confirmação'", () => {
  assert.ok(!batch.html.includes("Cláusula impactada") && !individual("MEDIA").html.includes("Cláusula impactada"));
  assert.ok(batch.html.includes("Cláusula 8.2 – Prazos e Cronograma"));
  assert.ok(batch.html.includes("Cláusula: Pendente de confirmação"), "item 4 sem cláusula");
  const none = individual("MEDIA", { impactedClause: null, confrontationBlocks: [] });
  assert.ok(none.html.includes("Cláusula: Pendente de confirmação") && none.text.includes("Cláusula: Pendente de confirmação"));
  const derived = individual("MEDIA", { impactedClause: undefined });
  assert.ok(derived.html.includes("Cláusula 8.2"), "sem rótulo informado, usa o confronto aprovado");
});

check("EVIDÊNCIA: link em negrito para a origem; sem referência verificável: 'Pendente de confirmação' (nunca link inventado)", () => {
  const e = individual("MEDIA", { keyEvidence: ["Protocolo 123 (texto livre)", { kind: "OTHER", url: `${BASE}/doc`, sourceTypeLabel: "Contrato", label: "Contrato base (pág. 12)" }] });
  assert.ok(e.html.includes('href="https://acc.exemplo.invalid/doc"'));
  assert.ok(e.html.includes("Contrato: Contrato base (pág. 12)"));
  assert.ok(e.html.includes("Evidência: Protocolo 123 (texto livre) — Pendente de confirmação"));
  assert.ok(!/href="[^"]*Protocolo/.test(e.html), "texto livre nunca vira link");
  const empty = individual("MEDIA", { keyEvidence: [] });
  assert.ok(empty.html.includes("Evidência: Pendente de confirmação") && empty.text.includes("Evidência: Pendente de confirmação"));
});

check("links de origem: documento com página explícita, e-mail por âncora do evento, localizador gmail:// NUNCA vaza, sem id = pendente", () => {
  const base = { baseUrl: `${BASE}/`, projectId: "p1", eventId: "e1", evidenceId: "ev1", documentVersionId: null, emailId: null, locator: null, label: "Rótulo", sourceTypeLabel: "Contrato" };
  const doc = links.buildEvidenceItem({ ...base, documentVersionId: "v1", locator: "pág. 12" });
  assert.equal(doc.url, `${BASE}/p1/documentos/versoes/v1?paginaGlobal=12#original`);
  assert.equal(doc.label, "Rótulo (pág. 12)");
  const noPage = links.buildEvidenceItem({ ...base, documentVersionId: "v1", locator: "cláusula 8.2, seção final" });
  assert.equal(noPage.url, `${BASE}/p1/documentos/versoes/v1`, "sem página explícita abre o documento sem página");
  const mail = links.buildEvidenceItem({ ...base, emailId: "m1", locator: "gmail://account/abc/123" });
  assert.equal(mail.url, `${BASE}/p1/ledger/e1#evidencia-ev1`);
  assert.ok(!JSON.stringify(mail).includes("gmail://"));
  const pending = links.buildEvidenceItem({ ...base, locator: "gmail://x" });
  assert.equal(typeof pending, "string");
  assert.ok(pending.endsWith("Pendente de confirmação") && !pending.includes("gmail://"));
  assert.equal(links.parseEvidencePage("p. 7"), 7);
  assert.equal(links.parseEvidencePage("página 105 do contrato"), 105);
  assert.equal(links.parseEvidencePage("sem página 99999"), null);
  assert.equal(links.formatClauseLabel("8.2", "Prazos"), "Cláusula 8.2 – Prazos");
  assert.equal(links.formatClauseLabel("8.2", ""), "Cláusula 8.2");
  assert.equal(links.formatClauseLabel("", ""), null);
});

check("e-mail individual: título abaixo do cabeçalho com ESPAÇO visível; sem selo/banner antigo; saudação preservada", () => {
  for (const s of SEVERITIES) {
    const html = individual(s).html;
    assert.ok(html.indexOf(`RISCO ${WORD[s]} |`) < html.indexOf("Título do evento"));
    assert.ok(html.includes("Olá, Ana Souza."));
    assert.ok(!html.includes("border-radius:999px") && !html.includes("#facc15"));
    assert.ok(html.includes(`margin-top:${style.HEADER_GAP_PX}px`), "espaço entre a linha logo/risco e o primeiro texto");
  }
  assert.ok(style.HEADER_GAP_PX >= 16);
});

check("'Responsável' NÃO aparece no corpo (html e texto) mesmo recebendo responsibleName; 'Obra:' redundante também saiu", () => {
  for (const s of SEVERITIES) {
    const e = individual(s);
    assert.ok(!/Respons[aá]vel/.test(e.html + e.text));
    assert.ok(!e.html.includes("Bruno Lima") && !e.text.includes("Bruno Lima"));
    assert.ok(!e.html.includes("Obra: <"));
  }
  assert.ok(!/Respons[aá]vel/.test(batch.html + batch.text));
});

check("conteúdo contratual preservado: confronto, base, impacto, evento relacionado, link do evento e ações por token", () => {
  const e = individual("ALTA");
  for (const needle of ["Confronto contratual — Cláusula 8.2", "achado", "provisão", "conclusão", "Aprovado por Fulana", "Linha de base", "Evento relacionado", "Impacto potencial", `${BASE}/ev/1`, `${BASE}/email-actions/tok-1`]) {
    assert.ok(e.html.includes(needle), needle);
  }
});

check("'Repete: …' só no individual quando repeatNotice=true; sempre em cada item do lote; nunca 'Lembrete'", () => {
  assert.ok(!individual("CRITICA").html.includes("Repete:"));
  for (const s of SEVERITIES) {
    const e = individual(s, { repeatNotice: true });
    assert.ok(e.html.includes(policy.repeatNoticeText(s)) && e.text.includes(policy.repeatNoticeText(s)));
    assert.ok(!/Lembrete/i.test(e.html + e.text));
    assert.ok(batch.html.includes(policy.repeatNoticeText(s)), s);
  }
  assert.ok(!/Lembrete/i.test(batch.html + batch.text));
});

check("lote: cada alerta tem a PRÓPRIA caixa e cor (quatro caixas; o lote não é pintado pelo mais grave)", () => {
  const parts = boxes(batch.html);
  assert.equal(parts.length, 4);
  ["#CC0000", "#FFC700", "#FFFFFF", "#FFFFFF"].forEach((c, i) => assert.ok(parts[i].startsWith(c), `caixa ${i}`));
  assert.ok(batch.html.includes("background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px"));
});

check("TRÊS botões: RESOLVIDO / EM ANDAMENTO / ENVIADO P/ (ordem fixa), sem VER EVENTO, mesma largura/altura, sem 100%/min-width", () => {
  assert.equal(style.EM_ANDAMENTO_TEXT_WIDTH_PX, 114);
  assert.equal(style.BUTTON_SIDE_PADDING_PX, 12);
  assert.equal(style.BUTTON_WIDTH_PX, 114 + 24);
  const w = style.BUTTON_WIDTH_PX;
  const h = style.BUTTON_HEIGHT_PX;
  const tables = batch.html.match(/<table class="acc-compact-btn"[^>]*>.*?<\/table>/gs) ?? [];
  assert.equal(tables.length, 12, "3 botões × 4 alertas");
  for (const t of tables) {
    assert.match(t, new RegExp(`width="${w}"`));
    assert.match(t, new RegExp(`<td width="${w}" height="${h}"`));
    assert.match(t, new RegExp(`display:block;width:${w}px;height:${h}px;line-height:${h}px;margin:0;padding:0;`));
    assert.match(t, /font-size:14px/);
    assert.ok(!/width:100%|min-width|padding:\d+px \d+px/.test(t));
  }
  const labels = [...batch.html.matchAll(/white-space:nowrap;overflow:hidden;">([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(labels.slice(0, 3), ["RESOLVIDO", "EM ANDAMENTO", "ENVIADO P/"]);
  assert.deepEqual([...new Set(labels)].sort(), ["EM ANDAMENTO", "ENVIADO P/", "RESOLVIDO"]);
  for (const c of ["#1B2A4A", "#15803D", "#F97316"]) assert.ok(batch.html.includes(`bgcolor="${c}"`), c);
});

check("coluna dos botões BRANCA, com largura = botões + pequena margem lateral (um pouco maior que os botões)", () => {
  assert.equal(style.BUTTON_COLUMN_WIDTH_PX, style.BUTTON_WIDTH_PX + 2 * style.BUTTON_COLUMN_MARGIN_PX);
  assert.ok(style.BUTTON_COLUMN_WIDTH_PX - style.BUTTON_WIDTH_PX <= 20);
  const panels = batch.html.match(/<table class="acc-actions-panel"[^>]*>/g) ?? [];
  assert.equal(panels.length, 4);
  for (const p of panels) {
    assert.match(p, /bgcolor="#FFFFFF"/);
    assert.match(p, new RegExp(`width="${style.BUTTON_COLUMN_WIDTH_PX}"`));
  }
  assert.ok(!batch.html.includes("A resposta a este e-mail só é liberada"), "sem aviso novo acima/ao lado dos botões");
});

check("individual: com acompanhamento válido mostra os mesmos TRÊS botões e mantém as ações por token como 'Outras ações'; sem ele, só os tokens (como antes)", () => {
  const withQuick = individual("ALTA", { quickActionUrls: QUICK });
  for (const a of ["RESOLVIDO", "EM_ANDAMENTO", "ENVIADO_PARA"]) assert.ok(withQuick.html.includes(QUICK[a].replace(/&/g, "&amp;")), a);
  assert.equal((withQuick.html.match(/class="acc-compact-btn"/g) ?? []).length, 3);
  assert.ok(withQuick.html.includes("Outras ações:") && withQuick.html.includes("DAR CIÊNCIA") && withQuick.html.includes(`${BASE}/email-actions/tok-1`));
  assert.ok(withQuick.text.includes(`RESOLVIDO: ${QUICK.RESOLVIDO}`) && withQuick.text.includes("DAR CIÊNCIA"));
  const noQuick = individual("ALTA");
  assert.equal((noQuick.html.match(/class="acc-compact-btn"/g) ?? []).length, 0);
  assert.ok(noQuick.html.includes("DAR CIÊNCIA") && noQuick.html.includes(`${BASE}/email-actions/tok-1`), "tokens preservados");
  assert.ok(!noQuick.html.includes("Outras ações:"));
});

check("lote: vínculos e links corretos por alerta (ação por item, responder ao lote)", () => {
  batchItems.forEach((item, i) => {
    for (const a of ["RESOLVIDO", "EM_ANDAMENTO", "ENVIADO_PARA"]) assert.ok(batch.html.includes(`${BASE}/alertas/acao/p/1/ev-${i + 1}?acao=${a}`), `${item.eventId} ${a}`);
  });
  assert.ok(batch.html.includes("RESPONDER AO ACC") && batch.html.includes("Olá, Ana Souza."));
});

check("texto puro do lote traz classificação, obra, repete e as três ações por alerta; sem 'Responsável'", () => {
  assert.ok(batch.text.includes("RISCO CRÍTICO | NEWPORT") && batch.text.includes("RISCO BAIXO | NEWPORT"));
  for (const s of SEVERITIES) assert.ok(batch.text.includes(policy.repeatNoticeText(s)));
  assert.equal((batch.text.match(/EM ANDAMENTO: /g) ?? []).length, 4);
});

check("legendas dos botões por token (fallback) ficam legíveis na coluna branca", () => {
  const caption = (html) => (html.match(/color:(#[0-9A-Fa-f]{6});text-align:center;">Confirma que você tomou conhecimento/) ?? [])[1];
  for (const s of SEVERITIES) assert.equal(caption(individual(s).html), "#4B5563", s);
});

check("e-mail individual não expõe destinatários de outras pessoas", () => {
  const e = individual("MEDIA");
  const body = e.html.replace(/<style>.*?<\/style>/s, "").replace(/https?:\/\/[^"\s<]+/g, "");
  assert.ok(!/@/.test(body), "nenhum endereço de e-mail solto no corpo");
});

console.log("");
check("CONSULTAR IA: link para a página do ACC ACIMA dos três botões, só texto/link (sem formulário), no individual e no lote", () => {
  const link = `${BASE}/alertas/consulta-ia/p1/evento/e1`;
  const withLink = individual("MEDIA", { quickActionUrls: QUICK, aiConsultUrl: link });
  assert.ok(withLink.html.includes(`href="${link}"`));
  assert.ok(withLink.html.indexOf("CONSULTAR IA") < withLink.html.indexOf(">RESOLVIDO<"), "acima dos botões");
  assert.ok(!/<form|<input|<textarea|<select/i.test(withLink.html), "sem controle interativo no e-mail");
  assert.ok(!individual("MEDIA", { quickActionUrls: QUICK }).html.includes("CONSULTAR IA"), "sem URL, sem link");
  const b = buildContractAlertBatchEmail({ recipientName: null, projectName: "O", batchUrl: `${BASE}/l`, hasInlineLogo: true,
    items: batchItems.map((it) => ({ ...it, aiConsultUrl: `${BASE}/alertas/consulta-ia/p/evento/${it.eventId}` })) });
  assert.equal((b.html.match(/CONSULTAR IA<\/a>/g) ?? []).length, 4, "um link por alerta");
  for (const it of batchItems) assert.ok(b.html.includes(`/alertas/consulta-ia/p/evento/${it.eventId}`));
  assert.ok(b.text.includes("CONSULTAR IA:"));
  // continua exatamente três botões de ação iguais
  assert.equal((b.html.match(/class="acc-compact-btn"/g) ?? []).length, 12);
});

check("CELULAR: CONSULTAR IA fica AO LADO dos botões (inline-block, sem flex/grid), abaixo do conteúdo, com áreas de toque de 44px; sem CSS o layout vertical continua válido", () => {
  const html = individual("MEDIA", { quickActionUrls: QUICK, aiConsultUrl: `${BASE}/alertas/consulta-ia/p/evento/e` }).html;
  const css = html.slice(html.indexOf("@media only screen and (max-width:640px)"), html.indexOf("</style>"));
  assert.match(css, /\.acc-consult-wrap, \.acc-buttons-wrap \{ display:inline-block !important; vertical-align:middle !important/);
  assert.match(css, /\.acc-consult-wrap \{ width:43% !important/);
  assert.match(css, /\.acc-buttons-wrap \{ width:55% !important/);
  assert.match(css, /\.acc-compact-btn td \{ height:44px !important; \}/);
  assert.match(css, /\.acc-consult-ai a \{ height:44px !important/);
  assert.match(css, /\.acc-content-col, \.acc-actions-col \{ display:block !important; width:100% !important; \}/, "coluna de ações vai para BAIXO do conteúdo (não o cobre)");
  assert.ok(!/display:\s*flex|display:\s*grid/.test(html), "sem flex/grid");
  const panel = html.slice(html.indexOf('class="acc-actions-panel"'));
  assert.ok(panel.indexOf("acc-consult-wrap") < panel.indexOf("acc-buttons-wrap"), "layout padrão: consultar acima dos botões, mesma coluna branca");
});

check("ASSUNTO INDIVIDUAL (envio manual): crítico/alto com risco; médio/baixo 'OBRA | ACC' sem risco; prefixo do piloto só pelo guard, sem duplicar", () => {
  const subj = (sev) => individual(sev).subject;
  assert.equal(subj("CRITICA"), `[RISCO CRÍTICO] ${PROJECT_A} | ACC`);
  assert.equal(subj("ALTA"), `[RISCO ALTO] ${PROJECT_A} | ACC`);
  assert.equal(subj("MEDIA"), `${PROJECT_A} | ACC`);
  assert.equal(subj("BAIXA"), `${PROJECT_A} | ACC`);
  for (const sev of ["MEDIA", "BAIXA"]) assert.ok(!/RISCO|CRÍTICO|ALTO|MÉDIO|BAIXO/i.test(subj(sev)), sev);
  // o template NUNCA prefixa [TESTE CONTROLADO]; o guard do modo piloto o aplica uma única vez (sem envio real)
  for (const sev of SEVERITIES) {
    assert.ok(!subj(sev).startsWith(pilot.PILOT_SUBJECT_PREFIX));
    const base = { to: "cliente@empresa.com.br", subject: subj(sev), text: "t", html: "<p>h</p>" };
    const piloted = pilot.applyPilotOutboundGuard(base, { outboundMode: "pilot", pilotRecipient: "crm@axion.com.br" });
    assert.equal(piloted.subject, `${pilot.PILOT_SUBJECT_PREFIX}${subj(sev)}`);
    assert.equal(piloted.to, "crm@axion.com.br");
    const again = pilot.applyPilotOutboundGuard({ ...base, subject: piloted.subject }, { outboundMode: "pilot", pilotRecipient: "crm@axion.com.br" });
    assert.equal(again.subject, piloted.subject, "prefixo não duplica");
    const prod = pilot.applyPilotOutboundGuard(base, { outboundMode: "production", now: new Date("2026-09-22T03:00:00.000Z") });
    assert.equal(prod.subject, subj(sev), "em produção o assunto segue sem prefixo");
  }
  // os demais fluxos que usam buildContractAlertSubject (SLA, riscos, SSMA) não mudaram
  assert.match(sub.buildContractAlertSubject("Obra X", "ALTA"), /\[RISCO ALTO\] ACC - OBRA OBRA X$/);
});

console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
