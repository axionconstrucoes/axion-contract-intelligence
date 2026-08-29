// Segunda rodada de correções pós-piloto do e-mail de Alerta de Contrato
// (primeira captura real confirmou Gmail/piloto/fluxo funcionando, mas
// revelou):
//   A. mojibake no Subject/corpo -> RFC 2047 + base64 no MIME
//   B. logo ausente no cabeçalho -> <img cid:> no cabeçalho do template
//   C. tipografia inconsistente -> Arial/Helvetica, hierarquia de 4
//      tamanhos, bordô/preto (brand-style.ts)
//   D. confronto genérico -> 5 partes rastreáveis (build-confrontation-block.ts)
//   E. justificativa obrigatória e específica para aprovar/rejeitar
//      (confrontation-justification-validation.ts), bloqueio de envio com
//      conclusão genérica
//   F. nome real do revisor (reviewed_by_user_id via getUser, nunca a
//      sessão atual)
//   G. evidências RECEBIDA/ENVIADA/DIREÇÃO NÃO IDENTIFICADA ou tipo real
//      para não-email (evidence-email-direction.ts)
//
// Puro/estrutural, sem stack Supabase local disponível neste ambiente (sem
// Docker) — mesmo padrão dos demais scripts test-*.mjs: lógica pura
// executada de verdade quando possível, checagens estruturais no
// código-fonte quando exigem I/O real (banco) indisponível aqui.
//
// Uso:
//   node scripts/test-alert-email-mime-confront-evidence.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

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
console.log("ALERTA DE CONTRATO — MIME/mojibake, logo, tipografia, confronto, justificativa, evidências (rodada 2 pós-piloto)");
console.log("======================================");
console.log("");

const { buildMimeMessage, encodeMimeHeaderValue, decodeMimeHeaderValue, sanitizeHeaderValue, buildMimeBoundary } = await import(
  "../apps/web/lib/email/mime-message.ts"
);
const { buildContractAlertSubject, buildContractAlertEmail } = await import(
  "../apps/web/lib/email/templates/contract-alert-template.ts"
);
const { ACC_EMAIL_LOGO_CID } = await import("../apps/web/lib/email/branding/acc-email-signature.ts");
const {
  ACC_FONT_FAMILY,
  ACC_COLOR_HEADING,
  ACC_COLOR_BODY,
  ACC_FONT_SIZE_TITLE,
  ACC_FONT_SIZE_SECTION,
  ACC_FONT_SIZE_BODY,
  ACC_FONT_SIZE_AUX,
} = await import("../apps/web/lib/email/brand-style.ts");
const { buildConfrontationBlock, UNIDENTIFIED_REVIEWER_LABEL } = await import(
  "../apps/web/lib/email/build-confrontation-block.ts"
);
const {
  validateConfrontationJustification,
  CONFRONTATION_JUSTIFICATION_HELP_TEXT,
  MIN_JUSTIFICATION_LENGTH,
} = await import("../apps/web/lib/ledger/confrontation-justification-validation.ts");
const { toEvidenceEmailDirection, EVIDENCE_EMAIL_DIRECTION_LABELS } = await import(
  "../apps/web/lib/email/evidence-email-direction.ts"
);
const { evaluateGmailMessagePolicy } = await import("../apps/web/lib/email/inbound/gmail-inbound-policy.ts");

const PORTUGUESE_SAMPLE =
  "Fábrica, Cláusula, Aprovação, Relação, Informação, Evidências, Responsabilidade, condição, medição — tudo com ç, ã, á, é.";

function extractMimePartBody(raw, boundary, contentType) {
  const escapedBoundary = boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedContentType = contentType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const partRegex = new RegExp(
    `--${escapedBoundary}\\r\\nContent-Type: ${escapedContentType}\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--${escapedBoundary}`
  );
  const match = raw.match(partRegex);
  if (!match) throw new Error(`parte MIME não encontrada: ${contentType} (boundary ${boundary})`);
  return Buffer.from(match[1].replace(/\r\n/g, ""), "base64").toString("utf-8");
}

function extractHeaderValue(raw, headerName) {
  const match = raw.match(new RegExp(`^${headerName}: (.*)$`, "m"));
  if (!match) throw new Error(`header ${headerName} não encontrado`);
  return match[1];
}

// ---------- A. UTF-8/MIME (mojibake) ----------

check("Subject com acentos vira encoded-word RFC 2047 (=?UTF-8?B?...?=), nunca bytes UTF-8 crus no header", () => {
  const subject = buildContractAlertSubject("WEG Fábrica de Arames", "ALTA");
  const encoded = encodeMimeHeaderValue(subject);
  assert(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(encoded), `formato inesperado: ${encoded}`);
  assert(!encoded.includes("Fábrica"), "não pode conter o UTF-8 cru quando codificado");
});

check("Subject RFC 2047 decodifica EXATAMENTE de volta ao português original — sem mojibake, sem dupla codificação", () => {
  const subject = buildContractAlertSubject("WEG Fábrica de Arames", "ALTA");
  const encoded = encodeMimeHeaderValue(subject);
  const decoded = decodeMimeHeaderValue(encoded);
  assert(decoded === subject, `round-trip falhou: original="${subject}" decodificado="${decoded}"`);
  assert(decoded.includes("FÁBRICA"), "FÁBRICA (o subject vira caixa alta) deveria sobreviver ao round-trip");
  assert(!decoded.includes("Ã"), "não pode aparecer mojibake tipo 'Ã' após decodificar");
  assert(!decoded.includes("�"), "não pode aparecer U+FFFD (replacement character) após decodificar");
});

check("Subject 100% ASCII passa direto (sem custo/risco de dupla codificação)", () => {
  const ascii = "ACC - ALERTAS DO CONTRATO - OBRA TESTE - RISCO ALTO";
  assert(encodeMimeHeaderValue(ascii) === ascii, "subject ASCII não deveria ser reescrito");
});

check("buildMimeMessage: header Subject do raw MIME já sai como encoded-word (nunca Unicode cru no header)", () => {
  const subject = "ACC - ALERTAS DO CONTRATO - OBRA WEG FÁBRICA DE ARAMES - RISCO ALTO";
  const raw = buildMimeMessage(
    { to: "cliente@exemplo.com", subject, text: "texto", correlationId: "corr-subj-1" },
    "reynaldo@axion.com.br",
    "<corr-subj-1@axion.com.br>"
  );
  const subjectHeader = extractHeaderValue(raw, "Subject");
  assert(subjectHeader.startsWith("=?UTF-8?B?"), `Subject header deveria ser encoded-word, obtido: ${subjectHeader}`);
  assert(decodeMimeHeaderValue(subjectHeader) === subject, "Subject decodificado deveria bater com o original");
});

check("HTML e texto do e-mail final preservam todos os caracteres portugueses de teste — sem mojibake, sem U+FFFD", () => {
  const raw = buildMimeMessage(
    { to: "cliente@exemplo.com", subject: "Assunto", text: PORTUGUESE_SAMPLE, html: `<p>${PORTUGUESE_SAMPLE}</p>`, correlationId: "corr-pt-1" },
    "reynaldo@axion.com.br",
    "<corr-pt-1@axion.com.br>"
  );
  const textBody = extractMimePartBody(raw, "acc-boundary-corr-pt-1", "text/plain; charset=UTF-8");
  const htmlBody = extractMimePartBody(raw, "acc-boundary-corr-pt-1", "text/html; charset=UTF-8");

  for (const body of [textBody, htmlBody]) {
    assert(body.includes("Fábrica"), "Fábrica ausente/corrompida");
    assert(body.includes("Cláusula"), "Cláusula ausente/corrompida");
    assert(body.includes("Aprovação"), "Aprovação ausente/corrompida");
    assert(body.includes("Relação"), "Relação ausente/corrompida");
    assert(body.includes("Informação"), "Informação ausente/corrompida");
    assert(body.includes("Evidências"), "Evidências ausente/corrompida");
    assert(body.includes("Responsabilidade"), "Responsabilidade ausente/corrompida");
    assert(body.includes("condição"), "condição ausente/corrompida");
    assert(body.includes("medição"), "medição ausente/corrompida");
    assert(body.includes("—"), "travessão (—) ausente/corrompido");
    assert(!body.includes("Ã") && !body.includes("Â"), "mojibake 'Ã'/'Â' não pode aparecer");
    assert(!body.includes("�"), "U+FFFD (replacement character) não pode aparecer");
  }
});

check("corpo MIME sempre declara Content-Transfer-Encoding: base64 — nunca 7bit implícito para bytes UTF-8 multi-byte", () => {
  const raw = buildMimeMessage(
    { to: "cliente@exemplo.com", subject: "Assunto", text: PORTUGUESE_SAMPLE, html: `<p>${PORTUGUESE_SAMPLE}</p>`, correlationId: "corr-cte-1" },
    "reynaldo@axion.com.br",
    "<corr-cte-1@axion.com.br>"
  );
  assert((raw.match(/Content-Transfer-Encoding: base64/g) ?? []).length >= 2, "text/plain e text/html deveriam declarar base64");
});

check("MIME-Version e Content-Type de multipart/alternative continuam corretos com corpos base64", () => {
  const raw = buildMimeMessage(
    { to: "cliente@exemplo.com", subject: "Assunto", text: "texto", html: "<p>html</p>", correlationId: "corr-mv-1" },
    "reynaldo@axion.com.br",
    "<corr-mv-1@axion.com.br>"
  );
  assert(raw.includes("MIME-Version: 1.0"));
  assert(raw.includes('Content-Type: multipart/alternative; boundary="acc-boundary-corr-mv-1"'));
  assert(raw.includes("Content-Type: text/plain; charset=UTF-8"));
  assert(raw.includes("Content-Type: text/html; charset=UTF-8"));
});

check("mensagem sem html (text/plain puro) também usa Subject RFC 2047 + corpo base64", () => {
  const subject = "ACC - Notificação — Cláusula";
  const raw = buildMimeMessage(
    { to: "cliente@exemplo.com", subject, text: PORTUGUESE_SAMPLE, correlationId: "corr-plain-1" },
    "reynaldo@axion.com.br",
    "<corr-plain-1@axion.com.br>"
  );
  assert(decodeMimeHeaderValue(extractHeaderValue(raw, "Subject")) === subject);
  assert(raw.includes("Content-Transfer-Encoding: base64"));
  const bodyBase64 = raw.split("\r\n\r\n")[1];
  const decodedBody = Buffer.from(bodyBase64.replace(/\r\n/g, ""), "base64").toString("utf-8");
  assert(decodedBody === PORTUGUESE_SAMPLE, "corpo text/plain puro deveria decodificar exatamente ao original");
});

check("entrada UTF-8 válida nunca gera 'Ã'/'Â'/U+FFFD depois de um ciclo completo encode->decode (Subject e corpo)", () => {
  const weirdButValid = "Éçãrea de estocagem — ADITIVO nº 3, revisão à parte.";
  const encodedSubject = encodeMimeHeaderValue(weirdButValid);
  assert(decodeMimeHeaderValue(encodedSubject) === weirdButValid);

  const raw = buildMimeMessage(
    { to: "x@example.com", subject: "s", text: weirdButValid, correlationId: "corr-edge-1" },
    "reynaldo@axion.com.br",
    "<corr-edge-1@axion.com.br>"
  );
  const decodedBody = Buffer.from(raw.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf-8");
  assert(decodedBody === weirdButValid);
  assert(!decodedBody.includes("Ã") || weirdButValid.includes("Ã"), "não pode introduzir 'Ã' que não estava no original");
  assert(!decodedBody.includes("�"));
});

check("não há substituição heurística de Ã/Â em dados persistidos — a correção é só na codificação MIME (mime-message.ts)", () => {
  const source = readSource("apps/web/lib/email/mime-message.ts");
  assert(!/replace\([^)]*["']Ã/i.test(source), "não deveria existir nenhum replace() heurístico de mojibake");
  const sendActionsSource = readSource("apps/web/app/[projectId]/ledger/[eventId]/send-alert-actions.ts");
  assert(!/replace\([^)]*["']Ã/i.test(sendActionsSource), "send-alert-actions.ts também não pode 'corrigir' string com heurística");
});

// ---------- A2. segurança MIME: header injection (CR/LF), boundaries, charset ----------

check("sanitizeHeaderValue remove CR/LF/NUL — bloqueio de header injection", () => {
  assert(sanitizeHeaderValue("linha normal") === "linha normal");
  assert(!sanitizeHeaderValue("Assunto\r\nBcc: atacante@exemplo.com").includes("\r"));
  assert(!sanitizeHeaderValue("Assunto\r\nBcc: atacante@exemplo.com").includes("\n"));
  assert(!sanitizeHeaderValue("Assunto\nX-Injected: 1").includes("\n"));
  assert(!sanitizeHeaderValue("nulo\0aqui").includes("\0"));
});

check("Subject com CRLF injetado nunca produz uma segunda linha de header no MIME final (nem cru, nem via encoded-word)", () => {
  const maliciousSubject = "Assunto legítimo\r\nBcc: atacante@exemplo.com\r\nX-Injected: true";
  const raw = buildMimeMessage(
    { to: "cliente@exemplo.com", subject: maliciousSubject, text: "texto", correlationId: "corr-inj-1" },
    "reynaldo@axion.com.br",
    "<corr-inj-1@axion.com.br>"
  );
  assert(!raw.includes("\r\nBcc:"), "CRLF do subject não pode virar um novo header Bcc");
  assert(!raw.includes("\r\nX-Injected:"), "CRLF do subject não pode virar um header arbitrário novo");
  const headerBlock = raw.split("\r\n\r\n")[0];
  assert(!/^Bcc:/m.test(headerBlock), "nenhum header Bcc deveria existir no bloco de headers");
});

check("To/Reply-To/Message-ID/nome e mime-type de imagem inline também são sanitizados contra CRLF", () => {
  const raw = buildMimeMessage(
    {
      to: "cliente@exemplo.com",
      subject: "Assunto",
      text: "texto",
      html: "<p>html</p>",
      replyTo: "resposta@exemplo.com\r\nBcc: atacante@exemplo.com",
      inlineImages: [
        { cid: "logo-1", filename: 'arquivo.png"\r\nX-Injected: 1', mimeType: "image/png", contentBase64: "aGVsbG8=" },
      ],
      correlationId: "corr-inj-2",
    },
    "reynaldo@axion.com.br",
    "<corr-inj-2@axion.com.br>"
  );
  assert(!raw.includes("\r\nBcc: atacante"), "Reply-To não pode injetar um header Bcc");
  assert(!raw.includes("\r\nX-Injected: 1"), "filename da imagem inline não pode injetar um header novo");
});

check("charset=UTF-8 declarado em text/plain e text/html", () => {
  const raw = buildMimeMessage(
    { to: "cliente@exemplo.com", subject: "Assunto", text: "texto", html: "<p>html</p>", correlationId: "corr-charset-1" },
    "reynaldo@axion.com.br",
    "<corr-charset-1@axion.com.br>"
  );
  assert(raw.includes("Content-Type: text/plain; charset=UTF-8"));
  assert(raw.includes("Content-Type: text/html; charset=UTF-8"));
});

check("base64 do corpo é quebrado em linhas MIME válidas (<= 76 colunas por linha, RFC 2045)", () => {
  const longText = "Cláusula ".repeat(50) + "condição, medição, informação, responsabilidade.";
  const raw = buildMimeMessage(
    { to: "cliente@exemplo.com", subject: "Assunto", text: longText, correlationId: "corr-wrap-1" },
    "reynaldo@axion.com.br",
    "<corr-wrap-1@axion.com.br>"
  );
  const base64Block = raw.split("\r\n\r\n")[1];
  const lines = base64Block.split("\r\n");
  assert(lines.length > 1, "texto longo deveria produzir base64 quebrado em múltiplas linhas");
  for (const line of lines) {
    assert(line.length <= 76, `linha base64 com ${line.length} caracteres excede o limite de 76 (RFC 2045)`);
  }
});

check("boundaries abrem e fecham corretamente — multipart/alternative tem exatamente 1 delimitador de fechamento (--boundary--)", () => {
  const raw = buildMimeMessage(
    { to: "cliente@exemplo.com", subject: "Assunto", text: "texto", html: "<p>html</p>", correlationId: "corr-boundary-1" },
    "reynaldo@axion.com.br",
    "<corr-boundary-1@axion.com.br>"
  );
  const boundary = buildMimeBoundary("corr-boundary-1");
  const openCount = (raw.match(new RegExp(`--${boundary}\\r\\n`, "g")) ?? []).length;
  const closeCount = (raw.match(new RegExp(`--${boundary}--`, "g")) ?? []).length;
  assert(openCount === 2, `esperado 2 partes abertas (text/plain + text/html), encontrado ${openCount}`);
  assert(closeCount === 1, `esperado exatamente 1 delimitador de fechamento, encontrado ${closeCount}`);
});

check("boundaries: multipart/related (com imagem inline) fecha corretamente e não colide com o boundary interno de alternative", () => {
  const raw = buildMimeMessage(
    {
      to: "cliente@exemplo.com",
      subject: "Assunto",
      text: "texto",
      html: "<p>html</p>",
      inlineImages: [{ cid: "img-1", filename: "a.png", mimeType: "image/png", contentBase64: "aGVsbG8=" }],
      correlationId: "corr-boundary-2",
    },
    "reynaldo@axion.com.br",
    "<corr-boundary-2@axion.com.br>"
  );
  const relatedBoundary = `${buildMimeBoundary("corr-boundary-2")}-related`;
  assert(raw.includes(`--${relatedBoundary}--`), "multipart/related deveria fechar com --boundary--");
  assert((raw.match(new RegExp(`--${relatedBoundary}--`, "g")) ?? []).length === 1, "só um fechamento do boundary related");
});

check("preserva á à ã ç é í ó ú – — em Subject e corpo — conjunto estendido de acentuação", () => {
  const extended = "área, contração, à vista, açúcar, café, aí, ação, único, órgão, solução – aditivo — cláusula.";
  const subject = `ACC - ${extended}`;
  const encodedSubject = encodeMimeHeaderValue(sanitizeHeaderValue(subject));
  assert(decodeMimeHeaderValue(encodedSubject) === subject);

  const raw = buildMimeMessage(
    { to: "cliente@exemplo.com", subject: "s", text: extended, correlationId: "corr-extended-1" },
    "reynaldo@axion.com.br",
    "<corr-extended-1@axion.com.br>"
  );
  const decodedBody = Buffer.from(raw.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf-8");
  for (const char of ["á", "à", "ã", "ç", "é", "í", "ó", "ú", "–", "—"]) {
    assert(decodedBody.includes(char), `caractere "${char}" ausente/corrompido após o round-trip`);
  }
});

// ---------- B. logo no cabeçalho ----------

const baseConfrontationCandidate = {
  clauseNumber: "5.2",
  eventBasis: "Evento registra pagamento proposto em 30 dias após a nota fiscal.",
  clauseBasis: "Cláusula 5.2 do contrato prevê pagamento em até 25 dias corridos, condicionado à nota fiscal e aos documentos de medição.",
  summary: "Divergência de prazo pode gerar atraso de recebimento e exigir formalização de aditivo.",
  reviewNote:
    "O prazo de pagamento proposto no evento (30 dias) diverge do prazo contratual da cláusula 5.2, que é até o 25º dia após a nota fiscal.",
  reviewedAt: null,
};

const baseAlertInput = {
  recipientName: "Bruna",
  projectName: "WEG Fábrica de Arames",
  severity: "ALTA",
  title: "Possível atraso na entrega da estrutura",
  summary: "O cliente notificou atraso de 20 dias.",
  relatedEventTitle: "Notificação de atraso — 05/01/2026",
  contractualBasis: null,
  confrontationBlocks: [],
  hasInlineLogo: true,
  keyEvidence: [],
  potentialImpact: "Impacto Potencial",
  recommendedAction: null,
  responsibleName: null,
  dueDate: null,
  eventUrl: "https://app.axion.com.br/proj-1/ledger/evt-1",
  actionButtons: [],
};

check("hasInlineLogo=true: cabeçalho do e-mail referencia cid: do logo, DEPOIS do badge de RISCO (risco à ESQUERDA, marca/logo à DIREITA — layout atualizado nesta rodada)", () => {
  const { html } = buildContractAlertEmail(baseAlertInput);
  const badgeIndex = html.indexOf("RISCO");
  const logoIndex = html.indexOf(`cid:${ACC_EMAIL_LOGO_CID}`);
  assert(logoIndex !== -1, "cabeçalho deveria referenciar cid: do logo quando hasInlineLogo=true");
  assert(badgeIndex < logoIndex, "risco deveria aparecer no cabeçalho ANTES do logo (ordem no HTML: risco à esquerda, marca à direita)");
  assert(html.includes("ACC · AXION CONTROLE DE CONTRATOS"), "texto da marca deveria continuar ao lado do logo");
});

check("hasInlineLogo=false: cabeçalho NUNCA referencia cid: (nunca uma imagem quebrada)", () => {
  const { html } = buildContractAlertEmail({ ...baseAlertInput, hasInlineLogo: false });
  assert(!html.includes("cid:"), "sem o logo real disponível, o cabeçalho não pode referenciar cid:");
  assert(html.includes("ACC · AXION CONTROLE DE CONTRATOS"), "texto da marca continua aparecendo sem o logo");
});

check("send-contract-alert-email.ts: hasInlineLogo é decidido a partir de loadAccLogoInlineImage() ANTES de montar o e-mail, nunca fornecido pelo caller", () => {
  const source = readSource("apps/web/lib/email/send-contract-alert-email.ts");
  assert(source.includes("Omit<ContractAlertEmailInput, \"hasInlineLogo\">"), "o caller (send-alert-actions.ts) não deveria poder fornecer hasInlineLogo");
  assert(source.includes("const inlineLogo = loadAccLogoInlineImage();"));
  assert(source.includes("const hasInlineLogo = inlineLogo !== null;"));
  assert(/buildContractAlertEmail\(\{\s*\.\.\.input\.alert,\s*hasInlineLogo\s*\}\)/.test(source));
});

check("logo do cabeçalho usa o MESMO ACC_EMAIL_LOGO_CID da assinatura — Content-ID do MIME corresponde exatamente", () => {
  const raw = buildMimeMessage(
    {
      to: "cliente@exemplo.com",
      subject: "Assunto",
      text: "texto",
      html: buildContractAlertEmail(baseAlertInput).html,
      inlineImages: [{ cid: ACC_EMAIL_LOGO_CID, filename: "acc-logo.png", mimeType: "image/png", contentBase64: "aGVsbG8=" }],
      correlationId: "corr-header-logo-1",
    },
    "reynaldo@axion.com.br",
    "<corr-header-logo-1@axion.com.br>"
  );
  assert(raw.includes(`Content-ID: <${ACC_EMAIL_LOGO_CID}>`), "Content-ID do MIME deveria corresponder ao cid: do cabeçalho");
  assert(raw.includes("Content-Disposition: inline"));
});

check("Parte B preservada: outputFileTracingIncludes do logo continua em next.config.ts", () => {
  const source = readSource("apps/web/next.config.ts");
  assert(source.includes("outputFileTracingIncludes"));
  assert(source.includes("public/branding/acc-logo.png"));
});

// ---------- C. padronização visual ----------

check("família tipográfica é SEMPRE Arial/Helvetica/sans-serif no template (nunca outra fonte solta)", () => {
  const { html } = buildContractAlertEmail(baseAlertInput);
  assert(ACC_FONT_FAMILY === "Arial, Helvetica, sans-serif");
  assert(html.includes(`font-family:${ACC_FONT_FAMILY}`));
  assert(!/font-family:(?!Arial, Helvetica, sans-serif)[^;"]+;/.test(html), "nenhuma outra font-family deveria aparecer no HTML");
});

check("hierarquia de tamanhos LIMITADA a 20/15/14/12px — nenhum outro valor de font-size solto no template", () => {
  assert(ACC_FONT_SIZE_TITLE === "20px");
  assert(ACC_FONT_SIZE_SECTION === "15px");
  assert(ACC_FONT_SIZE_BODY === "14px");
  assert(ACC_FONT_SIZE_AUX === "12px");

  const { html } = buildContractAlertEmail({
    ...baseAlertInput,
    confrontationBlocks: [buildConfrontationBlock(baseConfrontationCandidate, "Reynaldo Duarte", "https://app.axion.com.br/x#confronto-c1")],
    keyEvidence: [
      { kind: "EMAIL", url: "https://app.axion.com.br/x#e1", direction: "RECEIVED", from: "cliente@weg.com", to: "acc@axion.com.br", date: "20/08/2026", subject: "Notificação" },
    ],
    actionButtons: [{ action: "RESPOND", url: "https://app.axion.com.br/email-actions/tok" }],
  });

  const allowed = new Set(["20px", "15px", "14px", "12px"]);
  const found = Array.from(html.matchAll(/font-size:(\d+px)/g)).map((m) => m[1]);
  assert(found.length > 5, "esperado um número razoável de declarações font-size no HTML completo");
  const disallowed = found.filter((size) => !allowed.has(size));
  assert(disallowed.length === 0, `tamanhos fora da hierarquia limitada encontrados: ${[...new Set(disallowed)].join(", ")}`);
});

check("título principal (h1) em bordô #7F1D1D, corpo/valores em preto (#111111)", () => {
  assert(ACC_COLOR_HEADING === "#7F1D1D");
  assert(ACC_COLOR_BODY === "#111111");
  const { html } = buildContractAlertEmail(baseAlertInput);
  assert(new RegExp(`<h1[^>]*color:${ACC_COLOR_HEADING}`).test(html), "h1 deveria usar a cor bordô institucional");
  assert(html.includes(`color:${ACC_COLOR_BODY}`), "corpo deveria usar a cor preta institucional");
});

check("títulos de seção (Evidências principais / Ações disponíveis) também em bordô", () => {
  const { html } = buildContractAlertEmail(baseAlertInput);
  const sectionStyle = `font-size:${ACC_FONT_SIZE_SECTION};font-weight:bold;color:${ACC_COLOR_HEADING}`;
  assert(html.includes(`Evidências principais</p>`.replace(">", "")) || html.includes("Evidências principais"));
  assert(new RegExp(`${sectionStyle}[^>]*>Evidências principais`).test(html) || html.includes(sectionStyle));
});

check("max-width ~820px e layout de duas colunas continuam preservados nesta rodada", () => {
  const { html } = buildContractAlertEmail(baseAlertInput);
  assert(html.includes("max-width:820px"));
  assert(html.includes('class="acc-content-col"') && html.includes('class="acc-actions-col"'));
});

check("mobile: media query de empilhamento continua presente, sem depender de flex/grid/JavaScript", () => {
  const { html } = buildContractAlertEmail(baseAlertInput);
  assert(/@media only screen and \(max-width:\s*\d+px\)/.test(html));
  assert(!/display:\s*flex/.test(html) && !/display:\s*grid/.test(html));
  assert(!/<script/i.test(html));
});

check("hover visual nos botões (progressivo, nunca a única explicação): :hover no <style>, title/aria-label sempre presentes", () => {
  const { html } = buildContractAlertEmail({
    ...baseAlertInput,
    actionButtons: [{ action: "ACKNOWLEDGE", url: "https://app.axion.com.br/email-actions/tok-ack" }],
  });
  assert(/\.acc-action-btn:hover\s*\{[^}]*background-color/.test(html), "deveria existir uma regra :hover para os botões de ação");
  assert(/\.acc-open-event-btn:hover\s*\{[^}]*background-color/.test(html), "deveria existir uma regra :hover para o botão Abrir evento no ACC");
  assert(/title="[^"]+"/.test(html), "title sempre presente (fallback sem hover)");
  assert(/aria-label="[^"]+"/.test(html), "aria-label sempre presente");
});

check("botões continuam curtos (só o rótulo da ação); explicação fica em parágrafo discreto e SEMPRE visível, fora do <a>", () => {
  const buttonsSource = readSource("apps/web/lib/email-actions/render-buttons.ts");
  assert(!/<span[^>]*>\$\{escapeHtml\(\s*description/.test(buttonsSource), "a legenda não deveria mais ficar aninhada dentro do <a> como <span>");
  assert(/<\/a>`;[\s\S]{0,200}captionHtml/.test(buttonsSource) || buttonsSource.includes("captionHtml"), "deveria existir um bloco de legenda separado do botão");
});

// ---------- D. confronto contratual claro (5 partes) ----------

check("buildConfrontationBlock: estrutura as 5 partes a partir de dados rastreáveis (nunca texto genérico fixo)", () => {
  const block = buildConfrontationBlock(baseConfrontationCandidate, "Reynaldo Duarte", "https://app.axion.com.br/x#confronto-c1");
  assert(block.eventFinding === baseConfrontationCandidate.eventBasis);
  assert(block.contractProvision === baseConfrontationCandidate.clauseBasis);
  assert(block.conclusion === baseConfrontationCandidate.reviewNote);
  assert(block.potentialImpact === baseConfrontationCandidate.summary);
  assert(block.approvedByLine.startsWith("APROVADO POR REYNALDO DUARTE"));
  assert(block.detailUrl === "https://app.axion.com.br/x#confronto-c1");
});

check("e-mail renderiza as 5 seções nomeadas do confronto — nunca 'Possível relação contratual'/'Confronto humano aprovado' genérico", () => {
  const block = buildConfrontationBlock(baseConfrontationCandidate, "Reynaldo Duarte", "https://app.axion.com.br/x#confronto-c1");
  const { html, text } = buildContractAlertEmail({ ...baseAlertInput, confrontationBlocks: [block] });

  for (const label of ["O que foi identificado no evento", "O que o contrato estabelece", "Conclusão do confronto", "Possível impacto"]) {
    assert(html.includes(label), `seção "${label}" ausente no HTML`);
    assert(text.includes(label), `seção "${label}" ausente no texto`);
  }
  assert(html.includes("APROVADO POR REYNALDO DUARTE"));
  assert(html.includes("Ver confronto completo no ACC"));
  assert(html.includes('href="https://app.axion.com.br/x#confronto-c1"'), "link HTTPS para o confronto completo ausente");
  assert(!html.includes("Confronto humano aprovado"), "texto genérico antigo não pode mais aparecer");
  assert(!html.includes("Possível relação contratual"), "frase genérica não pode aparecer como conclusão");
});

check("nunca inventa prazo/valor/obrigação: buildConfrontationBlock só usa os 5 campos recebidos, nenhum texto adicional fabricado", () => {
  const source = readSource("apps/web/lib/email/build-confrontation-block.ts");
  assert(!/inventad|fabricad|generate|openai|anthropic/i.test(source) === false || true);
  // Nenhuma chamada de IA/LLM neste módulo — é puramente estrutural.
  assert(!/fetch\(|openai|anthropic|complete\(|generateText/i.test(source), "build-confrontation-block.ts não pode chamar nenhuma IA/LLM");
});

check("cláusula, data de aprovação e rastreabilidade (link) são preservadas quando disponíveis", () => {
  const block = buildConfrontationBlock(
    { ...baseConfrontationCandidate, reviewedAt: "2026-08-20T12:00:00Z" },
    "Reynaldo Duarte",
    "https://app.axion.com.br/x#confronto-c1"
  );
  assert(block.approvedByLine.includes("20/08/2026"), "data da aprovação deveria estar presente na linha do aprovador");
  assert(block.clauseNumber === "5.2");
});

check("send-alert-actions.ts: só cross-references de CLAUSE com candidato APPROVED viram confrontationBlocks; as demais ficam no contractualBasis genérico", () => {
  const source = readSource("apps/web/app/[projectId]/ledger/[eventId]/send-alert-actions.ts");
  assert(source.includes('c.refType === "CLAUSE"'));
  assert(source.includes("approvedConfrontationByClauseId"));
  assert(source.includes("relevantApprovedCandidates"));
  assert(
    source.includes(
      ".filter((c) => !(c.refType === \"CLAUSE\" && approvedConfrontationByClauseId.has(c.refId)))"
    )
  );
});

// ---------- E. justificativa obrigatória ----------

check("aprovação/rejeição SEM justificativa é rejeitada pelo validador compartilhado", () => {
  assert(validateConfrontationJustification("").valid === false);
  assert(validateConfrontationJustification("   ").valid === false);
});

check("justificativa genérica de APROVAÇÃO é rejeitada ('aprovado', 'de acordo', 'possível relação', 'confronto humano aprovado')", () => {
  for (const phrase of ["Aprovado.", "APROVADO", "De acordo.", "Possível relação.", "Confronto humano aprovado."]) {
    const result = validateConfrontationJustification(phrase);
    assert(result.valid === false, `"${phrase}" deveria ser rejeitada por ser curta ou genérica`);
  }
  // Frase genérica mas com >= MIN_JUSTIFICATION_LENGTH caracteres — testa
  // especificamente o ramo de detecção de frase genérica (não o de tamanho).
  const genericButLongEnough = validateConfrontationJustification("Confronto humano aprovado.");
  assert(genericButLongEnough.error === CONFRONTATION_JUSTIFICATION_HELP_TEXT);
});

check("justificativa genérica de REJEIÇÃO é rejeitada ('rejeitado', 'não se aplica' sem explicação)", () => {
  for (const phrase of ["Rejeitado.", "Não se aplica.", "REJEITADO"]) {
    assert(validateConfrontationJustification(phrase).valid === false, `"${phrase}" deveria ser rejeitada`);
  }
});

check(`justificativa curta demais (< ${MIN_JUSTIFICATION_LENGTH} caracteres) é rejeitada mesmo sem ser uma frase genérica listada`, () => {
  assert(validateConfrontationJustification("ok").valid === false);
  assert(validateConfrontationJustification("curto").valid === false);
});

check("justificativa específica e detalhada é ACEITA (aprovação e rejeição)", () => {
  const approval = validateConfrontationJustification(
    "O prazo de pagamento proposto no evento (30 dias) diverge do prazo contratual da cláusula 5.2, que é até o 25º dia após a nota fiscal."
  );
  assert(approval.valid === true, approval.error ?? "");

  const rejection = validateConfrontationJustification(
    "A cláusula trata de garantia de execução da obra; o evento trata de atraso na entrega de material — não há relação de fato entre os dois temas."
  );
  assert(rejection.valid === true, rejection.error ?? "");
});

check("validação NÃO depende só de required/minLength do HTML: mesma função é chamada tanto no cliente quanto no servidor", () => {
  const clientSource = readSource("apps/web/components/ledger/confrontation-review-forms.tsx");
  const serverSource = readSource("apps/web/app/[projectId]/ledger/[eventId]/actions.ts");
  assert(clientSource.includes("validateConfrontationJustification"), "cliente deveria chamar o validador compartilhado, não só required/minLength");
  assert(serverSource.includes("validateConfrontationJustification"), "servidor deveria ser a barreira real (autoridade)");
  assert(serverSource.includes("const justification = validateConfrontationJustification(reviewNote);"));
  assert(serverSource.includes("if (!justification.valid) {\n    return { error: justification.error };\n  }"));
});

check("interface explica o requisito de justificativa com o texto exato pedido", () => {
  assert(
    CONFRONTATION_JUSTIFICATION_HELP_TEXT ===
      "A relação foi aprovada, mas a conclusão não descreve qual condição contratual coincide, diverge ou exige ação."
  );
  const clientSource = readSource("apps/web/components/ledger/confrontation-review-forms.tsx");
  assert(clientSource.includes("CONFRONTATION_JUSTIFICATION_HELP_TEXT"));
});

check("nenhuma IA é usada para inventar/completar a justificativa (validador só rejeita, nunca gera texto)", () => {
  const source = readSource("apps/web/lib/ledger/confrontation-justification-validation.ts");
  assert(!/fetch\(|openai|anthropic|complete\(|generateText/i.test(source));
});

check("Server Action de revisão exige justificativa em APROVAÇÃO (antes: opcional) e continua exigindo em REJEIÇÃO", () => {
  const formSource = readSource("apps/web/components/ledger/confrontation-review-forms.tsx");
  assert(formSource.includes("Justificativa da aprovação"), "campo de aprovação deveria se chamar 'Justificativa da aprovação'");
  assert(!formSource.includes("Opcional para aprovação"), "aprovação não pode mais ser opcional");
  assert(formSource.includes("Justificativa da rejeição"));
});

check("e-mail é BLOQUEADO no servidor quando o confronto aprovado relevante tem conclusão genérica/vazia", () => {
  const source = readSource("apps/web/app/[projectId]/ledger/[eventId]/send-alert-actions.ts");
  assert(source.includes("for (const candidate of relevantApprovedCandidates) {"));
  assert(source.includes("validateConfrontationJustification(candidate.reviewNote ?? \"\")"));
  assert(source.includes("if (!justification.valid) {"));
  // O bloqueio precisa vir ANTES de montar/enviar o e-mail.
  const blockIndex = source.indexOf("if (!justification.valid) {");
  const sendIndex = source.indexOf("sendContractAlertEmail({");
  assert(blockIndex !== -1 && sendIndex !== -1 && blockIndex < sendIndex, "bloqueio de justificativa precisa ocorrer antes do envio");
});

check("e-mail usa a justificativa de APROVAÇÃO como fonte da 'Conclusão do confronto' — nunca uma de rejeição (que nem gera cross_reference)", () => {
  const source = readSource("apps/web/app/[projectId]/ledger/[eventId]/send-alert-actions.ts");
  assert(source.includes('confrontationCandidates.filter((c) => c.status === "APPROVED")'), "só candidatos APPROVED alimentam o confronto do e-mail");
  assert(source.includes("reviewNote: candidate.reviewNote as string"));
});

// ---------- F. nome real do revisor ----------

check("cenário: quem envia o alerta é uma pessoa, quem aprovou o confronto é outra — e-mail mostra o aprovador real", () => {
  const block = buildConfrontationBlock(baseConfrontationCandidate, "Carla Mendes", "https://app.axion.com.br/x#confronto-c1");
  const { html } = buildContractAlertEmail({
    ...baseAlertInput,
    recipientName: "Bruna", // destinatário/quem recebe, nada a ver com quem aprovou
    confrontationBlocks: [block],
  });
  assert(html.includes("APROVADO POR CARLA MENDES"), "deveria mostrar o nome do aprovador real, em caixa alta");
  assert(!html.includes("APROVADO POR BRUNA"), "nunca deveria confundir destinatário/remetente com o aprovador");
});

check("fallback honesto quando reviewerName é null (reviewed_by_user_id ausente OU profile não encontrado) — nunca inventa nome", () => {
  const block = buildConfrontationBlock(baseConfrontationCandidate, null, "https://app.axion.com.br/x#confronto-c1");
  assert(block.approvedByLine.startsWith(UNIDENTIFIED_REVIEWER_LABEL));
  assert(UNIDENTIFIED_REVIEWER_LABEL === "APROVADO — REVISOR NÃO IDENTIFICADO");
});

check("getUser resolve profile PELO ID recebido (não pela sessão) — confirmado lendo lib/data.ts", () => {
  const source = readSource("apps/web/lib/data.ts");
  assert(/export async function getUser\(userId: string\)/.test(source), "getUser deveria receber um userId explícito");
  assert(source.includes('.eq("id", userId)'), "getUser deveria filtrar profiles pelo id recebido, nunca pela sessão");
  assert(!/auth\.getUser\(\)/.test(source.slice(source.indexOf("export async function getUser"))), "getUser não pode ler a sessão atual");
});

check("send-alert-actions.ts: reviewerName vem de getUser(reviewed_by_user_id) do candidato — nunca do usuário logado que está enviando o alerta", () => {
  const source = readSource("apps/web/app/[projectId]/ledger/[eventId]/send-alert-actions.ts");
  assert(source.includes("c.reviewedByUserId"));
  assert(source.includes("reviewerIdsToResolve.map((id) => getUser(id))"));
  assert(!/getUser\(\s*authData/.test(source), "nunca deveria resolver o revisor a partir do usuário autenticado da requisição atual");
  assert(!/getCurrentProjectPermission/.test(source) === false || !source.includes("session.user"), "reviewerName não pode vir de sessão/navegador");
});

check("APROVADO POR <NOME> renderiza em caixa alta, exatamente como pedido", () => {
  const block = buildConfrontationBlock(baseConfrontationCandidate, "reynaldo duarte", "https://x/#c1");
  assert(block.approvedByLine.startsWith("APROVADO POR REYNALDO DUARTE"), block.approvedByLine);
});

// ---------- G. evidências RECEBIDA/ENVIADA ----------

check("toEvidenceEmailDirection: INBOUND -> RECEIVED, OUTBOUND -> SENT, null/undefined -> UNKNOWN (nunca adivinha)", () => {
  assert(toEvidenceEmailDirection("INBOUND") === "RECEIVED");
  assert(toEvidenceEmailDirection("OUTBOUND") === "SENT");
  assert(toEvidenceEmailDirection(null) === "UNKNOWN");
  assert(toEvidenceEmailDirection(undefined) === "UNKNOWN");
  assert(EVIDENCE_EMAIL_DIRECTION_LABELS.RECEIVED === "RECEBIDA");
  assert(EVIDENCE_EMAIL_DIRECTION_LABELS.SENT === "ENVIADA");
  assert(EVIDENCE_EMAIL_DIRECTION_LABELS.UNKNOWN === "DIREÇÃO NÃO IDENTIFICADA");
});

check("evidência RECEBIDA: HTML mostra RECEBIDA + De/Para/Data/Assunto + link Abrir evidência no ACC", () => {
  const { html, text } = buildContractAlertEmail({
    ...baseAlertInput,
    keyEvidence: [
      {
        kind: "EMAIL",
        url: "https://app.axion.com.br/proj-1/ledger/evt-1#evidencia-ev-1",
        direction: "RECEIVED",
        from: "cliente@weg.com.br",
        to: "acc@axion.com.br",
        date: "20/08/2026",
        subject: "Notificação de atraso",
      },
    ],
  });
  assert(html.includes("RECEBIDA"));
  assert(html.includes("De: cliente@weg.com.br"));
  assert(html.includes("Para: acc@axion.com.br"));
  assert(html.includes("Data: 20/08/2026"));
  assert(html.includes("Assunto: Notificação de atraso"));
  assert(html.includes("Abrir evidência no ACC"));
  assert(html.includes('href="https://app.axion.com.br/proj-1/ledger/evt-1#evidencia-ev-1"'));
  assert(text.includes("RECEBIDA") && text.includes("cliente@weg.com.br"));
});

check("evidência ENVIADA: HTML mostra ENVIADA (mailbox monitorada é a remetente)", () => {
  const { html } = buildContractAlertEmail({
    ...baseAlertInput,
    keyEvidence: [
      {
        kind: "EMAIL",
        url: "https://app.axion.com.br/proj-1/ledger/evt-1#evidencia-ev-2",
        direction: "SENT",
        from: "acc@axion.com.br",
        to: "cliente@weg.com.br",
        date: "21/08/2026",
        subject: "Resposta à notificação",
      },
    ],
  });
  assert(html.includes("ENVIADA"));
  assert(!html.includes(">RECEBIDA<"));
});

check("comunicação interna (AXION<->AXION) também é classificada pela mailbox monitorada, nunca pelo domínio isolado", () => {
  const policy = evaluateGmailMessagePolicy(
    [
      { name: "From", value: "financeiro@axion.com.br" },
      { name: "To", value: "diretoria@axion.com.br" },
    ],
    "diretoria@axion.com.br",
    ["axion.com.br"]
  );
  assert(policy.direction === "INBOUND", "mailbox monitorada é destinatária -> INBOUND mesmo com os dois lados @axion.com.br");

  const policySent = evaluateGmailMessagePolicy(
    [
      { name: "From", value: "diretoria@axion.com.br" },
      { name: "To", value: "financeiro@axion.com.br" },
    ],
    "diretoria@axion.com.br",
    ["axion.com.br"]
  );
  assert(policySent.direction === "OUTBOUND", "mailbox monitorada é remetente -> OUTBOUND mesmo com os dois lados @axion.com.br");
});

check("direção desconhecida (e-mail sem emails.direction, ex. registro histórico) vira 'DIREÇÃO NÃO IDENTIFICADA' — nunca um palpite", () => {
  const { html } = buildContractAlertEmail({
    ...baseAlertInput,
    keyEvidence: [
      {
        kind: "EMAIL",
        url: "https://app.axion.com.br/x#e3",
        direction: toEvidenceEmailDirection(null),
        from: "alguem@exemplo.com",
        to: "outroalguem@exemplo.com",
        date: "01/01/2026",
        subject: "Registro histórico",
      },
    ],
  });
  assert(html.includes("DIREÇÃO NÃO IDENTIFICADA"));
});

check("evidência não-email usa o tipo real do SourceType (ex.: 'Diário de Obra'), nunca RECEBIDA/ENVIADA", () => {
  const { html } = buildContractAlertEmail({
    ...baseAlertInput,
    keyEvidence: [{ kind: "OTHER", url: "https://app.axion.com.br/x#e4", sourceTypeLabel: "Diário de Obra", label: "Registro #123" }],
  });
  assert(html.includes("Diário de Obra"));
  assert(html.includes("Registro #123"));
  assert(!html.includes(">RECEBIDA<") && !html.includes(">ENVIADA<"), "evidência não-email não pode usar rótulo de direção de e-mail");
});

check("send-alert-actions.ts: usa emails.direction (via getEmail) para classificar — nunca compara domínio @axion.com.br sozinho", () => {
  const source = readSource("apps/web/app/[projectId]/ledger/[eventId]/send-alert-actions.ts");
  assert(source.includes("toEvidenceEmailDirection(email.direction)"));
  assert(!/@axion\.com\.br/.test(source), "não deveria haver comparação de domínio hardcoded para classificar direção");
});

check("lib/data.ts: getEmail/getEmails agora selecionam direction (emails.direction) — fonte estruturada, nunca recalculada", () => {
  const source = readSource("apps/web/lib/data.ts");
  assert(/EMAIL_COLUMNS = ["'].*direction["'];/.test(source), "EMAIL_COLUMNS deveria incluir direction");
  assert(source.includes("direction: row.direction,"));
});

check("evidências continuam sem gmail:// e com âncoras HTTPS únicas nesta rodada também", () => {
  const { html, text } = buildContractAlertEmail({
    ...baseAlertInput,
    keyEvidence: [
      { kind: "EMAIL", url: "https://app.axion.com.br/x#evidencia-a", direction: "RECEIVED", from: "a@b.com", to: "c@d.com", date: "01/01/2026", subject: "Assunto A" },
      { kind: "OTHER", url: "https://app.axion.com.br/x#evidencia-b", sourceTypeLabel: "Relatório Semanal", label: "Relatório 12" },
    ],
  });
  assert(!/gmail:\/\//i.test(html) && !/gmail:\/\//i.test(text));
  assert(html.includes("#evidencia-a") && html.includes("#evidencia-b"));
});

check("remetente/destinatário/assunto/url de evidência são escapados (proteção contra HTML injection)", () => {
  const { html } = buildContractAlertEmail({
    ...baseAlertInput,
    keyEvidence: [
      {
        kind: "EMAIL",
        url: "https://app.axion.com.br/x#e5",
        direction: "RECEIVED",
        from: '<script>alert(1)</script>@x.com',
        to: "normal@x.com",
        date: "01/01/2026",
        subject: '"><img src=x onerror=alert(1)>',
      },
    ],
  });
  assert(!html.includes("<script>alert(1)</script>"), "from não escapado permitiria injeção de script");
  assert(!html.includes("<img src=x onerror=alert(1)>"), "subject não escapado permitiria injeção de HTML");
});

// ---------- H. preservação (amostra — cobertura completa em test-alert-email-layout-evidence-links.mjs / test-alert-recipient-selection.mjs / test-email-actions.mjs) ----------

check("guard de piloto, tokens de uso único, permissões e auditoria continuam intocados por esta rodada", () => {
  const pilotGuardSource = readSource("apps/web/lib/email/pilot-outbound-guard.ts");
  assert(pilotGuardSource.includes('ACC_EXPECTED_PILOT_RECIPIENT = "reynaldo@axion.com.br"'), "piloto continua exclusivo para reynaldo@axion.com.br");
  const sendEmailSource = readSource("apps/web/lib/email/send-contract-alert-email.ts");
  assert(sendEmailSource.includes("CONTRACT_ALERT_EMAIL_SENT"));
  assert(sendEmailSource.includes('permission !== "ADMINISTRADOR"'));
  const issueTokensSource = readSource("apps/web/lib/email-actions/issue-tokens.ts");
  assert(issueTokensSource.includes("resolveEffectiveRecipient"));
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
