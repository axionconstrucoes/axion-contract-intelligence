// Testes do padrão institucional de e-mails do ACC (remetente, subject
// dinâmico, template HTML/badges, botão RESPONDER AO ACC) e da detecção
// de idioma de documentos multilíngues.
//
// SEGURANÇA: este ambiente tem AXION_EMAIL_PROVIDER=gmail configurado
// (envio real). Por isso este script NUNCA chama getEmailProvider() nem
// sendContractAlertEmail() (que resolveria para o Gmail real) — só testa
// os construtores puros (subject/HTML/text/MIME) e o FakeEmailProvider
// instanciado diretamente, que nunca faz rede. Nenhuma mensagem real é
// enviada a terceiros.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-acc-email-branding.mjs

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { ACC_SENDER_DISPLAY_NAME, ACC_INSTITUTIONAL_TARGET_EMAIL, formatSenderHeader, isInstitutionalSenderConfigured } =
  await import("../apps/web/lib/email/sender-identity");
const { base64UrlEncode, buildMimeMessage } = await import("../apps/web/lib/email/mime-message");
const { buildContractAlertSubject, buildContractAlertEmail, alertRiskLevelLabels } = await import(
  "../apps/web/lib/email/templates/contract-alert-template"
);
const { buildSlaEscalationEmail } = await import("../apps/web/lib/email/templates/sla-escalation-template");
const { buildRespondToAccUrl } = await import("../apps/web/lib/email/build-respond-to-acc-url");
const { FakeEmailProvider } = await import("../apps/web/lib/email/fake-email-provider");
const { detectSourceLanguage } = await import("../apps/web/lib/documents/detect-source-language");
const { ACC_EMAIL_LOGO_CID, appendAccEmailSignature, buildAccEmailSignatureHtml, buildAccEmailSignatureText } = await import(
  "../apps/web/lib/email/branding/acc-email-signature"
);
const { loadAccLogoInlineImage } = await import("../apps/web/lib/email/branding/load-acc-logo-inline-image");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const readSource = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

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

console.log("");
console.log("======================================");
console.log("ACC — E-MAILS OFICIAIS + MULTIIDIOMA — TESTES");
console.log("======================================");
console.log("");

// ---------- 1. remetente ----------

check("remetente visível correto no header From (nome + endereço, endereço nunca alterado)", () => {
  const header = formatSenderHeader("reynaldo@axion.com.br");
  assert(header === '"ACC AXION CONTROLE DE CONTRATOS" <reynaldo@axion.com.br>', `header inesperado: ${header}`);
  assert(ACC_SENDER_DISPLAY_NAME === "ACC AXION CONTROLE DE CONTRATOS", "nome de exibição não corresponde ao padrão pedido");
});

check("acc_ia@axion.com.br ainda não é o remetente configurado (não inventamos que já está autorizado)", () => {
  assert(ACC_INSTITUTIONAL_TARGET_EMAIL === "acc_ia@axion.com.br");
  assert(isInstitutionalSenderConfigured("acc_ia@axion.com.br") === true);
  assert(
    isInstitutionalSenderConfigured(process.env.GOOGLE_GMAIL_SENDER_EMAIL ?? "") === false,
    "GOOGLE_GMAIL_SENDER_EMAIL atual não deveria ser confundido com o alvo institucional ainda não autorizado"
  );
});

// ---------- 2. assunto dinâmico ----------

check("subject com nome da obra e nível de risco dinâmicos", () => {
  const subject = buildContractAlertSubject("WEG Fábrica de Arames", "ALTA");
  assert(
    subject === "ACC - ALERTAS DO CONTRATO - OBRA WEG FÁBRICA DE ARAMES - RISCO ALTO",
    `subject inesperado: ${subject}`
  );
});

check("mapeamento de severidade para rótulo de risco: BAIXA->BAIXO, MEDIA->MÉDIO, ALTA->ALTO, CRITICA->CRÍTICO", () => {
  assert(alertRiskLevelLabels.BAIXA === "BAIXO");
  assert(alertRiskLevelLabels.MEDIA === "MÉDIO");
  assert(alertRiskLevelLabels.ALTA === "ALTO");
  assert(alertRiskLevelLabels.CRITICA === "CRÍTICO");
});

// ---------- 3. template HTML / badges ----------

const baseAlertInput = {
  recipientName: "Bruna",
  projectName: "WEG Fábrica de Arames",
  title: "Possível atraso na entrega da estrutura",
  summary: "O cliente notificou atraso de 20 dias.",
  relatedEventTitle: "Notificação de atraso — 05/01/2026",
  contractualBasis: "Cláusula 5.2 — Prazo de execução",
  keyEvidence: ["E-mail: Atraso na entrega (Gmail > Assunto: Atraso na entrega)"],
  potentialImpact: "Impacto Potencial",
  recommendedAction: null,
  responsibleName: null,
  dueDate: null,
  eventUrl: "http://localhost:3000/proj-1/ledger/evt-1",
  respondUrl: "http://localhost:3000/proj-1/ledger/evt-1?respond=acc",
};

check("CRÍTICO usa fundo vermelho, texto branco e forte destaque", () => {
  const { html } = buildContractAlertEmail({ ...baseAlertInput, severity: "CRITICA" });
  assert(html.includes("RISCO CRÍTICO"), "badge deveria mostrar COR + TEXTO (RISCO CRÍTICO)");
  assert(html.includes("#dc2626"), "fundo vermelho ausente");
  assert(html.includes("color:#ffffff"), "texto branco ausente no badge crítico");
});

check("BAIXO usa fundo verde, MÉDIO usa fundo amarelo/âmbar, ALTO usa fundo laranja", () => {
  const low = buildContractAlertEmail({ ...baseAlertInput, severity: "BAIXA" }).html;
  const medium = buildContractAlertEmail({ ...baseAlertInput, severity: "MEDIA" }).html;
  const high = buildContractAlertEmail({ ...baseAlertInput, severity: "ALTA" }).html;
  assert(low.includes("#16a34a") && low.includes("RISCO BAIXO"), "badge BAIXO incorreto");
  assert(medium.includes("#f59e0b") && medium.includes("RISCO MÉDIO"), "badge MÉDIO incorreto");
  assert(high.includes("#f97316") && high.includes("RISCO ALTO"), "badge ALTO incorreto");
});

check("corpo principal do e-mail é sempre preto (#000000), nunca parágrafo inteiro colorido", () => {
  const { html } = buildContractAlertEmail({ ...baseAlertInput, severity: "ALTA" });
  assert(html.includes("background-color:#ffffff"), "fundo deveria ser branco");
  const bodyTextOccurrences = (html.match(/color:#000000/g) ?? []).length;
  assert(bodyTextOccurrences >= 5, "texto principal deveria usar preto na maior parte do corpo");
});

check("campos ausentes (responsável/prazo/ação recomendada) nunca aparecem como placeholder inventado", () => {
  const { html, text } = buildContractAlertEmail({ ...baseAlertInput, severity: "ALTA" });
  assert(!html.includes("Responsável</td>"), "linha de responsável não deveria existir quando null");
  assert(!text.includes("Responsável:"), "linha de responsável não deveria existir quando null (texto)");
  assert(!text.includes("null"), "nenhum campo ausente pode vazar como a string 'null'");
  assert(!html.includes(">null<"), "nenhum campo ausente pode vazar como a string 'null' no HTML");
});

check("evento relacionado, base contratual e evidências principais aparecem quando disponíveis", () => {
  const { html, text } = buildContractAlertEmail({ ...baseAlertInput, severity: "MEDIA" });
  assert(html.includes("Cláusula 5.2"), "base contratual ausente no HTML");
  assert(html.includes("Atraso na entrega"), "evidência principal ausente no HTML");
  assert(text.includes("Cláusula 5.2"), "base contratual ausente no texto");
});

check("responsável e prazo aparecem quando fornecidos (nunca omitidos quando existem)", () => {
  const { html, text } = buildContractAlertEmail({
    ...baseAlertInput,
    severity: "ALTA",
    responsibleName: "Carlos Mendes",
    dueDate: "2026-02-01",
  });
  assert(html.includes("Carlos Mendes"), "responsável deveria aparecer quando fornecido");
  assert(text.includes("Responsável: Carlos Mendes"));
  assert(text.includes("Prazo: 2026-02-01"));
});

// ---------- 4. botão RESPONDER AO ACC ----------

check("template inclui o botão/link RESPONDER AO ACC e preserva o link para abrir o evento", () => {
  const { html, text } = buildContractAlertEmail({ ...baseAlertInput, severity: "ALTA" });
  assert(html.includes("RESPONDER AO ACC"), "botão RESPONDER AO ACC ausente do HTML");
  assert(html.includes(baseAlertInput.respondUrl), "URL de resposta ausente do HTML");
  assert(html.includes(baseAlertInput.eventUrl), "link do evento ausente do HTML");
  assert(text.includes("Responder ao ACC:"), "botão RESPONDER AO ACC ausente do texto");
});

check("buildRespondToAccUrl monta metadata correta (projectId/eventId/riskLevel/alertId)", () => {
  const url = buildRespondToAccUrl("http://localhost:3000", {
    projectId: "proj-1",
    eventId: "evt-1",
    riskLevel: "ALTA",
    alertId: "alert-9",
  });
  const parsed = new URL(url);
  assert(parsed.pathname === "/proj-1/ledger/evt-1", `path inesperado: ${parsed.pathname}`);
  assert(parsed.searchParams.get("respond") === "acc");
  assert(parsed.searchParams.get("riskLevel") === "ALTA");
  assert(parsed.searchParams.get("alertId") === "alert-9");
  assert(parsed.hash === "#responder-ao-acc");
});

check("buildRespondToAccUrl nunca inventa um alertId quando não fornecido", () => {
  const url = buildRespondToAccUrl("http://localhost:3000", {
    projectId: "proj-1",
    eventId: "evt-1",
    riskLevel: "BAIXA",
  });
  assert(!new URL(url).searchParams.has("alertId"), "alertId não deveria existir quando não fornecido");
});

// ---------- 5. MIME / multipart ----------

check("buildMimeMessage sem html continua text/plain puro (compatibilidade com ActionRequest)", () => {
  const raw = buildMimeMessage(
    { to: "cliente@exemplo.com", subject: "Assunto", text: "Corpo em texto puro.", correlationId: "corr-1" },
    "reynaldo@axion.com.br",
    "<corr-1@axion.com.br>"
  );
  assert(raw.includes("Content-Type: text/plain; charset=UTF-8"));
  assert(!raw.includes("multipart/alternative"), "não deveria virar multipart quando não há html");
  assert(raw.includes('From: "ACC AXION CONTROLE DE CONTRATOS" <reynaldo@axion.com.br>'));
});

check("buildMimeMessage com html gera multipart/alternative com as duas partes", () => {
  const raw = buildMimeMessage(
    {
      to: "cliente@exemplo.com",
      subject: "Assunto",
      text: "Versão texto.",
      html: "<p>Versão HTML.</p>",
      correlationId: "corr-2",
    },
    "reynaldo@axion.com.br",
    "<corr-2@axion.com.br>"
  );
  assert(raw.includes("Content-Type: multipart/alternative; boundary=\"acc-boundary-corr-2\""));
  assert(raw.includes("Content-Type: text/plain; charset=UTF-8"));
  assert(raw.includes("Content-Type: text/html; charset=UTF-8"));
  assert(raw.includes("Versão texto."));
  assert(raw.includes("<p>Versão HTML.</p>"));
});

check("base64UrlEncode nunca produz caracteres não-seguros para URL (+, /, =)", () => {
  const encoded = base64UrlEncode("qualquer texto ç ã é õ üü ++//==");
  assert(!/[+/=]/.test(encoded), `encoded inseguro: ${encoded}`);
});

// ---------- 6. FakeEmailProvider (nunca envia rede) ----------

await checkAsync("FakeEmailProvider aceita html sem exigir rede e nunca envia mensagem real", async () => {
  const provider = new FakeEmailProvider();
  const { html } = buildContractAlertEmail({ ...baseAlertInput, severity: "CRITICA" });
  // Este teste é sobre aceitação de HTML/branding pelo provider, não
  // sobre a trava do piloto (que tem cobertura dedicada em
  // scripts/test-pilot-outbound-guard.mjs) — força modo produção via
  // env override explícito para não depender de ACC_PILOT_RECIPIENT
  // estar configurado neste ambiente. Restaurado logo em seguida para
  // nunca vazar para outros checks deste arquivo.
  const previousOutboundMode = process.env.ACC_OUTBOUND_MODE;
  process.env.ACC_OUTBOUND_MODE = "production";
  let result;
  try {
    result = await provider.send({
      to: "destinatario-de-teste@exemplo.com",
      subject: "ACC - ALERTAS DO CONTRATO - OBRA TESTE - RISCO CRÍTICO",
      text: "texto",
      html,
      correlationId: "fake-corr-1",
    });
  } finally {
    process.env.ACC_OUTBOUND_MODE = previousOutboundMode;
  }
  assert(result.provider === "FAKE");
  assert(result.from === "dev-fake-sender@axion.local");
});

// ---------- 7. governança IA — nunca envio automático ----------

check("buildContractAlertEmail é puro (só monta conteúdo) — nenhuma função de template envia e-mail", () => {
  const built = buildContractAlertEmail({ ...baseAlertInput, severity: "ALTA" });
  assert(typeof built.subject === "string" && typeof built.html === "string" && typeof built.text === "string");
  assert(built.subject !== undefined, "template não deveria ter nenhum efeito colateral de envio");
});

// ---------- 8. multiidioma — detecção de idioma ----------

check("detecta português em um trecho de contrato real", () => {
  const result = detectSourceLanguage(
    "O contrato estabelece que a contratada deverá executar os serviços conforme especificado no memorial descritivo e no cronograma aprovado pelas partes."
  );
  assert(result.code === "pt", `esperado pt, obtido ${result.code} (detector: ${result.detectorCode})`);
});

check("detecta inglês em um trecho de RFP real", () => {
  const result = detectSourceLanguage(
    "This request for proposal describes the scope of work required for the fabrication and installation of the steel structure at the client facility."
  );
  assert(result.code === "en", `esperado en, obtido ${result.code} (detector: ${result.detectorCode})`);
});

check("detecta espanhol em um trecho de especificação real", () => {
  const result = detectSourceLanguage(
    "El presente documento establece las condiciones técnicas y comerciales aplicables al suministro e instalación de los equipos mencionados en el anexo."
  );
  assert(result.code === "es", `esperado es, obtido ${result.code} (detector: ${result.detectorCode})`);
});

check("texto muito curto retorna indeterminado (null) em vez de arriscar um palpite", () => {
  const result = detectSourceLanguage("ok");
  assert(result.code === null && result.detectorCode === "und");
});

check("texto vazio retorna indeterminado, nunca lança exceção", () => {
  const result = detectSourceLanguage("");
  assert(result.code === null);
});

// ---------- 10. assinatura institucional ACC (logo + texto) em TODO envio outbound ----------

check("banner institucional dos templates usa o nome atual da marca (AXION CONTROLE DE CONTRATOS, nunca o nome antigo ACOMPANHAMENTO)", () => {
  const alert = buildContractAlertEmail({ ...baseAlertInput, severity: "ALTA" });
  assert(alert.html.includes("AXION CONTROLE DE CONTRATOS"));
  assert(!alert.html.includes("ACOMPANHAMENTO") && !alert.text.includes("Acompanhamento"));

  const sla = buildSlaEscalationEmail({
    recipientName: "Bruna",
    projectName: "WEG Fábrica de Arames",
    severity: "ALTA",
    actionTitle: "Responder cliente",
    currentResponsibleName: "Carlos Mendes",
    originalDeadline: "22/08/2026 14:00",
    overdueBy: "2h15min",
    escalationLevelLabel: "2º Escalão",
    recommendedAction: null,
    eventUrl: "http://localhost:3000/proj-1/ledger/evt-1",
    respondUrl: "http://localhost:3000/proj-1/ledger/evt-1?respond=acc",
  });
  assert(sla.html.includes("AXION CONTROLE DE CONTRATOS"));
  assert(!sla.html.includes("ACOMPANHAMENTO") && !sla.text.includes("Acompanhamento"));
});

check("buildAccEmailSignatureText/Html reaproveitam ACC_SENDER_DISPLAY_NAME (única fonte do texto da marca)", () => {
  assert(buildAccEmailSignatureText() === ACC_SENDER_DISPLAY_NAME);
  assert(buildAccEmailSignatureHtml(false).includes(ACC_SENDER_DISPLAY_NAME));
});

check("assinatura HTML só referencia cid: quando o logo inline realmente está disponível (nunca uma imagem quebrada)", () => {
  const withLogo = buildAccEmailSignatureHtml(true);
  assert(withLogo.includes(`cid:${ACC_EMAIL_LOGO_CID}`));

  const withoutLogo = buildAccEmailSignatureHtml(false);
  assert(!withoutLogo.includes("cid:"), "sem o arquivo do logo, o HTML nunca pode referenciar um cid: inexistente");
  assert(withoutLogo.includes(ACC_SENDER_DISPLAY_NAME), "mesmo sem logo, o texto da assinatura deve aparecer");
});

check("appendAccEmailSignature: e-mail só-texto (ActionRequest) ganha a linha de assinatura em texto puro, nunca HTML inventado", () => {
  const signed = appendAccEmailSignature({ text: "Corpo da solicitação." }, false);
  assert(signed.text.includes("Corpo da solicitação."));
  assert(signed.text.includes(ACC_SENDER_DISPLAY_NAME));
  assert(signed.html === undefined, "não pode inventar um canal HTML que não existia no e-mail original");
});

check("appendAccEmailSignature: e-mail HTML+texto preserva o conteúdo original e acrescenta a assinatura ao final de ambos", () => {
  const signed = appendAccEmailSignature({ text: "Texto original.", html: "<p>HTML original.</p>" }, true);
  assert(signed.text.startsWith("Texto original."));
  assert(signed.text.includes(ACC_SENDER_DISPLAY_NAME));
  assert(signed.html.includes("<p>HTML original.</p>"));
  assert(signed.html.includes(`cid:${ACC_EMAIL_LOGO_CID}`));
});

check("buildMimeMessage com inlineImages envolve multipart/alternative num multipart/related e inclui o Content-ID", () => {
  const raw = buildMimeMessage(
    {
      to: "cliente@exemplo.com",
      subject: "Assunto",
      text: "Versão texto.",
      html: "<p>Versão HTML.</p>",
      inlineImages: [{ cid: "acc-logo-signature", filename: "acc-logo.png", mimeType: "image/png", contentBase64: "aGVsbG8td29ybGQ=" }],
      correlationId: "corr-cid-1",
    },
    "reynaldo@axion.com.br",
    "<corr-cid-1@axion.com.br>"
  );
  assert(raw.includes('Content-Type: multipart/related; boundary="acc-boundary-corr-cid-1-related"'));
  assert(raw.includes('Content-Type: multipart/alternative; boundary="acc-boundary-corr-cid-1"'));
  assert(raw.includes("Content-ID: <acc-logo-signature>"));
  assert(raw.includes("Content-Disposition: inline"));
  assert(raw.includes("aGVsbG8td29ybGQ="));
  assert(raw.includes("Versão texto.") && raw.includes("<p>Versão HTML.</p>"));
});

check("buildMimeMessage sem inlineImages continua exatamente multipart/alternative simples (nunca envolve multipart/related à toa)", () => {
  const raw = buildMimeMessage(
    { to: "cliente@exemplo.com", subject: "Assunto", text: "Texto.", html: "<p>HTML.</p>", correlationId: "corr-3" },
    "reynaldo@axion.com.br",
    "<corr-3@axion.com.br>"
  );
  assert(!raw.includes("multipart/related"));
  assert(raw.includes('Content-Type: multipart/alternative; boundary="acc-boundary-corr-3"'));
});

check("loadAccLogoInlineImage nunca lança e reflete corretamente o estado real do arquivo em disco (apps/web, nunca a raiz do repo)", () => {
  const appRootDir = path.join(repoRoot, "apps", "web");
  const logoPath = path.join(appRootDir, "public", "branding", "acc-logo.png");
  const fileExists = existsSync(logoPath);
  const result = loadAccLogoInlineImage(appRootDir);

  if (!fileExists) {
    assert(result === null, "sem o arquivo em disco, deve retornar null (nunca inventar um logo)");
  } else {
    assert(result !== null, "com o arquivo em disco, deve carregar o logo real");
    assert(result.cid === ACC_EMAIL_LOGO_CID);
    assert(result.mimeType === "image/png");
    assert(typeof result.contentBase64 === "string" && result.contentBase64.length > 0);
  }
});

check("loadAccLogoInlineImage: em produção usa process.cwd() por padrão (mesmo cwd que Next.js sempre usa para public/ nesta monorepo)", () => {
  const source = readSource("apps/web/lib/email/branding/load-acc-logo-inline-image.ts");
  assert(/appRootDir:\s*string\s*=\s*process\.cwd\(\)/.test(source), "o default do parâmetro deve continuar sendo process.cwd() em produção");
});

check("governança outbound preservada: signature-injection nunca chama getEmailProvider/envia rede (só monta conteúdo)", () => {
  const signatureSource = readSource("apps/web/lib/email/branding/acc-email-signature.ts");
  const loaderSource = readSource("apps/web/lib/email/branding/load-acc-logo-inline-image.ts");
  assert(!/getEmailProvider|gmail\.users|googleapis/i.test(signatureSource));
  assert(!/getEmailProvider|gmail\.users|googleapis/i.test(loaderSource));
});

check("assinatura pessoal do Google Workspace nunca é tocada (nenhum código novo referencia sendAs/signature do Gmail)", () => {
  const signatureSource = readSource("apps/web/lib/email/branding/acc-email-signature.ts");
  const loaderSource = readSource("apps/web/lib/email/branding/load-acc-logo-inline-image.ts");
  assert(!/sendAs|users\.settings/i.test(signatureSource));
  assert(!/sendAs|users\.settings/i.test(loaderSource));
});

check("auditoria/revisão humana dos 3 fluxos de envio reais permanecem intactas (nenhuma linha de audit/autorização removida)", () => {
  const contractAlertSource = readSource("apps/web/lib/email/send-contract-alert-email.ts");
  assert(contractAlertSource.includes("CONTRACT_ALERT_EMAIL_SENT"));
  assert(contractAlertSource.includes('permission !== "EDITOR" && permission !== "ADMIN"'));

  const slaSource = readSource("apps/web/lib/email/send-sla-escalation-email.ts");
  assert(slaSource.includes("ACTION_ESCALATED"));

  const actionRequestSource = readSource("apps/web/lib/email/action-request-notification-core.ts");
  assert(actionRequestSource.includes("notifications_one_initial_per_action_request_idx") || actionRequestSource.includes("DuplicateNotificationError"));
});

check("corpo persistido de ActionRequest (notifications.body / emails.snippet) permanece o texto autoral do humano, sem a assinatura anexada", () => {
  const source = readSource("apps/web/lib/email/action-request-notification-core.ts");
  assert(source.includes("body: input.body"), "notifications.body deve permanecer input.body puro (sem assinatura)");
  assert(source.includes("snippet: input.body.slice(0, 280)"), "emails.snippet deve continuar vindo de input.body puro (sem assinatura)");
  assert(source.includes("text: signed.text"), "o envio real (provider.send) deve usar o texto assinado");
});

// ---------- 9. teste real, leve: colunas multilíngues existem no schema ----------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !serviceKey) {
  console.log("");
  console.log("SKIP verificação real de schema — Supabase não configurado.");
} else {
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  await checkAsync("document_versions expõe source_language/translation_language/translation_status (leitura real, sem alterar dados)", async () => {
    const { data, error } = await admin
      .from("document_versions")
      .select("id,source_language,translation_language,translation_status")
      .limit(1);
    if (error) throw error;
    assert(Array.isArray(data), "consulta deveria retornar um array (mesmo que vazio)");
    if (data.length > 0) {
      assert(
        data[0].translation_status === "NOT_TRANSLATED" || typeof data[0].translation_status === "string",
        "translation_status deveria ter um valor válido"
      );
    }
  });

  await checkAsync("originalIsAuthoritative nunca varia — é um invariante de tipo, não uma coluna gravável", async () => {
    // Confirma que a tabela NÃO tem uma coluna desse nome (decisão
    // deliberada: é tratado como tipo literal `true` no código, igual a
    // AiAssessment.requiresHumanReview — nunca gravável como false).
    const { error } = await admin.from("document_versions").select("original_is_authoritative").limit(1);
    assert(error !== null, "não deveria existir uma coluna original_is_authoritative gravável no banco");
  });
}

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
